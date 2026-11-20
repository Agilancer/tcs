// Trench Crusade simulator UI: board renderer, 3D dice, tokens, animations, chat, human controls, setup + builder.
(function () {
'use strict';
const TC = window.TC; const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIDE = ['#5cc8d6', '#ef6b3f']; const SIDE_DIM = ['rgba(92,200,214,.13)', 'rgba(239,107,63,.13)'];
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

// ---------------- lists ----------------
function allPresetLists() { const out = []; for (const f of TC.FACTIONS) for (const l of f.lists) out.push(Object.assign({ faction: f.id, factionName: f.name }, l)); return out; }
let PRESETS = []; let CUSTOM = store.get('tc_custom_lists', []);
function listById(id) { return PRESETS.find(l => l.id === id) || CUSTOM.find(l => l.id === id); }

// ---------------- UI object passed to the engine ----------------
const UI = {
  speed: store.get('tc_speed', 1.5), paused: false, game: null, anims: [], decals: [], dice: [], hover: null, inspect: null, showThoughts: true,
  cancelToken: 0,
  async wait(ms) { const tok = this.cancelToken; let left = ms; while (left > 0) { if (tok !== this.cancelToken) throw new Error('cancelled'); const step = Math.min(50, left); await new Promise(r => setTimeout(r, step)); if (!this.paused || this.isHumanTurn) left -= step * this.speed; } if (tok !== this.cancelToken) throw new Error('cancelled'); },
  log(kind, html) { addChat(kind, html); },
  thought(t) { addChat('thought', esc(t)); },
  update() { drawRoster(); drawStatus(); },
  select(m) { this.active = m; if (m) this.inspect = m; drawRoster(); },
  turnBanner(n) { showBanner(`Turn ${n}`); },
  async afterDeploy() { addChat('phase', 'Both warbands deploy in their 6" strips on opposite edges.'); await this.wait(700); },
  gameOver(game, w, why) { drawStatus(); showBanner(w < 0 ? 'Draw' : `${game.sideName(w)} wins`, 4000); $('#ctl-actions').innerHTML = ''; setTimeout(() => { if (UI.game === game) openResult(game, w, why); }, 1600 / Math.min(this.speed, 2)); },
  anim(o) { return startAnim(o); },
  async moveAlong(m, pts, mode) {
    if (!pts || pts.length < 2) return; const L = this.game.pathLen(pts); const dur = Math.min(2200, 180 + L * (mode === 'push' ? 60 : 110));
    const segs = []; let acc = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push({ a: pts[i - 1], b: pts[i], s: acc, d }); acc += d; }
    const t0 = performance.now(); m.moving = true;
    for (;;) { const tok = this.cancelToken; await new Promise(r => requestAnimationFrame(r)); if (tok !== this.cancelToken) throw new Error('cancelled');
      const k = Math.min(1, (performance.now() - t0) * this.speed / dur); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const at = e * acc;
      const sg = segs.find(s => at <= s.s + s.d) || segs[segs.length - 1]; const f = sg.d ? Math.min(1, (at - sg.s) / sg.d) : 1;
      m.vx = sg.a.x + (sg.b.x - sg.a.x) * f; m.vy = sg.a.y + (sg.b.y - sg.a.y) * f; if (k > .02 && Math.random() < .5) dust(m.vx, m.vy, .5);
      if (k >= 1) break; }
    m.vx = m.vy = undefined; m.moving = false;
  },
  async roll(o) { await rollDice(o); },
};
TC.UI = UI;

// ---------------- canvas / board ----------------
let cv, ctx, W = 800, PX = 20, OX = 0, OY = 0, terrainCanvas = null, zoom = 1, panX = 0, panY = 0, DPR = 1;
const toScr = (x, y) => [OX + x * PX, OY + y * PX];
const toBoard = (sx, sy) => [(sx - OX) / PX, (sy - OY) / PX];
function resize() {
  const wrap = $('#board-wrap'); const r = wrap.getBoundingClientRect(); DPR = window.devicePixelRatio || 1;
  cv.width = r.width * DPR; cv.height = r.height * DPR; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  const base = Math.min(r.width, r.height) - 8; PX = base / 36 * zoom; W = r.width;
  OX = (r.width - 36 * PX) / 2 + panX; OY = (r.height - 36 * PX) / 2 + panY; terrainCanvas = null;
}
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildTerrain() {
  const g = UI.game; if (!g) return; const T = g.terrain; const c = document.createElement('canvas'); const S = 36 * PX * DPR; c.width = c.height = Math.ceil(S); const x = c.getContext('2d'); x.scale(DPR * PX, DPR * PX);
  const R = rng(g.seed);
  // mud
  const grd = x.createRadialGradient(18, 18, 2, 18, 18, 30); grd.addColorStop(0, '#3b3427'); grd.addColorStop(1, '#221e17'); x.fillStyle = grd; x.fillRect(0, 0, 36, 36);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${R() < .5 ? '0,0,0' : '120,105,80'},${R() * .12})`; const s = R() * .35 + .05; x.fillRect(R() * 36, R() * 36, s, s); }
  for (let i = 0; i < 40; i++) { x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = .06; x.beginPath(); let px = R() * 36, py = R() * 36; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (R() - .5) * 3; py += (R() - .5) * 3; x.lineTo(px, py); } x.stroke(); }
  // deployment strips
  x.fillStyle = SIDE_DIM[0]; x.fillRect(0, 0, 6, 36); x.fillStyle = SIDE_DIM[1]; x.fillRect(30, 0, 6, 36);
  x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = .04; for (let i = 6; i < 36; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 36); x.moveTo(0, i); x.lineTo(36, i); x.stroke(); }
  x.setLineDash([.4, .3]); x.strokeStyle = SIDE[0] + '88'; x.lineWidth = .06; x.beginPath(); x.moveTo(6, 0); x.lineTo(6, 36); x.stroke(); x.strokeStyle = SIDE[1] + '88'; x.beginPath(); x.moveTo(30, 0); x.lineTo(30, 36); x.stroke(); x.setLineDash([]);
  // craters
  for (const c2 of T.craters) { const gg = x.createRadialGradient(c2.x, c2.y, c2.r * .1, c2.x, c2.y, c2.r); gg.addColorStop(0, '#15120d'); gg.addColorStop(.7, '#2a241b'); gg.addColorStop(.92, '#4a4033'); gg.addColorStop(1, 'rgba(60,50,38,0)'); x.fillStyle = gg; x.beginPath(); x.arc(c2.x, c2.y, c2.r, 0, 7); x.fill(); x.fillStyle = 'rgba(70,90,80,.25)'; x.beginPath(); x.ellipse(c2.x + .1, c2.y + .15, c2.r * .35, c2.r * .25, .3, 0, 7); x.fill(); }
  // ruins floors
  for (const Rr of T.ruins) {
    x.fillStyle = '#4a463f'; x.fillRect(Rr.x, Rr.y, Rr.w, Rr.h);
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = .03; for (let i = Rr.x; i < Rr.x + Rr.w; i += .75) { x.beginPath(); x.moveTo(i, Rr.y); x.lineTo(i, Rr.y + Rr.h); x.stroke(); } for (let j = Rr.y; j < Rr.y + Rr.h; j += .75) { x.beginPath(); x.moveTo(Rr.x, j); x.lineTo(Rr.x + Rr.w, j); x.stroke(); }
    for (let i = 0; i < 25; i++) { x.fillStyle = `rgba(30,28,24,${.3 + R() * .4})`; x.beginPath(); x.arc(Rr.x + R() * Rr.w, Rr.y + R() * Rr.h, .08 + R() * .18, 0, 7); x.fill(); }
    if (Rr.hasUpper) { const U = Rr.upper; x.fillStyle = 'rgba(120,110,95,.35)'; x.fillRect(U.x, U.y, U.w, U.h); x.save(); x.beginPath(); x.rect(U.x, U.y, U.w, U.h); x.clip(); x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = .05; for (let i = -10; i < 20; i += .5) { x.beginPath(); x.moveTo(U.x + i, U.y); x.lineTo(U.x + i + U.h, U.y + U.h); x.stroke(); } x.restore(); x.strokeStyle = 'rgba(200,190,170,.45)'; x.lineWidth = .06; x.strokeRect(U.x, U.y, U.w, U.h); }
  }
  // wire
  for (const w of T.wire) { const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), n = Math.round(L / .35), nx = -(w.b.y - w.a.y) / L, ny = (w.b.x - w.a.x) / L; x.strokeStyle = '#8a8478'; x.lineWidth = .05;
    for (let row = -1; row <= 1; row += 2) { x.beginPath(); for (let i = 0; i <= n; i++) { const t = i / n, off = (i % 2 ? .28 : -.28) * row; x.lineTo(w.a.x + (w.b.x - w.a.x) * t + nx * off, w.a.y + (w.b.y - w.a.y) * t + ny * off); } x.stroke(); }
    x.fillStyle = '#3a2f22'; for (let i = 0; i <= n; i += 3) { const t = i / n; x.fillRect(w.a.x + (w.b.x - w.a.x) * t - .08, w.a.y + (w.b.y - w.a.y) * t - .08, .16, .16); } }
  // low walls (sandbags)
  for (const w of T.walls) { const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), n = Math.max(2, Math.round(L / .55)); const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
    for (let i = 0; i < n; i++) { const t = (i + .5) / n; const cx = w.a.x + (w.b.x - w.a.x) * t, cy = w.a.y + (w.b.y - w.a.y) * t; x.save(); x.translate(cx, cy); x.rotate(ang); x.fillStyle = i % 2 ? '#8c7a57' : '#7d6c4c'; x.strokeStyle = '#3b3122'; x.lineWidth = .04; x.beginPath(); x.ellipse(0, 0, L / n / 2 + .02, .26, 0, 0, 7); x.fill(); x.stroke(); x.restore(); } }
  // walls of ruins
  for (const Rr of T.ruins) for (const s of Rr.segs) { x.lineCap = 'square'; x.strokeStyle = '#1b1a18'; x.lineWidth = .42; x.beginPath(); x.moveTo(s.a.x, s.a.y); x.lineTo(s.b.x, s.b.y); x.stroke(); x.strokeStyle = '#8f877a'; x.lineWidth = .26; x.beginPath(); x.moveTo(s.a.x, s.a.y); x.lineTo(s.b.x, s.b.y); x.stroke(); x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = .06; x.beginPath(); x.moveTo(s.a.x, s.a.y - .07); x.lineTo(s.b.x, s.b.y - .07); x.stroke(); }
  // landmarks: shattered statues / tank hulks
  for (const L of T.landmarks) { x.fillStyle = '#2b2a28'; x.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283, rr = L.r * (.8 + R() * .25); x.lineTo(L.x + Math.cos(a) * rr, L.y + Math.sin(a) * rr); } x.closePath(); x.fill(); x.strokeStyle = '#6b655c'; x.lineWidth = .08; x.stroke(); x.strokeStyle = '#9a9081'; x.lineWidth = .12; x.beginPath(); x.moveTo(L.x - L.r * .5, L.y); x.lineTo(L.x + L.r * .5, L.y); x.moveTo(L.x, L.y - L.r * .6); x.lineTo(L.x, L.y + L.r * .5); x.stroke(); }
  terrainCanvas = c;
}

// ---------------- animations ----------------
function startAnim(o) {
  const now = performance.now(); const add = (dur, draw, extra) => { const a = Object.assign({ t0: now, dur, draw }, extra || {}); UI.anims.push(a); return a; };
  const g = UI.game; let p = null;
  const wname = o.w ? o.w.name.toLowerCase() : '';
  switch (o.type) {
    case 'shot': {
      const kind = /flame/.test(wname) ? 'flame' : /shotgun|blunderbuss|punt/.test(wname) ? 'pellets' : /machine gun|automatic|smg|submachine|autocannon|gatling/.test(wname) ? 'burst' : /sniper|anti-materiel|jezzail|rifle/.test(wname) ? 'rail' : 'single';
      const n = kind === 'burst' ? 5 : kind === 'pellets' ? 7 : 1; const a = { x: o.m.x, y: o.m.y }, b = { x: o.t.x, y: o.t.y };
      for (let i = 0; i < n; i++) { const delay = kind === 'burst' ? i * 70 : 0; const sp = kind === 'pellets' ? .9 : kind === 'burst' ? .4 : .1; const tb = { x: b.x + (Math.random() - .5) * sp, y: b.y + (Math.random() - .5) * sp };
        add(260, (c, k) => { if (k < 0) return; const [ax, ay] = toScr(a.x, a.y), [bx, by] = toScr(tb.x, tb.y); const h = Math.min(1, k * 1.8), t = Math.max(0, k * 1.8 - .35);
          c.strokeStyle = kind === 'rail' ? `rgba(180,230,255,${1 - k})` : `rgba(255,214,120,${1 - k})`; c.lineWidth = kind === 'rail' ? 2.6 : 1.8; c.shadowColor = kind === 'rail' ? '#8fd8ff' : '#ffb347'; c.shadowBlur = 12;
          c.beginPath(); c.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t); c.lineTo(ax + (bx - ax) * h, ay + (by - ay) * h); c.stroke(); c.shadowBlur = 0;
          if (k < .25) { const ang = Math.atan2(by - ay, bx - ax); c.fillStyle = `rgba(255,240,180,${1 - k * 4})`; c.beginPath(); c.moveTo(ax + Math.cos(ang) * PX * .4, ay + Math.sin(ang) * PX * .4); c.lineTo(ax + Math.cos(ang + .5) * PX * .9, ay + Math.sin(ang + .5) * PX * .9); c.lineTo(ax + Math.cos(ang) * PX * 1.4, ay + Math.sin(ang) * PX * 1.4); c.lineTo(ax + Math.cos(ang - .5) * PX * .9, ay + Math.sin(ang - .5) * PX * .9); c.fill(); }
          if (k > .5) sparkAt(c, bx, by, (k - .5) * 2, '#ffd27a'); }, { t0: now + delay / UI.speed });
      } break; }
    case 'flame': { const a = { x: o.m.x, y: o.m.y }, b = { x: o.t.x, y: o.t.y };
      for (let i = 0; i < 26; i++) { const d = i * 18; const off = (Math.random() - .5) * .5; add(520, (c, k) => { if (k < 0) return; const [ax, ay] = toScr(a.x, a.y), [bx, by] = toScr(b.x, b.y); const ang = Math.atan2(by - ay, bx - ax) + off * k; const L = Math.hypot(bx - ax, by - ay) * Math.min(1.05, k * 1.3); const px = ax + Math.cos(ang) * L, py = ay + Math.sin(ang) * L; const r = PX * (.15 + k * .7);
        const gg = c.createRadialGradient(px, py, 0, px, py, r); gg.addColorStop(0, `rgba(255,240,170,${.9 * (1 - k)})`); gg.addColorStop(.4, `rgba(255,120,30,${.7 * (1 - k)})`); gg.addColorStop(1, 'rgba(120,20,0,0)'); c.fillStyle = gg; c.beginPath(); c.arc(px, py, r, 0, 7); c.fill(); }, { t0: now + d / UI.speed }); } break; }
    case 'lob': case 'bomb': { const a = { x: o.m.x, y: o.m.y }, b = { x: o.t.x, y: o.t.y }; const big = o.type === 'bomb';
      add(big ? 900 : 650, (c, k) => { if (k < 0 || k > 1) return; const [ax, ay] = toScr(a.x, a.y), [bx, by] = toScr(b.x, b.y); const px = ax + (bx - ax) * k, py = ay + (by - ay) * k - Math.sin(k * Math.PI) * PX * (big ? 7 : 4); const s = PX * (big ? .45 : .25) * (1 + Math.sin(k * Math.PI) * .8);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(ax + (bx - ax) * k, ay + (by - ay) * k, s, s * .5, 0, 0, 7); c.fill();
        c.fillStyle = big ? '#2a1a12' : '#44513a'; c.strokeStyle = big ? '#ff5a1f' : '#9fb07a'; c.lineWidth = 1.5; c.shadowColor = big ? '#ff3b0a' : 'transparent'; c.shadowBlur = big ? 18 : 0; c.beginPath(); c.arc(px, py, s, 0, 7); c.fill(); c.stroke(); c.shadowBlur = 0;
        if (big) for (let i = 0; i < 3; i++) { c.fillStyle = `rgba(255,${120 + i * 40},40,${.5 - i * .15})`; c.beginPath(); c.arc(px - (bx - ax) * .03 * (i + 1), py - (by - ay) * .03 * (i + 1) + i * 2, s * (.8 - i * .2), 0, 7); c.fill(); } });
      break; }
    case 'explode': { const pt = o.p, r = o.r; const col = o.gas ? [140, 220, 90] : o.fire ? [255, 120, 30] : [255, 170, 60];
      add(900, (c, k) => { const [x, y] = toScr(pt.x, pt.y); const R = r * PX; c.globalCompositeOperation = 'lighter';
        const gg = c.createRadialGradient(x, y, 0, x, y, R * (.3 + k)); gg.addColorStop(0, `rgba(255,250,220,${(1 - k) * .9})`); gg.addColorStop(.35, `rgba(${col},${(1 - k) * .8})`); gg.addColorStop(1, `rgba(${col},0)`); c.fillStyle = gg; c.beginPath(); c.arc(x, y, R * (.3 + k), 0, 7); c.fill(); c.globalCompositeOperation = 'source-over';
        c.strokeStyle = `rgba(255,230,180,${1 - k})`; c.lineWidth = 3 * (1 - k) + .5; c.beginPath(); c.arc(x, y, R * Math.min(1, k * 1.6), 0, 7); c.stroke(); });
      for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28, v = (.4 + Math.random()) * r; add(800 + Math.random() * 400, (c, k) => { const [x, y] = toScr(pt.x + Math.cos(a) * v * k, pt.y + Math.sin(a) * v * k); c.fillStyle = o.gas ? `rgba(150,200,90,${(1 - k) * .5})` : `rgba(60,50,40,${(1 - k) * .6})`; c.beginPath(); c.arc(x, y, PX * (.15 + k * .4), 0, 7); c.fill(); }); }
      UI.decals.push({ type: 'scorch', x: pt.x, y: pt.y, r: r * .7, gas: o.gas });
      shake(8); if (o.wait) p = UI.wait(650); break; }
    case 'melee': {
      const kind = /claw|talon|hand|fist|nail|scratch/.test(wname) ? 'scratch' : /teeth|jaw|bite|maw|fang|tusk|mouth|mandible|stinger|sting/.test(wname) ? 'bite' : /bayonet|spear|lance|halberd|pike|trench knife|dagger|knife|khanjar|stake/.test(wname) ? 'thrust' : /hammer|maul|club|mace|flail|gavel|anchor|fists/.test(wname) ? 'smash' : 'swing';
      const a = o.m, b = o.t; o.m.lunge = { t0: now, dx: b.x - a.x, dy: b.y - a.y };
      if (kind === 'scratch') for (let i = 0; i < 3; i++) add(420, (c, k) => { if (k < 0) return; const [bx, by] = toScr(b.x, b.y); const s = PX * 1.1; const ang = Math.atan2(b.y - a.y, b.x - a.x) + 1.1; const ox = Math.cos(ang) * (i - 1) * s * .35, oy = Math.sin(ang) * (i - 1) * s * .35; const dx = Math.cos(ang - 1.9) * s, dy = Math.sin(ang - 1.9) * s; const e = Math.min(1, k * 2.5);
          c.strokeStyle = `rgba(255,70,70,${1 - k})`; c.shadowColor = '#ff2a2a'; c.shadowBlur = 10; c.lineWidth = 3 * (1 - k * .6); c.lineCap = 'round'; c.beginPath(); c.moveTo(bx + ox - dx / 2, by + oy - dy / 2); c.lineTo(bx + ox - dx / 2 + dx * e, by + oy - dy / 2 + dy * e); c.stroke(); c.shadowBlur = 0; }, { t0: now + i * 70 / UI.speed });
      else if (kind === 'bite') add(520, (c, k) => { const [bx, by] = toScr(b.x, b.y); const s = PX * 1.3; const close = k < .45 ? k / .45 : 1; const ang = Math.atan2(b.y - a.y, b.x - a.x); c.save(); c.translate(bx, by); c.rotate(ang + Math.PI / 2); c.globalAlpha = 1 - Math.max(0, (k - .6) / .4); c.fillStyle = '#f2ead8'; c.shadowColor = '#ff3838'; c.shadowBlur = 8;
          for (const sgn of [-1, 1]) { const off = sgn * s * .55 * (1 - close); for (let t = 0; t < 5; t++) { const tx = -s * .5 + t * s * .25; c.beginPath(); c.moveTo(tx - s * .1, off); c.lineTo(tx + s * .1, off); c.lineTo(tx, off - sgn * s * .32); c.fill(); } }
          c.restore(); c.globalAlpha = 1; c.shadowBlur = 0; });
      else if (kind === 'thrust') add(380, (c, k) => { const [ax, ay] = toScr(a.x, a.y), [bx, by] = toScr(b.x, b.y); const e = k < .4 ? k / .4 : 1 - (k - .4) / .6; const ang = Math.atan2(by - ay, bx - ax); const L = Math.hypot(bx - ax, by - ay); const tipx = ax + Math.cos(ang) * L * (.3 + .7 * e), tipy = ay + Math.sin(ang) * L * (.3 + .7 * e);
          c.strokeStyle = `rgba(220,235,255,${1 - k * .7})`; c.shadowColor = '#cfe8ff'; c.shadowBlur = 10; c.lineWidth = 2.5; c.beginPath(); c.moveTo(ax + Math.cos(ang) * L * .1, ay + Math.sin(ang) * L * .1); c.lineTo(tipx, tipy); c.stroke(); c.shadowBlur = 0; if (k > .35 && k < .6) sparkAt(c, bx, by, (k - .35) * 4, '#fff'); });
      else if (kind === 'smash') add(560, (c, k) => { const [bx, by] = toScr(b.x, b.y); if (k < .35) { const [ax, ay] = toScr(a.x, a.y); const e = k / .35; const hx = ax + (bx - ax) * e, hy = ay + (by - ay) * e - Math.sin(e * Math.PI) * PX; c.fillStyle = '#c8c0b0'; c.beginPath(); c.arc(hx, hy, PX * .35, 0, 7); c.fill(); } else { const e = (k - .35) / .65; c.strokeStyle = `rgba(255,220,160,${1 - e})`; c.lineWidth = 4 * (1 - e) + 1; c.beginPath(); c.arc(bx, by, PX * (.4 + e * 1.6), 0, 7); c.stroke(); if (e < .1) shake(4); } });
      else add(460, (c, k) => { const [ax, ay] = toScr(a.x, a.y), [bx, by] = toScr(b.x, b.y); const ang = Math.atan2(by - ay, bx - ax); const R = Math.hypot(bx - ax, by - ay) * .8 + PX * .5; const e = Math.min(1, k * 1.6); const s0 = ang - 1.3, s1 = s0 + 2.6 * e;
          c.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { c.strokeStyle = `rgba(230,240,255,${(1 - k) * (1 - i / 6) * .8})`; c.lineWidth = 4 - i * .5; c.beginPath(); c.arc(ax, ay, R - i * 1.5, Math.max(s0, s1 - .9), s1); c.stroke(); } c.globalCompositeOperation = 'source-over'; });
      break; }
    case 'charge': { const m = o.m; for (let i = 0; i < 10; i++) dust(m.x + (Math.random() - .5), m.y + (Math.random() - .5), 1); shake(3); break; }
    case 'knock': add(500, (c, k) => { const [x, y] = toScr(o.m.x, o.m.y); c.strokeStyle = `rgba(255,200,80,${1 - k})`; c.lineWidth = 2; for (let i = 0; i < 3; i++) { const a = k * 6 + i * 2.1; c.beginPath(); c.arc(x + Math.cos(a) * PX * .7, y - PX * .9 + Math.sin(a) * PX * .2, 2.5, 0, 7); c.stroke(); } }); break;
    case 'death': { const m = o.m; UI.decals.push({ type: 'blood', x: m.x, y: m.y, r: m.r * 1.6, seed: Math.random() * 1e6, label: m.label, side: m.side });
      add(900, (c, k) => { const [x, y] = toScr(m.x, m.y); c.globalAlpha = 1 - k; c.strokeStyle = SIDE[m.side]; c.lineWidth = 2; c.beginPath(); c.arc(x, y, m.r * PX * 1.15 * (1 + k * .8), 0, 7); c.stroke(); c.globalAlpha = 1; });
      for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, v = .4 + Math.random() * 1.4; add(700, (c, k) => { const [x, y] = toScr(m.x + Math.cos(a) * v * k, m.y + Math.sin(a) * v * k); c.fillStyle = `rgba(190,10,20,${1 - k})`; c.beginPath(); c.arc(x, y, 2.2 * (1 - k) + 1, 0, 7); c.fill(); }); } break; }
    case 'blood': { const m = o.m; for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, v = .3 + Math.random() * .8; add(520, (c, k) => { const [x, y] = toScr(m.x + Math.cos(a) * v * k, m.y + Math.sin(a) * v * k); c.fillStyle = `rgba(220,20,30,${1 - k})`; c.shadowColor = '#ff0020'; c.shadowBlur = 6; c.beginPath(); c.arc(x, y, 2 * (1 - k) + .8, 0, 7); c.fill(); c.shadowBlur = 0; }); } break; }
    case 'bless': add(800, (c, k) => { const [x, y] = toScr(o.m.x, o.m.y); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28 + k * 2; const r = PX * (.6 + k * .8); c.fillStyle = `rgba(255,220,110,${1 - k})`; c.shadowColor = '#ffd36b'; c.shadowBlur = 10; c.beginPath(); c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r - k * PX * .6, 2.2, 0, 7); c.fill(); } c.shadowBlur = 0; }); break;
    case 'gaze': add(700, (c, k) => { const [ax, ay] = toScr(o.m.x, o.m.y), [bx, by] = toScr(o.t.x, o.t.y); const col = o.color || '#c04cff'; c.strokeStyle = col; c.globalAlpha = Math.sin(k * Math.PI); c.shadowColor = col; c.shadowBlur = 16; c.lineWidth = 2; c.setLineDash([6, 6]); c.lineDashOffset = -k * 60; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]); c.beginPath(); c.arc(bx, by, PX * (.6 + k * .5), 0, 7); c.stroke(); c.globalAlpha = 1; c.shadowBlur = 0; }); break;
    case 'portal': add(900, (c, k) => { const [x, y] = toScr(o.p.x, o.p.y); for (let i = 0; i < 4; i++) { c.strokeStyle = `rgba(190,80,255,${(1 - k) * .8})`; c.shadowColor = '#b04bff'; c.shadowBlur = 14; c.lineWidth = 2; c.beginPath(); c.arc(x, y, PX * (.3 + i * .3) * (1 + Math.sin(k * 3.14)), k * 8 + i, k * 8 + i + 3.5); c.stroke(); } c.shadowBlur = 0; }); break;
    case 'fall': add(600, (c, k) => { const [x, y] = toScr(o.m.x, o.m.y); c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - PX * 2 * (1 - k)); c.lineTo(x, y - PX * .6); c.stroke(); }); break;
  }
  return p || Promise.resolve();
}
function sparkAt(c, x, y, k, col) { c.fillStyle = col; c.globalAlpha = Math.max(0, 1 - k); for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3; const r = PX * .2 + k * PX * .8; c.fillRect(x + Math.cos(a) * r - 1, y + Math.sin(a) * r - 1, 2, 2); } c.globalAlpha = 1; }
function dust(x, y, s) { const a = Math.random() * 6.28, v = Math.random() * .4; UI.anims.push({ t0: performance.now(), dur: 600, draw: (c, k) => { const [sx, sy] = toScr(x + Math.cos(a) * v * k, y + Math.sin(a) * v * k); c.fillStyle = `rgba(150,130,100,${(1 - k) * .35 * s})`; c.beginPath(); c.arc(sx, sy, PX * (.15 + k * .35), 0, 7); c.fill(); } }); }
let shakeT = 0, shakeA = 0; function shake(a) { shakeT = performance.now(); shakeA = a; }

// ---------------- frame ----------------
function frame(now) {
  requestAnimationFrame(frame); if (!cv) return; const c = ctx; const g = UI.game;
  c.setTransform(DPR, 0, 0, DPR, 0, 0); c.fillStyle = '#121010'; c.fillRect(0, 0, cv.width, cv.height);
  if (!g) return; if (!terrainCanvas) buildTerrain();
  const sk = Math.max(0, 1 - (now - shakeT) / 300) * shakeA; c.save(); if (sk) c.translate((Math.random() - .5) * sk, (Math.random() - .5) * sk);
  c.drawImage(terrainCanvas, OX, OY, 36 * PX, 36 * PX);
  // decals
  for (const d of UI.decals) { const [x, y] = toScr(d.x, d.y);
    if (d.type === 'scorch') { const gg = c.createRadialGradient(x, y, 0, x, y, d.r * PX); gg.addColorStop(0, d.gas ? 'rgba(70,90,30,.45)' : 'rgba(10,8,6,.55)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gg; c.beginPath(); c.arc(x, y, d.r * PX, 0, 7); c.fill(); }
    else { const R = rng(d.seed); c.fillStyle = 'rgba(110,8,12,.75)'; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(x + (R() - .5) * d.r * PX * 1.4, y + (R() - .5) * d.r * PX * 1.4, (R() * .5 + .2) * d.r * PX * .6, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(30,0,0,.6)'; c.lineWidth = 2; const s = d.r * PX * .35; c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke(); } }
  // objectives
  for (const R of g.terrain.objectives) { const ctl = g.control(R); const cx = R.x + R.w / 2, cy = R.y + R.h / 2; const [x, y] = toScr(cx, cy); const col = ctl < 0 ? '#d8d0bc' : SIDE[ctl]; const pul = .6 + .4 * Math.sin(now / 400);
    c.strokeStyle = col; c.globalAlpha = .55; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.strokeRect(...toScr(R.x - 1, R.y - 1), (R.w + 2) * PX, (R.h + 2) * PX); c.setLineDash([]); c.globalAlpha = 1;
    c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 10 * pul; c.fillRect(-PX * .28, -PX * .28, PX * .56, PX * .56); c.restore(); c.shadowBlur = 0; }
  // reachable overlay for human
  if (UI.overlay) drawOverlay(c, now);
  // models
  const tnow = now / 1000;
  const models = g.models.filter(m => !m.ooa).sort((a, b) => (a.h || 0) - (b.h || 0));
  for (const m of models) drawModel(c, m, tnow, now);
  // anims
  UI.anims = UI.anims.filter(a => { const k = (now - a.t0) * UI.speed / a.dur; if (k > 1) return false; c.save(); try { a.draw(c, k); } catch (e) {} c.restore(); return true; });
  // human targeting line
  if (UI.aim && UI.hoverPt) { const [ax, ay] = toScr(UI.aim.x, UI.aim.y); c.strokeStyle = 'rgba(255,255,255,.4)'; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(ax, ay); c.lineTo(...toScr(UI.hoverPt.x, UI.hoverPt.y)); c.stroke(); c.setLineDash([]); }
  c.restore();
}
function fitName(c, label, maxW, lines) {
  const words = String(label).replace(/[()]/g, '').split(/\s+/); let fs = Math.max(6, Math.min(12, maxW / 4.2));
  for (; fs >= 5.5; fs -= .5) { c.font = `600 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`; const out = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= maxW) cur = t; else { if (cur) out.push(cur); cur = w; } } if (cur) out.push(cur);
    if (out.length <= lines && out.every(l => c.measureText(l).width <= maxW)) return { out, fs }; }
  c.font = `600 5.5px "Barlow Condensed", sans-serif`; const out = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width <= maxW) cur = t; else { out.push(cur || w.slice(0, 6)); cur = cur ? w : ''; } if (out.length >= lines) break; } if (cur && out.length < lines) out.push(cur);
  return { out: out.slice(0, lines).map(s => s.length > 9 ? s.slice(0, 8) + '.' : s), fs: 5.5 };
}
function drawModel(c, m, t, now) {
  let x = m.vx != null ? m.vx : m.x, y = m.vy != null ? m.vy : m.y;
  if (m.lunge) { const k = (now - m.lunge.t0) * UI.speed / 300; if (k > 1) m.lunge = null; else { const L = Math.hypot(m.lunge.dx, m.lunge.dy) || 1; const e = Math.sin(k * Math.PI) * .45; x += m.lunge.dx / L * e; y += m.lunge.dy / L * e; } }
  const [sx, sy] = toScr(x, y); const r = Math.max(m.r * PX * 1.18, 11); const col = SIDE[m.side];
  const elev = (m.h || 0) >= 3;
  if (elev) { c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(sx + 4, sy + 6, r, r * .9, 0, 0, 7); c.fill(); }
  if (UI.active === m) { c.shadowColor = col; c.shadowBlur = 22 + 6 * Math.sin(t * 5); }
  if (UI.pickable && UI.pickable.includes(m)) { c.strokeStyle = 'rgba(255,255,255,' + (.5 + .4 * Math.sin(t * 6)) + ')'; c.lineWidth = 2; c.beginPath(); c.arc(sx, sy, r + 5, 0, 7); c.stroke(); }
  if (UI.targets && UI.targets.has(m)) { const info = UI.targets.get(m); c.strokeStyle = '#ff4d4d'; c.lineWidth = 2; c.beginPath(); c.arc(sx, sy, r + 5 + Math.sin(t * 8) * 1.5, 0, 7); c.stroke(); if (info) { c.font = '600 11px "Barlow Condensed",sans-serif'; c.fillStyle = '#ffd0c0'; c.textAlign = 'center'; c.fillText(info, sx, sy - r - 9); } }
  const gg = c.createRadialGradient(sx - r * .3, sy - r * .35, r * .1, sx, sy, r); gg.addColorStop(0, m.side ? '#4a2a22' : '#1f3a40'); gg.addColorStop(1, m.side ? '#1e1210' : '#0d1b1f');
  c.fillStyle = gg; c.beginPath(); c.arc(sx, sy, r, 0, 7); c.fill(); c.shadowBlur = 0;
  c.lineWidth = m.elite ? 3 : 2; c.strokeStyle = col; if (m.down) c.setLineDash([3, 3]); c.beginPath(); c.arc(sx, sy, r, 0, 7); c.stroke(); c.setLineDash([]);
  if (m.leader) { c.fillStyle = '#ffd36b'; c.beginPath(); c.moveTo(sx - 5, sy - r + 1); c.lineTo(sx - 3, sy - r - 5); c.lineTo(sx, sy - r - 1); c.lineTo(sx + 3, sy - r - 5); c.lineTo(sx + 5, sy - r + 1); c.fill(); }
  c.save(); c.globalAlpha = m.activated && UI.game && !UI.game.over && UI.active !== m ? .55 : 1; if (m.flags.faded) c.globalAlpha *= .45;
  const { out, fs } = fitName(c, m.label, r * 1.7, r > 16 ? 3 : 2); c.fillStyle = '#efe7d6'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `600 ${fs}px "Barlow Condensed","Arial Narrow",sans-serif`;
  out.forEach((l, i) => c.fillText(l, sx, sy + (i - (out.length - 1) / 2) * fs * 1.02)); c.restore();
  if (m.down) { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(sx, sy, r, 0, 7); c.fill(); c.font = '700 9px "Barlow Condensed",sans-serif'; c.fillStyle = '#ffcf7a'; c.textAlign = 'center'; c.fillText('DOWN', sx, sy + r + 8); }
  if (elev) { c.font = '700 9px sans-serif'; c.fillStyle = '#e8e0c8'; c.fillText('▲', sx + r * .8, sy - r * .8); }
  // orbiting tokens
  const toks = []; for (let i = 0; i < m.blood; i++) toks.push(['#ff2232', '#ff0018']); for (let i = 0; i < m.bless; i++) toks.push(['#ffd86b', '#ffc400']); for (let i = 0; i < (m.infect || 0); i++) toks.push(['#8dff5a', '#4cff00']);
  if (UI.game && UI.game.shaken[m.side]) toks.push(['#a9a9ff', '#7a7aff']);
  const n = toks.length; toks.forEach(([fill, glow], i) => { const a = t * (1.1 + (m.uid % 3) * .15) + i * 6.283 / n; const R = r + 6 + Math.sin(t * 2 + i) * 1.2; const tx = sx + Math.cos(a) * R, ty = sy + Math.sin(a) * R * .92;
    c.shadowColor = glow; c.shadowBlur = 12; c.fillStyle = fill; c.beginPath(); c.arc(tx, ty, 3.4, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(tx - 1, ty - 1, 1.1, 0, 7); c.fill(); });
  if (m.flags.faded) { c.fillStyle = `rgba(150,170,200,${.18 + .08 * Math.sin(t * 3)})`; c.beginPath(); c.arc(sx, sy, r + 8, 0, 7); c.fill(); }
}
function drawOverlay(c, now) {
  const o = UI.overlay; if (o.type === 'reach') { c.fillStyle = o.color || 'rgba(120,200,255,.13)'; const s = .5 * PX; for (const i of o.cells) { const gx = i % 72, gy = (i / 72) | 0; const [x, y] = toScr(gx * .5, gy * .5); c.fillRect(x, y, s + .5, s + .5); } }
  if (o.type === 'ring') { const [x, y] = toScr(o.x, o.y); c.strokeStyle = 'rgba(190,80,255,.6)'; c.setLineDash([4, 4]); c.beginPath(); c.arc(x, y, o.r * PX, 0, 7); c.stroke(); c.setLineDash([]); }
}

// ---------------- dice ----------------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_ROT = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
function makeDie(kind) {
  const d = el('div', 'die ' + kind); const cube = el('div', 'cube'); d.appendChild(cube);
  [['front', 1], ['back', 6], ['right', 3], ['left', 4], ['top', 2], ['bottom', 5]].forEach(([f, v]) => { const face = el('div', 'face ' + f); for (let i = 0; i < 9; i++) { const p = el('span'); if (PIPS[v].includes(i)) p.className = 'pip'; face.appendChild(p); } cube.appendChild(face); });
  return d;
}
async function rollDice(o) {
  const layer = $('#dice-layer'); const kind = o.kind === 'injury' ? 'inj' : o.kind === 'plain' ? 'plain' : 'succ';
  const wrap = $('#board-wrap').getBoundingClientRect(); const size = Math.max(26, Math.min(44, PX * 1.6));
  const m = o.m && o.m.x != null ? o.m : null; let [cx, cy] = m ? toScr(m.vx ?? m.x, m.vy ?? m.y) : [wrap.width / 2, wrap.height / 2];
  cx += (cx > wrap.width / 2 ? -1 : 1) * size * 2.2; cy += (cy > wrap.height / 2 ? -1 : 1) * size * 1.6;
  const n = o.dice.length; const spread = size * 1.25; cx = Math.max(size * (n / 2 + 1), Math.min(wrap.width - size * (n / 2 + 1), cx)); cy = Math.max(size * 2.5, Math.min(wrap.height - size * 2.5, cy));
  const group = el('div', 'dice-group'); layer.appendChild(group);
  const fromLeft = Math.random() < .5; const els = [];
  o.dice.forEach((v, i) => { const d = makeDie(kind); d.style.width = d.style.height = size + 'px'; d.style.setProperty('--s', size + 'px'); group.appendChild(d);
    const ex = cx + (i - (n - 1) / 2) * spread + (Math.random() - .5) * size * .3, ey = cy + (Math.random() - .5) * size * .5;
    const sx = fromLeft ? -size * 2 : wrap.width + size * 2, sy = ey + (Math.random() - .5) * wrap.height * .5;
    const [rx, ry] = FACE_ROT[v]; const rz = (Math.random() - .5) * 60; const spins = [360 * (2 + (Math.random() * 2 | 0)), 360 * (2 + (Math.random() * 2 | 0))];
    const dur = 900 / UI.speed;
    d.animate([{ transform: `translate(${sx - size / 2}px,${sy - size / 2}px) scale(1.5)` }, { transform: `translate(${(sx + ex) / 2 - size / 2}px,${(sy + ey) / 2 - size / 2}px) scale(1.25)`, offset: .45 }, { transform: `translate(${ex - size / 2 + (fromLeft ? -6 : 6)}px,${ey - size / 2}px) scale(.96)`, offset: .78 }, { transform: `translate(${ex - size / 2}px,${ey - size / 2}px) scale(1)` }], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    d.firstChild.animate([{ transform: `rotateX(${rx + spins[0]}deg) rotateY(${ry - spins[1]}deg) rotateZ(${rz + 200}deg)` }, { transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)` }], { duration: dur, easing: 'cubic-bezier(.15,.6,.25,1)', fill: 'forwards' });
    els.push(d); });
  // label
  const lab = el('div', 'dice-label ' + kind); const res = o.res; const resTxt = { crit: 'CRITICAL!', success: 'SUCCESS', fail: 'FAILURE', none: 'NO EFFECT', minor: 'MINOR HIT', down: 'DOWN', ooa: 'OUT OF ACTION' }[res] || ('= ' + o.sum);
  const modTxt = (o.mods || []).filter(x => x.v).map(x => `${x.v > 0 ? '+' : ''}${x.v} ${esc(x.why)}`).join(' · ');
  lab.innerHTML = `<div class="dl-title">${esc(o.title)}</div>${modTxt ? `<div class="dl-mods">${modTxt}</div>` : ''}${o.kind === 'injury' ? `<div class="dl-mods">${(o.mods || []).map(x => esc(x.why)).join(' · ')}${o.modsTxt && o.modsTxt.length ? ' · ' + o.modsTxt.join(', ') : ''}</div>` : ''}<div class="dl-res r-${res || 'plain'}">${o.kind === 'plain' ? 'Rolled ' + o.sum : (o.kind === 'injury' ? `${o.sum}${o.final !== o.sum ? ' → ' + o.final : ''} ` : o.sum + ' ') + resTxt}</div>`;
  lab.style.left = Math.max(8, Math.min(wrap.width - 268, cx - 130)) + 'px'; lab.style.top = (cy > wrap.height / 2 ? cy - size * 1.2 - 78 : cy + size * 1.0) + 'px'; group.appendChild(lab);
  chatRoll(o);
  try { await UI.wait(950); } catch (e) { group.remove(); throw e; }
  els.forEach((d, i) => d.classList.add(o.kept.includes(i) ? 'kept' : 'dropped')); lab.classList.add('show');
  if (o.kind === 'injury' && (res === 'minor' || res === 'down' || res === 'ooa')) startAnim({ type: 'blood', m: o.m });
  const hold = o.kind === 'plain' ? 650 : o.kind === 'injury' ? 1250 : 1050;
  try { await UI.wait(hold); } finally { group.classList.add('fade'); setTimeout(() => group.remove(), 400); }
}

// ---------------- chat ----------------
let chatN = 0;
function addChat(kind, html) {
  const box = $('#chat'); if (!box) return; const row = el('div', 'msg k-' + kind);
  if (kind === 'thought') row.innerHTML = `<span class="tag">AI</span>${html}`; else if (kind === 'activate' && UI.active) { row.innerHTML = html; row.style.borderLeftColor = SIDE[UI.active.side]; } else row.innerHTML = html;
  if (kind === 'thought' && !UI.showThoughts) row.classList.add('hidden');
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60; box.appendChild(row); if (++chatN > 1500) { box.firstChild.remove(); chatN--; } if (stick) box.scrollTop = box.scrollHeight;
}
function chatRoll(o) {
  const dice = o.dice.map((v, i) => `<span class="cd ${o.kept.includes(i) ? 'k' : 'x'} ${o.kind === 'injury' ? 'inj' : ''}">${'⚀⚁⚂⚃⚄⚅'[v - 1]}</span>`).join('');
  const res = { crit: '<b class="ok">Critical</b>', success: '<b class="ok">Success</b>', fail: '<b class="bad">Failure</b>', none: 'No effect', minor: '<b class="warn">Minor Hit</b>', down: '<b class="bad">Down</b>', ooa: '<b class="bad">Out of Action</b>' }[o.res] || '';
  const mods = (o.mods || []).filter(x => x.v).map(x => `${x.v > 0 ? '+' : ''}${x.v} ${esc(x.why)}`); const extra = o.kind === 'injury' ? [...(o.mods || []).map(x => esc(x.why)), ...(o.modsTxt || [])] : [];
  const desc = o.kind === 'success' ? `2D6 ${o.total ? (o.total > 0 ? `+${o.total} DICE (keep best 2)` : `${o.total} DICE (keep worst 2)`) : ''}` : o.kind === 'injury' ? `Injury ${o.deadly ? '3D6 DEADLY' : '2D6'}${o.total ? ` ${o.total > 0 ? '+' : ''}${o.total} INJURY DICE` : ''}` : 'D6';
  addChat('roll', `<div class="rt">🎲 ${esc(o.title)}${o.risky ? ' <span class="risky">RISKY</span>' : ''}</div><div class="rd">${dice} <span class="rs">${desc} → <b>${o.sum}</b>${o.final != null && o.final !== o.sum ? ` → ${o.final}` : ''}</span> ${res}</div>${mods.length || extra.length ? `<div class="rm">${[...mods, ...extra].join(' · ')}</div>` : ''}`);
}
function showBanner(t, ms = 1500) { const b = $('#banner'); b.textContent = t; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); clearTimeout(showBanner.t); showBanner.t = setTimeout(() => b.classList.remove('show'), ms / Math.min(2, UI.speed)); }

// ---------------- roster / status ----------------
function statLine(m) { const f = v => v == null ? '–' : (v >= 0 ? '+' : '') + v; return `M ${m.move}" · R ${f(m.ranged)} · Me ${f(m.melee)} · Arm ${Math.max(-3, m.armourChar + m.kitArmour + m.kitShield)}`; }
function drawRoster() {
  const g = UI.game; if (!g) return;
  for (const s of [0, 1]) { const box = $('#roster' + s); box.innerHTML = ''; const head = el('div', 'rh', `<span class="dot" style="background:${SIDE[s]}"></span><b>${esc(g.lists[s].name)}</b><span class="who">${g.ctrl[s] === 'human' ? 'You' : 'AI'}</span>`); box.appendChild(head);
    for (const m of g.models.filter(m => m.side === s)) { const r = el('div', 'rm-row' + (m.ooa ? ' ooa' : '') + (UI.active === m ? ' act' : '') + (m.activated && !m.ooa ? ' done' : ''));
      const st = m.ooa ? 'OUT' : m.down ? 'DOWN' : (m.h >= 3 ? 'HIGH' : ''); const tk = `${m.blood ? `<i class="tk b">${m.blood}</i>` : ''}${m.bless ? `<i class="tk g">${m.bless}</i>` : ''}`;
      r.innerHTML = `<span class="nm">${esc(m.label)}</span><span class="st">${tk}${st ? `<em>${st}</em>` : ''}</span>`; r.onclick = () => { UI.inspect = m; drawInspect(); }; r.onmouseenter = () => { UI.hover = m; }; r.onmouseleave = () => { UI.hover = null; }; box.appendChild(r); } }
  drawInspect();
}
function drawInspect() {
  const m = UI.inspect; const box = $('#inspect'); if (!m) { box.innerHTML = '<div class="hint">Click a model on the board or in a roster to see its profile.</div>'; return; }
  const kw = [...m.kw].filter(k => !/^(HERETIC|PILGRIM|NEW ANTIOCH|BLACK GRAIL|THE COURT|IRON SULTANATE|NAVAL)$/.test(k)).join(', ');
  const weps = m.weapons.map(w => `<li><b>${esc(w.name)}</b> <span class="mut">${w.ranged ? w.ranged + '"' : 'Melee'}${w.melee && w.ranged ? '/Melee' : ''} ${esc((w.raw.kw || []).join(', '))}</span></li>`).join('');
  const eq = [...m.equipment.map(q => q.name), ...m.kitNames.filter(n => !m.weapons.some(w => w.name === n) && !m.equipment.some(q => q.name === n))].filter((v, i, a) => a.indexOf(v) === i);
  const ab = m.abilities.map(a => `<li><b>${esc(a.name)}</b>${a.text ? ' – ' + esc(a.text) : ''}</li>`).join('');
  box.innerHTML = `<div class="ih" style="border-color:${SIDE[m.side]}"><b>${esc(m.label)}</b><span class="mut">${esc(m.name)}${m.merc ? ' (Mercenary)' : ''}</span></div><div class="stats">${statLine(m)} · ${m.base}mm</div>${kw ? `<div class="kw">${esc(kw)}</div>` : ''}<ul class="wl">${weps}</ul>${eq.length ? `<div class="eq">Kit: ${esc(eq.join(', '))}</div>` : ''}${ab ? `<ul class="ab">${ab}</ul>` : ''}<div class="mut">Blood ${m.blood} · Blessings ${m.bless}${m.down ? ' · Down' : ''}${m.ooa ? ' · Out of Action' : ''}</div>`;
}
function drawStatus() {
  const g = UI.game; if (!g) return; const vp = $('#vp'); const turn = Math.min(g.turn, g.maxTurns);
  vp.innerHTML = `<span style="color:${SIDE[0]}">${esc(g.sideName(0))} <b>${g.vp[0]}</b></span><span class="tn">Turn ${turn || 0}/4</span><span style="color:${SIDE[1]}"><b>${g.vp[1]}</b> ${esc(g.sideName(1))}</span>`;
  const deeds = Object.entries(g.deeds); $('#deeds').innerHTML = deeds.length ? 'Deeds: ' + deeds.map(([n, s]) => `<span style="color:${SIDE[s]}">${esc(n)}</span>`).join(', ') : '';
}

// ---------------- human control ----------------
function boardPt(ev) { const r = cv.getBoundingClientRect(); const [x, y] = toBoard(ev.clientX - r.left, ev.clientY - r.top); return { x, y }; }
function modelAt(p) { const g = UI.game; if (!g) return null; let best = null, bd = 1e9; for (const m of g.models) { if (m.ooa) continue; const d = Math.hypot(m.x - p.x, m.y - p.y); const r = Math.max(m.r * 1.18, 11 / PX); if (d < r + .15 && d < bd) { bd = d; best = m; } } return best; }
let clickResolver = null;
function waitClick() { return new Promise(res => { clickResolver = res; }); }
UI.humanPick = async function (g, side) {
  UI.isHumanTurn = true; const avail = g.alive(side).filter(m => !m.activated); UI.pickable = avail;
  setActions(`<span class="prompt">Your turn: click one of your models to activate it.</span>`);
  for (;;) { const c = await waitClick(); if (c.model && avail.includes(c.model)) { UI.pickable = null; return c.model; } }
};
function setActions(html) { $('#ctl-actions').innerHTML = html; }
UI.humanActivation = async function (g, m) {
  UI.isHumanTurn = true;
  if (m.down) { await g.standUp(m); }
  for (;;) {
    if (m.flags.endNow || m.ooa || g.over) { if (m.flags.endNow && !m.ooa) addChat('rule', `${esc(m.label)}'s Activation ends.`); break; }
    const engaged = g.enemiesOf(m).filter(e => g.edgeDist(e, m) <= 1); const A = m.act; const btns = [];
    const add = (id, label, ok, title = '') => btns.push(`<button data-a="${id}" ${ok ? '' : 'disabled'} title="${esc(title)}">${label}</button>`);
    add('move', 'Move', !A.moved && !engaged.length, 'Move up to your Movement'); add('dash', 'Dash', !A.dashed && !m.flags.noDash && !A.charged && !engaged.length, 'Risky roll, then move again');
    add('charge', 'Charge', !A.moved && !A.charged && !engaged.length && g.meleeWeapons(m).length && !A.nonAssaultShot, 'Move M+D6 into melee'); add('retreat', 'Retreat', !A.moved && engaged.length > 0, 'Leave melee; each enemy gets a free attack');
    for (const w of g.rangedWeapons(m)) add('shoot:' + m.weapons.indexOf(w), `Shoot ${esc(w.name)}`, g.canShootNow(m, w));
    add('fight', 'Fight', !A.fought && engaged.length > 0 && !A.nonAssaultShot, 'Attack an enemy in base contact');
    for (const a of g.abilityActions(m)) if (['bloodMarkers', 'blessFriendly', 'heal', 'fade', 'teleport', 'pushModel', 'scripture'].includes(a.sim.effect)) add('ab:' + a.name, esc(a.name), true, a.text || '');
    const R = g.terrain.ruins.find(R => R.hasUpper && TC.inRect(m, R.upper)); if (R && !m.h && !A.climbed) add('up', 'Climb up', true); if (m.h >= 3) add('down', 'Climb down', true);
    btns.push(`<button data-a="end" class="end">End activation</button>`);
    setActions(`<span class="prompt"><b>${esc(m.label)}</b>: choose an action</span>` + btns.join(''));
    const act = await new Promise(res => { $('#ctl-actions').querySelectorAll('button').forEach(b => b.onclick = () => res(b.dataset.a)); });
    if (act === 'end') break;
    try { await humanAction(g, m, act, engaged); } catch (e) { if (e.message === 'cancelled') throw e; console.error(e); }
    UI.overlay = null; UI.targets = null; UI.aim = null; UI.update();
  }
  UI.overlay = null; UI.targets = null; UI.aim = null; UI.isHumanTurn = false; setActions('');
};
async function pickPoint(prompt, valid) { setActions(`<span class="prompt">${prompt}</span><button data-a="x">Cancel</button>`); let cancel = false; $('#ctl-actions').querySelector('button').onclick = () => { cancel = true; clickResolver && clickResolver({ cancel: true }); };
  for (;;) { const c = await waitClick(); if (cancel || c.cancel) return null; const v = valid(c); if (v) return v; } }
async function humanAction(g, m, act, engaged) {
  if (act === 'move' || act === 'dash' || act === 'retreat') {
    const lim = act === 'dash' && m.flags.slowDash ? 3 : g.moveAllowance(m); const F = g.field(m, { limit: lim + .5, startEngaged: act === 'retreat' });
    const cells = []; for (let i = 0; i < 72 * 72; i++) if (F.D[i] <= lim && !F.blocked[i]) cells.push(i);
    UI.overlay = { type: 'reach', cells, color: act === 'dash' ? 'rgba(255,200,90,.13)' : 'rgba(120,200,255,.13)' };
    const dest = await pickPoint(`Click where ${esc(m.label)} should ${act} (up to ${lim}").`, c => { const gx = Math.floor(c.p.x / .5), gy = Math.floor(c.p.y / .5); const i = gy * 72 + gx; if (F.D[i] <= lim && !F.blocked[i] && g.canEndAt(m, g.cellPt(i))) return i; return null; });
    UI.overlay = null; if (dest == null) return; const pts = g.pathTo(F, dest);
    if (act === 'retreat') { addChat('action', `${esc(m.label)} retreats.`); await g.doRetreat(m, pts); } else { addChat('action', `${esc(m.label)} ${act === 'dash' ? 'dashes' : 'moves'}.`); await g.doMove(m, pts, act); }
  } else if (act === 'charge') {
    const ts = g.enemiesOf(m).filter(t => !t.flags.faded && g.edgeDist(m, t) <= 12 && g.los(m, t).vis); UI.targets = new Map(ts.map(t => [t, `${g.edgeDist(m, t).toFixed(1)}"`]));
    if (!ts.length) { addChat('rule', 'No enemy in sight within 12".'); return; }
    const t = await pickPoint('Click an enemy to charge.', c => c.model && ts.includes(c.model) ? c.model : null); UI.targets = null; if (!t) return;
    addChat('action', `${esc(m.label)} charges ${esc(t.label)}!`); const ok = await g.doCharge(m, t); if (ok && !m.flags.endNow && !m.ooa) addChat('rule', 'In combat: you may now Fight.');
  } else if (act.startsWith('shoot:')) {
    const w = m.weapons[+act.slice(6)]; const ts = g.enemiesOf(m).filter(t => g.edgeDist(m, t) <= w.ranged && g.los(m, t).vis && !t.flags.faded);
    if (!ts.length) { addChat('rule', `No target in range and sight for ${esc(w.name)}.`); return; }
    UI.targets = new Map(ts.map(t => { const { mods } = g.shootMods(m, t, w, g.edgeDist(m, t)); const v = mods.reduce((a, b) => a + b.v, 0) + g.auraDice(m).v; return [t, w.kw.flamethrower ? 'auto-hit' : Math.round(TC.pSuccess(v).p * 100) + '% hit']; }));
    UI.aim = m; const t = await pickPoint(`Click a target for ${esc(w.name)}.`, c => c.model && ts.includes(c.model) ? c.model : null); UI.targets = null; UI.aim = null; if (!t) return;
    await g.doShoot(m, w, t);
  } else if (act === 'fight') {
    const ts = engaged; UI.targets = new Map(ts.map(t => [t, Math.round(TC.pSuccess((m.melee || 0)).p * 100) + '%'])); const t = ts.length === 1 ? ts[0] : await pickPoint('Click the enemy to fight.', c => c.model && ts.includes(c.model) ? c.model : null); UI.targets = null; if (!t) return;
    await g.doFight(m, t);
  } else if (act.startsWith('ab:')) {
    const a = g.abilityActions(m).find(x => x.name === act.slice(3)); if (!a) return; const s = a.sim;
    if (s.effect === 'fade') return g.doAbility(m, a);
    if (s.effect === 'teleport') { UI.overlay = { type: 'ring', x: m.x, y: m.y, r: s.range || 6 }; const dest = await pickPoint(`Click a spot within ${s.range || 6}" for the portal.`, c => Math.hypot(c.p.x - m.x, c.p.y - m.y) <= (s.range || 6) && g.canEndAt(m, c.p) && !g.wallAt(c.p, m.r) ? c.p : null); UI.overlay = null; if (!dest) return; const take = engaged.find(e => e.base <= 32); return g.doAbility(m, a, { dest, take }); }
    const friendly = s.effect === 'blessFriendly' || s.effect === 'heal'; const pool = friendly ? [m, ...g.friendsOf(m)] : g.enemiesOf(m); const rng = s.range || (s.effect === 'scripture' ? 18 : 12);
    const ts = pool.filter(t => g.edgeDist(m, t) <= rng && (t === m || friendly || !s.los || g.los(m, t).vis)); if (!ts.length) { addChat('rule', 'No valid target in range.'); return; }
    UI.targets = new Map(ts.map(t => [t, ''])); const t = await pickPoint(`Click a target for ${esc(a.name)}.`, c => c.model && ts.includes(c.model) ? c.model : null); UI.targets = null; if (!t) return;
    if (s.effect === 'pushModel') return g.doAbility(m, a, { target: t, from: m }); return g.doAbility(m, a, t);
  } else if (act === 'up') await g.climb(m, true); else if (act === 'down') await g.climb(m, false);
}

// ---------------- game control ----------------
let current = null;
async function newGame(cfg) {
  UI.cancelToken++; UI.anims = []; UI.decals = []; UI.overlay = null; UI.targets = null; UI.pickable = null; UI.active = null; UI.inspect = null; UI.isHumanTurn = false; clickResolver = null; $('#dice-layer').innerHTML = ''; $('#chat').innerHTML = ''; chatN = 0; setActions('');
  const lists = [listById(cfg.a), listById(cfg.b)].map(l => JSON.parse(JSON.stringify(l))); if (lists[0].id === lists[1].id) { lists[1].id += '_b'; }
  lists.forEach(l => { if (!l.shortName) l.shortName = l.name.replace(/^The /, '').split(/[:,]/)[0]; }); if (lists[0].shortName === lists[1].shortName) lists[1].shortName += ' (B)';
  const g = new TC.Game({ lists, ctrl: cfg.ctrl, ui: UI, seed: cfg.seed || undefined, allowInfiltrate: cfg.infil }); UI.game = g; current = cfg; terrainCanvas = null; resize(); drawRoster(); drawStatus();
  const tok = UI.cancelToken;
  try { await g.run(); } catch (e) { if (e.message !== 'cancelled') { console.error(e); addChat('rule', 'Engine error: ' + esc(e.message)); } }
  if (tok === UI.cancelToken && cfg.demo && g.over) { setTimeout(() => { if (tok === UI.cancelToken && !$('#setup').classList.contains('open')) newGame(randomDemo()); }, 9000); }
}
function randomDemo() { const a = PRESETS[Math.floor(Math.random() * PRESETS.length)]; let b; do { b = PRESETS[Math.floor(Math.random() * PRESETS.length)]; } while (b.faction === a.faction); return { a: a.id, b: b.id, ctrl: ['ai', 'ai'], demo: true }; }
function openResult(g, w, why) { const m = $('#result'); m.querySelector('.res-body').innerHTML = `<h2>${w < 0 ? 'A bloody stalemate' : esc(g.lists[w].name) + ' wins'}</h2><p>${esc(why)}.</p><p>Victory Points: <b style="color:${SIDE[0]}">${g.vp[0]}</b> – <b style="color:${SIDE[1]}">${g.vp[1]}</b></p><p>Out of Action: ${g.models.filter(m => m.ooa && m.side === 0).length} / ${g.startCount[0]} vs ${g.models.filter(m => m.ooa && m.side === 1).length} / ${g.startCount[1]}</p>`; m.classList.add('open'); }

// ---------------- setup screen ----------------
function listOptions(sel) { const groups = {}; for (const l of PRESETS) (groups[l.factionName] = groups[l.factionName] || []).push(l); let h = ''; if (CUSTOM.length) h += `<optgroup label="Your lists">${CUSTOM.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`; for (const [f, ls] of Object.entries(groups)) h += `<optgroup label="${esc(f)}">${ls.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`; return h; }
function listPreview(id) { const l = listById(id); if (!l) return ''; const t = TC.listTotals(l); const fv = TC.factionVariant(l.faction, l.variant);
  return `<div class="lp-h"><b>${esc(l.name)}</b> <span class="mut">${esc(fv ? fv.variant.name : '')}</span></div><div class="lp-cost">${t.d} ducats · ${t.g} Glory · ${l.models.length} models</div>${l.style ? `<div class="lp-style">${esc(l.style)}</div>` : ''}<ul>${l.models.map(e => `<li><b>${esc(e.label || e.model)}</b> <span class="mut">${esc([...(e.kit || []), ...(e.upgrades || [])].join(', '))}</span></li>`).join('')}</ul>`; }
function openSetup() { const s = $('#setup'); const st = store.get('tc_setup', null) || { a: 'nr_hymns_and_hellfire', b: PRESETS[1].id, ca: 'human', cb: 'ai' };
  if (!listById(st.a)) st.a = PRESETS[0].id; if (!listById(st.b)) st.b = PRESETS[1].id;
  $('#sel-a').innerHTML = listOptions(st.a); $('#sel-b').innerHTML = listOptions(st.b); $('#ctl-a').value = st.ca; $('#ctl-b').value = st.cb; $('#opt-infil').checked = !!st.infil;
  const upd = () => { $('#pv-a').innerHTML = listPreview($('#sel-a').value); $('#pv-b').innerHTML = listPreview($('#sel-b').value); }; $('#sel-a').onchange = upd; $('#sel-b').onchange = upd; upd(); s.classList.add('open'); }
function startFromSetup() { const cfg = { a: $('#sel-a').value, b: $('#sel-b').value, ctrl: [$('#ctl-a').value, $('#ctl-b').value], infil: $('#opt-infil').checked, seed: +$('#opt-seed').value || 0 }; store.set('tc_setup', { a: cfg.a, b: cfg.b, ca: cfg.ctrl[0], cb: cfg.ctrl[1], infil: cfg.infil }); $('#setup').classList.remove('open'); newGame(cfg); }

// ---------------- list builder ----------------
const B = { faction: null, variant: null, entries: [], name: 'My Warband', editId: null };
function bFV() { return TC.factionVariant(B.faction, B.variant); }
function itemCost(fv, name, modelId) { const c = fv.armoury.filter(a => a.item === name); const it = c.find(a => a.onlyFor && (a.onlyFor === modelId || (Array.isArray(a.onlyFor) && a.onlyFor.includes(modelId)))) || c.find(a => !a.onlyFor) || c[0]; return it ? { d: it.currency === 'glory' ? 0 : +it.cost || 0, g: it.currency === 'glory' ? +it.cost || 0 : 0, it } : { d: 0, g: 0 }; }
function entryCost(fv, e) {
  if (e.model.startsWith('MERC:')) { const mm = TC.MERCS[e.model.slice(5)]; let d = 0; for (const k of e.kit || []) d += (TC.MERC_KIT[k] && TC.MERC_KIT[k].cost) || 0; return { d, g: mm ? mm.glory : 0 }; }
  const def = fv.models.find(m => m.id === e.model); if (!def) return { d: 0, g: 0 }; let d = def.currency === 'glory' ? 0 : +def.cost || 0, g = def.currency === 'glory' ? +def.cost || 0 : 0;
  for (const k of e.kit || []) { const c = itemCost(fv, k, def.id); d += c.d; g += c.g; }
  for (const u of e.upgrades || []) { const ud = (def.upgrades || []).find(x => x.name === u); if (ud) { if (ud.currency === 'glory') g += +ud.cost || 0; else d += +ud.cost || 0; } }
  return { d, g };
}
function mercsFor(f) { const allowed = f.mercenaries && f.mercenaries.allowed; return Object.values(TC.MERCS).filter(mm => allowed ? allowed.some(a => a === mm.id || a.endsWith(mm.id) || mm.id.endsWith(a.replace(/^(communicant|mendelist)_/, ''))) : (mm.for || []).some(k => (f.name.toUpperCase().includes(k)) || (f.alignment === mm.alignment))); }
function openBuilder(edit) {
  if (edit) { B.faction = edit.faction; B.variant = edit.variant; B.entries = JSON.parse(JSON.stringify(edit.models)); B.name = edit.name; B.editId = edit.id; }
  else if (!B.faction) { B.faction = TC.FACTIONS[0].id; B.variant = TC.FACTIONS[0].variants[0].id; }
  $('#builder').classList.add('open'); renderBuilder();
}
function renderBuilder() {
  const f = TC.FACTIONS.find(x => x.id === B.faction); const fv = bFV();
  $('#b-faction').innerHTML = TC.FACTIONS.map(x => `<option value="${x.id}" ${x.id === B.faction ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  $('#b-variant').innerHTML = f.variants.map(v => `<option value="${v.id}" ${v.id === B.variant ? 'selected' : ''}>${esc(v.name)}</option>`).join(''); $('#b-name').value = B.name;
  // available models
  const counts = {}; B.entries.forEach(e => counts[e.model] = (counts[e.model] || 0) + 1);
  const avail = fv.models.map(m => { const full = m.max != null && (counts[m.id] || 0) >= m.max; return `<div class="bm ${full ? 'full' : ''}"><div><b>${esc(m.name)}</b> <span class="mut">${m.cost} ${m.currency === 'glory' ? 'Glory' : 'ducats'} · ${m.min || 0}-${m.max == null ? '∞' : m.max}</span><div class="mut sm">M${m.move}" R${m.ranged == null ? '–' : m.ranged} Me${m.melee == null ? '–' : m.melee} Arm${m.armour} · ${esc((m.keywords || []).join(', '))}</div></div><button data-add="${m.id}" ${full ? 'disabled' : ''}>Add</button></div>`; }).join('')
    + `<div class="bsub">Mercenaries (Glory)</div>` + mercsFor(f).map(mm => `<div class="bm"><div><b>${esc(mm.name)}</b> <span class="mut">${mm.glory} Glory</span></div><button data-add="MERC:${mm.id}">Add</button></div>`).join('');
  $('#b-avail').innerHTML = avail;
  // entries
  const armOpts = (def) => fv.armoury.filter(a => !a.onlyFor || a.onlyFor === def.id || (Array.isArray(a.onlyFor) && a.onlyFor.includes(def.id))).filter((a, i, arr) => arr.findIndex(b => b.item === a.item) === i);
  $('#b-list').innerHTML = B.entries.map((e, i) => { const merc = e.model.startsWith('MERC:'); const def = merc ? TC.MERCS[e.model.slice(5)] : fv.models.find(m => m.id === e.model); if (!def) return ''; const c = entryCost(fv, e);
    const kit = (e.kit || []).map((k, j) => `<span class="chip">${esc(k)} <a data-rmkit="${i}:${j}">×</a></span>`).join('');
    const opts = merc ? Object.keys(TC.MERC_KIT).filter(k => TC.MERC_KIT[k].for === def.id).map(k => `<option>${esc(k)}</option>`).join('') : armOpts(def).map(a => `<option value="${esc(a.item)}">${esc(a.item)} (${a.cost} ${a.currency === 'glory' ? 'G' : 'd'})</option>`).join('');
    const ups = merc ? '' : (def.upgrades || []).map(u => `<label class="up"><input type="checkbox" data-up="${i}" value="${esc(u.name)}" ${(e.upgrades || []).includes(u.name) ? 'checked' : ''}> ${esc(u.name)} (${u.cost} ${u.currency === 'glory' ? 'G' : 'd'})</label>`).join('');
    return `<div class="be"><div class="be-h"><input data-label="${i}" value="${esc(e.label || def.name)}"><span class="mut">${esc(def.name)}</span><span class="cost">${c.d}d${c.g ? ' · ' + c.g + 'G' : ''}</span><a class="rm" data-rm="${i}">Remove</a></div>${def.fixedKit && def.fixedKit.length ? `<div class="mut sm">Comes with: ${esc(def.fixedKit.join(', '))}</div>` : ''}<div class="kit">${kit}${opts ? `<select data-kitsel="${i}"><option value="">+ add kit…</option>${opts}</select>` : ''}</div>${ups ? `<div class="ups">${ups}</div>` : ''}</div>`; }).join('') || '<div class="hint">Add models from the left.</div>';
  // totals & validation
  let d = 0, g = 0; B.entries.forEach(e => { const c = entryCost(fv, e); e.ducats = c.d; e.glory = c.g; d += c.d; g += c.g; });
  const errs = []; if (d > 900) errs.push(`Over budget: ${d} / 900 ducats.`); if (g > 8) errs.push(`Over Glory: ${g} / 8.`);
  for (const m of fv.models) { const n = counts[m.id] || 0; if (m.min && n < m.min) errs.push(`Needs at least ${m.min} ${m.name}.`); if (m.max != null && n > m.max) errs.push(`At most ${m.max} ${m.name}.`); }
  const elites = B.entries.filter(e => { const def = fv.models.find(m => m.id === e.model); return def && (def.keywords || []).includes('ELITE'); }).length; if (elites > 6) errs.push('At most 6 ELITE models.');
  for (const e of B.entries) { const def = fv.models.find(m => m.id === e.model); if (!def) continue; let h2r = 0, h1r = 0, h2m = 0, h1m = 0, arm = 0, sh = 0, gr = 0; for (const k of e.kit || []) { const K = TC.findKit(k, fv); if (!K) continue; const melee = K.range === 'Melee' || /melee/i.test(K.range || ''); const rng2 = typeof K.range === 'number' || /^\d/.test(K.range || ''); if (K.type === 'Armour') arm++; else if (K.type === 'Shield') sh++; else if (K.type === 'Grenade') gr++; else if (K.type === '2H') { if (rng2) h2r++; else if (melee) h2m++; } else if (K.type === '1H') { if (rng2) h1r++; else if (melee) h1m++; } }
    if (h2r + h1r / 2 > 1) errs.push(`${e.label}: too many ranged weapons.`); if (h2m + h1m / 2 > 1) errs.push(`${e.label}: too many melee weapons.`); if (arm > 1) errs.push(`${e.label}: one armour only.`); if (sh > 1) errs.push(`${e.label}: one shield only.`); }
  $('#b-total').innerHTML = `<b class="${d > 900 ? 'bad' : ''}">${d}</b> / 900 ducats · <b class="${g > 8 ? 'bad' : ''}">${g}</b> / 8 Glory · ${B.entries.length} models`;
  $('#b-errs').innerHTML = errs.map(e => `<div>⚠ ${esc(e)}</div>`).join('') || '<div class="okline">✓ Looks legal.</div>';
  $('#b-save').disabled = !B.entries.length || d > 900 || g > 8;
  // wire
  $('#b-avail').querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const id = b.dataset.add; const def = id.startsWith('MERC:') ? TC.MERCS[id.slice(5)] : fv.models.find(m => m.id === id); B.entries.push({ model: id, label: def.name, kit: [], upgrades: [] }); renderBuilder(); });
  $('#b-list').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { B.entries.splice(+b.dataset.rm, 1); renderBuilder(); });
  $('#b-list').querySelectorAll('[data-rmkit]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.rmkit.split(':').map(Number); B.entries[i].kit.splice(j, 1); renderBuilder(); });
  $('#b-list').querySelectorAll('[data-kitsel]').forEach(s => s.onchange = () => { if (s.value) { B.entries[+s.dataset.kitsel].kit.push(s.value); renderBuilder(); } });
  $('#b-list').querySelectorAll('[data-up]').forEach(cb => cb.onchange = () => { const e = B.entries[+cb.dataset.up]; e.upgrades = e.upgrades || []; if (cb.checked) e.upgrades.push(cb.value); else e.upgrades = e.upgrades.filter(u => u !== cb.value); renderBuilder(); });
  $('#b-list').querySelectorAll('[data-label]').forEach(inp => inp.onchange = () => { B.entries[+inp.dataset.label].label = inp.value; });
}
function saveBuilder() { const fv = bFV(); const t = { d: 0, g: 0 }; B.entries.forEach(e => { const c = entryCost(fv, e); e.ducats = c.d; e.glory = c.g; t.d += c.d; t.g += c.g; });
  const id = B.editId || ('custom_' + Date.now().toString(36)); const f = TC.FACTIONS.find(x => x.id === B.faction);
  const l = { id, name: $('#b-name').value || 'My Warband', faction: B.faction, factionName: f.name, variant: B.variant, ducats: t.d, glory: t.g, style: 'Your own list.', models: JSON.parse(JSON.stringify(B.entries)) };
  CUSTOM = CUSTOM.filter(x => x.id !== id); CUSTOM.unshift(l); store.set('tc_custom_lists', CUSTOM); B.editId = null; $('#builder').classList.remove('open'); openSetup(); $('#sel-a').value = id; $('#sel-a').onchange(); }

// ---------------- boot ----------------
function boot() {
  PRESETS = allPresetLists(); cv = $('#board'); ctx = cv.getContext('2d'); resize(); window.addEventListener('resize', resize); requestAnimationFrame(frame);
  cv.addEventListener('click', ev => { const p = boardPt(ev); const m = modelAt(p); if (m) { UI.inspect = m; drawInspect(); } if (clickResolver) { const r = clickResolver; clickResolver = null; r({ p, model: m }); } });
  cv.addEventListener('mousemove', ev => { const p = boardPt(ev); UI.hoverPt = p; const m = modelAt(p); cv.style.cursor = m || UI.overlay ? 'pointer' : 'default'; });
  cv.addEventListener('wheel', ev => { ev.preventDefault(); const r = cv.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top; const [bx, by] = toBoard(mx, my); zoom = Math.max(1, Math.min(3, zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12))); if (zoom === 1) { panX = panY = 0; resize(); return; } resize(); const [sx, sy] = toScr(bx, by); panX += mx - sx; panY += my - sy; resize(); }, { passive: false });
  let drag = null; cv.addEventListener('pointerdown', ev => { if (zoom > 1 && (ev.button === 1 || ev.shiftKey)) drag = { x: ev.clientX, y: ev.clientY, px: panX, py: panY }; }); window.addEventListener('pointermove', ev => { if (drag) { panX = drag.px + ev.clientX - drag.x; panY = drag.py + ev.clientY - drag.y; resize(); } }); window.addEventListener('pointerup', () => drag = null);
  const sp = $('#speed'); const SPEEDS = [0.5, 1, 1.5, 2, 3, 5, 8]; sp.value = Math.max(0, SPEEDS.indexOf(UI.speed)); if (SPEEDS.indexOf(UI.speed) < 0) sp.value = 2; const spl = () => { UI.speed = SPEEDS[+sp.value]; $('#speed-v').textContent = UI.speed + '×'; store.set('tc_speed', UI.speed); }; sp.oninput = spl; spl();
  $('#btn-pause').onclick = () => { UI.paused = !UI.paused; $('#btn-pause').textContent = UI.paused ? '▶ Resume' : '❚❚ Pause'; };
  $('#btn-new').onclick = openSetup; $('#btn-start').onclick = startFromSetup; $('#btn-cancel').onclick = () => $('#setup').classList.remove('open');
  $('#btn-rand').onclick = () => { const r = randomDemo(); $('#sel-a').value = r.a; $('#sel-b').value = r.b; $('#sel-a').onchange(); };
  $('#btn-build').onclick = () => { $('#setup').classList.remove('open'); openBuilder(); };
  $('#btn-edit').onclick = () => { const l = CUSTOM.find(x => x.id === $('#sel-a').value); const base = l || listById($('#sel-a').value); $('#setup').classList.remove('open'); openBuilder(Object.assign({}, base, { id: l ? l.id : null, name: l ? l.name : base.name + ' (copy)' })); };
  $('#b-faction').onchange = e => { B.faction = e.target.value; B.variant = TC.FACTIONS.find(x => x.id === B.faction).variants[0].id; B.entries = []; renderBuilder(); };
  $('#b-variant').onchange = e => { B.variant = e.target.value; renderBuilder(); }; $('#b-name').oninput = e => B.name = e.target.value;
  $('#b-save').onclick = saveBuilder; $('#b-close').onclick = () => { $('#builder').classList.remove('open'); openSetup(); };
  $('#res-close').onclick = () => $('#result').classList.remove('open'); $('#res-new').onclick = () => { $('#result').classList.remove('open'); openSetup(); }; $('#res-again').onclick = () => { $('#result').classList.remove('open'); newGame(Object.assign({}, current, { seed: 0 })); };
  $('#opt-thoughts').onchange = e => { UI.showThoughts = e.target.checked; document.querySelectorAll('.msg.k-thought').forEach(x => x.classList.toggle('hidden', !UI.showThoughts)); };
  newGame(randomDemo());
}
TC.boot = boot;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
