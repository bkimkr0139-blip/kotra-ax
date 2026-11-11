'use strict';
// Multi-RAG engine: collections, hybrid retrieval (BM25 + concept/trigram semantic), RRF, rerank, evidence validation.
// The "semantic" scorer is a local concept-vector adapter; an external embedding model can replace it behind the same interface.
const { q, nextId, getSetting, setSetting } = require('../db');
const U = require('../util');
const NLP = require('./nlp');
const { SCOPE } = require('../auth');

// RFP SFR-025: >=10 switchable RAG options, extensible
const RAG_OPTIONS = [
  ['query_rewrite', '질의 재해석(Query Rewrite)', 'Query rewrite', true],
  ['decomposition', '복합질의 분해(Query Decomposition)', 'Query decomposition', true],
  ['domain_routing', '도메인 자동 라우팅', 'Domain routing', true],
  ['hybrid', '하이브리드 검색(Lexical+Semantic)', 'Hybrid search', true],
  ['rrf', 'RRF 결합', 'Reciprocal Rank Fusion', true],
  ['rerank', 'Reranker 재정렬', 'Reranker', true],
  ['metadata_filter', '메타데이터 필터/가중', 'Metadata filter & boost', true],
  ['multi_hop', 'Multi-Hop(HS코드 전달)', 'Multi-hop retrieval', true],
  ['hyde', 'HyDE 가상문서 확장', 'HyDE expansion', true],
  ['reorder', '컨텍스트 재배치(Re-Order)', 'Context re-order', true],
  ['dedupe', '문서 중복 제거', 'Document de-duplication', true],
  ['abstain', '근거 부족 시 답변 유보', 'Abstain on weak evidence', true],
  ['injection_guard', '프롬프트 인젝션 격리', 'Prompt-injection quarantine', true],
  ['access_filter', '권한 기반 지식 제한', 'Access-scope filtering', true],
  ['text_to_sql', 'Text-to-SQL(읽기전용)', 'Read-only Text-to-SQL', true],
  ['graph_expand', '관계(Graph) 확장', 'Graph relation expansion', false],
].map(([id, ko, en, def]) => ({ id, ko, en, default: def }));

function getOptions() {
  const saved = getSetting('rag_options', {}) || {};
  const o = {};
  for (const r of RAG_OPTIONS) o[r.id] = saved[r.id] ?? r.default;
  return o;
}
function setOptions(patch) { const cur = getOptions(); setSetting('rag_options', { ...cur, ...patch }); }

// ---------- chunking / indexing ----------
function chunkText(text, maxLen) {
  const sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?。])\s+/);
  const chunks = []; let cur = '';
  for (const s of sents) {
    const st = s.trim(); if (!st) continue;
    if ((cur + ' ' + st).length > maxLen && cur) { chunks.push(cur.trim()); cur = st; } else cur = (cur + ' ' + st).trim();
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}
function indexDocument(doc) {
  q.run('DELETE FROM chunks WHERE doc_id=?', doc.id);
  const hits = NLP.scanInjection((doc.text || '') + ' ' + (doc.text_en || ''));
  const flagged = hits.length ? 1 : 0;
  const meta = { country: doc.country || null, hs: doc.hs || null, doc_type: doc.doc_type || null, org: doc.org || null };
  let n = 0;
  for (const [lang, txt, mx] of [['ko', doc.text, 240], ['en', doc.text_en, 380]]) {
    if (!txt) continue;
    chunkText(txt, mx).forEach((c, i) => {
      q.insert('chunks', { id: `${doc.id}#${lang}${i}`, doc_id: doc.id, collection_id: doc.collection_id, idx: i, lang, text: c, tf: '{}', len: NLP.words(c).length, meta: JSON.stringify(meta), flagged });
      n++;
    });
  }
  if (flagged) q.update('documents', doc.id, { flagged: JSON.stringify(hits), status: 'QUARANTINED' });
  invalidate();
  return { chunks: n, flagged: !!flagged, hits };
}
function addDocument(d) {
  const row = { status: 'ACTIVE', access_scope: 'PUBLIC', source_type: 'demo', is_synthetic: 1, flagged: null, ...d };
  q.insert('documents', row);
  return { id: row.id, ...indexDocument(row) };
}
function reindexCollection(collectionId) {
  const docs = q.all('SELECT * FROM documents WHERE collection_id=?', collectionId);
  let chunks = 0, flagged = 0;
  for (const d of docs) { const r = indexDocument(d); chunks += r.chunks; if (r.flagged) flagged++; }
  q.update('collections', collectionId, { last_indexed: U.iso() });
  return { docs: docs.length, chunks, flagged };
}

// ---------- in-memory index ----------
let CACHE = null;
function invalidate() { CACHE = null; }
function build() {
  const rows = q.all(`SELECT c.id,c.doc_id,c.collection_id,c.lang,c.text,c.flagged,d.title,d.title_en,d.org,d.url,d.published_at,d.updated_at,d.country,d.hs,d.doc_type,d.access_scope,d.status
    FROM chunks c JOIN documents d ON d.id=c.doc_id WHERE d.status='ACTIVE' AND c.flagged=0`);
  const chunks = rows.map((r) => {
    const toks = NLP.lexTokens(r.text);
    const tf = new Map(); toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const concepts = NLP.conceptsOf(r.text + ' ' + (r.title || '') + ' ' + (r.title_en || ''));
    const tri = NLP.trigrams(r.text + ' ' + (r.lang === 'ko' ? r.title : r.title_en));
    const norm = (m) => Math.sqrt([...m.values()].reduce((a, v) => a + v * v, 0)) || 1;
    return { ...r, tf, len: toks.length || 1, concepts, tri, cNorm: norm(concepts), tNorm: norm(tri), words: new Set(NLP.words(r.text + ' ' + (r.title || '') + ' ' + (r.title_en || ''))) };
  });
  const df = new Map(); let total = 0;
  for (const c of chunks) { total += c.len; for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1); }
  const vocab = new Set(); for (const c of chunks) for (const w of c.words) vocab.add(w);
  CACHE = { chunks, df, N: chunks.length, avgLen: total / Math.max(1, chunks.length), vocab };
  return CACHE;
}
const idx = () => CACHE || build();

const idf = (C, t) => Math.log(1 + (C.N - (C.df.get(t) || 0) + 0.5) / ((C.df.get(t) || 0) + 0.5));
const cosine = (a, aN, b, bN) => { let dot = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; for (const [k, v] of s) { const w = l.get(k); if (w) dot += v * w; } return dot / (aN * bN); };

function search({ query, collections, k = 6, mode = 'hybrid', filters = {}, clearance = 1, lang = 'ko', opts = null, threshold = null }) {
  const t0 = Date.now();
  const o = opts || getOptions();
  const C = idx();
  const cols = new Set(collections && collections.length ? collections : null);
  const trace = { query, mode, collections: [...cols], rewritten: null, concepts: [], steps: [] };

  let qtext = query;
  if (o.query_rewrite || o.hyde) { const ex = NLP.expandQuery(query); trace.concepts = ex.concepts; if (o.query_rewrite) { qtext = ex.rewritten; trace.rewritten = qtext; } }
  const qLex = [...new Set(NLP.lexTokens(qtext))];
  const qWords = [...new Set(NLP.words(query))];
  const qConcepts = NLP.conceptsOf(query);
  const qTri = NLP.trigrams(query);
  const qcNorm = Math.sqrt([...qConcepts.values()].reduce((a, v) => a + v * v, 0)) || 1;
  const qtNorm = Math.sqrt([...qTri.values()].reduce((a, v) => a + v * v, 0)) || 1;

  // content tokens: known in corpus or concept words; unknown ones don't count against coverage but penalise it.
  const known = [], unknown = [];
  for (const w of qWords) {
    const isKnown = C.vocab.has(w) || NLP.conceptsOf(w).size > 0 || [...C.vocab].some((v) => v.length >= 3 && w.length >= 3 && (v.includes(w) || w.includes(v)));
    (isKnown ? known : unknown).push(w);
  }

  let cand = C.chunks.filter((c) => (!cols.size || cols.has(c.collection_id)));
  if (o.access_filter) cand = cand.filter((c) => (SCOPE[c.access_scope] ?? 0) <= clearance);
  trace.candidates = cand.length;

  // BM25
  const lexScore = new Map();
  if (mode !== 'semantic') {
    for (const c of cand) {
      let s = 0;
      for (const t of qLex) { const f = c.tf.get(t); if (!f) continue; s += idf(C, t) * (f * 2.4) / (f + 1.4 * (0.25 + 0.75 * c.len / C.avgLen)); }
      if (s > 0) lexScore.set(c.id, s);
    }
  }
  // Semantic (concept + trigram)
  const semScore = new Map();
  if (mode !== 'lexical') {
    for (const c of cand) {
      const cs = qConcepts.size ? cosine(qConcepts, qcNorm, c.concepts, c.cNorm) : 0;
      const ts = cosine(qTri, qtNorm, c.tri, c.tNorm);
      const s = 0.65 * cs + 0.35 * Math.min(1, ts * 2.2);
      if (s > 0.01) semScore.set(c.id, s);
    }
  }
  const lexMax = Math.max(1e-9, ...lexScore.values(), 0);
  const rank = (m) => { const r = new Map(); [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([id], i) => r.set(id, i + 1)); return r; };
  const rl = rank(lexScore), rs = rank(semScore);

  const ids = new Set([...lexScore.keys(), ...semScore.keys()]);
  const byId = new Map(cand.map((c) => [c.id, c]));
  const scored = [];
  for (const id of ids) {
    const c = byId.get(id);
    const lx = (lexScore.get(id) || 0) / lexMax;
    const sm = semScore.get(id) || 0;
    const rrf = (rl.has(id) ? 1 / (60 + rl.get(id)) : 0) + (rs.has(id) ? 1 / (60 + rs.get(id)) : 0);
    // coverage over known content tokens
    let cov = 0;
    if (known.length) {
      let m = 0;
      for (const w of known) {
        if (c.words.has(w) || [...c.words].some((x) => x.length >= 3 && w.length >= 3 && (x.includes(w) || w.includes(x)))) m++;
        else { const cw = NLP.conceptsOf(w); if ([...cw.keys()].some((cid) => c.concepts.has(cid))) m += 0.85; }
      }
      cov = m / known.length;
    }
    const unkShare = qWords.length ? unknown.length / qWords.length : 0;
    cov = cov * (1 - 0.4 * unkShare);
    let boost = 0;
    if (o.metadata_filter) {
      if (filters.country) boost += c.country === filters.country ? 0.12 : (c.country && c.country !== 'KR' ? -0.2 : 0);
      if (filters.hs && c.hs) { const a = String(filters.hs).slice(0, 4), b = String(c.hs).slice(0, 4); boost += a === b ? 0.12 : a.slice(0, 2) === b.slice(0, 2) ? -0.04 : -0.2; }
      if (filters.docType && c.doc_type === filters.docType) boost += 0.04;
      const age = c.published_at ? U.dday(String(c.published_at).slice(0, 10)) : null;
      if (age != null && age > -400) boost += 0.02;
    }
    const langBoost = c.lang === lang ? 0.03 : 0;
    const base = mode === 'lexical' ? lx : mode === 'semantic' ? sm : (o.rrf ? Math.min(1, rrf * 30) * 0.5 + 0.25 * lx + 0.25 * sm : 0.5 * lx + 0.5 * sm);
    const rel = o.rerank ? U.clamp(0.55 * cov + 0.2 * lx + 0.15 * sm + 0.1 * Math.min(1, base) + boost + langBoost, 0, 1) : U.clamp(base * 0.9 + langBoost, 0, 1);
    scored.push({ c, lex: lx, sem: sm, rrf, cov, rel, base });
  }
  scored.sort((a, b) => b.rel - a.rel);
  trace.steps.push({ step: 'retrieve', lexical: lexScore.size, semantic: semScore.size, fused: scored.length });

  // dedupe by document (keep best chunk), then top-k
  let out = [];
  const seen = new Set();
  for (const s of scored) {
    if (o.dedupe && seen.has(s.c.doc_id)) continue;
    seen.add(s.c.doc_id);
    out.push(s);
    if (out.length >= k * 2) break;
  }
  const thr = threshold ?? 0.34;
  // Unknown-entity guard: many query terms that exist nowhere in the knowledge base => cannot be grounded.
  const unkShareAll = qWords.length ? unknown.length / qWords.length : 0;
  const ungrounded = unknown.length >= 2 && unkShareAll >= 0.3;
  trace.ungrounded = ungrounded;
  const valid = ungrounded ? [] : out.filter((s) => s.rel >= thr && s.cov >= 0.3);
  trace.steps.push({ step: 'validate', threshold: thr, passed: valid.length, dropped: out.length - valid.length });
  let hits = (o.abstain ? valid : out).slice(0, k).map((s, i) => ({
    rank: i + 1, doc_id: s.c.doc_id, chunk_id: s.c.id, collection: s.c.collection_id, title: s.c.title, title_en: s.c.title_en,
    org: s.c.org, url: s.c.url, published_at: s.c.published_at, country: s.c.country, doc_type: s.c.doc_type, access_scope: s.c.access_scope,
    lang: s.c.lang, text: s.c.text, relevance: U.round(s.rel, 3), lexical: U.round(s.lex, 3), semantic: U.round(s.sem, 3), rrf: U.round(s.rrf, 4), coverage: U.round(s.cov, 3),
  }));
  if (o.reorder && hits.length > 2) { // "lost in the middle" mitigation: best first, second-best last (context order only; display order unchanged)
    const order = [hits[0], ...hits.slice(2), hits[1]].map((h) => h.chunk_id);
    hits = hits.map((h) => ({ ...h, context_pos: order.indexOf(h.chunk_id) + 1 }));
  }
  trace.latency_ms = Date.now() - t0;
  trace.top_k = k;
  trace.abstain = !hits.length;
  trace.unknown_tokens = unknown;
  return { hits, trace, abstained: !hits.length };
}

// Content words of a user question that exist nowhere in the knowledge base (used for ungrounded-question detection)
function unknownTerms(text) {
  const C = idx();
  const ws = [...new Set(NLP.words(text))];
  const unknown = ws.filter((w) => !(C.vocab.has(w) || NLP.conceptsOf(w).size > 0 || [...C.vocab].some((v) => v.length >= 3 && w.length >= 3 && (v.includes(w) || w.includes(v)))));
  return { unknown, total: ws.length, share: ws.length ? unknown.length / ws.length : 0 };
}
const collectionsList = () => q.all('SELECT * FROM collections ORDER BY id');
const stats = () => {
  const cols = collectionsList();
  return cols.map((c) => ({ ...c, docs: q.count('documents', 'WHERE collection_id=?', c.id), chunks: q.count('chunks', 'WHERE collection_id=?', c.id), flagged: q.count('documents', "WHERE collection_id=? AND status='QUARANTINED'", c.id) }));
};

module.exports = { unknownTerms, RAG_OPTIONS, getOptions, setOptions, chunkText, indexDocument, addDocument, reindexCollection, invalidate, search, collectionsList, stats };
