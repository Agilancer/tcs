// Trench Crusade skirmish engine: rules (Digital Rulebook 1.0.2) + heuristic AI.
(function () {
'use strict';
const TC = window.TC = window.TC || {};
const BOARD = 36, CELL = 0.5, GN = BOARD / CELL;

// ---------- random ----------
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- dice maths ----------
const probCache = {};
// distribution of "keep best/worst 2 (or 3) of n" sums
function keepDist(extra, keep) {
  const key = extra + ':' + keep; if (probCache[key]) return probCache[key];
  const n = keep + Math.abs(extra), best = extra >= 0; const dist = {};
  const total = Math.pow(6, n); const arr = new Array(n).fill(1);
  for (let i = 0; i < total; i++) {
    let x = i; for (let k = 0; k < n; k++) { arr[k] = x % 6 + 1; x = Math.floor(x / 6); }
    const s = arr.slice().sort((a, b) => best ? b - a : a - b).slice(0, keep).reduce((a, b) => a + b, 0);
    dist[s] = (dist[s] || 0) + 1 / total;
  }
  return probCache[key] = dist;
}
function pSuccess(mod) { const d = keepDist(Math.max(-5, Math.min(5, mod)), 2); let p = 0, c = 0; for (const s in d) { if (+s >= 7) p += d[s]; if (+s >= 12) c += d[s]; } return { p, crit: c }; }
function injuryOutcome(injDice, injMod, deadly) {
  const d = keepDist(Math.max(-5, Math.min(5, injDice)), deadly ? 3 : 2); let down = 0, ooa = 0, minor = 0;
  for (const s in d) { const v = +s + injMod; if (v >= 9) ooa += d[s]; else if (v >= 7) down += d[s]; else if (v >= 2) minor += d[s]; }
  return { down, ooa, minor };
}
TC.pSuccess = pSuccess; TC.injuryOutcome = injuryOutcome;

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y; const l = dx * dx + dy * dy; let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }
function closestOnSeg(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y; const l = dx * dx + dy * dy; let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return { x: a.x + t * dx, y: a.y + t * dy }; }
function segInter(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x); if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d; const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { t, x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }; return null;
}
const inRect = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

// ---------- keyword parsing ----------
function parseKw(list) {
  const k = { dice: 0, injDice: 0, injMod: 0, auto: 0, blast: 0, cleave: 0 };
  for (const raw of list || []) {
    const s = String(raw).toUpperCase().trim(); let m;
    if ((m = s.match(/^([+-]\d+) DICE$/))) k.dice += +m[1];
    else if ((m = s.match(/^([+-]\d+) INJURY DICE$/))) k.injDice += +m[1];
    else if ((m = s.match(/^([+-]\d+) INJURY MODIFIER$/))) k.injMod += +m[1];
    else if ((m = s.match(/^AUTOMATIC\s*\(?(\d+)/))) k.auto = +m[1];
    else if ((m = s.match(/^BLAST\s*\(?(\d+)/))) k.blast = +m[1];
    else if ((m = s.match(/^CLEAVE\s*\(?(\d+)/))) k.cleave = +m[1];
    else k[s.replace(/[^A-Z]+/g, '_').replace(/^_|_$/g, '').toLowerCase()] = true;
  }
  return k;
}
TC.parseKw = parseKw;

// ---------- data resolution ----------
function factionVariant(fid, vid) {
  const f = TC.FACTIONS.find(x => x.id === fid); if (!f) return null;
  const v = f.variants.find(x => x.id === vid) || f.variants[0];
  const base = v.inherits ? f.variants.find(x => x.id === v.inherits) : null;
  const rm = new Set(v.removeModels || []);
  const models = [...(v.models || [])]; if (base) for (const bm of base.models) if (!rm.has(bm.id) && !models.find(x => x.id === bm.id)) models.push(bm);
  let armoury = [...(v.armoury || [])];
  if (base && !v.replacesArmoury) for (const it of base.armoury || []) if (!armoury.find(a => a.item === it.item && a.onlyFor === it.onlyFor)) armoury.push(it);
  const rmA = new Set(v.removeArmoury || []); armoury = armoury.filter(a => !rmA.has(a.item));
  const uniqueKit = [...(v.uniqueKit || []), ...(base ? base.uniqueKit || [] : [])];
  const specialRules = [...(base ? base.specialRules || [] : []), ...(v.specialRules || [])];
  return { faction: f, variant: v, models, armoury, uniqueKit, specialRules };
}
TC.factionVariant = factionVariant;
function findKit(name, fv) {
  const n = String(name).trim();
  if (fv) { const u = fv.uniqueKit.find(k => k.name === n); if (u) return { name: n, type: u.type, range: u.range, kw: u.keywords || [], text: u.text, sim: u.sim }; }
  for (const f of TC.FACTIONS) for (const v of f.variants) for (const u of v.uniqueKit || []) if (u.name === n) return { name: n, type: u.type, range: u.range, kw: u.keywords || [], text: u.text, sim: u.sim };
  if (TC.MERC_KIT[n]) return Object.assign({ name: n }, TC.MERC_KIT[n]);
  if (TC.CORE_KIT[n]) return Object.assign({ name: n }, TC.CORE_KIT[n]);
  if (!findKit._alt) { findKit._alt = true; try { for (const f of TC.FACTIONS) for (const v of f.variants) for (const u of v.uniqueKit || []) if (u.name.startsWith(n + ' (')) return findKit(u.name, fv); } finally { findKit._alt = false; } }
  return null;
}
TC.findKit = findKit;
function makeWeapon(k) {
  const kw = parseKw(k.kw); const out = { name: k.name, type: k.type, kw, raw: k, ranged: null, melee: false, sim: k.sim || {} };
  const r = k.range;
  if (k.type === 'Grenade') out.ranged = +r || 8;
  else if (typeof r === 'number') out.ranged = r;
  else if (typeof r === 'string') { const m = r.match(/(\d+)/); if (m) out.ranged = +m[1]; if (/melee/i.test(r)) out.melee = true; }
  if (k.melee || kw.pistol) out.melee = true;
  if (k.quickBursts) out.quickBursts = true; if (k.focused) out.focused = true; if (k.silent) out.silent = true;
  if (k.bullseye) out.bullseye = true; if (k.shortInj) out.shortInj = k.shortInj; if (k.liquidFire) out.liquidFire = true;
  if (k.selfBlood) out.selfBlood = true; if (k.despatch) out.despatch = true; if (k.unwieldy) out.unwieldy = true; if (k.sweep) out.sweep = true;
  if (k.extraBlood) out.extraBlood = k.extraBlood; if (k.offhandSecond) out.offhandSecond = true; if (k.once) out.once = true;
  if (out.sim && out.sim.kind === 'infernalBomb') out.infernal = true;
  if (out.sim && out.sim.kind === 'harrowing') out.harrowing = true;
  if (out.sim && out.sim.kind === 'evilPower') out.evilPower = true;
  if (/^Infernal Bomb$/.test(k.name)) out.infernal = true;
  if (/^Tartarus Claws$/.test(k.name)) out.harrowing = true;
  if (/^Blasphemous Staff$/.test(k.name)) out.evilPower = true;
  return out;
}

let UID = 1;
function buildModel(entry, list, side) {
  const fv = factionVariant(list.faction, list.variant);
  let def, merc = false;
  if (String(entry.model).startsWith('MERC:')) { const id = entry.model.slice(5); def = TC.MERCS[id] || TC.MERCS[id.replace(/^(communicant|mendelist)_/, '').replace('sister_of_saint_cosmas', 'sister_cosmas')]; merc = true; }
  else def = fv && fv.models.find(m => m.id === entry.model);
  if (!def) return null;
  const kwList = (def.keywords || []).map(s => String(s).toUpperCase());
  const m = {
    uid: UID++, side, label: entry.label || def.name, name: def.name, defId: def.id, merc, faction: fv ? fv.faction.name : '',
    move: def.move || 6, ranged: def.ranged == null ? null : def.ranged, melee: def.melee == null ? null : def.melee,
    armourChar: def.armour || 0, base: parseInt(def.base) || 25, r: (parseInt(def.base) || 25) / 25.4 / 2,
    kw: new Set(), weapons: [], kitArmour: 0, kitShield: 0, equipment: [], abilities: [], upgrades: entry.upgrades || [],
    blood: 0, bless: 0, infect: 0, down: false, ooa: false, toughUsed: false, x: 0, y: 0, h: 0, value: (entry.ducats || 0) + (entry.glory || 0) * 25,
    flags: {}, kitNames: []
  };
  kwList.forEach(k => m.kw.add(k));
  const kitNames = [...(def.fixedKit || []), ...(entry.kit || [])];
  const seen = new Set();
  for (const kn of kitNames) {
    if (seen.has(kn)) continue; seen.add(kn); m.kitNames.push(kn);
    const k = findKit(kn, fv); if (!k) { m.equipment.push({ name: kn, unknown: true }); continue; }
    if (k.type === 'Armour') { if (!((def.fixedKit || []).includes(kn) && (def.armour || 0) < 0)) m.kitArmour += (k.injMod != null ? k.injMod : (parseKw(k.kw).injMod || -1)); }
    else if (k.type === 'Shield') { if (!((def.fixedKit || []).includes(kn) && (def.armour || 0) < 0)) m.kitShield += (k.injMod != null ? k.injMod : (parseKw(k.kw).injMod || -1)); }
    else if (k.type === 'Equipment' || /Goetic|Ability/.test(k.type || '') || (k.type === 'Special' && !(k.range && (typeof k.range === 'number' || /\d|melee/i.test(k.range))))) {
      m.equipment.push(k); for (const w of k.kw || []) { const W = String(w).toUpperCase(); if (/^(NEGATE|FEAR|LEADER|BLESSED|REGENERATE|SKIRMISHER|TOUGH|INFILTRATOR|FLYING)/.test(W)) m.kw.add(W); }
      if (k.ammo) m.flags.ammo = k.ammo; if (k.talisman) m.flags.talisman = true; if (k.medikit) m.flags.medikit = true; if (k.fanfare) m.flags.fanfare = true;
      if (k.fieryExodus) m.flags.fiery = true; if (k.pills) m.flags.pills = true; if (k.shovel) m.flags.shovel = true;
      if (k.sim && k.sim.kind === 'bloodFrenzy') m.flags.frenzy = true;
    } else m.weapons.push(makeWeapon(k));
  }
  if (def.natural) m.weapons.push(makeWeapon(def.natural));
  if (!m.weapons.some(w => w.melee)) {
    const nat = (def.abilities || []).find(a => /claw|teeth|sting|bite|jaw|fang|maw/i.test(a.name));
    if (nat) m.weapons.push(makeWeapon({ name: nat.name, type: '1H', range: 'Melee', kw: [], natural: true }));
    else m.weapons.push(makeWeapon({ name: 'Fists', type: '1H', range: 'Melee', kw: ['-1 DICE', '-1 INJURY DICE'], natural: true }));
  }
  for (const a of def.abilities || []) m.abilities.push(a);
  // upgrades
  const updefs = def.upgrades || [];
  for (const un of entry.upgrades || []) {
    const u = updefs.find(x => x.name === un); if (!u) { m.abilities.push({ name: un, text: '', sim: { kind: 'none' } }); continue; }
    const s = u.sim || {};
    if (s.kind === 'statRanged') m.ranged = (m.ranged || 0) + s.value;
    else if (s.kind === 'statMelee') m.melee = (m.melee || 0) + s.value;
    else if (s.kind === 'deploy' && s.effect === 'infiltrate') m.kw.add('INFILTRATOR');
    else if (s.kind === 'keyword' && s.value) m.kw.add(String(s.value).toUpperCase());
    else if (s.kind === 'levitate') m.flags.levitate = true;
    m.abilities.push({ name: u.name, text: u.text, sim: s });
    if (/legionnaire/i.test(un) && /melee/i.test(un) && s.kind !== 'statMelee') m.melee = (m.melee || 0) + 1;
  }
  for (const a of m.abilities) { const s = a.sim || {}; if (s.kind === 'levitate') m.flags.levitate = true; if (s.kind === 'tough') m.kw.add('TOUGH'); if (s.kind === 'fear') m.kw.add('FEAR'); if (s.kind === 'regenerate') m.kw.add('REGENERATE ' + (s.value || 1)); if (s.kind === 'noDash') m.flags.noDash = true; if (s.kind === 'slowDash') m.flags.slowDash = true; if (s.kind === 'barbed') m.flags.barbed = true; if (s.kind === 'move') m.move = s.value; }
  if (m.kw.has('DEMONIC')) m.kw.add('NEGATE FIRE');
  if (m.kw.has('GOLEM')) { m.kw.add('NEGATE FEAR'); m.kw.add('NEGATE GAS'); }
  if ([...m.kw].some(k => k === 'FLYING')) m.flags.levitate = true;
  m.elite = m.kw.has('ELITE'); m.leader = m.kw.has('LEADER');
  for (const k of m.kw) { const b = k.match(/^BLESSED (\d+)/); if (b) m.bless += +b[1]; }
  m.factionRules = merc ? [] : (fv ? fv.specialRules : []);
  m.factionDash = 0; for (const r of m.factionRules) if (r.sim && r.sim.kind === 'dashBonus') m.factionDash += r.sim.value || 1;
  // role guess for AI
  const rw = m.weapons.filter(w => w.ranged && w.type !== 'Grenade');
  const mw = m.weapons.filter(w => w.melee && !(w.ranged && w.kw.pistol && false));
  m.role = (rw.length && (m.ranged || 0) >= (m.melee || 0) - 0) ? 'shooter' : (mw.length ? 'melee' : (rw.length ? 'shooter' : 'support'));
  if (m.weapons.some(w => w.infernal)) m.role = 'artillery';
  return m;
}
TC.buildModel = buildModel;

// list cost check (used by builder + presets)
TC.listTotals = function (list) { let d = 0, g = 0; for (const e of list.models) { d += +e.ducats || 0; g += +e.glory || 0; } return { d, g }; };

// ---------- terrain ----------
function genTerrain(rng) {
  const T = { ruins: [], walls: [], craters: [], wire: [], landmarks: [], objectives: [] };
  const objPts = [{ x: 12, y: 6 }, { x: 24, y: 6 }, { x: 18, y: 18 }, { x: 12, y: 30 }, { x: 24, y: 30 }];
  const jitter = (v) => v + (rng() - 0.5) * 1.2;
  objPts.forEach((p, i) => {
    const w = 5 + Math.round(rng() * 2), h = 4 + Math.round(rng() * 2);
    const R = { id: 'ruin' + i, x: jitter(p.x) - w / 2, y: jitter(p.y) - h / 2, w, h, segs: [] };
    R.x = Math.max(0.5, Math.min(BOARD - w - 0.5, R.x)); R.y = Math.max(0.5, Math.min(BOARD - h - 0.5, R.y));
    // walls with gaps (doors/windows): split each side into pieces, randomly open some
    const corners = [{ x: R.x, y: R.y }, { x: R.x + w, y: R.y }, { x: R.x + w, y: R.y + h }, { x: R.x, y: R.y + h }];
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4]; const L = dist(a, b); const n = Math.max(2, Math.round(L / 1.6));
      const missing = rng() < 0.35; // a fully broken side
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n; const open = missing ? (k > 0 && k < n - 1) : (rng() < 0.3 && k > 0 && k < n - 1);
        if (open) continue;
        R.segs.push({ a: { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }, b: { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }, h: 2.5, ruin: R.id });
      }
    }
    // upper floor over half the footprint
    const horiz = rng() < 0.5; R.upper = horiz ? { x: R.x + 0.3, y: R.y + 0.3, w: w / 2 - 0.3, h: h - 0.6 } : { x: R.x + 0.3, y: R.y + 0.3, w: w - 0.6, h: h / 2 - 0.3 };
    if (i === 2 || rng() < 0.6) R.hasUpper = true;
    R.objective = true; T.ruins.push(R); T.objectives.push(R);
  });
  const free = (x, y, rad) => {
    if (x < 1 || y < 1 || x > BOARD - 1 || y > BOARD - 1) return false;
    for (const R of T.ruins) if (inRect({ x, y }, R, rad + 2)) return false;
    for (const c of [...T.craters, ...T.landmarks]) if (Math.hypot(c.x - x, c.y - y) < c.r + rad + 2.5) return false;
    for (const w of [...T.walls, ...T.wire]) if (segDist({ x, y }, w.a, w.b) < rad + 2.5) return false;
    return true;
  };
  const place = (fn, n, rad, zone) => { let tries = 0, c = 0; while (c < n && tries++ < 400) { const x = zone ? zone[0] + rng() * (zone[1] - zone[0]) : 2 + rng() * (BOARD - 4); const y = 2 + rng() * (BOARD - 4); if (free(x, y, rad)) { fn(x, y); c++; } } };
  place((x, y) => T.craters.push({ x, y, r: 1.3 + rng() * 1.1 }), 5, 2.2, [8, 28]);
  place((x, y) => T.landmarks.push({ x, y, r: 0.8 + rng() * 0.5 }), 2, 1.3, [9, 27]);
  place((x, y) => { const ang = rng() * Math.PI; const L = 2 + rng() * 1.5; T.wire.push({ a: { x: x - Math.cos(ang) * L, y: y - Math.sin(ang) * L }, b: { x: x + Math.cos(ang) * L, y: y + Math.sin(ang) * L }, wd: 0.7 }); }, 3, 2.5, [9, 27]);
  // low walls / sandbags: some in no man's land, two in each deployment zone
  const wall = (x, y, vertical, L) => T.walls.push({ a: { x: vertical ? x : x - L / 2, y: vertical ? y - L / 2 : y }, b: { x: vertical ? x : x + L / 2, y: vertical ? y + L / 2 : y }, h: 1 });
  place((x, y) => wall(x, y, rng() < 0.6, 3 + rng() * 1.5), 5, 2, [8, 28]);
  [[4.5, 10], [4.5, 26], [31.5, 10], [31.5, 26]].forEach(([x, y]) => { y += (rng() - 0.5) * 4; if (free(x, y, 1)) wall(x, y, true, 3.5); });
  return T;
}
TC.genTerrain = genTerrain;

// ---------- the game ----------
class Game {
  constructor(opts) {
    this.opts = opts; this.seed = opts.seed || (Date.now() % 1e9); this.rng = mulberry(this.seed);
    this.ui = opts.ui; this.turn = 0; this.maxTurns = 4; this.vp = [0, 0]; this.deeds = {}; this.shaken = [false, false]; this.fled = -1;
    this.lists = opts.lists; this.ctrl = opts.ctrl || ['ai', 'ai']; this.allowInfiltrate = !!opts.allowInfiltrate;
    this.terrain = genTerrain(this.rng);
    this.models = []; this.lists.forEach((l, side) => l.models.forEach(e => { const m = buildModel(e, l, side); if (m) this.models.push(m); }));
    this.startCount = [0, 1].map(s => this.models.filter(m => m.side === s).length);
    this.buildGrid(); this.firstDeploySide = 0; this.over = false; this.winner = null;
  }
  d6() { return 1 + Math.floor(this.rng() * 6); }
  d3() { return Math.ceil(this.d6() / 2); }
  alive(side) { return this.models.filter(m => !m.ooa && (side == null || m.side === side)); }
  enemiesOf(m) { return this.models.filter(o => !o.ooa && o.side !== m.side); }
  friendsOf(m) { return this.models.filter(o => !o.ooa && o.side === m.side && o !== m); }
  edgeDist(a, b) { return dist(a, b) - a.r - b.r; }
  sideName(s) { return this.lists[s].shortName || this.lists[s].name; }

  // ----- grid / pathing -----
  buildGrid() {
    const T = this.terrain; this.cost = new Float32Array(GN * GN); this.wallBlock = new Uint8Array(GN * GN); this.danger = new Uint8Array(GN * GN);
    const blockSegs = []; T.ruins.forEach(R => R.segs.forEach(s => blockSegs.push(s)));
    this.losSegs = blockSegs; this.coverSegs = [...blockSegs, ...T.walls];
    for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
      const p = { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL }, i = gy * GN + gx; let c = 1;
      for (const cr of T.craters) if (Math.hypot(p.x - cr.x, p.y - cr.y) < cr.r) c = 2;
      for (const w of T.wire) if (segDist(p, w.a, w.b) < w.wd) { this.danger[i] = 1; }
      for (const L of T.landmarks) if (Math.hypot(p.x - L.x, p.y - L.y) < L.r + 0.15) this.wallBlock[i] = 1;
      for (const s of blockSegs) if (segDist(p, s.a, s.b) < 0.28) this.wallBlock[i] = 1;
      this.cost[i] = c;
    }
  }
  cellOf(p) { return { gx: Math.max(0, Math.min(GN - 1, Math.floor(p.x / CELL))), gy: Math.max(0, Math.min(GN - 1, Math.floor(p.y / CELL))) }; }
  // Dijkstra distance field for model m. opts: {allowEnemyNear:target}
  field(m, opts = {}) {
    const N = GN * GN; const D = new Float32Array(N).fill(1e9); const prev = new Int32Array(N).fill(-1);
    const blocked = new Uint8Array(N); const rr = m.r;
    const others = this.models.filter(o => !o.ooa && o !== m);
    for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
      const i = gy * GN + gx; const p = { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
      if (p.x < rr || p.y < rr || p.x > BOARD - rr || p.y > BOARD - rr) { blocked[i] = 1; continue; }
      if (this.wallBlock[i]) { blocked[i] = 1; continue; }
      // wall proximity check for base radius
      let bad = false;
      for (const s of this.losSegs) if (segDist(p, s.a, s.b) < rr * 0.85) { bad = true; break; }
      if (!bad) for (const L of this.terrain.landmarks) if (Math.hypot(p.x - L.x, p.y - L.y) < L.r + rr * 0.85) { bad = true; break; }
      if (!bad) for (const o of others) {
        const d = Math.hypot(p.x - o.x, p.y - o.y) - o.r - rr;
        if (o.side === m.side) { if (d < -0.05) { bad = 2; break; } } // can pass through friends if enough move (approx: allow transit, forbid ending)
        else { const lim = (opts.target === o) ? -0.05 : 1.0; if (opts.ignoreEnemyZone) { if (d < -0.05) { bad = true; break; } } else if (d < lim && !(opts.startEngaged && d >= -0.05)) { bad = true; break; } }
      }
      if (bad === true) blocked[i] = 1; else if (bad === 2) blocked[i] = 2;
    }
    const s = this.cellOf(m); const si = s.gy * GN + s.gx; D[si] = 0; blocked[si] = 0;
    // binary heap
    const heap = [[0, si]]; const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const pa = (k - 1) >> 1; if (heap[pa][0] <= heap[k][0]) break; [heap[pa], heap[k]] = [heap[k], heap[pa]]; k = pa; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let mi = k; if (l < heap.length && heap[l][0] < heap[mi][0]) mi = l; if (r < heap.length && heap[r][0] < heap[mi][0]) mi = r; if (mi === k) break; [heap[mi], heap[k]] = [heap[k], heap[mi]]; k = mi; } } return top; };
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    const limit = opts.limit || 40;
    while (heap.length) {
      const [d, i] = pop(); if (d > D[i]) continue; if (d > limit) break;
      const gx = i % GN, gy = (i / GN) | 0;
      for (const [dx, dy, w] of dirs) {
        const nx = gx + dx, ny = gy + dy; if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) continue; const j = ny * GN + nx;
        if (blocked[j] === 1) continue; if (dx && dy && (blocked[gy * GN + nx] === 1 || blocked[ny * GN + gx] === 1)) continue;
        const step = w * CELL * Math.max(this.cost[i], this.cost[j]) + (this.danger[j] && !this.danger[i] ? (opts.avoidDanger === false ? 0 : 2.5) : 0);
        const nd = d + step; if (nd < D[j]) { D[j] = nd; prev[j] = i; push(nd, j); }
      }
    }
    return { D, prev, blocked, start: si, m };
  }
  pathTo(F, gi) { const pts = []; let i = gi; while (i !== -1 && i !== F.start) { pts.push({ x: (i % GN + 0.5) * CELL, y: (((i / GN) | 0) + 0.5) * CELL }); i = F.prev[i]; } pts.push({ x: F.m.x, y: F.m.y }); return pts.reverse(); }
  pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }
  // true travelled length accounting for difficult terrain
  pathCost(pts) { let L = 0; for (let i = 1; i < pts.length; i++) { const a = this.cellOf(pts[i - 1]), b = this.cellOf(pts[i]); L += dist(pts[i - 1], pts[i]) * Math.max(this.cost[a.gy * GN + a.gx], this.cost[b.gy * GN + b.gx]); } return L; }
  cellPt(i) { return { x: (i % GN + 0.5) * CELL, y: (((i / GN) | 0) + 0.5) * CELL }; }
  canEndAt(m, p) {
    for (const o of this.models) { if (o.ooa || o === m) continue; if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + m.r - 0.02) return false; }
    return true;
  }

  // ----- LOS & cover -----
  segBlocked(a, b, ignoreNear, shooterH = 0, targetH = 0) {
    for (const s of this.losSegs) {
      const hit = segInter(a, b, s.a, s.b); if (!hit) continue;
      const near = Math.min(dist(hit, a), dist(hit, b)); if (near < ignoreNear) continue;
      if (shooterH >= 3 && dist(hit, a) < dist(hit, b) * 0.6) continue; // shooting down over a wall near the shooter
      if (shooterH >= 3 && targetH >= 3) continue;
      return true;
    }
    for (const L of this.terrain.landmarks) if (segDist(L, a, b) < L.r) return true;
    return false;
  }
  los(a, b) { // returns {vis, partial}
    if (b.flags && b.flags.faded) return { vis: false };
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, px = -dy / L, py = dx / L;
    const lines = [0, 0.8, -0.8].map(f => ({ x: b.x + px * b.r * f, y: b.y + py * b.r * f }));
    let clear = 0; for (const t of lines) if (!this.segBlocked(a, t, 0.35, a.h || 0, b.h || 0)) clear++;
    return { vis: clear > 0, partial: clear > 0 && clear < 3 };
  }
  losPoint(a, p) { return !this.segBlocked(a, p, 0.35, a.h || 0, 0); }
  inCoverFrom(t, att) {
    if ((att.h || 0) >= 3 && !(t.h >= 3)) { /* still allow walls near target */ }
    const L = this.los(att, t); if (L.partial) return true;
    for (const s of this.coverSegs) {
      if (segDist(t, s.a, s.b) > t.r + 0.55) continue;
      const c = closestOnSeg(t, s.a, s.b); const toAtt = { x: att.x - t.x, y: att.y - t.y }, toC = { x: c.x - t.x, y: c.y - t.y };
      if (toAtt.x * toC.x + toAtt.y * toC.y > 0) { if ((att.h || 0) >= 3 && s.h <= 1 && !(t.h >= 3)) continue; return true; }
    }
    for (const Lm of this.terrain.landmarks) { if (Math.hypot(Lm.x - t.x, Lm.y - t.y) < Lm.r + t.r + 0.5 && segDist(Lm, att, t) < Lm.r + t.r + 0.6) return true; }
    return false;
  }
  silentBonus(shooter, target) { for (const s of this.coverSegs) { if (segDist(shooter, s.a, s.b) > shooter.r + 0.55) continue; const c = closestOnSeg(shooter, s.a, s.b); if ((target.x - shooter.x) * (c.x - shooter.x) + (target.y - shooter.y) * (c.y - shooter.y) > 0) return true; } return false; }
  inRuin(p) { return this.terrain.ruins.find(R => inRect(p, R)); }
  onObjective(m, R) { return inRect(m, R, -0.01) || inRect(m, R, m.r + 1); }

  // ----- modifiers -----
  auraDice(m) { // enemy auras that hit m's success rolls
    let v = 0; const src = [];
    for (const o of this.enemiesOf(m)) { if (o.down && false) continue; for (const a of o.abilities) { const s = a.sim || {}; if (s.kind === 'aura' && s.who === 'enemy' && s.effect === 'dice' && this.edgeDist(o, m) <= s.range) { v += s.value; src.push(a.name + ' (' + o.label + ')'); } } }
    for (const o of this.friendsOf(m)) for (const a of o.abilities) { const s = a.sim || {}; if (s.kind === 'aura' && s.who === 'friendly' && s.effect === 'dice' && this.edgeDist(o, m) <= s.range) { v += s.value; src.push(a.name); } }
    // stack identical auras only once each
    return { v: Math.max(-2, Math.min(2, v)), src };
  }
  defence(t, vs) { let v = 0; for (const a of t.abilities) { const s = a.sim || {}; if (s.kind === 'defence' && (s.vs === vs || s.vs === 'all')) v += s.value; } return v; }
  hasEvil(m) { return m.weapons.some(w => w.evilPower); }
  frightens(attacker, target) { const tf = target.kw.has('FEAR'); const af = attacker.kw.has('FEAR') || attacker.kw.has('NEGATE FEAR'); return tf && !af; }

  // ----- rolls -----
  // base success roll. mods: [{v, why}]
  async successRoll(m, mods, title, opts = {}) {
    const A = this.auraDice(m); if (A.v) mods.push({ v: A.v, why: A.src.join(', ') });
    if (m.down) mods.push({ v: -1, why: 'Down' });
    // opponent spends blood markers
    let spentBlood = 0;
    if (m.blood > 0 && !opts.noBloodSpend) { const keep = opts.attack ? (m.blood >= 3 ? 1 : 0) : (opts.important && m.blood >= 2 ? 1 : 0); spentBlood = Math.min(m.blood, keep); if (spentBlood) { m.blood -= spentBlood; mods.push({ v: -spentBlood, why: `${spentBlood} blood marker spent by opponent` }); } }
    if (m.bless > 0 && (opts.attack || opts.important) && (m.bless >= 2 || opts.important)) { m.bless--; mods.push({ v: 1, why: 'blessing marker spent' }); }
    let total = mods.reduce((a, b) => a + b.v, 0);
    const risky = !!opts.risky || this.shaken[m.side];
    const n = 2 + Math.abs(total); const dice = []; for (let i = 0; i < n; i++) dice.push(this.d6());
    const order = dice.map((v, i) => [v, i]).sort((a, b) => total >= 0 ? b[0] - a[0] : a[0] - b[0]); const kept = order.slice(0, 2).map(x => x[1]);
    const sum = kept.reduce((a, i) => a + dice[i], 0);
    const res = sum >= 12 ? 'crit' : sum >= 7 ? 'success' : 'fail';
    await this.ui.roll({ kind: 'success', title, m, dice, kept, total, mods, sum, res, risky });
    if (res === 'fail' && opts.talismanable !== false && risky && m.flags.talisman && !m.flags.talismanUsed) { m.flags.talismanUsed = true; this.ui.log('rule', `${m.label} uses a Talisman: the failed Risky roll does not end the Activation.`); return { res, sum, saved: true }; }
    return { res, sum };
  }
  async injuryRoll(t, o) { // o: {injDice, injMod, armourMode:'normal'|'ap'|'ignore', deadly, attacker, why:[], melee, ranged, kw, title, fall}
    const why = o.why || [];
    let injDice = o.injDice || 0; let injMod = o.injMod || 0;
    // armour
    let arm = (t.armourChar || 0) + (t.kitArmour || 0) + (t.kitShield || 0);
    if (o.armourMode === 'ignore') { if (arm) why.push('armour ignored'); arm = 0; } else if (o.armourMode === 'ap' && arm < 0) { arm = Math.min(0, arm + 1); why.push('armour piercing'); }
    arm = Math.max(-3, arm);
    // defender blessing
    if (t.bless > 0 && !o.fall) { t.bless--; injDice -= 1; why.push(`${t.label} spends a blessing marker (-1 INJURY DICE)`); }
    // attacker spends blood: bloodbath or up to 3
    let bloodbath = false;
    if (!o.fall && o.attacker && t.blood > 0) {
      const golem = t.kw.has('GOLEM');
      if (t.blood >= 6 || (t.down && t.blood >= 3)) { const n = t.down ? 3 : 6; t.blood -= n; bloodbath = true; why.push(`Bloodbath! ${n} blood markers spent`); }
      else { const spend = Math.min(t.blood, golem ? t.blood : (t.blood >= 3 ? 3 : t.blood)); t.blood -= spend; injDice += spend; why.push(`${spend} blood marker${spend > 1 ? 's' : ''} spent (+${spend} INJURY DICE)`); }
    }
    const keep = (bloodbath ? 3 : 2) + (o.deadly ? 1 : 0);
    const n = keep + Math.abs(injDice); const dice = []; for (let i = 0; i < n; i++) dice.push(this.d6());
    const order = dice.map((v, i) => [v, i]).sort((a, b) => injDice >= 0 ? b[0] - a[0] : a[0] - b[0]); const kept = order.slice(0, keep).map(x => x[1]);
    let sum = kept.reduce((a, i) => a + dice[i], 0); const final = sum + injMod + arm;
    let res = final >= 9 ? 'ooa' : final >= 7 ? 'down' : final >= 2 ? 'minor' : 'none';
    const modsTxt = []; if (injMod) modsTxt.push(`${injMod > 0 ? '+' : ''}${injMod} weapon`); if (arm) modsTxt.push(`${arm} armour`);
    await this.ui.roll({ kind: 'injury', title: o.title || `Injury roll on ${t.label}`, m: t, dice, kept, total: injDice, sum, final, mods: why.map(w => ({ why: w })), modsTxt, res, deadly: o.deadly, bloodbath });
    return await this.applyInjury(t, res, o, bloodbath);
  }
  async applyInjury(t, res, o, bloodbath) {
    const attacker = o.attacker; let out = res;
    if (res === 'ooa' && t.kw.has('GOLEM') && !bloodbath) { out = 'down'; this.ui.log('rule', `${t.label} is a GOLEM: Out of Action becomes Down.`); }
    if (out === 'ooa' && t.kw.has('TOUGH') && !t.toughUsed) { t.toughUsed = true; out = 'down'; this.ui.log('rule', `${t.label} is TOUGH: the first Out of Action becomes Down.`); }
    if (out === 'minor') { this.addBlood(t, 1, attacker); this.ui.log('result', `<b>${t.label}</b> takes a Minor Hit (1 blood marker).`); }
    else if (out === 'down') {
      const wasDown = t.down; this.addBlood(t, wasDown ? 2 : 1, attacker);
      if (!wasDown && (t.h || 0) >= 3) { await this.ledgeCheck(t, attacker); if (t.ooa) return 'ooa'; }
      t.down = true; this.ui.log('result', `<b>${t.label}</b> is taken <b>Down</b>${wasDown ? ' again (2 blood markers)' : ''}.`);
      if (this.activeModel === t) this.activeModel.flags.endNow = true;
      this.ui.anim({ type: 'knock', m: t });
    } else if (out === 'ooa') { await this.removeModel(t, attacker, o); }
    else this.ui.log('result', `No effect on <b>${t.label}</b>.`);
    // extra markers from keywords (even on no effect)
    if (!t.ooa && o.kw) {
      const extra = (k, neg) => { if (o.kw[k] && !t.kw.has(neg)) { this.addBlood(t, 1, attacker); this.ui.log('rule', `${k.toUpperCase()}: +1 blood marker on ${t.label}.`); } };
      extra('fire', 'NEGATE FIRE'); extra('gas', 'NEGATE GAS'); extra('shrapnel', 'NEGATE SHRAPNEL');
      if (o.extraBlood) { this.addBlood(t, o.extraBlood, attacker); }
    }
    return out;
  }
  addBlood(t, n, attacker) {
    const before = t.blood; t.blood = Math.min(6, t.blood + n);
    if (before < 6 && t.blood === 6 && attacker && attacker.side !== t.side) this.deed(attacker.side, 'Bloodletting', attacker);
  }
  async ledgeCheck(t, attacker) {
    const r = await this.successRoll(t, [], `${t.label} keeps footing on the ledge`, { noBloodSpend: true, talismanable: false });
    if (r.res === 'fail') { this.ui.log('result', `${t.label} topples off the upper floor!`); await this.fall(t, 3, attacker); }
  }
  async fall(t, height, attacker) {
    t.h = 0; this.ui.anim({ type: 'fall', m: t }); if (attacker && attacker.side !== t.side && height >= 3) this.deed(attacker.side, 'Cast Them Down', attacker);
    if (t.flags.levitate) { this.ui.log('rule', `${t.label} floats down unharmed.`); return; }
    if (height < 3) return; const extra = Math.floor(height / 3);
    await this.injuryRoll(t, { injDice: extra, why: [`fall of ${height}" (+${extra} INJURY DICE)`], fall: true, attacker, title: `Falling injury on ${t.label}` });
  }
  async removeModel(t, attacker, o = {}) {
    t.ooa = true; t.down = false; this.ui.log('result', `<b>${t.label}</b> is taken <b>Out of Action!</b>`); this.ui.anim({ type: 'death', m: t });
    if (attacker && attacker.side !== t.side) {
      attacker.flags.kills = (attacker.flags.kills || 0) + 1;
      if (o.melee) { attacker.flags.meleeKillsTurn = (attacker.flags.meleeKillsTurn || 0) + 1; if (attacker.flags.meleeKillsTurn >= 2) this.deed(attacker.side, 'Lord of War', attacker); }
      if (attacker.flags.startedDown && this.activeModel === attacker) this.deed(attacker.side, 'Resist and Bite', attacker);
      if (o.ranged && t.elite && o.longRange && o.cover) this.deed(attacker.side, 'Sniper', attacker);
    }
    // on-death effects
    for (const a of t.abilities) { const s = a.sim || {}; if (s.kind === 'onDeath' && s.effect === 'blessNearestElite') { const el = this.friendsOf(t).filter(f => f.elite).sort((a, b) => dist(a, t) - dist(b, t))[0]; if (el) { el.bless = Math.min(6, el.bless + 1); this.ui.log('rule', `${a.name}: ${el.label} gains a blessing marker.`); } } if (s.kind === 'onDeath' && s.effect === 'bloodAdjacent') { for (const e of this.enemiesOf(t)) if (this.edgeDist(e, t) <= 1) { this.addBlood(e, 1, t); } } }
    if (t.flags.fiery) { for (const e of this.enemiesOf(t)) if (this.edgeDist(e, t) <= 1 && !e.kw.has('NEGATE FIRE')) { this.addBlood(e, 1, t); this.ui.log('rule', `Fiery Exodus: ${e.label} is scorched (+1 blood).`); } }
  }
  deed(side, name, m) { if (this.deeds[name] != null) return; this.deeds[name] = side; this.ui.log('deed', `Glorious Deed - <b>${name}</b> for ${this.sideName(side)}${m ? ' (' + m.label + ')' : ''}.`); }

  // ----- actions -----
  beginAct(m) { m.act = { moved: false, dashed: false, shots: 0, smgShots: 0, fought: false, charged: false, used: {}, nonAssaultShot: false, heavyShot: false, halfMove: false, reload: false, climbed: false }; m.flags.endNow = false; m.flags.startedDown = m.down; this.activeModel = m; }
  moveAllowance(m) { let v = m.move; if (m.act && m.act.halfMove) v /= 2; return v; }
  async standUp(m) { if (!m.down) return; m.down = false; m.act.halfMove = true; this.ui.log('action', `${m.label} stands back up (movement halved this activation).`); this.ui.update(); }
  async regenerate(m) { for (const k of m.kw) { const r = k.match(/^REGENERATE (\d+)/); if (r && m.blood) { const n = Math.min(m.blood, +r[1]); m.blood -= n; this.ui.log('rule', `${m.label} regenerates (${n} blood marker removed).`); } } }
  heavyLocked(m, w) { return w.kw.heavy && !m.kw.has('STRONG') && !m.kw.has('NEGATE HEAVY'); }
  async animatePath(m, pts) { await this.ui.moveAlong(m, pts); const last = pts[pts.length - 1]; m.x = last.x; m.y = last.y; }
  async enterDanger(m, pts) {
    // check if path enters wire: risky roll
    for (let i = 1; i < pts.length; i++) { const c = this.cellOf(pts[i]), p = this.cellOf(pts[i - 1]); if (this.danger[c.gy * GN + c.gx] && !this.danger[p.gy * GN + p.gx]) {
      await this.animatePath(m, pts.slice(0, i + 1));
      const r = await this.successRoll(m, [], `${m.label} crosses barbed wire (Dangerous terrain)`, { risky: true });
      if (r.res === 'fail' && !r.saved) { await this.injuryRoll(m, { title: `Barbed wire injury on ${m.label}`, why: ['dangerous terrain'] }); m.flags.endNow = true; return pts.slice(0, i + 1); }
      return null; } }
    return null;
  }
  async doMove(m, pts, kind = 'move') {
    if (kind === 'dash') {
      if (m.flags.noDash) return false;
      const mods = []; const b = m.factionDash; if (b) mods.push({ v: b, why: 'Fast as Lightning' }); if (m.flags.fanfareNear) mods.push({ v: 1, why: 'Fanfare' });
      const r = await this.successRoll(m, mods, `${m.label} Dashes`, { risky: true });
      m.act.dashed = true; if (r.res === 'fail' && !r.saved) { this.ui.log('result', `${m.label} stumbles: the Dash fails and the Activation ends.`); m.flags.endNow = true; return false; }
    } else m.act.moved = true;
    if (m.flags.faded) { m.flags.faded = false; this.ui.log('rule', `${m.label} leaves the shadows.`); }
    const stop = await this.enterDanger(m, pts); if (stop) return false;
    await this.animatePath(m, pts); this.afterMoveTriggers(m); this.ui.update(); return true;
  }
  afterMoveTriggers(m) { for (const e of this.enemiesOf(m)) if (e.flags.faded && this.edgeDist(e, m) <= 1.5) { e.flags.faded = false; this.ui.log('rule', `${e.label} is spotted and loses Fade.`); } }
  chargeReach(m) { return Math.min(12, this.moveAllowance(m) + 6); }
  async doCharge(m, target) {
    m.act.moved = true; m.act.charged = true; if (m.flags.faded) m.flags.faded = false;
    let bonus = 0; const heavy = m.weapons.some(w => w.kw.heavy) && !m.kw.has('STRONG');
    if (!heavy) { bonus = this.d6(); await this.ui.roll({ kind: 'plain', title: `${m.label} charge bonus (D6)`, m, dice: [bonus], kept: [0], sum: bonus }); }
    else this.ui.log('rule', `${m.label} carries HEAVY kit: no charge bonus.`);
    let reach = Math.min(12, this.moveAllowance(m) + (m.act.halfMove ? bonus / 2 : bonus));
    const F = this.field(m, { target, limit: reach + 2 });
    let best = -1, bestD = 1e9;
    for (let i = 0; i < GN * GN; i++) { if (F.D[i] > reach || F.blocked[i]) continue; const p = this.cellPt(i); const d = Math.hypot(p.x - target.x, p.y - target.y) - target.r - m.r; if (d <= 1 && this.canEndAt(m, p)) { const score = F.D[i] + d * 0.1; if (score < bestD) { bestD = score; best = i; } } }
    if (best < 0) { // fail: move as far as possible toward
      let bi = -1, bd = 1e9; for (let i = 0; i < GN * GN; i++) { if (F.D[i] > reach || F.blocked[i]) continue; const p = this.cellPt(i); if (!this.canEndAt(m, p)) continue; const d = Math.hypot(p.x - target.x, p.y - target.y); if (d < bd) { bd = d; bi = i; } }
      this.ui.log('result', `The charge falls short (reach ${reach.toFixed(1)}").`);
      if (bi >= 0) { const pts = this.pathTo(F, bi); const stop = await this.enterDanger(m, pts); if (!stop) await this.animatePath(m, pts); }
      this.ui.update(); return false;
    }
    const pts = this.pathTo(F, best); const stop = await this.enterDanger(m, pts); if (stop) return false; await this.animatePath(m, pts); this.afterMoveTriggers(m);
    this.ui.log('result', `${m.label} slams into ${target.label}!`); this.ui.anim({ type: 'charge', m, t: target }); this.ui.update(); return true;
  }
  async doRetreat(m, pts) {
    m.act.moved = true;
    const adj = this.enemiesOf(m).filter(e => this.edgeDist(e, m) <= 1 && !e.down);
    for (const e of adj) {
      const w = this.bestMelee(e, m)[0]; if (!w) continue;
      this.ui.log('action', `${e.label} lashes out at the retreating ${m.label}.`);
      await this.meleeAttack(e, m, w, { retreatHit: true });
      if (m.ooa || m.down) { this.ui.log('result', `${m.label} is cut down and cannot retreat.`); m.flags.endNow = true; return false; }
    }
    await this.animatePath(m, pts); this.ui.update(); return true;
  }
  // weapon helpers
  rangedWeapons(m) { return m.weapons.filter(w => w.ranged && !(w.once && w.used)); }
  meleeWeapons(m) { return m.weapons.filter(w => w.melee); }
  bestMelee(m, t) {
    const mw = this.meleeWeapons(m); if (!mw.length) return [];
    const score = w => { const k = w.kw; const io = injuryOutcome((k.injDice || 0) + 0, (k.injMod || 0) + (k.ignore_armour ? 0 : Math.max(-3, t.armourChar + t.kitArmour + t.kitShield + (k.armour_piercing ? 1 : 0))), false); return pSuccess((m.melee || 0) + (k.dice || 0)).p * (io.ooa * 2 + io.down) + (k.cleave ? 0.6 : 0); };
    const sorted = mw.slice().sort((a, b) => score(b) - score(a));
    const main = sorted[0]; const two = [main];
    const one = mw.filter(w => w.type === '1H' || (m.kw.has('STRONG') && w.type === '2H' && !w.kw.cumbersome));
    if ((main.type === '1H' || (m.kw.has('STRONG') && !main.kw.cumbersome)) && one.length > 1) { const off = one.filter(w => w !== main).sort((a, b) => score(b) - score(a))[0]; if (off && !(main.kw.held || off.kw.held)) two.push(off); }
    return two;
  }
  async meleeAttack(m, t, w, o = {}) {
    if (t.ooa) return;
    const mods = [{ v: m.melee || 0, why: 'Melee characteristic' }];
    if (w.kw.dice && !(o.offhand && w.unwieldy)) mods.push({ v: w.kw.dice, why: w.name });
    if (o.offhand && !m.kw.has('IGNORE OFF-HAND WEAPON')) mods.push({ v: -1, why: 'off-hand weapon' });
    if (this.frightens(m, t)) mods.push({ v: -1, why: `${t.label} causes FEAR` });
    if (this.inCoverFrom(t, m) && this.coverSegs.some(s => segDist(t, s.a, s.b) < t.r + 0.6)) mods.push({ v: -1, why: 'defended obstacle' });
    if ((t.weapons.some(x => x.kw.block) || t.kw.has('BLOCK')) && m.act && m.act.charged) mods.push({ v: -1, why: `${t.label}'s BLOCK` });
    const d = this.defence(t, 'melee'); if (d) mods.push({ v: d, why: 'defensive ability' });
    if (m.flags.frenzyNow) mods.push({ v: 1, why: 'Blood Frenzy' });
    const atk = w.name + (o.offhand ? ' (off-hand)' : '');
    this.ui.anim({ type: 'melee', m, t, w });
    const r = await this.successRoll(m, mods, `${m.label} strikes ${t.label} with ${atk}`, { attack: true, risky: !!w.kw.risky });
    if (r.res === 'fail') { this.ui.log('result', `Miss.${w.kw.risky && !r.saved ? ' (RISKY weapon: the Activation ends)' : ''}`); if (w.kw.risky && !r.saved) m.flags.endNow = true; return 'miss'; }
    if (w.selfBlood) { this.addBlood(m, 1); this.ui.log('rule', `${w.name} is Dangerous: ${m.label} takes a blood marker.`); }
    let injDice = (w.kw.injDice || 0); const why = []; if (injDice) why.push(`${w.name} ${injDice > 0 ? '+' : ''}${injDice} INJURY DICE`);
    if (r.res === 'crit') { const c = w.kw.critical || (m.flags.ammoCrit) ? 2 : 1; injDice += c; why.push(`critical (+${c} INJURY DICE)`); }
    if (t.down) { injDice += 1; why.push('target is Down (+1 INJURY DICE)'); }
    const ignore = w.kw.ignore_armour || (w.despatch && t.down);
    const res = await this.injuryRoll(t, { injDice, injMod: w.kw.injMod || 0, armourMode: ignore ? 'ignore' : (w.kw.armour_piercing ? 'ap' : 'normal'), attacker: m, why, melee: true, kw: w.kw, extraBlood: w.extraBlood, title: `Injury roll: ${w.name} on ${t.label}` });
    if (w.extraBlood && /Gavel/.test(w.name) && !t.ooa && [...t.kw].some(k => /HERETIC|DEMONIC|BLACK GRAIL/.test(k))) this.addBlood(t, 1, m);
    return res;
  }
  async doFight(m, t, weapons) {
    m.act.fought = true; if (m.flags.faded) m.flags.faded = false;
    weapons = weapons || this.bestMelee(m, t); if (!weapons.length) { this.ui.log('result', `${m.label} has no melee weapon.`); return; }
    if (m.flags.frenzy && !m.flags.frenzyUsed && [m, ...this.models].some(o => !o.ooa && o.blood > 0 && this.edgeDist(o, m) <= 1)) { m.flags.frenzyUsed = true; m.flags.frenzyNow = true; this.ui.log('rule', `${m.label} invokes the Shark Tooth Talisman: Blood Frenzy!`); }
    let first = true;
    for (const w of weapons) {
      const n = Math.max(1, w.kw.cleave || 0);
      for (let k = 0; k < n; k++) {
        let tgt = t; if (tgt.ooa) { tgt = this.enemiesOf(m).filter(e => this.edgeDist(e, m) <= 1).sort((a, b) => a.blood - b.blood)[0]; if (!tgt) break; }
        if (w.sweep) { for (const e of this.enemiesOf(m).filter(e => this.edgeDist(e, m) <= 1)) { await this.meleeAttack(m, e, w, {}); if (m.flags.endNow) break; } break; }
        const off = !first && w !== weapons[0] || (w.offhandSecond && k === 1);
        const res = await this.meleeAttack(m, tgt, w, { offhand: off });
        if (m.flags.endNow || m.ooa) return;
        if (w.harrowing && (res === 'down' || res === 'ooa') && !m.flags.harrowed) {
          const next = this.enemiesOf(m).filter(e => e !== tgt && this.edgeDist(e, m) <= 4).sort((a, b) => dist(a, m) - dist(b, m))[0];
          if (next) { m.flags.harrowed = true; this.ui.log('rule', `Harrowing Assault: ${m.label} bounds 3" toward ${next.label} and fights again!`);
            const dx = next.x - m.x, dy = next.y - m.y, L = Math.hypot(dx, dy); const mv = Math.min(3, Math.max(0, L - m.r - next.r - 0.3)); const dest = { x: m.x + dx / L * mv, y: m.y + dy / L * mv };
            if (this.canEndAt(m, dest)) { await this.animatePath(m, [{ x: m.x, y: m.y }, dest]); if (this.edgeDist(m, next) <= 1) { const sub = this.bestMelee(m, next); for (const w2 of sub) for (let q = 0; q < Math.max(1, w2.kw.cleave || 0); q++) { if (next.ooa) break; await this.meleeAttack(m, next, w2, { offhand: w2 !== sub[0] }); if (m.flags.endNow) return; } } }
            return; }
        }
      }
      first = false;
    }
    m.flags.frenzyNow = false;
  }
  shootMods(m, t, w, d) {
    const mods = [{ v: m.ranged || 0, why: 'Ranged characteristic' }];
    if (w.kw.dice) mods.push({ v: w.kw.dice, why: w.name });
    if (m.flags.ammo === '+1 DICE') mods.push({ v: 1, why: 'Tracer Bullets' });
    const long = d > w.ranged / 2; const cover = this.inCoverFrom(t, m);
    if (long && !w.kw.ignore_long_range && !w.kw.shotgun) mods.push({ v: -1, why: 'Long Range' });
    if (cover && !w.kw.ignore_cover) mods.push({ v: -1, why: 'target in cover' });
    if ((m.h || 0) - (t.h || 0) >= 3 && !w.kw.ignore_elevated_position) mods.push({ v: 1, why: 'elevated position' });
    const df = this.defence(t, 'ranged'); if (df) mods.push({ v: df, why: 'defensive ability' });
    if (w.silent && this.silentBonus(m, t)) mods.push({ v: 1, why: 'Silent (firing from cover)' });
    return { mods, long, cover };
  }
  canShootNow(m, w) {
    if (!w || !w.ranged) return false; if (m.act.reload) return false;
    if (this.enemiesOf(m).some(e => this.edgeDist(e, m) <= 1)) return false;
    if ((m.act.charged || m.act.fought) && !w.kw.assault) return false;
    if (this.heavyLocked(m, w) && (m.act.moved || m.act.dashed)) return false;
    if (w.quickBursts) { if (m.act.smgShots >= 2) return false; if (m.act.shots > m.act.smgShots) return false; }
    else if (m.act.shots > 0) return false;
    return true;
  }
  async doShoot(m, w, target, point) {
    if (m.flags.faded) { m.flags.faded = false; }
    m.act.shots++; if (w.quickBursts) m.act.smgShots++; if (!w.kw.assault) m.act.nonAssaultShot = true; if (this.heavyLocked(m, w)) m.act.heavyShot = true;
    if (w.once) w.used = true;
    const auto = w.kw.auto || 1; let targets = [target];
    const ammo = m.flags.ammo; const kw = Object.assign({}, w.kw); if (ammo === 'FIRE') kw.fire = true; if (ammo === 'ARMOUR PIERCING') kw.armour_piercing = true; if (ammo === 'CRITICAL') kw.critical = true;
    for (let i = 0; i < auto; i++) {
      let t = targets[0];
      if (i > 0 && !w.focused) { // pick another target within 6" of the first if better
        const alts = this.enemiesOf(m).filter(e => e !== t && !e.ooa && dist(e, targets[0]) <= 6 && this.los(m, e).vis && this.edgeDist(m, e) <= w.ranged);
        if (t.ooa && alts.length) t = alts.sort((a, b) => this.shotValue(m, w, b) - this.shotValue(m, w, a))[0];
      }
      if (!t || t.ooa) break;
      await this.rangedAttack(m, w, t, kw, point);
      if (m.flags.endNow || m.ooa) break;
    }
    if (w.kw.reload) { m.act.reload = true; m.flags.endNow = true; this.ui.log('rule', `${w.name} must RELOAD: ${m.label}'s Activation ends.`); }
  }
  async rangedAttack(m, w, t, kw, point) {
    let target = t; const d = this.edgeDist(m, t);
    // shooting into melee
    const friendsNear = this.friendsOf(m).filter(f => this.edgeDist(f, t) <= 1);
    if (friendsNear.length && !kw.blast && !kw.flamethrower) { const r = this.d6(); await this.ui.roll({ kind: 'plain', title: `Shooting into melee (1-3 hits a friend)`, m, dice: [r], kept: [0], sum: r }); if (r <= 3) { target = friendsNear[Math.floor(this.rng() * friendsNear.length)]; this.ui.log('result', `The shot goes astray toward ${target.label}!`); } }
    const { mods, long, cover } = this.shootMods(m, target, Object.assign({}, w, { kw }), this.edgeDist(m, target));
    if (kw.blast) return this.blastAttack(m, w, target, kw, mods, long, cover);
    this.ui.anim({ type: kw.flamethrower ? 'flame' : 'shot', m, t: target, w });
    let r;
    if (kw.flamethrower) { this.ui.log('rule', `${w.name} hits automatically (FLAMETHROWER).`); r = { res: 'success' }; }
    else r = await this.successRoll(m, mods, `${m.label} fires ${w.name} at ${target.label}`, { attack: true, risky: !!kw.risky });
    if (r.res === 'fail') { this.ui.log('result', 'Miss.'); if (kw.risky && !r.saved) m.flags.endNow = true; return; }
    let injDice = kw.injDice || 0; const why = []; if (injDice) why.push(`${w.name} ${injDice > 0 ? '+' : ''}${injDice} INJURY DICE`);
    if (r.res === 'crit') { const c = kw.critical ? 2 : 1; injDice += c; why.push(`critical (+${c} INJURY DICE)`); }
    if (kw.shotgun && long) { injDice -= 1; why.push('shotgun at long range (-1 INJURY DICE)'); }
    if (w.shortInj && !long) { injDice += w.shortInj; why.push('alloy shot at short range'); }
    let ignore = kw.ignore_armour || (r.res === 'crit' && (w.bullseye || w.liquidFire));
    await this.injuryRoll(target, { injDice, injMod: kw.injMod || 0, armourMode: ignore ? 'ignore' : (kw.armour_piercing ? 'ap' : 'normal'), attacker: m, why, ranged: true, kw, longRange: long, cover, title: `Injury roll: ${w.name} on ${target.label}` });
  }
  async blastAttack(m, w, t, kw, mods, long, cover) {
    this.ui.anim({ type: w.type === 'Grenade' ? 'lob' : (w.infernal ? 'bomb' : 'lob'), m, t, w });
    const r = await this.successRoll(m, mods, `${m.label} launches ${w.name} at ${t.label}`, { attack: true, risky: !!kw.risky });
    let pt = { x: t.x, y: t.y }; let direct = r.res !== 'fail';
    if (r.res === 'fail') {
      if (!kw.scatter) { this.ui.log('result', 'Miss.'); return; }
      const dd = Math.max(1, 7 - r.sum); // opponent picks direction: choose the one that hits fewest of their own models
      let best = null, bestScore = 1e9;
      for (let a = 0; a < 16; a++) { const ang = a / 16 * Math.PI * 2; const p = { x: Math.max(0, Math.min(BOARD, pt.x + Math.cos(ang) * dd)), y: Math.max(0, Math.min(BOARD, pt.y + Math.sin(ang) * dd)) }; let s = 0; for (const o of this.alive()) if (Math.hypot(o.x - p.x, o.y - p.y) - o.r <= kw.blast) s += (o.side === t.side ? 1 : -0.7); if (s < bestScore) { bestScore = s; best = p; } }
      pt = best; this.ui.log('result', `It scatters ${dd}".`);
    }
    await this.ui.anim({ type: 'explode', p: pt, r: kw.blast, gas: !!kw.gas, fire: !!kw.fire, wait: true });
    const hit = [];
    for (const o of this.alive()) { const dd = Math.hypot(o.x - pt.x, o.y - pt.y) - o.r; if (dd <= kw.blast && this.losPoint({ x: pt.x, y: pt.y, h: 0 }, o)) hit.push(o); }
    const hitEnemies = hit.filter(o => o.side !== m.side);
    for (const f of this.friendsOf(m)) if (!hit.includes(f) && hitEnemies.some(e => this.edgeDist(e, f) <= 1)) hit.push(f);
    if (!hit.length) { this.ui.log('result', 'The blast catches nobody.'); return; }
    for (const o of hit) {
      if (o.ooa) continue; let injDice = kw.injDice || 0; const why = [];
      const isTarget = direct && o === t; const onPoint = !direct && Math.hypot(o.x - pt.x, o.y - pt.y) <= o.r;
      if (r.res === 'crit' && o === t) { const c = kw.critical ? 2 : 1; injDice += c; why.push(`critical (+${c})`); }
      if (w.infernal && kw.gas) {}
      if (w.infernal) { // duck rule
        if (this.coverSegs.some(s => segDist(o, s.a, s.b) < o.r + 0.55 && (() => { const c = closestOnSeg(o, s.a, s.b); return (pt.x - o.x) * (c.x - o.x) + (pt.y - o.y) * (c.y - o.y) > 0; })())) { injDice -= 1; why.push('Duck! (-1 INJURY DICE)'); }
      }
      if (kw.gas && o.abilities.some(a => /Abiotic/.test(a.name))) { injDice -= 1; why.push('Abiotic Life'); }
      if (kw.gas && o.kw.has('NEGATE GAS') && false) {}
      const deadly = w.infernal && (isTarget || onPoint);
      if (deadly) why.push('Infernal Strike: DEADLY');
      const res = await this.injuryRoll(o, { injDice, injMod: kw.injMod || 0, armourMode: kw.ignore_armour ? 'ignore' : (kw.armour_piercing ? 'ap' : 'normal'), attacker: m, why, ranged: true, kw, deadly, title: `Blast injury on ${o.label}`, longRange: long, cover });
      if (w.infernal && !o.ooa) { // mighty explosion
        const from = isTarget ? m : pt; const dd = this.d3(); await this.push(o, from, dd, m, 'blown away'); }
    }
  }
  async push(o, from, distIn, by, verb = 'moved') {
    let dx = o.x - from.x, dy = o.y - from.y; let L = Math.hypot(dx, dy); if (L < 0.01) { dx = 1; dy = 0; L = 1; }
    dx /= L; dy /= L; let moved = 0; const step = 0.1; let x = o.x, y = o.y; const startH = o.h || 0; const R = this.terrain.ruins.find(R => R.hasUpper && inRect(o, R.upper));
    while (moved < distIn) { const nx = x + dx * step, ny = y + dy * step; const p = { x: nx, y: ny };
      if (nx < o.r || ny < o.r || nx > BOARD - o.r || ny > BOARD - o.r) break;
      if (this.losSegs.some(s => segDist(p, s.a, s.b) < o.r * 0.8) && !(startH >= 3)) break;
      if (this.terrain.landmarks.some(Lm => Math.hypot(Lm.x - nx, Lm.y - ny) < Lm.r + o.r)) break;
      if (this.models.some(q => !q.ooa && q !== o && Math.hypot(q.x - nx, q.y - ny) < q.r + o.r)) break;
      x = nx; y = ny; moved += step; }
    if (moved < 0.05) { this.ui.log('result', `${o.label} is pinned in place.`); return; }
    await this.ui.moveAlong(o, [{ x: o.x, y: o.y }, { x, y }], 'push'); o.x = x; o.y = y;
    this.ui.log('result', `${o.label} is ${verb} ${moved.toFixed(1)}".`);
    if (startH >= 3 && R && !inRect(o, R.upper)) await this.fall(o, 3, by);
    this.afterMoveTriggers(o);
  }
  // ----- special abilities -----
  abilityActions(m) { return m.abilities.filter(a => a.sim && a.sim.kind === 'action' && !(m.act && m.act.used[a.name])); }
  async doAbility(m, a, arg) {
    const s = a.sim; m.act.used[a.name] = true;
    const evil = this.hasEvil(m) ? [{ v: 1, why: 'Blasphemous Staff' }] : [];
    const mods = [...evil]; if (s.bonusDice) mods.push({ v: s.bonusDice, why: a.name });
    const roll = async (title) => this.successRoll(m, mods, title, { risky: s.roll === 'risky', important: true });
    if (s.effect === 'bloodMarkers') {
      const t = arg; this.ui.anim({ type: 'gaze', m, t });
      const r = await roll(`${m.label} uses ${a.name} on ${t.label}`); if (r.res === 'fail') { this.ui.log('result', 'Nothing happens.'); if (s.roll === 'risky' && !r.saved) m.flags.endNow = true; return; }
      let n = r.res === 'crit' ? (s.critAmount || s.amount || 1) : (s.amount || 1); if (/Judgement/.test(a.name) && [...t.kw].some(k => /HERETIC|DEMONIC|BLACK GRAIL/.test(k))) n = 2;
      this.addBlood(t, n, m); this.ui.log('result', `${t.label} gains ${n} blood marker${n > 1 ? 's' : ''}.`);
    } else if (s.effect === 'blessFriendly') {
      const t = arg; const r = await roll(`${m.label} uses ${a.name} on ${t.label}`); if (r.res === 'fail') { this.ui.log('result', 'Nothing happens.'); if (s.roll === 'risky' && !r.saved) m.flags.endNow = true; return; }
      t.bless = Math.min(6, t.bless + (s.amount || 1)); this.ui.anim({ type: 'bless', m: t }); this.ui.log('result', `${t.label} gains a blessing marker.`);
    } else if (s.effect === 'heal') {
      const t = arg; const r = await roll(`${m.label} uses ${a.name} on ${t.label}`); if (r.res === 'fail') { if (s.roll === 'risky' && !r.saved) m.flags.endNow = true; return; }
      if (t.down) { t.down = false; this.ui.log('result', `${t.label} is helped to their feet.`); } else if (t.blood) { t.blood--; this.ui.log('result', `${t.label} loses a blood marker.`); }
      this.ui.anim({ type: 'bless', m: t });
    } else if (s.effect === 'fade') {
      const r = await roll(`${m.label} tries to Fade into the terrain`); if (r.res === 'fail') { if (!r.saved) m.flags.endNow = true; return; }
      m.flags.faded = true; this.ui.log('result', `${m.label} vanishes into the mist: it cannot be shot or charged.`);
    } else if (s.effect === 'pushModel') {
      const { target, from } = arg; const r = await roll(`${m.label} uses ${a.name} on ${target.label}`); if (r.res === 'fail') { this.ui.log('result', `The ${a.name} fails and ${m.label}'s Activation ends.`); if (!r.saved) m.flags.endNow = true; return; }
      const dd = this.d6(); await this.ui.roll({ kind: 'plain', title: `${a.name} distance (D6")`, m, dice: [dd], kept: [0], sum: dd });
      this.ui.anim({ type: 'gaze', m, t: target, color: '#7fd1ff' });
      await this.push(target, from, dd, m, 'dragged');
    } else if (s.effect === 'teleport') {
      const r = await roll(`${m.label} opens a ${a.name}`); if (r.res === 'fail') { this.ui.log('result', 'The portal gutters out; the Activation ends.'); if (!r.saved) m.flags.endNow = true; return; }
      const { dest, take } = arg; this.ui.anim({ type: 'portal', p: { x: m.x, y: m.y } });
      const wasDown = m.down; m.x = dest.x; m.y = dest.y; this.ui.anim({ type: 'portal', p: dest }); this.ui.log('result', `${m.label} steps through the portal.`);
      if (take && !take.ooa && take.base <= 32) { const ang = Math.atan2(take.y - dest.y, take.x - dest.x); let placed = false; for (let k = 0; k < 12 && !placed; k++) { const aa = ang + k * Math.PI / 6; const p = { x: dest.x + Math.cos(aa) * (m.r + take.r + 0.4), y: dest.y + Math.sin(aa) * (m.r + take.r + 0.4) }; if (p.x > take.r && p.y > take.r && p.x < BOARD - take.r && p.y < BOARD - take.r && this.canEndAt(take, p) && !this.wallAt(p, take.r)) { take.x = p.x; take.y = p.y; placed = true; } } if (placed) this.ui.log('result', `${take.label} is dragged through with it!`); }
      if (wasDown) {} this.ui.update();
    } else if (s.effect === 'scripture') {
      const t = arg; const d = this.edgeDist(m, t); const mm = d <= 9 ? [{ v: 2, why: 'within 9"' }] : [{ v: 1, why: 'beyond 9"' }];
      this.ui.anim({ type: 'gaze', m, t, color: '#ffd36b' });
      const r = await this.successRoll(m, mm, `${m.label} reads Vengeful Scripture at ${t.label}`, { attack: true });
      if (r.res === 'fail') return; const b = t.blood;
      await this.injuryRoll(t, { injMod: b, injDice: r.res === 'crit' ? 1 : 0, armourMode: r.res === 'crit' ? 'ignore' : 'normal', attacker: m, why: [`+${b} per blood marker`], ranged: true, title: `Scripture injury on ${t.label}` });
    } else this.ui.log('rule', `${a.name}: not simulated.`);
    this.ui.update();
  }
  wallAt(p, r) { return this.losSegs.some(s => segDist(p, s.a, s.b) < r * 0.8) || this.terrain.landmarks.some(L => Math.hypot(L.x - p.x, L.y - p.y) < L.r + r); }
  async climb(m, up) {
    const R = this.terrain.ruins.find(R => R.hasUpper && inRect(m, R.upper)); if (!R) return false;
    if (up) { if (!m.flags.levitate) { const mods = this.hasEvil(m) ? [{ v: 1, why: 'Blasphemous Staff' }] : []; if (m.kitNames.includes('Mountaineer Kit')) mods.push({ v: 1, why: 'Mountaineer Kit' }); const r = await this.successRoll(m, mods, `${m.label} climbs to the upper floor`, { risky: true }); if (r.res === 'fail' && !r.saved) { m.flags.endNow = true; return false; } }
      m.h = 3; m.act.climbed = true; this.ui.log('action', `${m.label} takes the upper floor of the ruin.`); }
    else { m.h = 0; if (!m.flags.levitate) { this.ui.log('action', `${m.label} jumps down.`); await this.fall(m, 3, null); } }
    this.ui.update(); return true;
  }

  // ----- objectives / VP -----
  control(R) {
    const on = [0, 0], near = [0, 0];
    for (const m of this.alive()) { if (inRect(m, R)) on[m.side]++; if (inRect(m, R, m.r + 1)) near[m.side]++; }
    if (on[0] && !on[1]) return 0; if (on[1] && !on[0]) return 1;
    if (near[0] > near[1]) return 0; if (near[1] > near[0]) return 1; return -1;
  }
  async scoreTurn() {
    const c = this.terrain.objectives.map(R => this.control(R)); const add = [0, 0];
    c.forEach(s => { if (s >= 0) add[s] += 2; }); this.vp[0] += add[0]; this.vp[1] += add[1];
    this.ui.log('phase', `Objectives: ${this.sideName(0)} holds ${c.filter(x => x === 0).length}, ${this.sideName(1)} holds ${c.filter(x => x === 1).length}. VP ${this.vp[0]} - ${this.vp[1]}.`);
    this.ui.update();
  }
  // ----- morale -----
  async morale() {
    for (const s of [0, 1]) {
      const all = this.models.filter(m => m.side === s); const N = this.startCount[s]; const bad = all.filter(m => m.ooa || m.down).length;
      const need = Math.ceil(N / 2);
      if (bad < need && !this.shaken[s]) continue;
      const leader = all.find(m => !m.ooa && !m.down && (m.leader || m.kw.has('LEADER')));
      const mods = leader ? [{ v: 1, why: 'LEADER on the field' }] : [];
      const dummy = { label: this.sideName(s), side: s, down: false, blood: 0, bless: 0, abilities: [], flags: {}, kw: new Set() };
      const n = 2 + mods.length; const dice = []; for (let i = 0; i < n; i++) dice.push(this.d6()); const order = dice.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]); const kept = order.slice(0, 2).map(x => x[1]); const sum = kept.reduce((a, i) => a + dice[i], 0);
      const res = sum >= 7 ? 'success' : 'fail';
      await this.ui.roll({ kind: 'success', title: `Morale check: ${this.sideName(s)} (${bad}/${N} Down or Out of Action${this.shaken[s] ? ', Shaken' : ''})`, m: dummy, dice, kept, total: mods.length, mods, sum, res });
      if (res !== 'fail') { if (this.deeds['Hold Your Ground'] == null) this.deed(s, 'Hold Your Ground'); if (this.shaken[s]) { this.shaken[s] = false; this.ui.log('phase', `${this.sideName(s)} steadies and is no longer Shaken.`); } }
      else if (this.shaken[s]) { this.fled = s; this.ui.log('phase', `<b>${this.sideName(s)} flees the field!</b>`); return; }
      else { this.shaken[s] = true; this.ui.log('phase', `${this.sideName(s)} is <b>Shaken</b>: every Success Roll is now Risky.`); }
    }
  }

  // ----- deployment -----
  deploy() {
    const zones = [[0.6, 5.6], [30.4, 35.4]];
    const order = []; const lists = [0, 1].map(s => this.models.filter(m => m.side === s && !(this.allowInfiltrate && m.kw.has('INFILTRATOR'))).sort((a, b) => b.value - a.value));
    let s = lists[0].length >= lists[1].length ? 0 : 1; this.firstDeploySide = s;
    while (lists[0].length || lists[1].length) { if (lists[s].length) order.push(lists[s].shift()); else { s = 1 - s; continue; } s = lists[1 - s].length ? 1 - s : s; }
    for (const m of order) this.placeInZone(m, zones[m.side]);
    for (const m of this.models.filter(m => this.allowInfiltrate && m.kw.has('INFILTRATOR'))) this.placeInfiltrator(m);
  }
  placeInZone(m, zone) {
    let best = null, bs = -1e9;
    for (let k = 0; k < 140; k++) {
      const p = { x: zone[0] + m.r + this.rng() * (zone[1] - zone[0] - 2 * m.r), y: m.r + 0.5 + this.rng() * (BOARD - 2 * m.r - 1) };
      if (!this.canEndAt(m, p) || this.wallAt(p, m.r)) continue;
      let sc = 0; for (const o of this.models) if (o !== m && !o.ooa && o.x) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (o.side === m.side) sc -= Math.max(0, 2.2 - d) * 3; }
      if (this.coverSegs.some(s => segDist(p, s.a, s.b) < m.r + 0.6)) sc += 2;
      // spread toward objectives rows
      const rows = [6, 18, 30]; const ri = ((m.uid * 7) % 3); sc -= Math.abs(p.y - rows[ri]) * 0.25 * (m.role === 'melee' ? 1 : 0.5);
      if (m.role === 'artillery' || m.role === 'shooter') sc -= Math.abs(p.y - 18) * 0.05;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!best) best = { x: (zone[0] + zone[1]) / 2, y: 18 };
    m.x = best.x; m.y = best.y; m.h = 0;
  }
  placeInfiltrator(m) {
    let best = null, bs = -1e9; const foes = this.models.filter(o => o.side !== m.side && o.x);
    for (let k = 0; k < 400; k++) { const p = { x: 1 + this.rng() * 34, y: 1 + this.rng() * 34, r: m.r, h: 0 };
      if (!this.canEndAt(m, p) || this.wallAt(p, m.r)) continue; if (foes.some(f => Math.hypot(f.x - p.x, f.y - p.y) - f.r - m.r < 8)) continue; if (foes.some(f => this.los(f, Object.assign({}, m, p)).vis)) continue;
      const sc = -Math.min(...foes.map(f => Math.hypot(f.x - p.x, f.y - p.y))) + (this.coverSegs.some(s => segDist(p, s.a, s.b) < m.r + 0.6) ? 3 : 0); if (sc > bs) { bs = sc; best = p; } }
    if (best) { m.x = best.x; m.y = best.y; this.ui.log('action', `${m.label} infiltrates forward.`); } else this.placeInZone(m, m.side ? [30.4, 35.4] : [0.6, 5.6]);
  }

  // ----- turn loop -----
  async run() {
    this.ui.log('phase', `<b>Claim No Man's Land</b> - ${this.lists[0].name} vs ${this.lists[1].name}. Seed ${this.seed}.`);
    this.ui.log('rule', this.allowInfiltrate ? 'House rule: Infiltrators may use their special deployment.' : 'Scenario rule: Infiltrators deploy normally in their deployment zone.');
    this.deploy(); this.ui.update(); await this.ui.afterDeploy(this);
    for (this.turn = 1; this.turn <= this.maxTurns && !this.over; this.turn++) {
      for (const m of this.models) { m.activated = false; m.flags.meleeKillsTurn = 0; }
      const cnt = [0, 1].map(s => this.alive(s).filter(m => !m.down).length);
      let init; if (cnt[0] !== cnt[1]) init = cnt[0] < cnt[1] ? 0 : 1; else { init = this.d6() >= 4 ? 0 : 1; }
      this.initiative = init;
      this.ui.log('phase', `<b>Turn ${this.turn}</b> - ${this.sideName(init)} has the Initiative (${cnt[0] !== cnt[1] ? 'fewer models standing' : 'roll-off'}) and goes first.`);
      this.ui.turnBanner(this.turn);
      let side = init;
      for (;;) {
        const avail = s => this.alive(s).filter(m => !m.activated);
        if (!avail(0).length && !avail(1).length) break;
        if (!avail(side).length) side = 1 - side;
        const m = this.ctrl[side] === 'human' ? await this.ui.humanPick(this, side) : this.aiPick(side);
        if (!m) { side = 1 - side; continue; }
        m.activated = true; await this.activate(m);
        if (this.checkWipe()) break;
        side = 1 - side;
      }
      if (this.over) break;
      this.ui.log('phase', `Morale phase, end of turn ${this.turn}.`);
      await this.morale(); if (this.fled >= 0) { this.finish(1 - this.fled, 'the enemy fled'); break; }
      await this.scoreTurn();
    }
    if (!this.over) this.endGame();
  }
  checkWipe() { for (const s of [0, 1]) if (!this.alive(s).length) { this.finish(1 - s, 'no enemy models remain'); return true; } return false; }
  endGame() {
    for (const [name, s] of Object.entries(this.deeds)) this.vp[s] += 1;
    this.ui.log('phase', `Glorious Deeds scored: ${Object.entries(this.deeds).map(([n, s]) => n + ' (' + this.sideName(s) + ')').join(', ') || 'none'}.`);
    const w = this.vp[0] === this.vp[1] ? -1 : (this.vp[0] > this.vp[1] ? 0 : 1);
    this.finish(w, `${this.vp[0]} to ${this.vp[1]} Victory Points`);
  }
  finish(w, why) { if (this.over) return; this.over = true; this.winner = w; this.ui.log('phase', w < 0 ? `<b>Draw</b> - ${why}.` : `<b>${this.sideName(w)} wins</b> - ${why}.`); this.ui.gameOver(this, w, why); }

  async activate(m) {
    this.beginAct(m); this.ui.select(m);
    this.ui.log('activate', `<b>${m.label}</b> (${m.name}, ${this.sideName(m.side)}) activates.`);
    await this.regenerate(m);
    if (this.ctrl[m.side] === 'human') { await this.ui.humanActivation(this, m); }
    else await this.aiActivate(m);
    m.flags.frenzyNow = false; this.activeModel = null; this.ui.select(null); this.ui.update();
  }

  // ===================== AI =====================
  think(t) { this.ui.thought(t); }
  aiPick(side) {
    const avail = this.alive(side).filter(m => !m.activated); if (!avail.length) return null;
    // priority: models in melee or that can kill something; then artillery/shooters; then others
    let best = null, bs = -1e9;
    for (const m of avail) {
      let s = m.value * 0.01;
      const engaged = this.enemiesOf(m).some(e => this.edgeDist(e, m) <= 1); if (engaged) s += 6;
      if (m.down) s += 1;
      const shots = this.bestShot(m, null, { ignoreState: true }); if (shots) s += shots.v * 4;
      if (m.abilities.some(a => a.sim && a.sim.kind === 'aura')) s -= 1; // move aura models after others have advanced? keep near
      if (m.role === 'melee') { const t = this.chargeTargets(m)[0]; if (t) s += 2 + t.v; }
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }
  targetValue(t) { return (t.value || 40) / 60 + (t.elite ? 0.6 : 0) + (t.leader ? 0.4 : 0) + (this.terrain.objectives.some(R => inRect(t, R, t.r + 1)) ? 0.5 : 0); }
  shotValue(m, w, t, from) {
    const p = from || m; const d = Math.hypot(p.x - t.x, p.y - t.y) - m.r - t.r; if (d > w.ranged) return 0;
    const mm = Object.assign({}, m, { x: p.x, y: p.y, h: from ? (from.h || 0) : m.h });
    const L = this.los(mm, t); if (!L.vis) return 0;
    let mod = (m.ranged || 0) + (w.kw.dice || 0) + this.defence(t, 'ranged');
    const long = d > w.ranged / 2; if (long && !w.kw.ignore_long_range && !w.kw.shotgun) mod--; if (!w.kw.ignore_cover && this.inCoverFrom(t, mm)) mod--;
    if ((mm.h || 0) - (t.h || 0) >= 3 && !w.kw.ignore_elevated_position) mod++;
    mod += this.auraDice(m).v;
    const ps = w.kw.flamethrower ? { p: 1, crit: 0 } : pSuccess(mod);
    let arm = w.kw.ignore_armour ? 0 : Math.max(-3, t.armourChar + t.kitArmour + t.kitShield + (w.kw.armour_piercing ? 1 : 0));
    let inj = (w.kw.injDice || 0) + Math.min(t.blood, 3) + (w.kw.shotgun && long ? -1 : 0);
    const io = injuryOutcome(inj, (w.kw.injMod || 0) + arm, w.infernal);
    let per = ps.p * (io.ooa * 1.0 + io.down * 0.45 + io.minor * 0.12) + (w.kw.fire || w.kw.gas || w.kw.shrapnel ? ps.p * 0.1 : 0);
    const n = (w.kw.auto || 1) * (w.quickBursts ? 2 : 1); let v = per * n * this.targetValue(t);
    if (w.kw.blast) { for (const o of this.alive()) if (o !== t && Math.hypot(o.x - t.x, o.y - t.y) - o.r <= w.kw.blast) v += (o.side === m.side ? -1.2 : 0.6) * per * this.targetValue(o); }
    if (t.flags.faded) return 0;
    return v;
  }
  bestShot(m, from, opts = {}) {
    let best = null;
    for (const w of this.rangedWeapons(m)) {
      if (!opts.ignoreState && m.act && !this.canShootNow(m, w)) continue;
      if (opts.moved && this.heavyLocked(m, w)) continue;
      for (const t of this.enemiesOf(m)) { const v = this.shotValue(m, w, t, from); if (v > 0 && (!best || v > best.v)) best = { w, t, v }; }
    }
    return best;
  }
  meleeEV(m, t) { const ws = this.bestMelee(m, t); if (!ws.length) return 0; let v = 0; ws.forEach((w, i) => { const n = Math.max(1, w.kw.cleave || 0); let mod = (m.melee || 0) + (w.kw.dice || 0) + (i > 0 ? -1 : 0) + (this.frightens(m, t) ? -1 : 0) + this.auraDice(m).v + this.defence(t, 'melee'); const ps = pSuccess(mod); const arm = w.kw.ignore_armour ? 0 : Math.max(-3, t.armourChar + t.kitArmour + t.kitShield + (w.kw.armour_piercing ? 1 : 0)); const io = injuryOutcome((w.kw.injDice || 0) + (t.down ? 1 : 0) + Math.min(3, t.blood), (w.kw.injMod || 0) + arm, false); v += n * ps.p * (io.ooa + io.down * 0.45 + io.minor * 0.1); }); return v; }
  threatTo(m, p) { // expected danger at point p from enemies next turn
    let th = 0; const mm = Object.assign({}, m, { x: p.x, y: p.y });
    for (const e of this.enemiesOf(m)) { if (e.down && e.blood >= 3) continue; const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r - m.r;
      const mw = this.meleeWeapons(e); if (mw.length && d < e.move + 3.5) th += 0.35 * (1 + (e.melee || 0) * 0.3);
      for (const w of this.rangedWeapons(e)) if (d <= w.ranged + 3) { const L = this.los(e, mm); if (L.vis) th += 0.18 * (w.kw.auto || 1) * (this.inCoverFrom(mm, e) ? 0.55 : 1); break; } }
    return th;
  }
  chargeTargets(m) {
    if (!this.meleeWeapons(m).length) return [];
    const out = []; const reach = this.chargeReach(m) - 0.5;
    for (const t of this.enemiesOf(m)) { if (t.flags.faded) continue; const d = this.edgeDist(m, t); if (d > 12 || d > reach + 1) continue; if (!this.los(m, t).vis) continue; const heavy = m.weapons.some(w => w.kw.heavy) && !m.kw.has('STRONG'); const need = d * 1.12 + 0.3 - this.moveAllowance(m); const pr = need <= 0 ? 1 : heavy ? 0 : Math.max(0, Math.min(1, (7 - Math.ceil(need)) / 6)); if (pr < 0.34) continue; const v = this.meleeEV(m, t) * this.targetValue(t) * pr; out.push({ t, v, d, pr }); }
    return out.sort((a, b) => b.v - a.v);
  }
  objectivePull(m, p) { // value of standing at p for objectives
    let v = 0;
    for (const R of this.terrain.objectives) {
      const c = this.control(R); const dIn = inRect(p, R) ? 0 : Math.max(0, Math.min(Math.abs(p.x - (R.x + R.w / 2)) - R.w / 2, 99) + 0) + Math.max(0, Math.abs(p.y - (R.y + R.h / 2)) - R.h / 2);
      const near = inRect(p, R, m.r + 0.95);
      const mine = this.alive(m.side).filter(o => o !== m && inRect(o, R, o.r + 1)).length; const theirs = this.enemiesOf(m).filter(o => inRect(o, R, o.r + 1)).length;
      let w = c === m.side ? (mine > theirs + 1 ? 0.3 : 1.2) : (c < 0 ? 2.2 : 2.6);
      w *= (this.turn >= 2 ? 1.3 : 1) * (m.role === 'artillery' ? 0.35 : 1);
      if (near) v += w * (inRect(p, R) ? 1.15 : 1);
      else v += w * Math.max(0, 1 - dIn / 14) * 0.5;
    }
    return v;
  }
  coverAt(m, p) { return this.coverSegs.some(s => segDist(p, s.a, s.b) < m.r + 0.55) ? 1 : 0; }
  auraValue(m, p) {
    let v = 0; for (const a of m.abilities) { const s = a.sim || {}; if (s.kind === 'aura' && s.who === 'enemy') { for (const e of this.enemiesOf(m)) if (Math.hypot(e.x - p.x, e.y - p.y) - e.r - m.r <= s.range) v += 0.45 * this.targetValue(e); } }
    return v;
  }
  async aiActivate(m) {
    const T = (x) => this.think(x);
    if (m.down) { T(`${m.label} is Down: standing up first, at half movement.`); await this.standUp(m); }
    if (m.flags.endNow) return;
    // ---- abilities that are free value before acting ----
    await this.aiPreAbilities(m); if (m.flags.endNow || m.ooa) return;
    const engagedBy = this.enemiesOf(m).filter(e => this.edgeDist(e, m) <= 1);
    if (engagedBy.length) return this.aiEngaged(m, engagedBy);
    // elevated: stay and shoot if good
    if ((m.h || 0) >= 3) { const s = this.bestShot(m); if (s && s.v > 0.15) { T(`Holding the upper floor: clear shot at ${s.t.label} with ${s.w.name}.`); await this.aiShootLoop(m); return; } T('Nothing to shoot from up here; coming down.'); await this.climb(m, false); if (m.flags.endNow || m.ooa) return; }
    // charge?
    const ct = this.chargeTargets(m);
    const preShot = this.bestShot(m);
    if (ct.length && (m.role === 'melee' || ct[0].v > (preShot ? preShot.v : 0) * 1.3) && ct[0].v > 0.12) {
      const c = ct[0];
      if (preShot && preShot.w.kw.assault && this.canShootNow(m, preShot.w)) { const s2 = this.bestShot(m); T(`Softening ${s2.t.label} with an ASSAULT shot before charging.`); await this.doShoot(m, s2.w, s2.t); if (m.flags.endNow || m.ooa) return; }
      const tgt = c.t.ooa ? (this.chargeTargets(m)[0] || {}).t : c.t; if (!tgt) return this.aiAdvance(m);
      T(`Charging ${tgt.label}: ${c.d.toFixed(1)}" away, ${Math.round(c.pr * 100)}% to reach, expected value ${(c.v).toFixed(2)}. Melee beats shooting here.`);
      const ok = await this.doCharge(m, tgt); if (m.flags.endNow || m.ooa) return;
      if (ok) { await this.doFight(m, tgt); return; }
      if (!m.act.dashed && !m.flags.noDash) { /* charge failed - nothing else */ }
      return;
    }
    return this.aiAdvance(m);
  }
  async aiPreAbilities(m) {
    for (const a of this.abilityActions(m)) {
      const s = a.sim;
      if (s.effect === 'bloodMarkers') { const ts = this.enemiesOf(m).filter(t => this.edgeDist(m, t) <= s.range && (!s.los || this.los(m, t).vis) && t.blood < 6).sort((a, b) => this.targetValue(b) + b.blood * 0.1 - this.targetValue(a) - a.blood * 0.1); if (ts[0]) { this.think(`${a.name} on ${ts[0].label}: every blood marker makes it easier to kill.`); await this.doAbility(m, a, ts[0]); if (m.flags.endNow) return; } }
      else if (s.effect === 'blessFriendly') { const ts = this.friendsOf(m).filter(t => this.edgeDist(m, t) <= (s.range || 1)).sort((a, b) => b.value - a.value); if (ts[0]) { this.think(`${a.name} on ${ts[0].label}.`); await this.doAbility(m, a, ts[0]); if (m.flags.endNow) return; } }
      else if (s.effect === 'heal') { const ts = this.friendsOf(m).concat([m]).filter(t => this.edgeDist(m, t) <= (s.range || 1) && (t.down || t.blood >= 2)); if (ts[0]) { this.think(`Patching up ${ts[0].label}.`); await this.doAbility(m, a, ts[0]); if (m.flags.endNow) return; } }
      else if (s.effect === 'scripture') { const ts = this.enemiesOf(m).filter(t => this.edgeDist(m, t) <= 18 && this.los(m, t).vis && (t.blood >= 1 || this.edgeDist(m, t) <= 9)).sort((a, b) => (b.blood + this.targetValue(b)) - (a.blood + this.targetValue(a))); if (ts[0]) { this.think(`Vengeful Scripture at ${ts[0].label} (${ts[0].blood} blood markers to feed it).`); await this.doAbility(m, a, ts[0]); if (m.flags.endNow) return; } }
      else if (s.effect === 'teleport') { await this.aiPortal(m, a); if (m.flags.endNow) return; }
    }
    if (m.flags.medikit && !m.act.used.medikit) { const t = this.friendsOf(m).concat([m]).find(t => this.edgeDist(m, t) <= 1 && (t.down || t.blood >= 2) && t !== m || (t === m && m.blood >= 3)); if (t) { m.act.used.medikit = true; this.think(`Treating ${t.label} with the medi-kit.`); await this.doAbility(m, { name: 'Treat', sim: { kind: 'action', effect: 'heal', roll: 'risky', range: 1, bonusDice: m.name.includes('Cosmas') ? 2 : 0 } }, t); } }
  }
  async aiPortal(m, a) {
    const engaged = this.enemiesOf(m).filter(e => this.edgeDist(e, m) <= 1);
    // kidnap a small enemy standing on an objective toward our side; or jump onto a juicy target
    let plan = null;
    if (engaged.length) {
      const small = engaged.filter(e => e.base <= 32).sort((a, b) => this.targetValue(b) - this.targetValue(a))[0];
      if (small && (m.blood >= 3 || engaged.length >= 2 || this.terrain.objectives.some(R => inRect(small, R, 1)))) {
        const home = m.side === 0 ? -1 : 1; const dest = this.findDest(m, { x: m.x + home * 5.5, y: m.y }, 6, true);
        if (dest) plan = { dest, take: small, why: `kidnapping ${small.label} away from its friends` };
      }
    } else if (!m.act.moved) {
      const targets = this.enemiesOf(m).filter(t => this.edgeDist(m, t) <= 6.5 && this.edgeDist(m, t) > this.move * 0 && t.base <= 40).map(t => ({ t, v: this.meleeEV(m, t) * this.targetValue(t) })).sort((a, b) => b.v - a.v);
      const reachCharge = this.chargeTargets(m)[0];
      if (targets[0] && (!reachCharge || targets[0].v > reachCharge.v * 1.4) && targets[0].v > 0.3) { const t = targets[0].t; const dest = this.findDest(m, t, 6, true, t); if (dest) plan = { dest, take: null, why: `ripping through space onto ${t.label}` }; }
    }
    if (!plan) return;
    this.think(`Goetic Portal: ${plan.why}.`); await this.doAbility(m, a, plan);
  }
  findDest(m, toward, maxD, allowNearEnemy, adjTarget) {
    let best = null, bs = 1e9;
    for (let k = 0; k < 220; k++) { const ang = this.rng() * Math.PI * 2, rr = Math.sqrt(this.rng()) * maxD; const p = { x: m.x + Math.cos(ang) * rr, y: m.y + Math.sin(ang) * rr };
      if (p.x < m.r || p.y < m.r || p.x > BOARD - m.r || p.y > BOARD - m.r) continue; if (!this.canEndAt(m, p) || this.wallAt(p, m.r)) continue;
      if (adjTarget) { const d = Math.hypot(p.x - adjTarget.x, p.y - adjTarget.y) - m.r - adjTarget.r; if (d > 0.9 || d < 0.05) continue; }
      else if (!allowNearEnemy && this.enemiesOf(m).some(e => Math.hypot(e.x - p.x, e.y - p.y) - e.r - m.r <= 1)) continue;
      const sc = Math.hypot(p.x - toward.x, p.y - toward.y); if (sc < bs) { bs = sc; best = p; } }
    return best;
  }
  async aiEngaged(m, eng) {
    const T = (x) => this.think(x);
    const myEV = Math.max(...eng.map(e => this.meleeEV(m, e) * this.targetValue(e)));
    const theirEV = eng.reduce((a, e) => a + this.meleeEV(e, m), 0);
    const canRetreat = !eng.some(e => e.flags.barbed);
    const shooterish = m.role === 'shooter' || m.role === 'artillery' || !this.meleeWeapons(m).length;
    if (this.meleeWeapons(m).length && (!shooterish || myEV > 0.35 || !canRetreat) && myEV > 0.05) {
      const t = eng.map(e => ({ e, v: this.meleeEV(m, e) * this.targetValue(e) })).sort((a, b) => b.v - a.v)[0].e;
      T(`Locked in melee with ${eng.map(e => e.label).join(', ')}. Fighting ${t.label} (my expected damage ${myEV.toFixed(2)} vs theirs ${theirEV.toFixed(2)}).`);
      await this.doFight(m, t); if (m.flags.endNow || m.ooa) return;
      // after fighting, an assault weapon may still shoot if we're clear
      return;
    }
    if (canRetreat) {
      const dest = this.bestSpot(m, { maxMove: this.moveAllowance(m), retreat: true });
      if (dest) { T(`Pinned by ${eng.map(e => e.label).join(', ')} and outmatched in melee (${theirEV.toFixed(2)} vs ${myEV.toFixed(2)}): retreating, accepting a free strike.`); const ok = await this.doRetreat(m, dest.pts); if (!ok || m.flags.endNow || m.ooa) return; const s = this.bestShot(m); if (s && s.v > 0.05) { T(`Clear again: firing ${s.w.name} at ${s.t.label}.`); await this.aiShootLoop(m); } return; }
    }
    T(`No way out and no weapon worth swinging; ${m.label} braces.`);
  }
  // evaluate candidate destinations
  bestSpot(m, o = {}) {
    const maxMove = o.maxMove; const F = this.field(m, { limit: maxMove + 0.5, startEngaged: !!o.retreat, ignoreEnemyZone: false });
    let best = null; const shooter = this.rangedWeapons(m).length > 0;
    const cand = []; for (let i = 0; i < GN * GN; i += 1) { if (F.D[i] > maxMove || F.blocked[i]) continue; const gx = i % GN, gy = (i / GN) | 0; if ((gx + gy) % 2 && F.D[i] > 1) continue; cand.push(i); }
    for (const i of cand) {
      const p = this.cellPt(i); if (!this.canEndAt(m, p)) continue;
      if (o.retreat && this.enemiesOf(m).some(e => Math.hypot(e.x - p.x, e.y - p.y) - e.r - m.r <= 1.05)) continue;
      let v = this.objectivePull(m, p) * (o.objW || 1);
      if (shooter) { const s = this.bestShot(m, p, { ignoreState: true, moved: F.D[i] > 0.3 }); if (s) v += s.v * (o.shootW || 2.2); }
      if (m.role === 'melee') { // get close to valuable enemies for next turn charges
        let cv = 0; for (const e of this.enemiesOf(m)) { const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r - m.r; if (d < this.chargeReach(m) - 1.5) cv = Math.max(cv, 0.6 * this.targetValue(e)); else cv = Math.max(cv, 0.6 * this.targetValue(e) * Math.max(0, 1 - (d - 8) / 16)); } v += cv; }
      v += this.auraValue(m, p);
      v += this.coverAt(m, p) * 0.35;
      v -= this.threatTo(m, p) * (m.elite ? 0.55 : 0.4) * (o.retreat ? 1.5 : 1) * (m.role === 'artillery' ? 1.6 : 1);
      v -= F.D[i] * 0.004;
      if (this.danger[i]) v -= 0.6;
      if (!best || v > best.v) best = { v, i, p, F };
    }
    if (!best) return null; best.pts = this.pathTo(best.F, best.i); return best;
  }
  async aiShootLoop(m) {
    for (let k = 0; k < 4; k++) { if (m.flags.endNow || m.ooa) return; const s = this.bestShot(m); if (!s || s.v < 0.02) return; this.think(`Firing ${s.w.name} at ${s.t.label} (value ${s.v.toFixed(2)}${s.w.kw.blast ? ', blast' : ''}).`); await this.doShoot(m, s.w, s.t); }
  }
  async aiAdvance(m) {
    const T = (x) => this.think(x);
    const here = this.bestShot(m);
    const move = this.moveAllowance(m);
    const spot1 = this.bestSpot(m, { maxMove: move });
    const heavyGun = this.rangedWeapons(m).find(w => this.heavyLocked(m, w));
    // decide: shoot first then move, or move then shoot
    const valueHere = here ? here.v : 0; const valueThere = spot1 ? (this.bestShot(m, spot1.p, { ignoreState: true, moved: true }) || { v: 0 }).v : 0;
    // climbing option for long-range shooters
    const R = this.terrain.ruins.find(R => R.hasUpper && inRect(m, R.upper));
    if (R && m.role !== 'melee' && this.rangedWeapons(m).some(w => w.ranged >= 24) && !this.enemiesOf(m).some(e => this.edgeDist(e, m) < 8) && this.rng() < 0.7) {
      const up = Object.assign({}, m, { h: 3 }); const sUp = this.bestShot(m, up, { ignoreState: true }); if (sUp && sUp.v > valueHere * 1.2 + 0.05) { T(`Climbing the ruin for a commanding firing position (+1 DICE from elevation).`); const ok = await this.climb(m, true); if (!ok || m.flags.endNow) return; await this.aiShootLoop(m); return; }
    }
    if (heavyGun && here && here.w === heavyGun && valueHere > 0.12 && valueHere >= valueThere * 0.8) { T(`${heavyGun.name} is HEAVY: standing still to fire on ${here.t.label}.`); await this.aiShootLoop(m); return; }
    if (here && here.v > 0.08 && here.v >= valueThere * 0.85) {
      T(`Good shot from here at ${here.t.label}; firing before moving.`);
      const w = here.w; await this.doShoot(m, w, here.t); if (m.flags.endNow || m.ooa) return;
      if (w.quickBursts) { const s2 = this.bestShot(m); if (s2 && s2.w === w && s2.v > 0.05) { T('Second Quick Burst.'); await this.doShoot(m, w, s2.t); if (m.flags.endNow || m.ooa) return; } }
      if (!w.kw.heavy || m.kw.has('STRONG')) { const sp = this.bestSpot(m, { maxMove: move, shootW: 0.3 }); if (sp && sp.pts.length > 1 && sp.v > 0) { T(`Repositioning toward ${this.describeSpot(m, sp.p)}.`); await this.doMove(m, sp.pts); } }
      return;
    }
    if (spot1 && spot1.pts.length > 1) {
      T(`Moving toward ${this.describeSpot(m, spot1.p)}.`); const ok = await this.doMove(m, spot1.pts); if (!ok || m.flags.endNow || m.ooa) return;
    }
    // after move: charge if now possible and not yet shot
    if (!m.act.charged && m.role === 'melee') { /* cannot charge after Move action (only one of Move/Charge) */ }
    const s = this.bestShot(m); if (s && s.v > 0.04) { await this.aiShootLoop(m); if (m.flags.endNow || m.ooa) return; }
    // dash for more ground if nothing else to do and objective/cover far
    if (!m.act.dashed && !m.flags.noDash && !m.act.shots && !m.act.reload) {
      const dmove = m.flags.slowDash ? 3 : move; const sp2 = this.bestSpot(m, { maxMove: dmove, shootW: 0.6 });
      const cur = this.objectivePull(m, m) + this.coverAt(m, m) * 0.35 - this.threatTo(m, m) * 0.4 + (m.role === 'melee' ? 0.2 : 0);
      if (sp2 && sp2.v > cur + 0.25 && sp2.pts.length > 1) { const pr = pSuccess(m.factionDash + this.auraDice(m).v).p; T(`Dashing (${Math.round(pr * 100)}% to make the Risky roll) toward ${this.describeSpot(m, sp2.p)}.`); await this.doMove(m, sp2.pts, 'dash'); }
    }
  }
  describeSpot(m, p) {
    const R = this.terrain.objectives.find(R => inRect(p, R, m.r + 1)); if (R) return `the objective ruin at (${Math.round(R.x + R.w / 2)}", ${Math.round(R.y + R.h / 2)}")`;
    const e = this.enemiesOf(m).sort((a, b) => dist(a, p) - dist(b, p))[0];
    return (this.coverAt(m, p) ? 'cover ' : 'a position ') + (e ? `${Math.round(dist(e, p))}" from ${e.label}` : '');
  }
}
TC.Game = Game; TC.BOARD = BOARD; TC.inRect = inRect; TC.segDist = segDist; TC.dist = dist;
})();
