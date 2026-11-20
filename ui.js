// Trench Crusade simulator UI: game flow, dice labels, chat, human controls, setup + builder. The 3D table is in view/.
import { createView } from './view/view.js';
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
  speed: store.get('tc_speed', 1.5), paused: false, game: null, hover: null, inspect: null, showThoughts: true,
  cancelToken: 0,
  async wait(ms) { const tok = this.cancelToken; let left = ms; while (left > 0) { if (tok !== this.cancelToken) throw new Error('cancelled'); const step = Math.min(50, left); await new Promise(r => setTimeout(r, step)); if (!this.paused || this.isHumanTurn) left -= step * this.speed; } if (tok !== this.cancelToken) throw new Error('cancelled'); },
  log(kind, html) { addChat(kind, html); },
  thought(t) { addChat('thought', esc(t)); },
  update() { drawRoster(); drawStatus(); },
  select(m) { this.active = m; if (m) this.inspect = m; drawRoster(); },
  turnBanner(n) { showBanner(`Turn ${n}`); },
  async afterDeploy(g) { addChat('phase', esc(g.scenario.deployText)); await this.wait(1800); },
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

// ---------------- 3D table ----------------
// The battlefield, miniatures, effects and dice live in view/. This file only tells the view what happened.
let view = null;
function startAnim(o) { if (!view || !view.world) return Promise.resolve(); view.fx.play(o); return o.type === 'explode' && o.wait ? UI.wait(650) : Promise.resolve(); }
function dust(x, y, s) { if (view && view.world) view.fx.dust(x, y, s); }

// ---------------- dice ----------------
async function rollDice(o) {
  const layer = $('#dice-layer'); const kind = o.kind === 'injury' ? 'inj' : o.kind === 'plain' ? 'plain' : 'succ';
  const th = view.dice.throw(o, kind); const size = th.size;
  // label
  const lab = el('div', 'dice-label ' + kind); const res = o.res; const resTxt = { crit: 'CRITICAL!', success: 'SUCCESS', fail: 'FAILURE', none: 'NO EFFECT', minor: 'MINOR HIT', down: 'DOWN', ooa: 'OUT OF ACTION' }[res] || ('= ' + o.sum);
  const modTxt = (o.mods || []).filter(x => x.v).map(x => `${x.v > 0 ? '+' : ''}${x.v} ${esc(x.why)}`).join(' · ');
  lab.innerHTML = `<div class="dl-title">${esc(o.title)}</div>${modTxt ? `<div class="dl-mods">${modTxt}</div>` : ''}${o.kind === 'injury' ? `<div class="dl-mods">${(o.mods || []).map(x => esc(x.why)).join(' · ')}${o.modsTxt && o.modsTxt.length ? ' · ' + o.modsTxt.join(', ') : ''}</div>` : ''}<div class="dl-res r-${res || 'plain'}">${o.kind === 'plain' ? 'Rolled ' + o.sum : (o.kind === 'injury' ? `${o.sum}${o.final !== o.sum ? ' → ' + o.final : ''} ` : o.sum + ' ') + resTxt}</div>`;
  // the label stays beside the dice while the camera moves
  const place = () => { if (!lab.isConnected) return; const [W, H] = view.size(), [cx, cy] = th.pos(); lab.style.left = Math.max(8, Math.min(W - 268, cx - 130)) + 'px'; lab.style.top = Math.max(4, Math.min(H - 90, cy > H / 2 ? cy - size * 1.2 - 78 : cy + size * 1.0)) + 'px'; requestAnimationFrame(place); };
  layer.appendChild(lab); place();
  chatRoll(o);
  try { await UI.wait(950); } catch (e) { lab.remove(); th.fade(); throw e; }
  th.mark(o.kept); lab.classList.add('show');
  if (o.kind === 'injury' && (res === 'minor' || res === 'down' || res === 'ooa')) startAnim({ type: 'blood', m: o.m });
  const hold = o.kind === 'plain' ? 650 : o.kind === 'injury' ? 1250 : 1050;
  try { await UI.wait(hold); } finally { th.fade(); lab.classList.remove('show'); setTimeout(() => lab.remove(), 400); }
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
  vp.innerHTML = `<span style="color:${SIDE[0]}">${esc(g.sideName(0))} <b>${g.vp[0]}</b></span><span class="tn">Turn ${turn || 0}/${g.maxTurns}</span><span style="color:${SIDE[1]}"><b>${g.vp[1]}</b> ${esc(g.sideName(1))}</span>`;
  const deeds = Object.entries(g.deeds); $('#deeds').innerHTML = deeds.length ? 'Deeds: ' + deeds.map(([n, s]) => `<span style="color:${SIDE[s]}">${esc(n)}</span>`).join(', ') : '';
}

// ---------------- human control ----------------
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
  UI.cancelToken++; UI.overlay = null; UI.targets = null; UI.pickable = null; UI.active = null; UI.inspect = null; UI.isHumanTurn = false; clickResolver = null; $('#dice-layer').innerHTML = ''; $('#chat').innerHTML = ''; chatN = 0; setActions('');
  const lists = [listById(cfg.a), listById(cfg.b)].map(l => JSON.parse(JSON.stringify(l))); if (lists[0].id === lists[1].id) { lists[1].id += '_b'; }
  lists.forEach(l => { if (!l.shortName) l.shortName = l.name.replace(/^The /, '').split(/[:,]/)[0]; }); if (lists[0].shortName === lists[1].shortName) lists[1].shortName += ' (B)';
  const g = new TC.Game({ lists, ctrl: cfg.ctrl, ui: UI, seed: cfg.seed || undefined, allowInfiltrate: cfg.infil, scenario: cfg.scenario, field: cfg.field }); UI.game = g; current = cfg; UI.aim = null; UI.hoverPt = null;
  $('#scn').textContent = g.scenario.name + ' · ' + g.battlefield.name; view.setGame(g); drawRoster(); drawStatus();
  const tok = UI.cancelToken;
  try { await g.run(); } catch (e) { if (e.message !== 'cancelled') { console.error(e); addChat('rule', 'Engine error: ' + esc(e.message)); } }
  if (tok === UI.cancelToken && cfg.demo && g.over) { setTimeout(() => { if (tok === UI.cancelToken && !$('#setup').classList.contains('open')) newGame(randomDemo()); }, 9000); }
}
function randomDemo() { const a = PRESETS[Math.floor(Math.random() * PRESETS.length)]; let b; do { b = PRESETS[Math.floor(Math.random() * PRESETS.length)]; } while (b.faction === a.faction); return { a: a.id, b: b.id, ctrl: ['ai', 'ai'], demo: true, scenario: TC.SCENARIOS[Math.floor(Math.random() * TC.SCENARIOS.length)].id }; }
function openResult(g, w, why) { const m = $('#result'); m.querySelector('.res-body').innerHTML = `<h2>${w < 0 ? 'A bloody stalemate' : esc(g.lists[w].name) + ' wins'}</h2><p>${esc(why)}.</p><p>Victory Points: <b style="color:${SIDE[0]}">${g.vp[0]}</b> – <b style="color:${SIDE[1]}">${g.vp[1]}</b></p><p>Out of Action: ${g.models.filter(m => m.ooa && m.side === 0).length} / ${g.startCount[0]} vs ${g.models.filter(m => m.ooa && m.side === 1).length} / ${g.startCount[1]}</p>`; m.classList.add('open'); }

// ---------------- setup screen ----------------
function listOptions(sel) { const groups = {}; for (const l of PRESETS) (groups[l.factionName] = groups[l.factionName] || []).push(l); let h = ''; if (CUSTOM.length) h += `<optgroup label="Your lists">${CUSTOM.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`; for (const [f, ls] of Object.entries(groups)) h += `<optgroup label="${esc(f)}">${ls.map(l => `<option value="${esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`; return h; }
function listPreview(id) { const l = listById(id); if (!l) return ''; const t = TC.listTotals(l); const fv = TC.factionVariant(l.faction, l.variant);
  return `<div class="lp-h"><b>${esc(l.name)}</b> <span class="mut">${esc(fv ? fv.variant.name : '')}</span></div><div class="lp-cost">${t.d} ducats · ${t.g} Glory · ${l.models.length} models</div>${l.style ? `<div class="lp-style">${esc(l.style)}</div>` : ''}<ul>${l.models.map(e => `<li><b>${esc(e.label || e.model)}</b> <span class="mut">${esc([...(e.kit || []), ...(e.upgrades || [])].join(', '))}</span></li>`).join('')}</ul>`; }
function openSetup() { const s = $('#setup'); const st = store.get('tc_setup', null) || { a: 'nr_hymns_and_hellfire', b: PRESETS[1].id, ca: 'human', cb: 'ai' };
  if (!listById(st.a)) st.a = PRESETS[0].id; if (!listById(st.b)) st.b = PRESETS[1].id;
  $('#sel-sc').innerHTML = TC.SCENARIOS.map(s => `<option value="${s.id}" ${s.id === st.sc ? 'selected' : ''}>${esc(s.name)}${s.official ? '' : ' (simulator scenario)'}</option>`).join('');
  $('#sel-fd').innerHTML = `<option value="">Auto: suits the scenario and the warbands</option>` + TC.FIELDS.map(f => `<option value="${f.id}" ${f.id === st.fd ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  const blurb = () => { const sc = TC.SCENARIOS.find(s => s.id === $('#sel-sc').value) || TC.SCENARIOS[0], fd = TC.FIELDS.find(f => f.id === $('#sel-fd').value); $('#sc-blurb').innerHTML = `<b>${esc(sc.name)}.</b> ${esc(sc.blurb)} ${esc(sc.deployText)}${fd ? ` <span class="mut">${esc(fd.name)}: ${esc(fd.blurb)}</span>` : ''}`; };
  $('#sel-sc').onchange = blurb; $('#sel-fd').onchange = blurb; blurb();
  $('#sel-a').innerHTML = listOptions(st.a); $('#sel-b').innerHTML = listOptions(st.b); $('#ctl-a').value = st.ca; $('#ctl-b').value = st.cb; $('#opt-infil').checked = !!st.infil;
  const upd = () => { $('#pv-a').innerHTML = listPreview($('#sel-a').value); $('#pv-b').innerHTML = listPreview($('#sel-b').value); }; $('#sel-a').onchange = upd; $('#sel-b').onchange = upd; upd(); s.classList.add('open'); }
function startFromSetup() { const cfg = { a: $('#sel-a').value, b: $('#sel-b').value, ctrl: [$('#ctl-a').value, $('#ctl-b').value], infil: $('#opt-infil').checked, seed: +$('#opt-seed').value || 0, scenario: $('#sel-sc').value, field: $('#sel-fd').value || undefined }; store.set('tc_setup', { a: cfg.a, b: cfg.b, ca: cfg.ctrl[0], cb: cfg.ctrl[1], infil: cfg.infil, sc: cfg.scenario, fd: cfg.field || '' }); $('#setup').classList.remove('open'); newGame(cfg); }

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
  PRESETS = allPresetLists();
  try { view = createView($('#board'), $('#board-wrap'), $('#labels'), UI, SIDE); } catch (e) { console.error(e); $('#board-wrap').innerHTML = '<div class="hint" style="padding:24px">The 3D table needs WebGL 2, which this browser did not provide.</div>'; return; }
  TC.view = view;
  view.onClick = c => { if (c.model) { UI.inspect = c.model; drawInspect(); } if (clickResolver) { const r = clickResolver; clickResolver = null; r(c); } };
  $('#cam-table').onclick = () => view.setCamera('table'); $('#cam-top').onclick = () => view.setCamera('top');
  const fol = $('#opt-follow'), nam = $('#opt-names'); fol.checked = store.get('tc_follow', true); nam.checked = store.get('tc_names', true); view.follow = fol.checked; view.showLabels = nam.checked;
  fol.onchange = () => { view.follow = fol.checked; store.set('tc_follow', fol.checked); }; nam.onchange = () => { view.showLabels = nam.checked; store.set('tc_names', nam.checked); };
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
TC.boot = boot; TC.start = newGame;   // TC.start({ a, b, ctrl, scenario, field, seed }) starts a game from the console
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
