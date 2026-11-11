// KOTRA-AX 통합 ERD — 실제 DB 메타데이터에서 만든 전체 모델을 ERwin(IDEF1X/IE) · DA#(#*o) 두 표기로 그리는 모델링 캔버스.
import { h, L, store, act, ic, toast, modal, errMsg, fmtNum, copyText } from '../lib.js';
import { dget, dapi, tbl, note, download, fetchText, fill, can, BASE } from './_di.js';

const LS_VIEW = 'kt.erd.view.v1'; const LS_POS = 'kt.erd.pos.v1';
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tw = (s, fs = 12) => [...String(s ?? '')].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? fs : fs * 0.56), 0);
const OUT = { R: [1, 0], L: [-1, 0], D: [0, 1], U: [0, -1] };
const ROW = 18; const HEAD = 34;

export async function unifiedErd({ query }) {
  const M = await dget('/erd/unified'); const ent = Object.fromEntries(M.entities.map((e) => [e.name, e])); const areaBy = Object.fromEntries(M.areas.map((a) => [a.key, a]));
  const saved = ls(LS_VIEW, {});
  const S = { notation: saved.notation || 'DA', names: saved.names || 'logical', detail: saved.detail || 'keys', layout: saved.layout || 'area', labels: !!saved.labels, fade: saved.fade !== false, soft: saved.soft !== false, logicalRel: saved.logicalRel !== false,
    areas: new Set(query.area ? String(query.area).split(',') : saved.areas || M.areas.map((a) => a.key)), selected: query.entity || null, focus: null, search: '' };
  const view = { x: 20, y: 20, k: 0.5 }; let pos = {}; let userPos = ls(LS_POS, {}); let dims = {}; let bounds = { w: 1000, h: 800 };
  const persist = () => lsSet(LS_VIEW, { notation: S.notation, names: S.names, detail: S.detail, layout: S.layout, labels: S.labels, fade: S.fade, soft: S.soft, logicalRel: S.logicalRel, areas: [...S.areas] });
  const nm = (e) => (S.names === 'physical' ? e.name : e.logical || e.name); const cn = (c) => (S.names === 'physical' ? c.name : c.logical || c.name);
  const adj = new Map(); M.relations.forEach((r) => { (adj.get(r.from) || adj.set(r.from, new Set()).get(r.from)).add(r.to); (adj.get(r.to) || adj.set(r.to, new Set()).get(r.to)).add(r.from); });
  const neighborsOf = (n, depth = 1) => { const seen = new Set([n]); let fr = [n]; for (let d = 0; d < depth; d++) { const nx = []; fr.forEach((x) => (adj.get(x) || []).forEach((y) => { if (!seen.has(y)) { seen.add(y); nx.push(y); } })); fr = nx; } return seen; };
  const visibleSet = () => { if (S.focus) return neighborsOf(S.focus.name, S.focus.depth); return new Set(M.entities.filter((e) => S.areas.has(e.area)).map((e) => e.name)); };
  const visibleRels = (vis) => M.relations.filter((r) => vis.has(r.from) && vis.has(r.to) && (S.soft || !r.soft) && (S.logicalRel || r.declared || r.soft));

  // ── 엔터티 크기/행 구성(표기·상세도에 따라) ──
  const rowsOf = (e) => { const pk = e.columns.filter((c) => c.pk); const rest = e.columns.filter((c) => !c.pk); if (S.detail === 'entity') return { pk: [], rest: [] }; if (S.detail === 'keys') return { pk, rest: rest.filter((c) => c.fk) }; return { pk, rest }; };
  const isDependent = (e) => M.relations.some((r) => r.from === e.name && r.identifying);
  const textOf = (c, e) => {
    if (S.notation === 'DA') { const mark = c.pk ? '#' : !c.nullable ? '*' : 'o'; return { mark, name: S.names === 'both' ? `${c.logical} (${c.name})` : cn(c), type: S.names === 'logical' ? c.domain : c.type }; }
    const tag = `${c.pk && c.fk ? ' (PK)(FK)' : c.pk ? ' (PK)' : c.fk ? ' (FK)' : ''}`; return { mark: '', name: `${S.names === 'both' ? `${c.logical} (${c.name})` : cn(c)}${tag}`, type: S.names === 'logical' ? c.domain : c.type };
  };
  const sizeOf = (e) => {
    const r = rowsOf(e); const all = [...r.pk, ...r.rest]; let w = Math.max(tw(nm(e), 12.5) + 28, S.names === 'both' ? tw(e.name, 10) + 28 : 0, 160);
    all.forEach((c) => { const t = textOf(c, e); w = Math.max(w, 18 + tw(t.name, 11.5) + 22 + tw(t.type, 10.5) + 14); });
    const bodyH = S.detail === 'entity' ? 10 : all.length * ROW + (r.pk.length && r.rest.length ? 6 : 0) + 8; return { w: Math.min(Math.ceil(w), 420), h: (S.notation === 'DA' ? HEAD + (S.names === 'both' ? 12 : 0) : 30) + bodyH };
  };

  // ── 주제영역 레인 배치 ──
  const layoutAll = (maxRow = 2400) => {
    const vis = visibleSet(); dims = {}; pos = {}; const lanes = [];
    let cx = 30; let cy = 30; let rowH = 0;
    const areaList = S.focus ? [{ key: '_focus', ko: L('연관 엔터티', 'Related entities') }] : M.areas.filter((a) => S.areas.has(a.key));
    for (const a of areaList) {
      const list = M.entities.filter((e) => vis.has(e.name) && (S.focus || e.area === a.key)).sort((x, y) => (adj.get(y.name) || { size: 0 }).size - (adj.get(x.name) || { size: 0 }).size);
      if (!list.length) continue; list.forEach((e) => { dims[e.name] = sizeOf(e); });
      const ncol = Math.max(1, Math.min(S.focus ? 5 : 4, Math.ceil(Math.sqrt(list.length * (S.detail === 'all' ? 1.0 : 1.5))))); const colW = Array(ncol).fill(0); const colY = Array(ncol).fill(0); const place = [];
      list.forEach((e, i) => { const c = i % ncol; place.push({ e, c, y: colY[c] }); colY[c] += dims[e.name].h + (S.notation === 'ERWIN' ? 70 : 44); colW[c] = Math.max(colW[c], dims[e.name].w); });
      const xs = [26]; colW.forEach((w, i) => { xs[i + 1] = xs[i] + w + 56; }); const laneW = xs[ncol] - 56 + 26; const laneH = Math.max(...colY) + 64;
      if (cx + laneW > maxRow && cx > 30) { cx = 30; cy += rowH + 40; rowH = 0; }
      place.forEach(({ e, c, y }) => { pos[e.name] = { x: cx + xs[c], y: cy + 52 + y }; });
      lanes.push({ a, x: cx, y: cy, w: laneW, h: laneH, count: list.length }); cx += laneW + 40; rowH = Math.max(rowH, laneH);
    }
    Object.entries(userPos).forEach(([n, p]) => { if (pos[n]) pos[n] = { x: p[0], y: p[1] }; });
    let mx = 0; let my = 0; Object.entries(pos).forEach(([n, p]) => { mx = Math.max(mx, p.x + dims[n].w + 60); my = Math.max(my, p.y + dims[n].h + 60); }); lanes.forEach((l) => { mx = Math.max(mx, l.x + l.w + 30); my = Math.max(my, l.y + l.h + 30); }); bounds = { w: mx, h: my };
    return lanes;
  };

  // 캔버스 가로세로비에 맞춰 레인 줄바꿈 폭을 골라 한눈에 보이는(확대율이 가장 큰) 배치를 쓴다.
  const bestLayout = () => {
    const cw = stage.clientWidth || 900; const ch = stage.clientHeight || 700; let best = null;
    for (const mr of [1500, 2000, 2700, 3600, 4800, 6400, 8500]) { const l = layoutAll(mr); const k = Math.min((cw - 30) / bounds.w, (ch - 30) / bounds.h); if (!best || k > best.k * 1.02) best = { k, mr }; }
    return layoutAll(best.mr);
  };

  // ── 관계선(직교 라우팅 + IE 표기) ──
  const route = (a, b) => {
    const ac = [a.x + a.w / 2, a.y + a.h / 2]; const bc = [b.x + b.w / 2, b.y + b.h / 2]; const dx = bc[0] - ac[0]; const dy = bc[1] - ac[1];
    if (Math.abs(dx) > Math.abs(dy) * 0.6 || (a.x + a.w < b.x - 30) || (b.x + b.w < a.x - 30)) { const s = dx >= 0 ? [a.x + a.w, ac[1], 'R'] : [a.x, ac[1], 'L']; const t = dx >= 0 ? [b.x, bc[1], 'L'] : [b.x + b.w, bc[1], 'R']; const mx = (s[0] + t[0]) / 2; return { d: `M${s[0]} ${s[1]}H${mx}V${t[1]}H${t[0]}`, s, t, mid: [mx, (s[1] + t[1]) / 2] }; }
    const s = dy >= 0 ? [ac[0], a.y + a.h, 'D'] : [ac[0], a.y, 'U']; const t = dy >= 0 ? [bc[0], b.y, 'U'] : [bc[0], b.y + b.h, 'D']; const my = (s[1] + t[1]) / 2; return { d: `M${s[0]} ${s[1]}V${my}H${t[0]}V${t[1]}`, s, t, mid: [(s[0] + t[0]) / 2, my] };
  };
  const crow = (x, y, d, c) => { const [ox, oy] = OUT[d]; const bx = x + ox * 12; const by = y + oy * 12; const px = -oy; const py = ox; return `<path d="M${bx} ${by}L${x + px * 6} ${y + py * 6}M${bx} ${by}L${x} ${y}M${bx} ${by}L${x - px * 6} ${y - py * 6}" stroke="${c}" fill="none" stroke-width="1.3"/>`; };
  const tick = (x, y, d, off, c) => { const [ox, oy] = OUT[d]; const cx = x + ox * off; const cy = y + oy * off; const px = -oy; const py = ox; return `<path d="M${cx + px * 5} ${cy + py * 5}L${cx - px * 5} ${cy - py * 5}" stroke="${c}" stroke-width="1.4"/>`; };
  const ring = (x, y, d, off, c) => { const [ox, oy] = OUT[d]; return `<circle cx="${x + ox * off}" cy="${y + oy * off}" r="4" fill="#fff" stroke="${c}" stroke-width="1.3"/>`; };
  const relHtml = (vis) => visibleRels(vis).map((r) => {
    const a = pos[r.from]; const b = pos[r.to]; if (!a || !b) return ''; const ra = { ...a, ...dims[r.from] }; const rb = { ...b, ...dims[r.to] }; const p = r.from === r.to ? null : route(ra, rb); if (!p) return `<path d="M${ra.x + ra.w} ${ra.y + 40}h26v26h-26" fill="none" stroke="#64748b" stroke-width="1.3"/>`;
    const hot = S.selected && (r.from === S.selected || r.to === S.selected); const dim = S.selected && S.fade && !hot; const color = hot ? '#d97706' : r.verified && r.verified.ok === false ? '#d4182b' : r.soft ? '#94a3b8' : '#475569';
    const dash = r.soft ? '2 4' : (S.notation === 'ERWIN' && !r.identifying) || (!r.declared && S.notation !== 'ERWIN' && false) ? '7 4' : '';
    const label = S.labels ? `<text x="${p.mid[0]}" y="${p.mid[1] - 4}" font-size="9.5" fill="${hot ? '#b45309' : '#64748b'}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(S.names === 'physical' ? r.fromCol : (ent[r.from].columns.find((c) => c.name === r.fromCol) || {}).logical || r.fromCol)}</text>` : '';
    const parentEnd = r.optional ? ring(p.t[0], p.t[1], p.t[2], 6, color) + tick(p.t[0], p.t[1], p.t[2], 14, color) : tick(p.t[0], p.t[1], p.t[2], 7, color) + tick(p.t[0], p.t[1], p.t[2], 13, color);
    return `<g class="rel" data-from="${esc(r.from)}" data-to="${esc(r.to)}" opacity="${dim ? 0.12 : 1}"><path d="${p.d}" fill="none" stroke="${color}" stroke-width="${hot ? 2.2 : 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${crow(p.s[0], p.s[1], p.s[2], color)}${parentEnd}${label}</g>`;
  }).join('');

  // ── 엔터티 그리기 ──
  const entHtml = (e) => {
    const p = pos[e.name]; const d = dims[e.name]; const r = rowsOf(e); const col = areaBy[e.area].color; const sel = S.selected === e.name; const hit = S.search && (e.name.includes(S.search) || (e.logical || '').includes(S.search)); const dim = S.selected && S.fade && !sel && !neighborsOf(S.selected).has(e.name);
    const op = dim ? 0.25 : 1; let y = 0; const out = [];
    const rowsSvg = (list, base, sepAfter) => list.map((c, i) => { const t = textOf(c, e); const yy = base + i * ROW + 13; const k = S.notation === 'DA' ? `<text x="9" y="${yy}" font-size="11.5" font-weight="800" fill="${c.pk ? '#b45309' : !c.nullable ? '#0b4ea2' : '#94a3b8'}">${t.mark}</text>` : '';
      return `${k}<text x="${S.notation === 'DA' ? 22 : 8}" y="${yy}" font-size="11.5" fill="#14202e" font-weight="${c.pk ? 700 : 400}" data-col="${esc(c.name)}">${esc(t.name)}</text><text x="${d.w - 8}" y="${yy}" font-size="10" fill="#8693a4" text-anchor="end">${esc(t.type)}</text>`; }).join('');
    if (S.notation === 'DA') {
      const hh = HEAD + (S.names === 'both' ? 12 : 0); out.push(`<rect x="0" y="0" width="${d.w}" height="${d.h}" rx="5" fill="#fff" stroke="${sel ? '#f59e0b' : '#b6c2d3'}" stroke-width="${sel ? 2.6 : 1.2}"/><path d="M0 ${hh} V5 a5 5 0 0 1 5 -5 H${d.w - 5} a5 5 0 0 1 5 5 V${hh}Z" fill="${col}"/>`);
      out.push(`<text x="10" y="${S.names === 'both' ? 17 : 21}" font-size="12.5" font-weight="700" fill="#fff">${esc(nm(e))}</text>`); if (S.names === 'both') out.push(`<text x="10" y="${hh - 7}" font-size="9.5" fill="#e2ecff" font-family="monospace">${esc(e.name)}</text>`);
      if (S.detail !== 'entity') { out.push(rowsSvg(r.pk, hh + 4)); if (r.pk.length && r.rest.length) out.push(`<line x1="0" x2="${d.w}" y1="${hh + 4 + r.pk.length * ROW + 3}" y2="${hh + 4 + r.pk.length * ROW + 3}" stroke="#94a3b8"/>`); out.push(rowsSvg(r.rest, hh + 4 + r.pk.length * ROW + (r.pk.length && r.rest.length ? 6 : 0))); }
    } else { // ERwin: 엔터티명은 박스 위, PK 구획 / 비키 구획, 종속(식별관계 자식) 엔터티는 둥근 모서리
      const rx = isDependent(e) ? 9 : 0; out.push(`<text x="0" y="14" font-size="12.5" font-weight="700" fill="${col}">${esc(nm(e))}</text>${S.names === 'both' ? `<text x="${tw(nm(e), 12.5) + 8}" y="14" font-size="10" fill="#94a3b8" font-family="monospace">${esc(e.name)}</text>` : ''}`);
      const top = 22; const bh = d.h - 22; out.push(`<rect x="0" y="${top}" width="${d.w}" height="${bh}" rx="${rx}" fill="#fff" stroke="${sel ? '#f59e0b' : '#1f2937'}" stroke-width="${sel ? 2.6 : 1.4}"/>`);
      if (S.detail !== 'entity') { out.push(rowsSvg(r.pk, top + 3)); if (r.pk.length) out.push(`<line x1="0" x2="${d.w}" y1="${top + 3 + r.pk.length * ROW + 2}" y2="${top + 3 + r.pk.length * ROW + 2}" stroke="#1f2937" stroke-width="1.3"/>`); out.push(rowsSvg(r.rest, top + 3 + r.pk.length * ROW + 5)); }
    }
    void y; return `<g class="ent" data-ent="${esc(e.name)}" transform="translate(${p.x} ${p.y})" opacity="${op}" tabindex="0" role="button" aria-label="${esc(nm(e))}">${hit ? `<rect x="-6" y="-6" width="${d.w + 12}" height="${d.h + 12}" rx="8" fill="#fde68a" opacity=".55"/>` : ''}${out.join('')}</g>`;
  };

  // ── UI 구성 ──
  const stage = h('div.erd-stage', { tabindex: 0, 'aria-label': L('통합 ERD 캔버스 — 드래그로 이동, 휠로 확대/축소, 엔터티 드래그로 배치', 'Unified ERD canvas — drag to pan, wheel to zoom, drag entities to arrange') }); const svgHost = h('div.erd-svg-host'); stage.append(svgHost);
  const mini = h('div.erd-mini', { 'aria-hidden': 'true' }); const insp = h('div.erd-insp'); const tree = h('div.ax-tree', { style: 'max-height:640px' }); const legend = h('div.erd-legend');
  let svgEl = null; let relG = null; let laneList = [];
  const applyView = () => { if (svgEl) svgEl.setAttribute('style', `transform:translate(${view.x}px,${view.y}px) scale(${view.k});transform-origin:0 0`); drawMini(); };
  const fit = (tries = 0) => { if ((!stage.isConnected || !stage.clientWidth) && tries < 40) { requestAnimationFrame(() => fit(tries + 1)); return; } view.k = Math.max(0.08, Math.min(1.1, Math.min((stage.clientWidth - 30) / bounds.w, (stage.clientHeight - 30) / bounds.h))); view.x = Math.max(15, (stage.clientWidth - bounds.w * view.k) / 2); view.y = Math.max(15, (stage.clientHeight - bounds.h * view.k) / 2); applyView(); };
  function drawMini() {
    if (!svgEl || !Object.keys(pos).length) { mini.innerHTML = ''; return; } const w = 170; const k = w / bounds.w; const hh = Math.min(120, bounds.h * k); const sc = Math.min(k, hh / bounds.h);
    const rects = Object.entries(pos).map(([n, p]) => `<rect x="${p.x * sc}" y="${p.y * sc}" width="${Math.max(2, dims[n].w * sc)}" height="${Math.max(2, dims[n].h * sc)}" fill="${areaBy[ent[n].area].color}" opacity=".75"/>`).join('');
    const vx = -view.x / view.k * sc; const vy = -view.y / view.k * sc; const vw = stage.clientWidth / view.k * sc; const vh = stage.clientHeight / view.k * sc;
    mini.innerHTML = `<svg width="${bounds.w * sc}" height="${bounds.h * sc}" viewBox="0 0 ${bounds.w * sc} ${bounds.h * sc}">${rects}<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="rgba(245,158,11,.12)" stroke="#f59e0b" stroke-width="1.5"/></svg>`; mini.dataset.sc = String(sc);
  }
  mini.addEventListener('pointerdown', (e) => { const sc = Number(mini.dataset.sc) || 1; const r = mini.getBoundingClientRect(); const mx = (e.clientX - r.left) / sc; const my = (e.clientY - r.top) / sc; view.x = stage.clientWidth / 2 - mx * view.k; view.y = stage.clientHeight / 2 - my * view.k; applyView(); });

  function render(keepView = true) {
    const vis = visibleSet(); laneList = bestLayout(); const ents = M.entities.filter((e) => vis.has(e.name) && pos[e.name]);
    const lanes = laneList.map((l) => `<g class="lane"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="14" fill="${l.a.color || '#64748b'}" opacity=".06" stroke="${l.a.color || '#64748b'}" stroke-opacity=".35"/><text x="${l.x + 16}" y="${l.y + 28}" font-size="15" font-weight="800" fill="${l.a.color || '#334155'}">${esc(S.focus ? L('연관 엔터티', 'Related entities') : L(l.a.ko, l.a.en))}</text><text x="${l.x + l.w - 14}" y="${l.y + 28}" font-size="11" fill="#64748b" text-anchor="end">${l.count} ${L('엔터티', 'entities')}</text></g>`).join('');
    svgHost.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.w}" height="${bounds.h}" viewBox="0 0 ${bounds.w} ${bounds.h}" font-family="Pretendard,'Noto Sans KR',sans-serif"><g id="lanes">${lanes}</g><g id="rels">${relHtml(vis)}</g><g id="ents">${ents.map(entHtml).join('')}</g></svg>`;
    svgEl = svgHost.querySelector('svg'); relG = svgEl.querySelector('#rels'); applyView(); if (!keepView) fit(); drawTree(); drawLegend(); stat.textContent = `${ents.length} ${L('엔터티', 'entities')} · ${visibleRels(vis).length} ${L('관계', 'relations')}`;
  }
  const redrawRels = () => { relG.innerHTML = relHtml(visibleSet()); };
  const rerender = () => { persist(); render(true); }; const rerenderFit = () => { persist(); render(false); };

  // ── 상호작용: 이동·확대·드래그 ──
  let pan = null; let dragEnt = null; let moved = false; let lastTap = { n: '', t: 0 };
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.areabox') || e.target.closest('.erd-mini')) return; const g = e.target.closest('[data-ent]'); moved = false; if (g) { const n = g.getAttribute('data-ent'); dragEnt = { n, sx: e.clientX, sy: e.clientY, ox: pos[n].x, oy: pos[n].y, g }; } else pan = { x: e.clientX - view.x, y: e.clientY - view.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('drag'); });
  stage.addEventListener('pointermove', (e) => { if (dragEnt) { const dx = (e.clientX - dragEnt.sx) / view.k; const dy = (e.clientY - dragEnt.sy) / view.k; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; if (!moved) return; pos[dragEnt.n] = { x: Math.max(0, dragEnt.ox + dx), y: Math.max(0, dragEnt.oy + dy) }; dragEnt.g.setAttribute('transform', `translate(${pos[dragEnt.n].x} ${pos[dragEnt.n].y})`); if (!dragEnt.raf) dragEnt.raf = requestAnimationFrame(() => { dragEnt.raf = 0; redrawRels(); }); } else if (pan) { view.x = e.clientX - pan.x; view.y = e.clientY - pan.y; applyView(); } });
  stage.addEventListener('pointerup', () => { if (dragEnt && moved) { userPos[dragEnt.n] = [Math.round(pos[dragEnt.n].x), Math.round(pos[dragEnt.n].y)]; lsSet(LS_POS, userPos); redrawRels(); } else if (dragEnt && !moved) { const now = Date.now(); if (lastTap.n === dragEnt.n && now - lastTap.t < 450) { S.focus = { name: dragEnt.n, depth: 1 }; S.selected = dragEnt.n; lastTap = { n: '', t: 0 }; rerenderFit(); showInsp(); } else { lastTap = { n: dragEnt.n, t: now }; select(dragEnt.n); } } dragEnt = null; pan = null; stage.classList.remove('drag'); });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 0.89; const r = stage.getBoundingClientRect(); const px = e.clientX - r.left; const py = e.clientY - r.top; view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.k = Math.max(0.05, Math.min(3, view.k * f)); applyView(); }, { passive: false });
    stage.addEventListener('keydown', (e) => { if (e.key === '+') { view.k *= 1.12; applyView(); } if (e.key === '-') { view.k *= 0.89; applyView(); } if (e.key === '0') fit(); if (e.key === 'Escape') { S.focus = null; S.selected = null; rerender(); showInsp(); } });

  const centerOn = (n) => { const p = pos[n]; if (!p) return; view.x = stage.clientWidth / 2 - (p.x + dims[n].w / 2) * view.k; view.y = stage.clientHeight / 2 - (p.y + dims[n].h / 2) * view.k; applyView(); };
  function select(n, center = false) { S.selected = n; render(true); showInsp(); if (center) centerOn(n); }

  // ── 인스펙터 ──
  function showInsp() {
    const n = S.selected; const e = ent[n]; if (!e) { fill(insp, h('h3', { style: 'margin:0' }, L('KOTRA-AX 통합 데이터 구조', 'KOTRA-AX unified data structure')), h('p.small.muted', L('엔터티를 클릭하면 속성·관계·DDL이 표시됩니다. 더블클릭 = 연관 엔터티만 보기, Esc = 해제.', 'Click an entity for attributes, relations and DDL. Double-click = focus on neighbours, Esc = clear.')), areaTable()); return; }
    const parents = M.relations.filter((r) => r.from === n); const children = M.relations.filter((r) => r.to === n); const arch = can('DataArchitect');
    const lg = h('input', { type: 'text', value: e.logical, 'aria-label': L('엔터티 논리명', 'Entity logical name'), disabled: !arch, style: 'width:100%' }); const df = h('textarea', { rows: 2, 'aria-label': L('엔터티 정의', 'Entity definition'), disabled: !arch, style: 'width:100%' }, e.definition || '');
    const colRows = e.columns.map((c) => { const inp = h('input', { type: 'text', value: c.logical, disabled: !arch, 'aria-label': `${c.name} ${L('논리명', 'logical name')}`, onchange: act(async (ev) => { await dapi('PUT', '/glossary', { kind: 'column', target: `${e.name}.${c.name}`, logical: ev.target.value }); c.logical = ev.target.value; toast(L('논리명을 저장했습니다.', 'Logical name saved.'), 'ok'); render(true); }) });
      return h('div.erd-col', h('span', { title: c.pk ? 'PK' : c.fk ? 'FK' : '' }, c.pk ? '🔑' : c.fk ? '↗' : ''), h('div', h('code.xs', c.name), h('div.xs.muted', `${c.type} · ${c.domain}${c.nullable ? '' : ' · NOT NULL'}`), c.fk ? h('div.xs', { style: 'color:var(--c-primary)' }, `→ ${c.fk}`) : null), inp); });
    fill(insp, h('div.row.row-between', h('h3', { style: 'margin:0' }, e.logical), h('span.badge', { style: `background:${areaBy[e.area].color};color:#fff` }, L(areaBy[e.area].ko, areaBy[e.area].en))),
      h('div.xs.muted', `${e.name} · ${fmtNum(e.rows ?? 0)} rows · PK ${e.pkCols.join('+') || '-'}${isDependent(e) ? ` · ${L('종속 엔터티', 'dependent')}` : ''}`),
      arch ? h('div.stack-sm', h('label.lbl', L('논리명(엔터티)', 'Logical name')), lg, h('label.lbl', L('정의', 'Definition')), df, h('button.btn.btn-sm.btn-primary', { onclick: act(async () => { await dapi('PUT', '/glossary', { kind: 'table', target: e.name, logical: lg.value, definition: df.value }); e.logical = lg.value; e.definition = df.value; toast(L('저장했습니다.', 'Saved.'), 'ok'); render(true); showInsp(); }) }, L('논리명·정의 저장', 'Save'))) : (e.definition ? h('p.small', e.definition) : null),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.btn-sm', { onclick: () => { S.focus = { name: n, depth: 1 }; rerenderFit(); } }, L('연관 엔터티만(1단계)', 'Neighbours (1)')), h('button.btn.btn-sm', { onclick: () => { S.focus = { name: n, depth: 2 }; rerenderFit(); } }, L('2단계', '2 levels')), h('button.btn.btn-sm', { onclick: act(async () => { const t = await fetchText(`/erd/unified/export?format=ddl&area=${e.area}`); const only = t.split('\n\n').filter((b) => b.includes(`CREATE TABLE ${e.name} (`)).join('\n\n'); modal({ title: `DDL · ${e.name}`, size: 'wide', body: h('pre.ax-code', only || '-'), footer: (c) => [h('button.btn', { onclick: () => copyText(only) }, L('복사', 'Copy')), h('button.btn', { onclick: c }, L('닫기', 'Close'))] }); }) }, 'DDL')),
      h('div', h('b.small', L('속성', 'Attributes')), h('div.erd-cols', colRows)),
      h('div', h('b.small', `${L('상위(부모) 관계', 'Parent relations')} (${parents.length})`), h('ul.xs.erd-rel', parents.map((r) => h('li', { onclick: () => select(r.to, true) }, `${r.fromCol} → ${ent[r.to].logical}.${r.toCol} · ${r.identifying ? L('식별', 'identifying') : L('비식별', 'non-identifying')}${r.optional ? ' · ' + L('선택', 'optional') : ''}${r.declared ? ' · FK' : r.soft ? ' · ' + L('논리(다형)', 'soft') : ' · ' + L('논리', 'logical')}${r.verified ? (r.verified.ok ? ` ✓${r.verified.checked}` : ` ⚠${r.verified.missing}`) : ''}`)))),
      h('div', h('b.small', `${L('하위(자식) 관계', 'Child relations')} (${children.length})`), h('ul.xs.erd-rel', children.map((r) => h('li', { onclick: () => select(r.from, true) }, `${ent[r.from].logical}.${r.fromCol} ← ${r.optional ? L('선택', 'optional') : L('필수', 'mandatory')} ${r.identifying ? L('식별', 'identifying') : L('비식별', 'non-identifying')}`)))));
  }
  const areaTable = () => tbl([{ label: L('주제영역', 'Subject area') }, { label: L('엔터티', 'Entities') }, { label: L('컬럼', 'Columns') }], M.areas.map((a) => [h('span', h('i', { style: `display:inline-block;width:10px;height:10px;border-radius:3px;background:${a.color};margin-right:6px` }), L(a.ko, a.en)), a.entities, a.columns]));

  // ── 모델 탐색기 / 범례 ──
  function drawTree() {
    const t = S.search.toLowerCase(); const vis = visibleSet();
    fill(tree, ...M.areas.map((a) => { const list = M.entities.filter((e) => e.area === a.key && (!t || e.name.includes(t) || (e.logical || '').toLowerCase().includes(t))); if (!list.length) return null; return h('details', { open: !!t || list.some((e) => e.name === S.selected) }, h('summary', h('i', { style: `display:inline-block;width:9px;height:9px;border-radius:3px;background:${a.color};margin-right:6px` }), L(a.ko, a.en), ' ', h('span.ax-cnt', list.length)), list.map((e) => h('button', { type: 'button', class: 'ax-node', 'aria-current': String(e.name === S.selected), style: vis.has(e.name) ? '' : 'opacity:.45', onclick: () => { if (!vis.has(e.name)) { S.areas.add(e.area); S.focus = null; render(true); } select(e.name, true); } }, h('span', e.logical), h('span.xs.muted', e.name)))); }));
  }
  function drawLegend() {
    const items = S.notation === 'DA' ? [['#', L('식별자(PK)', 'Identifier (PK)'), '#b45309'], ['*', L('필수(NOT NULL)', 'Mandatory'), '#0b4ea2'], ['o', L('선택(NULL 허용)', 'Optional'), '#94a3b8']] : [['(PK)', L('기본키 — 선 위쪽 구획', 'Primary key — upper compartment'), '#1f2937'], ['(FK)', L('외래키', 'Foreign key'), '#1f2937']];
    fill(legend, h('b.xs', S.notation === 'DA' ? 'DA# (IE)' : 'ERwin (IDEF1X / IE)'), items.map(([k, t, c]) => h('span.xs', h('b', { style: `color:${c};margin-right:4px` }, k), t)), h('span.xs', L('까마귀발 = 자식(N) · | = 부모 필수 · ○ = 부모 선택', 'Crow’s foot = child (N) · | = mandatory parent · ○ = optional parent')), S.notation === 'ERWIN' ? h('span.xs', L('실선 = 식별관계 · 점선 = 비식별관계 · 둥근 박스 = 종속 엔터티', 'Solid = identifying · dashed = non-identifying · rounded = dependent entity')) : null, h('span.xs', L('점선(회색) = 논리·다형 참조(물리 FK 아님)', 'Grey dotted = logical / polymorphic reference (no physical FK)')));
  }

  // ── 주제영역 관계도(개요) ──
  function overview() {
    const W = 1500; const cols = 5; const bw = 250; const bh = 96; const gx = 70; const gy = 70; const poss = {}; M.areas.forEach((a, i) => { poss[a.key] = { x: 30 + (i % cols) * (bw + gx), y: 30 + Math.floor(i / cols) * (bh + gy) }; }); void W;
    const lines = M.area_links.map((l) => { const a = poss[l.from]; const b = poss[l.to]; if (!a || !b) return ''; const s = [a.x + bw / 2, a.y + bh / 2]; const t = [b.x + bw / 2, b.y + bh / 2]; const mx = (s[0] + t[0]) / 2; const my = (s[1] + t[1]) / 2; return `<g><path d="M${s[0]} ${s[1]}L${t[0]} ${t[1]}" stroke="#94a3b8" stroke-width="${1 + Math.min(4, l.count / 2)}" opacity=".55" fill="none"/><circle cx="${mx}" cy="${my}" r="10" fill="#fff" stroke="#94a3b8"/><text x="${mx}" y="${my + 4}" font-size="10" text-anchor="middle" fill="#475569">${l.count}</text></g>`; }).join('');
    const boxes = M.areas.map((a) => `<g class="areabox" data-area="${a.key}" transform="translate(${poss[a.key].x} ${poss[a.key].y})" style="cursor:pointer" tabindex="0" role="button"><rect width="${bw}" height="${bh}" rx="12" fill="#fff" stroke="${a.color}" stroke-width="2"/><rect width="${bw}" height="30" rx="12" fill="${a.color}"/><rect y="18" width="${bw}" height="12" fill="${a.color}"/><text x="12" y="20" font-size="13" font-weight="700" fill="#fff">${esc(L(a.ko, a.en))}</text><text x="12" y="56" font-size="12" fill="#334155">${a.entities} ${L('엔터티', 'entities')} · ${a.columns} ${L('컬럼', 'columns')}</text><text x="12" y="78" font-size="10.5" fill="#64748b">${esc(M.entities.filter((e) => e.area === a.key).slice(0, 3).map((e) => e.logical).join(', '))}…</text></g>`).join('');
    const w = 60 + cols * (bw + gx); const hh = 60 + Math.ceil(M.areas.length / cols) * (bh + gy);
    bounds = { w, h: hh }; pos = {}; dims = {}; svgHost.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" font-family="Pretendard,'Noto Sans KR',sans-serif">${lines}${boxes}</svg>`; svgEl = svgHost.querySelector('svg'); fill(mini); stat.textContent = `${M.areas.length} ${L('주제영역', 'areas')} · ${M.area_links.length} ${L('영역 간 관계', 'cross-area links')}`; applyView(); fit(); fill(legend, h('span.xs', L('주제영역 박스를 클릭하면 해당 영역의 상세 ERD로 이동합니다. 선 위 숫자 = 영역 간 관계 수.', 'Click an area to open its detailed ERD. Line numbers = cross-area relations.')));
    svgEl.querySelectorAll('.areabox').forEach((g) => g.addEventListener('click', () => { S.areas = new Set([g.getAttribute('data-area')]); S.layout = 'area'; setLayout('area'); }));
  }
  const setLayout = (v) => { S.layout = v; persist(); layoutSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); syncChips(); if (v === 'overview') { overview(); } else { render(false); showInsp(); } };

  // ── 툴바 ──
  const stat = h('span.badge.b-info'); const seg = (key, opts, onchange) => h('div.seg', { role: 'group' }, opts.map(([v, ko, en]) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(S[key] === v), onclick: (e) => { S[key] = v; [...e.currentTarget.parentNode.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); onchange(); } }, L(ko, en))));
  const notationSeg = seg('notation', [['ERWIN', 'ERwin', 'ERwin'], ['DA', 'DA#', 'DA#']], () => { rerenderFit(); }); const namesSeg = seg('names', [['logical', '논리(한글)', 'Logical'], ['physical', '물리(영문)', 'Physical'], ['both', '병기', 'Both']], () => { rerenderFit(); }); const detailSeg = seg('detail', [['entity', '엔터티', 'Entity'], ['keys', '키 속성', 'Keys'], ['all', '전체 속성', 'All']], () => { rerenderFit(); });
  const layoutSeg = seg('layout', [['area', '주제영역별 ERD', 'By subject area'], ['overview', '주제영역 관계도', 'Area map']], () => setLayout(S.layout));
  const chk = (key, ko, en) => h('label.check', h('input', { type: 'checkbox', checked: S[key], onchange: (e) => { S[key] = e.target.checked; if (S.layout === 'area') rerender(); persist(); } }), h('span', L(ko, en)));
  const chips = h('div.row', { style: 'gap:6px;flex-wrap:wrap' }); const syncChips = () => fill(chips, h('button', { class: 'ax-chip', onclick: () => { S.areas = new Set(M.areas.map((a) => a.key)); S.focus = null; setLayout(S.layout === 'overview' ? 'area' : S.layout); } }, L('전체', 'All')), h('button', { class: 'ax-chip', onclick: () => { S.areas = new Set(['DS', 'DR', 'DM', 'DQ', 'DP', 'DV']); S.focus = null; setLayout('area'); } }, L('데이터 통합 계층', 'Integration layers')), M.areas.map((a) => h('button', { type: 'button', class: 'ax-chip', 'aria-pressed': String(S.areas.has(a.key) && !S.focus), style: `--c:${a.color}`, title: `${a.entities} ${L('엔터티', 'entities')}`, onclick: () => { S.focus = null; if (S.areas.has(a.key)) S.areas.delete(a.key); else S.areas.add(a.key); if (!S.areas.size) S.areas.add(a.key); setLayout('area'); } }, h('i', { style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${a.color};margin-right:5px` }), L(a.ko, a.en))));
  const exp = (fmt, name, mime) => act(async () => { const t = await fetchText(`/erd/unified/export?format=${fmt}`); download(name, t, mime); });
  const svgExport = () => { const s = svgEl.cloneNode(true); s.removeAttribute('style'); s.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex')); return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(s)}`; };
  const pngExport = () => { const txt = svgExport(); const sc = Math.min(2, 7000 / Math.max(bounds.w, bounds.h)); const img = new Image(); const url = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' })); img.onload = () => { const c = document.createElement('canvas'); c.width = Math.round(bounds.w * sc); c.height = Math.round(bounds.h * sc); const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.scale(sc, sc); cx.drawImage(img, 0, 0); c.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: `kotra-ax-unified-erd-${S.notation}.png` }); document.body.append(a); a.click(); a.remove(); }); URL.revokeObjectURL(url); }; img.onerror = () => toast(L('PNG 변환에 실패했습니다(SVG를 사용하세요).', 'PNG conversion failed — use SVG.'), 'err'); img.src = url; };
  const search = h('input', { type: 'search', placeholder: L('엔터티·테이블 검색(논리/물리)', 'Search entity / table'), 'aria-label': L('엔터티 검색', 'Search entities'), style: 'min-width:220px', oninput: (e) => { S.search = e.target.value.trim(); if (S.layout === 'area') render(true); else drawTree(); const first = M.entities.find((x) => S.search && (x.name.includes(S.search) || (x.logical || '').includes(S.search))); if (first && S.layout === 'area') { if (!visibleSet().has(first.name)) { S.areas.add(first.area); render(true); } centerOn(first.name); } } });
  const bar = h('div.card', h('div.card-b.stack-sm',
    h('div.row', { style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('b.small', L('표기', 'Notation')), notationSeg, h('b.small', L('이름', 'Names')), namesSeg, h('b.small', L('상세도', 'Detail')), detailSeg, h('b.small', L('보기', 'View')), layoutSeg, stat),
    h('div.row', { style: 'gap:10px;flex-wrap:wrap;align-items:center' }, search, chk('labels', '관계 라벨(FK)', 'Relation labels'), chk('fade', '선택 시 연관만 강조', 'Fade unrelated'), chk('soft', '논리/다형 참조 표시', 'Show soft refs'), chk('logicalRel', '논리 관계(추론) 표시', 'Show logical relations'),
      h('span.grow'), h('button.btn.btn-sm', { onclick: () => fit() }, 'Fit'), h('button.btn.btn-sm', { onclick: () => { view.k *= 1.2; applyView(); } }, '+'), h('button.btn.btn-sm', { onclick: () => { view.k *= 0.83; applyView(); } }, '−'), h('button.btn.btn-sm', { onclick: () => { userPos = {}; lsSet(LS_POS, userPos); S.focus = null; rerenderFit(); toast(L('배치를 초기화했습니다.', 'Layout reset.'), 'ok'); } }, 'Auto layout'),
      h('button.btn.btn-sm', { onclick: () => { S.focus = null; S.selected = null; rerender(); showInsp(); } }, L('포커스 해제', 'Clear focus'))),
    chips));
  const exportBar = h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('b.small', L('내보내기', 'Export')), h('button.btn.btn-sm.btn-outline', { onclick: act(async () => download(`kotra-ax-unified-erd-${S.notation}.svg`, svgExport(), 'image/svg+xml')) }, 'SVG'), h('button.btn.btn-sm.btn-outline', { onclick: pngExport }, 'PNG'), h('button.btn.btn-sm.btn-outline', { onclick: exp('json', 'kotra-ax-unified-erd.json', 'application/json') }, 'JSON'), h('button.btn.btn-sm.btn-outline', { onclick: exp('mmd', 'kotra-ax-unified.mmd', 'text/plain') }, 'Mermaid'), h('button.btn.btn-sm.btn-outline', { onclick: exp('ddl', 'kotra-ax-unified.sql', 'text/plain') }, 'DDL'), h('button.btn.btn-sm.btn-outline', { onclick: exp('dictionary', 'kotra-ax-table-column-dictionary.csv', 'text/csv') }, L('테이블·컬럼 정의서(CSV)', 'Dictionary (CSV)')), h('button.btn.btn-sm.btn-outline', { onclick: exp('entities', 'kotra-ax-entity-list.csv', 'text/csv') }, L('엔터티 목록(CSV)', 'Entity list (CSV)')));
  const s = M.stats;
  const kpis = h('div.kpi-row', [[L('엔터티(테이블)', 'Entities'), s.entities], [L('속성(컬럼)', 'Attributes'), s.columns], [L('관계', 'Relations'), s.relations], [L('선언 FK', 'Declared FK'), s.declared], [L('논리 관계(실측 검증)', 'Logical (verified)'), s.logical], [L('논리/다형(소프트)', 'Soft / polymorphic'), s.soft], [L('식별 관계', 'Identifying'), s.identifying], [L('검증 실패', 'Verify failed'), s.verify_failed]].map(([l, v]) => h('div.card', h('div.kpi', h('div.l', l), h('div.v', String(v))))));
  const root = h('div.stack', note('info', L(`${M.source}. 관계는 물리 FK가 거의 없어 큐레이션된 논리 관계를 만들고 데이터 포함관계로 실측 검증했습니다(검증 실패 ${s.verify_failed}건). 같은 모델을 ERwin(IDEF1X/IE)과 DA#(#*o) 두 표기로 그립니다.`, `${M.source}. The app has almost no physical FKs, so logical relations are curated and verified against the data (${s.verify_failed} failures). One model, two notations: ERwin (IDEF1X/IE) and DA# (#*o).`)), kpis, bar,
    h('div.erd-u', h('div.stack-sm', h('div.xs.muted', L('모델 탐색기', 'Model browser')), tree), h('div.stack-sm', stage, legend, exportBar), insp));
  stage.append(mini);
  syncChips(); showInsp();
  if (S.layout === 'overview') overview(); else { render(false); if (S.selected && ent[S.selected]) { showInsp(); setTimeout(() => centerOn(S.selected), 60); } }
  return root;
}
