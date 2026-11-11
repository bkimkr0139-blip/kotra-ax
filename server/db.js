'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const U = require('./util');

const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kotra.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; PRAGMA synchronous=NORMAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seq(name TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);

-- Identity
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, name_en TEXT, role TEXT NOT NULL, company_id TEXT, buyer_id TEXT, office TEXT, title TEXT, pw_hash TEXT, locale TEXT DEFAULT 'ko', persona TEXT, active INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, expires_at TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY, name TEXT, name_en TEXT, industry TEXT, industry_en TEXT, product TEXT, product_en TEXT, hs_code TEXT, product_keys TEXT, size TEXT, employees INTEGER, export_stage TEXT, export_experience TEXT, target_markets TEXT, region TEXT, website TEXT, biz_no TEXT, readiness INTEGER DEFAULT 0, consent INTEGER DEFAULT 1, hashtags TEXT, description TEXT, description_en TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);

-- Trade
CREATE TABLE IF NOT EXISTS countries(code TEXT PRIMARY KEY, name_ko TEXT, name_en TEXT, region_ko TEXT, region_en TEXT, summary_ko TEXT, summary_en TEXT, population_m REAL, gdp_usd_b REAL, growth REAL, office_ko TEXT, office_en TEXT, tz TEXT, tz_offset INTEGER, source_type TEXT, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS export_projects(id TEXT PRIMARY KEY, company_id TEXT, name TEXT, name_en TEXT, country TEXT, product TEXT, goal TEXT, status TEXT, journey TEXT, memory TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS market_content(id TEXT PRIMARY KEY, type TEXT, country TEXT, industry TEXT, title_ko TEXT, title_en TEXT, body_ko TEXT, body_en TEXT, source_name TEXT, source_url TEXT, published_at TEXT, tags TEXT, status TEXT DEFAULT 'PUBLISHED', views INTEGER DEFAULT 0, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS regulations(id TEXT PRIMARY KEY, country TEXT, hs_prefix TEXT, industry TEXT, title_ko TEXT, title_en TEXT, body_ko TEXT, body_en TEXT, requirements TEXT, agency TEXT, source_url TEXT, updated_at TEXT, risk TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS trade_stats(id TEXT PRIMARY KEY, country TEXT, hs_prefix TEXT, year INTEGER, export_usd_m REAL, import_usd_m REAL, yoy REAL, source_type TEXT, is_synthetic INTEGER DEFAULT 1);

-- Support programs
CREATE TABLE IF NOT EXISTS programs(id TEXT PRIMARY KEY, title_ko TEXT, title_en TEXT, summary_ko TEXT, summary_en TEXT, type TEXT, target_ko TEXT, target_en TEXT, industries TEXT, countries TEXT, stages TEXT, customer_groups TEXT, sizes TEXT, apply_start TEXT, apply_end TEXT, event_start TEXT, event_end TEXT, dept_ko TEXT, dept_en TEXT, mode TEXT, region TEXT, status TEXT, eligibility TEXT, required_docs TEXT, benefit_ko TEXT, benefit_en TEXT, url TEXT, event_id TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, program_id TEXT, company_id TEXT, user_id TEXT, status TEXT, form TEXT, checklist TEXT, ai_draft INTEGER DEFAULT 0, approval_id TEXT, submitted_at TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS app_documents(id TEXT PRIMARY KEY, application_id TEXT, name TEXT, status TEXT, note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS program_favorites(user_id TEXT, program_id TEXT, created_at TEXT, PRIMARY KEY(user_id, program_id));

-- Buyers
CREATE TABLE IF NOT EXISTS buyers(id TEXT PRIMARY KEY, name TEXT, name_en TEXT, country TEXT, type TEXT, products TEXT, hs_codes TEXT, channels TEXT, size TEXT, trust INTEGER, past_success INTEGER, conditions TEXT, hashtags TEXT, contact_name TEXT, contact_email TEXT, contact_phone TEXT, description TEXT, description_en TEXT, verified INTEGER DEFAULT 0, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS buyer_favorites(company_id TEXT, buyer_id TEXT, created_at TEXT, PRIMARY KEY(company_id, buyer_id));

-- Events & matching
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, title_ko TEXT, title_en TEXT, type TEXT, country TEXT, city TEXT, venue TEXT, tz_offset INTEGER, start_date TEXT, end_date TEXT, apply_start TEXT, apply_end TEXT, groups TEXT, halls TEXT, status TEXT, description_ko TEXT, description_en TEXT, slot_minutes INTEGER DEFAULT 30, day_start TEXT DEFAULT '09:00', day_end TEXT DEFAULT '17:00', source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS event_participants(id TEXT PRIMARY KEY, event_id TEXT, kind TEXT, ref_id TEXT, status TEXT, grp TEXT, approved_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS availability_slots(id TEXT PRIMARY KEY, event_id TEXT, kind TEXT, ref_id TEXT, slot_start TEXT, available INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS interpreters(id TEXT PRIMARY KEY, name TEXT, languages TEXT, event_id TEXT, attendance TEXT, temp_login TEXT, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS match_requests(id TEXT PRIMARY KEY, event_id TEXT, company_id TEXT, buyer_id TEXT, initiator TEXT, status TEXT, score INTEGER, score_detail TEXT, slot_start TEXT, hall TEXT, interpreter_id TEXT, message TEXT, reject_reason TEXT, journal TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS satisfaction(id TEXT PRIMARY KEY, match_id TEXT, by_kind TEXT, score INTEGER, comment TEXT, created_at TEXT);

-- Consultations
CREATE TABLE IF NOT EXISTS consultations(id TEXT PRIMARY KEY, channel TEXT, company_id TEXT, user_id TEXT, topic TEXT, category TEXT, title TEXT, body TEXT, status TEXT, priority TEXT, assigned_to TEXT, ai_class TEXT, extra_care INTEGER DEFAULT 0, callback_at TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS consultation_messages(id TEXT PRIMARY KEY, consultation_id TEXT, sender TEXT, sender_id TEXT, speaker TEXT, body TEXT, at_sec REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS consultation_summaries(id TEXT PRIMARY KEY, consultation_id TEXT, status TEXT, draft TEXT, final TEXT, confidence REAL, source TEXT, confirmed_by TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS consultation_transfers(id TEXT PRIMARY KEY, consultation_id TEXT, from_user TEXT, to_target TEXT, reason TEXT, status TEXT, approval_id TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS stt_jobs(id TEXT PRIMARY KEY, consultation_id TEXT, filename TEXT, mode TEXT, state TEXT, stages TEXT, transcript TEXT, masked_count INTEGER DEFAULT 0, duration_s REAL, latency_ms INTEGER, created_by TEXT, error TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS faqs(id TEXT PRIMARY KEY, category TEXT, q_ko TEXT, q_en TEXT, a_ko TEXT, a_en TEXT, views INTEGER DEFAULT 0, source_type TEXT, is_synthetic INTEGER DEFAULT 1);

-- Overseas research
CREATE TABLE IF NOT EXISTS research_requests(id TEXT PRIMARY KEY, kind TEXT, title TEXT, title_en TEXT, country TEXT, office TEXT, requester_id TEXT, assignee_id TEXT, status TEXT, due_date TEXT, form TEXT, opinion TEXT, report TEXT, supplement TEXT, evaluation TEXT, indexed_doc_id TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS news_drafts(id TEXT PRIMARY KEY, type TEXT, author_id TEXT, title TEXT, original TEXT, corrected TEXT, summary TEXT, findings TEXT, status TEXT, approved_by TEXT, applied_ratio REAL, created_at TEXT, updated_at TEXT);

-- Knowledge / RAG
CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY, name_ko TEXT, name_en TEXT, description_ko TEXT, description_en TEXT, access_scope TEXT, embedding_model TEXT, top_k INTEGER, threshold REAL, reranker TEXT, enabled INTEGER DEFAULT 1, last_indexed TEXT);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, collection_id TEXT, title TEXT, title_en TEXT, text TEXT, text_en TEXT, org TEXT, url TEXT, published_at TEXT, updated_at TEXT, country TEXT, hs TEXT, doc_type TEXT, access_scope TEXT, status TEXT, flagged TEXT, uploaded_by TEXT, page_ref TEXT, source_type TEXT, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, doc_id TEXT, collection_id TEXT, idx INTEGER, lang TEXT, text TEXT, tf TEXT, len INTEGER, meta TEXT, flagged INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_chunks_col ON chunks(collection_id);

-- Chat
CREATE TABLE IF NOT EXISTS chat_sessions(id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, title TEXT, starred INTEGER DEFAULT 0, summary TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, payload TEXT, trace_id TEXT, rating INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS message_feedback(id TEXT PRIMARY KEY, message_id TEXT, user_id TEXT, rating INTEGER, kind TEXT, comment TEXT, status TEXT DEFAULT 'OPEN', created_at TEXT);
CREATE TABLE IF NOT EXISTS prompt_library(id TEXT PRIMARY KEY, user_id TEXT, title TEXT, body TEXT, category TEXT, shared INTEGER DEFAULT 0, uses INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS saved_items(id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, ref_id TEXT, title TEXT, payload TEXT, created_at TEXT);

-- AI ops
CREATE TABLE IF NOT EXISTS agent_defs(id TEXT PRIMARY KEY, name_ko TEXT, name_en TEXT, description_ko TEXT, description_en TEXT, collections TEXT, tools TEXT, prompt_id TEXT, status TEXT, rfp TEXT);
CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT, role TEXT, question TEXT, mode TEXT, plan TEXT, entities TEXT, rag TEXT, sources TEXT, tool_calls TEXT, approval_id TEXT, response TEXT, abstained INTEGER DEFAULT 0, blocked TEXT, flags TEXT, latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, model TEXT, provenance TEXT, status TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS tool_defs(id TEXT PRIMARY KEY, name_ko TEXT, name_en TEXT, risk_level TEXT, requires_approval INTEGER, input_schema TEXT, output_schema TEXT, timeout_ms INTEGER, enabled INTEGER DEFAULT 1, integration TEXT, roles TEXT, rate_limit INTEGER);
CREATE TABLE IF NOT EXISTS tool_runs(id TEXT PRIMARY KEY, run_id TEXT, tool_id TEXT, user_id TEXT, input TEXT, output_summary TEXT, status TEXT, risk_level TEXT, approval_id TEXT, latency_ms INTEGER, provenance TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS prompt_versions(id TEXT PRIMARY KEY, agent_id TEXT, version TEXT, body TEXT, owner TEXT, status TEXT, last_test TEXT, test_score REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS model_configs(id TEXT PRIMARY KEY, name TEXT, provider TEXT, purpose TEXT, status TEXT, context INTEGER, latency_ms INTEGER, quality REAL, cost_per_1k REAL, version TEXT, traits TEXT, is_default INTEGER DEFAULT 0, mode TEXT);
CREATE TABLE IF NOT EXISTS eval_cases(id TEXT PRIMARY KEY, question TEXT, lang TEXT, category TEXT, expected_behavior TEXT, expected_evidence TEXT, expected_keywords TEXT, expected_tool TEXT, last_result TEXT);
CREATE TABLE IF NOT EXISTS eval_results(id TEXT PRIMARY KEY, batch_id TEXT, case_id TEXT, actual_answer TEXT, citation_score REAL, groundedness REAL, helpfulness REAL, safety REAL, ndcg REAL, passed INTEGER, trace_id TEXT, created_at TEXT);

-- Governance
CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, kind TEXT, ref_type TEXT, ref_id TEXT, title TEXT, risk TEXT, requester_id TEXT, approver_role TEXT, status TEXT, payload TEXT, decided_by TEXT, reason TEXT, trace_id TEXT, created_at TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor_id TEXT, actor_role TEXT, action TEXT, target_type TEXT, target_id TEXT, detail TEXT, ip TEXT, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS status_history(id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, entity_id TEXT, from_state TEXT, to_state TEXT, actor_id TEXT, note TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT, type TEXT, title TEXT, body TEXT, link TEXT, is_read INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, channel TEXT, to_addr TEXT, subject TEXT, body TEXT, status TEXT, related TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS api_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, user_id TEXT, method TEXT, path TEXT, status INTEGER, ms INTEGER, ip TEXT);
CREATE TABLE IF NOT EXISTS integration_events(id TEXT PRIMARY KEY, system TEXT, event TEXT, payload TEXT, mode TEXT, status TEXT, created_at TEXT);

-- Data platform
CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, name_ko TEXT, name_en TEXT, tbl TEXT, owner TEXT, source TEXT, classification TEXT, update_cycle TEXT, last_sync TEXT, lineage TEXT, pii_fields TEXT, quality_rules TEXT);
CREATE TABLE IF NOT EXISTS pipelines(id TEXT PRIMARY KEY, name TEXT, dataset_id TEXT, schedule TEXT, status TEXT, last_run TEXT, stages TEXT, mode TEXT);
CREATE TABLE IF NOT EXISTS pipeline_runs(id TEXT PRIMARY KEY, pipeline_id TEXT, status TEXT, stages TEXT, rows_in INTEGER, rows_out INTEGER, rejected INTEGER, started_at TEXT, finished_at TEXT, triggered_by TEXT);
CREATE TABLE IF NOT EXISTS quality_issues(id TEXT PRIMARY KEY, dataset_id TEXT, severity TEXT, rule TEXT, detail TEXT, status TEXT, count INTEGER, created_at TEXT, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS crm_customers(id TEXT PRIMARY KEY, system TEXT, name TEXT, email TEXT, mobile TEXT, biz_no TEXT, domestic INTEGER, consent INTEGER, last_activity TEXT, activity TEXT, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS mdm_masters(id TEXT PRIMARY KEY, domestic_foreign TEXT, company_id TEXT, name TEXT, email TEXT, mobile TEXT, source_systems TEXT, source_ids TEXT, consent_status TEXT, merge_status TEXT, quality_score INTEGER, merged_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS mdm_candidates(id TEXT PRIMARY KEY, a_id TEXT, b_id TEXT, score INTEGER, reasons TEXT, status TEXT, decided_by TEXT, decided_at TEXT, master_id TEXT);
CREATE TABLE IF NOT EXISTS rfp_coverage(id TEXT PRIMARY KEY, category TEXT, name TEXT, task TEXT, module TEXT, screen TEXT, impl_status TEXT, demo_status TEXT, evidence TEXT, notes TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS cms_banners(id TEXT PRIMARY KEY, site TEXT, title_ko TEXT, title_en TEXT, body_ko TEXT, body_en TEXT, link TEXT, active INTEGER DEFAULT 1, sort INTEGER, groups TEXT);
CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY, kind TEXT, title_ko TEXT, title_en TEXT, body_ko TEXT, body_en TEXT, published_at TEXT, pinned INTEGER DEFAULT 0, source_type TEXT, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS playground_apps(id TEXT PRIMARY KEY, kind TEXT, title_ko TEXT, title_en TEXT, description_ko TEXT, description_en TEXT, dept TEXT, prompt TEXT, uses INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, owner_id TEXT, forked_from TEXT, created_at TEXT);

-- AX개발 / AXOS closed loop (feedback -> RTM -> work order -> auto-dev -> verify -> accept)
CREATE TABLE IF NOT EXISTS ax_feedback(id TEXT PRIMARY KEY, screen_key TEXT, feature_id TEXT, route TEXT, screen_title TEXT, kind TEXT, title TEXT, as_is TEXT, to_be TEXT, benefit TEXT, priority TEXT, rfp_ids TEXT, status TEXT, author_id TEXT, author_role TEXT, author_name TEXT, lang TEXT, review TEXT, order_id TEXT, duplicate_of TEXT, similar TEXT, is_synthetic INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS ix_axfb_screen ON ax_feedback(screen_key);
CREATE TABLE IF NOT EXISTS ax_orders(id TEXT PRIMARY KEY, feedback_id TEXT, rev INTEGER DEFAULT 1, title TEXT, screen_key TEXT, priority TEXT, risk TEXT, status TEXT, rfp_ids TEXT, targets TEXT, acceptance TEXT, instruction_md TEXT, guardrails TEXT, claimed_by TEXT, claimed_at TEXT, started_at TEXT, finished_at TEXT, result TEXT, accepted_by TEXT, accepted_at TEXT, release_id TEXT, is_synthetic INTEGER DEFAULT 0, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ax_events(id INTEGER PRIMARY KEY AUTOINCREMENT, ref_type TEXT, ref_id TEXT, event TEXT, actor TEXT, actor_role TEXT, detail TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_axev_ref ON ax_events(ref_type, ref_id);
CREATE TABLE IF NOT EXISTS ax_rtm(req_id TEXT PRIMARY KEY, category TEXT, name TEXT, impl_status TEXT, demo_status TEXT, screens TEXT, apis TEXT, tests TEXT, evidence TEXT, notes TEXT, owner TEXT, verify_status TEXT DEFAULT 'UNVERIFIED', verified_by TEXT, verified_at TEXT, verify_note TEXT, rev INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ax_rtm_snapshots(id TEXT PRIMARY KEY, at TEXT, by_user TEXT, totals TEXT, hash TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS ax_releases(id TEXT PRIMARY KEY, ver TEXT, order_id TEXT, feedback_id TEXT, title TEXT, summary TEXT, files TEXT, rfp_ids TEXT, is_synthetic INTEGER DEFAULT 0, at TEXT, by_user TEXT);
CREATE TABLE IF NOT EXISTS ax_checklist(id TEXT PRIMARY KEY, title_ko TEXT, title_en TEXT, owner TEXT, due TEXT, status TEXT, note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ax_qna(id TEXT PRIMARY KEY, question TEXT, rfp_id TEXT, asked_by TEXT, status TEXT, assignee TEXT, answer TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ax_members(id TEXT PRIMARY KEY, org_ko TEXT, org_en TEXT, role_ko TEXT, role_en TEXT, modules TEXT, lead INTEGER DEFAULT 0, is_synthetic INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS ax_staff(id TEXT PRIMARY KEY, member_id TEXT, name TEXT, role TEXT, kind TEXT, pledge TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ax_raci(deliverable TEXT, member_id TEXT, code TEXT, PRIMARY KEY(deliverable, member_id));
`;
db.exec(SCHEMA);
db.exec(require('./di/ddl').META); // Data Integration Studio meta entities

// ---------- helpers ----------
function norm(p) { return p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v !== null && typeof v === 'object') ? JSON.stringify(v) : v)); }
const q = {
  all: (sql, ...p) => db.prepare(sql).all(...norm(p)),
  get: (sql, ...p) => db.prepare(sql).get(...norm(p)),
  run: (sql, ...p) => db.prepare(sql).run(...norm(p)),
  exec: (sql) => db.exec(sql),
  _depth: 0,
  tx(fn) { // re-entrant: outer = BEGIN/COMMIT, nested = SAVEPOINT
    const d = q._depth++;
    const sp = `sp${d}`;
    db.exec(d === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
    try { const r = fn(); db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`); return r; }
    catch (e) { try { db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch {} throw e; }
    finally { q._depth--; }
  },
  insert(table, obj) {
    const keys = Object.keys(obj);
    q.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
    return obj;
  },
  upsert(table, obj, pk = 'id') {
    const keys = Object.keys(obj);
    q.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')}) ON CONFLICT(${pk}) DO UPDATE SET ${keys.filter((k) => k !== pk).map((k) => `${k}=excluded.${k}`).join(',')}`, ...keys.map((k) => obj[k]));
    return obj;
  },
  update(table, id, patch, pk = 'id') {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    q.run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${pk}=?`, ...keys.map((k) => patch[k]), id);
  },
  count: (table, where = '', ...p) => q.get(`SELECT COUNT(*) c FROM ${table} ${where}`, ...p).c,
};

function nextId(prefix, width = 4) {
  return q.tx(() => {
    const row = q.get('SELECT n FROM seq WHERE name=?', prefix);
    const n = (row ? row.n : 0) + 1;
    q.run('INSERT INTO seq(name,n) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET n=excluded.n', prefix, n);
    return `${prefix}-${U.pad(n, width)}`;
  });
}
function getSetting(k, d = null) { const r = q.get('SELECT v FROM settings WHERE k=?', k); return r ? U.parse(r.v, d) : d; }
function setSetting(k, v) { q.run('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, JSON.stringify(v)); }

const JSON_COLS = new Set(['target_markets', 'product_keys', 'hashtags', 'industries', 'countries', 'stages', 'customer_groups', 'sizes', 'eligibility', 'required_docs', 'products', 'hs_codes', 'channels', 'conditions', 'requirements', 'tags', 'groups', 'halls', 'journey', 'memory', 'form', 'checklist', 'score_detail', 'journal', 'ai_class', 'draft', 'final', 'plan', 'entities', 'rag', 'sources', 'tool_calls', 'response', 'flags', 'payload', 'detail', 'stages', 'lineage', 'pii_fields', 'quality_rules', 'meta', 'tf', 'languages', 'tools', 'collections', 'input_schema', 'output_schema', 'traits', 'roles', 'activity', 'source_systems', 'source_ids', 'reasons', 'opinion', 'report', 'supplement', 'evaluation', 'findings', 'transcript', 'last_result', 'expected_evidence', 'expected_keywords', 'flagged', 'blocked', 'rfp', 'last_test']);
// Hydrate JSON columns on read.
function hyd(row) {
  if (!row) return row;
  const o = { ...row };
  for (const k of Object.keys(o)) if (JSON_COLS.has(k) && typeof o[k] === 'string') { const v = U.parse(o[k], undefined); if (v !== undefined) o[k] = v; }
  return o;
}
const hydAll = (rows) => rows.map(hyd);

function resetAll() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
}

module.exports = { db, q, nextId, getSetting, setSetting, hyd, hydAll, resetAll, DB_PATH };
