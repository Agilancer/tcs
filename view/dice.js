// 3D dice. They are thrown onto the table beside the model that is rolling, tumble, bounce and settle on the rolled faces.
// They are drawn in their own pass on top of the battlefield and sized in screen pixels, so a wall or a far camera never hides a result.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvas, softTexture, clamp } from './util.js';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_VAL = [3, 4, 1, 6, 2, 5];   // box faces in material order: +x -x +y -y +z -z (opposite faces add up to 7)
const NORMAL = { 3: [1, 0, 0], 4: [-1, 0, 0], 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1] };
const STYLE = { succ: ['#fffaf0', '#eadfc8', '#c9b998', '#1d1410'], inj: ['#ff8a80', '#b3121e', '#6e0911', '#fff1e0'], plain: ['#f0f0f0', '#a2aab0', '#636b71', '#15181a'] };
const UP = new THREE.Vector3(0, 1, 0);

function faceTexture(kind, v) {
  const [c, x] = canvas(128), s = STYLE[kind], g = x.createRadialGradient(42, 36, 6, 64, 64, 96); g.addColorStop(0, s[0]); g.addColorStop(0.6, s[1]); g.addColorStop(1, s[2]); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (const i of PIPS[v]) { const px = 30 + (i % 3) * 34, py = 30 + (i / 3 | 0) * 34; x.fillStyle = s[3]; x.beginPath(); x.arc(px, py, 11, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.arc(px - 3, py - 3, 4, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Dice {
  constructor(view) {
    this.view = view; this.scene = new THREE.Scene(); this.throws = [];
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.42)); this.key = new THREE.DirectionalLight(0xfff0dc, 1.15); this.scene.add(this.key, this.key.target);
    this.geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.13); this.quad = new THREE.PlaneGeometry(1, 1); this.quad.rotateX(-Math.PI / 2);
    this.mats = {}; for (const k of Object.keys(STYLE)) this.mats[k] = FACE_VAL.map(v => new THREE.MeshStandardMaterial({ map: faceTexture(k, v), roughness: 0.34, metalness: 0.05, envMapIntensity: 0.25 }));
  }
  // o: the engine's roll (dice, kept, m). Returns where the dice land on screen, plus mark() and fade().
  throw(o, kind) {
    const V = this.view, cam = V.camera, [w, h] = V.size(), n = o.dice.length, sizePx = clamp(h * 0.058, 28, 46);
    const m = o.m && o.m.x != null ? o.m : null, at = m ? V.minis.anchor(m, 0) : V.controls.target.clone(); let [cx, cy] = V.project(at);
    cx += (cx > w / 2 ? -1 : 1) * sizePx * 2.4; cy += (cy > h / 2 ? -1 : 1) * sizePx * 1.7;
    cx = clamp(cx, sizePx * (n / 2 + 1), w - sizePx * (n / 2 + 1)); cy = clamp(cy, sizePx * 2.6, h - sizePx * 2.6);
    const y0 = m ? at.y : 0, ray = V.rayAt(cx, cy), C = new THREE.Vector3();
    if (ray.direction.y < -0.05) C.copy(ray.origin).addScaledVector(ray.direction, (y0 - ray.origin.y) / ray.direction.y); else C.copy(at);
    const size = sizePx * 2 * cam.position.distanceTo(C) * Math.tan(cam.fov * Math.PI / 360) / h;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize(), fwd = new THREE.Vector3().crossVectors(UP, right), fromLeft = Math.random() < 0.5;
    const group = new THREE.Group(); this.scene.add(group); const dice = [];
    o.dice.forEach((v, i) => {
      const mats = this.mats[kind].map(mt => mt.clone()), mesh = new THREE.Mesh(this.geo, mats); mesh.scale.setScalar(size);
      const end = C.clone().addScaledVector(right, ((i - (n - 1) / 2) * 1.3 + (Math.random() - 0.5) * 0.25) * size).addScaledVector(fwd, (Math.random() - 0.5) * 0.5 * size); end.y = y0 + size / 2;
      const start = end.clone().addScaledVector(right, (fromLeft ? -1 : 1) * size * (10 + Math.random() * 4)).addScaledVector(fwd, (Math.random() - 0.5) * size * 7); start.y += size * 5;
      const qEnd = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * 6.283).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...NORMAL[v]), UP));
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), spins = (2 + Math.random() * 2) * 6.283;
      const shadow = new THREE.Mesh(this.quad, new THREE.MeshBasicMaterial({ map: softTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false })); shadow.scale.setScalar(size * 2.1); shadow.renderOrder = -1;
      const glow = new THREE.Mesh(this.quad, new THREE.MeshBasicMaterial({ map: softTexture(), color: new THREE.Color(1.0, 0.72, 0.2), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(size * 3.1); glow.renderOrder = -1;
      group.add(shadow, glow, mesh); dice.push({ mesh, mats, start, end, qEnd, axis, spins, shadow, glow, y0, size, shadowOp: 0.5 });
    });
    this.key.position.copy(C).add(new THREE.Vector3(-4, 9, 5).applyQuaternion(cam.quaternion)); this.key.target.position.copy(C);
    const th = { group, dice, t0: performance.now(), fadeT: 0 }; this.throws.push(th);
    return { x: cx, y: cy, size: sizePx, pos: () => V.project(C),
      mark: kept => dice.forEach((d, i) => { if (kept.includes(i)) { d.glow.material.opacity = 0.9; d.mats.forEach(mt => { mt.emissive.set(0xffa81e); mt.emissiveIntensity = 0.1; }); } else { d.mats.forEach(mt => { mt.transparent = true; mt.opacity = 0.32; }); d.shadowOp = 0.15; } }),
      fade: () => { th.fadeT = performance.now(); } };
  }
  update(now) {
    const sp = this.view.UI.speed;
    this.throws = this.throws.filter(th => {
      const k = clamp((now - th.t0) * sp / 900, 0, 1), e = 1 - Math.pow(1 - k, 3); let f = 1;
      if (th.fadeT) { f = 1 - (now - th.fadeT) / 350; if (f <= 0) { this.scene.remove(th.group); for (const d of th.dice) { d.mats.forEach(m => m.dispose()); d.shadow.material.dispose(); d.glow.material.dispose(); } return false; } }
      for (const d of th.dice) {
        d.mesh.position.lerpVectors(d.start, d.end, e); const hop = d.size * 2.4 * (1 - k) * (1 - k) * Math.abs(Math.sin(k * Math.PI * 2.5)); d.mesh.position.y += hop;
        d.mesh.quaternion.copy(d.qEnd).multiply(_q.setFromAxisAngle(d.axis, (1 - e) * d.spins)); d.mesh.scale.setScalar(d.size * f);
        const lift = (d.mesh.position.y - d.y0 - d.size / 2) / (d.size * 6); d.shadow.position.set(d.mesh.position.x, d.y0 + 0.01, d.mesh.position.z); d.shadow.scale.setScalar(d.size * (2.1 + lift * 2) * f); d.shadow.material.opacity = d.shadowOp * clamp(1 - lift, 0, 1) * f;
        d.glow.position.copy(d.shadow.position); d.glow.scale.setScalar(d.size * 3.1 * f);
      }
      return true;
    });
  }
  clear() { for (const th of this.throws) this.scene.remove(th.group); this.throws = []; }
}
const _q = new THREE.Quaternion();
