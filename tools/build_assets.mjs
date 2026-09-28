// =====================================================================
//  Highway Rush 3D — offline asset pipeline
//  1) player_car.glb : decode the Draco Ferrari, re-orient/normalise it,
//     simplify + quantise so the browser needs NO Draco worker at runtime.
//  2) PBR textures   : tileable asphalt (albedo/normal/roughness with worn
//     lane markings), concrete (albedo/normal) and a grass normal map
//     derived from the photographic grass albedo.
//  Deterministic: seeded PRNG, so re-running yields identical bytes.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT_MODEL = path.join(REPO, 'assets/models');
const OUT_TEX = path.join(REPO, 'assets/textures');
fs.mkdirSync(OUT_TEX, { recursive: true });

// ---------------------------------------------------------------------
// deterministic PRNG
// ---------------------------------------------------------------------
let seed = 1337;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ---------------------------------------------------------------------
//  periodic value noise (tiles exactly with period P lattice cells)
// ---------------------------------------------------------------------
function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, P, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const w = (a, b) => ((a % b) + b) % b;
  const x0 = w(ix, P), x1 = w(ix + 1, P), y0 = w(iy, P), y1 = w(iy + 1, P);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  const u = fade(fx), v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fractal sum; base period P cells, o octaves (period doubles each octave)
function fbm(x, y, P, o, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < o; i++) {
    sum += amp * vnoise(x * f, y * f, P * f, s + i * 101);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
function ridged(x, y, P, o, s) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < o; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, P * f, s + i * 77) * 2 - 1);
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------------
//  encoding helpers
// ---------------------------------------------------------------------
function writeJPG(file, w, h, rgb) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) { data[p] = rgb[i]; data[p + 1] = rgb[i + 1]; data[p + 2] = rgb[i + 2]; data[p + 3] = 255; }
  fs.writeFileSync(file, jpeg.encode({ data, width: w, height: h }, 90).data);
  console.log('  wrote', path.relative(REPO, file), (fs.statSync(file).size / 1024 | 0) + 'KB');
}
// height field -> tangent-space normal map (wrap-aware)
function normalRGB(hgt, w, h, strength) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1) + h) % h, yd = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xl = ((x - 1) + w) % w, xr = (x + 1) % w;
      const dx = (hgt[y * w + xr] - hgt[y * w + xl]) * strength;
      const dy = (hgt[yd * w + x] - hgt[yu * w + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 3;
      out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255;
    }
  }
  return out;
}

// =====================================================================
//  1) ROAD ASPHALT  (2048 x 2048  ==  26 m across x 24 m along)
// =====================================================================
const ROAD_HALF = 13, LANES = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5];
function buildRoadTextures() {
  console.log('baking asphalt PBR set…');
  const W = 2048, H = 2048, MX = 26, MZ = 24;           // metres covered by the tile
  const px2mx = u => (u - 0.5) * MX;                    // -13..13
  const px2mz = v => v * MZ;                            // 0..24
  const hgt = new Float32Array(W * H);
  const alb = new Uint8Array(W * H * 3);
  const rgh = new Uint8Array(W * H);

  // --- low-frequency masks on a coarse grid, sampled bilinearly
  const CW = 128;
  const patch = new Float32Array(CW * CW);   // repainted / smoother asphalt patches
  const dirt = new Float32Array(CW * CW);    // dust & dirt drift
  for (let y = 0; y < CW; y++) for (let x = 0; x < CW; x++) {
    patch[y * CW + x] = smooth(0.62, 0.78, fbm(x / CW * 8, y / CW * 8, 8, 3, 11));
    dirt[y * CW + x] = fbm(x / CW * 6 + 40, y / CW * 6, 6, 4, 29);
  }
  const sample = (f, u, v) => {
    const x = u * CW - 0.5, y = v * CW - 0.5;
    const x0 = ((Math.floor(x) % CW) + CW) % CW, y0 = ((Math.floor(y) % CW) + CW) % CW;
    const x1 = (x0 + 1) % CW, y1 = (y0 + 1) % CW, fx = x - Math.floor(x), fy = y - Math.floor(y);
    return f[y0 * CW + x0] * (1 - fx) * (1 - fy) + f[y0 * CW + x1] * fx * (1 - fy) + f[y1 * CW + x0] * (1 - fx) * fy + f[y1 * CW + x1] * fx * fy;
  };

  // --- stone speckles (poisson-ish dots)
  const NS = 26000;
  const stones = [];
  for (let i = 0; i < NS; i++) stones.push([rnd() * W, rnd() * H, 0.6 + rnd() * 1.7, rnd()]);

  // --- crack + tar-snake fields (periodic)
  const crackAt = (u, v) => {
    const warp = fbm(u * 6 + 9, v * 6, 6, 3, 51) - 0.5;
    const r = ridged(u * 10 + warp * 2.2, v * 10 + warp * 2.2, 10, 4, 7);
    return smooth(0.86, 0.94, r);
  };
  const snakeAt = (u, v) => {
    const warp = fbm(u * 4 + 70, v * 4, 4, 3, 91) - 0.5;
    const r = ridged(u * 5 + warp * 1.6 + 3, v * 5 + warp * 1.6, 5, 3, 13);
    return smooth(0.9, 0.97, r);
  };

  // --- lane marking layout (metres across) — must mirror js/game.js
  const edgeX = ROAD_HALF - 1;                 // solid white edge lines
  const dashes = [-9, -6, -3, 3, 6, 9];        // dashed lane dividers (12 m cycle)
  const inBand = (x, c, hw) => Math.abs(x - c) < hw;
  const markAt = (mx, mz) => {
    let paint = 0, kind = 0;                    // kind 0 white, 1 yellow
    if (inBand(mx, -edgeX, 0.09) || inBand(mx, edgeX, 0.09)) paint = 1;
    else if (inBand(mx, -0.16, 0.075) || inBand(mx, 0.16, 0.075)) { paint = 1; kind = 1; }
    else for (const d of dashes) if (inBand(mx, d, 0.085) && (mz % 12) < 3) { paint = 1; break; }
    return [paint, kind];
  };
  // wheel-path wear: two polished strips per lane
  const wheelWear = mx => {
    let w = 0;
    for (const L of LANES) for (const o of [-0.85, 0.85]) {
      const d = Math.abs(mx - (L + o));
      w = Math.max(w, 1 - smooth(0.20, 0.46, d));
    }
    return w;
  };

  for (let y = 0; y < H; y++) {
    const v = y / H, mz = px2mz(v);
    for (let x = 0; x < W; x++) {
      const u = x / W, mx = px2mx(u);
      const i = y * W + x;
      // aggregate height: fine grains + medium undulation
      const grain = fbm(u * 260, v * 260, 260, 2, 3) - 0.5;
      const med = fbm(u * 46, v * 46, 46, 3, 17) - 0.5;
      const patchM = sample(patch, u, v);
      const crack = crackAt(u, v);
      const snake = snakeAt(u, v);
      let h = grain * (1 - 0.55 * patchM) + med * 0.55 * (1 - 0.4 * patchM) - crack * 0.9 + snake * 0.35;
      hgt[i] = h;
      // albedo
      let g = 0.170 + med * 0.05 + grain * 0.10;          // base bitumen grey
      if (Math.abs(mx) > 12.35) g += 0.05 + (fbm(u * 90, v * 90, 90, 2, 71) - 0.5) * 0.08; // dirty gravel shoulder
      g += (sample(dirt, u, v) - 0.5) * 0.045;            // dust drift
      g = g * (1 - 0.35 * patchM) + 0.115 * patchM;       // fresh patches darker
      g -= crack * 0.09; g += snake * 0.012;
      let r = g, gg = g, b = g * 1.03;                    // cool bitumen tint
      // paint
      const [paint, kind] = markAt(mx, mz);
      if (paint) {
        // paint wear: aggregate breakup + wheel-path erosion + age
        const wear = clamp(wheelWear(mx) * 0.85 + crack * 0.9 + (1 - fbm(u * 130, v * 130, 130, 2, 41)) * 0.55 + 0.12, 0, 1);
        const a = paint * (1 - wear * 0.8);
        const pr = kind ? 0.72 : 0.80, pg = kind ? 0.55 : 0.80, pb = kind ? 0.10 : 0.78;
        r = r * (1 - a) + pr * a; gg = gg * (1 - a) + pg * a; b = b * (1 - a) + pb * a;
      }
      // wheel paths polish & darken the bitumen a touch
      const ww = wheelWear(mx);
      r *= 1 - ww * 0.09; gg *= 1 - ww * 0.09; b *= 1 - ww * 0.08;
      alb[i * 3] = clamp(r, 0, 1) * 255; alb[i * 3 + 1] = clamp(gg, 0, 1) * 255; alb[i * 3 + 2] = clamp(b, 0, 1) * 255;
      // roughness: bitumen ~0.92, polished wheel paths ~0.6, paint ~0.5, tar snakes glossy
      let ro = 0.92 - ww * 0.3 + (fbm(u * 60, v * 60, 60, 2, 61) - 0.5) * 0.1 - patchM * 0.12 + crack * 0.06 - snake * 0.45;
      if (paint) ro = Math.min(ro, 0.52);
      rgh[i] = clamp(ro, 0.08, 1) * 255;
    }
  }
  // sprinkle bright/dark aggregate stones
  for (const [sx, sy, sr, tone] of stones) {
    const c = tone < 0.5 ? 0.30 + tone * 0.3 : 0.10 + tone * 0.12;
    const rad = sr;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const x = ((sx + dx) % W + W) | 0, y = ((sy + dy) % H + H) | 0;
      const i = (y % H) * W + (x % W);
      alb[i * 3] = clamp(alb[i * 3] * 0.35 + c * 255 * 0.65, 0, 255);
      alb[i * 3 + 1] = clamp(alb[i * 3 + 1] * 0.35 + c * 250 * 0.65, 0, 255);
      alb[i * 3 + 2] = clamp(alb[i * 3 + 2] * 0.35 + c * 245 * 0.65, 0, 255);
      hgt[i] += 0.35;
    }
  }
  writeJPG(path.join(OUT_TEX, 'road_albedo.jpg'), W, H, alb);
  writeJPG(path.join(OUT_TEX, 'road_normal.jpg'), W, H, normalRGB(hgt, W, H, 2.6));
  writeJPG(path.join(OUT_TEX, 'road_rough.jpg'), W >> 1, H >> 1, downscale(rgh, W, H));
}
function downscale(gray, W, H) {
  const w = W >> 1, h = H >> 1, out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (gray[(2 * y) * W + 2 * x] + gray[(2 * y) * W + 2 * x + 1] + gray[(2 * y + 1) * W + 2 * x] + gray[(2 * y + 1) * W + 2 * x + 1]) >> 2;
    const i = (y * w + x) * 3; out[i] = out[i + 1] = out[i + 2] = v;
  }
  return out;
}

// =====================================================================
//  2) CONCRETE (1024² == 2 m tile) for jersey barriers / pads
// =====================================================================
function buildConcreteTextures() {
  console.log('baking concrete PBR set…');
  const W = 1024, H = 1024;
  const hgt = new Float32Array(W * H), alb = new Uint8Array(W * H * 3), rgh = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, i = y * W + x;
    const mottle = fbm(u * 14, v * 14, 14, 4, 5);
    const fine = fbm(u * 150, v * 150, 150, 2, 9) - 0.5;
    const streak = smooth(0.55, 0.8, fbm(u * 5 + 3, v * 40, 40, 3, 23));   // rain streaks
    const pits = smooth(0.8, 0.9, ridged(u * 60, v * 60, 60, 3, 31));
    const h = fine * 0.7 + mottle * 0.25 - pits * 0.8;
    hgt[i] = h;
    let g = 0.42 + mottle * 0.13 + fine * 0.10 - streak * 0.10 - pits * 0.16;
    alb[i * 3] = clamp(g * 1.0, 0, 1) * 255; alb[i * 3 + 1] = clamp(g * 1.0, 0, 1) * 255; alb[i * 3 + 2] = clamp(g * 0.97, 0, 1) * 255;
    rgh[i] = clamp(0.88 - streak * 0.1 + pits * 0.1 + fine * 0.1, 0.1, 1) * 255;
  }
  writeJPG(path.join(OUT_TEX, 'concrete_albedo.jpg'), W, H, alb);
  writeJPG(path.join(OUT_TEX, 'concrete_normal.jpg'), W, H, normalRGB(hgt, W, H, 1.8));
  writeJPG(path.join(OUT_TEX, 'concrete_rough.jpg'), W >> 1, H >> 1, downscale(rgh, W, H));
}

// =====================================================================
//  3) GRASS NORMAL from the photographic albedo
// =====================================================================
function buildGrassNormal() {
  const src = path.join(REPO, 'assets/grass.jpg');
  if (!fs.existsSync(src)) return console.log('  (grass.jpg missing, skipped)');
  console.log('deriving grass normal map…');
  const img = jpeg.decode(fs.readFileSync(src), { maxMemoryUsageInMB: 1024 });
  const W = img.width, H = img.height;
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    hgt[i] = (img.data[p] * 0.3 + img.data[p + 1] * 0.55 + img.data[p + 2] * 0.15) / 255;
  }
  const S = 1024, small = new Float32Array(S * S);
  const k = W / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let dy = 0; dy < k; dy += 2) for (let dx = 0; dx < k; dx += 2) acc += hgt[(y * k + dy) * W + (x * k + dx)];
    small[y * S + x] = acc / ((k / 2) * (k / 2));
  }
  const n = normalRGB(small, S, S, 1.6);
  writeJPG(path.join(OUT_TEX, 'grass_normal.jpg'), S, S, n);
}

// =====================================================================
//  4) PLAYER CAR — Draco Ferrari -> plain, simplified, quantised GLB
// =====================================================================
async function buildPlayerCar() {
  const SRC = path.join(OUT_MODEL, 'ferrari.glb');
  const OUT = path.join(OUT_MODEL, 'player_car.glb');
  if (!fs.existsSync(SRC)) return console.log('  (ferrari.glb missing, skipped)');
  console.log('decoding + simplifying ferrari.glb…');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
  const doc = await io.read(SRC);
  // Drop the Draco extension AFTER decoding so the output is a plain GLB
  // (otherwise gltf-transform re-encodes it and the browser needs a worker).
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }
  const root = doc.getRoot();
  const nodes = root.listNodes();
  // column-major 4x4 multiply
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++) o[c * 4 + r2] = a[r2] * b[c * 4] + a[4 + r2] * b[c * 4 + 1] + a[8 + r2] * b[c * 4 + 2] + a[12 + r2] * b[c * 4 + 3];
    return o;
  };
  const byName = n => nodes.find(x => x.getName() === n);
  const nf = byName('wheel_fl'), nr = byName('wheel_rl');
  const wf = nf ? nf.getWorldTranslation() : [0, 0, 1];
  const wr = nr ? nr.getWorldTranslation() : [0, 0, -1];
  console.log('  wf', wf, 'wr', wr);
  // dominant front-rear axis
  const d = [wf[0] - wr[0], wf[1] - wr[1], wf[2] - wr[2]];
  const maxAbs = Math.max(...d.map(Math.abs));
  const axis = d.findIndex(v => Math.abs(v) === maxAbs);
  const frontSign = Math.sign(d[axis]);
  console.log('  front-rear axis:', 'XYZ'[axis], 'front sign', frontSign);

  // ---- bake wheel base rotations into children so the runtime can
  //      spin/steer wheels with plain rotation.x / rotation.y
  const quatMat = q => {
    const [x, y, z, w] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      0, 0, 0, 1,
    ];
  };
  for (const wn of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const n = byName(wn); if (!n) continue;
    const r = n.getRotation();
    if (!r[0] && !r[1] && !r[2]) continue;
    const R = quatMat(r);
    for (const c of n.listChildren()) c.setMatrix(mul(R, c.getMatrix()));
    n.setRotation([0, 0, 0, 1]);
  }

  // ---- bounding box of every primitive in model space
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (wm, arr) => {
    // transform local bounds corners by the world matrix (column-major)
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < arr.length; v += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], arr[v + k]); hi[k] = Math.max(hi[k], arr[v + k]);
    }
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      for (let k = 0; k < 3; k++) {
        const w = wm[k] * x + wm[4 + k] * y + wm[8 + k] * z + wm[12 + k];
        if (w < min[k]) min[k] = w;
        if (w > max[k]) max[k] = w;
      }
    }
  };
  for (const n of nodes) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const wm = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) grow(wm, p.getAttribute('POSITION').getArray());
  }
  const lenSrc = max[axis] - min[axis];
  const s = 4.55 / lenSrc;                       // normalise to a 4.55 m car
  // rotation mapping model forward axis -> +Z, keeping +Y up
  let ry = 0;
  if (axis === 0) ry = frontSign > 0 ? -Math.PI / 2 : Math.PI / 2;
  else if (axis === 2) ry = frontSign > 0 ? 0 : Math.PI;
  const R = [Math.cos(ry), 0, -Math.sin(ry), 0, 0, 1, 0, 0, Math.sin(ry), 0, Math.cos(ry), 0, 0, 0, 0, 1];
  const rot = (v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[4] * v[0] + R[5] * v[1] + R[6] * v[2], R[8] * v[0] + R[9] * v[1] + R[10] * v[2]];
  const corners = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push(rot([x * s, y * s, z * s]));
  const rmin = [0, 1, 2].map(k => Math.min(...corners.map(c => c[k])));
  const rmax = [0, 1, 2].map(k => Math.max(...corners.map(c => c[k])));
  const t = [-(rmin[0] + rmax[0]) / 2, -rmin[1], -(rmin[2] + rmax[2]) / 2];
  console.log('  scaled size (m):', (rmax[0] - rmin[0]).toFixed(2), (rmax[1] - rmin[1]).toFixed(2), (rmax[2] - rmin[2]).toFixed(2));

  // bake M = T * R * S into the scene root node
  const M = [
    R[0] * s, R[1] * s, R[2] * s, 0,
    R[4] * s, R[5] * s, R[6] * s, 0,
    R[8] * s, R[9] * s, R[10] * s, 0,
    t[0], t[1], t[2], 1,
  ];
  const sceneRoot = root.listScenes()[0].listChildren()[0];
  const old = sceneRoot.getMatrix();
  sceneRoot.setMatrix(mul(M, old));

  // ---- drop hidden interior shells (invisible behind tinted glass, ~72k tris)
  for (const name of ['interior_light', 'interior_dark', 'carpet']) {
    const n = byName(name);
    if (n) { const m = n.getMesh(); n.setMesh(null); if (m) m.dispose(); }
  }
  await doc.transform(prune());

  // ---- optimise: weld -> simplify -> quantise (KHR_mesh_quantisation needs no runtime worker)
  const triCount = () => {
    let t = 0;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(), pos = p.getAttribute('POSITION');
      t += (idx ? idx.getCount() : pos.getCount()) / 3;
    }
    return Math.round(t);
  };
  console.log('  tris after decode:', triCount());
  await doc.transform(weld({ tolerance: 1e-4 }));
  console.log('  tris after weld:', triCount());
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01 }));
  console.log('  tris after simplify:', triCount());
  await doc.transform(prune(), dedup(), quantize());
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION');
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
  await io.write(OUT, doc);
  console.log('  wrote', path.relative(REPO, OUT), Math.round(tris) + ' tris,', (fs.statSync(OUT).size / 1024 | 0) + 'KB');
}

// ---------------------------------------------------------------------
const args = process.argv.slice(2);
const want = w => !args.length || args.includes(w);
if (want('car')) await buildPlayerCar();
if (want('road')) buildRoadTextures();
if (want('concrete')) buildConcreteTextures();
if (want('grass')) buildGrassNormal();
console.log('done.');
