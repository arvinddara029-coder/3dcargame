// =====================================================================
//  assets.js — optional photoreal assets, loaded in the background.
//  The game always boots with compact procedural placeholders; every
//  download here merely upgrades fidelity and can fail silently.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const texLoader = new THREE.TextureLoader();

function srgb(t) { t.colorSpace = THREE.SRGBColorSpace; return t; }
function dataTex(t) { t.colorSpace = THREE.NoColorSpace; return t; }

function load(url, wrap, srgbSpace, aniso) {
  return new Promise(resolve => {
    texLoader.load(url, t => {
      t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      if (srgbSpace) srgb(t); else dataTex(t);
      t.anisotropy = aniso || 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

// Road / concrete / grass PBR sets (baked by tools/build_assets.mjs).
export async function loadWorldTextures(renderer, apply) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jobs = [
    ['roadAlbedo', load('assets/textures/road_albedo.jpg', true, true, aniso)],
    ['roadNormal', load('assets/textures/road_normal.jpg', true, false, aniso)],
    ['roadRough', load('assets/textures/road_rough.jpg', true, false, 2)],
    ['concreteAlbedo', load('assets/textures/concrete_albedo.jpg', true, true, aniso)],
    ['concreteNormal', load('assets/textures/concrete_normal.jpg', true, false, aniso)],
    ['grassNormal', load('assets/textures/grass_normal.jpg', true, false, aniso)],
  ];
  for (const [name, p] of jobs) {
    const t = await p;
    if (t) apply(name, t);
  }
}

// ---------------------------------------------------------------------
//  Player car: pre-decoded Ferrari GLB (no Draco worker needed).
//  Returns a rig: { root, wheels:{fl,fr,rl,rr}, bodyMats, tailMats, headMats }
// ---------------------------------------------------------------------
export function loadPlayerCar() {
  return new Promise(resolve => {
    try {
      new GLTFLoader().load('assets/models/player_car.glb', gltf => {
        const root = gltf.scene;
        const wheels = {}, bodyMats = new Set(), tailMats = new Set(), headMats = new Set();
        root.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const n = (m.name || '').toLowerCase();
            if (n.includes('body_color')) bodyMats.add(m);
            else if (n.includes('taillight') || n.includes('lights_red')) tailMats.add(m);
            else if (n === 'lights' || n.includes('projector')) headMats.add(m);
            if (m.emissive === undefined) continue;
          }
        });
        for (const m of tailMats) { m.emissive = new THREE.Color('#ff1a1a'); m.emissiveIntensity = 0.25; }
        for (const m of headMats) { m.emissive = new THREE.Color('#fff6d8'); m.emissiveIntensity = 1.6; }
        const byName = n => root.getObjectByName(n);
        wheels.fl = byName('wheel_fl'); wheels.fr = byName('wheel_fr');
        wheels.rl = byName('wheel_rl'); wheels.rr = byName('wheel_rr');
        // headlamp spot beams (player only, cheap: no shadows)
        const beams = [];
        for (const s of [-1, 1]) {
          const spot = new THREE.SpotLight('#ffe9c0', 60, 90, 0.42, 0.55, 1.6);
          spot.position.set(s * 0.68, 0.72, 2.1);
          const tgt = new THREE.Object3D();
          tgt.position.set(s * 1.6, -0.4, 26);
          root.add(spot, tgt);
          spot.target = tgt;
          beams.push(spot);
        }
        resolve({ root, wheels, bodyMats: [...bodyMats], tailMats: [...tailMats], headMats: [...headMats], beams });
      }, undefined, () => resolve(null));
    } catch (e) {
      console.warn('player car model skipped:', e?.message || e);
      resolve(null);
    }
  });
}

// =====================================================================
//  Canvas sign textures (drawn once, shared by instanced scenery)
// =====================================================================
const signCache = new Map();
function canvas(w, h, draw, keyExtra = '') {
  const key = draw.toString() + w + h + keyExtra;
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  signCache.set(key, t);
  return t;
}

const CITIES = [
  ['SPRINGFIELD', '12', 'RIVERSIDE', '48'],
  ['CENTRAL CITY', '6', 'OAKWOOD', '31'],
  ['AIRPORT', '9', 'DOWNTOWN', '17'],
  ['HILLVIEW', '22', 'PORT EAST', '64'],
];
export function gantrySignTexture(i) {
  return canvas(1024, 320, (g, w, h) => {
    g.fillStyle = '#0a6b40'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f4f6f5'; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
    const [c1, d1, c2, d2] = CITIES[i % CITIES.length];
    g.fillStyle = '#f4f6f5'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = 'bold 74px Arial, sans-serif';
    g.fillText(c1, 60, 96); g.fillText(c2, 60, 216);
    g.font = 'bold 66px Arial, sans-serif'; g.textAlign = 'right';
    g.fillText(d1 + ' km', w - 60, 96); g.fillText(d2 + ' km', w - 60, 216);
    // exit tab
    g.fillStyle = '#16b04c'; g.fillRect(w - 300, 0, 300, 74);
    g.fillStyle = '#08130c'; g.font = 'bold 46px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('EXIT ' + (12 + (i % 5) * 7), w - 150, 40);
  }, 'g' + i);
}
export function speedSignTexture() {
  return canvas(256, 320, (g, w, h) => {
    g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#111'; g.textAlign = 'center';
    g.font = 'bold 40px Arial'; g.fillText('SPEED', w / 2, 70); g.fillText('LIMIT', w / 2, 118);
    g.font = 'bold 120px Arial'; g.fillText('80', w / 2, 226);
  });
}
export function chevronSignTexture() {
  return canvas(192, 256, (g, w, h) => {
    g.fillStyle = '#151310'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f2c200'; g.lineWidth = 26; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(28, 40); g.lineTo(w / 2, h / 2); g.lineTo(28, h - 40); g.stroke();
    g.beginPath(); g.moveTo(w / 2 + 10, 40); g.lineTo(w - 24, h / 2); g.lineTo(w / 2 + 10, h - 40); g.stroke();
  });
}
const ADS = [
  ['HIGHWAY RUSH', 'ENDLESS RACING', '#ff7a00', '#20140a'],
  ['TYRE KING', 'GRIP FOR LIFE', '#e8e8e8', '#123a6b'],
  ['PIT STOP CAFE', 'OPEN 24 HOURS', '#ffd23f', '#5c1010'],
];
export function billboardTexture(i) {
  return canvas(1024, 512, (g, w, h) => {
    const [a, b, fg, bg] = ADS[i % ADS.length];
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.14)'); grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 14; g.strokeRect(16, 16, w - 32, h - 32);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 120px Arial'; g.fillText(a, w / 2, h / 2 - 60);
    g.font = 'bold 64px Arial'; g.fillText(b, w / 2, h / 2 + 80);
  }, 'b' + i);
}
export function lightPoolTexture() {
  return canvas(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,214,150,0.55)');
    r.addColorStop(0.5, 'rgba(255,190,120,0.18)');
    r.addColorStop(1, 'rgba(255,180,100,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}
// alpha-tested grass tuft card
export function tuftTexture() {
  return canvas(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let s = 7;
    const rr = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const x = 8 + rr() * 112, hh = 40 + rr() * 80, lean = (rr() - 0.5) * 46;
      g.strokeStyle = `hsl(${88 + rr() * 30}, ${38 + rr() * 22}%, ${22 + rr() * 22}%)`;
      g.lineWidth = 2 + rr() * 2;
      g.beginPath(); g.moveTo(x, h);
      g.quadraticCurveTo(x + lean * 0.4, h - hh * 0.6, x + lean, h - hh);
      g.stroke();
    }
  });
}
