# 08. 보안
| 통제 | 구현 |
|---|---|
| 인증/세션 | scrypt 해시, 서버 세션, 쿠키 HttpOnly·SameSite=Lax(+HTTPS 시 Secure), 로그인 시도 제한 |
| 권한 | 라우트별 역할 검사 + 객체 소유권 검사(타 기업 신청·상담·매칭 차단), 위반은 `access.denied` 감사 |
| 승인(HITL) | 신청 제출·상담 신청·메일 발송·조사 배정·뉴스 게시·MDM 병합은 승인 레코드 없이는 상태 변경 불가. 본인 승인(`self`)과 담당자 승인 구분, 요청자 자기승인 불가(담당자 승인 건), 이중 결정 409 |
| 감사 | `audit_events` SHA-256 해시체인(변조 검증 API/화면), AI 정책 차단·주요 조회·관리자 변경 기록, 개인정보 마스킹 |
| AI 안전 | 질의 PII(주민번호·카드) 차단, 프롬프트 인젝션 차단, 타 기업/관리자 정보 요청 차단(`customer.lookup_other` BLOCKED), 출력 PII 마스킹, 범위 밖 질의 유보, 분당/반복 질의 제한, 첨부 용량 제한 |
| Tool | 역할 허용목록·분당 한도·위험도 정책, HIGH Tool의 승인 요구는 해제 불가 |
| 웹 | CSP(`script-src 'self'`), X-Frame-Options DENY, nosniff, Referrer/Permissions-Policy, XSS 방지(DOM API만 사용, innerHTML 은 정적 아이콘 한정), 파라미터 바인딩 SQL |
| 공개 노출 | `PUBLIC_URL` 설정 시 HSTS·Secure 쿠키·Host 검증(421)·X-Forwarded-For 신뢰 제어·기본 데모 비밀번호 자동 폐기·스태프 원클릭 로그인 차단(`DEMO_ACCESS_CODE` 로만 허용)·`noindex` |
| 데이터 | 합성 데이터만 사용, 실제 개인정보 없음, 시드 내보내기에서 비밀번호 해시 제외 |
**미구현(본사업)**: MFA/SSO, DB 암호화(SER-013), 정적/동적 취약점 점검, 침투시험, WAF, 비밀관리(KMS).
