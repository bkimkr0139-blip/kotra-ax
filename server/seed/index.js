'use strict';
// Deterministic demo seed. Usage: node server/seed/index.js --reset
const U = require('../util');
const DB = require('../db');
const { q, nextId, setSetting } = DB;
const { audit } = require('../gov');
const RAG = require('../ai/rag');
const REG = require('../ai/registry');
const { COUNTRIES } = require('./catalog');
const M = require('./content_market');
const X = require('./content_misc');
const P = require('./people');
const EVAL = require('./eval_cases');
const SC = require('../domain/scoring');
const COV = require('./coverage');
const fs = require('node:fs');
const path = require('node:path');
const MDM = require('../domain/mdm');
const STT = require('../domain/stt_samples');
const { summarize } = require('../domain/summarize');

const T = (d) => U.addDays(U.today(), d);
const J = JSON.stringify;
const SYS = { user: null, ip: 'seed' };

function seedAll({ reset = true } = {}) {
  U.setClock(process.env.DEMO_CLOCK || '2026-11-09');
  if (reset) DB.resetAll();
  const now = U.iso();
  const stats = {};
  setSetting('demo_clock', process.env.DEMO_CLOCK || '2026-11-09');
  setSetting('fallback_mode', 'AUTO');
  setSetting('rag_options', {});
  setSetting('demo_mode', process.env.DEMO_MODE !== 'false');

  q.tx(() => {
    // ---- countries
    COUNTRIES.forEach((c) => q.insert('countries', { code: c.code, name_ko: c.ko, name_en: c.en, region_ko: c.region_ko, region_en: c.region_en, summary_ko: `${c.ko}은(는) ${c.region_ko} 권역의 주요 교역 대상국이다. 인구 약 ${c.pop}백만 명, GDP 약 ${c.gdp}십억 달러(시연용 지표).`, summary_en: `${c.en} is a key trading partner in ${c.region_en}. Population about ${c.pop} million, GDP about USD ${c.gdp} billion (demo indicators).`, population_m: c.pop, gdp_usd_b: c.gdp, growth: c.growth, office_ko: c.office_ko, office_en: c.office_en, tz: `UTC${c.tz >= 0 ? '+' : '-'}${Math.abs(c.tz / 60)}`, tz_offset: c.tz, source_type: 'demo', is_synthetic: 1 }));
    q.insert('countries', { code: 'KR', name_ko: '대한민국', name_en: 'Korea', region_ko: '동북아', region_en: 'Northeast Asia', summary_ko: '투자 유치 대상국.', summary_en: 'Investment destination.', population_m: 52, gdp_usd_b: 1700, growth: 2.2, office_ko: '본사', office_en: 'HQ', tz: 'UTC+9', tz_offset: 540, source_type: 'demo', is_synthetic: 1 });

    // ---- companies
    P.COMPANIES.forEach((c, i) => q.insert('companies', {
      id: c[0], name: c[1], name_en: c[2], industry: c[3], industry_en: c[4], product_keys: J(c[5]), product: c[6], product_en: c[7], hs_code: c[8], size: c[9], employees: c[10], export_stage: c[11], export_experience: c[12],
      target_markets: J(c[13]), region: c[14], website: i % 5 === 4 ? null : `https://www.${c[2].toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`, biz_no: `${100 + i}-${81 + i}-${10000 + i * 37}`, readiness: 0, consent: 1, hashtags: J(c[15]), description: c[16], description_en: c[17],
      source_type: 'demo', is_synthetic: 1, created_at: now, updated_at: now,
    }));
    // ---- users
    const pw = U.hashPassword(process.env.DEMO_PASSWORD || 'Kotra!2026demo');
    P.buildUsers().forEach((u) => q.insert('users', { locale: 'ko', active: 1, pw_hash: pw, created_at: now, company_id: null, buyer_id: null, office: null, persona: null, ...u }));

    // ---- export projects (Case Memory)
    const journeyFor = (i) => { const j = {}; for (let s = 1; s <= 7; s++) j[s] = 'NOT_STARTED'; const done = i % 5; for (let s = 1; s <= done; s++) j[s] = 'DONE'; if (done < 7) j[done + 1] = 'IN_PROGRESS'; return j; };
    P.COMPANIES.forEach((c, i) => {
      const country = c[13][0];
      const journey = i === 0 ? { 1: 'DONE', 2: 'IN_PROGRESS', 3: 'NOT_STARTED', 4: 'NOT_STARTED', 5: 'NOT_STARTED', 6: 'NOT_STARTED', 7: 'NOT_STARTED' } : journeyFor(i);
      q.insert('export_projects', {
        id: `PRJ-${String(i + 1).padStart(3, '0')}`, company_id: c[0], name: i === 0 ? 'Vietnam Beauty 2027' : `${P.CBY[country].en} ${c[7].split(' ')[0]} ${2027}`, name_en: i === 0 ? 'Vietnam Beauty 2027' : `${P.CBY[country].en} ${c[7].split(' ')[0]} 2027`,
        country, product: c[5][0], goal: i === 0 ? '6개월 내 베트남 첫 바이어 상담' : `${P.CBY[country].ko} 신규 거래처 확보`, status: 'ACTIVE', journey: J(journey),
        memory: J({ session: [], case: i === 0 ? { 목표국가: '베트남', 품목: '기능성화장품', 진행: ['목표 설정 완료'], 메모: [] } : { 목표국가: P.CBY[country].ko, 품목: c[6] }, saved_buyers: [], notes: [] }), source_type: 'demo', is_synthetic: 1, created_at: now, updated_at: now,
      });
    });

    // ---- market content, regulations, stats
    [...M.HERO_MARKET, ...M.genMarket()].forEach((m, i) => q.insert('market_content', { id: m[0], type: m[1], country: m[2], industry: m[3], title_ko: m[4], title_en: m[5], body_ko: m[6], body_en: m[7], source_name: m[8], source_url: m[9], published_at: T(m[10]), tags: J(m[11]), status: 'PUBLISHED', views: 40 + (i * 37) % 900, source_type: i < 13 ? 'demo-hero' : 'demo-generated', is_synthetic: 1, created_at: now, updated_at: now }));
    [...M.HERO_REG, ...M.genRegs()].forEach((r) => q.insert('regulations', { id: r[0], country: r[1], hs_prefix: r[2], industry: r[3], title_ko: r[4], title_en: r[5], body_ko: r[6], body_en: r[7], requirements: J(r[8]), agency: r[9], source_url: r[10], updated_at: T(r[12]), risk: r[11], source_type: 'demo', is_synthetic: 1, created_at: now }));
    M.genStats().forEach((s) => q.insert('trade_stats', s));

    // ---- programs
    X.PROGRAMS.forEach((p) => {
      const [id, type, tk, te, sk, se, groups, inds, cs, stages, ap, ev, mode, dept, bk, be, docs, evId] = p;
      q.insert('programs', {
        id, title_ko: tk, title_en: te, summary_ko: sk, summary_en: se, type, target_ko: groups.map((g) => SC.GROUP_LABEL[g][0]).join('·') + ' 기업', target_en: groups.map((g) => SC.GROUP_LABEL[g][1]).join(', '),
        industries: J(inds), countries: J(cs), stages: J(stages), customer_groups: J(groups), sizes: J(['소기업', '중기업', '중견기업']), apply_start: T(ap[0]), apply_end: T(ap[1]), event_start: ev ? T(ev[0]) : null, event_end: ev ? T(ev[1]) : null,
        dept_ko: dept, dept_en: dept, mode, region: mode === 'OFFLINE' ? '서울' : '온라인', status: 'OPEN', eligibility: J({ groups, industries: inds, countries: cs }), required_docs: J(docs), benefit_ko: bk, benefit_en: be, url: X.KOTRA, event_id: evId, source_type: 'demo', is_synthetic: 1, created_at: now, updated_at: now,
      });
    });
    X.FAQS.forEach((f) => q.insert('faqs', { id: f[0], category: f[1], q_ko: f[2], q_en: f[3], a_ko: f[4], a_en: f[5], views: 20 + f[0].slice(-3) * 11, source_type: 'demo', is_synthetic: 1 }));
    X.NOTICES.forEach((n) => q.insert('notices', { id: n[0], kind: n[1], title_ko: n[2], title_en: n[3], body_ko: n[4], body_en: n[5], published_at: T(n[6]), pinned: n[7], source_type: 'demo', is_synthetic: 1 }));
    X.BANNERS.forEach((b) => q.insert('cms_banners', { id: b[0], site: b[1], title_ko: b[2], title_en: b[3], body_ko: b[4], body_en: b[5], link: b[6], active: 1, sort: b[7], groups: J([]) }));

    // ---- registry
    REG.COLLECTIONS.forEach((c) => q.insert('collections', { id: c[0], name_ko: c[1], name_en: c[2], description_ko: c[3], description_en: c[4], access_scope: c[5], embedding_model: 'concept-vector-local', top_k: 6, threshold: 0.34, reranker: 'heuristic-rerank-v1', enabled: 1, last_indexed: now }));
    REG.AGENTS.forEach((a) => q.insert('agent_defs', { id: a[0], name_ko: a[1], name_en: a[2], description_ko: a[3], description_en: a[4], collections: J(a[5]), tools: J(a[6]), prompt_id: 'PRM-' + a[0], status: 'ACTIVE', rfp: J(a[7]) }));
    REG.TOOLS.forEach((t) => q.insert('tool_defs', { id: t[0], name_ko: t[1], name_en: t[2], risk_level: t[3], requires_approval: t[4], input_schema: J({ type: 'object' }), output_schema: J({ type: 'object' }), timeout_ms: t[8], enabled: t[3] === 'BLOCKED' ? 0 : 1, integration: t[5], roles: J(t[6]), rate_limit: t[7] }));
    REG.PROMPTS.forEach((p) => q.insert('prompt_versions', { id: p.id + '-v1.0', agent_id: p.agent_id, version: p.version, body: p.body, owner: p.owner, status: p.status, last_test: null, test_score: null, created_at: now }));
    REG.MODELS.forEach((m, i) => q.insert('model_configs', { id: m[0], name: m[1], provider: m[2], purpose: m[3], status: m[4], context: null, latency_ms: null, quality: null, cost_per_1k: null, version: '1.0', traits: J(m[7]), is_default: i === 0 ? 1 : 0, mode: m[6] }));
    EVAL.forEach((e, i) => q.insert('eval_cases', { id: 'EV-Q' + String(i + 1).padStart(3, '0'), question: e.question, lang: e.lang, category: e.category, expected_behavior: e.expected_behavior, expected_evidence: J(e.expected_evidence), expected_keywords: J(e.expected_keywords), expected_tool: e.expected_tool, last_result: null }));

    // ---- buyers
    const buyers = P.buildBuyers();
    buyers.forEach((b) => q.insert('buyers', { ...b, products: J(b.products), hs_codes: J(b.hs_codes), channels: J(b.channels), conditions: J(b.conditions), hashtags: J(b.hashtags), source_type: 'synthetic', is_synthetic: 1, created_at: now, updated_at: now }));

    // ---- events, participants, slots, interpreters
    const evRows = P.EVENTS.map((e) => ({ id: e[0], title_ko: e[1], title_en: e[2], type: e[3], country: e[4], city: e[5], venue: e[6], tz_offset: e[7], start_date: T(e[8]), end_date: T(e[8] + e[9] - 1), apply_start: T(e[10]), apply_end: T(e[11]), groups: J(e[12]), halls: J(e[13]), status: e[14], description_ko: e[15], description_en: e[16], slot_minutes: 30, day_start: '09:00', day_end: '17:00', source_type: 'demo', is_synthetic: 1, created_at: now }));
    evRows.forEach((e) => q.insert('events', e));
    const part = {
      'EV-001': { c: ['CMP-001', 'CMP-002', 'CMP-008', 'CMP-009', 'CMP-010', 'CMP-015'], b: ['B-001', 'B-002', 'B-003', 'B-004', 'B-005', 'B-006', 'B-007', 'B-020', 'B-021', 'B-025', 'B-030', 'B-033', 'B-040'] },
      'EV-007': { c: ['CMP-001', 'CMP-002', 'CMP-010'], b: ['B-001', 'B-002', 'B-003', 'B-004', 'B-006', 'B-007'] },
      'EV-006': { c: ['CMP-002', 'CMP-003', 'CMP-004', 'CMP-005', 'CMP-007', 'CMP-010', 'CMP-012', 'CMP-014'], b: buyers.slice(10, 34).map((b) => b.id) },
      'EV-004': { c: ['CMP-002', 'CMP-003', 'CMP-009', 'CMP-013'], b: buyers.filter((b) => b.country === 'JP').map((b) => b.id).concat(['B-020']).slice(0, 6) },
      'EV-002': { c: ['CMP-003', 'CMP-010', 'CMP-013'], b: ['B-008', 'B-011', 'B-012'] },
      'EV-003': { c: ['CMP-004'], b: ['B-009', 'B-014'] },
      'EV-005': { c: ['CMP-005'], b: ['B-015', 'B-016'] },
      'EV-008': { c: ['CMP-001'], b: ['B-001', 'B-004'] },
    };
    const slotsByEvent = {};
    for (const e of evRows) {
      slotsByEvent[e.id] = SC.genSlots(e);
      const pp = part[e.id];
      const apply = (kind, ref, i) => {
        const pid = nextId('EP', 5);
        q.insert('event_participants', { id: pid, event_id: e.id, kind, ref_id: ref, status: 'APPROVED', grp: JSON.parse(e.groups)[i % JSON.parse(e.groups).length], approved_by: 'U-028', created_at: now });
        // availability
        slotsByEvent[e.id].forEach((s, si) => {
          const heroOverlap = (ref === 'CMP-001' || ref === 'B-001') && s.endsWith('T09:00') || (ref === 'CMP-001' || ref === 'B-001') && si < 10;
          const avail = heroOverlap ? 1 : (P.R() < (kind === 'COMPANY' ? 0.7 : 0.6) ? 1 : 0);
          q.insert('availability_slots', { id: `${e.id}|${kind[0]}|${ref}|${s}`, event_id: e.id, kind, ref_id: ref, slot_start: s, available: avail });
        });
      };
      pp.c.forEach((ref, i) => apply('COMPANY', ref, i));
      pp.b.forEach((ref, i) => apply('BUYER', ref, i));
      // a pending buyer application (needs admin approval)
      if (e.id === 'EV-001') q.insert('event_participants', { id: nextId('EP', 5), event_id: e.id, kind: 'BUYER', ref_id: 'B-050', status: 'PENDING', grp: 'Skincare', approved_by: null, created_at: now });
    }
    [['I-001', '응우옌 티 마이', ['vi', 'ko'], 'EV-001'], ['I-002', '다나카 유키', ['ja', 'ko'], 'EV-001'], ['I-003', 'Sarah Lim', ['en', 'ko'], 'EV-001'], ['I-004', '쩐 반 둑', ['vi', 'ko'], 'EV-007']].forEach(([id, name, langs, ev]) => q.insert('interpreters', { id, name, languages: J(langs), event_id: ev, attendance: J({}), temp_login: 'tmp-' + id.toLowerCase(), is_synthetic: 1 }));

    // ---- match requests (50)
    const compById = Object.fromEntries(P.COMPANIES.map((c) => [c[0], { id: c[0], hs_code: c[8], product_keys: c[5], target_markets: c[13] }]));
    const buyerById = Object.fromEntries(buyers.map((b) => [b.id, b]));
    const mk = (ev, cid, bid, initiator, status, slotIdx, extra = {}) => {
      const sc = SC.scoreBuyer(compById[cid], buyerById[bid], { availabilityOverlap: 0.7 });
      const id = nextId('MR', 4);
      const slots = slotsByEvent[ev];
      q.insert('match_requests', { id, event_id: ev, company_id: cid, buyer_id: bid, initiator, status, score: sc.total, score_detail: J(sc.parts), slot_start: slotIdx != null ? slots[slotIdx % slots.length] : null, hall: slotIdx != null ? 'A Hall' : null, interpreter_id: extra.interp || null, message: extra.message || null, reject_reason: extra.reject || null, journal: extra.journal ? J(extra.journal) : null, source_type: 'demo', is_synthetic: 1, created_at: now, updated_at: now });
      if (['COMPLETED', 'FOLLOW_UP'].includes(status)) {
        q.insert('satisfaction', { id: nextId('SAT', 4), match_id: id, by_kind: 'COMPANY', score: 3 + (q.count('satisfaction') % 3), comment: '추가 협의 의사 있음', created_at: now });
        q.insert('satisfaction', { id: nextId('SAT', 4), match_id: id, by_kind: 'BUYER', score: 3 + ((q.count('satisfaction') + 1) % 3), comment: 'Follow-up requested', created_at: now });
      }
      return id;
    };
    // EV-006 completed (22)
    const p6 = part['EV-006'];
    for (let i = 0; i < 22; i++) {
      const cid = p6.c[i % p6.c.length], bid = p6.b[(i * 3) % p6.b.length];
      mk('EV-006', cid, bid, 'COMPANY', i % 6 === 0 ? 'FOLLOW_UP' : 'COMPLETED', i * 2 + 1, { interp: 'I-001', journal: { summary: '제품 소개 및 가격 협의 진행. 샘플 요청 후 2주 내 재논의.', next: '샘플 발송' } });
    }
    // EV-001 (14) including hero relations
    mk('EV-001', 'CMP-001', 'B-004', 'COMPANY', 'SCHEDULED', 2, { interp: 'I-001', message: '프리미엄 라인 소개 희망' });
    mk('EV-001', 'CMP-001', 'B-002', 'BUYER', 'REQUESTED', null, { message: 'We are interested in your functional serum line.' });
    mk('EV-001', 'CMP-001', 'B-003', 'COMPANY', 'REJECTED', null, { reject: '당시 일정 중복으로 어렵습니다.' });
    mk('EV-001', 'CMP-002', 'B-001', 'COMPANY', 'SCHEDULED', 5, { interp: 'I-001' });
    mk('EV-001', 'CMP-002', 'B-005', 'BUYER', 'ACCEPTED', null);
    mk('EV-001', 'CMP-002', 'B-020', 'COMPANY', 'REQUESTED', null);
    mk('EV-001', 'CMP-010', 'B-006', 'COMPANY', 'REQUESTED', null);
    mk('EV-001', 'CMP-010', 'B-025', 'BUYER', 'ACCEPTED', null);
    mk('EV-001', 'CMP-008', 'B-021', 'COMPANY', 'SCHEDULED', 9, { interp: 'I-003' });
    mk('EV-001', 'CMP-009', 'B-030', 'BUYER', 'REQUESTED', null);
    mk('EV-001', 'CMP-015', 'B-007', 'COMPANY', 'REJECTED', null, { reject: '취급 품목이 다릅니다.' });
    mk('EV-001', 'CMP-009', 'B-033', 'COMPANY', 'REQUESTED', null);
    mk('EV-001', 'CMP-008', 'B-040', 'BUYER', 'REQUESTED', null);
    mk('EV-001', 'CMP-015', 'B-004', 'COMPANY', 'SCHEDULED', 12, { interp: 'I-001' });
    // EV-007 (6)
    ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'REQUESTED', 'REJECTED', 'SCHEDULED'].forEach((st, i) => mk('EV-007', ['CMP-002', 'CMP-001', 'CMP-010'][i % 3 === 0 ? 0 : i % 3], ['B-001', 'B-002', 'B-003', 'B-004', 'B-006', 'B-007'][i], i % 2 ? 'BUYER' : 'COMPANY', st, st === 'SCHEDULED' ? i + 1 : null, st === 'REJECTED' ? { reject: 'Schedule conflict' } : {}));
    // EV-004 (4) + EV-002/003 (2)
    ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'REQUESTED'].forEach((st, i) => mk('EV-004', ['CMP-002', 'CMP-003', 'CMP-009', 'CMP-013'][i], part['EV-004'].b[i], 'COMPANY', st, st === 'SCHEDULED' ? 3 : null));
    mk('EV-002', 'CMP-003', 'B-008', 'COMPANY', 'REQUESTED', null);
    mk('EV-003', 'CMP-004', 'B-009', 'COMPANY', 'REQUESTED', null);
    mk('EV-005', 'CMP-005', 'B-015', 'COMPANY', 'REQUESTED', null);
    mk('EV-008', 'CMP-001', 'B-004', 'COMPANY', 'REQUESTED', null);
    // MDM-seeded applications from other companies
    const appRows = [['PG-001', 'CMP-002', 'COMPLETED'], ['PG-003', 'CMP-006', 'SUBMITTED_DEMO'], ['PG-004', 'CMP-008', 'DRAFT'], ['PG-007', 'CMP-002', 'READY_FOR_REVIEW'], ['PG-009', 'CMP-009', 'COMPLETED'], ['PG-015', 'CMP-013', 'SUBMITTED_DEMO']];
    appRows.forEach(([pg, cid, st], i) => q.insert('applications', { id: nextId('APP', 4), program_id: pg, company_id: cid, user_id: q.get('SELECT id FROM users WHERE company_id=?', cid).id, status: st, form: J({ company: cid, note: '시연 데이터' }), checklist: J([]), ai_draft: 1, approval_id: null, submitted_at: ['SUBMITTED_DEMO', 'COMPLETED'].includes(st) ? now : null, source_type: 'demo', is_synthetic: 1, created_at: now, updated_at: now }));
  });

  // ---- RAG documents (outside tx: indexing invalidates cache; fine)
  q.tx(() => {
    const add = (d) => RAG.addDocument({ title_en: null, text_en: null, org: null, url: null, published_at: T(-30), updated_at: T(-10), country: null, hs: null, doc_type: 'doc', access_scope: 'PUBLIC', uploaded_by: 'system', page_ref: null, ...d });
    q.all('SELECT * FROM market_content').forEach((m) => add({ id: 'D-' + m.id, collection_id: 'MARKET', title: m.title_ko, title_en: m.title_en, text: m.body_ko, text_en: m.body_en, org: m.source_name, url: m.source_url, published_at: m.published_at, country: m.country, hs: (P.PBY[m.industry] || {}).hs || null, doc_type: m.type, page_ref: 'p.1' }));
    q.all('SELECT * FROM regulations').forEach((r) => {
      const req = JSON.parse(r.requirements);
      add({ id: 'D-' + r.id, collection_id: 'REGULATION', title: r.title_ko, title_en: r.title_en, text: r.body_ko + ' 필수 절차: ' + req.map((x) => x.ko).join('; ') + '.', text_en: r.body_en + ' Required steps: ' + req.map((x) => x.en).join('; ') + '.', org: r.agency, url: r.source_url, published_at: r.updated_at, country: r.country, hs: r.hs_prefix, doc_type: 'regulation', page_ref: 'p.1' });
    });
    q.all('SELECT * FROM programs').forEach((p) => add({
      id: 'D-' + p.id, collection_id: p.type === 'MEETING' || p.type === 'EXHIBITION' ? 'EXHIBITION' : 'PROGRAM', title: p.title_ko, title_en: p.title_en,
      text: `${p.summary_ko} 대상: ${p.target_ko}. 신청기간: ${p.apply_start} ~ ${p.apply_end}. ${p.event_start ? `개최: ${p.event_start} ~ ${p.event_end}. ` : ''}주관: ${p.dept_ko}. 지원내용: ${p.benefit_ko}. 제출서류: ${JSON.parse(p.required_docs).join(', ')}.`,
      text_en: `${p.summary_en} Target: ${p.target_en}. Application period: ${p.apply_start} to ${p.apply_end}. ${p.event_start ? `Event: ${p.event_start} to ${p.event_end}. ` : ''}Organiser: ${p.dept_en}. Benefit: ${p.benefit_en}. Documents: ${JSON.parse(p.required_docs).join(', ')}.`,
      org: 'KOTRA ' + p.dept_ko, url: `#/programs/${p.id}`, published_at: p.apply_start, country: JSON.parse(p.countries).length === 1 ? JSON.parse(p.countries)[0] : null, doc_type: 'program', page_ref: 'program-detail',
    }));
    // Programs that are meetings also need to be findable in PROGRAM collection → duplicate doc in PROGRAM for MEETING/EXHIBITION
    q.all("SELECT * FROM programs WHERE type IN ('MEETING','EXHIBITION')").forEach((p) => add({ id: 'D-' + p.id + '-P', collection_id: 'PROGRAM', title: p.title_ko, title_en: p.title_en, text: `${p.summary_ko} 신청기간: ${p.apply_start} ~ ${p.apply_end}. 대상: ${p.target_ko}.`, text_en: `${p.summary_en} Application period: ${p.apply_start} to ${p.apply_end}. Target: ${p.target_en}.`, org: 'KOTRA ' + p.dept_ko, url: `#/programs/${p.id}`, published_at: p.apply_start, doc_type: 'program' }));
    q.all('SELECT * FROM faqs').forEach((f) => add({ id: 'D-' + f.id, collection_id: 'CONSULTATION', title: f.q_ko, title_en: f.q_en, text: f.a_ko, text_en: f.a_en, org: 'KOTRA 고객센터', url: '#/consult/faq', doc_type: 'faq' }));
    q.all('SELECT * FROM buyers').forEach((b) => add({
      id: 'D-' + b.id, collection_id: 'BUYER', title: `${b.name} (${P.CBY[b.country].ko} ${b.type})`, title_en: `${b.name} (${P.CBY[b.country].en} ${b.type})`,
      text: `${b.description} 관심품목: ${JSON.parse(b.products).map((k) => P.PBY[k].ko).join(', ')}. 유통채널: ${JSON.parse(b.channels).join(', ')}. 신뢰도 ${b.trust}. (시연용 합성 바이어)`,
      text_en: `${b.description_en} Interest: ${JSON.parse(b.products).map((k) => P.PBY[k].en).join(', ')}. Channels: ${JSON.parse(b.channels).join(', ')}. Trust ${b.trust}. (synthetic demo buyer)`, org: 'KOTRA 바이어 DB(합성)', url: `#/buyers/${b.id}`, country: b.country, doc_type: 'buyer', access_scope: 'MEMBER',
    }));
    q.all('SELECT * FROM events').forEach((e) => add({ id: 'D-' + e.id, collection_id: 'EXHIBITION', title: e.title_ko, title_en: e.title_en, text: `${e.description_ko} 일시: ${e.start_date} ~ ${e.end_date}. 장소: ${e.city} ${e.venue}. 신청기간: ${e.apply_start} ~ ${e.apply_end}.`, text_en: `${e.description_en} Dates: ${e.start_date} to ${e.end_date}. Venue: ${e.city} ${e.venue}. Application: ${e.apply_start} to ${e.apply_end}.`, org: 'KOTRA 해외전시팀', url: `#/events/${e.id}`, country: e.country, doc_type: 'event' }));
    X.DOCS.forEach((d) => add({ id: d[0], collection_id: d[1], title: d[2], title_en: d[3], text: d[4], text_en: d[5], org: d[6], url: d[7], country: d[8], hs: d[9], doc_type: d[10], access_scope: d[11] }));
  });
  stats.docs = q.count('documents'); stats.chunks = q.count('chunks');

  // ---- consultations / research / data platform / misc
  q.tx(() => {
    const consultants = ['U-021', 'U-022', 'U-023'];
    const channels = ['ONLINE', 'PHONE', 'MOBILE', 'VISIT', 'ONLINE', 'PHONE'];
    const states = ['CLOSED', 'IN_PROGRESS', 'ASSIGNED', 'RESOLVED', 'AI_CLASSIFIED', 'OPEN', 'IN_PROGRESS', 'CLOSED'];
    const mkConsult = (i, cid, topicIdx, channel, status, extra = {}) => {
      const t = P.TOPICS[topicIdx % P.TOPICS.length];
      const id = nextId('CS', 4);
      const comp = q.get('SELECT * FROM companies WHERE id=?', cid);
      const uid = cid ? q.get('SELECT id FROM users WHERE company_id=?', cid).id : null;
      q.insert('consultations', { id, channel, company_id: cid, user_id: uid, topic: t[0], category: t[0], title: extra.title || t[1], body: extra.body || t[3], status, priority: extra.priority || (i % 7 === 0 ? 'HIGH' : 'NORMAL'), assigned_to: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status) ? consultants[i % 3] : null, ai_class: J({ category: t[0], confidence: 0.82, suggested_team: t[0] === '인증·규제' ? '인증지원팀 / 하노이 무역관' : '수출상담센터' }), extra_care: i % 11 === 0 ? 1 : 0, callback_at: null, source_type: 'demo', is_synthetic: 1, created_at: T(-30 + i), updated_at: T(-28 + i) });
      q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: id, sender: 'customer', sender_id: uid, speaker: 'customer', body: extra.body || t[3], at_sec: null, created_at: T(-30 + i) });
      if (['IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: id, sender: 'consultant', sender_id: consultants[i % 3], speaker: 'agent', body: '문의 주셔서 감사합니다. 관련 요건과 지원사업을 확인하여 안내드립니다. 추가 자료가 필요하면 말씀해 주세요.', at_sec: null, created_at: T(-29 + i) });
      return id;
    };
    // hero consults for K-Beauty
    const c1 = mkConsult(1, 'CMP-001', 0, 'ONLINE', 'CLOSED', { title: '베트남 화장품 등록 절차 문의' });
    q.insert('consultation_summaries', { id: nextId('SUM', 4), consultation_id: c1, status: 'CONFIRMED', draft: J({ topic: '인증·규제', inquiry: '베트남 화장품 등록 절차 문의', answer: '제품 공고 및 현지 책임자 필요', keywords: ['베트남', '화장품', '공고'], actions: ['PG-007 안내'], handling: '상담원 직접 답변', followup: ['인증 컨설팅 안내'], transfer_needed: false, recommended_services: ['PG-007'] }), final: J({ topic: '인증·규제', inquiry: '베트남 화장품 등록 절차 문의', answer: '제품 공고 및 현지 책임자 필요', keywords: ['베트남', '화장품', '공고'], actions: ['PG-007 안내'], handling: '상담원 직접 답변', followup: ['인증 컨설팅 안내'], transfer_needed: false, recommended_services: ['PG-007'] }), confidence: 0.86, source: 'ai+human', confirmed_by: 'U-021', created_at: now, updated_at: now });
    mkConsult(2, 'CMP-001', 1, 'ONLINE', 'IN_PROGRESS', { title: '바이어 발굴 지원 문의' });
    // phone consult with transcript (for review demo)
    const phone = mkConsult(3, 'CMP-002', 3, 'PHONE', 'IN_PROGRESS', { title: '샘플 발송 통관 문의(전화)', body: '전화 상담 — 녹취 요약 검토 필요' });
    STT['sample_buyer_followup.wav'].lines.forEach((l) => q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: phone, sender: l.speaker === 'agent' ? 'consultant' : 'customer', sender_id: null, speaker: l.speaker, body: U.maskPII(l.text), at_sec: l.at, created_at: now }));
    const sm = summarize(STT['sample_buyer_followup.wav'].lines);
    q.insert('consultation_summaries', { id: nextId('SUM', 4), consultation_id: phone, status: 'DRAFT', draft: J(sm), final: null, confidence: sm.confidence, source: 'ai', confirmed_by: null, created_at: now, updated_at: now });
    for (let i = 4; i <= 27; i++) {
      const cid = P.COMPANIES[(i * 5) % 15][0];
      mkConsult(i, cid, i, channels[i % 6], states[i % 8]);
    }
    // invest / ombudsman inquiries
    const inv = [['INVEST', '그린필드 투자 인센티브 문의', 'We plan a greenfield battery-materials plant in Korea. What incentives are available?', 'OPEN'], ['OMBUDSMAN', '외투기업 인허가 지연 고충', 'Our factory permit has been delayed for months. Please help.', 'IN_PROGRESS'], ['INVEST', 'R&D센터 입지 추천 요청', 'Looking for R&D centre locations near semiconductor clusters.', 'ASSIGNED']];
    inv.forEach(([ch, title, body, st], i) => { const id = nextId('CS', 4); q.insert('consultations', { id, channel: ch, company_id: null, user_id: null, topic: ch === 'OMBUDSMAN' ? '고충' : '투자', category: ch, title, body, status: st, priority: 'NORMAL', assigned_to: st === 'OPEN' ? null : consultants[i], ai_class: J({ category: ch, confidence: 0.8 }), extra_care: 0, callback_at: null, source_type: 'demo', is_synthetic: 1, created_at: T(-6 - i), updated_at: T(-5 - i) }); q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: id, sender: 'customer', sender_id: null, speaker: 'customer', body, at_sec: null, created_at: T(-6 - i) }); });

    // ---- research (20)
    const officeUsers = { VN: 'U-024', US: 'U-025', JP: 'U-026', AE: 'U-027' };
    P.RESEARCH.forEach((r, i) => {
      const [kind, title, titleEn, cc, office, status] = r;
      const idx = ['DRAFT', 'APPROVAL_REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'EVALUATED'].indexOf(status);
      const id = nextId('RS', 4);
      const hasReport = idx >= 4;
      const report = hasReport ? { summary: `${title} 조사 결과 요약. 현지 유통업체와 규제기관 인터뷰, 공개 자료를 종합했다.`, body: `${P.CBY[cc].ko} 현지 조사 결과, 주요 이슈는 인증·유통 구조·비용 세 가지이다. 현지 전문가 인터뷰에서는 초기 진입 시 소량 시범 판매와 현지 파트너 확보가 가장 효과적이라는 의견이 제시되었다. 세부 수치는 첨부 자료를 참고한다.`, sources: [{ title: '현지 유통업체 인터뷰', url: null }, { title: '현지 규제기관 공개자료', url: M.KOTRA }] } : null;
      q.insert('research_requests', {
        id, kind, title, title_en: titleEn, country: cc, office, requester_id: 'U-021', assignee_id: idx >= 2 ? (officeUsers[cc] || null) : null, status, due_date: T(-10 + i * 3), form: J({ purpose: '대고객 서비스 및 보고서 작성', items: ['시장 현황', '유통 구조', '규제·인증', '시사점'], format: 'KOTRA 표준 조사양식' }),
        opinion: idx >= 2 ? J({ note: '일정 및 조사 범위 확인 완료', at: now }) : null, report: report ? J(report) : null, supplement: status === 'REVISION_REQUESTED' ? J({ request: '수치 근거와 출처 보강 바랍니다.' }) : null,
        evaluation: status === 'EVALUATED' ? J({ score: 4, timeliness: 5, usefulness: 4, comment: '활용도 높음' }) : null, indexed_doc_id: null, source_type: 'demo', is_synthetic: 1, created_at: T(-40 + i), updated_at: T(-12 + i),
      });
      q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', 'research', id, null, status, 'U-021', 'seed', now);
      if (['COMPLETED', 'EVALUATED'].includes(status)) {
        const docId = 'D-' + id;
        RAG.addDocument({ id: docId, collection_id: 'MARKET', title: `[조사보고서] ${title}`, title_en: `[Research] ${titleEn}`, text: report.summary + ' ' + report.body, text_en: `Research summary: ${titleEn}. Interviews with local distributors and regulators indicate that issues concentrate on certification, distribution structure and cost; small pilot sales and securing a local partner are most effective for early entry.`, org: `KOTRA ${office} 무역관`, url: `#/admin/research/${id}`, published_at: T(-5), country: cc, doc_type: 'research', access_scope: 'PUBLIC', source_type: 'research-flywheel', is_synthetic: 1, status: 'ACTIVE', uploaded_by: 'system', updated_at: now });
        q.update('research_requests', id, { indexed_doc_id: docId });
      }
    });

    // ---- MDM / CRM
    const crm = [
      ['CRM', 'ABC Korea', 'user@abc.co.kr', '010-2000-1001', '211-81-10001', 1, 1], ['BUYKOREA', 'ABC KOREA LTD', 'user@abc.co.kr', '010-2000-1001', '211-81-10001', 1, 1],
      ['CRM', 'K-Beauty Labs', 'beauty@kbeautylabs.example', '010-1234-5678', '100-81-10000', 1, 1], ['BUYKOREA', 'K-BEAUTY LABS Co., Ltd.', 'beauty@kbeautylabs.example', '010-1234-5678', '100-81-10000', 1, 1],
      ['CRM', 'Seoul Skin Co.', 'cs@seoulskin.example', '010-3000-2002', '101-82-10037', 1, 1], ['BUYKOREA', 'Seoul Skin Co., Ltd', 'export@seoulskin.example', '010-3000-2999', '101-82-10037', 1, 1],
      ['CRM', 'HanFood Global', 'info@hanfood.example', '02-555-0101', '102-83-10074', 1, 1], ['BUYKOREA', 'HANFOOD GLOBAL INC', 'trade@hanfood.example', '02-555-0102', '102-83-10074', 1, 1],
      ['CRM', 'MediCore Korea', 'ceo@medicore.example', '010-4000-3003', '103-84-10111', 1, 1], ['BUYKOREA', 'Medi Core Korea', 'sales@medicore.example', '010-4000-3004', '999-99-99999', 1, 0],
      ['CRM', 'GreenCell Energy', 'ir@greencell.example', '02-777-0303', '104-85-10148', 1, 1], ['BUYKOREA', 'Green Cell Energy Co', 'ir@greencell.example', '02-777-0303', '104-85-10148', 1, 1],
      ['CRM', 'Daon Fashion', 'hello@daon.example', '010-5000-4004', '108-89-10259', 1, 1], ['CRM', 'AgroTech Korea', 'info@agrotech.example', '063-111-2222', '111-92-10370', 1, 1], ['CRM', 'Pixel Games Studio', 'biz@pixelgames.example', '031-222-3333', '105-86-10185', 1, 0],
      ['BUYKOREA', 'Nova Trading VN', 'nova@novatrading.example', '+84-90-111-2222', null, 0, 1], ['BUYKOREA', 'Orchid Imports TH', 'orchid@orchid.example', '+66-81-222-3333', null, 0, 1], ['BUYKOREA', 'Atlas Wholesale JP', 'atlas@atlas.example', '+81-90-333-4444', null, 0, 1],
      ['CRM', 'FitPet Co.', 'hello@fitpet.example', '031-444-5555', '112-93-10407', 1, 1], ['BUYKOREA', 'Fit Pet Company', 'hello@fitpet.example', '031-444-5555', '112-93-10407', 1, 1], ['CRM', 'EcoPack Solutions', 'eco@ecopack.example', '055-123-4567', '110-91-10333', 1, 1],
    ];
    crm.forEach((c, i) => q.insert('crm_customers', { id: `${c[0] === 'CRM' ? 'C' : 'K'}-${String(i + 1).padStart(4, '0')}`, system: c[0], name: c[1], email: c[2], mobile: c[3], biz_no: c[4], domestic: c[5], consent: c[6], last_activity: T(-(i * 9) % 700 - 5), activity: J(c[0] === 'CRM' ? { voc: 2 + i % 3, programs: 1 + i % 4 } : { inquiries: 3 + i % 5, contracts: i % 2 }), is_synthetic: 1 }));
    const rows = q.all('SELECT * FROM crm_customers');
    for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
      if (rows[a].system === rows[b].system) continue;
      const { score, reasons } = MDM.dupScore(rows[a], rows[b]);
      if (score >= 55) q.insert('mdm_candidates', { id: nextId('MDC', 4), a_id: rows[a].id, b_id: rows[b].id, score, reasons: J(reasons), status: 'PENDING', decided_by: null, decided_at: null, master_id: null });
    }
    // pre-existing golden record
    q.insert('mdm_masters', { id: nextId('MC', 5), domestic_foreign: 'DOMESTIC', company_id: 'CMP-005', name: 'GreenCell Energy', email: 'ir@greencell.example', mobile: '02-777-0303', source_systems: J(['CRM', 'BUYKOREA']), source_ids: J(['C-0011', 'K-0012']), consent_status: 'CONSENTED', merge_status: 'MERGED', quality_score: 96, merged_by: 'U-029', created_at: now });
    q.run("UPDATE mdm_candidates SET status='MERGED', decided_by='U-029', decided_at=?, master_id='MC-00001' WHERE a_id='C-0011' AND b_id='K-0012'", now);

    // ---- datasets / pipelines
    const DS = [
      ['DS-01', '고객', 'Customers', 'users', 'AI전략팀', 'CRM · BuyKOREA · 무역투자24', 'SENSITIVE', '일 1회', ['CRM Customer', 'MDM Customer', 'Customer Profile', 'AI Recommendation', 'MyKOTRA'], ['email', 'name'], [{ col: 'email', rule: 'not_null' }, { col: 'email', rule: 'unique' }, { col: 'name', rule: 'not_null' }]],
      ['DS-02', '기업', 'Companies', 'companies', 'AI전략팀', 'CRM · 무역투자24', 'MEMBER', '일 1회', ['CRM Company', 'MDM Company', 'Company Profile', 'Recommendation'], ['biz_no'], [{ col: 'name', rule: 'not_null' }, { col: 'hs_code', rule: 'not_null' }, { col: 'website', rule: 'not_null' }, { col: 'biz_no', rule: 'unique' }]],
      ['DS-03', '지원사업', 'Programs', 'programs', '수출지원본부', '사업관리시스템 · 무역투자24', 'PUBLIC', '일 1회', ['Program Mgmt', 'Program Catalog', 'RAG-PROGRAM', 'Assistant'], [], [{ col: 'title_ko', rule: 'not_null' }, { col: 'apply_end', rule: 'not_null' }]],
      ['DS-04', '콘텐츠', 'Content', 'market_content', '해외정보팀', '해외경제정보Dream · 무역자료실', 'PUBLIC', '시간별', ['Dream CMS', 'Market Content', 'RAG-MARKET', 'Assistant'], [], [{ col: 'title_ko', rule: 'not_null' }, { col: 'source_url', rule: 'not_null' }, { col: 'published_at', rule: 'not_null' }]],
      ['DS-05', '바이어', 'Buyers', 'buyers', '바이어발굴팀', 'BuyKOREA · TriBIG · CRM', 'MEMBER', '일 1회', ['BuyKOREA Buyer', 'Buyer Master', 'RAG-BUYER', 'Recommendation'], ['contact_email', 'contact_phone', 'contact_name'], [{ col: 'name', rule: 'not_null' }, { col: 'contact_email', rule: 'unique' }, { col: 'hs_codes', rule: 'not_null' }]],
      ['DS-06', '상담', 'Consultations', 'consultations', '수출상담센터', 'CRM · CTI/IVR · 온라인상담', 'SENSITIVE', '실시간', ['Call/Online', 'STT+Summary', 'Consultation Journal', 'Single View', 'Lakehouse'], ['body'], [{ col: 'title', rule: 'not_null' }, { col: 'topic', rule: 'not_null' }]],
      ['DS-07', '상담매칭', 'Matching', 'match_requests', '해외전시팀', '상담매칭시스템', 'MEMBER', '실시간', ['Event Request', 'Match', 'Schedule', 'Journal', 'Follow-up'], [], [{ col: 'event_id', rule: 'not_null' }, { col: 'buyer_id', rule: 'not_null' }]],
      ['DS-08', '해외정보', 'Overseas info', 'research_requests', '해외정보팀', '해외정보관리시스템', 'INTERNAL', '일 1회', ['KBC Research', 'Report', 'Evaluation', 'Lakehouse', 'RAG-MARKET'], [], [{ col: 'title', rule: 'not_null' }, { col: 'country', rule: 'not_null' }]],
      ['DS-09', 'AI 문서', 'AI documents', 'documents', 'AI전략팀', '통합 저장소 · 파일 업로드', 'PUBLIC', '이벤트', ['Source Doc', 'Parse/Chunk', 'Index', 'RAG'], [], [{ col: 'title', rule: 'not_null' }, { col: 'url', rule: 'not_null' }, { col: 'published_at', rule: 'not_null' }]],
      ['DS-10', 'Agent 실행로그', 'Agent run logs', 'agent_runs', 'AI전략팀', 'AI 수출비서', 'SENSITIVE', '실시간', ['User Query', 'Agent Run', 'Trace', 'LLMOps Dashboard'], ['question'], [{ col: 'question', rule: 'not_null' }, { col: 'status', rule: 'not_null' }]],
    ];
    DS.forEach((d, i) => {
      q.insert('datasets', { id: d[0], name_ko: d[1], name_en: d[2], tbl: d[3], owner: d[4], source: d[5], classification: d[6], update_cycle: d[7], last_sync: T(0) + 'T0' + (i % 8) + ':10:00Z', lineage: J(d[8]), pii_fields: J(d[9]), quality_rules: J(d[10]) });
      const external = /CRM|BuyKOREA|TriBIG|Dream|CTI/.test(d[5]);
      const failed = d[0] === 'DS-01';
      const warn = d[0] === 'DS-05';
      const stages = ['Source', 'Extract', 'Validate', 'Transform', 'Store', 'Index', 'Serving'].map((n, si) => ({ name: n, status: failed && si === 1 ? 'Failed' : failed && si > 1 ? 'Skipped' : warn && si === 2 ? 'Warning' : 'Success' }));
      q.insert('pipelines', { id: 'PL-' + d[0].slice(3), name: `${d[2]} pipeline`, dataset_id: d[0], schedule: d[7], status: failed ? 'Failed' : warn ? 'Warning' : 'Success', last_run: now, stages: J(stages), mode: external ? 'MOCK' : 'LIVE' });
    });
    q.insert('quality_issues', { id: nextId('DQ', 4), dataset_id: 'DS-01', severity: 'HIGH', rule: 'duplicate_candidates', detail: 'CRM·BuyKOREA 간 중복 후보 고객 건', status: 'OPEN', count: q.count('mdm_candidates', "WHERE status='PENDING'"), created_at: now, resolved_at: null });
    q.insert('quality_issues', { id: nextId('DQ', 4), dataset_id: 'DS-01', severity: 'HIGH', rule: 'source_timeout', detail: 'CRM 원천 연계 타임아웃 (Mock 장애 시연)', status: 'OPEN', count: 1, created_at: now, resolved_at: null });

    // ---- Playground apps (SFR-028 app store)
    [['PGA-01', 'Agent', '해외시장뉴스 요약 Agent', 'Market news summarizer', '긴 기사를 3줄로 요약합니다.', 'Summarises long articles into three lines.', '해외정보팀', '다음 기사를 핵심 3줄로 요약하고 출처를 표기하라: {{article}}', 412, 38], ['PGA-02', 'Agent', '수출 이메일 영문 번역 Agent', 'Export email translator', '한국어 이메일을 비즈니스 영어로 번역합니다.', 'Translates Korean emails to business English.', '수출마케팅팀', '다음 한국어 이메일을 정중한 비즈니스 영어로 번역하라: {{text}}', 289, 51], ['PGA-03', 'Workflow', '상담일지 요약 Workflow', 'Consultation journal workflow', '녹취 → STT → 요약 → 상담원 검토 파이프라인.', 'Recording → STT → summary → agent review pipeline.', '수출상담센터', 'STT → 마스킹 → 요약 → 검토', 176, 29], ['PGA-04', 'Chatflow', '규제 체크리스트 Chatflow', 'Regulation checklist chatflow', '국가·품목을 묻고 체크리스트를 생성합니다.', 'Asks country and item then builds a checklist.', '인증지원팀', '국가→품목→체크리스트', 233, 44], ['PGA-05', 'Workflow', '규제 변경 알림 Workflow', 'Regulation change alert workflow', '관심 국가 규제 변경 시 알림을 보냅니다.', 'Alerts on regulation changes in watched countries.', '해외정보팀', '크롤링 → 비교 → 알림', 98, 17], ['PGA-06', 'Agent', '바이어 제안서 초안 Agent', 'Buyer proposal drafter', '바이어 정보를 바탕으로 제안서 초안을 작성합니다.', 'Drafts proposals from buyer information.', '수출마케팅팀', '다음 바이어 정보를 바탕으로 제안서 초안을 작성하라: {{buyer}}', 205, 36]].forEach((a) => q.insert('playground_apps', { id: a[0], kind: a[1], title_ko: a[2], title_en: a[3], description_ko: a[4], description_en: a[5], dept: a[6], prompt: a[7], uses: a[8], likes: a[9], owner_id: null, forked_from: null, created_at: now }));

    // ---- RFP traceability (150 requirements parsed from the RFP hwpx)
    try {
      const reqs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seed', 'rfp_requirements.json'), 'utf8'));
      COV.buildCoverage(reqs).forEach((r) => q.insert('rfp_coverage', r));
    } catch (e) { console.warn('[seed] rfp coverage skipped:', e.message); }

    // ---- AX개발 / AXOS closed-loop demo records (RTM rebuilt from the coverage above)
    try { stats.axdev = require('./axdev').seedAxdev(); } catch (e) { console.error('[seed] axdev failed:', e); }
    try { if (require('../di/core').enabled()) stats.di = require('../di/seed').seedDi(); } catch (e) { console.error('[seed] data-integration failed:', e); }

    // ---- prompt library, notifications, approvals
    [['시장 진출 전략', '{{국가}}에 {{품목}}을 수출하려는데 시장성, 인증, 바이어, 지원사업을 한 번에 알려줘'], ['규제 체크리스트', '{{국가}} {{품목}} 수출 시 필요한 규제·인증 체크리스트를 만들어줘'], ['바이어 이메일', '{{국가}} 바이어에게 보낼 첫 접촉 이메일 초안을 영어로 써줘'], ['계약 점검', '독점 판매 계약서에서 불리한 조항을 점검해줘']].forEach(([t, b]) => q.insert('prompt_library', { id: nextId('PRL', 4), user_id: null, title: t, body: b, category: 'system', shared: 1, uses: 10, created_at: now }));
    const kb = 'U-001';
    q.insert('notifications', { id: nextId('NTF', 5), user_id: kb, type: 'program', title: '바이어 발굴 지원 마감 D-3', body: '귀사 목표시장(베트남)에 적합한 사업이 곧 마감됩니다.', link: '#/programs/PG-003', is_read: 0, created_at: now });
    q.insert('notifications', { id: nextId('NTF', 5), user_id: kb, type: 'match', title: 'Saigon Glow Distribution 상담 신청 도착', body: '2027 Global Beauty Partnering에서 상담 요청을 받았습니다.', link: '#/mykotra/matching', is_read: 0, created_at: now });
    q.insert('notifications', { id: nextId('NTF', 5), user_id: kb, type: 'ai', title: 'AI가 발견한 기회', body: '베트남 뷰티 이커머스 동향 콘텐츠가 새로 등록되었습니다.', link: '#/markets/MC-002', is_read: 1, created_at: now });
    const rsPending = q.get("SELECT id FROM research_requests WHERE status='APPROVAL_REQUESTED' LIMIT 1");
    if (rsPending) { const aid = nextId('APR', 4); q.insert('approvals', { id: aid, kind: 'RESEARCH_APPROVAL', ref_type: 'research', ref_id: rsPending.id, title: '지시조사 승인 요청: ' + q.get('SELECT title FROM research_requests WHERE id=?', rsPending.id).title, risk: 'MEDIUM', requester_id: 'U-021', approver_role: 'admin', status: 'PENDING', payload: J({}), decided_by: null, reason: null, trace_id: null, created_at: now, decided_at: null }); }
  });
  stats.eval = q.count('eval_cases');
  RAG.invalidate();
  audit(SYS, 'seed.completed', 'system', 'seed', { tables: ['all'] });
  return stats;
}

module.exports = { seedAll };
if (require.main === module) {
  const t0 = Date.now();
  const s = seedAll({ reset: process.argv.includes('--reset') || true });
  const counts = Object.fromEntries(['companies', 'users', 'countries', 'market_content', 'regulations', 'programs', 'buyers', 'events', 'consultations', 'match_requests', 'research_requests', 'documents', 'chunks', 'eval_cases'].map((t) => [t, q.count(t)]));
  console.log('Seed OK in', Date.now() - t0, 'ms', counts, s);
}
