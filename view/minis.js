// Miniatures: every model is a small low-poly figure on a round base, built from its faction, name, keywords and kit.
// The base rim carries the side colour. Tokens orbit the figure, leaders wear a halo, and figures walk, lunge, recoil and fall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wx, wz, clamp, lerp, Parts, softTexture } from './util.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z), Y = V3(0, 1, 0), ONE = V3(1, 1, 1);
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _on = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();

// cloth, dark (leather, boots, wood), metal, skin, accent, glow (eyes, sigils; HDR so it blooms)
const PAL = {
  new_antioch: { cloth: 0x605d44, dark: 0x33271c, metal: 0x868c8f, skin: 0xc9a183, accent: 0xa3231f, glow: [3.0, 2.3, 1.1] },
  trench_pilgrims: { cloth: 0x5b3d2e, dark: 0x2a1f1a, metal: 0x4d4946, skin: 0xc4a184, accent: 0x9a1f1a, glow: [3.0, 2.2, 0.9] },
  iron_sultanate: { cloth: 0x2c6a68, dark: 0x3a2a1c, metal: 0xb5903f, skin: 0xa87a55, accent: 0xb3261e, glow: [0.6, 2.6, 2.8] },
  heretic_legions: { cloth: 0x2c2525, dark: 0x151212, metal: 0x62352b, skin: 0x8d8378, accent: 0x7a1410, glow: [3.4, 0.7, 0.15] },
  naval_raiders: { cloth: 0x1f3038, dark: 0x12181b, metal: 0x7d6d46, skin: 0x7f8a86, accent: 0x1f6a60, glow: [0.4, 3.0, 2.4] },
  black_grail: { cloth: 0x435030, dark: 0x1d2014, metal: 0x5f523b, skin: 0x8a946c, accent: 0x6a7a22, glow: [1.6, 3.2, 0.4] },
  court: { cloth: 0x5e1017, dark: 0x1c0a0b, metal: 0xb8912f, skin: 0x8e2622, accent: 0xd9a441, glow: [3.4, 0.9, 0.2] },
  merc: { cloth: 0x4c4842, dark: 0x25211e, metal: 0x79776f, skin: 0xbf9a7c, accent: 0x6b5a8a, glow: [2.4, 2.4, 3.0] },
};
const matCache = {};
function matsFor(fid) {
  if (matCache[fid]) return matCache[fid]; const p = PAL[fid] || PAL.merc, s = o => new THREE.MeshStandardMaterial(Object.assign({ flatShading: true, roughness: 0.82 }, o));
  return matCache[fid] = {
    cloth: s({ color: p.cloth }), dark: s({ color: p.dark, roughness: 0.9 }), metal: s({ color: p.metal, roughness: 0.45, metalness: 0.75 }), skin: s({ color: p.skin, roughness: 0.7 }), accent: s({ color: p.accent, roughness: 0.6 }),
    steel: s({ color: 0xb9bec2, roughness: 0.3, metalness: 0.9 }), bone: s({ color: 0xd8ccb0 }), glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(...p.glow), toneMapped: false }),
    wing: s({ color: new THREE.Color(p.skin).multiplyScalar(0.55), side: THREE.DoubleSide }), clear: new THREE.MeshStandardMaterial({ color: 0xc8d2b8, transparent: true, opacity: 0.4, side: THREE.DoubleSide, roughness: 0.2, depthWrite: false }),
  };
}

// place a geometry whose length runs along +Y so that it runs along `dir`, starting `off` from `base`
function along(P, key, geom, base, dir, off = 0) { _q.setFromUnitVectors(Y, dir); _m.compose(base.clone().addScaledVector(dir, off), _q, ONE); P.addM(key, geom, _m); }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, n = 7, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, open), ball = (r, a = 7, b = 5) => new THREE.SphereGeometry(r, a, b), cone = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);

function headgear(P, type, y, R) {
  const head = () => P.add('skin', ball(0.105), [0, y, 0]), eyes = (z = 0.085, e = 0.022) => { for (const s of [-1, 1]) P.add('glow', ball(e, 5, 4), [s * 0.04, y + 0.015, z]); };
  const horns = (key, len, out) => { for (const s of [-1, 1]) { const a = V3(s * 0.08, y + 0.06, 0), b = V3(s * (0.08 + out), y + 0.12 + len * 0.4, -0.02), c = V3(s * (0.06 + out), y + 0.14 + len, 0.05); P.stick(key, a, b, 0.035, 0.026, 5).stick(key, b, c, 0.026, 0.006, 5); } };
  switch (type) {
    case 'bare': head(); break;
    case 'kettle': case 'kettleCross': head(); P.add('metal', new THREE.SphereGeometry(0.125, 8, 4, 0, 6.283, 0, 1.57), [0, y + 0.02, 0]).add('metal', cyl(0.2, 0.21, 0.02, 10), [0, y + 0.03, 0]);
      P.add('dark', cyl(0.045, 0.055, 0.1, 6), [0, y - 0.04, 0.1], [1.57, 0, 0]); if (type === 'kettleCross') P.add('accent', box(0.03, 0.14, 0.03), [0, y + 0.2, 0]).add('accent', box(0.1, 0.03, 0.03), [0, y + 0.22, 0]); break;
    case 'cap': head(); P.add('dark', cyl(0.115, 0.12, 0.07, 8), [0, y + 0.09, 0]).add('dark', box(0.16, 0.015, 0.1), [0, y + 0.06, 0.1]).add('accent', cone(0.03, 0.22, 5), [0.06, y + 0.22, -0.02]); break;
    case 'hood': case 'hoodMask': P.add('cloth', ball(0.135), [0, y + 0.01, -0.01], [0, 0, 0], [1, 1.1, 1.1]).add('cloth', cone(0.1, 0.2, 6), [0, y + 0.12, -0.08], [-0.9, 0, 0]);
      if (type === 'hoodMask') { P.add('bone', ball(0.085, 6, 5), [0, y - 0.01, 0.07]); eyes(0.15, 0.018); } else P.add('dark', ball(0.085, 6, 5), [0, y - 0.01, 0.065]); break;
    case 'capirote': P.add('accent', ball(0.115), [0, y, 0]).add('accent', cone(0.125, 0.56, 8), [0, y + 0.33, 0]); for (const s of [-1, 1]) P.add('dark', box(0.03, 0.022, 0.02), [s * 0.04, y + 0.02, 0.105]); P.add('bone', box(0.025, 0.11, 0.012), [0, y + 0.26, 0.085]).add('bone', box(0.07, 0.025, 0.012), [0, y + 0.28, 0.08]); break;
    case 'veil': head(); P.add('dark', ball(0.13), [0, y + 0.02, -0.03]).add('dark', cyl(0.12, 0.2, 0.32, 8, true), [0, y - 0.14, -0.04]).add('bone', box(0.16, 0.035, 0.05), [0, y + 0.07, 0.085]); break;
    case 'cage': head(); P.add('metal', box(0.26, 0.26, 0.26), [0, y + 0.01, 0]).add('dark', box(0.18, 0.05, 0.02), [0, y + 0.02, 0.135]); break;
    case 'greathelm': case 'greathelmCross': case 'greathelmSlit': case 'hornedHelm':
      P.add('metal', cyl(0.125, 0.118, 0.25, 8), [0, y + 0.01, 0]).add('metal', cone(0.125, 0.07, 8), [0, y + 0.17, 0]);
      if (type === 'greathelmCross') P.add('accent', box(0.022, 0.17, 0.02), [0, y + 0.01, 0.12]).add('accent', box(0.12, 0.022, 0.02), [0, y + 0.04, 0.12]);
      else P.add(type === 'greathelm' ? 'dark' : 'glow', box(0.13, 0.02, 0.02), [0, y + 0.03, 0.118]);
      if (type === 'hornedHelm') horns('accent', 0.22, 0.1); break;
    case 'turban': case 'turbanTall': head(); P.add('bone', ball(0.15, 8, 6), [0, y + 0.08, 0], [0, 0, 0], [1, 0.62, 1]).add('accent', ball(0.03, 5, 4), [0, y + 0.08, 0.14]); if (type === 'turbanTall') P.add('accent', cone(0.07, 0.2, 6), [0, y + 0.22, 0]); break;
    case 'spike': head(); P.add('metal', new THREE.SphereGeometry(0.125, 8, 4, 0, 6.283, 0, 1.57), [0, y + 0.02, 0]).add('metal', cone(0.028, 0.22, 6), [0, y + 0.24, 0]).add('metal', cyl(0.12, 0.16, 0.14, 8, true), [0, y - 0.05, -0.01]); break;
    case 'horned': P.add('dark', ball(0.105), [0, y, 0]).add('metal', new THREE.SphereGeometry(0.128, 8, 4, 0, 6.283, 0, 1.75), [0, y + 0.015, 0]); horns('bone', 0.2, 0.1); P.add('glow', box(0.11, 0.018, 0.02), [0, y, 0.115]); break;
    case 'mitre': head(); P.add('cloth', cyl(0.05, 0.125, 0.36, 4), [0, y + 0.24, 0], [0, 0.785, 0]).add('accent', cyl(0.127, 0.127, 0.04, 8), [0, y + 0.08, 0]).add('glow', box(0.03, 0.12, 0.02), [0, y + 0.24, 0.07]); horns('bone', 0.12, 0.09); break;
    case 'headless': P.add('dark', cyl(0.07, 0.09, 0.06, 6), [0, y - 0.1, 0]).add('glow', new THREE.TorusGeometry(0.13, 0.016, 5, 16), [0, y + 0.04, 0], [1.57, 0, 0]).add('glow', ball(0.03, 5, 4), [0, y - 0.06, 0]); break;
    case 'diver': P.add('metal', ball(0.15, 8, 6), [0, y + 0.01, 0]).add('glow', cyl(0.06, 0.06, 0.03, 8), [0, y + 0.02, 0.14], [1.57, 0, 0]).add('metal', cyl(0.17, 0.17, 0.05, 8), [0, y - 0.13, 0]); for (const s of [-1, 1]) P.add('metal', cyl(0.035, 0.035, 0.03, 6), [s * 0.14, y + 0.02, 0.03], [0, 0, 1.57]); break;
    case 'bug': P.add('dark', ball(0.12), [0, y, 0.01]); for (const s of [-1, 1]) { P.add('glow', ball(0.05, 6, 5), [s * 0.075, y + 0.03, 0.085]); P.stick('dark', V3(s * 0.03, y - 0.06, 0.1), V3(s * 0.05, y - 0.16, 0.16), 0.014, 0.004, 4); } break;
    case 'demon': case 'demonCrown': head(); eyes(); horns(type === 'demon' ? 'dark' : 'bone', type === 'demon' ? 0.2 : 0.34, 0.11); if (type === 'demonCrown') P.add('accent', new THREE.TorusGeometry(0.115, 0.02, 5, 14), [0, y + 0.085, 0], [1.57, 0, 0]); break;
    default: head();
  }
}
function pickHead(fid, n, m) {
  if (fid === 'new_antioch') return /sniper/.test(n) ? 'hood' : /cleric|lector|kaplan/.test(n) ? 'kettleCross' : /lieutenant|hauptmann/.test(n) ? 'cap' : /heavy/.test(n) ? 'greathelm' : /holy warrior|communicant/.test(n) ? 'greathelmCross' : 'kettle';
  if (fid === 'trench_pilgrims') return /nun|sister/.test(n) ? 'veil' : /prisoner/.test(n) ? 'cage' : /communicant|knight/.test(n) ? 'greathelmCross' : /leper/.test(n) ? 'hood' : 'capirote';
  if (fid === 'iron_sultanate') return /assassin/.test(n) ? 'hoodMask' : /janissary|silahdar|sipahi|fris/.test(n) ? 'spike' : /alchemist|dervish/.test(n) ? 'turbanTall' : /homunculus/.test(n) ? 'bare' : 'turban';
  if (fid === 'heretic_legions' || fid === 'naval_raiders') return /chorister/.test(n) ? 'headless' : /priest|captain/.test(n) ? 'mitre' : /wretched/.test(n) ? 'bare' : /commando/.test(n) ? 'hoodMask' : /witch|banshee|hag/.test(n) ? 'hood' : fid === 'naval_raiders' ? 'diver' : 'horned';
  if (fid === 'black_grail') return /fly|herald/.test(n) ? 'bug' : /thrall|ravenous|husk|bereaved|cradle|lord|maw|gula|amalgam|hag/.test(n) ? 'bare' : 'greathelmSlit';
  if (fid === 'court') return /wretched/.test(n) ? 'bare' : /hell knight|hunter/.test(n) ? 'hornedHelm' : /praetor|sorcerer/.test(n) ? 'demonCrown' : 'demon';
  return /guardian|faris|hunter/.test(n) ? 'greathelm' : 'hood';
}

function meleeWeapon(P, wn, hand, dir) {
  if (/claw|talon|hand|fist|nail|teeth|jaw|bite|maw|fang|tusk|sting/.test(wn)) { for (let i = -1; i <= 1; i++) along(P, 'bone', cone(0.018, 0.16, 4), hand.clone().add(V3(i * 0.035, 0, 0)), dir, 0.08); return; }
  const shaft = (len, off, key = 'dark') => along(P, key, cyl(0.014, 0.014, len, 5), hand, dir, off);
  if (/hammer|maul|gavel|tenderiser|sledge/.test(wn)) { shaft(0.85, 0.3); along(P, 'metal', box(0.22, 0.14, 0.14), hand, dir, 0.72); }
  else if (/mace|club|flail|morning|censer/.test(wn)) { shaft(0.55, 0.2); along(P, 'metal', ball(0.075, 6, 5), hand, dir, 0.5); for (let i = 0; i < 4; i++) along(P, 'metal', cone(0.02, 0.07, 4), hand.clone().add(V3(Math.cos(i * 1.57) * 0.07, 0, Math.sin(i * 1.57) * 0.07)), dir, 0.5); }
  else if (/polearm|halberd|glaive|scythe/.test(wn)) { shaft(1.35, 0.4); const g = box(0.2, 0.26, 0.016); g.translate(0.1, 0, 0); along(P, 'steel', g, hand, dir, 0.95); along(P, 'steel', cone(0.03, 0.2, 4), hand, dir, 1.17); }
  else if (/spear|lance|pike|stake|harpoon/.test(wn)) { shaft(1.4, 0.45); along(P, 'steel', cone(0.035, 0.2, 5), hand, dir, 1.25); }
  else if (/axe/.test(wn) && !/sword/.test(wn)) { shaft(0.75, 0.3); const g = box(0.2, 0.17, 0.02); g.translate(0.1, 0, 0); along(P, 'steel', g, hand, dir, 0.6); }
  else if (/knife|dagger|khanjar|misericord|bayonet|vivisector|scalpel/.test(wn)) { along(P, 'steel', box(0.035, 0.26, 0.012), hand, dir, 0.17); along(P, 'metal', box(0.09, 0.02, 0.025), hand, dir, 0.04); }
  else if (/shovel|spade/.test(wn)) { shaft(0.75, 0.3); along(P, 'metal', box(0.13, 0.17, 0.016), hand, dir, 0.74); }
  else if (/staff|standard|banner|crozier/.test(wn)) { shaft(1.45, 0.45); along(P, 'accent', box(0.03, 0.2, 0.03), hand, dir, 1.2); along(P, 'accent', box(0.14, 0.03, 0.03), hand, dir, 1.22); }
  else { const great = /great|claymore|zwei|two-hand|executioner|headsman/.test(wn), L = great ? 0.95 : 0.62; along(P, 'steel', box(great ? 0.07 : 0.05, L, 0.014), hand, dir, L / 2 + 0.06); along(P, 'metal', box(great ? 0.22 : 0.16, 0.026, 0.03), hand, dir, 0.06); along(P, 'dark', cyl(0.014, 0.014, 0.12, 5), hand, dir, -0.02); }
}
// guns point along +Z from the hands; returns the muzzle position
function gun(P, wn, kit) {
  const x = 0.07, y = 0.8; let z1 = 0.6;
  if (/flame|fire|incendiar/.test(wn)) { P.add('metal', cyl(0.035, 0.04, 0.55, 6), [x, y, 0.38], [1.57, 0, 0]).add('glow', ball(0.025, 5, 4), [x, y, 0.67]).add('accent', cyl(0.09, 0.09, 0.32, 7), [0, 0.8, -0.2]); z1 = 0.68; }
  else if (/machine gun|automatic|autocannon|gatling|lmg|hmg/.test(wn)) { P.add('metal', box(0.075, 0.09, 0.42), [x, y, 0.28]).add('metal', cyl(0.028, 0.028, 0.42, 6), [x, y + 0.01, 0.68], [1.57, 0, 0]).add('dark', cyl(0.085, 0.085, 0.05, 8), [x, y + 0.08, 0.3]); z1 = 0.9; }
  else if (/pistol|revolver|handgun/.test(wn)) { P.add('metal', box(0.03, 0.05, 0.17), [x, y + 0.02, 0.36]).add('dark', box(0.03, 0.08, 0.035), [x, y - 0.03, 0.3]); z1 = 0.45; }
  else if (/sniper|anti-mat|jezzail|long/.test(wn)) { P.add('dark', box(0.036, 0.055, 0.6), [x, y, 0.38]).add('metal', cyl(0.013, 0.013, 0.5, 5), [x, y + 0.01, 0.9], [1.57, 0, 0]).add('metal', cyl(0.02, 0.02, 0.2, 6), [x, y + 0.06, 0.42], [1.57, 0, 0]); z1 = 1.15; }
  else if (/launcher|mortar|bazooka|cannon|bombard|harpoon/.test(wn)) { P.add('metal', cyl(0.055, 0.055, 0.62, 7), [x, y + 0.03, 0.4], [1.57, 0, 0]); z1 = 0.72; }
  else if (/shotgun|blunderbuss|punt/.test(wn)) { P.add('dark', box(0.04, 0.06, 0.4), [x, y, 0.3]).add('metal', cyl(0.022, 0.03, 0.3, 6), [x, y + 0.01, 0.62], [1.57, 0, 0]); z1 = 0.78; }
  else { P.add('dark', box(0.035, 0.055, 0.52), [x, y, 0.34]).add('metal', cyl(0.012, 0.012, 0.3, 5), [x, y + 0.012, 0.72], [1.57, 0, 0]); z1 = 0.87; if (kit.some(k => /bayonet/i.test(k))) { P.add('steel', box(0.012, 0.022, 0.2), [x, y - 0.012, 0.95]); z1 = 1.0; } }
  return [x, y, z1];
}
function wings(P, kind) {
  for (const s of [-1, 1]) {
    if (kind === 'bat') { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.5, 0.62); sh.lineTo(0.92, 0.5); sh.lineTo(0.74, 0.16); sh.lineTo(0.8, -0.2); sh.lineTo(0.48, -0.04); sh.lineTo(0.42, -0.42); sh.lineTo(0.14, -0.14); sh.lineTo(0, -0.3);
      P.add('wing', new THREE.ShapeGeometry(sh), [s * 0.1, 0.95, -0.15], [0, s > 0 ? -0.35 : Math.PI + 0.35, 0]); P.stick('dark', V3(s * 0.1, 0.95, -0.15), V3(s * 0.55, 1.52, -0.32), 0.03, 0.012, 4); }
    else for (const a of [0.5, -0.1]) { const g = new THREE.CircleGeometry(0.5, 10); g.scale(1, 0.3, 1); g.translate(0.5, 0, 0); P.add('clear', g, [s * 0.08, 0.92, -0.14], [0, s > 0 ? -0.3 : Math.PI + 0.3, a * s * (s > 0 ? 1 : -1)]); }
  }
}

function humanoid(P, m, fid, n, R) {
  const big = /shrine|amalgam|desecrated saint|great maw|gregori|lord of tumours|sin eater|matagot/.test(n);
  const plate = big || /heavy|knight|communicant|janissary|corpse guard|silahdar|anointed|butcher|automaton|guardian|faris|executor|holy warrior|commando/.test(n) || m.kitArmour <= -2;
  const robed = /priest|prophet|cleric|nun|pilgrim|witch|sorcerer|warlock|hag|alchemist|chorister|monk|sister|castigator|dervish|prisoner|leper|lector|kaplan|sin eater|saint|praetor/.test(n);
  const hunched = /wretched|thrall|husk|ravenous|homunculus|leper|prisoner|bereaved|cradle|yoke/.test(n);
  const b = big ? 1.45 : plate ? 1.2 : hunched ? 0.92 : 1; const kit = m.kitNames || [];
  if (robed) P.add('cloth', cyl(0.15 * b, 0.28 * b, 0.58, 8), [0, 0.29, 0]);
  else { for (const s of [-1, 1]) P.add('dark', cyl(0.078 * b, 0.062 * b, 0.5, 6), [s * 0.095 * b, 0.27, s * 0.035]).add('dark', box(0.1 * b, 0.07, 0.2), [s * 0.095 * b, 0.035, s * 0.035 + 0.04]); P.add('cloth', cyl(0.175 * b, 0.26 * b, 0.27, 8, true), [0, 0.5, 0]); }
  P.add(plate ? 'metal' : 'cloth', cyl(0.2 * b, 0.165 * b, 0.42, 8), [0, 0.75, 0]).add('dark', cyl(0.176 * b, 0.176 * b, 0.05, 8), [0, 0.565, 0]);
  if (plate) for (const s of [-1, 1]) P.add('metal', ball(0.12 * b, 7, 5), [s * 0.245 * b, 0.92, 0]);
  if (fid === 'new_antioch' || fid === 'trench_pilgrims') { const c = fid === 'new_antioch' ? 'accent' : 'bone'; P.add(c, box(0.035, 0.2, 0.02), [0, 0.78, 0.19 * b]).add(c, box(0.13, 0.035, 0.02), [0, 0.82, 0.185 * b]); }   // the cross on the breast
  if (!robed && !plate) P.add('dark', box(0.24, 0.26, 0.11), [0, 0.76, -0.2]);                                                                                           // pack
  if (fid === 'black_grail' && (big || /knight|guard|husk/.test(n))) for (let i = 0; i < (big ? 7 : 3); i++) { const a = R() * 6.283; P.add('skin', ball(0.06 + R() * 0.07, 6, 5), [Math.cos(a) * 0.2 * b, 0.6 + R() * 0.4, Math.sin(a) * 0.2 * b]); }
  if (m.elite || m.leader) P.add(fid === 'court' || fid === 'heretic_legions' ? 'accent' : 'dark', new THREE.CylinderGeometry(0.22 * b, 0.36 * b, 0.86, 8, 1, true, Math.PI * 0.55, Math.PI * 0.9), [0, 0.52, -0.05]);   // cloak
  headgear(P, pickHead(fid, n, m), 1.07 + (big ? 0.03 : 0), R);
  if (m.leader) P.add('halo', new THREE.TorusGeometry(0.2, 0.02, 5, 22), [0, 1.13, -0.1]);

  // arms and weapons
  const sh = s => V3(s * 0.215 * b, 0.9, 0), arm = (a, c) => P.stick(plate ? 'metal' : 'cloth', a, c, 0.055 * b, 0.045 * b, 5).add('skin', ball(0.045, 5, 4), [c.x, c.y, c.z]);
  const rw = m.weapons.find(w => w.ranged && w.type !== 'Grenade'), mw = m.weapons.find(w => w.melee && !w.ranged) || m.weapons.find(w => w.melee);
  const natural = mw && mw.raw && mw.raw.natural, wn = mw ? mw.name.toLowerCase() : '', rn = rw ? rw.name.toLowerCase() : '';
  const smallGun = rw && /pistol|revolver|handgun/.test(rn), gunFirst = rw && !smallGun && (m.role !== 'melee' || !mw || natural);
  let muzzle = [0, 0.85, 0.3];
  if (gunFirst) { arm(sh(1), V3(0.1, 0.78, 0.26)); arm(sh(-1), V3(0.03, 0.8, 0.42)); muzzle = gun(P, rn, kit); if (mw && !natural) meleeWeapon(P, wn, V3(-0.2 * b, 0.62, -0.14), V3(0.15, 0.95, -0.25).normalize()); }
  else {
    const hand = V3(0.36 * b, 1.02, 0.14); arm(sh(1), hand); if (mw) meleeWeapon(P, wn, hand, V3(0.12, 0.93, 0.34).normalize());
    if (m.kitShield) { arm(sh(-1), V3(-0.26 * b, 0.74, 0.2)); P.add('metal', cyl(0.23, 0.23, 0.035, 10), [-0.27 * b, 0.74, 0.25], [1.57, 0, 0.2]).add('accent', ball(0.06, 6, 5), [-0.27 * b, 0.74, 0.28]); }
    else if (rw) { arm(sh(-1), V3(-0.12, 0.8, 0.3)); const g = new Parts(); muzzle = gun(g, rn, kit); P.addParts(g, [-0.2, 0, 0]); muzzle[0] -= 0.2; }
    else if (natural) { const h2 = V3(-0.36 * b, 0.98, 0.16); arm(sh(-1), h2); meleeWeapon(P, wn, h2, V3(-0.12, 0.9, 0.4).normalize()); }
    else arm(sh(-1), V3(-0.27 * b, 0.6, 0.06));
  }
  if (m.kw.has('FLYING')) wings(P, fid === 'black_grail' ? 'fly' : 'bat');
  return { h: (big ? 1.5 : 1.3) + (hunched ? -0.1 : 0), muzzle, lean: hunched ? 0.24 : 0 };
}

function beast(P, m, fid, n, R) {
  const art = m.kw.has('ARTIFICIAL') || /bull|lion|wolf|automaton/.test(n), hide = art ? 'metal' : fid === 'black_grail' ? 'skin' : 'dark';
  P.add(hide, cyl(0.21, 0.25, 0.82, 8), [0, 0.52, 0], [1.57, 0, 0]).add(hide, ball(0.25, 7, 5), [0, 0.56, 0.3]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.stick('dark', V3(sx * 0.15, 0.45, sz * 0.3), V3(sx * 0.17, 0.2, sz * 0.36 + 0.05), 0.07, 0.05, 5).stick('dark', V3(sx * 0.17, 0.2, sz * 0.36 + 0.05), V3(sx * 0.17, 0, sz * 0.33), 0.05, 0.04, 5);
  P.add(hide, ball(0.17, 7, 5), [0, 0.72, 0.6]).add(hide, cone(0.1, 0.3, 6), [0, 0.66, 0.82], [1.57, 0, 0]); for (const s of [-1, 1]) P.add('glow', ball(0.028, 5, 4), [s * 0.08, 0.76, 0.72]);
  P.stick('dark', V3(0, 0.55, -0.4), V3(0, 0.75, -0.72), 0.035, 0.01, 4);
  if (/bull/.test(n)) for (const s of [-1, 1]) P.stick('bone', V3(s * 0.12, 0.82, 0.6), V3(s * 0.34, 0.95, 0.7), 0.04, 0.03, 5).stick('bone', V3(s * 0.34, 0.95, 0.7), V3(s * 0.36, 1.12, 0.84), 0.03, 0.006, 5);
  else if (/lion/.test(n)) P.add('accent', cyl(0.27, 0.2, 0.2, 9), [0, 0.68, 0.45], [1.3, 0, 0]);
  else if (/locust/.test(n)) { wings(P, 'fly'); for (const s of [-1, 1]) P.stick('dark', V3(s * 0.15, 0.5, -0.3), V3(s * 0.42, 0.95, -0.5), 0.04, 0.03, 4).stick('dark', V3(s * 0.42, 0.95, -0.5), V3(s * 0.46, 0, -0.75), 0.03, 0.02, 4); }
  else for (let i = 0; i < 5; i++) P.add(art ? 'steel' : 'bone', cone(0.035, 0.2, 4), [0, 0.78, 0.3 - i * 0.16], [-0.4, 0, 0]);
  if (/wolf/.test(n)) P.add('glow', box(0.12, 0.02, 0.14), [0, 0.6, 0.86]);
  return { h: 0.95, muzzle: [0, 0.7, 0.95], lean: 0, long: true };
}

// The Anchorite Shrine: a reliquary that walks.
function shrine(P, m, fid, n, R) {
  for (const s of [-1, 1]) P.add('metal', box(0.16, 0.55, 0.2), [s * 0.2, 0.28, 0]).add('metal', box(0.2, 0.09, 0.3), [s * 0.2, 0.045, 0.04]);
  P.add('metal', box(0.66, 0.72, 0.5), [0, 0.92, 0]).add('cloth', cone(0.5, 0.42, 4), [0, 1.48, 0], [0, 0.785, 0]).add('accent', box(0.04, 0.34, 0.04), [0, 1.84, 0]).add('accent', box(0.2, 0.04, 0.04), [0, 1.9, 0]);
  P.add('glow', box(0.16, 0.24, 0.02), [0, 1.0, 0.255]).add('dark', box(0.03, 0.26, 0.03), [0, 1.0, 0.262]).add('dark', box(0.18, 0.03, 0.03), [0, 1.02, 0.262]);
  P.stick('metal', V3(0.36, 1.1, 0), V3(0.5, 0.8, 0.3), 0.08, 0.07, 6).stick('metal', V3(-0.36, 1.1, 0), V3(-0.5, 0.8, 0.3), 0.08, 0.07, 6);
  P.add('metal', cyl(0.06, 0.06, 0.6, 7), [0.5, 0.8, 0.55], [1.57, 0, 0]); meleeWeapon(P, 'hammer', V3(-0.5, 0.8, 0.3), V3(-0.1, 0.9, 0.4).normalize());
  return { h: 1.9, muzzle: [0.5, 0.8, 0.9], lean: 0 };
}

function buildFigure(m, fid) {
  const n = m.name.toLowerCase(), P = new Parts(); let seed = m.uid * 7919; const R = () => { seed = (seed * 16807 + 11) % 2147483647; return seed / 2147483647; };
  const kind = /shrine/.test(n) ? shrine : /wolf|hound|lion|bull|dog|locust/.test(n) ? beast : humanoid, info = kind(P, m, fid, n, R);
  const s = m.base >= 60 ? 1.65 : m.base >= 50 ? 1.45 : m.base >= 40 ? 1.26 : m.base >= 32 ? 1.1 : info.long ? 1.2 : 1;
  const mats = Object.assign({ halo: HALO }, matsFor(m.merc ? 'merc' : fid)), group = P.build(mats, list => mergeGeometries(list, false), { receive: false });
  group.scale.setScalar(s); group.rotation.x = info.lean; return { group, s, h: info.h * s, muzzle: info.muzzle.map(v => v * s), long: !!info.long };
}
const HALO = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 0.7), toneMapped: false });
const TOKEN = { blood: new THREE.Color(3.4, 0.22, 0.28), bless: new THREE.Color(3.2, 2.4, 0.7), infect: new THREE.Color(1.1, 3.2, 0.45), shaken: new THREE.Color(1.5, 1.5, 3.4) };

export class Minis {
  constructor(scene, view) {
    this.scene = scene; this.view = view; this.list = []; this.map = new Map(); this.group = new THREE.Group(); scene.add(this.group);
    this.baseMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.6 }); this.tokGeo = new THREE.SphereGeometry(0.075, 10, 8); this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.tokMat = {}; for (const k of Object.keys(TOKEN)) this.tokMat[k] = new THREE.MeshBasicMaterial({ color: TOKEN[k], toneMapped: false });
    this.ghost = new THREE.MeshStandardMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.3, depthWrite: false, flatShading: true });
    this.spot = new THREE.PointLight(0xffffff, 0, 9, 2); scene.add(this.spot);
  }
  clear() { for (const k of this.list) this.dropMini(k); this.list = []; this.map.clear(); this.spot.intensity = 0; }
  dropMini(k) { this.group.remove(k.root); k.root.traverse(o => { if (o.geometry && o.geometry !== this.tokGeo && o.geometry !== this.poolGeo) o.geometry.dispose(); }); k.ringMat.dispose(); k.rimMat.dispose(); }
  setGame(g) {
    this.clear(); this.game = g; const topCol = new THREE.Color(this.view.world.biome.gA).multiplyScalar(0.75);
    for (const m of g.models) {
      const fid = g.lists[m.side].faction, fig = buildFigure(m, fid), col = new THREE.Color(this.view.SIDE[m.side]);
      const root = new THREE.Group(), body = new THREE.Group(); body.add(fig.group); root.add(body);
      const oval = fig.long ? 1.75 : 1, base = new THREE.Mesh(new THREE.CylinderGeometry(m.r, m.r * 1.06, 0.09, 28), this.baseMat); base.position.y = 0.045; base.scale.z = oval; base.castShadow = base.receiveShadow = true; root.add(base);
      const top = new THREE.Mesh(new THREE.CircleGeometry(m.r * 0.93, 24), new THREE.MeshStandardMaterial({ color: topCol, roughness: 1 })); top.rotation.x = -Math.PI / 2; top.position.y = 0.092; top.scale.y = oval; top.receiveShadow = true; root.add(top);
      const rimMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.5), toneMapped: false }), rim = new THREE.Mesh(new THREE.TorusGeometry(m.r * 1.01, 0.032, 6, 36), rimMat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.06; rim.scale.y = oval; root.add(rim);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(m.r * 1.16, m.r * 1.5, 44), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.scale.y = oval; ring.visible = false; root.add(ring);
      // a pool of side-coloured light on the ground, so the two warbands read apart from across the table
      const pool = new THREE.Mesh(this.poolGeo, new THREE.MeshBasicMaterial({ map: softTexture(), color: col, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); pool.position.y = 0.05; pool.scale.setScalar(m.r * 5); pool.renderOrder = 2; root.add(pool);
      const toks = new THREE.Group(); root.add(toks);
      const zone = g.terrain.zones[m.side], yaw = Math.atan2(18 - (zone.x + zone.w / 2), 18 - (zone.y + zone.h / 2));
      const k = { m, root, body, fig, pool, ring, ringMat, rimMat, rim, toks, col, h: fig.h, yaw, yawT: yaw, y: null, px: 0, pz: 0, walk: 0, down: 0, dead: null, tokKey: '', hold: 0, ghosted: false, intro: Math.random() };
      this.group.add(root); this.list.push(k); this.map.set(m, k);
    }
  }
  anchor(m, f) { const k = this.map.get(m); if (!k) return m && m.x != null ? V3(wx(m.x), this.view.world.heightAt(m.x, m.y) + 1.3 * f, wz(m.y)) : V3(0, 1, 0); return V3(k.root.position.x, k.root.position.y + k.h * f, k.root.position.z); }
  muzzle(m) { const k = this.map.get(m); if (!k) return this.anchor(m, 0.6); const [mx, my, mz] = k.fig.muzzle, s = Math.sin(k.yawT), c = Math.cos(k.yawT); return V3(k.root.position.x + s * mz + c * mx, k.root.position.y + my, k.root.position.z + c * mz - s * mx); }
  face(m, t) { const k = this.map.get(m); if (!k || !t || t.x == null) return; const dx = t.x - m.x, dy = t.y - m.y; if (Math.hypot(dx, dy) < 1e-3) return; k.yawT = Math.atan2(dx, dy); k.hold = performance.now() + 2500; k.snap = true; }
  recoil(m) { const k = this.map.get(m); if (k) k.recoilT = performance.now(); }
  flinch(m) { const k = this.map.get(m); if (k) k.flinchT = performance.now(); }
  lunge(m, t) { const k = this.map.get(m); if (!k) return; const dx = t.x - m.x, dz = t.y - m.y, L = Math.hypot(dx, dz) || 1; k.lungeT = performance.now(); k.lx = dx / L; k.lz = dz / L; }
  // nearest model under a ray: each figure is tested as an upright capsule
  pick(ray) {
    let best = null, bt = 1e9;
    for (const k of this.list) { if (k.m.ooa) continue; _p0.copy(k.root.position); _p1.copy(_p0); _p1.y += k.h; const d2 = ray.distanceSqToSegment(_p0, _p1, _on), r = Math.max(k.m.r * 1.2, 0.5); if (d2 < r * r) { const t = ray.origin.distanceTo(_on); if (t < bt) { bt = t; best = k.m; } } }
    return best;
  }
  update(now, t, dt) {
    const UI = this.view.UI, W = this.view.world, g = this.game, sp = UI.speed; if (!g) return; let act = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const k = this.list[i], m = k.m, bx = m.vx != null ? m.vx : m.x, by = m.vy != null ? m.vy : m.y; let x = wx(bx), z = wz(by);
      if (m.ooa) { // topple, then sink into the mud
        if (k.dead == null) { k.dead = 0; k.ring.visible = false; k.toks.visible = false; k.pool.visible = false; }
        k.dead += dt * clamp(sp, 0.6, 3) / 1.1; const fall = Math.min(1, k.dead * 2.2), sink = clamp((k.dead - 0.75) / 0.75, 0, 1);
        k.body.rotation.x = -1.45 * (1 - Math.pow(1 - fall, 2)); k.body.position.y = 0.1 * fall; k.root.position.y = (k.y || 0) - sink * 0.7; k.root.scale.setScalar(1 - sink * 0.6);
        if (k.dead >= 1.5) { this.dropMini(k); this.list.splice(i, 1); this.map.delete(m); } continue;
      }
      if (k.lungeT) { const q = (now - k.lungeT) * sp / 300; if (q >= 1) k.lungeT = 0; else { const e = Math.sin(q * Math.PI) * 0.45; x += k.lx * e; z += k.lz * e; } }
      const gy = (m.h || 0) >= 3 ? 3.0 : W.heightAt(bx, by); k.y = k.y == null ? gy : lerp(k.y, gy, 1 - Math.exp(-dt * 12));
      const dx = x - k.px, dz = z - k.pz, moved = Math.hypot(dx, dz);
      if (m.moving && moved > 1e-4 && !k.lungeT) { k.yawT = Math.atan2(dx, dz); k.walk += moved * 7; k.hold = now + 600; }
      else if (now > k.hold && ((now / 900 | 0) + m.uid) % 3 === 0 && !k.scan) { // idle: turn toward the nearest enemy now and then
        k.scan = true; let bd = 1e9, bt = null; for (const o of g.models) if (!o.ooa && o.side !== m.side) { const d = Math.hypot(o.x - m.x, o.y - m.y); if (d < bd) { bd = d; bt = o; } } if (bt) k.yawT = Math.atan2(bt.x - m.x, bt.y - m.y);
      } else if (((now / 900 | 0) + m.uid) % 3 !== 0) k.scan = false;
      k.px = x; k.pz = z;
      let dy = k.yawT - k.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); k.yaw += dy * (1 - Math.exp(-dt * (k.snap ? 30 : 7))); if (Math.abs(dy) < 0.02) k.snap = false;
      k.down = lerp(k.down, m.down ? 1 : 0, 1 - Math.exp(-dt * 9));
      let rx = -k.down * 1.42, rz = m.moving ? Math.sin(k.walk) * 0.07 : 0, bob = m.moving ? Math.abs(Math.sin(k.walk)) * 0.07 : 0, fx = 0;
      if (k.recoilT) { const q = (now - k.recoilT) * sp / 260; if (q >= 1) k.recoilT = 0; else rx -= Math.sin(q * Math.PI) * 0.2; }
      if (k.flinchT) { const q = (now - k.flinchT) * sp / 320; if (q >= 1) k.flinchT = 0; else { fx = Math.sin(q * 40) * 0.05 * (1 - q); rz += Math.sin(q * 30) * 0.12 * (1 - q); } }
      k.root.position.set(x + fx, k.y, z); k.root.rotation.y = k.yaw; k.body.rotation.set(rx, 0, rz); k.body.position.y = bob + k.down * 0.12;
      k.fig.group.scale.y = k.fig.s * (1 + Math.sin(t * 1.6 + m.uid) * 0.012);
      const faded = !!m.flags.faded; if (faded !== k.ghosted) { k.ghosted = faded; k.fig.group.traverse(o => { if (o.isMesh) { if (faded) { o.userData.mat = o.material; o.material = this.ghost; } else if (o.userData.mat) o.material = o.userData.mat; o.castShadow = !faded; } }); }
      // selection ring
      let op = 0, c = k.col, sc = 1;
      if (UI.targets && UI.targets.has(m)) { op = 0.75 + 0.25 * Math.sin(t * 8); c = RED; sc = 1.05 + 0.05 * Math.sin(t * 8); }
      else if (UI.active === m) { op = 0.7 + 0.3 * Math.sin(t * 5); sc = 1.1; act = k; }
      else if (UI.pickable && UI.pickable.includes(m)) { op = 0.45 + 0.4 * Math.sin(t * 6); c = WHITE; }
      else if (UI.hover === m || this.view.hoverModel === m) op = 0.5;
      k.ring.visible = op > 0; if (op > 0) { k.ringMat.opacity = op; k.ringMat.color.copy(c).multiplyScalar(1.6); k.ring.scale.x = sc; k.ring.scale.y = sc * (k.fig.long ? 1.75 : 1); }
      k.rimMat.color.copy(k.col).multiplyScalar(m.activated && UI.active !== m && !g.over ? 0.55 : 1.5);
      // orbiting tokens
      const key = m.blood + ':' + m.bless + ':' + (m.infect || 0) + ':' + (g.shaken[m.side] ? 1 : 0);
      if (key !== k.tokKey) { k.tokKey = key; k.toks.clear(); const add = (kind, n) => { for (let j = 0; j < n; j++) k.toks.add(new THREE.Mesh(this.tokGeo, this.tokMat[kind])); }; add('blood', m.blood); add('bless', m.bless); add('infect', m.infect || 0); add('shaken', g.shaken[m.side] ? 1 : 0); }
      const n = k.toks.children.length; k.toks.rotation.y = -k.yaw;
      for (let j = 0; j < n; j++) { const a = t * (1.1 + (m.uid % 3) * 0.15) + j * 6.283 / n, r = m.r + 0.3 + Math.sin(t * 2 + j) * 0.05; k.toks.children[j].position.set(Math.cos(a) * r, k.h * 0.45 + Math.sin(t * 3 + j * 1.7) * 0.09, Math.sin(a) * r); }
    }
    if (act) { this.spot.position.set(act.root.position.x, act.root.position.y + act.h + 1.3, act.root.position.z); this.spot.color.copy(act.col).lerp(WHITE, 0.45); this.spot.intensity = 22 + 5 * Math.sin(t * 5); } else this.spot.intensity = 0;
  }
}
const RED = new THREE.Color(1, 0.22, 0.2), WHITE = new THREE.Color(1, 1, 1);
