// Effects: a particle system, short-lived beams / rings / lights, and one routine per engine animation
// (shots, flame, grenades, explosions, melee, blood, blessings, portals...).
import * as THREE from 'three';
import { wx, wz, clamp, lerp } from './util.js';

const P_VERT = `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(aSize * uScale / -mv.z, 600.0); gl_Position = projectionMatrix * mv; }`;
const P_FRAG = `varying vec4 vColor; void main(){ float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vColor.a; if (a < 0.004) discard; gl_FragColor = vec4(vColor.rgb, a); }`;
const STRIDE = 16, UP = new THREE.Vector3(0, 1, 0);

class Pool {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.d = new Float32Array(max * STRIDE);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3)); g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 4), 4)); g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.mat = new THREE.ShaderMaterial({ vertexShader: P_VERT, fragmentShader: P_FRAG, uniforms: { uScale: { value: 800 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 9 : 8; g.setDrawRange(0, 0);
  }
  spawn(o) {
    if (this.n >= this.max) return; const d = this.d, k = this.n++ * STRIDE, p = o.p, v = o.v || [0, 0, 0];
    d[k] = p.x != null ? p.x : p[0]; d[k + 1] = p.y != null ? p.y : p[1]; d[k + 2] = p.z != null ? p.z : p[2];
    d[k + 3] = v[0]; d[k + 4] = v[1]; d[k + 5] = v[2]; d[k + 6] = 0; d[k + 7] = o.life || 0.5; d[k + 8] = o.size[0]; d[k + 9] = o.size[1];
    d[k + 10] = o.col[0]; d[k + 11] = o.col[1]; d[k + 12] = o.col[2]; d[k + 13] = o.a == null ? 1 : o.a; d[k + 14] = o.grav || 0; d[k + 15] = o.drag == null ? 0.8 : o.drag;
  }
  update(dt) {
    const d = this.d, pos = this.geo.attributes.position.array, col = this.geo.attributes.aColor.array, size = this.geo.attributes.aSize.array;
    for (let i = 0; i < this.n; i++) {
      const k = i * STRIDE; d[k + 6] += dt;
      if (d[k + 6] >= d[k + 7]) { this.n--; d.copyWithin(k, this.n * STRIDE, this.n * STRIDE + STRIDE); i--; continue; }
      const f = Math.max(0, 1 - d[k + 15] * dt); d[k + 3] *= f; d[k + 5] *= f; d[k + 4] = d[k + 4] * f + d[k + 14] * dt;
      d[k] += d[k + 3] * dt; d[k + 1] += d[k + 4] * dt; d[k + 2] += d[k + 5] * dt;
      const t = d[k + 6] / d[k + 7]; pos[i * 3] = d[k]; pos[i * 3 + 1] = d[k + 1]; pos[i * 3 + 2] = d[k + 2];
      col[i * 4] = d[k + 10]; col[i * 4 + 1] = d[k + 11]; col[i * 4 + 2] = d[k + 12]; col[i * 4 + 3] = d[k + 13] * Math.min(1, t * 8) * Math.pow(1 - t, 1.3); size[i] = lerp(d[k + 8], d[k + 9], t);
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.aColor.needsUpdate = this.geo.attributes.aSize.needsUpdate = true; this.geo.setDrawRange(0, this.n);
  }
}

export class FX {
  // view supplies: UI, SIDE, world, minis, shake(a)
  constructor(scene, view) {
    this.scene = scene; this.view = view; this.norm = new Pool(3000, false); this.add = new Pool(4000, true); scene.add(this.norm.points, this.add.points);
    this.tweens = []; this.temps = new Set(); this.lights = []; this.li = 0;
    for (let i = 0; i < 5; i++) { const l = new THREE.PointLight(0xffffff, 0, 16, 2); scene.add(l); this.lights.push(l); }
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); this.ringGeo = new THREE.RingGeometry(0.88, 1, 56); this.ringGeo.rotateX(-Math.PI / 2);
    this.arcGeo = new THREE.TorusGeometry(1, 0.045, 4, 20, 2.5); this.arcGeo.rotateX(Math.PI / 2); this.partGeo = new THREE.RingGeometry(0.8, 1, 24, 1, 0, 3.6); this.partGeo.rotateX(-Math.PI / 2);
    this.ballGeo = new THREE.SphereGeometry(1, 10, 8); this.toothGeo = new THREE.ConeGeometry(0.09, 0.3, 4);
  }
  get speed() { return this.view.UI.speed; }
  spawn(o) { (o.add ? this.add : this.norm).spawn(o); }
  setScale(px) { this.norm.mat.uniforms.uScale.value = this.add.mat.uniforms.uScale.value = px; }
  tween(dur, fn, o = {}) { const tw = { t0: performance.now() + (o.delay || 0) / this.speed, dur, fn, end: o.end, start: o.start }; this.tweens.push(tw); return tw; }
  glowMat(col, op = 1) { return new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); }
  temp(geo, mat) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.frustumCulled = false; m.renderOrder = 9; this.scene.add(m); this.temps.add(m); return m; }
  drop(m) { this.scene.remove(m); this.temps.delete(m); m.material.dispose(); }
  setBeam(mesh, a, b, w) { mesh.visible = true; mesh.position.addVectors(a, b).multiplyScalar(0.5); const d = _v.subVectors(b, a), L = d.length(); mesh.scale.set(w, Math.max(L, 1e-3), w); if (L > 1e-4) mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / L)); }
  flash(pos, color, intensity, ms) { const l = this.lights[this.li++ % this.lights.length]; l.position.copy(pos); l.color.set(color); l.intensity = intensity; l._t0 = performance.now(); l._ms = ms; l._i = intensity; }
  ring(pos, r0, r1, col, dur, op = 0.9) { const m = this.temp(this.ringGeo, this.glowMat(col)); m.position.copy(pos); m.position.y += 0.07; this.tween(dur, k => { m.visible = true; m.scale.setScalar(lerp(r0, r1, 1 - Math.pow(1 - k, 2))); m.material.opacity = op * (1 - k); }, { end: () => this.drop(m) }); }
  sparks(p, col, n = 6, sp = 4) { for (let i = 0; i < n; i++) this.spawn({ add: true, p, v: [(Math.random() - 0.5) * sp, Math.random() * sp * 0.8, (Math.random() - 0.5) * sp], life: 0.2 + Math.random() * 0.25, size: [0.12, 0.02], col, grav: -9, drag: 1.5 }); }
  dust(bx, by, s = 1) { const y = this.view.world.heightAt(bx, by); this.spawn({ p: [wx(bx) + (Math.random() - 0.5) * 0.3, y + 0.1, wz(by) + (Math.random() - 0.5) * 0.3], v: [(Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8], life: 0.7 + Math.random() * 0.4, size: [0.25, 0.9], col: this.dustCol, a: 0.32 * s }); }
  get dustCol() { return this.view.world.dustCol; }
  bloodBurst(p, n, sp = 3) { for (let i = 0; i < n; i++) this.spawn({ p, v: [(Math.random() - 0.5) * sp, 0.6 + Math.random() * sp * 0.8, (Math.random() - 0.5) * sp], life: 0.45 + Math.random() * 0.35, size: [0.14, 0.05], col: [0.42, 0.01, 0.02], a: 0.95, grav: -11, drag: 0.4 }); }

  update(now, dt) {
    const sim = dt * clamp(this.speed, 0.6, 3); this.norm.update(sim); this.add.update(sim);
    for (const l of this.lights) if (l.intensity > 0) { const k = (now - l._t0) * this.speed / l._ms; l.intensity = k >= 1 ? 0 : l._i * (1 - k); }
    this.tweens = this.tweens.filter(tw => {
      const k = (now - tw.t0) * this.speed / tw.dur; if (k < 0) return true;
      if (!tw.started) { tw.started = true; if (tw.start) tw.start(); }
      try { tw.fn(Math.min(1, k)); } catch (e) { console.error(e); }
      if (k >= 1) { if (tw.end) tw.end(); return false; } return true;
    });
  }
  clear() { for (const tw of this.tweens) if (tw.end) try { tw.end(); } catch (e) {} this.tweens = []; for (const m of [...this.temps]) this.drop(m); this.norm.n = this.add.n = 0; for (const l of this.lights) l.intensity = 0; }

  // ------------------------------------------------------------ engine animations
  play(o) {
    const V = this.view, M = V.minis, now = performance.now(); const wname = o.w ? o.w.name.toLowerCase() : '';
    const chest = m => M.anchor(m, 0.62), foot = m => M.anchor(m, 0.02), ground = p => new THREE.Vector3(wx(p.x), V.world.heightAt(p.x, p.y), wz(p.y));
    switch (o.type) {
      case 'shot': {
        const kind = /flame/.test(wname) ? 'flame' : /shotgun|blunderbuss|punt/.test(wname) ? 'pellets' : /machine gun|automatic|smg|submachine|autocannon|gatling/.test(wname) ? 'burst' : /sniper|anti-materiel|jezzail|rifle/.test(wname) ? 'rail' : 'single';
        const n = kind === 'burst' ? 5 : kind === 'pellets' ? 7 : 1; M.face(o.m, o.t); const A = M.muzzle(o.m), Bc = chest(o.t);
        const col = kind === 'rail' ? new THREE.Color(1.6, 2.6, 3.4) : new THREE.Color(3.2, 2.3, 1.0), sp = kind === 'pellets' ? 0.9 : kind === 'burst' ? 0.45 : 0.1;
        for (let i = 0; i < n; i++) {
          const tb = Bc.clone().add(_v.set((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp * 0.6, (Math.random() - 0.5) * sp)), mesh = this.temp(this.beamGeo, this.glowMat(col)); let hit = false;
          this.tween(260, k => { const h = Math.min(1, k * 1.8), t = Math.max(0, k * 1.8 - 0.35); this.setBeam(mesh, _a.lerpVectors(A, tb, t), _b.lerpVectors(A, tb, h), kind === 'rail' ? 0.05 : 0.035); mesh.material.opacity = 1 - k * 0.8; if (k > 0.55 && !hit) { hit = true; this.sparks(tb, [3, 2.2, 1.1], 5); } },
            { delay: kind === 'burst' ? i * 70 : 0, end: () => this.drop(mesh), start: () => { M.recoil(o.m); this.spawn({ add: true, p: A, life: 0.09, size: [1.1, 0.3], col: [3.2, 2.4, 1.2] }); this.flash(A, 0xffc070, 45, 140); } });
        } break; }
      case 'flame': {
        M.face(o.m, o.t); const A = M.muzzle(o.m), Bc = chest(o.t), d = Bc.clone().sub(A), L = d.length(); d.normalize(); this.flash(_a.lerpVectors(A, Bc, 0.5).clone(), 0xff7a20, 60, 700);
        for (let i = 0; i < 30; i++) this.tween(1, () => {}, { delay: i * 18, start: () => {
          const s = L / 0.42, j = 0.22; this.spawn({ add: true, p: A, v: [d.x * s + (Math.random() - 0.5) * s * j, d.y * s + (Math.random() - 0.3) * s * j, d.z * s + (Math.random() - 0.5) * s * j], life: 0.5, size: [0.25, 1.7], col: [3.0, 1.1 + Math.random() * 0.9, 0.25], a: 0.8, drag: 0.5 });
          if (i % 4 === 0) this.spawn({ p: Bc, v: [(Math.random() - 0.5), 1.4, (Math.random() - 0.5)], life: 1.3, size: [0.5, 2], col: [0.05, 0.04, 0.04], a: 0.4 }); } });
        break; }
      case 'lob': case 'bomb': {
        const big = o.type === 'bomb'; M.face(o.m, o.t); const A = chest(o.m), Bc = foot(o.t);
        const mesh = this.temp(this.ballGeo, new THREE.MeshBasicMaterial({ color: big ? new THREE.Color(2.6, 0.8, 0.15) : 0x39452f, toneMapped: !big })); mesh.scale.setScalar(big ? 0.17 : 0.09);
        this.tween(big ? 900 : 650, k => { mesh.visible = true; mesh.position.lerpVectors(A, Bc, k); mesh.position.y += Math.sin(k * Math.PI) * (big ? 6 : 3.5);
          if (big) this.spawn({ add: true, p: mesh.position, life: 0.35, size: [0.4, 0.05], col: [3, 1.2, 0.2], a: 0.8 }); else if (Math.random() < 0.5) this.spawn({ p: mesh.position, life: 0.5, size: [0.12, 0.4], col: [0.3, 0.3, 0.28], a: 0.3 }); }, { end: () => this.drop(mesh) });
        break; }
      case 'explode': {
        const c = ground(o.p), r = o.r || 2; c.y += 0.25; const hot = o.gas ? [0.9, 2.2, 0.5] : o.fire ? [3.2, 1.2, 0.25] : [3.2, 1.8, 0.6];
        if (!o.gas) { this.spawn({ add: true, p: c, life: 0.22, size: [r * 3.2, r * 1.2], col: [3.5, 3.0, 2.2] }); this.flash(c.clone().setY(c.y + 1), 0xffa040, 160, 420);
          for (let i = 0; i < 16; i++) { const a = Math.random() * 6.283, v = (0.5 + Math.random()) * r * 1.6; this.spawn({ add: true, p: c, v: [Math.cos(a) * v, 0.8 + Math.random() * r * 1.6, Math.sin(a) * v], life: 0.45 + Math.random() * 0.4, size: [r * 0.55, r * 1.25], col: hot, a: 0.75, drag: 2.4 }); }
          for (let i = 0; i < 26; i++) { const a = Math.random() * 6.283, v = (1 + Math.random() * 3) * r; this.spawn({ p: c, v: [Math.cos(a) * v, 2.5 + Math.random() * 5, Math.sin(a) * v], life: 0.7 + Math.random() * 0.6, size: [0.14, 0.08], col: [0.07, 0.06, 0.05], a: 1, grav: -16, drag: 0.3 }); } }
        for (let i = 0; i < (o.gas ? 34 : 20); i++) { const a = Math.random() * 6.283, v = (0.3 + Math.random()) * r * 0.9; this.spawn({ p: c, v: [Math.cos(a) * v, 0.5 + Math.random() * (o.gas ? 0.6 : 1.8), Math.sin(a) * v], life: (o.gas ? 2.2 : 1.3) + Math.random() * 1.2, size: [r * 0.5, r * (o.gas ? 1.7 : 1.5)], col: o.gas ? [0.42, 0.62, 0.2] : [0.06, 0.05, 0.045], a: o.gas ? 0.4 : 0.55, drag: 1.6 }); }
        this.ring(c, 0.3, r, new THREE.Color(...hot), 620); V.world.scorch(o.p.x, o.p.y, r * 0.75, o.gas); V.shake(8); break; }
      case 'melee': {
        const kind = /claw|talon|hand|fist|nail|scratch/.test(wname) ? 'scratch' : /teeth|jaw|bite|maw|fang|tusk|mouth|mandible|stinger|sting/.test(wname) ? 'bite' : /bayonet|spear|lance|halberd|pike|trench knife|dagger|knife|khanjar|stake/.test(wname) ? 'thrust' : /hammer|maul|club|mace|flail|gavel|anchor|fists/.test(wname) ? 'smash' : 'swing';
        M.face(o.m, o.t); M.face(o.t, o.m); M.lunge(o.m, o.t); const A = chest(o.m), Bc = chest(o.t), dir = Bc.clone().sub(A).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
        const hitFx = () => { this.sparks(Bc, [3, 2.6, 2], 5, 3); M.flinch(o.t); };
        if (kind === 'scratch') for (let i = 0; i < 3; i++) { const mesh = this.temp(this.beamGeo, this.glowMat(new THREE.Color(3.2, 0.3, 0.25))), off = side.clone().multiplyScalar((i - 1) * 0.22), p0 = Bc.clone().add(off).add(_v.set(-side.x * 0.4, 0.5, -side.z * 0.4)), p1 = Bc.clone().add(off).add(_v.set(side.x * 0.4, -0.5, side.z * 0.4));
          this.tween(420, k => { this.setBeam(mesh, p0, _a.lerpVectors(p0, p1, Math.min(1, k * 2.5)), 0.035 * (1 - k * 0.6)); mesh.material.opacity = 1 - k; }, { delay: i * 70, end: () => this.drop(mesh), start: i === 1 ? hitFx : null }); }
        else if (kind === 'bite') { const grp = new THREE.Group(), mat = this.glowMat(new THREE.Color(2.4, 2.2, 2.0)); const rows = [new THREE.Group(), new THREE.Group()];
          rows.forEach((g, s) => { for (let t = 0; t < 5; t++) { const c = new THREE.Mesh(this.toothGeo, mat); c.position.x = (t - 2) * 0.2; c.rotation.z = s ? 0 : Math.PI; g.add(c); } grp.add(g); }); grp.position.copy(Bc); grp.lookAt(V.camera.position); this.scene.add(grp);
          this.tween(520, k => { const close = k < 0.45 ? k / 0.45 : 1; rows[0].position.y = 0.15 + 0.55 * (1 - close); rows[1].position.y = -0.15 - 0.55 * (1 - close); mat.opacity = 1 - Math.max(0, (k - 0.6) / 0.4); if (close === 1 && !grp._hit) { grp._hit = true; hitFx(); this.bloodBurst(Bc, 5, 2); } }, { end: () => { this.scene.remove(grp); mat.dispose(); } }); }
        else if (kind === 'thrust') { const mesh = this.temp(this.beamGeo, this.glowMat(new THREE.Color(2.2, 2.5, 3.0))); let hit = false;
          this.tween(380, k => { const e = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6; this.setBeam(mesh, _a.lerpVectors(A, Bc, 0.1), _b.lerpVectors(A, Bc, 0.3 + 0.7 * e), 0.03); mesh.material.opacity = 1 - k * 0.7; if (k > 0.38 && !hit) { hit = true; hitFx(); } }, { end: () => this.drop(mesh) }); }
        else if (kind === 'smash') { const ball = this.temp(this.ballGeo, new THREE.MeshBasicMaterial({ color: 0xc8c0b0 })); ball.scale.setScalar(0.16); let hit = false; const g = foot(o.t);
          this.tween(560, k => { if (k < 0.35) { const e = k / 0.35; ball.visible = true; ball.position.lerpVectors(A, Bc, e); ball.position.y += Math.sin(e * Math.PI) * 1.2; } else { ball.visible = false; if (!hit) { hit = true; hitFx(); this.ring(g, 0.3, 1.9, new THREE.Color(3, 2.4, 1.4), 380); for (let i = 0; i < 6; i++) this.dust(o.t.x, o.t.y, 1); V.shake(4); } } }, { end: () => this.drop(ball) }); }
        else { // a sweeping arc, centred on the direction of the target
          const mesh = this.temp(this.arcGeo, this.glowMat(new THREE.Color(2.4, 2.7, 3.2))), R = Math.max(0.9, A.distanceTo(Bc) * 0.85 + 0.25), phi = Math.atan2(dir.z, dir.x); mesh.position.copy(A); mesh.scale.set(R, 1.6, R); let hit = false;
          this.tween(460, k => { mesh.visible = true; const e = Math.min(1, k * 1.6); mesh.rotation.y = 1.25 - phi + (1 - e) * 1.7; mesh.material.opacity = 1 - k; if (e > 0.6 && !hit) { hit = true; hitFx(); } }, { end: () => this.drop(mesh) }); }
        break; }
      case 'charge': { for (let i = 0; i < 12; i++) this.dust(o.m.x + (Math.random() - 0.5), o.m.y + (Math.random() - 0.5), 1); if (o.t) M.face(o.m, o.t); V.shake(3); break; }
      case 'knock': this.tween(500, k => { const h = M.anchor(o.m, 1.15); for (let i = 0; i < 3; i++) { const a = k * 6 + i * 2.1; this.spawn({ add: true, p: [h.x + Math.cos(a) * 0.4, h.y + Math.sin(a * 2) * 0.05, h.z + Math.sin(a) * 0.4], life: 0.12, size: [0.16, 0.05], col: [3, 2.2, 0.6] }); } }); break;
      case 'death': { const m = o.m, p = chest(m), g = foot(m); V.world.blood(m.x, m.y, m.r * 1.6); this.ring(g, m.r * 1.15, m.r * 2.4, new THREE.Color(V.SIDE[m.side]).multiplyScalar(1.6), 900); this.bloodBurst(p, 22, 4);
        for (let i = 0; i < 6; i++) this.spawn({ p, v: [(Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2], life: 1.1, size: [0.4, 1.3], col: [0.25, 0.02, 0.03], a: 0.35 }); break; }
      case 'blood': { this.bloodBurst(chest(o.m), 12, 2.6); M.flinch(o.m); break; }
      case 'bless': { const g = foot(o.m); this.ring(g, 0.3, 1.5, new THREE.Color(3, 2.3, 0.8), 700); this.flash(chest(o.m), 0xffd36b, 30, 800);
        this.tween(800, k => { const c = M.anchor(o.m, 0.1); for (let i = 0; i < 2; i++) { const a = k * 9 + i * 3.14, r = 0.5 + k * 0.5; this.spawn({ add: true, p: [c.x + Math.cos(a) * r, c.y + k * 2.2, c.z + Math.sin(a) * r], v: [0, 0.6, 0], life: 0.5, size: [0.2, 0.04], col: [3.2, 2.4, 0.8] }); } }); break; }
      case 'gaze': { M.face(o.m, o.t); const A = chest(o.m), Bc = chest(o.t), col = new THREE.Color(o.color || '#c04cff').multiplyScalar(2.6), mesh = this.temp(this.beamGeo, this.glowMat(col)), g = foot(o.t);
        const rg = this.temp(this.ringGeo, this.glowMat(col)); rg.position.copy(g); rg.position.y += 0.08;
        this.tween(700, k => { const s = Math.sin(k * Math.PI); this.setBeam(mesh, A, Bc, 0.02 + 0.03 * s); mesh.material.opacity = s * 0.9; rg.visible = true; rg.scale.setScalar(0.6 + k * 0.5); rg.material.opacity = s;
          _a.lerpVectors(A, Bc, (k * 3) % 1); this.spawn({ add: true, p: _a, life: 0.25, size: [0.22, 0.05], col: [col.r, col.g, col.b] }); }, { end: () => { this.drop(mesh); this.drop(rg); } }); break; }
      case 'portal': { const g = ground(o.p), col = new THREE.Color(2.2, 0.8, 3.2), parts = [0, 1, 2, 3].map(() => this.temp(this.partGeo, this.glowMat(col))); this.flash(g.clone().setY(g.y + 1), 0xb04bff, 50, 900);
        this.tween(900, k => { parts.forEach((m, i) => { m.visible = true; m.position.copy(g); m.position.y += 0.08 + i * 0.03; m.scale.setScalar((0.3 + i * 0.3) * (1 + Math.sin(k * Math.PI))); m.rotation.y = k * 8 * (i % 2 ? -1 : 1) + i; m.material.opacity = (1 - k) * 0.9; });
          const a = Math.random() * 6.283; this.spawn({ add: true, p: [g.x + Math.cos(a) * 0.7, g.y + 0.1, g.z + Math.sin(a) * 0.7], v: [-Math.cos(a) * 0.8, 2.5, -Math.sin(a) * 0.8], life: 0.6, size: [0.2, 0.04], col: [2.2, 0.8, 3.2] }); }, { end: () => parts.forEach(m => this.drop(m)) }); break; }
      case 'fall': { const mesh = this.temp(this.beamGeo, this.glowMat(new THREE.Color(2, 2, 2))); this.tween(600, k => { const p = M.anchor(o.m, 0.5); this.setBeam(mesh, _a.copy(p).setY(p.y + 2.6 * (1 - k) + 0.1), p, 0.03); mesh.material.opacity = 1 - k; }, { end: () => { this.drop(mesh); for (let i = 0; i < 5; i++) this.dust(o.m.x, o.m.y, 1); } }); break; }
    }
  }
}
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
