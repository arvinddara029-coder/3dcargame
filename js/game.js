import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GameAudio } from './audio.js';
import { ads } from './ads.js';

// =====================================================================
//  CONSTANTS / ROAD MATH
// =====================================================================
const ROAD_HALF = 13;           // total half width (incl. shoulder) — superwide 8-lane highway
const RAIL = 13.8;              // guard rail lateral offset
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
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
} catch (error) {
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
scene.fog = new THREE.Fog(FOG_COLOR, 130, 680);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2200);
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

const hemi = new THREE.HemisphereLight('#ffe6cc', '#3a5a2a', 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd9a8', 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW_POWER_DEVICE ? 1024 : 2048, LOW_POWER_DEVICE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 260 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// =====================================================================
//  REALISTIC HIGH-RESOLUTION ROAD TEXTURES (Canvas-generated PBR maps)
// =====================================================================
function createRealisticRoadTextures() {
  const W = 1024, H = 2048;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');

  const bC = document.createElement('canvas'); bC.width = W; bC.height = H;
  const bG = bC.getContext('2d');

  const rC = document.createElement('canvas'); rC.width = W; rC.height = H;
  const rG = rC.getContext('2d');

  // Base asphalt background
  g.fillStyle = '#232528'; g.fillRect(0, 0, W, H);
  bG.fillStyle = '#808080'; bG.fillRect(0, 0, W, H); // neutral bump
  rG.fillStyle = '#d7d7d7'; rG.fillRect(0, 0, W, H); // base roughness ~0.84

  // Procedural stone aggregate and bitumen noise
  const img = g.getImageData(0, 0, W, H);
  const bumpImg = bG.getImageData(0, 0, W, H);
  const d = img.data, bd = bumpImg.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    const stone = Math.random() < 0.08 ? (Math.random() - 0.3) * 44 : 0;
    const val = n + stone;
    d[i] = Math.min(255, Math.max(0, d[i] + val));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + val));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + val + 2));
    const bVal = Math.min(255, Math.max(0, 128 + Math.round(n * 0.9 + stone * 1.5)));
    bd[i] = bd[i + 1] = bd[i + 2] = bVal;
  }
  g.putImageData(img, 0, 0);
  bG.putImageData(bumpImg, 0, 0);

  const px = l => Math.round(((l + ROAD_HALF) / (ROAD_HALF * 2)) * W);

  // Highway Shoulders: outer 1.4m on each side
  const sL = px(-ROAD_HALF + 1.4);
  const sR = px(ROAD_HALF - 1.4);
  g.fillStyle = 'rgba(140, 145, 150, 0.16)';
  g.fillRect(0, 0, sL, H);
  g.fillRect(sR, 0, W - sR, H);

  // Shoulder Rumble Strips (grooved safety notches every 64 pixels along shoulders)
  for (let y = 0; y < H; y += 64) {
    // Left shoulder rumble
    g.fillStyle = 'rgba(15, 15, 18, 0.45)';
    g.fillRect(sL - 18, y, 16, 26);
    g.fillStyle = 'rgba(230, 230, 235, 0.35)';
    g.fillRect(sL - 18, y + 26, 16, 38);

    bG.fillStyle = '#404040'; // indent
    bG.fillRect(sL - 18, y, 16, 26);
    bG.fillStyle = '#b0b0b0'; // ridge
    bG.fillRect(sL - 18, y + 26, 16, 38);

    // Right shoulder rumble
    g.fillStyle = 'rgba(15, 15, 18, 0.45)';
    g.fillRect(sR + 2, y, 16, 26);
    g.fillStyle = 'rgba(230, 230, 235, 0.35)';
    g.fillRect(sR + 2, y + 26, 16, 38);

    bG.fillStyle = '#404040';
    bG.fillRect(sR + 2, y, 16, 26);
    bG.fillStyle = '#b0b0b0';
    bG.fillRect(sR + 2, y + 26, 16, 38);
  }

  // Polished Tire Tracks and Oil Drips in every lane
  for (const l of LANES) {
    const cx = px(l);
    const tL = px(l - 0.85);
    const tR = px(l + 0.85);

    // Soft dark rubber sheen
    g.fillStyle = 'rgba(8, 9, 12, 0.22)';
    g.fillRect(tL - 10, 0, 20, H);
    g.fillRect(tR - 10, 0, 20, H);

    // Roughness map: tire tracks are smoother (lower roughness -> sky reflection sheen)
    rG.fillStyle = 'rgba(90, 90, 90, 0.55)';
    rG.fillRect(tL - 11, 0, 22, H);
    rG.fillRect(tR - 11, 0, 22, H);

    // Lane center oil / engine grime strip
    g.fillStyle = 'rgba(12, 12, 15, 0.12)';
    g.fillRect(cx - 7, 0, 14, H);
  }

  // Road Markings (Thermoplastic highway paint)
  // 1. Solid Outer Edge Lines (Fog Lines)
  g.fillStyle = '#f4f6f8';
  g.fillRect(sL - 4, 0, 7, H);
  g.fillRect(sR - 3, 0, 7, H);
  rG.fillStyle = '#606060';
  rG.fillRect(sL - 4, 0, 7, H);
  rG.fillRect(sR - 3, 0, 7, H);
  bG.fillStyle = '#9c9c9c';
  bG.fillRect(sL - 4, 0, 7, H);
  bG.fillRect(sR - 3, 0, 7, H);

  // 2. Dashed Lane Divider Lines (between lanes of each carriageway)
  // 4m dash (512px) with 12m gap (1536px)
  for (const l of [-9, -6, -3, 3, 6, 9]) {
    const lx = px(l);
    g.fillStyle = '#f4f6f8';
    g.fillRect(lx - 3, 0, 6, 512);
    rG.fillStyle = '#606060';
    rG.fillRect(lx - 3, 0, 6, 512);
    bG.fillStyle = '#9c9c9c';
    bG.fillRect(lx - 3, 0, 6, 512);
  }

  // 3. Double Solid Yellow Center Line (Median Boundary)
  const yL = px(-0.25);
  const yR = px(0.25);
  g.fillStyle = '#f5ba00';
  g.fillRect(yL - 3, 0, 6, H);
  g.fillRect(yR - 3, 0, 6, H);
  rG.fillStyle = '#606060';
  rG.fillRect(yL - 3, 0, 6, H);
  rG.fillRect(yR - 3, 0, 6, H);
  bG.fillStyle = '#9c9c9c';
  bG.fillRect(yL - 3, 0, 6, H);
  bG.fillRect(yR - 3, 0, 6, H);

  // 4. Directional Highway Guidance Arrows stenciled in lanes
  const drawArrow = (x, y) => {
    g.fillStyle = 'rgba(240, 243, 246, 0.85)';
    g.beginPath();
    g.moveTo(x, y - 55);
    g.lineTo(x - 18, y - 20);
    g.lineTo(x - 7, y - 20);
    g.lineTo(x - 7, y + 45);
    g.lineTo(x + 7, y + 45);
    g.lineTo(x + 7, y - 20);
    g.lineTo(x + 18, y - 20);
    g.closePath();
    g.fill();
    rG.fillStyle = '#606060';
    rG.fill();
  };
  drawArrow(px(1.5), 1024);
  drawArrow(px(7.5), 1024);
  drawArrow(px(-1.5), 1024);
  drawArrow(px(-7.5), 1024);

  // 5. Stenciled Speed Limit "120"
  g.font = 'bold 44px sans-serif';
  g.fillStyle = 'rgba(240, 243, 246, 0.75)';
  g.textAlign = 'center';
  g.fillText('120', px(4.5), 1450);

  // 6. Realistic braking skid marks
  g.strokeStyle = 'rgba(8, 8, 10, 0.35)';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(px(4.5 - 0.85), 650);
  g.bezierCurveTo(px(4.5 - 0.7), 780, px(4.5 - 0.9), 920, px(4.5 - 0.8), 1050);
  g.stroke();
  g.beginPath();
  g.moveTo(px(4.5 + 0.85), 650);
  g.bezierCurveTo(px(4.5 + 0.9), 780, px(4.5 + 0.7), 920, px(4.5 + 0.8), 1050);
  g.stroke();

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bC);
  bumpMap.wrapS = THREE.ClampToEdgeWrapping; bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 4;

  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = THREE.ClampToEdgeWrapping; roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 4;

  return { map, bumpMap, roughnessMap };
}

// =====================================================================
//  FAST, FAIL-SAFE BOOT & ASSET LOADING
// =====================================================================
const loadFill = document.getElementById('loadfill');
const loadText = document.getElementById('loadtxt');
const loadingScreen = document.getElementById('loading');
const loadingRetry = document.getElementById('loadingRetry');
const texLoader = new THREE.TextureLoader();

let grassTex, aoTex, musicData = null;
let ferrariTemplate = null;
let ferrariLoading = false;
const audio = new GameAudio();

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

function optionalAssetError(name, error) {
  console.warn(`Optional ${name} skipped:`, error?.message || error);
}

// Load high-resolution realistic Ferrari 458 Italia 3D model
function loadFerrariModel() {
  if (ferrariTemplate || ferrariLoading) return;
  ferrariLoading = true;
  try {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('lib/addons/libs/draco/gltf/');

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('assets/models/ferrari.glb', gltf => {
      ferrariTemplate = gltf.scene.children[0];
      ferrariLoading = false;
      console.log('Ferrari 458 Italia 3D model loaded successfully!');
      if (player && !player.isRealisticFerrari) {
        upgradePlayerToFerrari();
      }
    }, undefined, error => {
      optionalAssetError('Ferrari GLTF model', error);
      ferrariLoading = false;
    });
  } catch (error) {
    optionalAssetError('Ferrari loader setup', error);
    ferrariLoading = false;
  }
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

    texLoader.load('assets/models/ferrari_ao.png', texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      aoTex = texture;
    }, undefined, error => optionalAssetError('car shadow texture', error));

    new RGBELoader().load('assets/sky.hdr', hdr => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = hdr;
    }, undefined, error => optionalAssetError('environment map', error));

    loadFerrariModel();
  } catch (error) {
    optionalAssetError('texture/environment loader', error);
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
  fetch('assets/sounds/music.mp3', controller ? { signal: controller.signal } : undefined)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => {
      musicData = buffer;
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
    setLoading('Generating the 3D realistic highway…', 18);
    grassTex = makeFallbackGrassTexture();
    aoTex = makeFallbackShadowTexture();
    loadFerrariModel(); // Start loading realistic car model right away
    setLoading('Building realistic road and scenery…', 58);
    buildWorld();
    setLoading('Race ready!', 100);
    loadOptionalAssets();

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

Promise.resolve().then(bootGame);

// =====================================================================
//  MATERIALS
// =====================================================================
let roadMat, grassMat, railMat, postMat, concreteMat;

// Procedural fallback supercar
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

function makeProceduralCar(color, isPlayer = false) {
  const a = getProceduralCarAssets();
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.88, roughness: 0.24, clearcoat: 1.0, clearcoatRoughness: 0.08,
  });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x440000 });

  carPart(root, a.bodyGeo, bodyMat, 0, 0.70, 0);
  carPart(root, a.hoodGeo, bodyMat, 0, 0.88, 1.12, [0.94, 0.30, 1.10]);
  carPart(root, a.cabinGeo, a.glassMat, 0, 1.16, -0.32, [0.82, 0.48, 1.05]);
  carPart(root, a.bumperGeo, a.trimMat, 0, 0.48, 2.18);
  carPart(root, a.bumperGeo, a.trimMat, 0, 0.50, -2.18);
  carPart(root, a.grilleGeo, a.trimMat, 0, 0.66, 2.30);
  carPart(root, a.sideGeo, a.trimMat, -1.00, 0.48, -0.03);
  carPart(root, a.sideGeo, a.trimMat, 1.00, 0.48, -0.03);

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
  addWheel(-1.04, 1.38); addWheel(1.04, 1.38);
  addWheel(-1.04, -1.38); addWheel(1.04, -1.38);

  const shadow = new THREE.Mesh(a.shadowGeo, a.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  shadow.renderOrder = 1;
  root.add(shadow);

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

// REALISTIC FERRARI 458 ITALIA (Loaded from glTF model)
function makeRealisticFerrari(color, isPlayer = false) {
  if (!ferrariTemplate) {
    return makeProceduralCar(color, isPlayer);
  }

  const root = new THREE.Group();
  const carModel = ferrariTemplate.clone(true);
  // Ferrari model faces -Z by default, rotate 180° around Y to face +Z
  carModel.rotation.y = Math.PI;
  root.add(carModel);

  // High-end automotive paint with clearcoat lacquer
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.90,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    reflectivity: 0.9,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xdde3ea,
    metalness: 0.95,
    roughness: 0.18,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x181a1c,
    metalness: 0.85,
    roughness: 0.30,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x060c14,
    metalness: 0.15,
    roughness: 0.04,
    transparent: true,
    opacity: 0.72,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
  });

  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  const headlampMat = new THREE.MeshBasicMaterial({ color: 0xfffae8 });

  const bodyMesh = carModel.getObjectByName('body');
  if (bodyMesh) {
    bodyMesh.material = bodyMat;
    bodyMesh.castShadow = true;
  }

  ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl'].forEach(name => {
    const rim = carModel.getObjectByName(name);
    if (rim) rim.material = rimMat;
  });

  const trimMesh = carModel.getObjectByName('trim');
  if (trimMesh) trimMesh.material = trimMat;

  const glassMesh = carModel.getObjectByName('glass');
  if (glassMesh) glassMesh.material = glassMat;

  const tailLights = carModel.getObjectByName('lights_red');
  if (tailLights) tailLights.material = brakeMat;

  const headlights = carModel.getObjectByName('lights');
  if (headlights) headlights.material = headlampMat;

  const leds = carModel.getObjectByName('leds');
  if (leds) leds.material = new THREE.MeshBasicMaterial({ color: 0xd8eeff });

  const steeringWheel = carModel.getObjectByName('steering_wheel');

  carModel.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // Note: Due to carModel.rotation.y = Math.PI:
  // wheel_fr becomes front-left, wheel_fl becomes front-right
  const wFL = carModel.getObjectByName('wheel_fr');
  const wFR = carModel.getObjectByName('wheel_fl');
  const wRL = carModel.getObjectByName('wheel_rr');
  const wRR = carModel.getObjectByName('wheel_rl');

  const wheels = [wFL, wFR, wRL, wRR].filter(Boolean);
  wheels.forEach(w => {
    w.rotation.order = 'YXZ';
  });

  // Baked ambient occlusion shadow
  const shadowGeo = new THREE.PlaneGeometry(2.62, 5.2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  shadow.renderOrder = 2;
  root.add(shadow);

  if (isPlayer) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 3.4),
      new THREE.MeshBasicMaterial({
        color: 0x149dff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.028;
    root.add(glow);

    // Forward headlight projector light cones
    for (const s of [-0.62, 0.62]) {
      const beamGeo = new THREE.ConeGeometry(0.85, 9.0, 16, 1, true);
      beamGeo.rotateX(Math.PI / 2);
      beamGeo.translate(0, 0, 4.5);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfffae0,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(s, 0.68, 2.15);
      root.add(beam);
    }
  }

  return {
    root,
    wheels,
    bodyMat,
    brakeMat,
    steeringWheel,
    isRealisticFerrari: true,
    halfL: 2.3,
    halfW: 1.1,
  };
}

function upgradePlayerToFerrari() {
  if (!player || player.isRealisticFerrari || !ferrariTemplate) return;
  const oldRoot = player.root;
  const savedState = {
    x: player.x,
    z: player.z,
    heading: player.heading,
    v: player.v,
    steer: player.steer,
    gear: player.gear,
    rpm: player.rpm,
    nitro: player.nitro,
    health: player.health,
    invuln: player.invuln,
    skid: player.skid,
    scrape: player.scrape,
    spin: player.spin,
    lat: player.lat,
    throttle: player.throttle,
    nitroOn: player.nitroOn,
  };
  scene.remove(oldRoot);
  player = makeRealisticFerrari(playerColor, true);
  Object.assign(player, savedState);
  scene.add(player.root);
  console.log('Player upgraded to realistic Ferrari 458 Italia!');
}

// REALISTIC DETAILED TRAFFIC VEHICLES
let trafficAssets = null;
function getTrafficAssets() {
  if (trafficAssets) return trafficAssets;

  const tireGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.32, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.33, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(3.0, 5.0);

  trafficAssets = {
    // Coupe
    coupeBodyGeo: new THREE.BoxGeometry(1.98, 0.44, 4.3),
    coupeHoodGeo: new THREE.BoxGeometry(1.86, 0.22, 1.3),
    coupeCabinGeo: new THREE.BoxGeometry(1.68, 0.52, 2.0),
    coupeSpoilerGeo: new THREE.BoxGeometry(1.6, 0.08, 0.24),

    // Sedan
    sedanBodyGeo: new THREE.BoxGeometry(2.04, 0.48, 4.6),
    sedanCabinGeo: new THREE.BoxGeometry(1.76, 0.58, 2.4),
    sedanGrilleGeo: new THREE.BoxGeometry(1.1, 0.28, 0.06),

    // SUV
    suvBodyGeo: new THREE.BoxGeometry(2.14, 0.62, 4.7),
    suvCabinGeo: new THREE.BoxGeometry(1.92, 0.68, 2.9),
    suvRoofRailGeo: new THREE.BoxGeometry(0.08, 0.10, 2.5),

    // Common parts
    mirrorGeo: new THREE.BoxGeometry(0.22, 0.12, 0.14),
    lampGeo: new THREE.BoxGeometry(0.44, 0.16, 0.06),
    bumperGeo: new THREE.BoxGeometry(2.02, 0.22, 0.2),
    tireGeo, rimGeo, shadowGeo,

    // Materials
    rimMat: new THREE.MeshStandardMaterial({ color: 0xd0d5da, metalness: 0.92, roughness: 0.25 }),
    tireMat: new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.88, metalness: 0.05 }),
    trimMat: new THREE.MeshStandardMaterial({ color: 0x181a1c, roughness: 0.4, metalness: 0.7 }),
    chromeMat: new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.15, metalness: 0.98 }),
    glassMat: new THREE.MeshPhysicalMaterial({ color: 0x091420, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.78 }),
    headlampMat: new THREE.MeshBasicMaterial({ color: 0xfffae8 }),
    shadowMat: new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.65, depthWrite: false, toneMapped: false }),
  };
  return trafficAssets;
}

function makeRealisticTrafficCar(color) {
  const a = getTrafficAssets();
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.86, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.1,
  });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x550000 });

  const type = (Math.random() * 3) | 0; // 0 = Coupe, 1 = Sedan, 2 = SUV

  if (type === 0) {
    // Sports Coupe
    carPart(root, a.coupeBodyGeo, bodyMat, 0, 0.68, 0);
    carPart(root, a.coupeHoodGeo, bodyMat, 0, 0.84, 1.05);
    carPart(root, a.coupeCabinGeo, a.glassMat, 0, 1.14, -0.35);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.46, 2.16);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.48, -2.16);
    carPart(root, a.coupeSpoilerGeo, a.trimMat, 0, 1.15, -1.9);
  } else if (type === 1) {
    // Luxury Sedan
    carPart(root, a.sedanBodyGeo, bodyMat, 0, 0.72, 0);
    carPart(root, a.sedanCabinGeo, a.glassMat, 0, 1.22, -0.15);
    carPart(root, a.sedanGrilleGeo, a.chromeMat, 0, 0.66, 2.32);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.48, 2.32);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.50, -2.32);
  } else {
    // Modern SUV
    carPart(root, a.suvBodyGeo, bodyMat, 0, 0.82, 0);
    carPart(root, a.suvCabinGeo, a.glassMat, 0, 1.44, -0.1);
    carPart(root, a.suvRoofRailGeo, a.chromeMat, -0.85, 1.84, -0.1);
    carPart(root, a.suvRoofRailGeo, a.chromeMat, 0.85, 1.84, -0.1);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.54, 2.38);
    carPart(root, a.bumperGeo, a.trimMat, 0, 0.56, -2.38);
  }

  // Side mirrors
  for (const s of [-1, 1]) {
    carPart(root, a.mirrorGeo, bodyMat, s * 1.05, type === 2 ? 1.25 : 1.02, 0.45);
  }

  // Headlights and brake lights
  for (const s of [-0.64, 0.64]) {
    const fz = type === 0 ? 2.16 : type === 1 ? 2.32 : 2.38;
    const rz = type === 0 ? -2.16 : type === 1 ? -2.32 : -2.38;
    const ly = type === 2 ? 0.95 : 0.80;
    carPart(root, a.lampGeo, a.headlampMat, s, ly, fz);
    carPart(root, a.lampGeo, brakeMat, s, ly, rz);
  }

  // Wheels
  const wheels = [];
  const addWheel = (x, z, yOff) => {
    const wheel = new THREE.Group();
    wheel.position.set(x, yOff, z);
    wheel.rotation.order = 'YXZ';
    carPart(wheel, a.tireGeo, a.tireMat, 0, 0, 0);
    carPart(wheel, a.rimGeo, a.rimMat, 0, 0, 0);
    root.add(wheel);
    wheels.push(wheel);
  };
  const wy = type === 2 ? 0.54 : 0.48;
  const wz = type === 0 ? 1.35 : 1.45;
  addWheel(-1.02, wz, wy); addWheel(1.02, wz, wy);
  addWheel(-1.02, -wz, wy); addWheel(1.02, -wz, wy);

  const shadow = new THREE.Mesh(a.shadowGeo, a.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, wheels, bodyMat, brakeMat, halfL: 2.35, halfW: 1.05 };
}

function makeCar(color, isPlayer = false) {
  if (isPlayer) {
    if (ferrariTemplate) {
      return makeRealisticFerrari(color, true);
    }
    return makeProceduralCar(color, true);
  }
  return makeRealisticTrafficCar(color);
}

function makeTruck() {
  const root = new THREE.Group();
  const cols = ['#e8e8e8', '#1c5fa8', '#c0392b', '#e6a100', '#2e7d32', '#6d4c41'];
  const cargoCol = cols[(Math.random() * cols.length) | 0];
  const cabCol = cols[(Math.random() * cols.length) | 0];

  const cargoMat = new THREE.MeshStandardMaterial({ color: cargoCol, roughness: 0.55, metalness: 0.25 });
  const cabMat = new THREE.MeshStandardMaterial({ color: cabCol, roughness: 0.3, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.15, metalness: 0.98 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x091420, roughness: 0.05, metalness: 0.9 });
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x660000 });
  const hazardMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

  const isBus = Math.random() < 0.35;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };

  if (isBus) {
    // Modern Coach Tour Bus
    add(new THREE.BoxGeometry(2.55, 2.9, 11.2), cabMat, 0, 1.95, 0);
    add(new THREE.BoxGeometry(2.58, 0.95, 10.2), glass, 0, 2.52, -0.2);
    add(new THREE.BoxGeometry(2.35, 1.25, 0.05), glass, 0, 2.45, 5.61);
    // Destination sign on bus roof
    add(new THREE.BoxGeometry(1.6, 0.25, 0.05), new THREE.MeshBasicMaterial({ color: '#ffb300' }), 0, 3.25, 5.61);
    // Roof AC units
    for (const z of [-2, 2]) add(new THREE.BoxGeometry(1.8, 0.32, 1.4), dark, 0, 3.52, z);
  } else {
    // Heavy Semi-Truck with Corrugated Freight Container
    add(new THREE.BoxGeometry(2.55, 3.1, 7.8), cargoMat, 0, 2.35, -1.8);
    // Red/white reflective safety tape along trailer bottom
    add(new THREE.BoxGeometry(2.58, 0.12, 7.7), new THREE.MeshBasicMaterial({ color: '#ff2a2a' }), 0, 0.88, -1.8);
    // Truck Cab
    add(new THREE.BoxGeometry(2.45, 2.5, 2.6), cabMat, 0, 1.95, 3.35);
    add(new THREE.BoxGeometry(2.25, 1.05, 0.05), glass, 0, 2.55, 4.66);
    // Chrome front grille and bumper
    add(new THREE.BoxGeometry(1.5, 0.95, 0.06), chrome, 0, 1.5, 4.68);
    add(new THREE.BoxGeometry(2.48, 0.35, 0.3), chrome, 0, 0.72, 4.65);
    // Vertical dual chrome exhaust stacks behind cab
    for (const s of [-1.15, 1.15]) {
      add(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), chrome, s, 2.7, 2.0);
    }
    // Chassis frame
    add(new THREE.BoxGeometry(2.3, 0.32, 11.2), dark, 0, 0.7, 0);
  }

  // Wheels (Tandem dual truck wheels)
  const wg = new THREE.CylinderGeometry(0.56, 0.56, 0.42, 16); wg.rotateZ(Math.PI / 2);
  const wheels = [];
  const addTruckWheel = (x, z) => {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.56, z);
    wheel.rotation.order = 'YXZ';
    const tire = new THREE.Mesh(wg, dark); tire.castShadow = true; wheel.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.44, 12), chrome);
    rim.rotateZ(Math.PI / 2); wheel.add(rim);
    root.add(wheel);
    wheels.push(wheel);
  };

  for (const z of [-4.5, -3.1, 3.5]) {
    for (const x of [-1.18, 1.18]) addTruckWheel(x, z);
  }

  // Headlights & Taillights
  for (const x of [-0.92, 0.92]) add(new THREE.BoxGeometry(0.42, 0.22, 0.05), hl, x, 1.02, 5.62);
  for (const x of [-1.02, 1.02]) add(new THREE.BoxGeometry(0.32, 0.32, 0.05), brakeMat, x, 1.02, -5.72);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 12.2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; root.add(shadow);

  return { root, wheels, brakeMat, halfL: 5.8, halfW: 1.35 };
}

// =====================================================================
//  WORLD: road chunks, terrain, rails, scenery
// =====================================================================
const chunks = new Map();
let treeTrunks, treeTops, treeData = [], lampMesh, lampData = [], mountains;
const turbineList = [], archList = []; // recycled roadside landmarks

function buildWorld() {
  const roadTex = createRealisticRoadTextures();
  roadMat = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    bumpMap: roadTex.bumpMap,
    bumpScale: 0.035,
    roughnessMap: roadTex.roughnessMap,
    roughness: 0.85,
    metalness: 0.04,
  });

  grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: '#b7c98f' });
  railMat = new THREE.MeshStandardMaterial({ color: '#cfd4d8', metalness: 0.95, roughness: 0.28, side: THREE.DoubleSide });
  postMat = new THREE.MeshStandardMaterial({ color: '#7a8188', metalness: 0.75, roughness: 0.45 });
  concreteMat = new THREE.MeshStandardMaterial({ color: '#a2a7ac', roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide });

  // REALISTIC TREES: 5-tiered layered Pine trees with rich silhouettes
  const TREES = LOW_POWER_DEVICE ? 420 : 700;
  const trunkG = new THREE.CylinderGeometry(0.20, 0.42, 5.5, 8); trunkG.translate(0, 2.75, 0);

  // 5 overlapping conical foliage tiers with natural flare and rotation offsets
  const t1 = new THREE.ConeGeometry(3.4, 3.2, 8); t1.translate(0, 4.4, 0);
  const t2 = new THREE.ConeGeometry(2.7, 2.8, 8); t2.translate(0, 6.2, 0); t2.rotateY(Math.PI / 8);
  const t3 = new THREE.ConeGeometry(2.1, 2.4, 8); t3.translate(0, 7.8, 0); t3.rotateY(Math.PI / 4);
  const t4 = new THREE.ConeGeometry(1.5, 2.0, 8); t4.translate(0, 9.2, 0); t4.rotateY(Math.PI / 8);
  const t5 = new THREE.ConeGeometry(0.9, 1.6, 8); t5.translate(0, 10.4, 0);
  const topG = mergeGeos([t1, t2, t3, t4, t5]);

  treeTrunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#4a3320', roughness: 0.98 }), TREES);
  treeTops = new THREE.InstancedMesh(topG, new THREE.MeshStandardMaterial({ color: '#255223', roughness: 0.9 }), TREES);
  treeTops.castShadow = treeTrunks.castShadow = true;
  treeTops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREES * 3), 3);
  for (let i = 0; i < TREES; i++) treeData.push({ z: -1e9 });
  scene.add(treeTrunks, treeTops);

  // MODERN COBRA-HEAD HIGHWAY STREETLIGHTS
  const LAMPS = 32;
  const baseG = new THREE.CylinderGeometry(0.32, 0.38, 0.4, 8); baseG.translate(0, 0.2, 0);
  const poleG = new THREE.CylinderGeometry(0.10, 0.20, 9.6, 8); poleG.translate(0, 4.9, 0);
  const arm1G = new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6); arm1G.rotateZ(0.5); arm1G.translate(-0.8, 9.8, 0);
  const arm2G = new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6); arm2G.rotateZ(1.2); arm2G.translate(-2.0, 10.2, 0);
  const headG = new THREE.BoxGeometry(0.95, 0.16, 0.42); headG.translate(-2.7, 10.1, 0);
  const lensG = new THREE.BoxGeometry(0.65, 0.04, 0.32); lensG.translate(-2.7, 10.0, 0);
  const lg = mergeGeos([baseG, poleG, arm1G, arm2G, headG, lensG]);

  lampMesh = new THREE.InstancedMesh(lg, new THREE.MeshStandardMaterial({ color: '#687076', metalness: 0.85, roughness: 0.35 }), LAMPS);
  lampMesh.castShadow = true;
  for (let i = 0; i < LAMPS; i++) lampData.push({ z: -1e9 });
  scene.add(lampMesh);

  // Wind turbines on the hills (animated, recycled)
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

  // REALISTIC OVERHEAD HIGHWAY GANTRIES (Steel box-truss + Highway destination signs)
  const ARCHES = 4;
  const aMat = new THREE.MeshStandardMaterial({ color: '#5d666d', metalness: 0.8, roughness: 0.35 });

  // Generate realistic overhead highway sign texture
  const signCanvas = document.createElement('canvas'); signCanvas.width = 1024; signCanvas.height = 256;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle = '#006241'; sg.fillRect(0, 0, 1024, 256); // highway green
  sg.strokeStyle = '#ffffff'; sg.lineWidth = 8; sg.strokeRect(8, 8, 1008, 240);
  sg.fillStyle = '#ffffff'; sg.font = 'bold 38px sans-serif';
  sg.fillText('⬆ NORTH  HIGHWAY 1', 40, 75);
  sg.font = '28px sans-serif';
  sg.fillText('EXPRESSWAY · NEXT EXIT 2 km', 40, 125);
  sg.fillStyle = '#ffcc00'; sg.font = 'bold 32px sans-serif';
  sg.fillText('SPEED LIMIT 120 km/h', 40, 185);
  // Speed circle on right
  sg.strokeStyle = '#e60000'; sg.lineWidth = 12; sg.beginPath(); sg.arc(880, 128, 70, 0, Math.PI * 2); sg.stroke();
  sg.fillStyle = '#ffffff'; sg.beginPath(); sg.arc(880, 128, 62, 0, Math.PI * 2); sg.fill();
  sg.fillStyle = '#000000'; sg.font = 'bold 48px sans-serif'; sg.textAlign = 'center'; sg.fillText('120', 880, 146);
  const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4, metalness: 0.1 });

  for (let i = 0; i < ARCHES; i++) {
    const g = new THREE.Group();
    // Steel lattice posts on both sides outside guard rails
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.85, 10.5, 0.85), aMat);
      pil.position.set(s * (RAIL + 1.6), 5.25, 0); pil.castShadow = true; g.add(pil);
      const pil2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 10.5, 0.4), aMat);
      pil2.position.set(s * (RAIL + 2.4), 5.25, 0); pil2.castShadow = true; g.add(pil2);
    }
    // Overhead steel box truss beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry((RAIL + 2.0) * 2 + 1.2, 1.4, 1.2), aMat);
    beam.position.y = 10.2; beam.castShadow = true; g.add(beam);

    // Realistic overhead highway sign board
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry((RAIL + 0.8) * 2, 2.2, 0.18), signMat);
    signBoard.position.set(0, 9.6, 0.65); signBoard.castShadow = true; g.add(signBoard);

    // Blinking twin amber warning beacons
    const lamps = [];
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), new THREE.MeshBasicMaterial({ color: '#ff9900' }));
      lamp.position.set(s * (RAIL + 1.6), 10.9, 0.65); g.add(lamp); lamps.push(lamp);
    }
    g.userData.lamps = lamps;
    scene.add(g);
    archList.push({ z: -1e9, group: g });
  }

  // Distant mountains
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

// =====================================================================
//  ROAD CHUNK BUILDER (Realistic 3D Curbs, Corrugated W-Rails, Jersey Barrier)
// =====================================================================
function buildChunk(idx) {
  const z0 = idx * CHUNK, rows = CHUNK / SEG + 1;
  const group = new THREE.Group();

  // --- Realistic 8-Lane Highway Surface
  {
    const pos = [], uv = [], ind = [];
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z), y = roadY(z) + 0.02;
      pos.push(cx - ROAD_HALF, y, z, cx + ROAD_HALF, y, z);
      // Map UVs: repeat once every 16m matching highway dashes and grooved rumble strips
      uv.push(0, z / 16, 1, z / 16);
      if (r) { const a = (r - 1) * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind); g.computeVertexNormals();
    const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; group.add(m);
  }

  // --- 3D Bevelled Concrete Curbs along shoulders
  {
    for (const side of [-1, 1]) {
      const cp = [], ci = [], cuv = [];
      for (let r = 0; r < rows; r++) {
        const z = z0 + r * SEG, cx = roadX(z), y = roadY(z) + 0.02;
        const ex = cx + side * ROAD_HALF;
        // 3 vertices per row: gutter lip, curb bevel, curb back
        cp.push(
          ex, y + 0.01, z,
          ex + side * 0.25, y + 0.14, z,
          ex + side * 0.45, y + 0.15, z
        );
        cuv.push(0, z / 4, 0.5, z / 4, 1, z / 4);
        if (r) {
          const a = (r - 1) * 3, b = r * 3;
          ci.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
      cg.setIndex(ci); cg.computeVertexNormals();
      const cm = new THREE.Mesh(cg, concreteMat); cm.receiveShadow = true; cm.castShadow = true;
      group.add(cm);
    }
  }

  // --- Terrain (Embankments & hills)
  {
    const offs = [-600, -350, -220, -150, -100, -70, -45, -30, -20, -14, -13.5, 13.5, 14, 20, 30, 45, 70, 100, 150, 220, 350, 600];
    const pos = [], uv = [], ind = [], cols = offs.length;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z);
      for (let c = 0; c < cols; c++) {
        const x = cx + offs[c];
        const y = Math.abs(offs[c]) < 13.8 ? roadY(z) - 0.05 : terrainY(x, z);
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

  // --- 3D Corrugated W-Beam Guard Rails + Steel I-Posts
  {
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.95, 0.16), postMat, rows * 2);
    const dummy = new THREE.Object3D();
    const wOffsets = [
      { dy: 0.86, dx: 0.00 },
      { dy: 0.77, dx: 0.08 },
      { dy: 0.65, dx: -0.03 },
      { dy: 0.53, dx: 0.08 },
      { dy: 0.44, dx: 0.00 },
    ];
    for (const side of [-1, 1]) {
      const pos = [], ind = [];
      for (let r = 0; r < rows; r++) {
        const z = z0 + r * SEG, bx = roadX(z) + side * RAIL, y = roadY(z);
        for (const p of wOffsets) {
          pos.push(bx + side * p.dx, y + p.dy, z);
        }
        if (r) {
          const a = (r - 1) * 5, b = r * 5;
          for (let s = 0; s < 4; s++) {
            ind.push(a + s, b + s, a + s + 1, a + s + 1, b + s, b + s + 1);
          }
        }
        dummy.position.set(bx + side * 0.12, y + 0.48, z); dummy.updateMatrix();
        posts.setMatrixAt(r * 2 + (side > 0 ? 1 : 0), dummy.matrix);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(ind); g.computeVertexNormals();
      const m = new THREE.Mesh(g, railMat); m.castShadow = true; group.add(m);
    }
    posts.castShadow = true; group.add(posts);
  }

  // --- 3D New Jersey Concrete Median Barrier (Sloped base toe + vertical stem)
  {
    const njOffsets = [
      { dy: 0.04, dx: -0.42 }, // left toe
      { dy: 0.14, dx: -0.38 }, // left curb slope
      { dy: 0.38, dx: -0.22 }, // left mid slope
      { dy: 0.80, dx: -0.16 }, // left top stem
      { dy: 0.84, dx: 0.00 },  // top apex
      { dy: 0.80, dx: 0.16 },  // right top stem
      { dy: 0.38, dx: 0.22 },  // right mid slope
      { dy: 0.14, dx: 0.38 },  // right curb slope
      { dy: 0.04, dx: 0.42 },  // right toe
    ];
    const wp = [], wi = [];
    const count = njOffsets.length;
    for (let r = 0; r < rows; r++) {
      const z = z0 + r * SEG, cx = roadX(z), y = roadY(z) + 0.02;
      for (const p of njOffsets) {
        wp.push(cx + p.dx, y + p.dy, z);
      }
      if (r) {
        const a = (r - 1) * count, b = r * count;
        for (let s = 0; s < count - 1; s++) {
          wi.push(a + s, a + s + 1, b + s, a + s + 1, b + s + 1, b + s);
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setIndex(wi); wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, concreteMat); wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
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
  // Trees
  for (let i = 0; i < treeData.length; i++) {
    const t = treeData[i];
    if (t.z < pz - 40 || t.z > pz + 900) {
      t.z = (t.z < -1e8 ? pz - 30 + Math.random() * 930 : pz + 700 + Math.random() * 200);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = side * (15 + Math.pow(Math.random(), 1.6) * 180);
      const x = roadX(t.z) + off;
      const sc = 0.75 + Math.random() * 0.95;
      _p.set(x, terrainY(x, t.z) - 0.2, t.z); _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * 6); _s.set(sc, sc * (0.85 + Math.random() * 0.45), sc);
      _m.compose(_p, _q, _s);
      treeTrunks.setMatrixAt(i, _m); treeTops.setMatrixAt(i, _m);
      _c.setHSL(0.24 + Math.random() * 0.12, 0.52, 0.16 + Math.random() * 0.14);
      treeTops.setColorAt(i, _c);
      treeTrunks.instanceMatrix.needsUpdate = treeTops.instanceMatrix.needsUpdate = true;
      treeTops.instanceColor.needsUpdate = true;
    }
  }
  // Wind turbines
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
  // Gantry arches
  for (let i = 0; i < archList.length; i++) {
    const a = archList[i];
    if (a.z < pz - 60 || a.z > pz + 1000) {
      a.z = (a.z < -1e8 ? pz + 150 + i * 200 : pz + 880 + Math.random() * 120);
      a.group.position.set(roadX(a.z), roadY(a.z), a.z);
      a.group.rotation.y = Math.atan(roadDX(a.z));
    }
  }
  // Cobra-head streetlights every 60m alternating
  for (let i = 0; i < lampData.length; i++) {
    const l = lampData[i];
    if (l.z < pz - 40) {
      const base = Math.floor((pz - 30) / 60) * 60;
      if (l.z < -1e8) l.z = base + i * 60; else l.z += lampData.length * 60;
      const side = (Math.round(l.z / 60) % 2) ? 1 : -1;
      const x = roadX(l.z) + side * (RAIL + 0.9);
      _p.set(x, roadY(l.z), l.z);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, side > 0 ? 0 : Math.PI);
      _s.set(1, 1, 1); _m.compose(_p, _q, _s);
      lampMesh.setMatrixAt(i, _m); lampMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function animateLandmarks(dt) {
  for (const t of turbineList) t.rotor.rotation.z += dt * t.spin;
  const on = ((gameTime * 2) | 0) % 2 === 0;
  for (const a of archList) for (const l of a.group.userData.lamps) l.visible = on;
}

// =====================================================================
//  PARTICLES
// =====================================================================
const MAX_P = 220;
const pPos = new Float32Array(MAX_P * 3), pCol = new Float32Array(MAX_P * 3), pSize = new Float32Array(MAX_P);
const pData = [];
let pGeo, pMat, pMesh;
function makeParticles() {
  pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  pMat = new THREE.ShaderMaterial({
    uniforms: { pointTex: { value: null } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*(300.0/-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-vec2(0.5)); if(d>0.5) discard; float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  pMesh = new THREE.Points(pGeo, pMat);
  scene.add(pMesh);
  for (let i = 0; i < MAX_P; i++) pData.push({ alive: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, grow: 0, baseSize: 1 });
}
function emit(x, y, z, vx, vy, vz, life, size, r, g, b, grow = 0) {
  const i = pData.findIndex(p => !p.alive); if (i < 0) return;
  const p = pData[i]; p.alive = true; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.maxLife = life; p.grow = grow; p.baseSize = size;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b; pSize[i] = size;
}
function updateParticles(dt) {
  for (let i = 0; i < MAX_P; i++) {
    const p = pData[i]; if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; pSize[i] = 0; continue; }
    pPos[i * 3] += p.vx * dt; pPos[i * 3 + 1] += p.vy * dt; pPos[i * 3 + 2] += p.vz * dt;
    const t = 1 - p.life / p.maxLife;
    pSize[i] = p.baseSize * (1 + t * p.grow);
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.size.needsUpdate = true;
}

// =====================================================================
//  GAME STATE & TRAFFIC
// =====================================================================
let state = 'loading'; // loading | menu | play | pause | over
let difficulty = 1;
let playerColor = CAR_COLORS[0];
let player = null;
const traffic = [], obstacles = [], pickups = [];
let gameTime = 0, shake = 0, camMode = 0;
const keys = {};
const S = {}; // run stats

function resetGame() {
  traffic.forEach(t => scene.remove(t.root)); traffic.length = 0;
  obstacles.forEach(o => scene.remove(o.mesh)); obstacles.length = 0;
  pickups.forEach(o => scene.remove(o.mesh)); pickups.length = 0;
  if (player) scene.remove(player.root);
  player = makeCar(playerColor, true);
  scene.add(player.root);
  Object.assign(player, { x: roadX(0) + 2, z: 0, heading: Math.atan(roadDX(0)), v: 0, steer: 0, gear: 1, rpm: 900, nitro: 100, health: 100, invuln: 0, skid: 0, scrape: 0, spin: 0, lat: 2 });
  Object.assign(S, { score: 0, dist: 0, near: 0, top: 0, mult: 1, multTimer: 0, nextWork: 400, nextPickup: 300, nextPad: 700, over: false, overTimer: 0, runEnded: false, revived: false });
  gameTime = 0;
  shake = 0;
  treeData.forEach(t => t.z = -1e9); lampData.forEach(l => l.z = -1e9);
  updateChunks(0); updateScenery(0);
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
  const car = truck ? makeTruck() : makeCar(new THREE.Color().setHSL(Math.random(), 0.7, 0.25 + Math.random() * 0.4));
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
      const dir = Math.sign(t.speed);
      let desired = t.baseSpeed * dir;
      for (const o of traffic) {
        if (o === t || Math.abs(o.lane - t.lane) > 2) continue;
        const gap = (o.z - t.z) * dir;
        if (gap > 0 && gap < 22 + t.halfL + o.halfL) desired = Math.min(Math.abs(desired), Math.abs(o.speed) * 0.9) * dir;
      }
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
      for (const o of obstacles) if (o.kind === 'barrier' && Math.abs(o.lat - t.targetLane) < 2 && (o.z - t.z) * dir > 0 && (o.z - t.z) * dir < 70) {
        const dirLanes = LANES.filter(l => (t.oncoming ? l < 0 : l > 0));
        const li = dirLanes.indexOf(t.targetLane);
        const cands = [dirLanes[li - 1], dirLanes[li + 1]].filter(l => l !== undefined && Math.abs(l - o.lat) > 2.2);
        if (cands.length) t.targetLane = cands[(Math.random() * cands.length) | 0];
      }
      t.lane += THREE.MathUtils.clamp(t.targetLane - t.lane, -2.2 * dt, 2.2 * dt);
      t.speed += THREE.MathUtils.clamp(desired - t.speed, -12 * dt, 5 * dt);
      t.yaw = (t.targetLane - t.lane) * 0.06 * Math.sign(t.speed);
      t.brakeMat.color.setHex(Math.abs(t.speed) < Math.abs(desired) - 0.5 || Math.abs(desired) < t.baseSpeed - 1 ? 0xff2020 : 0x550000);
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
// High-visibility safety cones with heavy black rubber base & dual reflective bands
const coneBaseG = new THREE.BoxGeometry(0.44, 0.06, 0.44); coneBaseG.translate(0, 0.03, 0);
const coneBodyG = new THREE.ConeGeometry(0.24, 0.78, 14); coneBodyG.translate(0, 0.42, 0);
const coneBandG = new THREE.CylinderGeometry(0.18, 0.21, 0.16, 14); coneBandG.translate(0, 0.42, 0);
const coneMeshG = mergeGeos([coneBaseG, coneBodyG, coneBandG]);
const coneMat = new THREE.MeshStandardMaterial({ color: '#ff4d00', roughness: 0.35, metalness: 0.1 });

let barrierAssets = null;
function getBarrierAssets() {
  if (barrierAssets) return barrierAssets;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#d91414'; x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16, 32); x.lineTo(i * 16 - 16, 32); x.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  barrierAssets = {
    boardGeo: new THREE.BoxGeometry(3.4, 0.5, 0.12),
    boardMat: new THREE.MeshStandardMaterial({ map: tex, emissive: '#330000' }),
    legGeo: new THREE.BoxGeometry(0.12, 1.2, 0.8),
    lampGeo: new THREE.SphereGeometry(0.14, 8, 8),
    lampMat: new THREE.MeshBasicMaterial({ color: '#ffae00' }),
  };
  return barrierAssets;
}

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
  for (const dz of [0, len]) {
    const m = barrierMesh(); scene.add(m);
    obstacles.push({ mesh: m, z: z + dz, lat: lane, kind: 'barrier', halfL: 0.5, halfW: 1.7, hit: false });
  }
  for (let d = -12; d <= len; d += 6) {
    const lat = lane + (d < 0 ? (lane > 0 ? -1 : 1) * (1.9 + d / 12 * 1.9) : (lane > 0 ? -1.9 : 1.9));
    const m = new THREE.Mesh(coneMeshG, coneMat); m.castShadow = true; scene.add(m);
    obstacles.push({ mesh: m, z: z + d, lat, kind: 'cone', halfL: 0.3, halfW: 0.3, hit: false, vy: 0, vx: 0, vz: 0, y: 0 });
  }
}

let pickupAssets = null;
function getPickupAssets() {
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
    if (o.hit && o.kind === 'cone') {
      o.y += o.vy * dt; o.vy -= 16 * dt; o.mesh.position.y = roadY(o.z) + Math.max(0, o.y);
      o.z += o.vz * dt; o.vz *= Math.pow(0.5, dt);
      o.lat += o.vx * dt; o.vx *= Math.pow(0.5, dt);
      o.mesh.position.x = roadX(o.z) + o.lat;
      o.mesh.rotation.x += 10 * dt; o.mesh.rotation.z += 6 * dt;
    } else {
      o.mesh.position.set(roadX(o.z) + o.lat, roadY(o.z), o.z);
    }
  }
  for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].z < player.z - 50) { scene.remove(obstacles[i].mesh); obstacles.splice(i, 1); }
  for (const k of pickups) {
    k.mesh.position.set(roadX(k.z) + k.lat, roadY(k.z) + 1.2 + Math.sin(gameTime * 4 + k.z) * 0.25, k.z);
    k.mesh.rotation.y += dt * 2.5;
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].taken || pickups[i].z < player.z - 30) { scene.remove(pickups[i].mesh); pickups.splice(i, 1); }
}

// =====================================================================
//  PLAYER PHYSICS
// =====================================================================
const GEARS = [0, 16, 30, 44, 58, 72, 100];
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
  const vmax = wantNitro ? 92 : 72;
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

  // Steering
  const sIn = alive ? (left ? 1 : 0) - (right ? 1 : 0) : 0;
  p.steer += (sIn - p.steer) * Math.min(1, dt * (sIn ? 5 : 8));
  const speedFactor = Math.min(1, Math.abs(p.v) / 6) / (1 + Math.abs(p.v) * 0.028);
  let yaw = p.steer * 1.9 * speedFactor * (hand ? 1.7 : 1);
  p.heading += (yaw * Math.sign(p.v) + p.spin) * dt;
  p.spin *= Math.pow(0.05, dt);

  // Road-relative
  const ra = Math.atan(roadDX(p.z));
  let rel = p.heading - ra;
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
    p.heading = ra + (p.heading - ra) * 0.5 - side * 0.02;
    p.v *= Math.pow(0.55, dt);
    if (p.v > 8) {
      p.scrape = Math.min(1, p.v / 40);
      damage(dt * 4 * p.scrape, false);
      for (let i = 0; i < 3; i++) emit(p.x + side * 1, roadY(p.z) + 0.6, p.z + 1, -side * Math.random() * 3, Math.random() * 4, p.v * 0.3 + Math.random() * 3, 0.4, 0.3, 1, 0.7, 0.2);
      shake = Math.max(shake, 0.15);
    }
  }

  // Centre-median rumble: grinding the concrete Jersey divider
  if (Math.abs(p.lat) < 0.62 && Math.abs(p.v) > 4) {
    shake = Math.max(shake, 0.06);
    p.scrape = 0.35;
    p.v *= Math.pow(0.985, dt);
    damage(dt * 1.5, false);
    if (Math.random() < dt * 22) emit(p.x, roadY(p.z) + 0.25, p.z + 0.5, (Math.random() - 0.5) * 3, Math.random() * 3, p.v * 0.4, 0.3, 0.25, 1, 0.8, 0.3);
  }
  S.wrongWay = Math.abs(rel) > Math.PI / 2 && p.v > 3;

  // Gear & RPM
  const av = Math.abs(p.v);
  let g = 1; while (g < 6 && av > GEARS[g] * 0.97) g++;
  if (g !== p.gear) { if (g > p.gear) audio.gearShift(); p.gear = g; }
  const lo = GEARS[g - 1] * 0.7, hi = GEARS[g];
  const targetRpm = 900 + Math.max(0, (av - lo) / (hi - lo)) * 6800 + (throttle && av < 2 ? 2500 : 0);
  p.rpm += (Math.min(8200, targetRpm) - p.rpm) * Math.min(1, dt * 8);

  // Visuals
  const y = roadY(p.z);
  p.root.position.set(p.x, y, p.z);
  const pitch = -Math.atan(roadDY(p.z)) + (acc < -10 ? 0.02 : throttle ? -0.012 : 0);
  p.root.rotation.set(pitch, p.heading, -p.steer * Math.min(1, av / 50) * 0.04, 'YXZ');
  p.wheels.forEach((w, i) => {
    w.rotation.x -= p.v * dt / 0.36;
    if (i < 2) w.rotation.y = p.steer * 0.45;
  });
  if (p.steeringWheel) {
    p.steeringWheel.rotation.z = p.steer * 2.2;
  }
  p.brakeMat.color.setHex(down || hand ? 0xff1010 : 0x550000);

  // Tyre smoke & nitro flames
  if (p.skid > 0.3) for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const bx = p.x + Math.cos(p.heading) * 0.8 * s - Math.sin(p.heading) * 1.5, bz = p.z - Math.sin(p.heading) * 0.8 * s - Math.cos(p.heading) * 1.5;
    emit(bx, y + 0.3, bz, (Math.random() - 0.5), 0.5, p.v * 0.5, 1.2, 1.2, 0.8, 0.8, 0.8, 2.5);
  }
  if (wantNitro) for (let i = 0; i < 3; i++) {
    const s = i % 2 ? 0.35 : -0.35;
    const bx = p.x + Math.cos(p.heading) * s - Math.sin(p.heading) * 2.35, bz = p.z - Math.sin(p.heading) * 2.35 - Math.cos(p.heading) * 2.35;
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
    if (!t.passed && dz < -t.halfL - 2.2) {
      t.passed = true;
      if (!t.crashed && Math.abs(dl) < 3.4 && p.v > 22) {
        S.near++; const bonus = Math.round((t.oncoming ? 500 : 250) * S.mult);
        S.score += bonus; S.mult = Math.min(8, S.mult + 1); S.multTimer = 6;
        popup((t.oncoming ? 'HEAD-ON NEAR MISS +' : 'NEAR MISS +') + bonus, t.oncoming ? '#ff8c00' : '#ffd23f');
        audio.whoosh(0.6, Math.sign(dl) * 0.7);
      } else if (!t.crashed && p.v > 15) audio.whoosh(0.25, Math.sign(dl) * 0.7);
    }
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
      else {
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
  else if (camMode === 3) {
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    tp = new THREE.Vector3(p.x, y + 0.7, p.z).addScaledVector(fwd, 4.5).addScaledVector(side, 5.2);
    tl = new THREE.Vector3(p.x, y + 0.9, p.z).addScaledVector(fwd, 2);
  }
  else if (camMode === 4) {
    tp = new THREE.Vector3(p.x, y + 42, p.z - 7);
    tl = new THREE.Vector3(p.x, y, p.z + 3);
  }
  else {
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
  sun.position.set(p.x + 30, y + 60, p.z - 20); sun.target.position.set(p.x, y, p.z + 10);
}

// =====================================================================
//  HUD
// =====================================================================
const el = id => document.getElementById(id);
const gauge = el('gauge').getContext('2d'), mini = el('minimap').getContext('2d');
function drawHUD() {
  const p = player;
  el('score').textContent = Math.round(S.score).toLocaleString();
  el('dist').textContent = (S.dist / 1000).toFixed(1) + ' km';
  el('mult').textContent = 'x' + S.mult;
  const best = Math.max(S.score, +localStorage.getItem('hr3d_best') || 0);
  el('best').textContent = Math.round(best).toLocaleString();
  el('healthbar').style.width = Math.max(0, p.health) + '%';
  el('healthbar').style.background = p.health < 30 ? '#ff2b2b' : p.health < 60 ? '#ffb300' : '#2bd84d';
  el('nitrobar').style.width = Math.max(0, p.nitro) + '%';
  el('warning').classList.toggle('hidden', !S.wrongWay);

  // Speedometer
  const gw = gauge.canvas.width, gh = gauge.canvas.height;
  gauge.clearRect(0, 0, gw, gh);
  const cx = gw / 2, cy = gh / 2, r = 100;
  gauge.beginPath(); gauge.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
  gauge.strokeStyle = 'rgba(255,255,255,0.18)'; gauge.lineWidth = 14; gauge.stroke();
  const speedRatio = Math.min(1, Math.abs(p.v) / 85);
  gauge.beginPath(); gauge.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + speedRatio * Math.PI * 1.5);
  gauge.strokeStyle = p.nitroOn ? '#00e5ff' : '#ffb300'; gauge.lineWidth = 14; gauge.stroke();
  gauge.fillStyle = '#fff'; gauge.font = 'bold 44px sans-serif'; gauge.textAlign = 'center';
  gauge.fillText(Math.round(Math.abs(p.v) * KMH), cx, cy + 10);
  gauge.font = '12px sans-serif'; gauge.fillStyle = '#888'; gauge.fillText('KM/H', cx, cy + 30);
  gauge.font = 'bold 18px sans-serif'; gauge.fillStyle = '#ffb300'; gauge.fillText('GEAR ' + p.gear, cx, cy + 55);

  // Minimap
  const mw = mini.canvas.width, mh = mini.canvas.height;
  mini.clearRect(0, 0, mw, mh);
  mini.fillStyle = 'rgba(10,14,20,0.7)'; mini.fillRect(0, 0, mw, mh);
  const mx = mw / 2, my = mh - 40, mapScale = 0.55;
  mini.strokeStyle = 'rgba(255,255,255,0.2)'; mini.lineWidth = 2;
  mini.strokeRect(mx - ROAD_HALF * 3, 10, ROAD_HALF * 6, mh - 20);
  mini.fillStyle = '#00e5ff'; mini.beginPath(); mini.arc(mx + p.lat * 3, my, 4, 0, Math.PI * 2); mini.fill();
  for (const t of traffic) {
    const dy = (t.z - p.z) * mapScale;
    if (dy > -30 && dy < mh - 60) {
      mini.fillStyle = t.crashed ? '#888' : t.oncoming ? '#ff3b3b' : '#ffc400';
      mini.fillRect(mx + t.lane * 3 - 2, my - dy - 4, 4, 8);
    }
  }
}

// =====================================================================
//  GAME LOOP CONTROLS & MENUS
// =====================================================================
function startGame() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  ads.maybeShowInterstitial(beginRace);
}

function beginRace() {
  audio.init(musicData); audio.resume();
  ['menu', 'over', 'pause'].forEach(s => el(s).classList.add('hidden'));
  el('hud').classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0) el('touch').classList.remove('hidden');
  resetGame();
  updateCamera(0.016, true);
  state = 'play';
  S.runEnded = false;
  ads.gameplayStart();
  popup('GO!', '#3bff7a');
}

function endGame() {
  S.over = true; S.overTimer = 2.0; S.runEnded = true; audio.crash(1.0); shake = 2.5;
  ads.markRunEnded();
  ads.gameplayStop();
  popup('WRECKED', '#ff3b3b');
}

function showGameOver() {
  state = 'over';
  const best = +localStorage.getItem('hr3d_best') || 0;
  const sc = Math.round(S.score);
  const nb = sc > best;
  if (nb) localStorage.setItem('hr3d_best', sc);
  el('fScore').textContent = sc.toLocaleString(); el('fDist').textContent = (S.dist / 1000).toFixed(2) + ' km';
  el('fTop').textContent = Math.round(S.top * KMH) + ' km/h'; el('fNear').textContent = S.near;
  el('newbest').classList.toggle('hidden', !nb);
  el('reviveBtn').classList.toggle('hidden', S.revived || !ads.canOfferRewarded());
  el('reviveBtn').disabled = false;
  el('over').classList.remove('hidden'); el('touch').classList.add('hidden');
}

function revivePlayer() {
  const p = player;
  S.over = false; S.overTimer = 0;
  p.health = Math.max(p.health, 55);
  p.nitro = Math.max(p.nitro, 50);
  p.invuln = 3; p.spin = 0; p.skid = 0; p.scrape = 0;
  p.v = Math.min(p.v, 6);
  p.heading = Math.atan(roadDX(p.z));
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

// Menu wiring
const colorsDiv = el('colors');
CAR_COLORS.forEach((c, i) => {
  const d = document.createElement('div'); d.style.background = c; if (!i) d.classList.add('sel');
  d.onclick = () => {
    playerColor = c;
    colorsDiv.querySelectorAll('div').forEach(x => x.classList.remove('sel'));
    d.classList.add('sel');
    if (player && player.bodyMat) player.bodyMat.color.set(c);
  };
  colorsDiv.appendChild(d);
});
document.querySelectorAll('.diff button').forEach(b => b.onclick = () => {
  difficulty = +b.dataset.d;
  document.querySelectorAll('.diff button').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
});
el('startBtn').onclick = startGame; el('againBtn').onclick = startGame;
el('resumeBtn').onclick = togglePause; el('quitBtn').onclick = toMenu; el('menuBtn').onclick = toMenu;

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
  if (e.repeat) return;
  if (e.code === 'KeyC') { camMode = (camMode + 1) % CAM_NAMES.length; popup('CAM: ' + CAM_NAMES[camMode], '#8fe3ff'); }
  if (e.code === 'KeyM') audio.toggleMusic();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter' && (state === 'menu' || state === 'over')) startGame();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') togglePause(); });

document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  if (k === 'cam') {
    b.addEventListener('touchstart', e => { e.preventDefault(); camMode = (camMode + 1) % CAM_NAMES.length; popup('CAM: ' + CAM_NAMES[camMode], '#8fe3ff'); }, { passive: false });
    return;
  }
  const set = v => e => { e.preventDefault(); keys[k] = v; };
  b.addEventListener('touchstart', set(true), { passive: false });
  b.addEventListener('touchend', set(false), { passive: false });
  b.addEventListener('touchcancel', set(false), { passive: false });
});

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
    sun.position.set(player.x + 30, y + 60, player.z - 20); sun.target.position.set(player.x, y, player.z);
  } else if (state === 'over' || state === 'pause') {
    audio.update({ active: false, rpm: 900, throttle: 0, speed: 0, skid: 0, scrape: 0, nitro: false, horn: false });
  }
  renderer.render(scene, camera);
}
loop();
