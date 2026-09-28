// =====================================================================
//  fleet.js — realistic traffic vehicles.
//  Each class is baked once into a handful of merged geometries
//  (paint / trim / glass / lights / wheel), so a vehicle costs ~8 draw
//  calls while still reading as a real car: clearcoat paint, tinted
//  greenhouse, mirrors, light bars, plates, steel wheels.
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
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = () => new THREE.SphereGeometry(1, 18, 12);
const cyl = (r, h, s = 12) => new THREE.CylinderGeometry(r, r, h, s);

// ---------------------------------------------------------------------
//  shared materials
// ---------------------------------------------------------------------
export const fleetMats = {
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1622, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.82 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.25 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, emissive: 0xfff2c4, emissiveIntensity: 1.5, roughness: 0.2 }),
};
const PAINT_COLORS = ['#dfe3e6', '#101418', '#8d949b', '#20406e', '#6e1414', '#2c4a34', '#4a4e55', '#7a5a2a', '#1d5fa8', '#5e6066'];

// ---------------------------------------------------------------------
//  class geometry baking
// ---------------------------------------------------------------------
const cache = new Map();

function bakeWheels(spec) {
  const { wr, ww, positions } = spec;
  const tire = paint(put(cyl(wr, ww, 18).rotateZ(Math.PI / 2), 0, 0, 0), '#0b0d10');
  const rim = paint(put(cyl(wr * 0.58, ww + 0.02, 12).rotateZ(Math.PI / 2), 0, 0, 0), '#9aa2a8');
  const hub = paint(put(cyl(wr * 0.18, ww + 0.04, 8).rotateZ(Math.PI / 2), 0, 0, 0), '#3c4145');
  const g = mergeGeometries([tire, rim, hub]);
  return { geo: g, positions };
}

function bakeClass(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const P = [], T = [], G = [], H = [], B = [];   // paint, trim, glass, head, brake
  let L, W, halfL, halfW, truck = false;
  const wheelsSpec = { wr: 0.36, ww: 0.26, positions: [[-0.82, 1.42], [0.82, 1.42], [-0.82, -1.42], [0.82, -1.42]] };

  const mirrors = (y, x) => {
    for (const s of [-1, 1]) {
      T.push(paint(put(box(0.06, 0.06, 0.22), s * (x + 0.1), y, 0.1), '#15181b'));
      T.push(paint(put(box(0.22, 0.14, 0.06), s * (x + 0.24), y + 0.03, 0.16), '#15181b'));
    }
  };
  const lightBar = (z, list, w, h) => {
    for (const s of [-1, 1]) list.push(paint(put(box(w, h, 0.06), s * (W * 0.32), 0.78, z), '#ffffff'));
  };

  if (kind === 'sedan' || kind === 'hatch') {
    L = kind === 'sedan' ? 4.6 : 4.15; W = 1.82; halfL = L / 2; halfW = W / 2;
    const zc = kind === 'sedan' ? 0.1 : -0.12;
    P.push(put(box(W, 0.62, L * 0.96), 0, 0.66, 0));                       // main body
    P.push(put(sph(), 0, 0.95, L * 0.30, W * 0.48, 0.30, L * 0.20));       // hood swell
    P.push(put(sph(), 0, 0.92, -L * 0.34, W * 0.48, 0.30, L * (kind === 'sedan' ? 0.20 : 0.26))); // rear deck
    P.push(put(box(W * 0.88, 0.14, L * 0.42), 0, 1.42, zc - L * 0.06));    // roof
    G.push(put(sph(), 0, 1.16, zc - L * 0.04, W * 0.45, 0.40, L * 0.30));  // greenhouse
    T.push(paint(put(box(W * 0.98, 0.22, 0.24), 0, 0.46, L * 0.49), '#22262a'));   // bumpers
    T.push(paint(put(box(W * 0.98, 0.22, 0.24), 0, 0.46, -L * 0.49), '#22262a'));
    T.push(paint(put(box(W * 0.5, 0.16, 0.05), 0, 0.62, L * 0.505, 1, 1, 1), '#15181b'));   // grille
    T.push(paint(put(box(0.34, 0.16, 0.03), 0, 0.5, -L * 0.505), '#e8e8e8'));     // plate
    mirrors(1.06, W / 2);
    lightBar(L * 0.5, H, 0.42, 0.14);
    for (const s of [-1, 1]) B.push(paint(put(box(0.44, 0.14, 0.06), s * (W * 0.33), 0.86, -L * 0.5), '#ffffff'));
  } else if (kind === 'suv') {
    L = 4.8; W = 1.92; halfL = L / 2; halfW = W / 2;
    wheelsSpec.wr = 0.42; wheelsSpec.positions = [[-0.88, 1.5], [0.88, 1.5], [-0.88, -1.5], [0.88, -1.5]];
    P.push(put(box(W, 0.78, L * 0.96), 0, 0.78, 0));
    P.push(put(sph(), 0, 1.12, L * 0.32, W * 0.48, 0.30, L * 0.18));
    P.push(put(box(W * 0.92, 0.62, L * 0.52), 0, 1.48, -L * 0.12));        // tall cabin
    P.push(put(box(W * 0.8, 0.06, L * 0.44), 0, 1.82, -L * 0.12));         // roof rack
    G.push(put(box(W * 0.86, 0.44, L * 0.46), 0, 1.44, -L * 0.13));
    G.push(put(sph(), 0, 1.34, L * 0.24, W * 0.44, 0.34, L * 0.14));       // windscreen
    T.push(paint(put(box(W, 0.26, 0.28), 0, 0.5, L * 0.49), '#22262a'));
    T.push(paint(put(box(W, 0.26, 0.28), 0, 0.5, -L * 0.49), '#22262a'));
    T.push(paint(put(box(W * 0.55, 0.2, 0.05), 0, 0.86, L * 0.505), '#22262a'));
    T.push(paint(put(box(0.34, 0.16, 0.03), 0, 0.56, -L * 0.505), '#e8e8e8'));
    mirrors(1.24, W / 2);
    lightBar(L * 0.5, H, 0.44, 0.16);
    for (const s of [-1, 1]) B.push(paint(put(box(0.4, 0.3, 0.06), s * (W * 0.34), 1.16, -L * 0.5), '#ffffff'));
  } else if (kind === 'pickup') {
    L = 5.2; W = 1.94; halfL = L / 2; halfW = W / 2;
    wheelsSpec.wr = 0.42; wheelsSpec.positions = [[-0.9, 1.62], [0.9, 1.62], [-0.9, -1.66], [0.9, -1.66]];
    P.push(put(box(W, 0.74, L * 0.98), 0, 0.74, 0));
    P.push(put(box(W * 0.9, 0.6, L * 0.34), 0, 1.42, L * 0.22));           // cab
    G.push(put(box(W * 0.84, 0.44, L * 0.3), 0, 1.4, L * 0.2));
    G.push(put(sph(), 0, 1.3, L * 0.4, W * 0.42, 0.3, L * 0.1));
    T.push(paint(put(box(W * 0.86, 0.5, L * 0.4), 0, 1.16, -L * 0.26), '#1a1d20')); // bed cavity
    P.push(put(box(W * 0.06, 0.34, L * 0.42), -W * 0.47, 1.28, -L * 0.26));  // bed walls
    P.push(put(box(W * 0.06, 0.34, L * 0.42), W * 0.47, 1.28, -L * 0.26));
    P.push(put(box(W * 0.94, 0.34, 0.06), 0, 1.28, -L * 0.47));
    T.push(paint(put(box(W, 0.26, 0.28), 0, 0.5, L * 0.5), '#22262a'));
    T.push(paint(put(box(W, 0.26, 0.28), 0, 0.5, -L * 0.5), '#22262a'));
    T.push(paint(put(box(0.34, 0.16, 0.03), 0, 0.56, -L * 0.51), '#e8e8e8'));
    mirrors(1.3, W / 2);
    lightBar(L * 0.5, H, 0.44, 0.16);
    for (const s of [-1, 1]) B.push(paint(put(box(0.36, 0.3, 0.06), s * (W * 0.36), 1.14, -L * 0.5), '#ffffff'));
  } else if (kind === 'van') {
    L = 5.4; W = 2.02; halfL = L / 2; halfW = W / 2; truck = true;
    wheelsSpec.wr = 0.4; wheelsSpec.positions = [[-0.92, 1.7], [0.92, 1.7], [-0.92, -1.8], [0.92, -1.8]];
    P.push(put(box(W, 1.62, L * 0.94), 0, 1.34, -L * 0.06));               // cargo box
    P.push(put(sph(), 0, 1.1, L * 0.4, W * 0.49, 0.62, L * 0.14));         // sloped nose
    G.push(put(sph(), 0, 1.42, L * 0.36, W * 0.45, 0.5, L * 0.12));        // windscreen
    T.push(paint(put(box(W, 0.28, 0.3), 0, 0.5, L * 0.48), '#22262a'));
    T.push(paint(put(box(W, 0.28, 0.3), 0, 0.5, -L * 0.5), '#22262a'));
    T.push(paint(put(box(W * 0.5, 0.22, 0.05), 0, 0.8, L * 0.5), '#22262a'));
    mirrors(1.5, W / 2);
    lightBar(L * 0.48, H, 0.4, 0.18);
    for (const s of [-1, 1]) B.push(paint(put(box(0.3, 0.5, 0.06), s * (W * 0.4), 1.5, -L * 0.5), '#ffffff'));
  } else if (kind === 'semi') {
    L = 16.4; W = 2.55; halfL = L / 2; halfW = W / 2; truck = true;
    wheelsSpec.wr = 0.52; wheelsSpec.ww = 0.34;
    wheelsSpec.positions = [[-1.05, 5.6], [1.05, 5.6], [-1.05, 3.5], [1.05, 3.5], [-1.1, -1.6], [1.1, -1.6], [-1.1, -3.0], [1.1, -3.0], [-1.1, -4.4], [1.1, -4.4]];
    P.push(put(box(W * 0.94, 2.1, 2.4), 0, 1.7, L * 0.5 - 1.5));           // cab
    P.push(put(box(W * 0.9, 0.5, 1.0), 0, 3.0, L * 0.5 - 2.4));          // cab roof fairing
    G.push(put(box(W * 0.82, 0.8, 0.08), 0, 2.1, L * 0.5 - 0.28));         // windscreen
    T.push(paint(put(box(W * 0.9, 0.5, 0.4), 0, 0.62, L * 0.5 - 0.1), '#22262a'));// bumper
    T.push(paint(put(box(W * 0.6, 0.5, 0.1), 0, 1.1, L * 0.5 - 0.28), '#3a3f44'));// grille
    T.push(paint(put(box(W * 0.96, 2.9, 11.6), 0, 2.0, -L * 0.5 + 6.2), '#c9ced2')); // trailer
    T.push(paint(put(box(W * 0.98, 0.16, 11.6), 0, 0.62, -L * 0.5 + 6.2), '#22262a')); // skirt
    for (const s of [-1, 1]) T.push(paint(put(cyl(0.09, 1.6, 8), s * (W * 0.42), 2.4, L * 0.5 - 3.1), '#8d949b')); // stacks
    H.push(paint(put(box(W * 0.7, 0.24, 0.08), 0, 0.95, L * 0.5 - 0.24), '#ffffff'));
    for (const s of [-1, 1]) B.push(paint(put(box(0.5, 0.34, 0.08), s * (W * 0.4), 1.1, -L * 0.5 + 0.42), '#ffffff'));
    for (const s of [-1, 1]) B.push(paint(put(box(0.16, 0.16, 0.08), s * (W * 0.46), 3.3, L * 0.5 - 0.4), '#ffffff'));
  } else { // bus
    L = 11.6; W = 2.55; halfL = L / 2; halfW = W / 2; truck = true;
    wheelsSpec.wr = 0.5; wheelsSpec.positions = [[-1.05, 3.6], [1.05, 3.6], [-1.05, -3.8], [1.05, -3.8]];
    P.push(put(box(W, 2.5, L * 0.97), 0, 1.85, 0));
    G.push(put(box(W * 0.99, 0.95, L * 0.86), 0, 2.35, -0.2));             // window band
    G.push(put(box(W * 0.92, 1.0, 0.06), 0, 2.2, L * 0.487));              // windscreen
    T.push(paint(put(box(W, 0.4, 0.35), 0, 0.55, L * 0.49), '#22262a'));
    T.push(paint(put(box(W, 0.4, 0.35), 0, 0.55, -L * 0.49), '#22262a'));
    T.push(paint(put(box(W * 0.99, 0.5, L * 0.9), 0, 0.85, 0), '#2b3138'));       // lower cladding
    H.push(paint(put(box(W * 0.72, 0.22, 0.08), 0, 1.15, L * 0.49), '#ffffff'));
    for (const s of [-1, 1]) B.push(paint(put(box(0.4, 0.4, 0.08), s * (W * 0.4), 1.2, -L * 0.49), '#ffffff'));
  }

  const merge = (list, tag) => {
    if (!list.length) return null;
    const ok = mergeGeometries(list, false);
    if (!ok) console.log('MERGE FAIL', kind, tag, list.map(g => Object.keys(g.attributes).join('+')).join(' | '));
    return ok;
  };
  const baked = {
    paintGeo: merge(P, 'paint'), trimGeo: merge(T, 'trim'), glassGeo: merge(G, 'glass'), headGeo: merge(H, 'head'), brakeGeo: merge(B, 'brake'),
    wheels: bakeWheels(wheelsSpec), halfL, halfW, truck,
  };
  cache.set(kind, baked);
  return baked;
}

const KINDS = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'pickup', 'van'];
const HEAVY = ['semi', 'semi', 'bus'];

// Public factory — same interface the game's traffic update expects.
export function makeTrafficVehicle(preferHeavy = false) {
  const kind = preferHeavy ? HEAVY[(Math.random() * HEAVY.length) | 0] : KINDS[(Math.random() * KINDS.length) | 0];
  const b = bakeClass(kind);
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: PAINT_COLORS[(Math.random() * PAINT_COLORS.length) | 0],
    metalness: 0.82, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.12,
  });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x330505, emissive: 0xff2020, emissiveIntensity: 0.15, roughness: 0.4 });
  const add = (geo, mat) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = true; root.add(m); return m; };
  add(b.paintGeo, bodyMat);
  add(b.trimGeo, fleetMats.trim);
  add(b.glassGeo, fleetMats.glass);
  add(b.headGeo, fleetMats.head);
  add(b.brakeGeo, brakeMat);
  const wheels = [];
  for (const [x, z] of b.wheels.positions) {
    const w = new THREE.Group();
    w.position.set(x, b.wheels.wr, z);
    const m = new THREE.Mesh(b.wheels.geo, fleetMats.wheel);
    m.castShadow = true;
    w.add(m); root.add(w); wheels.push(w);
  }
  // soft contact shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(b.halfW * 2.5, b.halfL * 2.2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; sh.renderOrder = 1;
  root.add(sh);
  return { root, wheels, brakeMat, bodyMat, halfL: b.halfL, halfW: b.halfW, truck: b.truck, kind };
}
