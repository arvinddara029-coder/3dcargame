// =====================================================================
//  garage.js — playable cars. Smooth extruded side-profiles give real
//  silhouettes (hood rake, windshield, roofline, tail), plus a layered
//  greenhouse, fender flares, lights and spinning/steering wheels.
//  The Ferrari GLB joins the garage as the open-top SPIDER.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
function paint(geo, hex) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(hex);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function put(geo, x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (s = 16) => new THREE.SphereGeometry(1, s, s / 2);

// ---------------------------------------------------------------------
//  class parameter table (metres)
// ---------------------------------------------------------------------
export const CAR_LIST = [
  { id: 'SPIDER', name: 'SPIDER', tag: 'open-top V8 · GLB model', glb: true, vmax: 74, vmaxN: 94, steer: 1.05 },
  { id: 'VELOCE', name: 'VELOCE', tag: 'mid-engine coupe', vmax: 72, vmaxN: 92, steer: 1.05 },
  { id: 'MUSCLE', name: 'MUSCLE', tag: 'heavy V8 fastback', vmax: 68, vmaxN: 86, steer: 0.92 },
  { id: 'SEDAN', name: 'SEDAN', tag: 'executive saloon', vmax: 62, vmaxN: 78, steer: 0.95 },
  { id: 'RALLY', name: 'RALLY', tag: 'hot hatch AWD', vmax: 58, vmaxN: 74, steer: 1.15 },
  { id: 'TERRAIN', name: 'TERRAIN', tag: 'off-road SUV', vmax: 54, vmaxN: 68, steer: 0.88 },
];

const SPECS = {
  VELOCE: { L: 4.5, W: 1.94, hood: 0.62, belt: 0.86, roof: 1.16, rf: 0.15, rr: -1.35, tail: 'kamm', flare: 0.10, wr: 0.36, spoiler: 'lip' },
  MUSCLE: { L: 4.9, W: 1.96, hood: 0.78, belt: 1.02, roof: 1.34, rf: 0.35, rr: -1.55, tail: 'fast', flare: 0.14, wr: 0.38, spoiler: 'none' },
  SEDAN: { L: 4.8, W: 1.88, hood: 0.76, belt: 1.0, roof: 1.42, rf: 0.45, rr: -1.15, tail: 'notch', flare: 0.06, wr: 0.36, spoiler: 'none' },
  RALLY: { L: 4.2, W: 1.82, hood: 0.8, belt: 1.04, roof: 1.46, rf: 0.5, rr: -1.55, tail: 'hatch', flare: 0.12, wr: 0.37, spoiler: 'wing' },
  TERRAIN: { L: 4.85, W: 1.98, hood: 0.98, belt: 1.22, roof: 1.78, rf: 0.55, rr: -1.6, tail: 'hatch', flare: 0.16, wr: 0.45, spoiler: 'rack' },
};

// side profile in (z, y); extruded across width with a rounded bevel
function bodyProfile(s) {
  const { L, hood, belt, roof, rf, rr, tail } = s;
  const f = L / 2, r = -L / 2;
  const sh = new THREE.Shape();
  sh.moveTo(f - 0.12, 0.16);
  sh.lineTo(f, 0.34);                                  // nose face
  sh.quadraticCurveTo(f - 0.05, hood + 0.06, f - 0.55, hood);   // nose top -> hood
  sh.lineTo(rf + 0.35, hood + (belt - hood) * 0.25);   // hood rake
  sh.quadraticCurveTo(rf - 0.05, belt, rf - 0.25, belt);        // cowl -> beltline
  sh.lineTo(rr + 0.35, belt);                          // beltline
  if (tail === 'notch') {
    sh.quadraticCurveTo(rr + 0.3, belt + 0.06, rr + 0.25, belt + 0.02);
    sh.lineTo(r + 0.3, belt + 0.02);                   // trunk lid
    sh.quadraticCurveTo(r + 0.06, belt + 0.02, r, belt - 0.22); // tail panel
  } else if (tail === 'fast' || tail === 'kamm') {
    sh.quadraticCurveTo(rr + 0.1, belt + 0.04, r + 0.28, belt - (tail === 'kamm' ? 0.12 : 0.3));
    sh.quadraticCurveTo(r + 0.05, belt - (tail === 'kamm' ? 0.2 : 0.42), r, belt - 0.42);
  } else { // hatch
    sh.quadraticCurveTo(rr + 0.2, belt + 0.05, r + 0.16, belt - 0.1);
    sh.lineTo(r, belt - 0.4);
  }
  sh.lineTo(r, 0.2);
  sh.quadraticCurveTo(r + 0.2, 0.14, r + 0.5, 0.15);   // rear underside
  sh.lineTo(-f + 0.5, 0.15);
  sh.quadraticCurveTo(f - 0.3, 0.14, f - 0.12, 0.16);
  return sh;
}
function glassProfile(s) {
  const { belt, roof, rf, rr, tail } = s;
  const sh = new THREE.Shape();
  sh.moveTo(rf + 0.28, belt + 0.01);
  sh.quadraticCurveTo(rf - 0.1, roof - 0.02, rf - 0.45, roof);      // windshield
  sh.lineTo(rr + 0.5, roof);                                        // roof line
  if (tail === 'notch') sh.quadraticCurveTo(rr + 0.32, roof - 0.06, rr + 0.28, belt + 0.03);
  else if (tail === 'hatch') sh.quadraticCurveTo(rr + 0.16, roof - 0.1, rr + 0.1, belt + 0.02);
  else sh.quadraticCurveTo(rr + 0.05, roof - 0.12, rr - 0.05, belt + 0.02);
  sh.lineTo(rf + 0.28, belt + 0.01);
  return sh;
}
function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1, curveSegments: 10,
  });
  // extrude runs along +Z of the shape plane; shape is (z,y) so rotate: shape X->world Z, extrude Z->world X
  g.rotateY(Math.PI / 2);
  g.translate(-width / 2 + bevel, 0, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------
const shared = {
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1622, roughness: 0.07, metalness: 0.55, transparent: true, opacity: 0.85 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xe8eef2, emissive: 0xfff2c4, emissiveIntensity: 1.6, roughness: 0.2 }),
};
const cache = new Map();

function bakePlayable(id) {
  if (cache.has(id)) return cache.get(id);
  const s = SPECS[id];
  const P = [], T = [], G = [];
  const W = s.W;
  P.push(extrude(bodyProfile(s), W, 0.09));
  // greenhouse glass + painted roof cap
  G.push(extrude(glassProfile(s), W * 0.86, 0.05));
  {
    const { roof, rf, rr } = s;
    const capLen = Math.abs(rf - 0.45 - (rr + 0.5)) + 0.12;
    const cap = box(W * 0.88, 0.12, capLen);
    P.push(put(cap, 0, roof + 0.02, (rf - 0.45 + rr + 0.5) / 2));
  }
  // fender flares over the wheels
  const wz = [s.L / 2 - 0.95, -s.L / 2 + 0.95];
  for (const z of wz) for (const sx of [-1, 1]) {
    const fl = new THREE.TorusGeometry(s.wr + 0.05 + s.flare * 0.5, 0.07 + s.flare * 0.3, 8, 14, Math.PI);
    fl.rotateY(Math.PI / 2);
    P.push(put(fl, sx * (s.W / 2 - 0.05), s.wr, z));
  }
  // bumpers, grille, lights, mirrors, sill
  T.push(paint(put(box(W * 0.98, 0.24, 0.3), 0, 0.34, s.L / 2 - 0.06), '#1b1e22'));
  T.push(paint(put(box(W * 0.98, 0.26, 0.3), 0, 0.36, -s.L / 2 + 0.06), '#1b1e22'));
  T.push(paint(put(box(W * 0.5, 0.14, 0.06), 0, 0.52, s.L / 2 + 0.02), '#101214'));
  T.push(paint(put(box(W * 0.9, 0.06, W), 0, 0.14, 0), '#0c0e10'));            // undertray
  T.push(paint(put(box(0.3, 0.14, 0.04), 0, 0.44, -s.L / 2 - 0.02), '#e8e8e8')); // plate
  for (const sx of [-1, 1]) {
    T.push(paint(put(box(0.05, 0.05, 0.2), sx * (W / 2 + 0.06), s.belt + 0.06, s.L * 0.18), '#15181b'));
    T.push(paint(put(box(0.2, 0.12, 0.05), sx * (W / 2 + 0.16), s.belt + 0.09, s.L * 0.22), '#15181b'));
    if (s.spoiler === 'rack') T.push(paint(put(box(W * 0.7, 0.05, s.L * 0.5), 0, s.roof + 0.1, -s.L * 0.15), '#22262a'));
    if (s.spoiler === 'wing') { P.push(put(box(W * 0.8, 0.05, 0.28), 0, s.belt + 0.34, -s.L / 2 + 0.15)); for (const q of [-1, 1]) P.push(put(box(0.06, 0.3, 0.2), q * W * 0.3, s.belt + 0.2, -s.L / 2 + 0.15)); }
    if (s.spoiler === 'lip') P.push(put(box(W * 0.76, 0.05, 0.2), 0, s.belt - 0.34, -s.L / 2 + 0.05));
  }
  const H = [], B = [];
  for (const sx of [-1, 1]) {
    H.push(paint(put(box(0.5, 0.13, 0.08), sx * W * 0.3, s.hood - 0.06, s.L / 2 - 0.02), '#ffffff'));
    B.push(paint(put(box(0.46, 0.13, 0.08), sx * W * 0.32, s.belt - 0.12, -s.L / 2 + 0.02), '#ffffff'));
  }
  // exhaust tips
  for (const sx of [-1, 1]) T.push(paint(put(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10).rotateX(Math.PI / 2), sx * W * 0.28, 0.26, -s.L / 2 - 0.05), '#9aa2a8'));

  const merge = (list, tag) => {
    if (!list.length) return null;
    // extrude geos are non-indexed while primitives are indexed — unify
    const unified = list.map(g => (g.index ? g.toNonIndexed() : g));
    const ok = mergeGeometries(unified, false);
    if (!ok) console.warn('garage merge failed:', id, tag);
    return ok;
  };
  // wheels
  const tire = paint(put(new THREE.CylinderGeometry(s.wr, s.wr, 0.3, 18).rotateZ(Math.PI / 2), 0, 0, 0), '#0b0d10');
  const rim = paint(put(new THREE.CylinderGeometry(s.wr * 0.6, s.wr * 0.6, 0.32, 12).rotateZ(Math.PI / 2), 0, 0, 0), '#a8b0b6');
  const spokes = [];
  for (let k = 0; k < 5; k++) spokes.push(paint(put(box(0.34, s.wr * 0.16, s.wr * 0.9), 0, 0, 0, 1, 1, 1, k * Math.PI / 2.5), '#c8d0d6'));
  const wheelGeo = mergeGeometries([tire, rim, ...spokes], false);
  const baked = {
    paintGeo: merge(P, 'paint'), trimGeo: merge(T, 'trim'), glassGeo: merge(G, 'glass'),
    headGeo: merge(H, 'head'), brakeGeo: merge(B, 'brake'), wheelGeo,
    wheelPos: [[-W / 2 + 0.08, wz[0]], [W / 2 - 0.08, wz[0]], [-W / 2 + 0.08, wz[1]], [W / 2 - 0.08, wz[1]]],
    wr: s.wr, halfL: s.L / 2, halfW: W / 2,
  };
  cache.set(id, baked);
  return baked;
}

// Public: same rig interface as the GLB wrapper in game.js
export function buildPlayableCar(id, color) {
  const meta = CAR_LIST.find(c => c.id === id) || CAR_LIST[1];
  const b = bakePlayable(meta.glb ? 'VELOCE' : meta.id);
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x330505, emissive: 0xff2020, emissiveIntensity: 0.2, roughness: 0.4 });
  const add = (geo, mat) => { if (!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = true; root.add(m); };
  add(b.paintGeo, bodyMat); add(b.trimGeo, shared.trim); add(b.glassGeo, shared.glass);
  add(b.headGeo, shared.head); add(b.brakeGeo, brakeMat);
  const wheels = [];
  for (const [x, z] of b.wheelPos) {
    const w = new THREE.Group(); w.position.set(x, b.wr, z);
    const m = new THREE.Mesh(b.wheelGeo, shared.wheel); m.castShadow = true;
    w.add(m); root.add(w); wheels.push(w);
  }
  const car = {
    root, wheels, glb: false, halfL: b.halfL, halfW: b.halfW,
    vmax: meta.vmax, vmaxN: meta.vmaxN, steer: meta.steer, id: meta.id,
    setBodyColor: c => bodyMat.color.set(c),
    setBrake: on => { brakeMat.emissiveIntensity = on ? 3.2 : 0.2; },
    setHead: on => { /* shared head mat stays lit */ },
  };
  car.setBodyColor(color);
  return car;
}
