'use strict';
// Intelligent Data Integration Studio (AXOS 추가개발 지시서 v1.0) — 메타·통합 엔터티 DDL.
// 원천(demo_crm_*, demo_bk_*) 테이블은 시드에서 DROP/CREATE 한다(드리프트 시연 후 초기 상태 복구를 위해).
const META = `
CREATE TABLE IF NOT EXISTS di_source(id TEXT PRIMARY KEY, name TEXT, source_kind TEXT, connector_type TEXT, integration_mode TEXT, owner TEXT, security_class TEXT, status TEXT, capabilities TEXT, enabled INTEGER DEFAULT 1, last_test_at TEXT, last_run_at TEXT, version INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS di_snapshot(id TEXT PRIMARY KEY, source_id TEXT, version INTEGER, captured_at TEXT, schema_hash TEXT, schema_json TEXT, profile_json TEXT, capture_mode TEXT, by_user TEXT);
CREATE INDEX IF NOT EXISTS ix_disnap_src ON di_snapshot(source_id, version);
CREATE TABLE IF NOT EXISTS di_model(id TEXT PRIMARY KEY, scope TEXT, version TEXT, status TEXT, parent_id TEXT, schema_json TEXT, note TEXT, created_by TEXT, created_at TEXT, released_at TEXT, UNIQUE(scope, version));
CREATE TABLE IF NOT EXISTS di_standard(id TEXT PRIMARY KEY, concept TEXT, standard_name TEXT, english_name TEXT, data_type TEXT, length INTEGER, nullable INTEGER, domain TEXT, sensitivity TEXT, definition TEXT, status TEXT, version TEXT);
CREATE TABLE IF NOT EXISTS di_codeset(code_set TEXT, version TEXT, source_value TEXT, standard_value TEXT, PRIMARY KEY(code_set, version, source_value));
CREATE TABLE IF NOT EXISTS di_mapping(id TEXT PRIMARY KEY, source_system TEXT, source_table TEXT, source_field TEXT, target_entity TEXT, target_field TEXT, rule_json TEXT, mapping_version TEXT, status TEXT, precedence INTEGER DEFAULT 1, required INTEGER DEFAULT 0, note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS di_raw(id TEXT PRIMARY KEY, source_id TEXT, source_table TEXT, source_pk TEXT, fingerprint TEXT, payload TEXT, std_json TEXT, run_id TEXT, collected_at TEXT, source_updated_at TEXT, eligible INTEGER, reason TEXT, status TEXT, UNIQUE(source_id, source_table, source_pk, fingerprint));
CREATE INDEX IF NOT EXISTS ix_diraw_pk ON di_raw(source_id, source_table, source_pk);
CREATE TABLE IF NOT EXISTS di_party(party_id TEXT PRIMARY KEY, party_type TEXT, display_name TEXT, country_code TEXT, lifecycle_status TEXT, consent_status TEXT, golden_version_id TEXT, merged_into TEXT, company_id TEXT, created_at TEXT, updated_at TEXT, version INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS di_crosswalk(id TEXT PRIMARY KEY, party_id TEXT, source_system TEXT, source_table TEXT, source_pk TEXT, status TEXT, valid_from TEXT, valid_to TEXT, version INTEGER DEFAULT 1, decision_id TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dicw_active ON di_crosswalk(source_system, source_table, source_pk) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS di_golden(id TEXT PRIMARY KEY, party_id TEXT, version_no INTEGER, attributes TEXT, provenance TEXT, rule_version TEXT, reason TEXT, effective_at TEXT, approved_by TEXT);
CREATE TABLE IF NOT EXISTS di_affiliation(id TEXT PRIMARY KEY, person_party_id TEXT, org_party_id TEXT, role_type TEXT, valid_from TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS di_consent(id TEXT PRIMARY KEY, party_id TEXT, source_ref TEXT, purpose TEXT, legal_basis TEXT, scope TEXT, valid_from TEXT, valid_to TEXT, revoked_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS di_candidate(id TEXT PRIMARY KEY, entity_type TEXT, left_ref TEXT, right_ref TEXT, left_party TEXT, right_party TEXT, score INTEGER, band TEXT, signals TEXT, blocks TEXT, model_version TEXT, status TEXT, reviewer TEXT, run_id TEXT, created_at TEXT, updated_at TEXT, version INTEGER DEFAULT 1, UNIQUE(left_ref, right_ref));
CREATE TABLE IF NOT EXISTS di_decision(id TEXT PRIMARY KEY, candidate_id TEXT, decision TEXT, reviewer TEXT, approver TEXT, reason TEXT, policy_version TEXT, survivor_party TEXT, absorbed_party TEXT, before_json TEXT, after_json TEXT, impact_json TEXT, reversed_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS di_link(id TEXT PRIMARY KEY, party_a TEXT, party_b TEXT, kind TEXT, decision_id TEXT, status TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS di_activity(id TEXT PRIMARY KEY, party_id TEXT, source_system TEXT, source_pk TEXT, event_type TEXT, occurred_at TEXT, ref TEXT);
CREATE TABLE IF NOT EXISTS di_dq_rule(id TEXT PRIMARY KEY, subject TEXT, dimension TEXT, check_type TEXT, params TEXT, severity TEXT, threshold REAL, status TEXT, version TEXT);
CREATE TABLE IF NOT EXISTS di_dq_run(id TEXT PRIMARY KEY, at TEXT, rule_version TEXT, scores TEXT, detail TEXT, by_user TEXT);
CREATE TABLE IF NOT EXISTS di_dq_issue(id TEXT PRIMARY KEY, rule_id TEXT, dimension TEXT, severity TEXT, source_ref TEXT, field TEXT, evidence TEXT, suggestion TEXT, status TEXT, assigned_to TEXT, run_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT, updated_at TEXT, version INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS di_fix(id TEXT PRIMARY KEY, issue_id TEXT, source_ref TEXT, field TEXT, old_value TEXT, new_value TEXT, applied_by TEXT, applied_at TEXT, reverted_at TEXT);
CREATE TABLE IF NOT EXISTS di_run(id TEXT PRIMARY KEY, source_id TEXT, mode TEXT, status TEXT, watermark_before TEXT, watermark_after TEXT, counts TEXT, stages TEXT, error TEXT, retry_no INTEGER DEFAULT 0, parent_run_id TEXT, idempotency_key TEXT, started_at TEXT, finished_at TEXT, by_user TEXT);
CREATE TABLE IF NOT EXISTS di_watermark(source_id TEXT PRIMARY KEY, value TEXT, run_id TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS di_ods(party_id TEXT PRIMARY KEY, attributes TEXT, product_keys TEXT, consent_ok INTEGER, golden_version_id TEXT, mapping_version TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS di_lineage(id INTEGER PRIMARY KEY AUTOINCREMENT, from_node TEXT, to_node TEXT, kind TEXT, ref TEXT, version TEXT, created_at TEXT, UNIQUE(from_node, to_node, kind));
CREATE TABLE IF NOT EXISTS di_drift(id TEXT PRIMARY KEY, source_id TEXT, old_snapshot TEXT, new_snapshot TEXT, change_set TEXT, severity TEXT, status TEXT, detected_at TEXT);
CREATE TABLE IF NOT EXISTS di_proposal(id TEXT PRIMARY KEY, drift_id TEXT, trigger_kind TEXT, proposal TEXT, risk TEXT, diff TEXT, state TEXT, requested_by TEXT, approved_by TEXT, sandbox_id TEXT, release_id TEXT, created_at TEXT, updated_at TEXT, version INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS di_sandbox(id TEXT PRIMARY KEY, proposal_id TEXT, dataset_version TEXT, before_json TEXT, after_json TEXT, findings TEXT, pass INTEGER, at TEXT);
CREATE TABLE IF NOT EXISTS di_release(id TEXT PRIMARY KEY, proposal_id TEXT, model_before TEXT, model_after TEXT, mapping_before TEXT, mapping_after TEXT, state TEXT, deployed_by TEXT, deployed_at TEXT, rollback_ref TEXT, rolled_back_at TEXT, snapshot TEXT, impact TEXT);
CREATE TABLE IF NOT EXISTS di_idem(key TEXT PRIMARY KEY, endpoint TEXT, response TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS di_event(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT, actor_role TEXT, event TEXT, ref TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS ix_diev_ref ON di_event(ref);
CREATE TABLE IF NOT EXISTS di_selfcheck(id TEXT PRIMARY KEY, at TEXT, by_user TEXT, results TEXT);
CREATE TABLE IF NOT EXISTS di_upload(source_id TEXT, table_name TEXT, rows_json TEXT, uploaded_at TEXT, PRIMARY KEY(source_id, table_name));
CREATE TABLE IF NOT EXISTS di_glossary(kind TEXT, target TEXT, logical TEXT, definition TEXT, updated_by TEXT, updated_at TEXT, PRIMARY KEY(kind, target));
CREATE TABLE IF NOT EXISTS di_signup_sim(id TEXT PRIMARY KEY, system TEXT, input_masked TEXT, outcome TEXT, matched_party TEXT, action TEXT, by_user TEXT, at TEXT);
`;

// ── 합성 원천 테이블(스펙 §6, 식별자·주소·도메인·동의철회 등 매칭에 필요한 컬럼을 보강) ──
const DEMO_TABLES = [
  'demo_crm_voc', 'demo_crm_participation', 'demo_crm_customer', 'demo_bk_inquiry', 'demo_bk_product', 'demo_bk_member',
];
const DEMO = `
CREATE TABLE demo_crm_customer (
  crm_customer_id VARCHAR(40) PRIMARY KEY,
  customer_type VARCHAR(16) NOT NULL,
  organization_name VARCHAR(200),
  contact_name VARCHAR(100),
  contact_email VARCHAR(254),
  country_code CHAR(3),
  business_reg_no VARCHAR(30),
  address_line VARCHAR(200),
  website VARCHAR(200),
  main_hs_code VARCHAR(12),
  consent_purpose VARCHAR(60),
  consent_at TIMESTAMP,
  consent_until TIMESTAMP,
  consent_revoked_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL
);
CREATE TABLE demo_crm_participation (
  participation_id VARCHAR(40) PRIMARY KEY,
  crm_customer_id VARCHAR(40) NOT NULL REFERENCES demo_crm_customer(crm_customer_id),
  program_code VARCHAR(40),
  participated_at TIMESTAMP
);
CREATE TABLE demo_crm_voc (
  voc_id VARCHAR(40) PRIMARY KEY,
  crm_customer_id VARCHAR(40) NOT NULL REFERENCES demo_crm_customer(crm_customer_id),
  subject VARCHAR(100),
  created_at TIMESTAMP
);
CREATE TABLE demo_bk_member (
  bk_member_id VARCHAR(40) PRIMARY KEY,
  business_name_en VARCHAR(200),
  manager_name VARCHAR(100),
  manager_email VARCHAR(254),
  residence_country VARCHAR(3),
  company_reg_no VARCHAR(30),
  registered_address VARCHAR(200),
  website_url VARCHAR(200),
  account_status VARCHAR(24),
  permission_granted_at TIMESTAMP,
  permission_expires_at TIMESTAMP,
  modified_at TIMESTAMP NOT NULL
);
CREATE TABLE demo_bk_product (
  bk_product_id VARCHAR(40) PRIMARY KEY,
  bk_member_id VARCHAR(40) NOT NULL REFERENCES demo_bk_member(bk_member_id),
  hs_code VARCHAR(12),
  product_name_en VARCHAR(200)
);
CREATE TABLE demo_bk_inquiry (
  inquiry_id VARCHAR(40) PRIMARY KEY,
  buyer_member_id VARCHAR(40),
  seller_member_id VARCHAR(40),
  created_at TIMESTAMP,
  inquiry_status VARCHAR(20)
);
`;
module.exports = { META, DEMO, DEMO_TABLES };
