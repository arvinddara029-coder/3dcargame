import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GameAudio } from './audio.js';
import { loadWorldTextures, loadPlayerCar, gantrySignTexture } from './assets.js';
import { makeTrafficVehicle } from './fleet.js';
import { initScenery } from './scenery.js';
import { CAR_LIST, buildPlayableCar } from './garage.js';
import { ads } from './ads.js';

// =====================================================================
//  CONSTANTS / ROAD MATH
// =====================================================================
const ROAD_HALF = 13;           // total half width (incl. shoulder) — superwide 8-lane highway
const RAIL = 13.6;              // guard rail lateral offset
const DRIVE_LIMIT = 12.5;       // car centre can't pass this
const LANES = [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5]; // 4 oncoming (-), 4 same-direction (+); oncoming appears on the right of the screen (chase camera looks down +z)
const CHUNK = 200, SEG = 4;
const KMH = 3.6;

const roadX = z => 70 * Math.sin(z * 0.0021) + 30 * Math.sin(z * 0.0057 + 1.3) + 8 * Math.sin(z * 0.013 + 0.4);
const roadDX = z => 70 * 0.0021 * Math.cos(z * 0.0021) + 30 * 0.0057 * Math.cos(z * 0.0057 + 1.3) + 8 * 0.013 * Math.cos(z * 0.013 + 0.4);
const roadY = z => 10 * Math.sin(z * 0.0017) + 5 * Math.sin(z * 0.0049 + 2);
const roadDY = z => 10 * 0.0017 * Math.cos(z * 0.0017) + 5 * 0.0049 * Math.cos(z * 0.0049 + 2);
const terrainY = (x, z) => {
  const off = Math.abs(x - roadX(z));
  const base = roadY(z) - 0.08;
  if (off < 17) return base;
  const t = Math.min(1, (off - 17) / 90);
  const hills = (Math.sin(x * 0.021) * Math.cos(z * 0.017) + 0.6 * Math.sin(x * 0.051 + z * 0.037) + 0.8) * 9;
  const far = off > 160 ? (off - 160) * 0.25 : 0;
  return base - 0.6 * Math.min(1, (off - 17) / 8) + t * hills + far;
};

const DIFF = [
  { name: 'EASY', traffic: 14, oncomingSpd: [14, 20], sameSpd: [12, 18], work: 0.4, ramp: 0.5 },
  { name: 'NORMAL', traffic: 22, oncomingSpd: [18, 27], sameSpd: [14, 24], work: 0.7, ramp: 1 },
  { name: 'INSANE', traffic: 34, oncomingSpd: [24, 34], sameSpd: [18, 28], work: 1, ramp: 1.6 },
];
const CAR_COLORS = ['#c50000', '#ffb300', '#0055ff', '#111111', '#f4f4f4', '#00b36b', '#ff4fd8'];

// =====================================================================
//  RENDERER / SCENE
// =====================================================================
const container = document.getElementById('game');
const LOW_POWER_DEVICE = Boolean(matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !LOW_POWER_DEVICE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER_DEVICE ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
} catch (error) {
  // Do not leave a broken device on an endless “Loading assets” screen.
  console.error('WebGL is unavailable:', error);
  document.getElementById('loadtxt').textContent = 'This browser needs WebGL to run the 3D race.';
  document.getElementById('loadfill').style.width = '100%';
  const retry = document.getElementById('loadingRetry');
  retry.classList.remove('hidden');
  retry.onclick = () => location.reload();
  throw error;
}

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color('#e9b98f');
scene.fog = new THREE.Fog(FOG_COLOR, 120, 620);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Sky dome with sunset gradient + sun
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: new THREE.Vector3(0.3, 0.18, 1).normalize() } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
    void main(){ float h = vP.y;
      vec3 top = vec3(0.13,0.33,0.72); vec3 mid = vec3(0.98,0.62,0.40); vec3 hor = vec3(0.93,0.73,0.56);
      vec3 c = mix(hor, mid, smoothstep(-0.02,0.12,h)); c = mix(c, top, smoothstep(0.1,0.6,h));
      float s = max(dot(vP, sunDir),0.0); c += vec3(1.0,0.7,0.35)*pow(s,300.0)*3.0 + vec3(1.0,0.5,0.2)*pow(s,8.0)*0.35;
      gl_FragColor = vec4(c,1.0);} `,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
scene.add(sky);

const hemi = new THREE.HemisphereLight('#ffe6cc', '#3a5a2a', 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd9a8', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW_POWER_DEVICE ? 1024 : 2048, LOW_POWER_DEVICE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 250 });
// Changing ortho bounds after construction requires a manual projection update,
// otherwise the shadow map keeps the default ±5 unit frustum and most shadows vanish.
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// =====================================================================
//  TEXTURES (procedural canvas + downloaded)
// =====================================================================
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 38; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const px = l => ((l + ROAD_HALF) / (ROAD_HALF * 2)) * 512;
  // shoulders slightly lighter (outermost metre on each side)
  const shoulder = ROAD_HALF - 1;
  g.fillStyle = 'rgba(120,120,120,0.25)'; g.fillRect(0, 0, px(-shoulder), 512); g.fillRect(px(shoulder), 0, 512 - px(shoulder), 512);
  // tyre wear darker in lanes
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (const l of LANES) { g.fillRect(px(l - 1.1), 0, 14, 512); g.fillRect(px(l + 0.8), 0, 14, 512); }
  // edge lines
  g.fillStyle = '#f0f0f0'; g.fillRect(px(-shoulder) - 4, 0, 8, 512); g.fillRect(px(shoulder) - 4, 0, 8, 512);
  // lane dashes (between lanes of each carriageway)
  for (const l of [-9, -6, -3, 3, 6, 9]) g.fillRect(px(l) - 3, 0, 6, 220);
  // double yellow centre
  g.fillStyle = '#f5c518'; g.fillRect(px(-0.18) - 3, 0, 6, 512); g.fillRect(px(0.18) - 3, 0, 6, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// =====================================================================
//  FAST, FAIL-SAFE BOOT
//  The game never waits on an optional model, HDR, texture, or music download.
//  This is important on mobile networks and on hosts that block Draco workers.
// =====================================================================
const loadFill = document.getElementById('loadfill');
const loadText = document.getElementById('loadtxt');
const loadingScreen = document.getElementById('loading');
const loadingRetry = document.getElementById('loadingRetry');
const texLoader = new THREE.TextureLoader();

let grassTex, aoTex, musicData = null;
const audio = new GameAudio();

// CrazyGames ads (ads.js): start initializing in the background — the game
// never waits for the SDK and runs exactly as before when it is unavailable.
ads.setAudioHooks(() => audio.setMuted(true), () => audio.setMuted(false));
ads.init();

function setLoading(message, percent) {
  loadText.textContent = message;
  loadFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function configureGrass(texture) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeFallbackGrassTexture() {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    image.data[i] = 83 + n;
    image.data[i + 1] = 122 + n;
    image.data[i + 2] = 54 + n * 0.45;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = i % 2 ? '#d0b56a' : '#1e5628';
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 3 + Math.random() * 5);
  }
  return configureGrass(new THREE.CanvasTexture(canvas));
}

function makeFallbackShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.60)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function applyWorldTexture(name, t) {
  // Baked PBR maps replace the procedural placeholders as they arrive.
  if (name === 'roadAlbedo') { roadMat.map = t; roadMat.needsUpdate = true; }
  else if (name === 'roadNormal') { roadMat.normalMap = t; roadMat.normalScale.set(0.9, 0.9); roadMat.needsUpdate = true; }
  else if (name === 'roadRough') { roadMat.roughnessMap = t; roadMat.roughness = 1; roadMat.needsUpdate = true; }
  else if (name === 'concreteAlbedo') { t.repeat.set(0.5, 0.5); for (const m of [concreteMat, soundMat]) { m.map = t; m.needsUpdate = true; } }
  else if (name === 'concreteNormal') { t.repeat.set(0.5, 0.5); for (const m of [concreteMat, soundMat]) { m.normalMap = t; m.normalScale.set(0.6, 0.6); m.needsUpdate = true; } }
  else if (name === 'grassNormal') { grassMat.normalMap = t; grassMat.normalScale.set(0.7, 0.7); grassMat.needsUpdate = true; }
}

function optionalAssetError(name, error) {
  // Optional assets improve polish only — never strand the player on the loader.
  console.warn(`Optional ${name} skipped:`, error?.message || error);
}

function loadOptionalAssets() {
  try {
    texLoader.load('assets/grass.jpg', texture => {
      grassTex = configureGrass(texture);
      if (grassMat) {
        grassMat.map = grassTex;
        grassMat.needsUpdate = true;
      }
    }, undefined, error => optionalAssetError('grass texture', error));

    loadWorldTextures(renderer, applyWorldTexture);
    // The detailed car is a ~5 MB download — skip it on low-power/mobile
    // devices, which keep the lightweight procedural body.
    if (!LOW_POWER_DEVICE) loadPlayerCar().then(rig => { if (rig) adoptPlayerCar(rig); });

    new RGBELoader().load('assets/sky.hdr', hdr => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = hdr;
    }, undefined, error => optionalAssetError('environment map', error));
  } catch (error) {
    // A throwing loader must never take the boot path down with it.
    optionalAssetError('texture/environment loader', error);
  }

  // Music never blocks the race. Abort it after a while when the browser supports it.
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
  fetch('assets/sounds/music.mp3', controller ? { signal: controller.signal } : undefined)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => {
      musicData = buffer;
      // If the player pressed Start while the music was downloading, add it now.
      if (audio.ctx) audio.setMusicBuffer(buffer);
    })
    .catch(error => {
      if (error.name !== 'AbortError') optionalAssetError('music', error);
    })
    .then(() => { if (timer) clearTimeout(timer); });
}

function showBootError(error) {
  console.error('Highway Rush boot error:', error);
  setLoading('3D engine could not start. Please retry.', 100);
  loadingRetry.classList.remove('hidden');
  loadingRetry.onclick = () => location.reload();
}

function bootGame() {
  try {
    setLoading('Generating the highway…', 18);
    // These compact procedural assets are ready immediately. The downloaded
    // versions above replace them later when available.
    grassTex = makeFallbackGrassTexture();
    aoTex = makeFallbackShadowTexture();
    setLoading('Placing traffic and scenery…', 58);
    buildWorld();
    setLoading('Race ready!', 100);
    loadOptionalAssets();

    // Give the completed bar one frame, then always show the playable menu.
    requestAnimationFrame(() => {
      state = 'menu';
      setTimeout(() => {
        loadingScreen.classList.add('hidden');
        document.getElementById('menu').classList.remove('hidden');
      }, 180);
    });
  } catch (error) {
    showBootError(error);
  }
}

// Run after module initialization so all game-state variables exist first.
Promise.resolve().then(bootGame);

// =====================================================================
//  MATERIALS
// =====================================================================
let roadMat, grassMat, railMat, postMat, concreteMat, soundMat, reflectMat;
let scenery = null;

// The original high-poly Draco car was beautiful but made startup dependent on
// a Web Worker and pushed every traffic car through hundreds of thousands of
// vertices. This shared-geometry supercar is intentionally lightweight, while
// still giving the player a detailed, fully 3D vehicle on every device.
let proceduralCarAssets;
function getProceduralCarAssets() {
  if (proceduralCarAssets) return proceduralCarAssets;

  const tireGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.34, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.355, 14);
  rimGeo.rotateZ(Math.PI / 2);
  const rotorGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.365, 14);
  rotorGeo.rotateZ(Math.PI / 2);
  const wheelRingGeo = new THREE.TorusGeometry(0.29, 0.035, 6, 14);
  wheelRingGeo.rotateY(Math.PI / 2);

  proceduralCarAssets = {
    bodyGeo: new THREE.BoxGeometry(1.98, 0.46, 4.24),
    hoodGeo: new THREE.SphereGeometry(1, 18, 10),
    cabinGeo: new THREE.SphereGeometry(1, 18, 10),
    bumperGeo: new THREE.BoxGeometry(1.92, 0.24, 0.22),
    grilleGeo: new THREE.BoxGeometry(0.92, 0.20, 0.035),
    lampGeo: new THREE.BoxGeometry(0.46, 0.14, 0.045),
    sideGeo: new THREE.BoxGeometry(0.08, 0.15, 2.60),
    spoilerGeo: new THREE.BoxGeometry(1.42, 0.07, 0.24),
    spoilerPostGeo: new THREE.BoxGeometry(0.07, 0.34, 0.07),
    tireGeo, rimGeo, rotorGeo, wheelRingGeo,
    shadowGeo: new THREE.PlaneGeometry(3.45, 5.2),
    tireMat: new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.86, metalness: 0.03 }),
    rimMat: new THREE.MeshStandardMaterial({ color: 0xd7e1e5, roughness: 0.22, metalness: 1.0 }),
    rotorMat: new THREE.MeshStandardMaterial({ color: 0x43494e, roughness: 0.35, metalness: 0.92 }),
    trimMat: new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.32, metalness: 0.8 }),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x07131e, roughness: 0.06, metalness: 0.82, transparent: true, opacity: 0.78 }),
    headlampMat: new THREE.MeshBasicMaterial({ color: 0xfff2b8 }),
    shadowMat: new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }),
  };
  return proceduralCarAssets;
}

function carPart(root, geometry, material, x, y, z, scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function makeCar(color, isPlayer = false) {
  const a = getProceduralCarAssets();
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.88, roughness: 0.24, clearcoat: 1.0, clearcoatRoughness: 0.08,
  });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x440000 });

  // Low, wide body, sculpted hood and smoked glass canopy — front is +Z.
  carPart(root, a.bodyGeo, bodyMat, 0, 0.70, 0);
  carPart(root, a.hoodGeo, bodyMat, 0, 0.88, 1.12, [0.94, 0.30, 1.10]);
  carPart(root, a.cabinGeo, a.glassMat, 0, 1.16, -0.32, [0.82, 0.48, 1.05]);
  carPart(root, a.bumperGeo, a.trimMat, 0, 0.48, 2.18);
  carPart(root, a.bumperGeo, a.trimMat, 0, 0.50, -2.18);
  carPart(root, a.grilleGeo, a.trimMat, 0, 0.66, 2.30);
  carPart(root, a.sideGeo, a.trimMat, -1.00, 0.48, -0.03);
  carPart(root, a.sideGeo, a.trimMat, 1.00, 0.48, -0.03);

  // Headlights and independent tail/brake lights.
  for (const x of [-0.62, 0.62]) {
    carPart(root, a.lampGeo, a.headlampMat, x, 0.84, 2.20);
    carPart(root, a.lampGeo, brakeMat, x, 0.82, -2.20);
  }
  carPart(root, a.spoilerGeo, a.trimMat, 0, 1.33, -1.78);
  for (const x of [-0.52, 0.52]) carPart(root, a.spoilerPostGeo, a.trimMat, x, 1.15, -1.78);

  const wheels = [];
  const addWheel = (x, z) => {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.49, z);
    wheel.rotation.order = 'YXZ';
    carPart(wheel, a.tireGeo, a.tireMat, 0, 0, 0);
    carPart(wheel, a.rotorGeo, a.rotorMat, 0, 0, 0);
    carPart(wheel, a.rimGeo, a.rimMat, 0, 0, 0);
    carPart(wheel, a.wheelRingGeo, a.trimMat, x > 0 ? 0.19 : -0.19, 0, 0);
    root.add(wheel);
    wheels.push(wheel);
  };
  // First two wheels are the steering axle, matching updatePlayer/updateTraffic.
  addWheel(-1.04, 1.38); addWheel(1.04, 1.38);
  addWheel(-1.04, -1.38); addWheel(1.04, -1.38);

  const shadow = new THREE.Mesh(a.shadowGeo, a.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  shadow.renderOrder = 1;
  root.add(shadow);

  // A very subtle player-only underglow makes the selected car easy to follow.
  if (isPlayer) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 3.25), new THREE.MeshBasicMaterial({
      color: 0x149dff, transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.028;
    root.add(glow);
  }

  return { root, wheels, bodyMat, brakeMat, halfL: 2.3, halfW: 1.0 };
}

let playerCarRig = null;
let selectedCarId = 'VELOCE';
function wrapProc(car) {
  car.glb = false;
  car.setBodyColor = c => car.bodyMat.color.set(c);
  car.setBrake = on => car.brakeMat.color.setHex(on ? 0xff1010 : 0x440000);
  car.setHead = () => {};
  return car;
}
function wrapGlb(rig, color) {
  if (!rig.glowAdded) {
    rig.glowAdded = true;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.4), new THREE.MeshBasicMaterial({
      color: 0x149dff, transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; glow.renderOrder = 1;
    rig.root.add(glow);
  }
  const meta = CAR_LIST.find(c => c.id === 'SPIDER') || {};
  const car = {
    root: rig.root, glb: true, halfL: 2.3, halfW: 1.0, id: 'SPIDER',
    vmax: meta.vmax || 74, vmaxN: meta.vmaxN || 94, steer: meta.steer || 1.05,
    wheels: [rig.wheels.fl, rig.wheels.fr, rig.wheels.rl, rig.wheels.rr],
    setBodyColor: c => rig.bodyMats.forEach(m => m.color.set(c)),
    setBrake: on => rig.tailMats.forEach(m => { m.emissiveIntensity = on ? 3.4 : 0.25; }),
    setHead: on => { rig.headMats.forEach(m => { m.emissiveIntensity = on ? 2.4 : 1.2; }); rig.beams.forEach(b => { b.visible = on; }); },
  };
  car.setBodyColor(color);
  return car;
}
function adoptPlayerCar(rig) {
  playerCarRig = rig;
  if (selectedCarId === 'SPIDER' && state === 'menu' && player && !player.glb) {
    const dyn = Object.assign({}, player);
    const fresh = wrapGlb(rig, playerColor);
    for (const k in dyn) if (!(k in fresh)) fresh[k] = dyn[k];
    scene.remove(dyn.root);
    player = fresh;
    player.root.position.copy(dyn.root.position);
    scene.add(player.root);
    return;
  }
  if (!player || player.glb) return;
  const dyn = Object.assign({}, player);
  const fresh = wrapGlb(rig, playerColor);
  for (const k in dyn) if (!(k in fresh)) fresh[k] = dyn[k];
  scene.remove(dyn.root);
  player = fresh;
  player.root.position.copy(dyn.root.position);
  player.root.rotation.copy(dyn.root.rotation);
  player.setHead(true);
  scene.add(player.root);
}

// =====================================================================
//  WORLD: road chunks, terrain, rails, scenery
// =====================================================================
const chunks = new Map();
let mountains;
const turbineList = [], archList = []; // recycled roadside landmarks

function buildWorld() {
  roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85, metalness: 0.0 });
  grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: '#b7c98f' });
  railMat = new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  postMat = new THREE.MeshStandardMaterial({ color: '#777', metalness: 0.6, roughness: 0.5 });

  // Concrete / sound-barrier materials (upgraded by baked PBR textures)
  concreteMat = new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.9, metalness: 0.05 });
  soundMat = new THREE.MeshStandardMaterial({ color: '#98a0a6', roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
  reflectMat = new THREE.MeshBasicMaterial({ color: '#ffb347', toneMapped: false });

  // Roadside world (forest, tufts, rocks, lamps, signs, billboards)
  scenery = initScenery(scene, { x: roadX, y: roadY, dx: roadDX, dy: roadDY, terrainY }, LOW_POWER_DEVICE, { concrete: concreteMat });

  // Wind turbines on the hills (animated, recycled) — living skyline
  const TURBINES = 6;
  const tbMat = new THREE.MeshStandardMaterial({ color: '#e8eaec', roughness: 0.5, metalness: 0.25 });
  for (let i = 0; i < TURBINES; i++) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.95, 26, 8), tbMat);
    pole.position.y = 13; pole.castShadow = true; g.add(pole);
    const nac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 3.4), tbMat);
    nac.position.set(0, 26, 0); nac.castShadow = true; g.add(nac);
    const rotor = new THREE.Group();
    rotor.position.set(0, 26, 1.9);
    for (let b = 0; b < 3; b++) {
      const holder = new THREE.Group();
      holder.rotation.z = (b / 3) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 11, 0.18), tbMat);
      blade.position.y = 5.5; blade.castShadow = true;
      holder.add(blade); rotor.add(holder);
    }
    g.add(rotor);
    scene.add(g);
    turbineList.push({ z: -1e9, group: g, rotor, spin: 0.7 + Math.random() * 0.9 });
  }

  // Highway gantry arches with a glowing strip + blinking lamps
  const ARCHES = 4;
  const aMat = new THREE.MeshStandardMaterial({ color: '#5d666d', metalness: 0.7, roughness: 0.4 });
  for (let i = 0; i < ARCHES; i++) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), aMat);
      pil.position.set(s * (RAIL + 1.2), 4.5, 0); pil.castShadow = true; g.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry((RAIL + 1.2) * 2 + 0.8, 1.1, 0.9), aMat);
    beam.position.y = 9.2; beam.castShadow = true; g.add(beam);
    const strip = new THREE.Mesh(new THREE.BoxGeometry((RAIL + 1.2) * 2, 0.34, 0.12),
      new THREE.MeshBasicMaterial({ color: '#27e6a5' }));
    strip.position.set(0, 8.5, 0.52); g.add(strip);
    const lamps = [];
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffae00' }));
      lamp.position.set(s * 2.2, 8.45, 0.55); g.add(lamp); lamps.push(lamp);
    }
    g.userData.lamps = lamps;
    // green overhead direction sign hung under the beam
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 3.4),
      new THREE.MeshStandardMaterial({ map: gantrySignTexture(i), roughness: 0.55 }));
    sign.position.set(0, 6.5, 0.5); g.add(sign);
    scene.add(g);
    archList.push({ z: -1e9, group: g });
  }

  // Distant mountains (follow the camera horizontally)
  mountains = new THREE.Group();
  const mMat = new THREE.MeshStandardMaterial({ color: '#6a7a8f', roughness: 1, flatShading: true, fog: false });
  const snowMat = new THREE.MeshStandardMaterial({ color: '#f2f2f5', roughness: 0.8, flatShading: true, fog: false });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const h = 120 + Math.random() * 200, r = 150 + Math.random() * 150;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1), mMat);
    const d = 900 + Math.random() * 200;
    m.position.set(Math.cos(a) * d, h / 2 - 30, Math.sin(a) * d);
    const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, h * 0.3, 7, 1), snowMat); s.position.y = h * 0.35 + 0.5;
    m.add(s); mountains.add(m);
  }
  scene.add(mountains);
  makeParticles();
}

function mergeGeos(geos) {
  // tiny merge (non-indexed) to avoid extra deps
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  const count = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function buildChunk(idx) {
  const z0 = idx * CHUNK, rows = CHUNK / SEG + 1;
  const group = new THREE.Group();
  // --- road
  {
    const pos = [], uv = [], ind = [];
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z), y = roadY(z) + 0.02;
      pos.push(cx - ROAD_HALF, y, z, cx + ROAD_HALF, y, z);
      uv.push(0, z / 24, 1, z / 24);
      if (r) { const a = (r - 1) * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind); g.computeVertexNormals();
    const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; group.add(m);
  }
  // --- terrain
  {
    const offs = [-600, -350, -220, -150, -100, -70, -45, -30, -20, -14, -13.2, 13.2, 14, 20, 30, 45, 70, 100, 150, 220, 350, 600];
    const pos = [], uv = [], ind = [], cols = offs.length;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z);
      for (let c = 0; c < cols; c++) {
        const x = cx + offs[c];
        const y = Math.abs(offs[c]) < 13.5 ? roadY(z) - 0.05 : terrainY(x, z);
        pos.push(x, y, z); uv.push(x / 14, z / 14);
        if (r && c) { const a = (r - 1) * cols + c - 1, b = r * cols + c - 1; ind.push(a, b, a + 1, a + 1, b, b + 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind); g.computeVertexNormals();
    const m = new THREE.Mesh(g, grassMat); m.receiveShadow = true; group.add(m);
  }
  // --- W-beam guard rails (corrugated ribbon) + posts + delineators
  {
    const PROF_Y = [0.30, 0.42, 0.54, 0.66, 0.78], PROF_O = [0, 0.075, 0.025, 0.075, 0];
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), postMat, rows * 2);
    const refl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.14, 0.03), reflectMat, Math.ceil(rows / 4) * 2);
    const dummy = new THREE.Object3D();
    let ri = 0, pi = 0;
    for (const side of [-1, 1]) {
      const pos = [], ind = [];
      for (let r = 0; r < rows; r++) {
        const z = z0 + r * SEG, x0 = roadX(z) + side * RAIL, y0 = roadY(z);
        for (let k = 0; k < PROF_Y.length; k++) pos.push(x0 + side * PROF_O[k], y0 + PROF_Y[k], z);
        if (r) for (let k = 0; k < PROF_Y.length - 1; k++) {
          const a = (r - 1) * PROF_Y.length + k, b = a + 1, c = a + PROF_Y.length, d = c + 1;
          if (side > 0) ind.push(a, c, b, b, c, d); else ind.push(a, b, c, b, d, c);
        }
        if (r % 2 === 0) { dummy.position.set(x0 + side * 0.14, y0 + 0.5, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(pi++, dummy.matrix); }
        if (r % 4 === 0 && ri < Math.ceil(rows / 4) * 2) {
          dummy.position.set(x0 - side * 0.06, y0 + 0.6, z); dummy.rotation.set(0, Math.atan(roadDX(z)) + (side > 0 ? Math.PI : 0), 0); dummy.updateMatrix();
          refl.setMatrixAt(ri++, dummy.matrix);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
      const m = new THREE.Mesh(g, railMat); m.castShadow = true; group.add(m);
    }
    posts.count = pi; refl.count = ri;
    posts.castShadow = true; group.add(posts); group.add(refl);
    // --- centre median: concrete jersey barrier (F-shape profile ribbon)
    const JP = [[-0.44, 0.04], [-0.44, 0.30], [-0.26, 0.66], [-0.19, 1.08], [0.19, 1.08], [0.26, 0.66], [0.44, 0.30], [0.44, 0.04]];
    const wp = [], wuv = [], wi = [];
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z), y = roadY(z) + 0.02;
      for (let k = 0; k < JP.length; k++) { wp.push(cx + JP[k][0], y + JP[k][1], z); wuv.push(k * 0.35, z); }
      if (r) for (let k = 0; k < JP.length - 1; k++) {
        const a = (r - 1) * JP.length + k, b = a + 1, c = a + JP.length, d = c + 1;
        wi.push(a, b, c, b, d, c);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    wg.setIndex(wi); wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, concreteMat); wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
    // --- noise-barrier wall on some stretches (deterministic per chunk)
    if (((idx * 2654435761) >>> 0) % 5 === 0) {
      const side = (((idx * 40503) >>> 0) % 2) ? 1 : -1;
      const sp = [], suv = [], si = [];
      for (let r = 0; r < rows; r++) {
        const z = z0 + r * SEG, x = roadX(z) + side * 18.5, y = terrainY(x, z);
        sp.push(x, y - 0.2, z, x, y + 4.2, z); suv.push(z, 0, z, 4.2);
        if (r) { const a = (r - 1) * 2, b = a + 1, c = a + 2, d = a + 3; if (side > 0) si.push(a, c, b, b, c, d); else si.push(a, b, c, b, d, c); }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
      sg.setIndex(si); sg.computeVertexNormals();
      const sm = new THREE.Mesh(sg, soundMat); sm.castShadow = true; group.add(sm);
    }
  }
  scene.add(group);
  return group;
}

function updateChunks(z) {
  const c = Math.floor(z / CHUNK);
  for (let i = c - 1; i <= c + 4; i++) if (!chunks.has(i)) chunks.set(i, buildChunk(i));
  for (const [i, g] of chunks) {
    if (i < c - 1 || i > c + 4) {
      g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      scene.remove(g); chunks.delete(i);
    }
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
function updateScenery(pz) {
  // wind turbines
  for (let i = 0; i < turbineList.length; i++) {
    const t = turbineList[i];
    if (t.z < pz - 130 || t.z > pz + 1000) {
      t.z = (t.z < -1e8 ? pz - 100 + i * 180 : pz + 850 + Math.random() * 140);
      const side = i % 2 ? 1 : -1;
      const x = roadX(t.z) + side * (60 + Math.random() * 120);
      const s = 0.85 + Math.random() * 0.6;
      t.group.position.set(x, terrainY(x, t.z) - 0.3, t.z);
      t.group.rotation.y = Math.random() * Math.PI * 2;
      t.group.scale.set(s, s, s);
    }
  }
  // gantry arches
  for (let i = 0; i < archList.length; i++) {
    const a = archList[i];
    if (a.z < pz - 60 || a.z > pz + 1000) {
      a.z = (a.z < -1e8 ? pz + 150 + i * 200 : pz + 880 + Math.random() * 120);
      a.group.position.set(roadX(a.z), roadY(a.z), a.z);
      a.group.rotation.y = Math.atan(roadDX(a.z));
    }
  }
  if (scenery) scenery.update(pz, roadX(pz));
}

function animateLandmarks(dt) {
  for (const t of turbineList) t.rotor.rotation.z += dt * t.spin;
  const on = ((gameTime * 2) | 0) % 2 === 0;
  for (const a of archList) for (const l of a.group.userData.lamps) l.visible = on;
}

// =====================================================================
//  PARTICLES (smoke / sparks / nitro flames)
// =====================================================================
let particles;
function makeParticles() {
  const N = 600;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    uniforms: { scale: { value: innerHeight / 2 } },
    vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor = vec4(vC, (0.5-d)*1.6); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  scene.add(pts);
  particles = { pts, N, list: Array.from({ length: N }, () => ({ life: 0 })), i: 0 };
}
function emit(x, y, z, vx, vy, vz, life, size, r, g, b, grow = 0) {
  const p = particles.list[particles.i]; particles.i = (particles.i + 1) % particles.N;
  Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, r, g, b, grow });
}
function updateParticles(dt) {
  const pos = particles.pts.geometry.attributes.position.array, col = particles.pts.geometry.attributes.color.array, sz = particles.pts.geometry.attributes.size.array;
  particles.list.forEach((p, i) => {
    if (p.life > 0) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= p.grow ? -0.5 * dt : 9 * dt; p.size += p.grow * dt;
      const k = Math.max(0, p.life / p.max);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r * k; col[i * 3 + 1] = p.g * k; col[i * 3 + 2] = p.b * k; sz[i] = p.size;
    } else sz[i] = 0;
  });
  particles.pts.geometry.attributes.position.needsUpdate = particles.pts.geometry.attributes.color.needsUpdate = particles.pts.geometry.attributes.size.needsUpdate = true;
}

// =====================================================================
//  GAME STATE
// =====================================================================
let state = 'loading';
let difficulty = 1, playerColor = CAR_COLORS[0];
let player = null;
const traffic = [], obstacles = [], pickups = [];
const keys = {};
let camMode = 0, shake = 0, gameTime = 0;
const S = {}; // run stats

function resetGame() {
  // clear
  traffic.forEach(t => scene.remove(t.root)); traffic.length = 0;
  obstacles.forEach(o => scene.remove(o.mesh)); obstacles.length = 0;
  pickups.forEach(o => scene.remove(o.mesh)); pickups.length = 0;
  if (player) scene.remove(player.root);
  if (selectedCarId === 'SPIDER' && playerCarRig) player = wrapGlb(playerCarRig, playerColor);
  else player = buildPlayableCar(selectedCarId, playerColor);
  player.setHead(true);
  scene.add(player.root);
  Object.assign(player, { x: roadX(0) + 2, z: 0, heading: Math.atan(roadDX(0)), v: 0, steer: 0, gear: 1, rpm: 900, nitro: 100, health: 100, invuln: 0, skid: 0, scrape: 0, spin: 0, lat: 2, steerF: player.steer || 1, vmax: player.vmax || 72, vmaxN: player.vmaxN || 92 });
  Object.assign(S, { score: 0, dist: 0, near: 0, top: 0, mult: 1, multTimer: 0, nextWork: 400, nextPickup: 300, nextPad: 700, over: false, overTimer: 0, runEnded: false, revived: false });
  gameTime = 0;
  shake = 0;
  updateChunks(0); updateScenery(0);
  if (scenery) scenery.reset(0, player.x);
}

// ----- traffic -----
function spawnTraffic() {
  const d = DIFF[difficulty];
  const level = Math.min(1, S.dist / 15000) * d.ramp;
  const want = Math.round(d.traffic * (1 + level));
  const active = traffic.filter(t => !t.dead).length;
  if (active >= want) return;
  const laneIdx = (Math.random() * LANES.length) | 0;
  const lane = LANES[laneIdx];
  const oncoming = laneIdx < LANES.length / 2;
  const z = player.z + 260 + Math.random() * 280;
  if (traffic.some(t => Math.abs(t.lane - lane) < 1 && Math.abs(t.z - z) < 35)) return;
  if (obstacles.some(o => Math.abs(o.lat - lane) < 2 && Math.abs(o.z - z) < 50)) return;
  const truck = Math.random() < 0.25;
  const car = makeTrafficVehicle(truck);
  const spdR = oncoming ? d.oncomingSpd : d.sameSpd;
  let spd = (spdR[0] + Math.random() * (spdR[1] - spdR[0])) * (truck ? 0.8 : 1) * (1 + level * 0.25);
  Object.assign(car, { lane, targetLane: lane, z, speed: oncoming ? -spd : spd, baseSpeed: spd, oncoming, truck, passed: false, crashed: false, spinV: 0, yaw: 0, dead: false, honked: false, laneTimer: 3 + Math.random() * 6 });
  scene.add(car.root);
  traffic.push(car);
}

function updateTraffic(dt) {
  for (const t of traffic) {
    if (t.crashed) {
      t.speed *= Math.pow(0.3, dt); t.yaw += t.spinV * dt; t.spinV *= Math.pow(0.4, dt);
      t.lane += t.latV * dt; t.latV *= Math.pow(0.3, dt);
      t.lane = THREE.MathUtils.clamp(t.lane, -DRIVE_LIMIT, DRIVE_LIMIT);
    } else {
      // keep distance to car in front in same lane
      const dir = Math.sign(t.speed);
      let desired = t.baseSpeed * dir;
      for (const o of traffic) {
        if (o === t || Math.abs(o.lane - t.lane) > 2) continue;
        const gap = (o.z - t.z) * dir;
        if (gap > 0 && gap < 22 + t.halfL + o.halfL) desired = Math.min(Math.abs(desired), Math.abs(o.speed) * 0.9) * dir;
      }
      // same-direction cars sometimes change lane (with blinker-like brake flash)
      if (!t.oncoming && !t.truck) {
        t.laneTimer -= dt;
        if (t.laneTimer < 0) {
          t.laneTimer = 4 + Math.random() * 8;
          const dirLanes = LANES.filter(l => l > 0);
          const li = dirLanes.indexOf(t.targetLane);
          const cands = [dirLanes[li - 1], dirLanes[li + 1]].filter(l => l !== undefined);
          const nl = cands.length ? cands[(Math.random() * cands.length) | 0] : t.targetLane;
          if (!traffic.some(o => o !== t && Math.abs(o.lane - nl) < 1.5 && Math.abs(o.z - t.z) < 20) &&
              !obstacles.some(o => Math.abs(o.lat - nl) < 2 && o.z - t.z > -10 && o.z - t.z < 60)) t.targetLane = nl;
        }
      }
      // avoid roadworks in own lane
      for (const o of obstacles) if (o.kind === 'barrier' && Math.abs(o.lat - t.targetLane) < 2 && (o.z - t.z) * dir > 0 && (o.z - t.z) * dir < 70) {
        const dirLanes = LANES.filter(l => (t.oncoming ? l < 0 : l > 0));
        const li = dirLanes.indexOf(t.targetLane);
        const cands = [dirLanes[li - 1], dirLanes[li + 1]].filter(l => l !== undefined && Math.abs(l - o.lat) > 2.2);
        if (cands.length) t.targetLane = cands[(Math.random() * cands.length) | 0];
      }
      t.lane += THREE.MathUtils.clamp(t.targetLane - t.lane, -2.2 * dt, 2.2 * dt);
      t.speed += THREE.MathUtils.clamp(desired - t.speed, -12 * dt, 5 * dt);
      t.yaw = (t.targetLane - t.lane) * 0.06 * Math.sign(t.speed);
      t.brakeMat.emissiveIntensity = (Math.abs(t.speed) < Math.abs(desired) - 0.5 || Math.abs(desired) < t.baseSpeed - 1) ? 2.8 : 0.15;
    }
    t.z += t.speed * dt;
    const x = roadX(t.z) + t.lane, y = roadY(t.z);
    t.root.position.set(x, y, t.z);
    t.root.rotation.set(-Math.atan(roadDY(t.z)) * (t.oncoming ? -1 : 1), Math.atan(roadDX(t.z)) + (t.oncoming ? Math.PI : 0) + t.yaw, 0);
    t.wheels.forEach(w => w.rotation.x += t.speed * dt / 0.36 * (t.oncoming ? -1 : 1));
    if (t.z < player.z - 60 || t.z > player.z + 700) t.dead = true;
  }
  for (let i = traffic.length - 1; i >= 0; i--) if (traffic[i].dead) { scene.remove(traffic[i].root); traffic.splice(i, 1); }
}

// ----- roadworks (obstacles) & pickups -----
const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 12); coneGeo.translate(0, 0.375, 0);
const coneMat = new THREE.MeshStandardMaterial({ color: '#ff5a00', roughness: 0.5 });
let barrierAssets = null;
function getBarrierAssets() {
  // Built once: the striped canvas texture was previously re-created (and
  // leaked) for every single barrier spawned.
  if (barrierAssets) return barrierAssets;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#fff' : '#e21'; x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16, 32); x.lineTo(i * 16 - 16, 32); x.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  barrierAssets = {
    boardGeo: new THREE.BoxGeometry(3.4, 0.5, 0.12),
    boardMat: new THREE.MeshStandardMaterial({ map: tex, emissive: '#330000' }),
    legGeo: new THREE.BoxGeometry(0.12, 1.2, 0.8),
    lampGeo: new THREE.SphereGeometry(0.12, 8, 8),
    lampMat: new THREE.MeshBasicMaterial({ color: '#ffae00' }),
  };
  return barrierAssets;
}
// Boost pad: bright chevrons painted on the lane — drive over for free nitro + a speed kick.
const padTexture = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,36,22,0.88)'; g.fillRect(0, 0, 128, 160);
  g.strokeStyle = '#37e08c'; g.lineWidth = 6; g.strokeRect(4, 4, 120, 152);
  g.fillStyle = '#ffd23f';
  for (let i = 0; i < 3; i++) {
    const y = 34 + i * 46;
    g.beginPath(); g.moveTo(64, y + 22); g.lineTo(26, y - 12); g.lineTo(102, y - 12); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const padGeo = new THREE.PlaneGeometry(3.4, 4.6);
const padMat = new THREE.MeshBasicMaterial({ map: padTexture, transparent: true, opacity: 0.95, depthWrite: false });
function spawnBoostPad(z) {
  const m = new THREE.Mesh(padGeo, padMat);
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
  scene.add(m);
  pickups.push({ mesh: m, z, lat: LANES[(Math.random() * LANES.length) | 0], kind: 'boost', taken: false });
}

function barrierMesh() {
  const a = getBarrierAssets();
  const g = new THREE.Group();
  const board = new THREE.Mesh(a.boardGeo, a.boardMat);
  board.position.y = 1.0; board.castShadow = true; g.add(board);
  for (const s of [-1.5, 1.5]) { const l = new THREE.Mesh(a.legGeo, postMat); l.position.set(s, 0.6, 0); g.add(l); }
  const lamp = new THREE.Mesh(a.lampGeo, a.lampMat);
  lamp.position.set(0, 1.4, 0); g.add(lamp); g.userData.lamp = lamp;
  return g;
}
function spawnRoadworks(z) {
  const lane = LANES[(Math.random() * LANES.length) | 0];
  const len = 40 + Math.random() * 40;
  // barriers at start + end, cones between
  for (const dz of [0, len]) {
    const m = barrierMesh(); scene.add(m);
    obstacles.push({ mesh: m, z: z + dz, lat: lane, kind: 'barrier', halfL: 0.5, halfW: 1.7, hit: false });
  }
  for (let d = -12; d <= len; d += 6) {
    const lat = lane + (d < 0 ? (lane > 0 ? -1 : 1) * (1.9 + d / 12 * 1.9) : (lane > 0 ? -1.9 : 1.9));
    const m = new THREE.Mesh(coneGeo, coneMat); m.castShadow = true; scene.add(m);
    obstacles.push({ mesh: m, z: z + d, lat, kind: 'cone', halfL: 0.3, halfW: 0.3, hit: false, vy: 0, vx: 0, vz: 0, y: 0 });
  }
}
let pickupAssets = null;
function getPickupAssets() {
  // Shared geometry/materials — spawning used to allocate new ones per pickup.
  if (pickupAssets) return pickupAssets;
  pickupAssets = {
    nitroGeo: new THREE.CylinderGeometry(0.35, 0.35, 1.1, 16),
    repairGeo: new THREE.BoxGeometry(0.8, 0.8, 0.8),
    nitroMat: new THREE.MeshStandardMaterial({ color: '#00b7ff', emissive: '#0066ff', emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.3 }),
    repairMat: new THREE.MeshStandardMaterial({ color: '#22dd55', emissive: '#11aa33', emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.3 }),
    ringGeo: new THREE.TorusGeometry(0.9, 0.06, 8, 32),
    nitroRingMat: new THREE.MeshBasicMaterial({ color: '#7fe3ff' }),
    repairRingMat: new THREE.MeshBasicMaterial({ color: '#9dff9d' }),
  };
  return pickupAssets;
}
function spawnPickup(z) {
  const nitro = Math.random() < 0.65;
  const a = getPickupAssets();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(nitro ? a.nitroGeo : a.repairGeo, nitro ? a.nitroMat : a.repairMat));
  g.add(new THREE.Mesh(a.ringGeo, nitro ? a.nitroRingMat : a.repairRingMat));
  scene.add(g);
  pickups.push({ mesh: g, z, lat: LANES[(Math.random() * LANES.length) | 0], kind: nitro ? 'nitro' : 'repair', taken: false });
}

function updateObstacles(dt) {
  for (const o of obstacles) {
    if (o.kind === 'cone' && o.hit) {
      o.vy -= 20 * dt; o.y += o.vy * dt; o.lat += o.vx * dt; o.z += o.vz * dt;
      if (o.y < 0) { o.y = 0; o.vy *= -0.3; o.vx *= 0.7; o.vz *= 0.7; }
      o.mesh.rotation.x += dt * 8; o.mesh.rotation.z += dt * 5;
    }
    o.mesh.position.set(roadX(o.z) + o.lat, roadY(o.z) + (o.y || 0), o.z);
    if (o.kind === 'barrier') { o.mesh.rotation.y = Math.atan(roadDX(o.z)); o.mesh.userData.lamp.visible = (gameTime * 3 | 0) % 2 === 0; }
  }
  for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].z < player.z - 50) { scene.remove(obstacles[i].mesh); obstacles.splice(i, 1); }
  for (const p of pickups) {
    if (p.kind === 'boost') {
      // pads sit flat on the tarmac
      p.mesh.position.set(roadX(p.z) + p.lat, roadY(p.z) + 0.05, p.z);
    } else {
      p.mesh.position.set(roadX(p.z) + p.lat, roadY(p.z) + 1 + Math.sin(gameTime * 3 + p.z) * 0.2, p.z);
      p.mesh.rotation.y += dt * 2;
    }
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].taken || pickups[i].z < player.z - 30) { scene.remove(pickups[i].mesh); pickups.splice(i, 1); }
}

// =====================================================================
//  PLAYER PHYSICS
// =====================================================================
const GEARS = [0, 16, 30, 44, 58, 72, 100]; // m/s top of each gear
function updatePlayer(dt) {
  const p = player;
  const up = keys.ArrowUp || keys.KeyW || keys.gas, down = keys.ArrowDown || keys.KeyS || keys.brake;
  const left = keys.ArrowLeft || keys.KeyA || keys.left, right = keys.ArrowRight || keys.KeyD || keys.right;
  const hand = keys.Space;
  const wantNitro = (keys.ShiftLeft || keys.ShiftRight || keys.nitro) && p.nitro > 0 && up && !S.over;
  const alive = !S.over;

  const throttle = alive && up ? 1 : 0;
  p.throttle = throttle;
  p.nitroOn = wantNitro;
  const vmax = wantNitro ? (p.vmaxN || 92) : (p.vmax || 72);
  let acc = 0;
  if (throttle) {
    if (p.v < 0) acc = 25; else acc = (wantNitro ? 18 : 11) * Math.pow(Math.max(0, 1 - p.v / vmax), 0.6) + 1.5;
  }
  if (alive && down) acc = p.v > 0.5 ? -28 : -6;
  if (hand && alive) acc -= p.v > 0 ? 9 : 0;
  acc -= 0.4 + 0.00035 * p.v * p.v * Math.sign(p.v) + (Math.abs(p.v) < 0.5 && !throttle && !down ? p.v * 5 : 0);
  p.v = Math.max(-10, p.v + acc * dt);
  if (!throttle && !down && Math.abs(p.v) < 0.3) p.v = 0;
  if (wantNitro) p.nitro = Math.max(0, p.nitro - 22 * dt); else p.nitro = Math.min(100, p.nitro + 2 * dt);

  // steering
  const sIn = alive ? (left ? 1 : 0) - (right ? 1 : 0) : 0;
  p.steer += (sIn - p.steer) * Math.min(1, dt * (sIn ? 5 : 8));
  const speedFactor = Math.min(1, Math.abs(p.v) / 6) / (1 + Math.abs(p.v) * 0.028);
  let yaw = p.steer * 1.9 * (p.steerF || 1) * speedFactor * (hand ? 1.7 : 1);
  p.heading += (yaw * Math.sign(p.v) + p.spin) * dt;
  p.spin *= Math.pow(0.05, dt);

  // road-relative
  const ra = Math.atan(roadDX(p.z));
  let rel = p.heading - ra;
  // drift / skid amount
  p.skid = THREE.MathUtils.clamp((Math.abs(p.steer) * p.v - 38) / 25, 0, 1);
  if (hand && p.v > 10) p.skid = Math.max(p.skid, 0.8);
  if (down && p.v > 20) p.skid = Math.max(p.skid, 0.5);

  p.x += Math.sin(p.heading) * p.v * dt;
  p.z += Math.cos(p.heading) * p.v * dt;
  p.lat = p.x - roadX(p.z);
  p.scrape = 0;
  if (Math.abs(p.lat) > DRIVE_LIMIT) {
    const side = Math.sign(p.lat);
    p.lat = side * DRIVE_LIMIT; p.x = roadX(p.z) + p.lat;
    // Bleed off the sideways heading component so the car settles along the rail.
    p.heading = ra + (p.heading - ra) * 0.5 - side * 0.02;
    p.v *= Math.pow(0.55, dt);
    if (p.v > 8) {
      p.scrape = Math.min(1, p.v / 40);
      damage(dt * 4 * p.scrape, false);
      for (let i = 0; i < 3; i++) emit(p.x + side * 1, roadY(p.z) + 0.6, p.z + 1, -side * Math.random() * 3, Math.random() * 4, p.v * 0.3 + Math.random() * 3, 0.4, 0.3, 1, 0.7, 0.2);
      shake = Math.max(shake, 0.15);
    }
  }
  // centre-median rumble: grinding the concrete divider hurts a little
  // (p.scrape was reset earlier; rail scrape above must not be wiped)
  if (Math.abs(p.lat) < 0.62 && Math.abs(p.v) > 4) {
    shake = Math.max(shake, 0.06);
    p.scrape = 0.35;
    p.v *= Math.pow(0.985, dt);
    damage(dt * 1.5, false);
    if (Math.random() < dt * 22) emit(p.x, roadY(p.z) + 0.25, p.z + 0.5, (Math.random() - 0.5) * 3, Math.random() * 3, p.v * 0.4, 0.3, 0.25, 1, 0.8, 0.3);
  }
  S.wrongWay = Math.abs(rel) > Math.PI / 2 && p.v > 3;

  // gear / rpm
  const av = Math.abs(p.v);
  let g = 1; while (g < 6 && av > GEARS[g] * 0.97) g++;
  if (g !== p.gear) { if (g > p.gear) audio.gearShift(); p.gear = g; }
  const lo = GEARS[g - 1] * 0.7, hi = GEARS[g];
  const targetRpm = 900 + Math.max(0, (av - lo) / (hi - lo)) * 6800 + (throttle && av < 2 ? 2500 : 0);
  p.rpm += (Math.min(8200, targetRpm) - p.rpm) * Math.min(1, dt * 8);

  // visuals
  const y = roadY(p.z);
  p.root.position.set(p.x, y, p.z);
  const pitch = -Math.atan(roadDY(p.z)) + (acc < -10 ? 0.02 : throttle ? -0.012 : 0);
  p.root.rotation.set(pitch, p.heading, -p.steer * Math.min(1, av / 50) * 0.04, 'YXZ');
  p.wheels.forEach((w, i) => { w.rotation.x -= p.v * dt / 0.36; if (i < 2) w.rotation.y = p.steer * 0.45; });
  p.setBrake(down || hand);

  // tyre smoke / nitro flames
  if (p.skid > 0.3) for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const bx = p.x + Math.cos(p.heading) * 0.8 * s - Math.sin(p.heading) * 1.5, bz = p.z - Math.sin(p.heading) * 0.8 * s - Math.cos(p.heading) * 1.5;
    emit(bx, y + 0.3, bz, (Math.random() - 0.5), 0.5, p.v * 0.5, 1.2, 1.2, 0.8, 0.8, 0.8, 2.5);
  }
  if (wantNitro) for (let i = 0; i < 3; i++) {
    const s = i % 2 ? 0.35 : -0.35;
    const bx = p.x + Math.cos(p.heading) * s - Math.sin(p.heading) * 2.35, bz = p.z - Math.sin(p.heading) * s - Math.cos(p.heading) * 2.35;
    emit(bx, y + 0.35, bz, -Math.sin(p.heading) * 6, 0.2, p.v - Math.cos(p.heading) * 8, 0.18, 0.5, 0.3, 0.6, 1.0, -1);
  }
  if (p.health < 40) emit(p.x + Math.sin(p.heading) * 1.8, y + 0.9, p.z + Math.cos(p.heading) * 1.8, 0, 1.5, p.v * 0.7, 1.4, 0.8, 0.25, 0.25, 0.25, 2);

  p.invuln = Math.max(0, p.invuln - dt);
  p.root.visible = !(p.invuln > 0 && ((p.invuln * 12) | 0) % 2 === 0 && !S.over);
}

function damage(amount, flash = true) {
  const p = player;
  p.health = Math.max(0, p.health - amount);
  if (flash) { const f = document.getElementById('flash'); f.style.background = '#f00'; f.style.opacity = 0.45; setTimeout(() => f.style.opacity = 0, 80); }
  if (p.health <= 0 && !S.over) endGame();
}

// =====================================================================
//  COLLISIONS & SCORING
// =====================================================================
function collisions() {
  const p = player;
  for (const t of traffic) {
    const dz = t.z - p.z, dl = t.lane - p.lat;
    const hitL = t.halfL + 2.2, hitW = t.halfW + 0.95;
    if (!t.crashed && p.invuln <= 0 && Math.abs(dz) < hitL && Math.abs(dl) < hitW) {
      const relV = p.v - t.speed;
      const power = Math.min(1, Math.abs(relV) / 50);
      audio.crash(0.5 + power * 0.6);
      damage(12 + Math.abs(relV) * 0.9);
      shake = 1 + power;
      t.crashed = true; t.spinV = (Math.random() - 0.5) * 6; t.latV = -Math.sign(dl || 1) * -4;
      t.speed = t.speed + relV * 0.6;
      p.v = Math.min(p.v, t.speed) * 0.5;
      p.spin = (Math.random() < 0.5 ? -1 : 1) * (1 + power * 2);
      p.invuln = 1.6;
      S.mult = 1;
      for (let i = 0; i < 40; i++) emit(p.x, roadY(p.z) + 0.8, p.z + dz / 2, (Math.random() - 0.5) * 12, Math.random() * 8, p.v + (Math.random() - 0.5) * 12, 0.7, 0.35, 1, 0.8, 0.3);
      for (let i = 0; i < 10; i++) emit(p.x, roadY(p.z) + 0.8, p.z + dz / 2, (Math.random() - 0.5) * 2, 1, p.v * 0.5, 2, 2, 0.35, 0.35, 0.35, 3);
      popup('CRASH!', '#ff3b3b');
    }
    // near miss / overtakes
    if (!t.passed && dz < -t.halfL - 2.2) {
      t.passed = true;
      if (!t.crashed && Math.abs(dl) < 3.4 && p.v > 22) {
        S.near++; const bonus = Math.round((t.oncoming ? 500 : 250) * S.mult);
        S.score += bonus; S.mult = Math.min(8, S.mult + 1); S.multTimer = 6;
        popup((t.oncoming ? 'HEAD-ON NEAR MISS +' : 'NEAR MISS +') + bonus, t.oncoming ? '#ff8c00' : '#ffd23f');
        audio.whoosh(0.6, Math.sign(dl) * 0.7);
      } else if (!t.crashed && p.v > 15) audio.whoosh(0.25, Math.sign(dl) * 0.7);
    }
    // oncoming drivers honk when you're in their lane
    if (t.oncoming && !t.honked && !t.crashed && dz > 20 && dz < 80 && Math.abs(dl) < 2.2) { t.honked = true; audio.trafficHorn(THREE.MathUtils.clamp(dl / 6, -1, 1)); }
  }
  for (const o of obstacles) {
    if (o.hit) continue;
    const dz = o.z - p.z, dl = o.lat - p.lat;
    if (Math.abs(dz) < o.halfL + 2.2 && Math.abs(dl) < o.halfW + 0.95) {
      o.hit = true;
      if (o.kind === 'cone') {
        o.vy = 5 + Math.random() * 4; o.vz = p.v * 0.8; o.vx = (Math.random() - 0.5) * 6; o.y = 0.01;
        audio.whoosh(0.3); damage(2, false); S.score = Math.max(0, S.score - 50); p.v *= 0.97;
      } else if (p.invuln <= 0) {
        audio.crash(0.9); damage(20 + p.v * 0.6); shake = 1.5; p.v *= 0.25; p.spin = (Math.random() < 0.5 ? -1 : 1) * 2; p.invuln = 1.2; S.mult = 1;
        o.mesh.rotation.x = -1.3;
        popup('ROADWORKS!', '#ff3b3b');
      }
    }
  }
  for (const k of pickups) {
    if (!k.taken && Math.abs(k.z - p.z) < 2.6 && Math.abs(k.lat - p.lat) < 1.8) {
      k.taken = true;
      if (k.kind === 'nitro') { p.nitro = Math.min(100, p.nitro + 40); popup('+NITRO', '#00e5ff'); audio.pickup(); }
      else if (k.kind === 'repair') { p.health = Math.min(100, p.health + 30); popup('+REPAIR', '#3bff7a'); audio.pickup([520, 780, 1040]); }
      else { // boost pad: instant nitro top-up + speed kick
        p.nitro = Math.min(100, p.nitro + 30);
        p.v = Math.min(p.v + 6, 96);
        shake = Math.max(shake, 0.25);
        popup('BOOST PAD!', '#ffd23f'); audio.pickup([392, 523, 784]);
      }
    }
  }
}

let lastPop = 0;
function popup(text, color) {
  const now = performance.now(); if (now - lastPop < 150) return; lastPop = now;
  const d = document.createElement('div'); d.className = 'pop'; d.textContent = text; d.style.color = color;
  document.getElementById('popups').appendChild(d); setTimeout(() => d.remove(), 1300);
}

// =====================================================================
//  CAMERA
// =====================================================================
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const CAM_NAMES = ['CHASE', 'LONG SHOT', 'HOOD', 'CINEMATIC', 'SKY CAM', 'REAR VIEW'];
function updateCamera(dt, snap = false) {
  const p = player, h = p.heading - p.spin * 0.1;
  const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  const y = roadY(p.z);
  let tp, tl;
  if (camMode === 0) { tp = new THREE.Vector3(p.x, y + 2.6, p.z).addScaledVector(fwd, -6.8); tl = new THREE.Vector3(p.x, y + 1.1, p.z).addScaledVector(fwd, 6); }
  else if (camMode === 1) { tp = new THREE.Vector3(p.x, y + 4.5, p.z).addScaledVector(fwd, -11); tl = new THREE.Vector3(p.x, y + 1, p.z).addScaledVector(fwd, 10); }
  else if (camMode === 2) { tp = new THREE.Vector3(p.x, y + 1.1, p.z).addScaledVector(fwd, 0.2); tl = new THREE.Vector3(p.x, y + 1.0, p.z).addScaledVector(fwd, 20); }
  else if (camMode === 3) { // cinematic: low, off-axis action angle
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    tp = new THREE.Vector3(p.x, y + 0.7, p.z).addScaledVector(fwd, 4.5).addScaledVector(side, 5.2);
    tl = new THREE.Vector3(p.x, y + 0.9, p.z).addScaledVector(fwd, 2);
  }
  else if (camMode === 4) { // sky cam: helicopter-style top-down
    tp = new THREE.Vector3(p.x, y + 42, p.z - 7);
    tl = new THREE.Vector3(p.x, y, p.z + 3);
  }
  else { // rear view: look back past the car (great for near misses)
    tp = new THREE.Vector3(p.x, y + 1.7, p.z).addScaledVector(fwd, 5.5);
    tl = new THREE.Vector3(p.x, y + 1.0, p.z).addScaledVector(fwd, -30);
  }
  if (tp.y < terrainY(tp.x, tp.z) + 0.5) tp.y = terrainY(tp.x, tp.z) + 0.5;
  const k = snap ? 1 : Math.min(1, dt * (camMode === 2 ? 30 : camMode >= 4 ? 14 : 7));
  camPos.lerp(tp, k); camLook.lerp(tl, snap ? 1 : Math.min(1, dt * 12));
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.4; camera.position.y += (Math.random() - 0.5) * shake * 0.3; shake = Math.max(0, shake - dt * 2.5); }
  if (p.nitroOn) camera.position.x += (Math.random() - 0.5) * 0.05;
  camera.lookAt(camLook);
  const fov = 60 + Math.min(22, Math.abs(p.v) * 0.18) + (p.nitroOn ? 6 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  mountains.position.set(camera.position.x, 0, camera.position.z);
  if (scenery) for (const g of scenery.follow) g.position.set(camera.position.x, 0, camera.position.z);
  sun.position.set(p.x + 30, y + 60, p.z - 20); sun.target.position.set(p.x, y, p.z + 10);
}

// =====================================================================
//  HUD
// =====================================================================
const el = id => document.getElementById(id);
const gauge = el('gauge').getContext('2d'), mini = el('minimap').getContext('2d');
let best = +localStorage.getItem('hr3d_best') || 0;
function drawHUD() {
  const p = player;
  el('score').textContent = Math.floor(S.score).toLocaleString();
  el('dist').textContent = (S.dist / 1000).toFixed(2) + ' km';
  el('mult').textContent = 'x' + S.mult;
  el('best').textContent = Math.max(best, Math.floor(S.score)).toLocaleString();
  el('healthbar').style.width = p.health + '%';
  el('nitrobar').style.width = p.nitro + '%';
  el('warning').classList.toggle('hidden', !S.wrongWay);

  // gauge
  const g = gauge, W = 260, c = W / 2;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(c, c, 124, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  for (let i = 0; i <= 80; i++) {
    const a = a0 + (a1 - a0) * i / 80, big = i % 10 === 0;
    g.strokeStyle = i >= 70 ? '#ff3b3b' : '#fff'; g.lineWidth = big ? 3 : 1;
    g.beginPath(); g.moveTo(c + Math.cos(a) * (big ? 98 : 104), c + Math.sin(a) * (big ? 98 : 104)); g.lineTo(c + Math.cos(a) * 112, c + Math.sin(a) * 112); g.stroke();
    if (big) { g.fillStyle = '#ccc'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText(i / 10, c + Math.cos(a) * 84, c + Math.sin(a) * 84 + 5); }
  }
  const rf = Math.min(1, p.rpm / 8000);
  g.strokeStyle = rf > 0.87 ? '#ff3b3b' : '#ffb300'; g.lineWidth = 6;
  g.beginPath(); g.arc(c, c, 118, a0, a0 + (a1 - a0) * rf); g.stroke();
  const na = a0 + (a1 - a0) * rf;
  g.strokeStyle = '#ff2a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(na) * 100, c + Math.sin(na) * 100); g.stroke();
  g.fillStyle = '#222'; g.beginPath(); g.arc(c, c, 10, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 46px sans-serif'; g.textAlign = 'center';
  g.fillText(Math.round(Math.abs(p.v) * KMH), c, c + 58);
  g.font = '12px sans-serif'; g.fillStyle = '#aaa'; g.fillText('KM/H   ×1000 RPM', c, c + 76);
  g.font = 'bold 26px sans-serif'; g.fillStyle = p.nitroOn ? '#00e5ff' : '#ffd23f';
  g.fillText(p.v < -0.5 ? 'R' : p.v === 0 ? 'N' : p.gear, c, c - 30);

  // minimap: road ahead + traffic
  const m = mini; m.clearRect(0, 0, 180, 240);
  const sc = 0.45, ox = 90, oy = 200;
  const tx = (x, z) => [ox + (x - p.x) * sc * -1, oy - (z - p.z) * sc];
  m.lineCap = 'round';
  m.strokeStyle = '#555'; m.lineWidth = 30 * sc + 4; m.beginPath();
  for (let z = p.z - 60; z < p.z + 430; z += 10) { const [a, b] = tx(roadX(z), z); z === p.z - 60 ? m.moveTo(a, b) : m.lineTo(a, b); }
  m.stroke();
  m.strokeStyle = '#f5c518'; m.lineWidth = 1; m.stroke();
  for (const t of traffic) { const [a, b] = tx(roadX(t.z) + t.lane, t.z); if (b < 0 || b > 240) continue; m.fillStyle = t.oncoming ? '#ff4040' : '#40a0ff'; m.fillRect(a - 2, b - (t.truck ? 5 : 3), 4, t.truck ? 10 : 6); }
  for (const o of obstacles) if (o.kind === 'barrier') { const [a, b] = tx(roadX(o.z) + o.lat, o.z); m.fillStyle = '#ff8c00'; m.fillRect(a - 3, b - 1, 6, 2); }
  for (const k of pickups) { const [a, b] = tx(roadX(k.z) + k.lat, k.z); m.fillStyle = k.kind === 'nitro' ? '#00e5ff' : k.kind === 'boost' ? '#ffd23f' : '#3bff7a'; m.beginPath(); m.arc(a, b, 2.5, 0, 7); m.fill(); }
  m.fillStyle = '#fff'; m.beginPath(); m.moveTo(90, 194); m.lineTo(86, 204); m.lineTo(94, 204); m.fill();
}

// =====================================================================
//  FLOW
// =====================================================================
function startGame() {
  // A menu button that was clicked keeps focus; pressing Enter afterwards would
  // natively re-click the hidden button and silently restart the race.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  // Interstitial only at a natural break (between completed runs). The manager
  // skips the ad when unavailable/cooldown and always calls back — the race
  // must start regardless of the ad outcome.
  ads.maybeShowInterstitial(beginRace);
}

function beginRace() {
  audio.init(musicData); audio.resume();
  resetGame();
  updateCamera(0.016, true);
  ['menu', 'over', 'pause'].forEach(s => el(s).classList.add('hidden'));
  el('hud').classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0) el('touch').classList.remove('hidden');
  state = 'play';
  S.runEnded = false;
  ads.gameplayStart();
  popup('GO!', '#3bff7a');
}

function endGame() {
  S.over = true; S.overTimer = 2.2; S.runEnded = true;
  ads.markRunEnded();
  ads.gameplayStop();
  popup('WRECKED', '#ff3b3b');
}
function showGameOver() {
  state = 'over';
  const sc = Math.floor(S.score);
  const nb = sc > best; if (nb) { best = sc; localStorage.setItem('hr3d_best', best); }
  el('fScore').textContent = sc.toLocaleString(); el('fDist').textContent = (S.dist / 1000).toFixed(2) + ' km';
  el('fTop').textContent = Math.round(S.top * KMH) + ' km/h'; el('fNear').textContent = S.near;
  el('newbest').classList.toggle('hidden', !nb);
  // Rewarded "second chance": offered once per run, only when the ad system
  // is actually able to deliver (SDK ready, no adblock).
  el('reviveBtn').classList.toggle('hidden', S.revived || !ads.canOfferRewarded());
  el('reviveBtn').disabled = false;
  el('over').classList.remove('hidden'); el('touch').classList.add('hidden');
}

// Granted ONLY from the rewarded ad's adFinished callback (see ads.js).
function revivePlayer() {
  const p = player;
  S.over = false; S.overTimer = 0;
  p.health = Math.max(p.health, 55);
  p.nitro = Math.max(p.nitro, 50);
  p.invuln = 3; p.spin = 0; p.skid = 0; p.scrape = 0;
  p.v = Math.min(p.v, 6);
  p.heading = Math.atan(roadDX(p.z));
  // Fair second chance: clear the traffic right around the player.
  for (const t of traffic) if (Math.abs(t.z - p.z) < 50) t.dead = true;
  el('over').classList.add('hidden');
  state = 'play';
  shake = 0;
  updateCamera(0.016, true);
  ads.gameplayStart();
  audio.resume();
  popup('SECOND CHANCE!', '#3bff7a');
}
function togglePause() {
  if (state === 'play') { state = 'pause'; el('pause').classList.remove('hidden'); audio.suspend(); ads.gameplayStop(); }
  else if (state === 'pause') { state = 'play'; el('pause').classList.add('hidden'); audio.resume(); ads.gameplayStart(); }
}
function toMenu() {
  state = 'menu'; audio.suspend(); ads.gameplayStop();
  ['over', 'pause', 'hud', 'touch'].forEach(s => el(s).classList.add('hidden'));
  el('menu').classList.remove('hidden');
}

// menu wiring
// garage chips
const carsDiv = el('cars');
CAR_LIST.forEach((c, i) => {
  const b = document.createElement('button');
  b.textContent = c.name; b.title = c.tag;
  if (c.id === selectedCarId) b.classList.add('sel');
  b.onclick = () => {
    selectedCarId = c.id;
    carsDiv.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    if (state === 'menu') { resetGame(); player.setBodyColor(playerColor); }
  };
  carsDiv.appendChild(b);
});
const colorsDiv = el('colors');
CAR_COLORS.forEach((c, i) => {
  const d = document.createElement('div'); d.style.background = c; if (!i) d.classList.add('sel');
  d.onclick = () => { playerColor = c; colorsDiv.querySelectorAll('div').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); if (player) player.setBodyColor(c); };
  colorsDiv.appendChild(d);
});
document.querySelectorAll('.diff button').forEach(b => b.onclick = () => { difficulty = +b.dataset.d; document.querySelectorAll('.diff button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
el('startBtn').onclick = startGame; el('againBtn').onclick = startGame;
el('resumeBtn').onclick = togglePause; el('quitBtn').onclick = toMenu; el('menuBtn').onclick = toMenu;
// Rewarded "second chance": revive only after the ad completes (ads.js calls
// onReward exclusively from adFinished). Closing/failing the ad grants nothing.
el('reviveBtn').onclick = () => {
  if (S.revived || !ads.canOfferRewarded()) return;
  el('reviveBtn').disabled = true;
  ads.requestRewarded({
    onReward: () => revivePlayer(),
    onDone: (ok) => {
      el('reviveBtn').classList.add('hidden');
      S.revived = true;
      if (!ok) popup('AD NOT AVAILABLE', '#ff8c00');
    },
  });
};

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return; // ignore OS key-repeat for one-shot actions below
  if (e.code === 'KeyC') { camMode = (camMode + 1) % CAM_NAMES.length; popup('CAM: ' + CAM_NAMES[camMode], '#8fe3ff'); }
  if (e.code === 'KeyM') audio.toggleMusic();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter' && (state === 'menu' || state === 'over')) startGame();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') togglePause(); });
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  if (k === 'cam') { // one-shot: cycle camera views
    b.addEventListener('touchstart', e => { e.preventDefault(); camMode = (camMode + 1) % CAM_NAMES.length; popup('CAM: ' + CAM_NAMES[camMode], '#8fe3ff'); }, { passive: false });
    return;
  }
  const set = v => e => { e.preventDefault(); keys[k] = v; };
  b.addEventListener('touchstart', set(true), { passive: false });
  b.addEventListener('touchend', set(false), { passive: false });
  // If the OS cancels the touch (incoming call, notification shade, browser
  // gesture), the button never sees touchend — release the key or it sticks.
  b.addEventListener('touchcancel', set(false), { passive: false });
});
// Never leave focus on a menu button: a later Enter/Space would re-click it.
document.addEventListener('click', e => {
  const t = e.target;
  const btn = t && t.closest ? t.closest('button') : null;
  if (btn && btn.blur) btn.blur();
});

// =====================================================================
//  MAIN LOOP
// =====================================================================
const clock = new THREE.Clock();
let menuT = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (state === 'play') {
    gameTime += dt;
    updatePlayer(dt);
    spawnTraffic();
    if (player.z > S.nextWork) { spawnRoadworks(player.z + 350); S.nextWork = player.z + (600 + Math.random() * 900) / DIFF[difficulty].work; }
    if (player.z > S.nextPickup) { spawnPickup(player.z + 300); S.nextPickup = player.z + 350 + Math.random() * 500; }
    if (player.z > S.nextPad) { spawnBoostPad(player.z + 250); S.nextPad = player.z + 450 + Math.random() * 650; }
    updateTraffic(dt); updateObstacles(dt);
    if (!S.over) collisions();
    updateChunks(player.z); updateScenery(player.z);
    animateLandmarks(dt);
    updateParticles(dt);
    // scoring
    if (!S.over && player.v > 0) {
      const oncomingLane = player.lat < 0 ? 2 : 1;
      const ds = player.v * dt;
      S.dist += ds;
      S.score += ds * 0.5 * S.mult * oncomingLane * (1 + (player.v > 55 ? 1 : 0));
    }
    S.top = Math.max(S.top, player.v);
    S.multTimer -= dt; if (S.multTimer <= 0 && S.mult > 1) { S.mult--; S.multTimer = 4; }
    if (S.over) { S.overTimer -= dt; if (S.overTimer <= 0) showGameOver(); }
    updateCamera(dt);
    drawHUD();
    audio.update({ active: true, rpm: player.rpm, throttle: player.throttle, speed: Math.abs(player.v), skid: player.skid, scrape: player.scrape, nitro: player.nitroOn, horn: !!keys.KeyH && !S.over });
  } else if (state === 'menu') {
    // showroom orbit
    if (!player) resetGame();
    menuT += dt;
    animateLandmarks(dt);
    updateParticles(dt);
    const r = 7.5, y = roadY(player.z);
    camera.position.set(player.x + Math.sin(menuT * 0.3) * r, y + 2.2, player.z + Math.cos(menuT * 0.3) * r);
    camera.lookAt(player.x, y + 0.6, player.z);
    camera.fov = 50; camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
    mountains.position.set(camera.position.x, 0, camera.position.z);
    if (scenery) for (const g of scenery.follow) g.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(player.x + 30, y + 60, player.z - 20); sun.target.position.set(player.x, y, player.z);
  } else if (state === 'over' || state === 'pause') {
    // keep scene rendered; fade engine/wind loops out so they don't drone forever
    audio.update({ active: false, rpm: 900, throttle: 0, speed: 0, skid: 0, scrape: 0, nitro: false, horn: false });
  }
  renderer.render(scene, camera);
}
loop();
