# 13. 배포 — https://kotra-ax2.wizbase.ai.kr/
## 사전 조건 (사용자 작업)
1. **DNS**: `kotra-ax2.wizbase.ai.kr` A 레코드 → 서버 공인 IP (현재 이 개발 머신의 공인 IP는 `218.152.119.49`). 아직 DNS에 등록되어 있지 않습니다(NXDOMAIN).
2. 서버에서 80/443 개방(공유기라면 포트포워딩). 포트를 열 수 없으면 Cloudflare Tunnel(`deploy/cloudflared-config.yml.example`) 사용.
## 경로 1 — Docker + Caddy (자동 HTTPS, 권장)
```bash
cp .env.production.example .env && $EDITOR .env      # DEMO_ACCESS_CODE 등 설정
docker compose --env-file .env up -d --build
curl -s https://kotra-ax2.wizbase.ai.kr/api/health
```
## 경로 2 — 베어메탈 (systemd + Caddy 또는 nginx)
```bash
sudo mkdir -p /opt/kotra-ax && sudo rsync -a ./ /opt/kotra-ax/ && cd /opt/kotra-ax
cp .env.production.example .env           # PUBLIC_URL/TRUST_PROXY 포함
sudo cp deploy/kotra-ax.service /etc/systemd/system/ && sudo systemctl enable --now kotra-ax
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy     # 또는 deploy/nginx-kotra-ax2.conf + certbot
```
## 공개 시 보안 체크리스트
- `PUBLIC_URL` 설정 → HSTS·Secure 쿠키·Host 검증·Forwarded-IP 신뢰(`TRUST_PROXY=true`)·기본 비밀번호 자동 교체(`data/.demo-password`, 0600).
- **데이터 통합 스튜디오**: `DATA_INTEGRATION_STUDIO_ENABLED`(시연 환경 기본 true). 합성 데이터만 사용하며 LIVE 연결은 비활성. 첫 부팅 시 기존 DB에도 원천 데모 테이블·메타를 자동 시드(`docs/16_DATA_INTEGRATION.md`). 3자 분리 `DI_STRICT_SOD=true`.
- **AX개발·AXOS**: 우측 탭과 관련 API는 기본 ON. 대고객 공개 시 `AX_DEV_DOCK=false`. Worker 토큰은 AXOS 콘솔에서 발급(또는 `AXOS_WORKER_TOKEN`), 기본 모드 `MANUAL`. 자세한 내용은 `docs/15_AX_DEV_LOOP.md`.
- **데모 페르소나**: `DEMO_ACCESS_CODE` 를 설정하지 않으면 기업·바이어 페르소나만 원클릭, 직원/관리자는 계정 로그인 필요. 코드를 설정하면 코드 입력 시 전체 허용. 완전 잠금은 `DEMO_MODE=false`.
- `OPEN_API_KEY` 변경, `ALLOWED_HOSTS` 확인, 앱은 `127.0.0.1` 바인딩(프록시만 공개).
- SSE(AI 스트리밍)는 프록시 버퍼링을 꺼야 합니다 (Caddy `flush_interval -1`, nginx `proxy_buffering off` 반영됨).
- 시연 데이터는 합성이지만 **관리자 권한을 가진 계정이 인터넷에 노출**되므로 강한 비밀번호/코드를 사용하세요. 검색엔진 차단(`X-Robots-Tag`) 포함.
## 검증
`/api/health` → `{"status":"UP"}`, 브라우저에서 로그인 후 AI 수출비서 질문, `관리자 > 모니터링`의 API p95, `관리자 > 감사로그`의 해시체인 정상.

## 배포 기록 (운영 중)
| 항목 | 값 |
|---|---|
| URL | https://kotra-ax2.wizbase.ai.kr/ (Let's Encrypt, certbot 자동 갱신) |
| 서버 | `tunneling-server` (Ubuntu 22.04, 140.238.31.159) — 기존 nginx(+frp 터널 도메인들)와 공존 |
| 앱 | `/opt/kotra-ax` (사용자 `kotra`), 전용 Node v24 `/opt/node-current` (시스템 Node 12는 변경 없음) |
| 서비스 | `systemctl status kotra-ax` · `journalctl -u kotra-ax -f` · 앱은 `127.0.0.1:4400` 에서만 수신 |
| 프록시 | `/etc/nginx/sites-available/kotra-ax2.wizbase.ai.kr` (SSE 버퍼링 off, `X-Forwarded-For=$remote_addr`) |
| 비밀값 | `/opt/kotra-ax/.env`(0600: 시연 접근 코드·Open API 키), `/opt/kotra-ax/data/.demo-password`(계정 로그인 비밀번호) |
| 백업 | **자동 백업 미설정** — 수동: `docs/14_OPERATIONS.md` 참고 (cron 은 별도 승인 후 추가) |
| 재배포 | `KEY=…/AI_Department.key ./deploy/push.sh` (rsync → 재시작 → 헬스체크; data/.env 는 보존) |
기존 frp 터널 방식 대신 서버 직접 호스팅을 택한 이유: 개발 PC가 꺼져도 서비스가 유지됩니다.
