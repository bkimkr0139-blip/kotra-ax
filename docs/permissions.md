# 권한 (server/auth.js PERMS + 라우트 역할)
역할: customer(기업) · buyer · consultant(상담위원) · office(무역관) · admin. 접근범위: PUBLIC < MEMBER < INTERNAL < SENSITIVE < CONFIDENTIAL (clearance: anon 0, customer/buyer 1, office 2, consultant 3, admin 4).
전체 엔드포인트별 역할은 `05_API_CONTRACT.md`, 화면별 노출은 `public/js/app.js` 의 라우트 옵션과 `nav.js`.
