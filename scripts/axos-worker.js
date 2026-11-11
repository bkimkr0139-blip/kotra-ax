#!/usr/bin/env node
'use strict';
// AXOS Worker — 승인된 작업지시서를 가져와 개발(선택) → 테스트 → 결과 보고. 의존성 없음(Node >= 22).
//   node scripts/axos-worker.js once | watch [--interval 60] | report <WO-ID> [--summary "..."]
// 환경변수: AXOS_URL(기본 http://localhost:4400) · AXOS_TOKEN(필수) · AXOS_WORKER(이름) · AXOS_EXEC(개발 명령, 예: claude -p ...)
//           AXOS_TEST_CMD(기본 "npm test") · AXOS_TIMEOUT_MIN(기본 30)
// 서버는 코드를 수정하지 않는다. Worker는 스스로 승인·수락할 수 없고, 금지 경로 변경·테스트 미통과는 서버가 자동 반려한다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const URL_ = (process.env.AXOS_URL || 'http://localhost:4400').replace(/\/$/, '');
const TOKEN = process.env.AXOS_TOKEN || '';
const WORKER = (process.env.AXOS_WORKER || `worker-${require('node:os').hostname()}`).replace(/[^\w.\-@]/g, '').slice(0, 60);
const TEST_CMD = process.env.AXOS_TEST_CMD || 'npm test';
const OUT = path.join(ROOT, '.axos');
const WATCH = ['public', 'server', 'seed', 'docs', 'test', 'scripts', 'deploy', 'README.md', 'package.json', '.env', 'data'];
const SKIP = /(^|\/)(node_modules|\.git|\.axos)(\/|$)|\.db(-wal|-shm)?$|\.log$|\.demo-password$/;

async function call(p, body) {
  const r = await fetch(URL_ + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ worker: WORKER, ...body }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${(j.error && j.error.message) || ''}`.trim()); return j;
}
function snapshot() {
  const out = {};
  const walk = (rel) => {
    const abs = path.join(ROOT, rel); if (!fs.existsSync(abs) || SKIP.test(rel)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) fs.readdirSync(abs).forEach((n) => walk(path.posix.join(rel, n)));
    else if (st.size < 3e6) out[rel] = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
  };
  WATCH.forEach(walk); return out;
}
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const snapFile = (id) => path.join(OUT, `snap-${id}.json`);

function runTests() {
  const r = spawnSync(TEST_CMD, { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000, env: { ...process.env, AXOS_TOKEN: '' } });
  const t = `${r.stdout || ''}\n${r.stderr || ''}`; const n = (k) => Number((t.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || t.match(new RegExp(`ℹ ${k} (\\d+)`)) || [])[1] || 0);
  const total = n('tests'); const failed = n('fail');
  return { cmd: TEST_CMD, total, passed: n('pass') || Math.max(0, total - failed), failed: r.status === 0 ? failed : Math.max(failed, 1) };
}
async function finish(id, summary) {
  const before = fs.existsSync(snapFile(id)) ? JSON.parse(fs.readFileSync(snapFile(id), 'utf8')) : {};
  const files = changed(before, snapshot()); const tests = runTests();
  console.log(`[axos] ${id}: ${files.length} changed file(s); tests ${tests.passed}/${tests.total}${tests.failed ? ` (${tests.failed} failed)` : ''}`);
  const r = await call(`/api/axos/worker/orders/${id}/report`, { summary: summary || `AXOS Worker(${WORKER}) 처리 — 변경 ${files.length}개 파일`, files, tests });
  console.log(`[axos] reported → ${r.status}${r.reasons && r.reasons.length ? ' · ' + r.reasons.join(' | ') : ''}`);
}
async function once() {
  const c = await call('/api/axos/worker/claim', {});
  if (!c.order) { console.log(`[axos] 대기 작업 없음 (mode ${c.mode}${c.reason ? ': ' + c.reason : ''})`); return false; }
  const o = c.order; fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${o.id}.md`); fs.writeFileSync(file, o.instruction_md); fs.writeFileSync(snapFile(o.id), JSON.stringify(snapshot()));
  console.log(`[axos] 착수 ${o.id} (${o.priority}/${o.risk}) → ${path.relative(ROOT, file)}`);
  const exec = process.env.AXOS_EXEC;
  if (!exec) { console.log(`[axos] AXOS_EXEC 가 없어 지시서만 저장했습니다. 직접 개발한 뒤: node scripts/axos-worker.js report ${o.id}`); return false; }
  const r = spawnSync(exec, { cwd: ROOT, shell: true, stdio: 'inherit', timeout: Number(process.env.AXOS_TIMEOUT_MIN || 30) * 60000, env: { ...process.env, AXOS_TOKEN: '', AXOS_ORDER_FILE: file, AXOS_ORDER_ID: o.id } });
  await finish(o.id, r.status === 0 ? undefined : `개발 명령 종료 코드 ${r.status}`);
  return true;
}
(async () => {
  const [cmd = 'once', ...rest] = process.argv.slice(2);
  if (!TOKEN) { console.error('AXOS_TOKEN 이 필요합니다 (관리자: AXOS 콘솔 > Worker 토큰 발급).'); process.exit(2); }
  try {
    if (cmd === 'once') await once();
    else if (cmd === 'report') { const i = rest.indexOf('--summary'); await finish(rest[0], i >= 0 ? rest[i + 1] : ''); }
    else if (cmd === 'watch') {
      const i = rest.indexOf('--interval'); const sec = Math.max(15, Number(i >= 0 ? rest[i + 1] : 60) || 60);
      for (;;) { try { await call('/api/axos/worker/heartbeat', { phase: 'idle' }); while (await once()) { /* drain */ } } catch (e) { console.error('[axos]', e.message); } await new Promise((r) => setTimeout(r, sec * 1000)); }
    } else { console.log('usage: axos-worker.js once | watch [--interval 60] | report <WO-ID> [--summary "..."]'); process.exit(1); }
  } catch (e) { console.error('[axos] 오류:', e.message); process.exit(1); }
})();
