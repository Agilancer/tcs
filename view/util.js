// Shared helpers for the 3D view: seeded random, noise, board <-> world mapping, small canvas textures.
import * as THREE from 'three';

export const B = 36, HALF = 18;            // the table is 36" square; world units are inches, centred on the origin
export const wx = bx => bx - HALF, wz = by => by - HALF;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Value noise. With a period, the lattice wraps so the result tiles.
export function makeNoise(seed) {
  const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 1442695041) | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
  const n2 = (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const w = period ? (v => ((v % period) + period) % period) : (v => v);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(w(xi), w(yi)), b = hash(w(xi + 1), w(yi)), c = hash(w(xi), w(yi + 1)), d = hash(w(xi + 1), w(yi + 1));
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, oct = 4, period = 0) => { let s = 0, amp = 0.5, f = 1, tot = 0; for (let i = 0; i < oct; i++) { s += n2(x * f, y * f, period ? period * f : 0) * amp; tot += amp; amp *= 0.5; f *= 2; } return s / tot; };
  return { n2, fbm, hash };
}

export function segDist(px, py, a, b) { const dx = b.x - a.x, dy = b.y - a.y; const l = dx * dx + dy * dy; let t = l ? ((px - a.x) * dx + (py - a.y) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)); }

export function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

// Soft round sprite: white centre fading to nothing. Used for glows, blob shadows and mist.
let _soft = null;
export function softTexture() {
  if (_soft) return _soft; const [c, x] = canvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); _soft = new THREE.CanvasTexture(c); _soft.colorSpace = THREE.SRGBColorSpace; return _soft;
}

// Blotchy alpha texture for ground mist.
export function mistTexture(seed) {
  const [c, x] = canvas(256); const N = makeNoise(seed); const img = x.createImageData(256, 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const n = N.fbm(i / 48, j / 48, 4, 256 / 48 | 0 || 5); const d = Math.hypot(i - 128, j - 128) / 128; const a = clamp((n - 0.38) * 2.4, 0, 1) * smooth(1, 0.35, d);
    const k = (j * 256 + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Tiling normal map from fractal noise, for fine ground relief.
export function noiseNormalMap(seed, size = 256, strength = 2.2) {
  const N = makeNoise(seed); const P = 8; const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = N.fbm(i / size * P, j / size * P, 5, P);
  const [c, x] = canvas(size); const img = x.createImageData(size, size); const at = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * strength * 8, dy = (at(i, j + 1) - at(i, j - 1)) * strength * 8; const l = Math.hypot(dx, dy, 1);
    const k = (j * size + i) * 4; img.data[k] = (-dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// Tiling greyscale grain. Multiplied over the ground texture so the mud keeps its texture when the camera is close.
export function detailTexture(seed, size = 256) {
  const N = makeNoise(seed + 77), P = 16, [c, x] = canvas(size), img = x.createImageData(size, size); let s = seed >>> 0; const R = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const v = clamp(0.5 + (N.fbm(i / size * P, j / size * P, 4, P) - 0.5) * 1.5 + (R() - 0.5) * 0.22, 0, 1) * 255, k = (j * size + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

// Collects primitive geometries by material key, baked into place, and merges each bucket into one mesh.
export class Parts {
  constructor() { this.b = {}; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); }
  add(key, geom, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone(); if (typeof scale === 'number') scale = [scale, scale, scale];
    this._m.compose(new THREE.Vector3(...pos), this._q.setFromEuler(this._e.set(rot[0], rot[1], rot[2])), new THREE.Vector3(...scale)); g.applyMatrix4(this._m);
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    (this.b[key] = this.b[key] || []).push(g); return this;
  }
  // same, placed by a matrix (for parts that point along an arbitrary direction)
  addM(key, geom, m4) { const g = geom.index ? geom.toNonIndexed() : geom.clone(); g.applyMatrix4(m4); for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n); (this.b[key] = this.b[key] || []).push(g); return this; }
  // a cylinder running from point a to point b
  stick(key, a, b, r0, r1 = r0, seg = 5) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length(); if (L < 1e-4) return this;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return this.addM(key, new THREE.CylinderGeometry(r1, r0, L, seg), new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
  // every part of another Parts, moved as a block
  addParts(other, pos = [0, 0, 0], rotY = 0, scale = 1) {
    this._m.compose(new THREE.Vector3(...pos), this._q.setFromEuler(this._e.set(0, rotY, 0)), new THREE.Vector3(scale, scale, scale));
    for (const k of Object.keys(other.b)) for (const g of other.b[k]) { const c = g.clone(); c.applyMatrix4(this._m); (this.b[k] = this.b[k] || []).push(c); }
    return this;
  }
  build(mats, merge, opts = {}) {
    const group = new THREE.Group();
    for (const k of Object.keys(this.b)) {
      if (!this.b[k].length || !mats[k]) continue; const g = merge(this.b[k]); if (!g) continue;
      const mesh = new THREE.Mesh(g, mats[k]); mesh.castShadow = opts.cast !== false; mesh.receiveShadow = opts.receive !== false; group.add(mesh);
    }
    return group;
  }
}
