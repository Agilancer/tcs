// The 3D table: renderer, camera, post-processing, picking, overlays and name plates.
// It reads the game and the shared UI state every frame; ui.js owns the game flow.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld } from './world.js';
import { Minis } from './minis.js';
import { FX } from './fx.js';
import { Dice } from './dice.js';
import { B, HALF, wx, wz, clamp } from './util.js';

// Final grade: slightly drained colour, a tint per battlefield, warm highlights over cold shadows, vignette and film grain.
const GRADE = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 0.85 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, sat; uniform vec3 tint; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat) * tint;
      vec3 k = clamp(c.rgb, 0.0, 1.0); c.rgb = mix(c.rgb, k * k * (3.0 - 2.0 * k), 0.3 * step(c.rgb, vec3(1.0)));   // deeper blacks
      c.rgb += vec3(0.022, 0.012, -0.012) * smoothstep(0.25, 1.0, l) + vec3(-0.006, 0.002, 0.008) * (1.0 - smoothstep(0.0, 0.35, l));
      float v = smoothstep(0.95, 0.3, length(vUv - 0.5) * 1.18); c.rgb *= mix(0.6, 1.0, v);
      float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453); c.rgb += (n - 0.5) * 0.028 * (0.4 + l);
      gl_FragColor = c; }`,
};

export function createView(canvasEl, wrap, labelsEl, UI, SIDE) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 1.5); let pr = PR; renderer.setPixelRatio(PR);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0a09);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 1600); camera.position.set(0, 33, 37);
  const controls = new OrbitControls(camera, canvasEl);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, minDistance: 6, maxDistance: 100, maxPolarAngle: 1.47, minPolarAngle: 0.02, screenSpacePanning: false, zoomSpeed: 0.9, rotateSpeed: 0.55, panSpeed: 0.8, autoRotateSpeed: 0.3 });
  canvasEl.addEventListener('contextmenu', e => e.preventDefault());

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 })); composer.setPixelRatio(PR);
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.5, 0.75, 0.92), grade = new ShaderPass(GRADE);
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(grade); composer.addPass(new OutputPass());

  const view = { UI, SIDE, camera, controls, scene, renderer, world: null, game: null, hoverModel: null, follow: true, showLabels: true, onClick: null };
  const minis = view.minis = new Minis(scene, view), fx = view.fx = new FX(scene, view), dice = view.dice = new Dice(view);
  let W = 4, H = 4, shakeT = 0, shakeA = 0, lastUser = -1e9, camAnim = null, last = performance.now();
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

  view.size = () => [W, H];
  view.project = p => { _v.copy(p).project(camera); return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H, _v.z]; };
  view.rayAt = (sx, sy) => { ndc.set(sx / W * 2 - 1, -(sy / H) * 2 + 1); raycaster.setFromCamera(ndc, camera); return raycaster.ray; };
  view.shake = a => { shakeT = performance.now(); shakeA = a * 0.03; };
  // where a ray meets the sculpted ground, as table coordinates
  function groundPoint(ray) {
    if (!view.world || ray.direction.y > -1e-3) return null; let t = -ray.origin.y / ray.direction.y;
    for (let i = 0; i < 6; i++) { _v.copy(ray.origin).addScaledVector(ray.direction, t); t = (view.world.heightAt(_v.x + HALF, _v.z + HALF) - ray.origin.y) / ray.direction.y; }
    _v.copy(ray.origin).addScaledVector(ray.direction, t); return { x: _v.x + HALF, y: _v.z + HALF };
  }

  // ---- camera moves
  // Table view: far enough back that the whole table fits, and steeper in a squarer window so the table still fills it.
  const tablePos = () => {
    const a = camera.aspect, elev = (60 - 18 * clamp((a - 1) / 0.6, 0, 1)) * Math.PI / 180, d = Math.max(61 / a, 62 * Math.sin(elev), 38);
    return new THREE.Vector3(0, d * Math.sin(elev), d * Math.cos(elev));
  };
  const topPos = () => new THREE.Vector3(0, Math.max(64 / camera.aspect, 64), 0.02);
  const flyTo = (pos, target, ms) => { camAnim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms }; };
  view.setCamera = (mode) => { flyTo(mode === 'top' ? topPos() : tablePos(), new THREE.Vector3(0, 0, 0), 900); lastUser = performance.now(); };
  controls.addEventListener('start', () => { lastUser = performance.now(); camAnim = null; });

  // ---- overlays: reachable ground, range ring, aim line, cursor
  const reachData = new Uint8Array(72 * 72 * 4), reachTex = new THREE.DataTexture(reachData, 72, 72); reachTex.magFilter = THREE.LinearFilter; reachTex.minFilter = THREE.LinearFilter; reachTex.colorSpace = THREE.SRGBColorSpace;
  const reach = new THREE.Mesh(new THREE.PlaneGeometry(B, B, 72, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: reachTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); reach.visible = false; reach.renderOrder = 3; scene.add(reach);
  const rangeRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 72 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 0.6, 2.4), transparent: true, opacity: 0.85, toneMapped: false })); rangeRing.visible = false; rangeRing.frustumCulled = false; scene.add(rangeRing);
  const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.6, toneMapped: false })); aimLine.visible = false; aimLine.frustumCulled = false; scene.add(aimLine);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })); cursor.visible = false; scene.add(cursor);
  let shownOverlay = null;
  function syncOverlay(t) {
    const o = UI.overlay;
    if (o !== shownOverlay) {
      shownOverlay = o; reach.visible = !!o && o.type === 'reach'; rangeRing.visible = !!o && o.type === 'ring';
      if (reach.visible) { reachData.fill(0); const amber = /255,200,90/.test(o.color || ''), c = amber ? [255, 200, 90] : [120, 200, 255]; for (const i of o.cells) { const gx = i % 72, gy = (i / 72) | 0, k = ((71 - gy) * 72 + gx) * 4; reachData[k] = c[0]; reachData[k + 1] = c[1]; reachData[k + 2] = c[2]; reachData[k + 3] = 92; } reachTex.needsUpdate = true; }
      if (rangeRing.visible) { const pos = rangeRing.geometry.attributes.position; for (let i = 0; i < 72; i++) { const a = i / 72 * 6.283, bx = o.x + Math.cos(a) * o.r, by = o.y + Math.sin(a) * o.r; pos.setXYZ(i, wx(bx), view.world.heightAt(clamp(bx, 0, B), clamp(by, 0, B)) + 0.12, wz(by)); } pos.needsUpdate = true; }
    }
    if (reach.visible) reach.material.opacity = 0.75 + 0.2 * Math.sin(t * 3);
    const hp = UI.hoverPt; cursor.visible = !!o && !!hp && hp.x >= 0 && hp.y >= 0 && hp.x <= B && hp.y <= B; if (cursor.visible) cursor.position.set(wx(hp.x), view.world.heightAt(hp.x, hp.y) + 0.1, wz(hp.y));
    aimLine.visible = !!(UI.aim && hp);
    if (aimLine.visible) { const a = minis.anchor(UI.aim, 0.6), pos = aimLine.geometry.attributes.position; pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, wx(hp.x), view.world.heightAt(clamp(hp.x, 0, B), clamp(hp.y, 0, B)) + 0.5, wz(hp.y)); pos.needsUpdate = true; aimLine.computeLineDistances(); }
  }

  // ---- name plates
  const plates = new Map();
  function syncLabels() {
    const g = view.game; for (const [m, el] of plates) if (!minis.map.has(m) || m.ooa) { el.remove(); plates.delete(m); }
    if (!g) return; labelsEl.style.display = view.showLabels ? '' : 'none'; if (!view.showLabels) return;
    for (const k of minis.list) {
      const m = k.m; if (m.ooa) continue; let el = plates.get(m);
      if (!el) { el = document.createElement('div'); el.className = 'plate'; el.style.borderColor = SIDE[m.side]; labelsEl.appendChild(el); plates.set(m, el); el._sig = ''; }
      const info = UI.targets && UI.targets.has(m) ? UI.targets.get(m) : null, hot = UI.active === m || view.hoverModel === m || UI.hover === m || info != null;
      const sig = [m.label, m.down, (m.h || 0) >= 3, info, hot, m.activated && !g.over && UI.active !== m, m.leader].join('|');
      if (sig !== el._sig) { el._sig = sig; el.innerHTML = `${m.leader ? '<i class="ld">♛</i>' : ''}${esc(m.label)}${m.down ? '<i class="dn">DOWN</i>' : ''}${(m.h || 0) >= 3 ? '<i class="hi">▲</i>' : ''}${info ? `<i class="ti">${esc(info)}</i>` : ''}`; el.classList.toggle('hot', hot); el.classList.toggle('done', !!(m.activated && !g.over && UI.active !== m)); el.classList.toggle('tgt', info != null); }
      _w.copy(k.root.position); _w.y += k.h + 0.28; const [sx, sy, sz] = view.project(_w);
      if (sz > 1 || sx < -40 || sy < -20 || sx > W + 40 || sy > H + 20) { el.style.display = 'none'; continue; }
      const far = clamp((camera.position.distanceTo(_w) - 55) / 40, 0, 1); el.style.display = ''; el.style.opacity = hot ? 1 : (1 - far * 0.75) * (m.flags.faded ? 0.5 : 1);
      el.style.transform = `translate(-50%,-100%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; el.style.zIndex = hot ? 5000 : (2000 - sz * 2000) | 0;
    }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- pointer: a click that does not turn into a drag picks a model or a point on the ground
  let down = null, mouse = null;
  canvasEl.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
  canvasEl.addEventListener('pointerup', e => {
    if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; } down = null;
    const r = canvasEl.getBoundingClientRect(), ray = view.rayAt(e.clientX - r.left, e.clientY - r.top), model = minis.pick(ray), p = groundPoint(ray) || { x: -99, y: -99 };
    if (view.onClick) view.onClick({ p: model ? { x: model.x, y: model.y } : p, model });
  });
  canvasEl.addEventListener('pointermove', e => { const r = canvasEl.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
  canvasEl.addEventListener('pointerleave', () => { mouse = null; view.hoverModel = null; });
  function syncHover() {
    if (!mouse || !view.world) return; const ray = view.rayAt(mouse.x, mouse.y); view.hoverModel = minis.pick(ray); UI.hoverPt = groundPoint(ray);
    canvasEl.style.cursor = view.hoverModel || UI.overlay ? 'pointer' : 'grab';
  }

  // ---- game
  view.setGame = g => {
    fx.clear(); dice.clear(); if (view.world) { scene.remove(view.world.group); view.world.dispose(); }
    view.game = g; const world = view.world = buildWorld(g, renderer, SIDE); scene.add(world.group); scene.fog = world.fog; scene.environment = world.env; dice.scene.environment = world.env;
    grade.uniforms.tint.value.set(...world.biome.tint); grade.uniforms.sat.value = world.biome.sat;
    const pos = reach.geometry.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, world.heightAt(pos.getX(i) + HALF, pos.getZ(i) + HALF) + 0.08); pos.needsUpdate = true;
    world.sun.castShadow = quality < 2; minis.setGame(g); shownOverlay = null;
    // open on a low pass over the lines, then rise to the table view
    const z = g.terrain.zones[0], side = z.x + z.w / 2 < HALF ? -1 : 1; camera.position.set(side * 36, 6, 30); controls.target.set(0, 1, 0); flyTo(tablePos(), new THREE.Vector3(0, 0, 0), 3200); lastUser = -1e9;
  };

  // ---- quality: if most frames run long, give up resolution first, then bloom and shadows. It never steps back up.
  let quality = 0, seen = 0, slow = 0;
  function setQuality(q) { quality = q; pr = q === 1 ? Math.min(PR, 1) : 0.75; renderer.setPixelRatio(pr); composer.setPixelRatio(pr); bloom.enabled = q < 2; if (view.world) view.world.sun.castShadow = q < 2; resize(); }
  function watchFrameTime(dt) { if (dt < 0.004 || dt > 0.4) return; seen++; if (dt > 0.045) slow++; if (seen >= 150) { if (slow > 100 && quality < 2) setQuality(quality + 1); seen = slow = 0; } }   // frames over 0.4 s mean a hidden tab, not a slow machine

  function resize() {
    W = Math.max(4, wrap.clientWidth); H = Math.max(4, wrap.clientHeight); renderer.setSize(W, H, false); composer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
    fx.setScale(H * pr / (2 * Math.tan(camera.fov * Math.PI / 360)));
  }
  new ResizeObserver(resize).observe(wrap); resize();

  function frame(now) {
    requestAnimationFrame(frame); const raw = (now - last) / 1000, dt = Math.min(0.1, raw), t = now / 1000; last = now; if (!view.world) return; watchFrameTime(raw);
    if (camAnim) { const k = clamp((now - camAnim.start) / camAnim.ms, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; camera.position.lerpVectors(camAnim.p0, camAnim.p1, e); controls.target.lerpVectors(camAnim.t0, camAnim.t1, e); if (k >= 1) camAnim = null; }
    // follow the action when nobody is steering
    const idle = now - lastUser > 5000 && !camAnim && !UI.isHumanTurn && view.follow && !view.game.over; controls.autoRotate = idle;
    if (idle && UI.active && !UI.active.ooa) { const f = minis.anchor(UI.active, 0.3); _v.set(f.x * 0.55 - controls.target.x, 0, f.z * 0.55 - controls.target.z).multiplyScalar(1 - Math.exp(-dt * 0.9)); controls.target.add(_v); camera.position.add(_v); }
    controls.target.set(clamp(controls.target.x, -22, 22), clamp(controls.target.y, 0, 4), clamp(controls.target.z, -22, 22)); controls.update();
    const gy = view.world.heightAt(camera.position.x + HALF, camera.position.z + HALF) + 1.2; if (camera.position.y < gy) camera.position.y = gy;

    syncHover(); view.world.update(dt, t, now, camera, fx); minis.update(now, t, dt); fx.update(now, dt); dice.update(now); syncOverlay(t); syncLabels();
    grade.uniforms.time.value = t % 100;
    const sk = Math.max(0, 1 - (now - shakeT) / 320) * shakeA; if (sk) { _v.set((Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk); camera.position.add(_v); }
    composer.render();
    if (dice.throws.length) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(dice.scene, camera); renderer.autoClear = true; }
    if (sk) camera.position.sub(_v);
  }
  requestAnimationFrame(frame);
  return view;
}
