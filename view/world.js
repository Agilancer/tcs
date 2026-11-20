// Builds the 3D battlefield for a game: sculpted ground, ruins, trenches, wire, landmarks, sky, weather and light.
// Everything is generated from game.terrain and game.seed, so the same seed always gives the same table.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { B, HALF, wx, wz, clamp, lerp, smooth, rng, makeNoise, segDist, canvas, softTexture, mistTexture, noiseNormalMap, detailTexture, Parts } from './util.js';

const TEX = 2048, EXT = 54, PAD = (EXT - B) / 2;   // the ground texture covers the table plus 9" all round
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// One look per battlefield. Colours follow the Trench Crusade palette: mud, rust, bone and soot, with fire on the horizon.
export const BIOMES = {
  mud: { skyTop: 0x2a2c25, skyHor: 0xa3936a, glow: 0xffc47a, glowK: 0.7, band: 0x9a6a34, bandK: 0.3, fog: 0x6f6952, fogD: 0.0058,
    sun: 0xfff0d6, sunI: 4.4, sunDir: [-0.55, 0.6, 0.4], hemiSky: 0xa9a890, hemiGnd: 0x3a3024, hemiI: 1.35, rim: 0x8fb0b8, rimI: 0.9,
    gA: '#5a4c36', gB: '#352c20', fleck: ['0,0,0', '150,128,94'], floor: '#66605a', stone: 0x8c8c86, bag: 0x9c8860, wood: 0x57432e,
    water: { color: 0x1b2117, rough: 0.1, op: 0.9 }, wall: 'bag', weather: 'rain', trees: 14, tint: [1.02, 0.99, 0.92], sat: 0.86, rough: 0.2 },
  trench: { skyTop: 0x20262a, skyHor: 0x7d8880, glow: 0xe2ead8, glowK: 0.45, band: 0x566458, bandK: 0.25, fog: 0x606a62, fogD: 0.0072,
    sun: 0xe8efe8, sunI: 4.3, sunDir: [0.5, 0.66, 0.3], hemiSky: 0x9aa69c, hemiGnd: 0x2e2a24, hemiI: 1.45, rim: 0xc49a62, rimI: 0.75,
    gA: '#51473a', gB: '#302a23', fleck: ['0,0,0', '132,124,102'], floor: '#5a5852', stone: 0x93908a, bag: 0x8e7e5c, wood: 0x4f4030,
    water: { color: 0x151b18, rough: 0.08, op: 0.92 }, wall: 'bag', weather: 'rain', heavy: true, trees: 9, tint: [0.98, 1.0, 0.98], sat: 0.78, rough: 0.22 },
  city: { skyTop: 0x1c1a24, skyHor: 0xa86a40, glow: 0xffa457, glowK: 0.8, band: 0xc85a22, bandK: 0.55, fog: 0x6b5747, fogD: 0.0062,
    sun: 0xffd9b2, sunI: 4.8, sunDir: [0.6, 0.56, -0.35], hemiSky: 0x9c948c, hemiGnd: 0x302824, hemiI: 1.6, rim: 0x7f9cc4, rimI: 1.1,
    gA: '#5c5850', gB: '#383431', fleck: ['0,0,0', '150,144,132'], floor: '#6c675f', stone: 0x94918a, bag: 0x857a6c, wood: 0x4e4032,
    water: null, rubble: true, cobble: true, wall: 'block', weather: 'ember', trees: 3, tint: [1.03, 0.98, 0.93], sat: 0.86, rough: 0.1 },
  hell: { skyTop: 0x140506, skyHor: 0xb03410, glow: 0xff6a24, glowK: 1.0, band: 0xff5216, bandK: 0.85, fog: 0x5c1d0c, fogD: 0.0078,
    sun: 0xff9458, sunI: 4.6, sunDir: [-0.3, 0.58, -0.7], hemiSky: 0xb08068, hemiGnd: 0x2e1814, hemiI: 1.6, rim: 0x8266a8, rimI: 1.4,
    gA: '#5e4c46', gB: '#33282a', fleck: ['0,0,0', '128,84,66'], floor: '#4c423e', stone: 0x6f625c, bag: 0x453a37, wood: 0x322826,
    water: { color: 0x2a0505, rough: 0.14, op: 0.95, emissive: 0x5a0c04 }, ash: true, wall: 'block', wire: 'fissure', weather: 'ember', heavy: true, trees: 6, tint: [1.06, 0.94, 0.88], sat: 0.95, rough: 0.28 },
  desert: { skyTop: 0x414952, skyHor: 0xd8b475, glow: 0xfff0c4, glowK: 0.8, band: 0xd9a55c, bandK: 0.35, fog: 0xb59868, fogD: 0.0052,
    sun: 0xfff4d8, sunI: 4.0, sunDir: [0.35, 0.78, 0.35], hemiSky: 0xd8c498, hemiGnd: 0x6a5030, hemiI: 1.15, rim: 0x86a0c0, rimI: 0.6,
    gA: '#a88860', gB: '#785f40', fleck: ['70,50,25', '212,186,136'], floor: '#94805f', stone: 0xc2a67a, bag: 0xb69465, wood: 0x66502f,
    water: null, ripples: true, wall: 'block', weather: 'dust', trees: 2, tint: [1.04, 1.0, 0.9], sat: 0.88, rough: 0.34 },
  snow: { skyTop: 0x2c333b, skyHor: 0xa2aeb8, glow: 0xe6efff, glowK: 0.45, band: 0x808e9a, bandK: 0.25, fog: 0x919ca5, fogD: 0.0068,
    sun: 0xeef4ff, sunI: 3.6, sunDir: [-0.45, 0.55, 0.55], hemiSky: 0xc4d0dc, hemiGnd: 0x565a5e, hemiI: 1.25, rim: 0xffcf9a, rimI: 0.65,
    gA: '#c3cacc', gB: '#8d9598', fleck: ['40,44,48', '240,246,250'], floor: '#74736f', stone: 0x8b8884, bag: 0xa29a88, wood: 0x45392f,
    water: { color: 0xa9c4d2, rough: 0.16, op: 0.92 }, snow: true, wall: 'bag', weather: 'snow', trees: 18, tint: [0.95, 0.99, 1.05], sat: 0.74, rough: 0.2 },
};

// ---------------------------------------------------------------- height
function makeHeight(T, bm, N) {
  const flats = [...T.ruins, ...T.objectives.filter(o => o.marker)];
  return (bx, by) => {
    const ox = Math.max(0, -bx, bx - B), oy = Math.max(0, -by, by - B), out = Math.hypot(ox, oy);
    let h = (N.fbm(bx * 0.085, by * 0.085, 3) - 0.5) * bm.rough * 2 + (N.fbm(bx * 0.4 + 31, by * 0.4, 2) - 0.5) * 0.09;
    if (out > 0) h += smooth(0, 45, out) * (N.fbm(bx * 0.022 + 9, by * 0.022 + 3, 4) * 13 - 3.5) + smooth(3, 28, out) * 1.2;
    let flat = 0; for (const R of flats) { const d = Math.hypot(Math.max(R.x - bx, 0, bx - R.x - R.w), Math.max(R.y - by, 0, by - R.y - R.h)); if (d < 1.9) flat = Math.max(flat, 1 - smooth(0.25, 1.9, d)); }
    h = h * (1 - flat) + flat * 0.05;
    for (const c of T.craters) {
      const d = Math.hypot(bx - c.x, by - c.y) / c.r; if (d > 1.7) continue;
      if (bm.rubble) h += 0.4 * (1 - smooth(0.15, 1.05, d)) + (N.n2(bx * 2.2, by * 2.2) - 0.5) * 0.16 * (1 - smooth(0.6, 1.1, d));
      else h += -0.55 * Math.pow(Math.max(0, 1 - d * d), 1.4) + 0.13 * Math.exp(-Math.pow((d - 1.02) / 0.2, 2));
    }
    let tr = 0, lip = 0; for (const s of T.trenches) { const d = segDist(bx, by, s.a, s.b); if (d < s.wd / 2 + 0.9) { tr = Math.max(tr, 1 - smooth(s.wd / 2 - 0.2, s.wd / 2 + 0.3, d)); lip = Math.max(lip, Math.exp(-Math.pow((d - s.wd / 2 - 0.45) / 0.22, 2))); } }
    h += -0.72 * tr + 0.1 * lip * (1 - tr);
    return h;
  };
}

function groundGeometry(heightAt, N) {
  const inner = []; for (let c = -21; c <= 21.001; c += 0.3) inner.push(c);
  const outer = []; let s = 0.3, c = 21; while (c < 260) { s *= 1.32; c += s; outer.push(c); }
  const cs = [...outer.map(v => -v).reverse(), ...inner, ...outer], n = cs.length;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), col = new Float32Array(n * n * 3), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cs[i], z = cs[j], bx = x + HALF, by = z + HALF, k = j * n + i;
    pos[k * 3] = x; pos[k * 3 + 1] = heightAt(bx, by); pos[k * 3 + 2] = z;
    uv[k * 2] = (bx + PAD) / EXT; uv[k * 2 + 1] = 1 - (by + PAD) / EXT;
    const sh = lerp(1, 0.5 + 0.6 * N.fbm(bx * 0.03, by * 0.03, 3), smooth(22, 80, Math.hypot(x, z))); col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = sh;
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c2 = a + n, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- ground texture
function paintGround(x, T, bm, R, SIDE) {
  const S = TEX / EXT; x.setTransform(S, 0, 0, S, PAD * S, PAD * S);
  const all = () => -PAD + R() * EXT;
  const g = x.createRadialGradient(18, 18, 3, 18, 18, 36); g.addColorStop(0, bm.gA); g.addColorStop(1, bm.gB); x.fillStyle = g; x.fillRect(-PAD, -PAD, EXT, EXT);
  for (let i = 0; i < 130; i++) { const px = all(), py = all(), r = 1.5 + R() * 5.5, gg = x.createRadialGradient(px, py, 0, px, py, r); gg.addColorStop(0, `rgba(${bm.fleck[R() < 0.55 ? 0 : 1]},${0.08 + R() * 0.13})`); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
  if (bm.cobble) { // setts, laid in staggered rows
    for (let j = -4; j < 84; j++) for (let i = -3; i < 64; i++) { const px = i * 0.66 + (j % 2) * 0.33 + (R() - 0.5) * 0.05, py = j * 0.48; x.fillStyle = `rgba(${R() < 0.5 ? '18,16,15' : '150,142,128'},${0.05 + R() * 0.13})`; x.fillRect(px, py, 0.6, 0.42); x.strokeStyle = 'rgba(8,7,6,.35)'; x.lineWidth = 0.035; x.strokeRect(px, py, 0.6, 0.42); }
  }
  if (bm.snow) for (let i = 0; i < 70; i++) { const px = all(), py = all(), r = 0.8 + R() * 3, gg = x.createRadialGradient(px, py, 0, px, py, r); gg.addColorStop(0, `rgba(72,60,46,${0.25 + R() * 0.3})`); gg.addColorStop(1, 'rgba(72,60,46,0)'); x.fillStyle = gg; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
  if (bm.ripples) for (let i = 0; i < 170; i++) { x.strokeStyle = `rgba(${R() < 0.5 ? '235,210,160' : '70,50,25'},${0.05 + R() * 0.07})`; x.lineWidth = 0.05 + R() * 0.08; const px = all(), py = all(), L = 3 + R() * 7; x.beginPath(); x.moveTo(px, py); x.bezierCurveTo(px + L / 3, py + 0.5, px + L * 0.66, py - 0.5, px + L, py + (R() - 0.5)); x.stroke(); }
  for (let i = 0; i < 11000; i++) { x.fillStyle = `rgba(${bm.fleck[R() < 0.5 ? 0 : 1]},${R() * 0.14})`; const s = R() * 0.3 + 0.04; x.fillRect(all(), all(), s, s); }
  for (let i = 0; i < 90; i++) { x.strokeStyle = bm.ash ? `rgba(160,40,12,${0.1 + R() * 0.3})` : 'rgba(0,0,0,.2)'; x.lineWidth = 0.05 + R() * 0.05; x.beginPath(); let px = all(), py = all(); x.moveTo(px, py); for (let k = 0; k < 7; k++) { px += (R() - 0.5) * 3; py += (R() - 0.5) * 3; x.lineTo(px, py); } x.stroke(); }
  // deployment zones, the edge of the table and a faint 6" grid for judging distance
  T.zones.forEach((z, i) => { x.fillStyle = SIDE[i] + '15'; x.fillRect(z.x, z.y, z.w, z.h); x.setLineDash([0.4, 0.3]); x.strokeStyle = SIDE[i] + 'cc'; x.lineWidth = 0.11; x.strokeRect(z.x, z.y, z.w, z.h); x.setLineDash([]); });
  x.strokeStyle = bm.snow || bm.ripples ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.045)'; x.lineWidth = 0.04; for (let i = 6; i < B; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, B); x.moveTo(0, i); x.lineTo(B, i); x.stroke(); }
  x.strokeStyle = 'rgba(222,208,170,.4)'; x.lineWidth = 0.09; x.setLineDash([0.7, 0.35]); x.strokeRect(0, 0, B, B); x.setLineDash([]);
  // trenches: wet earth with duckboards down the middle
  for (const s of T.trenches) {
    x.lineCap = 'round'; x.strokeStyle = 'rgba(18,14,10,.75)'; x.lineWidth = s.wd + 0.5; x.beginPath(); x.moveTo(s.a.x, s.a.y); x.lineTo(s.b.x, s.b.y); x.stroke(); x.lineCap = 'butt';
    const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), ux = (s.b.x - s.a.x) / L, uy = (s.b.y - s.a.y) / L;
    for (let d = 0.2; d < L; d += 0.34) { const cx = s.a.x + ux * d, cy = s.a.y + uy * d, hw = s.wd * 0.3 + (R() - 0.5) * 0.08; x.strokeStyle = `rgb(${88 + R() * 30 | 0},${70 + R() * 22 | 0},${46 + R() * 16 | 0})`; x.lineWidth = 0.24; x.beginPath(); x.moveTo(cx - uy * hw, cy + ux * hw); x.lineTo(cx + uy * hw, cy - ux * hw); x.stroke(); }
  }
  // craters, rubble heaps
  for (const c of T.craters) {
    const gg = x.createRadialGradient(c.x, c.y, c.r * 0.1, c.x, c.y, c.r * 1.25);
    if (bm.rubble) { gg.addColorStop(0, 'rgba(150,142,128,.6)'); gg.addColorStop(0.7, 'rgba(90,84,76,.45)'); gg.addColorStop(1, 'rgba(60,56,50,0)'); }
    else { gg.addColorStop(0, 'rgba(10,8,6,.85)'); gg.addColorStop(0.62, 'rgba(26,20,14,.6)'); gg.addColorStop(0.82, bm.snow ? 'rgba(74,62,48,.6)' : 'rgba(120,104,80,.35)'); gg.addColorStop(1, 'rgba(60,50,38,0)'); }
    x.fillStyle = gg; x.beginPath(); x.arc(c.x, c.y, c.r * 1.25, 0, 7); x.fill();
    if (!bm.rubble) for (let i = 0; i < 16; i++) { const a = R() * 6.283, r0 = c.r * 0.95, r1 = c.r * (1.25 + R() * 0.7); x.strokeStyle = `rgba(0,0,0,${0.08 + R() * 0.12})`; x.lineWidth = 0.08 + R() * 0.1; x.beginPath(); x.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0); x.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1); x.stroke(); }
  }
  // flagstone floors of ruins
  for (const Rr of T.ruins) {
    x.fillStyle = bm.floor; x.fillRect(Rr.x - 0.15, Rr.y - 0.15, Rr.w + 0.3, Rr.h + 0.3);
    for (let j = Rr.y; j < Rr.y + Rr.h; j += 0.75) for (let i = Rr.x; i < Rr.x + Rr.w; i += 0.75) { x.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,245,225'},${R() * 0.1})`; x.fillRect(i, j, 0.75, 0.75); }
    x.strokeStyle = 'rgba(0,0,0,.32)'; x.lineWidth = 0.035; for (let i = Rr.x; i <= Rr.x + Rr.w + 0.01; i += 0.75) { x.beginPath(); x.moveTo(i, Rr.y); x.lineTo(i, Rr.y + Rr.h); x.stroke(); } for (let j = Rr.y; j <= Rr.y + Rr.h + 0.01; j += 0.75) { x.beginPath(); x.moveTo(Rr.x, j); x.lineTo(Rr.x + Rr.w, j); x.stroke(); }
    for (let i = 0; i < 30; i++) { x.fillStyle = `rgba(24,22,19,${0.25 + R() * 0.4})`; x.beginPath(); x.arc(Rr.x + R() * Rr.w, Rr.y + R() * Rr.h, 0.08 + R() * 0.22, 0, 7); x.fill(); }
    if (bm.snow) for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(225,232,236,.5)'; x.beginPath(); x.ellipse(Rr.x + R() * Rr.w, Rr.y + R() * Rr.h, 0.4 + R() * 0.8, 0.3 + R() * 0.4, R() * 3, 0, 7); x.fill(); }
  }
  // paved dais under a relic
  for (const o of T.objectives.filter(o => o.marker)) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2; x.fillStyle = bm.floor; x.beginPath(); x.arc(cx, cy, 1.9, 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 0.05;
    for (const r of [0.8, 1.35, 1.9]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); } for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; x.beginPath(); x.moveTo(cx + Math.cos(a) * 0.8, cy + Math.sin(a) * 0.8); x.lineTo(cx + Math.cos(a) * 1.9, cy + Math.sin(a) * 1.9); x.stroke(); }
  }
  for (const w of T.wire) { x.lineCap = 'round'; x.strokeStyle = bm.wire === 'fissure' ? 'rgba(8,3,2,.8)' : 'rgba(0,0,0,.28)'; x.lineWidth = w.wd * (bm.wire === 'fissure' ? 1.5 : 1.7); x.beginPath(); x.moveTo(w.a.x, w.a.y); x.lineTo(w.b.x, w.b.y); x.stroke(); x.lineCap = 'butt'; }
  for (const L of T.landmarks) { const gg = x.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 1.9); gg.addColorStop(0, 'rgba(6,5,4,.7)'); gg.addColorStop(1, 'rgba(6,5,4,0)'); x.fillStyle = gg; x.beginPath(); x.arc(L.x, L.y, L.r * 1.9, 0, 7); x.fill(); }
  for (const w of T.walls) { x.lineCap = 'round'; x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(w.a.x, w.a.y); x.lineTo(w.b.x, w.b.y); x.stroke(); x.lineCap = 'butt'; }
  // fade to one flat colour at the edge, so the clamped texture reads as plain ground beyond it
  x.setTransform(1, 0, 0, 1, 0, 0); const f = TEX * 0.07;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, f, 0, 0, 0, f, TEX], [TEX, 0, TEX - f, 0, TEX - f, 0, f, TEX], [0, 0, 0, f, 0, 0, TEX, f], [0, TEX, 0, TEX - f, 0, TEX - f, TEX, f]]) { const gg = x.createLinearGradient(x0, y0, x1, y1); gg.addColorStop(0, bm.gB); gg.addColorStop(1, bm.gB + '00'); x.fillStyle = gg; x.fillRect(rx, ry, rw, rh); }
  x.setTransform(S, 0, 0, S, PAD * S, PAD * S);
}

function stoneTexture(R) {
  const [c, x] = canvas(256); x.fillStyle = '#48433c'; x.fillRect(0, 0, 256, 256);   // mortar shows between the blocks
  const rows = 6, rh = 256 / rows;
  for (let j = 0; j < rows; j++) { const n = 3 + (j % 2), w = 256 / n, off = (j % 2) * w / 2; for (let i = -1; i <= n; i++) { const v = 150 + R() * 78 | 0; x.fillStyle = `rgb(${v},${v - 4},${v - 12})`; x.fillRect(i * w + off + 2.5, j * rh + 2.5, w - 5, rh - 5); } }
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${R() < 0.6 ? '20,18,14' : '255,250,240'},${R() * 0.16})`; const s = 1 + R() * 3; x.fillRect(R() * 256, R() * 256, s, s); }
  for (let i = 0; i < 9; i++) { const px = R() * 256, w = 14 + R() * 30, g = x.createLinearGradient(px, 0, px + w, 0); g.addColorStop(0, 'rgba(15,13,10,0)'); g.addColorStop(0.5, 'rgba(15,13,10,.2)'); g.addColorStop(1, 'rgba(15,13,10,0)'); x.fillStyle = g; x.fillRect(px, 0, w, 256); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.4, 0.4); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function plankTexture(R) {
  const [c, x] = canvas(256); x.fillStyle = '#b3a288'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) { const v = 140 + R() * 80 | 0; x.fillStyle = `rgb(${v},${v - 14},${v - 34})`; x.fillRect(i * 32 + 1, 0, 30, 256); for (let k = 0; k < 14; k++) { x.strokeStyle = `rgba(30,20,10,${R() * 0.25})`; x.beginPath(); const px = i * 32 + R() * 32; x.moveTo(px, 0); x.lineTo(px + (R() - 0.5) * 6, 256); x.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- pieces
// A box whose texture coordinates are in inches, so masonry stays the same size on any piece.
function inchBox(w, h, d) { const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d), uv.getY(i) * h); return g; }
// A slab of broken wall: jagged along the top, with a lancet window if it is tall enough.
function wallPanel(L, hL, hR, R, win) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(L, hR);
  const n = Math.max(2, Math.round(L / 0.35)), minTop = win ? 2.8 : 1.2;
  for (let i = n - 1; i >= 1; i--) { const t = i / n; let h = lerp(hL, hR, t) + (R() - 0.5) * 0.5; if (R() < 0.2) h -= 0.4 + R() * 0.7; s.lineTo(L * t + (R() - 0.5) * 0.08, Math.max(minTop, h)); }
  s.lineTo(0, hL); s.lineTo(0, 0);
  if (win) { const c = L / 2, w = Math.min(0.62, L * 0.4), p = new THREE.Path(); p.moveTo(c - w / 2, 0.95); p.lineTo(c + w / 2, 0.95); p.lineTo(c + w / 2, 1.65); p.quadraticCurveTo(c + w / 2, 2.1, c, 2.45); p.quadraticCurveTo(c - w / 2, 2.1, c - w / 2, 1.65); p.lineTo(c - w / 2, 0.95); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: false, curveSegments: 5 }); g.translate(0, 0, -0.17); return g;
}

function deadTree(P, R, key, h) {
  const branch = (a, dir, len, rad, depth) => {
    const b = a.clone().addScaledVector(dir, len); P.stick(key, a, b, rad, rad * 0.62, depth > 1 ? 6 : 4); if (!depth) return;
    const kids = 2 + (R() < 0.4 ? 1 : 0);
    for (let i = 0; i < kids; i++) { const d = dir.clone().add(V3((R() - 0.5) * 1.5, 0.25 + R() * 0.5, (R() - 0.5) * 1.5)).normalize(); branch(a.clone().addScaledVector(dir, len * (0.55 + R() * 0.45)), d, len * (0.5 + R() * 0.25), rad * 0.55, depth - 1); }
  };
  branch(V3(0, -0.2, 0), V3((R() - 0.5) * 0.25, 1, (R() - 0.5) * 0.25).normalize(), h * 0.5, h * 0.045, 3);
}

const LANDMARKS = {
  tank(P, R) {
    P.add('rust', new THREE.BoxGeometry(1.9, 0.5, 1.15), [0, 0.6, 0]).add('rust', new THREE.BoxGeometry(1.6, 0.3, 0.9), [0.05, 0.28, 0]);
    for (const s of [-1, 1]) { P.add('iron', new THREE.BoxGeometry(2.15, 0.46, 0.3), [0, 0.3, s * 0.6]); for (let i = 0; i < 5; i++) P.add('rust', new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), [-0.8 + i * 0.4, 0.26, s * 0.77], [Math.PI / 2, 0, 0]); }
    P.add('rust', new THREE.CylinderGeometry(0.4, 0.47, 0.36, 8), [-0.12, 1.0, 0]).add('iron', new THREE.CylinderGeometry(0.06, 0.075, 1.2, 6), [0.6, 0.98, 0.04], [0, 0, -Math.PI / 2 - 0.22]);
    P.add('iron', new THREE.CylinderGeometry(0.15, 0.15, 0.04, 8), [-0.2, 1.3, 0.02], [0.9, 0, 0.3]).add('iron', new THREE.BoxGeometry(0.5, 0.12, 0.7), [-0.85, 0.9, 0]);
    return { size: 1.2, tilt: 0.09, smoke: [-0.12, 1.3, 0] };
  },
  statue(P, R) {
    P.add('stone', new THREE.CylinderGeometry(0.7, 0.8, 0.55, 8), [0, 0.27, 0]).add('stone', new THREE.CylinderGeometry(0.48, 0.55, 0.5, 8), [0, 0.8, 0]);
    P.add('stone', new THREE.CylinderGeometry(0.17, 0.4, 1.55, 8), [0, 1.82, 0]).add('stone', new THREE.CylinderGeometry(0.2, 0.17, 0.42, 8), [0, 2.75, 0]);
    const whole = R() < 0.55; if (whole) { P.add('stone', new THREE.SphereGeometry(0.16, 8, 6), [0, 3.1, 0]); P.add('gold', new THREE.TorusGeometry(0.25, 0.025, 5, 18), [0, 3.12, -0.1]); }
    for (const s of [-1, 1]) if (whole || s < 0) P.add('stone', new THREE.BoxGeometry(0.07, 1.25, 0.5), [s * 0.36, 2.55, -0.16], [0, s * 0.35, s * -0.42]);
    P.add('stone', new THREE.BoxGeometry(0.08, 0.6, 0.08), [0.26, 2.85, 0.1], [0.3, 0, -0.5]).add('iron', new THREE.BoxGeometry(0.05, 1.2, 0.02), [0.48, 3.5, 0.2], [0.3, 0, -0.2]);
    P.add('stone', new THREE.BoxGeometry(0.5, 0.25, 0.4), [0.75, 0.12, 0.5], [0.2, 0.7, 0.3]);
    return { size: 0.86 };
  },
  spike(P, R) {
    const n = 3 + (R() * 3 | 0); for (let i = 0; i < n; i++) { const a = R() * 6.283, d = i ? 0.25 + R() * 0.35 : 0, h = i ? 1.4 + R() * 1.8 : 2.8 + R() * 1.6; P.add('basalt', new THREE.ConeGeometry(0.24 + R() * 0.22, h, 5), [Math.cos(a) * d, h / 2 - 0.1, Math.sin(a) * d], [Math.sin(a) * d * 0.5, R() * 3, -Math.cos(a) * d * 0.5]); }
    for (let i = 0; i < 4; i++) { const a = R() * 6.283, d = 0.3 + R() * 0.4; P.add('glow', new THREE.ConeGeometry(0.07, 0.45 + R() * 0.3, 4), [Math.cos(a) * d, 0.18, Math.sin(a) * d], [(R() - 0.5), 0, (R() - 0.5)]); }
    return { size: 0.9, fire: [0, 0.5, 0], light: [0xff4a12, 26] };
  },
  obelisk(P, R) {
    P.add('stone', new THREE.BoxGeometry(1.1, 0.3, 1.1), [0, 0.15, 0]).add('stone', new THREE.CylinderGeometry(0.24, 0.42, 3.0, 4), [0, 1.8, 0], [0, Math.PI / 4, 0]);
    if (R() < 0.6) P.add('brass', new THREE.ConeGeometry(0.33, 0.5, 4), [0, 3.55, 0], [0, Math.PI / 4, 0]); else P.add('stone', new THREE.BoxGeometry(0.45, 0.4, 1.3), [0.75, 0.2, 0.3], [0.1, 0.5, 0]);
    return { size: 0.82, tilt: 0.05 };
  },
  tree(P, R) { deadTree(P, R, 'bark', 5.5); P.add('bark', new THREE.ConeGeometry(0.42, 0.5, 6), [0, 0.2, 0]); return { size: 0.5 }; },
  relic(P, R) {
    P.add('stone', new THREE.CylinderGeometry(0.55, 0.62, 0.18, 10), [0, 0.09, 0]).add('stone', new THREE.CylinderGeometry(0.4, 0.45, 0.2, 10), [0, 0.28, 0]);
    P.add('iron', new THREE.BoxGeometry(0.11, 2.7, 0.11), [0, 1.7, 0]).add('iron', new THREE.BoxGeometry(1.15, 0.11, 0.11), [0, 2.35, 0]).add('iron', new THREE.TorusGeometry(0.36, 0.035, 5, 18), [0, 2.35, 0]);
    P.add('gold', new THREE.BoxGeometry(0.34, 0.22, 0.22), [0, 0.5, 0.2]).add('gold', new THREE.ConeGeometry(0.2, 0.14, 4), [0, 0.68, 0.2], [0, Math.PI / 4, 0]);
    for (const [cx, cz] of [[-0.3, 0.28], [0.3, 0.28], [-0.36, -0.1], [0.36, -0.1]]) { P.add('bone', new THREE.CylinderGeometry(0.025, 0.03, 0.2, 5), [cx, 0.48, cz]); P.add('flame', new THREE.SphereGeometry(0.035, 5, 4), [cx, 0.61, cz]); }
    return { size: 0.62, light: [0xffc070, 22], fixed: true };
  },
};

const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = `
uniform vec3 top, hor, glow, band, sunDir; uniform float glowK, bandK, time; varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y; float s = max(dot(d, normalize(sunDir)), 0.0);
  vec3 c = mix(hor, top, smoothstep(-0.02, 0.55, h));
  c += glow * (pow(s, 5.0) * 0.5 + pow(s, 48.0) * 1.3) * glowK;
  c += band * exp(-abs(h) * 9.0) * bandK;
  vec2 q = d.xz / (abs(h) + 0.22) * 1.25 + vec2(time * 0.011, time * 0.004);
  float cl = smoothstep(0.42, 0.78, fbm(q));
  float cl2 = smoothstep(0.35, 0.9, fbm(q * 2.3 + 7.0));
  vec3 cc = mix(top * 0.3, hor * 0.62 + glow * 0.35 * pow(s, 3.0), 0.25 + 0.5 * (1.0 - smoothstep(0.0, 0.5, h)));   // smoke-dark cloud, lit from below near the horizon
  c = mix(c, cc, clamp(cl * 0.85 + cl2 * 0.25, 0.0, 1.0) * smoothstep(-0.05, 0.1, h));
  if (h < 0.0) c = mix(c, hor * 0.45, smoothstep(0.0, -0.25, h));
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------- build
export function buildWorld(game, renderer, SIDE) {
  const T = game.terrain, bm = BIOMES[T.field] || BIOMES.mud, R = rng((game.seed ^ 0x51ed27) >>> 0), N = makeNoise(game.seed);
  const group = new THREE.Group(); const heightAt = makeHeight(T, bm, N);
  const world = { group, biome: bm, T, heightAt, emitters: [], flickers: [], objMarks: [], time: 0 };
  { const c = new THREE.Color(bm.gA).lerp(new THREE.Color(0xffffff), 0.25); world.dustCol = [c.r * 2.2, c.g * 2.2, c.b * 2.2]; }   // kicked-up dust takes the colour of the ground
  const merge = list => mergeGeometries(list, false);
  const C = hex => new THREE.Color(hex);

  // ---- sky, fog, light
  const sunDir = V3(...bm.sunDir).normalize(); world.sunDir = sunDir;
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: { top: { value: C(bm.skyTop) }, hor: { value: C(bm.skyHor) }, glow: { value: C(bm.glow) }, band: { value: C(bm.band) }, sunDir: { value: sunDir }, glowK: { value: bm.glowK }, bandK: { value: bm.bandK }, time: { value: 0 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 18), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; group.add(sky); world.sky = sky;
  { const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(new THREE.Mesh(sky.geometry, skyMat)); world.env = pm.fromScene(es, 0.02, 1, 2000).texture; pm.dispose(); }
  world.fog = new THREE.FogExp2(bm.fog, bm.fogD);
  const hemi = new THREE.HemisphereLight(bm.hemiSky, bm.hemiGnd, bm.hemiI); group.add(hemi);
  const sun = new THREE.DirectionalLight(bm.sun, bm.sunI); sun.position.copy(sunDir).multiplyScalar(70); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 5, far: 170 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; group.add(sun, sun.target); world.sun = sun;
  const rim = new THREE.DirectionalLight(bm.rim, bm.rimI); rim.position.set(-sunDir.x * 40, 22, -sunDir.z * 40); group.add(rim);

  // ---- ground
  const [gc, gx] = canvas(TEX); paintGround(gx, T, bm, R, SIDE);
  const gtex = new THREE.CanvasTexture(gc); gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const gnorm = noiseNormalMap(game.seed, 256, bm.ripples ? 1.4 : 2.4); gnorm.repeat.set(16, 16);
  const ground = new THREE.Mesh(groundGeometry(heightAt, N), new THREE.MeshStandardMaterial({ map: gtex, normalMap: gnorm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: bm.snow ? 0.8 : 0.93, metalness: 0, vertexColors: true, envMapIntensity: 0.35 }));
  const detail = detailTexture(game.seed);
  ground.material.onBeforeCompile = sh => { // fine grain on top of the painted map
    sh.uniforms.detailMap = { value: detail };
    const NL = String.fromCharCode(10);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_pars_fragment>', '#include <map_pars_fragment>' + NL + 'uniform sampler2D detailMap;')
      .replace('#include <map_fragment>', '#include <map_fragment>' + NL + 'diffuseColor.rgb *= 0.62 + 0.76 * texture2D(detailMap, vMapUv * 21.0).r;');
  };
  ground.receiveShadow = true; group.add(ground); world.extraTextures = [detail];
  let dirty = false, lastUp = 0;
  world.scorch = (bx, by, r, gas) => { const g = gx.createRadialGradient(bx, by, 0, bx, by, r); g.addColorStop(0, gas ? 'rgba(70,90,30,.6)' : 'rgba(8,6,5,.8)'); g.addColorStop(0.6, gas ? 'rgba(70,90,30,.3)' : 'rgba(12,9,7,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); gx.fillStyle = g; gx.beginPath(); gx.arc(bx, by, r, 0, 7); gx.fill(); dirty = true; };
  world.blood = (bx, by, r) => { for (let i = 0; i < 10; i++) { gx.fillStyle = `rgba(${96 + Math.random() * 40 | 0},6,10,${0.55 + Math.random() * 0.3})`; gx.beginPath(); gx.arc(bx + (Math.random() - 0.5) * r * 1.5, by + (Math.random() - 0.5) * r * 1.5, (Math.random() * 0.5 + 0.2) * r * 0.62, 0, 7); gx.fill(); } dirty = true; };

  // ---- materials for scenery
  const stoneTex = stoneTexture(R), plankTex = plankTexture(R);
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, flatShading: true }, o));
  const M = {
    stone: std({ map: stoneTex, color: bm.stone }), wood: std({ map: plankTex, color: bm.wood }), bark: std({ color: bm.snow ? 0x2b2622 : 0x241d17, roughness: 1 }),
    iron: std({ color: 0x2b2725, roughness: 0.55, metalness: 0.75 }), rust: std({ color: 0x5c4130, roughness: 0.78, metalness: 0.4 }), basalt: std({ color: 0x241c1b, roughness: 0.6, metalness: 0.2 }),
    brass: std({ color: 0xb08a3c, roughness: 0.4, metalness: 0.85 }), gold: std({ color: 0xe0aa45, roughness: 0.32, metalness: 0.9, emissive: 0xff9a22, emissiveIntensity: 0.55 }), bone: std({ color: 0xd9cdb2 }),
    wire: std({ color: 0x3d3632, roughness: 0.5, metalness: 0.8, flatShading: false }), far: std({ color: C(bm.fog).multiplyScalar(0.28), roughness: 1 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 1.05, 0.2), toneMapped: false }), flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 0.8), toneMapped: false }),
  };
  const P = new Parts(), hash = (a, b) => N.hash(a, b);
  const bags = [], chunks = [];   // instanced: sandbags / blocks, and loose rubble

  // ---- ruins
  for (const Rr of T.ruins) {
    const corner = p => (Math.abs(p.x - Rr.x) < 0.01 || Math.abs(p.x - Rr.x - Rr.w) < 0.01) && (Math.abs(p.y - Rr.y) < 0.01 || Math.abs(p.y - Rr.y - Rr.h) < 0.01);
    const endH = p => { const k = hash(Math.round(p.x * 20), Math.round(p.y * 20)); return corner(p) ? 3.6 + k * 1.6 : 2.2 + k * 1.6; };
    const pillars = new Map();
    for (const s of Rr.segs) {
      const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x), hL = endH(s.a), hR = endH(s.b);
      P.add('stone', wallPanel(L, hL, hR, R, Math.min(hL, hR) > 2.9 && L > 1.3 && R() < 0.7), [wx(s.a.x), -0.1, wz(s.a.y)], [0, -ang, 0]);
      for (const p of [s.a, s.b]) if (corner(p)) pillars.set(Math.round(p.x * 10) + ':' + Math.round(p.y * 10), p);
      for (let i = 0; i < 3; i++) { const t = R(), o = (R() - 0.5) * 1.3; chunks.push([lerp(s.a.x, s.b.x, t) - Math.sin(ang) * o, lerp(s.a.y, s.b.y, t) + Math.cos(ang) * o, 0.07 + R() * 0.2]); }
    }
    for (const p of pillars.values()) { const h = endH(p) + 0.35; P.add('stone', inchBox(0.52, h, 0.52), [wx(p.x), h / 2 - 0.1, wz(p.y)]); if (R() < 0.6) P.add('stone', new THREE.ConeGeometry(0.42, 0.7, 4), [wx(p.x), h + 0.22, wz(p.y)], [0, Math.PI / 4, 0]); }
    if (Rr.vp >= 4 && pillars.size) { // the chapel keeps its bell tower
      const p = [...pillars.values()][0], tx = wx(p.x), tz = wz(p.y);
      P.add('stone', inchBox(1.15, 7.2, 1.15), [tx, 3.5, tz]).add('stone', new THREE.ConeGeometry(1.0, 2.2, 4), [tx, 8.2, tz], [0, Math.PI / 4, 0]);
      P.add('iron', new THREE.BoxGeometry(0.09, 1.3, 0.09), [tx, 9.8, tz]).add('iron', new THREE.BoxGeometry(0.6, 0.09, 0.09), [tx, 10.05, tz]);
    }
    if (Rr.hasUpper) {
      const U = Rr.upper, ux = wx(U.x + U.w / 2), uz = wz(U.y + U.h / 2);
      P.add('wood', new THREE.BoxGeometry(U.w, 0.16, U.h), [ux, 2.92, uz]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add('wood', new THREE.BoxGeometry(0.2, 2.95, 0.2), [ux + sx * (U.w / 2 - 0.12), 1.4, uz + sz * (U.h / 2 - 0.12)]);
      const alongX = U.w > U.h; for (let i = 1; i < 4; i++) P.add('wood', new THREE.BoxGeometry(alongX ? 0.14 : U.w, 0.14, alongX ? U.h : 0.14), alongX ? [ux - U.w / 2 + U.w * i / 4, 2.78, uz] : [ux, 2.78, uz - U.h / 2 + U.h * i / 4]);
      // ladder against the open edge
      const openX = U.w < Rr.w * 0.6, lx = openX ? wx(U.x + U.w) : ux, lz = openX ? uz : wz(U.y + U.h), lean = 0.3, rot = openX ? [0, 0, lean] : [-lean, 0, 0];
      const off = (d, v) => openX ? [lx + 0.48 - v * Math.sin(lean), 1.5 + v * Math.cos(lean), lz + d] : [lx + d, 1.5 + v * Math.cos(lean), lz + 0.48 - v * Math.sin(lean)];
      for (const d of [-0.22, 0.22]) P.add('wood', new THREE.BoxGeometry(0.06, 3.3, 0.06), off(d, 0), rot);
      for (let i = 0; i < 8; i++) P.add('wood', new THREE.BoxGeometry(openX ? 0.05 : 0.44, 0.05, openX ? 0.44 : 0.05), off(0, -1.4 + i * 0.4), rot);
    }
  }

  // ---- low walls: sandbags or stone blocks, three courses high
  for (const w of T.walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x), n = Math.max(3, Math.round(L / 0.62));
    for (let row = 0; row < 3; row++) for (let i = 0; i < n - row; i++) {
      if (row === 2 && R() < 0.35) continue; const t = (i + 0.5 + row * 0.5) / n, bx = lerp(w.a.x, w.b.x, t), by = lerp(w.a.y, w.b.y, t);
      bags.push([bx + (R() - 0.5) * 0.06, by + (R() - 0.5) * 0.06, 0.15 + row * 0.27, ang + (R() - 0.5) * 0.25, L / n, 0.85 + R() * 0.3]);
    }
  }

  // ---- wire, or burning fissures in hell
  for (const w of T.wire) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ux = (w.b.x - w.a.x) / L, uy = (w.b.y - w.a.y) / L;
    if (bm.wire === 'fissure') {
      const n = Math.ceil(L / 0.3), pos = [], idx = [];
      for (let i = 0; i <= n; i++) { const t = i / n, j = (R() - 0.5) * 0.36, bx = w.a.x + ux * L * t - uy * j, by = w.a.y + uy * L * t + ux * j, hw = 0.05 + Math.sin(t * Math.PI) * (0.1 + R() * 0.12), y = heightAt(bx, by) + 0.05; pos.push(wx(bx - uy * hw), y, wz(by + ux * hw), wx(bx + uy * hw), y, wz(by - ux * hw)); if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); const m = new THREE.Mesh(g, M.glow.clone()); m.material.side = THREE.DoubleSide; group.add(m);
      const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2, lt = new THREE.PointLight(0xff4a12, 18, 9, 2); lt.position.set(wx(mx), heightAt(mx, my) + 0.6, wz(my)); group.add(lt); world.flickers.push({ light: lt, base: 18, ph: R() * 9, mat: m.material });
      for (let i = 0; i < 3; i++) { const t = (i + 0.5) / 3, bx = lerp(w.a.x, w.b.x, t), by = lerp(w.a.y, w.b.y, t); world.emitters.push({ kind: 'ember', pos: V3(wx(bx), heightAt(bx, by) + 0.1, wz(by)), rate: 5 }); }
      continue;
    }
    const posts = Math.max(2, Math.round(L / 1.3));
    for (let i = 0; i <= posts; i++) { const t = i / posts, bx = lerp(w.a.x, w.b.x, t), by = lerp(w.a.y, w.b.y, t), y = heightAt(bx, by); P.stick('bark', V3(wx(bx), y - 0.15, wz(by)), V3(wx(bx) + (R() - 0.5) * 0.25, y + 0.95 + R() * 0.2, wz(by) + (R() - 0.5) * 0.25), 0.045, 0.035, 5); }
    for (const ph of [0, 2.4]) {
      const turns = L / 0.42, n = Math.ceil(turns * 9), pts = [];
      for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * 6.283 + ph, o = Math.cos(a) * 0.3, bx = w.a.x + ux * L * t - uy * o, by = w.a.y + uy * L * t + ux * o; pts.push(V3(wx(bx), heightAt(bx, by) + 0.38 + Math.sin(a) * 0.3, wz(by))); }
      P.addM('wire', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.014, 3, false), new THREE.Matrix4());
    }
  }

  // ---- craters: standing water, ice, tar; or loose rubble on a heap
  for (const c of T.craters) {
    if (bm.rubble) { for (let i = 0; i < 34; i++) { const a = R() * 6.283, d = Math.sqrt(R()) * c.r; chunks.push([c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 0.1 + R() * 0.26]); } continue; }
    for (let i = 0; i < 8; i++) { const a = R() * 6.283, d = c.r * (0.9 + R() * 0.5); chunks.push([c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, 0.05 + R() * 0.1]); }
    if (!bm.water) continue;
    const wm = new THREE.MeshStandardMaterial({ color: bm.water.color, roughness: bm.water.rough, metalness: 0.15, transparent: true, opacity: bm.water.op, envMapIntensity: 1.6 }); if (bm.water.emissive) { wm.emissive = C(bm.water.emissive); wm.emissiveIntensity = 0.35; }
    const pool = new THREE.Mesh(new THREE.CircleGeometry(c.r * 0.66, 28), wm); pool.rotation.x = -Math.PI / 2; pool.position.set(wx(c.x), heightAt(c.x, c.y) + 0.2, wz(c.y)); pool.receiveShadow = true; group.add(pool);
  }

  // ---- landmarks
  for (const L of T.landmarks) {
    const make = LANDMARKS[L.kind] || LANDMARKS.statue, lp = new Parts(), info = make(lp, R), sc = L.r / info.size, y = heightAt(L.x, L.y) - 0.05, yaw = info.fixed ? 0 : R() * 6.283;
    P.addParts(lp, [wx(L.x), y, wz(L.y)], yaw, sc);
    const at = (v) => V3(wx(L.x) + (v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw)) * sc, y + v[1] * sc, wz(L.y) + (-v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)) * sc);
    if (info.smoke) world.emitters.push({ kind: 'smoke', pos: at(info.smoke), rate: 5 });
    if (info.fire) world.emitters.push({ kind: 'ember', pos: at(info.fire), rate: 6 });
    if (info.light) { const lt = new THREE.PointLight(info.light[0], info.light[1], 10, 2); lt.position.copy(at([0, 1.2, 0.3])); group.add(lt); world.flickers.push({ light: lt, base: info.light[1], ph: R() * 9 }); }
  }

  // ---- scatter: pebbles on the table; dead trees, grave markers and far silhouettes around it
  for (let i = 0; i < 150; i++) chunks.push([R() * B, R() * B, 0.03 + R() * 0.07]);
  const ring = (r0, r1) => { for (;;) { const a = R() * 6.283, d = r0 + R() * (r1 - r0), x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) > 19.5 || Math.abs(z) > 19.5) return [x, z]; } };
  for (let i = 0; i < bm.trees; i++) { const [x, z] = ring(20, 62), tp = new Parts(); deadTree(tp, R, 'bark', 4.5 + R() * 5); P.addParts(tp, [x, heightAt(x + HALF, z + HALF), z], R() * 6.283, 1); }
  for (let i = 0; i < 34; i++) { const [x, z] = ring(19.6, 34), y = heightAt(x + HALF, z + HALF), tl = (R() - 0.5) * 0.3, yaw = R() * 6.283; P.add('bark', new THREE.BoxGeometry(0.07, 1.0, 0.07), [x, y + 0.42, z], [tl, yaw, tl]).add('bark', new THREE.BoxGeometry(0.46, 0.07, 0.07), [x, y + 0.68, z], [tl, yaw, tl]); }
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 18.4 : -18.4, sz = i & 2 ? 18.4 : -18.4; P.add('bark', new THREE.BoxGeometry(0.1, 1.5, 0.1), [sx, heightAt(sx + HALF, sz + HALF) + 0.6, sz], [0.05, 0, -0.06]); }
  const farN = T.field === 'city' ? 26 : T.field === 'desert' ? 5 : 11;
  for (let i = 0; i < farN; i++) {
    const [x, z] = ring(T.field === 'city' ? 30 : 48, T.field === 'city' ? 95 : 130), y = heightAt(x + HALF, z + HALF) - 1, L = 5 + R() * 11, h = 9 + R() * 20;
    if (T.field === 'hell') P.add('far', new THREE.ConeGeometry(2 + R() * 4, h * 1.6, 5), [x, y + h * 0.7, z], [(R() - 0.5) * 0.3, R() * 3, (R() - 0.5) * 0.3]);
    else { const g = wallPanel(L, h * (0.6 + R() * 0.4), h, R, false); g.scale(1, 1, 6 + R() * 10); P.add('far', g, [x, y, z], [0, R() * 6.283, 0]); }
  }
  if (T.field === 'desert') { P.add('far', new THREE.BoxGeometry(520, 46, 12), [0, 16, -175]); for (let i = -4; i <= 4; i++) P.add('far', new THREE.BoxGeometry(16, 64, 16), [i * 58 + 10, 24, -172]); }
  if (T.field === 'hell') { // the Gate: two black horns and the wound between them
    P.add('far', new THREE.ConeGeometry(16, 130, 5), [-20, 50, -190], [0, 0, -0.1]).add('far', new THREE.ConeGeometry(16, 130, 5), [20, 50, -190], [0, 0, 0.1]);
    const rift = new THREE.Mesh(new THREE.PlaneGeometry(9, 70), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.3, 0.25), toneMapped: false, fog: false })); rift.position.set(0, 30, -188); group.add(rift);
  }

  const scenery = P.build(M, merge); group.add(scenery);

  // ---- instanced sandbags and rubble
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  if (bags.length) {
    const block = bm.wall === 'block', geo = block ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(0.5, 8, 6);
    const im = new THREE.InstancedMesh(geo, std({ color: bm.bag, roughness: 0.95, flatShading: block }), bags.length); im.castShadow = im.receiveShadow = true;
    bags.forEach(([bx, by, y, ang, len, v], i) => { dummy.position.set(wx(bx), heightAt(bx, by) + y, wz(by)); dummy.rotation.set(0, -ang, 0); dummy.scale.set(len * (block ? 0.94 : 1.12), block ? 0.26 : 0.34, block ? 0.42 : 0.5); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, tint.setScalar(v)); });
    im.instanceColor.needsUpdate = true; group.add(im);
  }
  {
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), std({ color: C(bm.stone).multiplyScalar(0.62), map: null }), chunks.length); im.castShadow = im.receiveShadow = true;
    chunks.forEach(([bx, by, s], i) => { dummy.position.set(wx(bx), heightAt(bx, by) + s * 0.35, wz(by)); dummy.rotation.set(R() * 6, R() * 6, R() * 6); dummy.scale.set(s * (0.7 + R() * 0.7), s * (0.5 + R() * 0.5), s * (0.7 + R() * 0.7)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, tint.setScalar(0.7 + R() * 0.5)); });
    im.instanceColor.needsUpdate = true; group.add(im);
  }

  // ---- objective markers: a dashed boundary on the ground, and a beacon that takes the colour of whoever holds it
  for (const o of T.objectives) {
    const pts = [], x0 = o.x - 1, y0 = o.y - 1, w = o.w + 2, h = o.h + 2, per = 2 * (w + h), n = Math.ceil(per / 0.4);
    for (let i = 0; i <= n; i++) { let d = i / n * per, bx, by; if (d < w) { bx = x0 + d; by = y0; } else if (d < w + h) { bx = x0 + w; by = y0 + d - w; } else if (d < 2 * w + h) { bx = x0 + w - (d - w - h); by = y0 + h; } else { bx = x0; by = y0 + h - (d - 2 * w - h); } pts.push(V3(wx(bx), Math.max(heightAt(bx, by), 0) + 0.09, wz(by))); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xd8d0bc, dashSize: 0.45, gapSize: 0.3, transparent: true, opacity: 0.75, toneMapped: false })); line.computeLineDistances(); group.add(line);
    const cx = wx(o.x + o.w / 2), cz = wz(o.y + o.h / 2), top = o.marker ? 4.3 : 6.4;
    const gemMat = new THREE.MeshBasicMaterial({ color: 0xd8d0bc, toneMapped: false }); const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3 + (o.vp || 2) * 0.05, 0), gemMat); gem.position.set(cx, top, cz); group.add(gem);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xd8d0bc, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.16, top, 8, 1, true), beamMat); beam.position.set(cx, top / 2, cz); group.add(beam);
    world.objMarks.push({ o, line, gem, beam, col: new THREE.Color(0xd8d0bc) });
  }

  // ---- ground mist
  const mistTex = mistTexture(game.seed), mist = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mistTex, color: C(bm.fog).lerp(C(0xffffff), 0.35), transparent: true, opacity: 0.025 + R() * 0.04, depthWrite: false }));
    const s = 22 + R() * 26; m.scale.set(s, s, 1); m.rotation.x = -Math.PI / 2; m.rotation.z = R() * 6.283; m.position.set((R() - 0.5) * 80, 0.5 + R() * 2.2, (R() - 0.5) * 80); m.renderOrder = 5; mist.push({ m, v: 0.25 + R() * 0.5 }); group.add(m);
  }

  // ---- weather
  const wind = V3(0.8, 0, 0.35); let weather = null;
  if (bm.weather === 'rain') {
    const n = bm.heavy ? 1100 : 600, pos = new Float32Array(n * 6), seed = new Float32Array(n * 3); for (let i = 0; i < n; i++) { seed[i * 3] = (R() - 0.5) * 70; seed[i * 3 + 1] = R() * 26; seed[i * 3 + 2] = (R() - 0.5) * 70; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb9c4c8, transparent: true, opacity: bm.heavy ? 0.2 : 0.13, depthWrite: false })); lines.frustumCulled = false; group.add(lines);
    weather = dt => { for (let i = 0; i < n; i++) { let y = seed[i * 3 + 1] - dt * 42; if (y < -0.5) { y += 26; seed[i * 3] = (Math.random() - 0.5) * 70; seed[i * 3 + 2] = (Math.random() - 0.5) * 70; } seed[i * 3 + 1] = y; const x = seed[i * 3] , z = seed[i * 3 + 2]; pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x + 0.22; pos[i * 6 + 4] = y + 1.25; pos[i * 6 + 5] = z + 0.1; } g.attributes.position.needsUpdate = true; };
  } else {
    const cfg = { ember: { n: bm.heavy ? 420 : 200, size: 0.2, col: new THREE.Color(3.0, 1.0, 0.25), add: true, vy: [0.5, 1.9], sway: 1.2, op: 0.95 }, snow: { n: 900, size: 0.16, col: new THREE.Color(1, 1, 1), add: false, vy: [-2.2, -1.1], sway: 0.9, op: 0.8 }, dust: { n: 320, size: 0.3, col: C(0xd9bd8a), add: false, vy: [-0.1, 0.2], sway: 0.5, op: 0.22, blow: 5 } }[bm.weather];
    const n = cfg.n, pos = new Float32Array(n * 3), vel = new Float32Array(n * 2); for (let i = 0; i < n; i++) { pos[i * 3] = (R() - 0.5) * 70; pos[i * 3 + 1] = R() * 22; pos[i * 3 + 2] = (R() - 0.5) * 70; vel[i * 2] = lerp(cfg.vy[0], cfg.vy[1], R()); vel[i * 2 + 1] = R() * 6.283; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: softTexture(), color: cfg.col, size: cfg.size, sizeAttenuation: true, transparent: true, opacity: cfg.op, depthWrite: false, blending: cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !cfg.add })); pts.frustumCulled = false; group.add(pts);
    weather = (dt, t) => { for (let i = 0; i < n; i++) { const ph = vel[i * 2 + 1]; pos[i * 3] += (Math.sin(t * 0.7 + ph) * cfg.sway + wind.x * (cfg.blow || 1)) * dt; pos[i * 3 + 2] += (Math.cos(t * 0.5 + ph) * cfg.sway + wind.z * (cfg.blow || 1)) * dt; let y = pos[i * 3 + 1] + vel[i * 2] * dt; if (y > 22) y = 0; else if (y < -0.3) y = 22; pos[i * 3 + 1] = y; if (pos[i * 3] > 35) pos[i * 3] -= 70; if (pos[i * 3 + 2] > 35) pos[i * 3 + 2] -= 70; } g.attributes.position.needsUpdate = true; };
  }

  // ---- per frame
  const white = new THREE.Color(0xd8d0bc);
  world.update = (dt, t, now, camera, fx) => {
    world.time = t; skyMat.uniforms.time.value = t; sky.position.copy(camera.position);
    if (dirty && now - lastUp > 180) { gtex.needsUpdate = true; dirty = false; lastUp = now; }
    for (const { m, v } of mist) { m.position.x += wind.x * v * dt; m.position.z += wind.z * v * dt; if (m.position.x > 46) m.position.x -= 92; if (m.position.z > 46) m.position.z -= 92; }
    if (weather) weather(Math.min(dt, 0.05), t);
    for (const f of world.flickers) { const k = 0.75 + 0.25 * Math.sin(t * 9 + f.ph) * Math.sin(t * 23 + f.ph * 2) + 0.12 * Math.sin(t * 3.1 + f.ph); f.light.intensity = f.base * k; if (f.mat) f.mat.color.setRGB(3.4 * k, 1.05 * k, 0.2 * k); }
    for (const e of world.emitters) {
      e.acc = (e.acc || 0) + e.rate * dt; while (e.acc > 1) { e.acc -= 1;
        if (e.kind === 'smoke') fx.spawn({ p: e.pos, v: [wind.x * 0.5 + (Math.random() - 0.5) * 0.2, 0.9 + Math.random() * 0.5, wind.z * 0.5 + (Math.random() - 0.5) * 0.2], life: 3.2 + Math.random() * 1.5, size: [0.35, 2.4], col: [0.05, 0.045, 0.04], a: 0.42 });
        else fx.spawn({ add: true, p: [e.pos.x + (Math.random() - 0.5) * 0.5, e.pos.y, e.pos.z + (Math.random() - 0.5) * 0.5], v: [(Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5], life: 0.8 + Math.random() * 1.2, size: [0.16, 0.03], col: [3.2, 1.0 + Math.random() * 0.8, 0.2], a: 1 });
      }
    }
    for (const k of world.objMarks) {
      const ctl = game.control(k.o); k.col.lerp(ctl < 0 ? white : tint.set(SIDE[ctl]), 0.08); const pul = 0.75 + 0.25 * Math.sin(t * 2.4 + k.o.x);
      k.line.material.color.copy(k.col); k.gem.material.color.copy(k.col).multiplyScalar(ctl < 0 ? 1.1 : 2.2 * pul); k.beam.material.color.copy(k.col); k.beam.material.opacity = ctl < 0 ? 0.035 : 0.1 * pul;
      k.gem.rotation.y = t * 0.9; k.gem.position.y = (k.o.marker ? 4.3 : 6.4) + Math.sin(t * 1.3 + k.o.y) * 0.12;
    }
  };
  world.dispose = () => { group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) for (const m of [].concat(o.material)) { for (const k of ['map', 'normalMap']) if (m[k] && m[k] !== softTexture()) m[k].dispose(); m.dispose(); } }); if (world.env) world.env.dispose(); for (const t of world.extraTextures) t.dispose(); };
  return world;
}
