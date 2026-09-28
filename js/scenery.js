// =====================================================================
//  scenery.js — living roadside: mixed forest, grass tufts, rocks,
//  curved-arm street lamps with warm light pools, speed/chevron/route
//  signs, kilometre posts and billboards. Everything is instanced and
//  recycled around the player, exactly like the original tree system.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { speedSignTexture, chevronSignTexture, gantrySignTexture, billboardTexture, lightPoolTexture, tuftTexture } from './assets.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(),
  _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler();

function instanced(geo, mat, count, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.castShadow = shadow;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return im;
}
function park(im, i, x, y, z, ry, sx, sy = sx, sz = sx) {
  _p.set(x, y, z); _q.setFromAxisAngle(_up, ry); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s); im.setMatrixAt(i, _m); im.instanceMatrix.needsUpdate = true;
}

export function initScenery(scene, road, LOW) {
  const S = { systems: [] };

  // ---------------------------------------------------------------- trees
  const TREES = LOW ? 150 : 260;
  const species = [];
  {
    // pine: layered cones
    let g = [];
    for (let k = 0; k < 3; k++) { const c = new THREE.ConeGeometry(2.1 - k * 0.55, 3.4, 7); c.translate(0, 3.4 + k * 2.1, 0); g.push(c); }
    species.push({ top: mergeGeometries(g, false), trunkH: 3.2, h: 10 });
    // broadleaf: clustered blobs
    g = [];
    for (let k = 0; k < 3; k++) { const s = new THREE.IcosahedronGeometry(2.3 - k * 0.4, 1); s.translate((k - 1) * 1.1, 5.2 + (k % 2) * 1.4, (k - 1) * 0.7); g.push(s); }
    species.push({ top: mergeGeometries(g, false), trunkH: 3.6, h: 9 });
    // birch: slim tall crown
    g = [];
    for (let k = 0; k < 2; k++) { const s = new THREE.IcosahedronGeometry(1.5 - k * 0.4, 1); s.scale(1, 1.9, 1); s.translate(0, 5.6 + k * 2.2, 0); g.push(s); }
    species.push({ top: mergeGeometries(g, false), trunkH: 4.2, h: 9.5 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 4, 6); trunkGeo.translate(0, 2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4028', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const treeSets = species.map(sp => {
    const trunks = instanced(trunkGeo, trunkMat, TREES);
    const tops = instanced(sp.top, leafMat, TREES);
    tops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREES * 3), 3);
    scene.add(trunks, tops);
    const data = Array.from({ length: TREES }, () => ({ z: -1e9 }));
    S.systems.push({ data, place: (i, z) => {
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = side * (16 + Math.pow(Math.random(), 1.7) * 190);
      const x = road.x(z) + off;
      const sc = 0.7 + Math.random() * 1.1;
      park(trunks, i, x, road.terrainY(x, z) - 0.25, z, Math.random() * 6, sc, sc * (0.85 + Math.random() * 0.5));
      park(tops, i, x, road.terrainY(x, z) - 0.25, z, Math.random() * 6, sc, sc * (0.85 + Math.random() * 0.5));
      _c.setHSL(0.24 + Math.random() * 0.1, 0.42 + Math.random() * 0.2, 0.16 + Math.random() * 0.14);
      tops.setColorAt(i, _c); tops.instanceColor.needsUpdate = true;
    } });
    return data;
  });

  // ------------------------------------------------- bushes / rocks / tufts
  const BUSH = LOW ? 70 : 150;
  const bushGeo = new THREE.IcosahedronGeometry(1, 1); bushGeo.scale(1, 0.7, 1);
  const bushMesh = instanced(bushGeo, leafMat, BUSH);
  bushMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BUSH * 3), 3);
  scene.add(bushMesh);
  const bushData = Array.from({ length: BUSH }, () => ({ z: -1e9 }));
  S.systems.push({ data: bushData, place: (i, z) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = road.x(z) + side * (14.5 + Math.pow(Math.random(), 1.4) * 40);
    const sc = 0.6 + Math.random() * 1.4;
    park(bushMesh, i, x, road.terrainY(x, z) + 0.25 * sc, z, Math.random() * 6, sc);
    _c.setHSL(0.22 + Math.random() * 0.12, 0.4, 0.14 + Math.random() * 0.12);
    bushMesh.setColorAt(i, _c); bushMesh.instanceColor.needsUpdate = true;
  } });

  const ROCK = LOW ? 30 : 70;
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = instanced(rockGeo, new THREE.MeshStandardMaterial({ color: '#7d7f82', roughness: 0.95, flatShading: true }), ROCK);
  rockMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ROCK * 3), 3);
  scene.add(rockMesh);
  const rockData = Array.from({ length: ROCK }, () => ({ z: -1e9 }));
  S.systems.push({ data: rockData, place: (i, z) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = road.x(z) + side * (15 + Math.pow(Math.random(), 1.3) * 90);
    const sc = 0.4 + Math.random() * 1.8;
    park(rockMesh, i, x, road.terrainY(x, z) + sc * 0.3, z, Math.random() * 6, sc, sc * (0.6 + Math.random() * 0.5), sc);
    _c.setHSL(0.08 + Math.random() * 0.05, 0.06, 0.3 + Math.random() * 0.25);
    rockMesh.setColorAt(i, _c); rockMesh.instanceColor.needsUpdate = true;
  } });

  const TUFT = LOW ? 220 : 520;
  const q1 = new THREE.PlaneGeometry(0.9, 0.8); q1.translate(0, 0.4, 0);
  const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
  const tuftGeo = mergeGeometries([q1, q2], false);
  const tuftMat = new THREE.MeshStandardMaterial({ map: tuftTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
  const tuftMesh = instanced(tuftGeo, tuftMat, TUFT, false);
  scene.add(tuftMesh);
  const tuftData = Array.from({ length: TUFT }, () => ({ z: -1e9 }));
  S.systems.push({ data: tuftData, place: (i, z) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = road.x(z) + side * (13.4 + Math.pow(Math.random(), 1.2) * 7);
    park(tuftMesh, i, x, road.terrainY(x, z) - 0.05, z, Math.random() * 6, 0.8 + Math.random() * 0.9);
  } });

  // ---------------------------------------------------------- street lamps
  const LAMPS = LOW ? 18 : 30;
  {
    const pole = new THREE.CylinderGeometry(0.09, 0.16, 8.4, 8); pole.translate(0, 4.2, 0);
    const arm1 = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6); arm1.rotateZ(Math.PI / 2.6); arm1.translate(-0.85, 8.5, 0);
    const head = new THREE.BoxGeometry(1.0, 0.16, 0.42); head.translate(-1.85, 9.05, 0);
    const base = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8); base.translate(0, 0.25, 0);
    const lampGeo = mergeGeometries([pole, arm1, head, base], false);
    S.lampMesh = instanced(lampGeo, new THREE.MeshStandardMaterial({ color: '#4d5459', metalness: 0.75, roughness: 0.4 }), LAMPS);
    scene.add(S.lampMesh);
    // glowing head + light pool on the tarmac
    const glowGeo = new THREE.PlaneGeometry(0.86, 0.34); glowGeo.rotateX(Math.PI / 2); glowGeo.translate(-1.85, 8.94, 0);
    S.lampGlow = instanced(glowGeo, new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }), LAMPS, false);
    scene.add(S.lampGlow);
    const poolGeo = new THREE.PlaneGeometry(9, 13); poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
    S.poolMesh = instanced(poolGeo, poolMat, LAMPS, false);
    S.poolMesh.renderOrder = 2;
    scene.add(S.poolMesh);
  }
  const lampData = Array.from({ length: LAMPS }, () => ({ z: -1e9 }));
  S.systems.push({ data: lampData, place: (i, z) => {
    const side = (Math.round(z / 60) % 2) ? 1 : -1;
    const x = road.x(z) + side * 14.4, y = road.y(z);
    const ry = side > 0 ? 0 : Math.PI;
    park(S.lampMesh, i, x, y, z, ry, 1);
    park(S.lampGlow, i, x, y, z, ry, 1);
    // pool lies flat on the road, slightly toward the lamp side
    const px = road.x(z) + side * 9.5;
    _p.set(px, road.y(z) + 0.06, z);
    _e.set(-Math.atan(road.dy(z)), Math.atan(road.dx(z)), 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s); S.poolMesh.setMatrixAt(i, _m); S.poolMesh.instanceMatrix.needsUpdate = true;
  }, fixed: 60 });

  // ------------------------------------------------------------------ signs
  const postMat = new THREE.MeshStandardMaterial({ color: '#8f979c', metalness: 0.7, roughness: 0.45 });
  const mkSign = (texW, texH, tex, count, postCount = count) => {
    const panel = instanced(new THREE.PlaneGeometry(texW, texH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }), count, false);
    const post = instanced(new THREE.CylinderGeometry(0.06, 0.06, texH + 1.2, 6), postMat, postCount);
    scene.add(panel, post);
    return { panel, post };
  };
  // speed limit signs
  const SPD = 6;
  const spd = mkSign(0.9, 1.15, speedSignTexture(), SPD);
  const spdData = Array.from({ length: SPD }, () => ({ z: -1e9 }));
  S.systems.push({ data: spdData, place: (i, z) => {
    const side = 1; const x = road.x(z) + side * 14.9, y = road.y(z);
    park(spd.panel, i, x, y + 2.1, z, Math.atan(road.dx(z)) + Math.PI, 1);
    park(spd.post, i, x, y + 1.0, z, 0, 1);
  }, fixed: 2000 });
  // chevron alignment signs on curves
  const CHV = 26;
  const chv = mkSign(0.7, 0.95, chevronSignTexture(), CHV);
  const chvData = Array.from({ length: CHV }, () => ({ z: -1e9 }));
  S.systems.push({ data: chvData, place: (i, z) => {
    // find a curvy spot ahead
    let bz = z, best = 0;
    for (let k = 0; k < 26; k++) { const zz = z + k * 14; const c = Math.abs(road.dx(zz + 60) - road.dx(zz)); if (c > best) { best = c; bz = zz + 60; } }
    const dir = Math.sign(road.dx(bz + 40) - road.dx(bz)) || 1;
    const x = road.x(bz) - dir * 15.2, y = road.y(bz);
    park(chv.panel, i, x, y + 1.9, bz, Math.atan(road.dx(bz)) + (dir > 0 ? 0.5 : -0.5) + Math.PI, 1);
    park(chv.post, i, x, y + 0.9, bz, 0, 1);
    return bz;
  } });
  // roadside green route signs
  const RTE = 4;
  const rte = mkSign(4.6, 1.5, gantrySignTexture(1), RTE, RTE * 2);
  const rteData = Array.from({ length: RTE }, () => ({ z: -1e9 }));
  S.systems.push({ data: rteData, place: (i, z) => {
    const side = (i % 2) ? 1 : -1;
    const x = road.x(z) + side * 16.5, y = road.y(z);
    park(rte.panel, i, x, y + 3.4, z, Math.atan(road.dx(z)) + (side > 0 ? Math.PI : 0), 1);
    park(rte.post, i, x - 1.4, y + 1.5, z, 0, 1);
    park(rte.post, i + RTE, x + 1.4, y + 1.5, z, 0, 1);
    rte.post.instanceMatrix.needsUpdate = true;
  }, fixed: 1600 });
  // kilometre posts
  const KM = 40;
  const kmGeo = new THREE.BoxGeometry(0.16, 0.9, 0.1);
  const kmMesh = instanced(kmGeo, new THREE.MeshStandardMaterial({ color: '#e8e8e4', roughness: 0.7 }), KM, false);
  scene.add(kmMesh);
  const kmData = Array.from({ length: KM }, () => ({ z: -1e9 }));
  S.systems.push({ data: kmData, place: (i, z) => {
    const x = road.x(z) + 13.7, y = road.y(z);
    park(kmMesh, i, x, y + 0.45, z, Math.atan(road.dx(z)), 1);
  }, fixed: 100 });

  // ------------------------------------------------------------- billboards
  const BB = 3;
  S.billboards = [];
  for (let i = 0; i < BB; i++) {
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.3),
      [postMat, postMat, postMat, postMat, new THREE.MeshStandardMaterial({ map: billboardTexture(i), roughness: 0.8 }), postMat]);
    board.position.y = 6.5; board.castShadow = true;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 4.4, 8), postMat); p.position.set(s * 3, 2.2, 0); p.castShadow = true; g.add(p); }
    g.add(board); scene.add(g);
    S.billboards.push({ z: -1e9, group: g });
  }

  // =====================================================================
  S.update = pz => {
    for (const sys of S.systems) {
      const data = sys.data;
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        let behind = pz - 60, ahead = pz + 950;
        if (sys.fixed) {
          // conveyor belt: only recycle once passed, so spacing stays exact
          if (d.z > behind) continue;
          if (d.z < -1e8) d.z = Math.ceil((pz - 40) / sys.fixed) * sys.fixed + i * sys.fixed;
          else { let m = pz; for (const o of data) if (o.z > m) m = o.z; d.z = m + sys.fixed; }
          sys.place(i, d.z);
        } else if (d.z < behind || d.z > ahead) {
          const nz = sys.place(i, d.z < -1e8 ? pz - 40 + Math.random() * 950 : pz + 780 + Math.random() * 180);
          d.z = nz || (d.z < -1e8 ? pz - 40 + Math.random() * 950 : pz + 780 + Math.random() * 180);
        }
      }
    }
    for (let i = 0; i < S.billboards.length; i++) {
      const b = S.billboards[i];
      if (b.z < pz - 80 || b.z > pz + 1100) {
        b.z = b.z < -1e8 ? pz + 200 + i * 450 : pz + 900 + Math.random() * 200;
        const side = (i % 2) ? 1 : -1;
        const x = road.x(b.z) + side * (48 + Math.random() * 40);
        b.group.position.set(x, road.terrainY(x, b.z) - 0.4, b.z);
        b.group.rotation.y = Math.atan(road.dx(b.z)) + (side > 0 ? -0.5 : 0.5) + Math.PI;
      }
    }
  };
  S.reset = pz => {
    for (const sys of S.systems) sys.data.forEach(d => d.z = -1e9);
    S.billboards.forEach(b => b.z = -1e9);
    S.update(pz);
  };
  return S;
}
