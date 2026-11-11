# 04. 데이터 모델 (자동 생성)

논리 엔터티는 지시서 §23 과 동일합니다. 물리 스키마는 `server/db.js`(SQLite) 입니다. 상태전이는 `server/gov.js` 의 MACHINES 가 서버에서 검증합니다.

| 영역 | 테이블 |
|---|---|
| Identity | users, sessions, companies |
| Trade | countries, export_projects(Case Memory), market_content, regulations, trade_stats |
| Support | programs, applications, app_documents, program_favorites |
| Buyer | buyers, buyer_favorites |
| Matching | events, event_participants, availability_slots, interpreters, match_requests, satisfaction |
| Consultation | consultations, consultation_messages, consultation_summaries, consultation_transfers, stt_jobs, faqs |
| Overseas | research_requests, news_drafts |
| Knowledge | collections, documents, chunks |
| AI | agent_defs, agent_runs, tool_defs, tool_runs, prompt_versions, model_configs, eval_cases, eval_results, chat_sessions, chat_messages, message_feedback, prompt_library |
| Governance | approvals, audit_events(hash chain), status_history, notifications, outbox, integration_events, api_logs |
| Data platform | datasets, pipelines, pipeline_runs, quality_issues, crm_customers, mdm_masters, mdm_candidates, rfp_coverage |

## 상태 전이
```
application: DRAFT→[READY_FOR_REVIEW]  READY_FOR_REVIEW→[APPROVAL_REQUIRED|DRAFT]  APPROVAL_REQUIRED→[SUBMITTED_DEMO|DRAFT]  SUBMITTED_DEMO→[COMPLETED]  COMPLETED→[]
consultation: OPEN→[AI_CLASSIFIED|ASSIGNED]  AI_CLASSIFIED→[ASSIGNED]  ASSIGNED→[IN_PROGRESS]  IN_PROGRESS→[RESOLVED|ASSIGNED]  RESOLVED→[CLOSED|IN_PROGRESS]  CLOSED→[]
match: REQUESTED→[ACCEPTED|REJECTED]  ACCEPTED→[SCHEDULED]  REJECTED→[]  SCHEDULED→[COMPLETED|ACCEPTED]  COMPLETED→[FOLLOW_UP]  FOLLOW_UP→[]
research: DRAFT→[APPROVAL_REQUESTED]  APPROVAL_REQUESTED→[ASSIGNED|DRAFT]  ASSIGNED→[IN_PROGRESS]  IN_PROGRESS→[SUBMITTED]  SUBMITTED→[REVISION_REQUESTED|COMPLETED]  REVISION_REQUESTED→[SUBMITTED]  COMPLETED→[EVALUATED]  EVALUATED→[]
approval: PENDING→[APPROVED|REJECTED|CANCELLED]  APPROVED→[]  REJECTED→[]  CANCELLED→[]
news: DRAFT→[REVIEW]  REVIEW→[APPROVED|REJECTED|DRAFT]  APPROVED→[PUBLISHED]  REJECTED→[DRAFT]  PUBLISHED→[]
ax_feedback: SUBMITTED→[APPROVED|NEEDS_INFO|REJECTED|DUPLICATE|WITHDRAWN]  NEEDS_INFO→[SUBMITTED|REJECTED|WITHDRAWN]  APPROVED→[DONE|REOPENED|NEEDS_INFO]  REOPENED→[APPROVED|REJECTED|NEEDS_INFO]  DONE→[REOPENED]  REJECTED→[]  DUPLICATE→[]  WITHDRAWN→[]
ax_order: QUEUED→[IN_PROGRESS|CANCELLED]  IN_PROGRESS→[REPORTED|FAILED|QUEUED|CANCELLED]  REPORTED→[ACCEPTED|REOPENED]  FAILED→[QUEUED|CANCELLED]  ACCEPTED→[]  REOPENED→[]  CANCELLED→[]
ax_qna: RECEIVED→[ASSIGNED]  ASSIGNED→[DRAFTED|RECEIVED]  DRAFTED→[REVIEWED|ASSIGNED]  REVIEWED→[SUBMITTED|DRAFTED]  SUBMITTED→[]
di_candidate: PENDING→[MERGED|LINKED|SEPARATE|NEEDS_INFO]  NEEDS_INFO→[PENDING|MERGED|LINKED|SEPARATE]  BLOCKED→[SEPARATE|NEEDS_INFO]  MERGED→[PENDING]  LINKED→[PENDING]  SEPARATE→[PENDING]
di_dq: DETECTED→[TRIAGED]  TRIAGED→[ASSIGNED]  ASSIGNED→[PROPOSED]  PROPOSED→[REVIEWED|REJECTED]  REVIEWED→[APPROVED|REJECTED]  APPROVED→[APPLIED]  APPLIED→[VERIFIED]  VERIFIED→[CLOSED]  REJECTED→[REOPENED]  REOPENED→[TRIAGED]  CLOSED→[REOPENED]
di_proposal: DRAFT→[SIMULATED|REJECTED]  SIMULATED→[REVIEW_REQUESTED|REJECTED|DRAFT]  REVIEW_REQUESTED→[APPROVED|REJECTED]  APPROVED→[DEPLOYING|FAILED]  DEPLOYING→[ACTIVE|FAILED]  ACTIVE→[MONITORED|ROLLBACK_REQUESTED|ROLLED_BACK]  MONITORED→[ROLLBACK_REQUESTED|ROLLED_BACK]  ROLLBACK_REQUESTED→[ROLLED_BACK]  REJECTED→[]  FAILED→[]  ROLLED_BACK→[]
mdm: PENDING→[MERGED|KEPT_SEPARATE|ON_HOLD]  ON_HOLD→[MERGED|KEPT_SEPARATE]  MERGED→[]  KEPT_SEPARATE→[]
```

## 테이블 컬럼

### agent_defs  (15 rows in seed)
`id*, name_ko, name_en, description_ko, description_en, collections, tools, prompt_id, status, rfp`

### agent_runs  (0 rows in seed)
`id*, session_id, user_id, role, question, mode, plan, entities, rag, sources, tool_calls, approval_id, response, abstained, blocked, flags, latency_ms, tokens_in, tokens_out, cost_usd, model, provenance, status, created_at`

### api_logs  (0 rows in seed)
`id*, ts, user_id, method, path, status, ms, ip`

### app_documents  (0 rows in seed)
`id*, application_id, name, status, note, created_at`

### applications  (6 rows in seed)
`id*, program_id, company_id, user_id, status, form, checklist, ai_draft, approval_id, submitted_at, source_type, is_synthetic, created_at, updated_at`

### approvals  (1 rows in seed)
`id*, kind, ref_type, ref_id, title, risk, requester_id, approver_role, status, payload, decided_by, reason, trace_id, created_at, decided_at`

### audit_events  (37 rows in seed)
`id*, ts, actor_id, actor_role, action, target_type, target_id, detail, ip, prev_hash, hash`

### availability_slots  (2752 rows in seed)
`id*, event_id, kind, ref_id, slot_start, available`

### ax_checklist  (10 rows in seed)
`id*, title_ko, title_en, owner, due, status, note, updated_at`

### ax_events  (32 rows in seed)
`id*, ref_type, ref_id, event, actor, actor_role, detail, at`

### ax_feedback  (10 rows in seed)
`id*, screen_key, feature_id, route, screen_title, kind, title, as_is, to_be, benefit, priority, rfp_ids, status, author_id, author_role, author_name, lang, review, order_id, duplicate_of, similar, is_synthetic, created_at, updated_at`

### ax_members  (5 rows in seed)
`id*, org_ko, org_en, role_ko, role_en, modules, lead, is_synthetic`

### ax_orders  (5 rows in seed)
`id*, feedback_id, rev, title, screen_key, priority, risk, status, rfp_ids, targets, acceptance, instruction_md, guardrails, claimed_by, claimed_at, started_at, finished_at, result, accepted_by, accepted_at, release_id, is_synthetic, created_by, created_at, updated_at`

### ax_qna  (3 rows in seed)
`id*, question, rfp_id, asked_by, status, assignee, answer, created_at, updated_at`

### ax_raci  (45 rows in seed)
`deliverable*, member_id*, code`

### ax_releases  (1 rows in seed)
`id*, ver, order_id, feedback_id, title, summary, files, rfp_ids, is_synthetic, at, by_user`

### ax_rtm  (150 rows in seed)
`req_id*, category, name, impl_status, demo_status, screens, apis, tests, evidence, notes, owner, verify_status, verified_by, verified_at, verify_note, rev, updated_at`

### ax_rtm_snapshots  (2 rows in seed)
`id*, at, by_user, totals, hash, note`

### ax_staff  (10 rows in seed)
`id*, member_id, name, role, kind, pledge, updated_at`

### buyer_favorites  (0 rows in seed)
`company_id*, buyer_id*, created_at`

### buyers  (60 rows in seed)
`id*, name, name_en, country, type, products, hs_codes, channels, size, trust, past_success, conditions, hashtags, contact_name, contact_email, contact_phone, description, description_en, verified, source_type, is_synthetic, created_at, updated_at`

### chat_messages  (0 rows in seed)
`id*, session_id, role, content, payload, trace_id, rating, created_at`

### chat_sessions  (0 rows in seed)
`id*, user_id, project_id, title, starred, summary, created_at, updated_at`

### chunks  (617 rows in seed)
`id*, doc_id, collection_id, idx, lang, text, tf, len, meta, flagged`

### cms_banners  (4 rows in seed)
`id*, site, title_ko, title_en, body_ko, body_en, link, active, sort, groups`

### collections  (10 rows in seed)
`id*, name_ko, name_en, description_ko, description_en, access_scope, embedding_model, top_k, threshold, reranker, enabled, last_indexed`

### companies  (15 rows in seed)
`id*, name, name_en, industry, industry_en, product, product_en, hs_code, product_keys, size, employees, export_stage, export_experience, target_markets, region, website, biz_no, readiness, consent, hashtags, description, description_en, source_type, is_synthetic, created_at, updated_at`

### consultation_messages  (55 rows in seed)
`id*, consultation_id, sender, sender_id, speaker, body, at_sec, created_at`

### consultation_summaries  (2 rows in seed)
`id*, consultation_id, status, draft, final, confidence, source, confirmed_by, created_at, updated_at`

### consultation_transfers  (0 rows in seed)
`id*, consultation_id, from_user, to_target, reason, status, approval_id, created_at`

### consultations  (30 rows in seed)
`id*, channel, company_id, user_id, topic, category, title, body, status, priority, assigned_to, ai_class, extra_care, callback_at, source_type, is_synthetic, created_at, updated_at`

### countries  (21 rows in seed)
`code*, name_ko, name_en, region_ko, region_en, summary_ko, summary_en, population_m, gdp_usd_b, growth, office_ko, office_en, tz, tz_offset, source_type, is_synthetic`

### crm_customers  (21 rows in seed)
`id*, system, name, email, mobile, biz_no, domestic, consent, last_activity, activity, is_synthetic`

### datasets  (10 rows in seed)
`id*, name_ko, name_en, tbl, owner, source, classification, update_cycle, last_sync, lineage, pii_fields, quality_rules`

### demo_bk_inquiry  (40 rows in seed)
`inquiry_id*, buyer_member_id, seller_member_id, created_at, inquiry_status`

### demo_bk_member  (49 rows in seed)
`bk_member_id*, business_name_en, manager_name, manager_email, residence_country, company_reg_no, registered_address, website_url, account_status, permission_granted_at, permission_expires_at, modified_at`

### demo_bk_product  (73 rows in seed)
`bk_product_id*, bk_member_id, hs_code, product_name_en`

### demo_crm_customer  (51 rows in seed)
`crm_customer_id*, customer_type, organization_name, contact_name, contact_email, country_code, business_reg_no, address_line, website, main_hs_code, consent_purpose, consent_at, consent_until, consent_revoked_at, updated_at`

### demo_crm_participation  (40 rows in seed)
`participation_id*, crm_customer_id, program_code, participated_at`

### demo_crm_voc  (27 rows in seed)
`voc_id*, crm_customer_id, subject, created_at`

### di_activity  (105 rows in seed)
`id*, party_id, source_system, source_pk, event_type, occurred_at, ref`

### di_affiliation  (95 rows in seed)
`id*, person_party_id, org_party_id, role_type, valid_from, status`

### di_candidate  (22 rows in seed)
`id*, entity_type, left_ref, right_ref, left_party, right_party, score, band, signals, blocks, model_version, status, reviewer, run_id, created_at, updated_at, version`

### di_codeset  (24 rows in seed)
`code_set*, version*, source_value*, standard_value`

### di_consent  (95 rows in seed)
`id*, party_id, source_ref, purpose, legal_basis, scope, valid_from, valid_to, revoked_at, status`

### di_crosswalk  (192 rows in seed)
`id*, party_id, source_system, source_table, source_pk, status, valid_from, valid_to, version, decision_id`

### di_decision  (0 rows in seed)
`id*, candidate_id, decision, reviewer, approver, reason, policy_version, survivor_party, absorbed_party, before_json, after_json, impact_json, reversed_by, created_at`

### di_dq_issue  (3 rows in seed)
`id*, rule_id, dimension, severity, source_ref, field, evidence, suggestion, status, assigned_to, run_id, before_json, after_json, created_at, updated_at, version`

### di_dq_rule  (18 rows in seed)
`id*, subject, dimension, check_type, params, severity, threshold, status, version`

### di_dq_run  (2 rows in seed)
`id*, at, rule_version, scores, detail, by_user`

### di_drift  (0 rows in seed)
`id*, source_id, old_snapshot, new_snapshot, change_set, severity, status, detected_at`

### di_event  (3 rows in seed)
`id*, at, actor, actor_role, event, ref, detail`

### di_fix  (0 rows in seed)
`id*, issue_id, source_ref, field, old_value, new_value, applied_by, applied_at, reverted_at`

### di_glossary  (0 rows in seed)
`kind*, target*, logical, definition, updated_by, updated_at`

### di_golden  (192 rows in seed)
`id*, party_id, version_no, attributes, provenance, rule_version, reason, effective_at, approved_by`

### di_idem  (0 rows in seed)
`key*, endpoint, response, at`

### di_lineage  (329 rows in seed)
`id*, from_node, to_node, kind, ref, version, created_at`

### di_link  (0 rows in seed)
`id*, party_a, party_b, kind, decision_id, status, created_at`

### di_mapping  (22 rows in seed)
`id*, source_system, source_table, source_field, target_entity, target_field, rule_json, mapping_version, status, precedence, required, note, updated_at`

### di_model  (4 rows in seed)
`id*, scope, version, status, parent_id, schema_json, note, created_by, created_at, released_at`

### di_ods  (95 rows in seed)
`party_id*, attributes, product_keys, consent_ok, golden_version_id, mapping_version, updated_at`

### di_party  (192 rows in seed)
`party_id*, party_type, display_name, country_code, lifecycle_status, consent_status, golden_version_id, merged_into, company_id, created_at, updated_at, version`

### di_proposal  (0 rows in seed)
`id*, drift_id, trigger_kind, proposal, risk, diff, state, requested_by, approved_by, sandbox_id, release_id, created_at, updated_at, version`

### di_raw  (100 rows in seed)
`id*, source_id, source_table, source_pk, fingerprint, payload, std_json, run_id, collected_at, source_updated_at, eligible, reason, status`

### di_release  (0 rows in seed)
`id*, proposal_id, model_before, model_after, mapping_before, mapping_after, state, deployed_by, deployed_at, rollback_ref, rolled_back_at, snapshot, impact`

### di_run  (1 rows in seed)
`id*, source_id, mode, status, watermark_before, watermark_after, counts, stages, error, retry_no, parent_run_id, idempotency_key, started_at, finished_at, by_user`

### di_sandbox  (0 rows in seed)
`id*, proposal_id, dataset_version, before_json, after_json, findings, pass, at`

### di_selfcheck  (0 rows in seed)
`id*, at, by_user, results`

### di_signup_sim  (0 rows in seed)
`id*, system, input_masked, outcome, matched_party, action, by_user, at`

### di_snapshot  (2 rows in seed)
`id*, source_id, version, captured_at, schema_hash, schema_json, profile_json, capture_mode, by_user`

### di_source  (6 rows in seed)
`id*, name, source_kind, connector_type, integration_mode, owner, security_class, status, capabilities, enabled, last_test_at, last_run_at, version`

### di_standard  (13 rows in seed)
`id*, concept, standard_name, english_name, data_type, length, nullable, domain, sensitivity, definition, status, version`

### di_upload  (0 rows in seed)
`source_id*, table_name*, rows_json, uploaded_at`

### di_watermark  (2 rows in seed)
`source_id*, value, run_id, updated_at`

### documents  (248 rows in seed)
`id*, collection_id, title, title_en, text, text_en, org, url, published_at, updated_at, country, hs, doc_type, access_scope, status, flagged, uploaded_by, page_ref, source_type, is_synthetic`

### eval_cases  (50 rows in seed)
`id*, question, lang, category, expected_behavior, expected_evidence, expected_keywords, expected_tool, last_result`

### eval_results  (0 rows in seed)
`id*, batch_id, case_id, actual_answer, citation_score, groundedness, helpfulness, safety, ndcg, passed, trace_id, created_at`

### event_participants  (84 rows in seed)
`id*, event_id, kind, ref_id, status, grp, approved_by, created_at`

### events  (8 rows in seed)
`id*, title_ko, title_en, type, country, city, venue, tz_offset, start_date, end_date, apply_start, apply_end, groups, halls, status, description_ko, description_en, slot_minutes, day_start, day_end, source_type, is_synthetic, created_at`

### export_projects  (15 rows in seed)
`id*, company_id, name, name_en, country, product, goal, status, journey, memory, source_type, is_synthetic, created_at, updated_at`

### faqs  (12 rows in seed)
`id*, category, q_ko, q_en, a_ko, a_en, views, source_type, is_synthetic`

### integration_events  (0 rows in seed)
`id*, system, event, payload, mode, status, created_at`

### interpreters  (4 rows in seed)
`id*, name, languages, event_id, attendance, temp_login, is_synthetic`

### market_content  (61 rows in seed)
`id*, type, country, industry, title_ko, title_en, body_ko, body_en, source_name, source_url, published_at, tags, status, views, source_type, is_synthetic, created_at, updated_at`

### match_requests  (50 rows in seed)
`id*, event_id, company_id, buyer_id, initiator, status, score, score_detail, slot_start, hall, interpreter_id, message, reject_reason, journal, source_type, is_synthetic, created_at, updated_at`

### mdm_candidates  (6 rows in seed)
`id*, a_id, b_id, score, reasons, status, decided_by, decided_at, master_id`

### mdm_masters  (1 rows in seed)
`id*, domestic_foreign, company_id, name, email, mobile, source_systems, source_ids, consent_status, merge_status, quality_score, merged_by, created_at`

### message_feedback  (0 rows in seed)
`id*, message_id, user_id, rating, kind, comment, status, created_at`

### model_configs  (5 rows in seed)
`id*, name, provider, purpose, status, context, latency_ms, quality, cost_per_1k, version, traits, is_default, mode`

### news_drafts  (0 rows in seed)
`id*, type, author_id, title, original, corrected, summary, findings, status, approved_by, applied_ratio, created_at, updated_at`

### notices  (6 rows in seed)
`id*, kind, title_ko, title_en, body_ko, body_en, published_at, pinned, source_type, is_synthetic`

### notifications  (73 rows in seed)
`id*, user_id, type, title, body, link, is_read, created_at`

### outbox  (0 rows in seed)
`id*, channel, to_addr, subject, body, status, related, created_at`

### pipeline_runs  (0 rows in seed)
`id*, pipeline_id, status, stages, rows_in, rows_out, rejected, started_at, finished_at, triggered_by`

### pipelines  (10 rows in seed)
`id*, name, dataset_id, schedule, status, last_run, stages, mode`

### playground_apps  (6 rows in seed)
`id*, kind, title_ko, title_en, description_ko, description_en, dept, prompt, uses, likes, owner_id, forked_from, created_at`

### program_favorites  (0 rows in seed)
`user_id*, program_id*, created_at`

### programs  (30 rows in seed)
`id*, title_ko, title_en, summary_ko, summary_en, type, target_ko, target_en, industries, countries, stages, customer_groups, sizes, apply_start, apply_end, event_start, event_end, dept_ko, dept_en, mode, region, status, eligibility, required_docs, benefit_ko, benefit_en, url, event_id, source_type, is_synthetic, created_at, updated_at`

### prompt_library  (4 rows in seed)
`id*, user_id, title, body, category, shared, uses, created_at`

### prompt_versions  (15 rows in seed)
`id*, agent_id, version, body, owner, status, last_test, test_score, created_at`

### quality_issues  (2 rows in seed)
`id*, dataset_id, severity, rule, detail, status, count, created_at, resolved_at`

### regulations  (40 rows in seed)
`id*, country, hs_prefix, industry, title_ko, title_en, body_ko, body_en, requirements, agency, source_url, updated_at, risk, source_type, is_synthetic, created_at`

### research_requests  (20 rows in seed)
`id*, kind, title, title_en, country, office, requester_id, assignee_id, status, due_date, form, opinion, report, supplement, evaluation, indexed_doc_id, source_type, is_synthetic, created_at, updated_at`

### rfp_coverage  (150 rows in seed)
`id*, category, name, task, module, screen, impl_status, demo_status, evidence, notes, detail`

### satisfaction  (44 rows in seed)
`id*, match_id, by_kind, score, comment, created_at`

### saved_items  (0 rows in seed)
`id*, user_id, kind, ref_id, title, payload, created_at`

### seq  (31 rows in seed)
`name*, n`

### sessions  (0 rows in seed)
`token*, user_id, created_at, expires_at, ip`

### settings  (4 rows in seed)
`k*, v`

### status_history  (37 rows in seed)
`id*, entity, entity_id, from_state, to_state, actor_id, note, ts`

### stt_jobs  (0 rows in seed)
`id*, consultation_id, filename, mode, state, stages, transcript, masked_count, duration_s, latency_ms, created_by, error, created_at`

### tool_defs  (24 rows in seed)
`id*, name_ko, name_en, risk_level, requires_approval, input_schema, output_schema, timeout_ms, enabled, integration, roles, rate_limit`

### tool_runs  (0 rows in seed)
`id*, run_id, tool_id, user_id, input, output_summary, status, risk_level, approval_id, latency_ms, provenance, created_at`

### trade_stats  (560 rows in seed)
`id*, country, hs_prefix, year, export_usd_m, import_usd_m, yoy, source_type, is_synthetic`

### users  (30 rows in seed)
`id*, email, name, name_en, role, company_id, buyer_id, office, title, pw_hash, locale, persona, active, created_at`
