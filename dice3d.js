/* ============ Dados 3D ============
   Lanza dados con física real sobre el mapa (estilo Dice So Nice de Foundry).
   El resultado ya viene decidido (lo calcula app.js o el servidor): se simula la
   tirada, se mira qué cara queda arriba y se gira el modelo con una simetría del
   poliedro para que esa cara muestre el número correcto. Así todos los clientes
   ven el mismo resultado que está en el registro.

   API:  play({ dice:[{f:20,v:17}, …], seed, color, label, total, sub, crit, mount, inset:{top,right,bottom,left} })
   f: 4 | 6 | 8 | 10 | 12 | 20 | 100   ·   mount: elemento donde dibujar (por defecto #stage)
*/
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry,
  ShadowMaterial, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, CanvasTexture,
  Vector3, Quaternion, Matrix4, SRGBColorSpace, PCFShadowMap,
  World, Body, ConvexPolyhedron, Vec3, Plane, Material, ContactMaterial
} from './vendor/dice-libs.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const FPS = 60, MAX_FRAMES = 60 * 7, MAX_DICE = 12;
const HOLD_MS = 2600, FADE_MS = 600;
const TEX = 256;

/* ---------- geometría de cada dado ---------- */
function rawVerts(kind){
  if (kind === 4) return [[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]];
  if (kind === 6){ const v = []; for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push([x,y,z]); return v; }
  if (kind === 8) return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  if (kind === 10){
    const a = 0.105, c36 = Math.cos(Math.PI / 5), h = a * (1 + c36) / (1 - c36), v = [[0,h,0],[0,-h,0]];
    for (let i = 0; i < 10; i++){ const t = i * Math.PI / 5; v.push([Math.cos(t), i % 2 ? -a : a, Math.sin(t)]); }
    return v;
  }
  if (kind === 12){
    const v = [], p = PHI, q = 1 / PHI;
    for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) v.push([x,y,z]);
    for (const s of [-1,1]) for (const t of [-1,1]){ v.push([0, s*q, t*p]); v.push([s*q, t*p, 0]); v.push([s*p, 0, t*q]); }
    return v;
  }
  // 20
  const v = [];
  for (const s of [-1,1]) for (const t of [-1,1]){ v.push([0, s, t*PHI]); v.push([s, t*PHI, 0]); v.push([s*PHI, 0, t]); }
  return v;
}
const SIZE = { 4: 1.25, 6: 0.95, 8: 1.12, 10: 1.08, 12: 1.15, 20: 1.2 };

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const scale = (a, s) => [a[0]*s, a[1]*s, a[2]*s];

/* Caras de la envolvente convexa (polígonos en sentido antihorario vistos desde fuera) */
function hullFaces(V){
  const faces = [], seen = new Set(), eps = 1e-6;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) for (let k = j + 1; k < V.length; k++){
    let n = cross(sub(V[j], V[i]), sub(V[k], V[i]));
    if (len(n) < eps) continue;
    n = norm(n); let d = dot(n, V[i]);
    let pos = 0, neg = 0; const on = [];
    V.forEach((p, m) => { const s = dot(n, p) - d; if (s > 1e-5) pos++; else if (s < -1e-5) neg++; else on.push(m); });
    if (pos && neg) continue;
    if (pos){ n = scale(n, -1); d = -d; }
    const key = on.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue; seen.add(key);
    const c = on.reduce((acc, m) => [acc[0]+V[m][0]/on.length, acc[1]+V[m][1]/on.length, acc[2]+V[m][2]/on.length], [0,0,0]);
    const u = norm(sub(V[on[0]], c)), w = cross(n, u);
    on.sort((a, b) => { const pa = sub(V[a], c), pb = sub(V[b], c); return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u)); });
    faces.push({ verts: on, normal: n, c });
  }
  return faces;
}

const DEFS = {};
function def(kind){
  if (DEFS[kind]) return DEFS[kind];
  const s = SIZE[kind];
  const raw = rawVerts(kind), rmax = Math.max(...raw.map(len));
  const V = raw.map(p => scale(p, s / rmax));
  const faces = hullFaces(V);
  // Direcciones "clave": normales de cara (o vértices en el d4, que se lee por la punta de arriba)
  const keys = kind === 4 ? V.map(norm) : faces.map(f => f.normal);
  // Numeración: caras opuestas suman n+1
  const labelOf = new Array(keys.length).fill(-1);
  if (kind === 4) labelOf.forEach((_, i) => { labelOf[i] = i; });
  else {
    let lo = 0, hi = keys.length - 1;
    for (let i = 0; i < keys.length; i++){
      if (labelOf[i] >= 0) continue;
      let opp = -1, best = 2;
      keys.forEach((k, j) => { if (j !== i && labelOf[j] < 0){ const dd = dot(k, keys[i]); if (dd < best){ best = dd; opp = j; } } });
      labelOf[i] = lo++; if (opp >= 0) labelOf[opp] = hi--;
    }
  }
  return (DEFS[kind] = { kind, V, faces, keys, labelOf, sym: {} });
}

/* Simetría del poliedro que lleva la clave a → clave b (memorizada) */
function symmetry(D, a, b){
  const id = a + '>' + b;
  if (D.sym[id]) return D.sym[id];
  const ka = D.keys[a], kb = D.keys[b];
  let ref = -1;
  D.keys.forEach((k, i) => { if (ref < 0 && i !== a && Math.abs(dot(k, ka)) < 0.999) ref = i; });
  const frame = (x, y) => { const e1 = x, e2 = norm(sub(y, scale(x, dot(x, y)))), e3 = cross(e1, e2); return new Matrix4().makeBasis(new Vector3(...e1), new Vector3(...e2), new Vector3(...e3)); };
  const Fa = frame(ka, D.keys[ref]), FaInv = Fa.clone().transpose();
  const ang = dot(ka, D.keys[ref]);
  for (let j = 0; j < D.keys.length; j++){
    if (j === b || Math.abs(dot(kb, D.keys[j]) - ang) > 1e-4) continue;
    const M = frame(kb, D.keys[j]).multiply(FaInv);
    const ok = D.V.every(p => { const r = new Vector3(...p).applyMatrix4(M); return D.V.some(q => Math.hypot(r.x-q[0], r.y-q[1], r.z-q[2]) < 1e-3); });
    if (ok) return (D.sym[id] = new Quaternion().setFromRotationMatrix(M));
  }
  return (D.sym[id] = new Quaternion());
}

/* ---------- texturas ---------- */
const FONT = '"Cinzel", Georgia, "Times New Roman", serif';
function labelText(type, idx){
  if (type === 'd10t') return idx === 0 ? '00' : String(idx * 10);
  if (type === 'd10u') return String(idx);
  return String(idx + 1);
}
function kindOf(type){ return type === 'd10t' || type === 'd10u' ? 10 : +type.slice(1); }
const FONT_FRAC = { 6: 0.40, 8: 0.30, 10: 0.27, 12: 0.30, 20: 0.25, 4: 0.17 };

function drawNumber(g, txt, x, y, px, rot, theme, underline){
  g.save(); g.translate(x, y); g.rotate(rot);
  g.font = '800 ' + px + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(txt).width, maxW = px * 1.25;
  if (w > maxW) g.scale(maxW / w, 1);
  g.lineJoin = 'round'; g.lineWidth = Math.max(3, px * 0.1); g.strokeStyle = theme.edge;
  g.strokeText(txt, 0, px * 0.04); g.fillStyle = theme.ink; g.fillText(txt, 0, px * 0.04);
  if (underline){ g.fillRect(-px * 0.28, px * 0.48, px * 0.56, Math.max(3, px * 0.08)); }
  g.restore();
}
function faceCanvas(theme){
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(TEX/2, TEX/2, TEX*0.05, TEX/2, TEX/2, TEX*0.6);
  grd.addColorStop(0, theme.hi); grd.addColorStop(1, theme.body);
  g.fillStyle = grd; g.fillRect(0, 0, TEX, TEX);
  return { c, g };
}
function texFrom(c){ const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t; }

/* Geometría con UV por cara + un material por cara */
const MESH_CACHE = {};
function meshParts(type, theme){
  const key = type + '|' + theme.id;
  if (MESH_CACHE[key]) return MESH_CACHE[key];
  const kind = kindOf(type), D = def(kind);
  const pos = [], nor = [], uv = [], geo = new BufferGeometry(), mats = [];
  let start = 0;
  D.faces.forEach((f, fi) => {
    const P = f.verts.map(i => D.V[i]), c = f.c, n = f.normal;
    // "arriba" del número: hacia el vértice más lejano (hacia el borde en el d6)
    let upPt = P.reduce((a, b) => (len(sub(b, c)) > len(sub(a, c)) ? b : a));
    if (kind === 6) upPt = scale([P[0][0]+P[1][0], P[0][1]+P[1][1], P[0][2]+P[1][2]], 0.5);
    if (kind === 4) upPt = P[0];
    const up = norm(sub(upPt, c)), right = cross(up, n);
    const R = Math.max(...P.map(p => len(sub(p, c)))) * 1.02;
    const toUV = p => { const d = sub(p, c); return [0.5 + dot(d, right) / (2 * R), 0.5 + dot(d, up) / (2 * R)]; };
    for (let t = 1; t < P.length - 1; t++){
      [P[0], P[t], P[t + 1]].forEach(p => { pos.push(...p); nor.push(...n); uv.push(...toUV(p)); });
    }
    const count = (P.length - 2) * 3;
    geo.addGroup(start, count, fi); start += count;
    // textura de la cara
    const { c: cv, g } = faceCanvas(theme);
    const px = TEX * FONT_FRAC[kind];
    if (kind === 4){
      f.verts.forEach((vi, k) => {
        const [u, v] = toUV(D.V[vi]);
        const x = (0.5 + (u - 0.5) * 0.5) * TEX, y = (1 - (0.5 + (v - 0.5) * 0.5)) * TEX;
        const rot = Math.atan2(x - TEX/2, -(y - TEX/2));
        drawNumber(g, labelText(type, D.labelOf[vi]), x, y, px * 1.5, rot, theme, false);
      });
    } else {
      const li = D.labelOf[fi], txt = labelText(type, li);
      const cy = kind === 10 ? TEX * 0.55 : TEX / 2;
      drawNumber(g, txt, TEX / 2, cy, px, 0, theme, (txt === '6' || txt === '9') && kind !== 6);
    }
    mats.push(new MeshStandardMaterial({ map: texFrom(cv), roughness: 0.42, metalness: 0.06 }));
  });
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return (MESH_CACHE[key] = { geo, mats });
}

/* ---------- colores ---------- */
export const THEMES = [
  { id: 'rubi',      body: '#7a0f16', hi: '#b3202a', ink: '#f6e7c1', edge: '#2a0306' },
  { id: 'zafiro',    body: '#12306e', hi: '#2856b8', ink: '#ffffff', edge: '#06112b' },
  { id: 'esmeralda', body: '#0d5233', hi: '#1d8a57', ink: '#f3e9c6', edge: '#03190e' },
  { id: 'amatista',  body: '#45206e', hi: '#7140b0', ink: '#f7e8ff', edge: '#16062a' },
  { id: 'obsidiana', body: '#141414', hi: '#3a3a3a', ink: '#e8c26a', edge: '#000000' },
  { id: 'hueso',     body: '#cdbf9f', hi: '#f2e8d2', ink: '#2b1d10', edge: '#f8f1e2' },
  { id: 'cobre',     body: '#7a3a12', hi: '#c06a2b', ink: '#fff2dc', edge: '#2b1005' },
  { id: 'hielo',     body: '#2c6f86', hi: '#7cc6dc', ink: '#ffffff', edge: '#0b2a35' },
  { id: 'npc',       body: '#1b0b0b', hi: '#3d1515', ink: '#ff5a4a', edge: '#000000' }
];
export function themeFor(key){
  if (key === 'npc') return THEMES[THEMES.length - 1];
  let h = 0; for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return THEMES[h % (THEMES.length - 1)];
}

/* ---------- utilidades ---------- */
function rng(seed){
  let a = typeof seed === 'number' ? seed >>> 0 : 0;
  if (typeof seed === 'string') for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  if (!a) a = (Math.random() * 2 ** 32) >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* Expande d100 en decenas + unidades y limita el número de dados */
function expand(dice){
  const out = [];
  for (const d of dice){
    if (out.length >= MAX_DICE) break;
    const f = +d.f, v = +d.v;
    if (f === 100){
      const t = v >= 100 ? 0 : Math.floor(v / 10), u = v >= 100 ? 0 : v % 10;
      out.push({ type: 'd10t', target: t }); if (out.length < MAX_DICE) out.push({ type: 'd10u', target: u });
    } else if ([4, 6, 8, 10, 12, 20].includes(f) && v >= 1 && v <= f){
      out.push({ type: 'd' + f, target: v - 1 });
    }
  }
  return out;
}

/* ---------- escena ---------- */
let R = null; // estado del renderizador
function ensureRenderer(mount){
  if (R && R.mount === mount) return R;
  if (R){ R.canvas.remove(); R.label.remove(); R.renderer.dispose(); }
  const canvas = document.createElement('canvas');
  canvas.className = 'dice3d-layer';
  const fixed = mount === document.body;
  canvas.style.cssText = 'position:' + (fixed ? 'fixed' : 'absolute') + ';inset:0;width:100%;height:100%;pointer-events:none;z-index:' + (fixed ? 120 : 9) + ';opacity:0;transition:opacity ' + FADE_MS + 'ms';
  const label = document.createElement('div');
  label.className = 'dice3d-label';
  label.style.cssText = 'position:' + (fixed ? 'fixed' : 'absolute') + ';left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;z-index:' + (fixed ? 121 : 15) + ';opacity:0;transition:opacity .35s, transform .35s;text-align:center;white-space:nowrap;font-family:Inter,system-ui,sans-serif';
  mount.appendChild(canvas); mount.appendChild(label);
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 1, 400);
  scene.add(new HemisphereLight(0xfff4e0, 0x30261c, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0015; sun.shadow.radius = 4;
  scene.add(sun); scene.add(sun.target);
  const floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.4 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  R = { mount, canvas, label, renderer, scene, camera, sun, floor, meshes: [], bounds: null, raf: 0 };
  return R;
}

function layout(inset){
  inset = Object.assign({ top: 10, right: 10, bottom: 10, left: 10 }, inset || {});
  const w = Math.max(1, R.mount === document.body ? window.innerWidth : R.mount.clientWidth);
  const h = Math.max(1, R.mount === document.body ? window.innerHeight : R.mount.clientHeight);
  R.renderer.setSize(w, h, false);
  // tamaño del dado en pantalla: ~7% del lado menor, entre 26 y 58 px de radio
  const px = Math.max(26, Math.min(58, Math.min(w, h) * 0.07));
  const halfH = (h / 2) / px, halfW = (w / 2) / px;
  const H = halfH / Math.tan((R.camera.fov / 2) * Math.PI / 180);
  R.camera.aspect = w / h; R.camera.position.set(0, H, 0); R.camera.up.set(0, 0, -1); R.camera.lookAt(0, 0, 0);
  R.camera.near = H * 0.3; R.camera.far = H * 1.5; R.camera.updateProjectionMatrix();
  R.floor.scale.set(halfW * 2.4, halfH * 2.4, 1);
  R.sun.position.set(-halfW * 0.35, H * 0.8, -halfH * 0.5);
  const sc = R.sun.shadow.camera, m = Math.max(halfW, halfH) * 1.2;
  sc.left = -m; sc.right = m; sc.top = m; sc.bottom = -m; sc.near = 1; sc.far = H * 2; sc.updateProjectionMatrix();
  // paredes: el borde visible menos márgenes (en px) y menos la altura del dado (perspectiva)
  const u = 1 / px, pad = 0.35;
  const x0 = -halfW + inset.left * u + pad, x1 = halfW - inset.right * u - pad;
  const z0 = -halfH + inset.top * u + pad, z1 = halfH - inset.bottom * u - pad;
  R.bounds = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hw: (x1 - x0) / 2, hh: (z1 - z0) / 2, w, h, px };
}

/* Simulación completa por adelantado (pasos fijos) → fotogramas + golpes para el sonido */
function simulate(items, rand){
  const { hw, hh, cx, cz, x0, x1, z0, z1 } = R.bounds;
  const world = new World({ gravity: new Vec3(0, -55, 0), allowSleep: true });
  const mDice = new Material('dice'), mFloor = new Material('floor'), mWall = new Material('wall');
  world.addContactMaterial(new ContactMaterial(mDice, mFloor, { friction: 0.45, restitution: 0.3 }));
  world.addContactMaterial(new ContactMaterial(mDice, mWall, { friction: 0.05, restitution: 0.75 }));
  world.addContactMaterial(new ContactMaterial(mDice, mDice, { friction: 0.12, restitution: 0.5 }));
  const plane = (mat, pos, axis, ang) => { const b = new Body({ mass: 0, material: mat, shape: new Plane() }); b.position.set(...pos); b.quaternion.setFromAxisAngle(new Vec3(...axis), ang); world.addBody(b); };
  plane(mFloor, [0, 0, 0], [1, 0, 0], -Math.PI / 2);
  plane(mWall, [x0, 0, 0], [0, 1, 0], Math.PI / 2);
  plane(mWall, [x1, 0, 0], [0, 1, 0], -Math.PI / 2);
  plane(mWall, [0, 0, z0], [0, 1, 0], 0);
  plane(mWall, [0, 0, z1], [0, 1, 0], Math.PI);
  plane(mWall, [0, 30, 0], [1, 0, 0], Math.PI / 2); // techo

  // Lado desde el que se lanza (aleatorio) y dirección hacia el centro con algo de dispersión
  const side = Math.floor(rand() * 4);
  const bodies = items.map((it, i) => {
    const D = def(kindOf(it.type));
    const shape = new ConvexPolyhedron({ vertices: D.V.map(p => new Vec3(...p)), faces: D.faces.map(f => f.verts.slice()) });
    const b = new Body({ mass: 1, material: mDice, shape, linearDamping: 0.14, angularDamping: 0.22, allowSleep: true, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.25 });
    const spread = (rand() - 0.5) * 2, k = (i - (items.length - 1) / 2) * 2.3;
    let x, z, vx, vz;
    const sp = 16 + rand() * 8;
    if (side === 0){ x = x0 + 1.5; z = cz + k + spread * hh * 0.3; vx = sp; vz = (rand() - 0.5) * sp * 0.6; }
    else if (side === 1){ x = x1 - 1.5; z = cz + k + spread * hh * 0.3; vx = -sp; vz = (rand() - 0.5) * sp * 0.6; }
    else if (side === 2){ z = z1 - 1.5; x = cx + k + spread * hw * 0.3; vz = -sp; vx = (rand() - 0.5) * sp * 0.6; }
    else { z = z0 + 1.5; x = cx + k + spread * hw * 0.3; vz = sp; vx = (rand() - 0.5) * sp * 0.6; }
    x = Math.max(x0 + 1.2, Math.min(x1 - 1.2, x)); z = Math.max(z0 + 1.2, Math.min(z1 - 1.2, z));
    b.position.set(x, 3 + rand() * 3 + (i % 3) * 1.2, z);
    b.quaternion.setFromEuler(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    b.velocity.set(vx, 2 + rand() * 6, vz);
    b.angularVelocity.set((rand() - 0.5) * 40, (rand() - 0.5) * 40, (rand() - 0.5) * 40);
    b.__i = i;
    world.addBody(b);
    return b;
  });
  const frames = [], hits = [];
  let f = 0, still = 0;
  bodies.forEach(b => b.addEventListener('collide', e => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 2.5) hits.push({ f, v: Math.min(1, v / 25) });
  }));
  for (; f < MAX_FRAMES; f++){
    world.step(1 / FPS);
    frames.push(bodies.map(b => [b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
    const asleep = bodies.every(b => b.sleepState === Body.SLEEPING || (b.velocity.lengthSquared() < 0.05 && b.angularVelocity.lengthSquared() < 0.08));
    still = asleep ? still + 1 : 0;
    if (still > 8 && f > 45) break;
  }
  return { frames, hits };
}

/* Sonido de los dados (WebAudio, ruido filtrado muy corto) */
let AC = null;
function clack(vol){
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const dur = 0.05, buf = AC.createBuffer(1, Math.floor(AC.sampleRate * dur), AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    const src = AC.createBufferSource(); src.buffer = buf;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 1600; bp.Q.value = 1.2;
    const g = AC.createGain(); g.gain.value = 0.25 * vol * (window.__diceVolume ?? 1);
    src.connect(bp).connect(g).connect(AC.destination); src.start();
  } catch(e){}
}

function clearMeshes(){ R.meshes.forEach(m => R.scene.remove(m)); R.meshes = []; }

function renderOnce(){ R.renderer.render(R.scene, R.camera); }

function showLabel(opts, meshes){
  if (!opts.label){ R.label.style.opacity = 0; return; }
  // centro de los dados en pantalla
  const c = new Vector3(); meshes.forEach(m => c.add(m.position)); c.multiplyScalar(1 / meshes.length);
  c.y = 2; c.project(R.camera);
  const { w, h } = R.bounds;
  const gap = R.bounds.px * 1.5;
  let x = (c.x * 0.5 + 0.5) * w, y = (-c.y * 0.5 + 0.5) * h, below = y - gap < 120;
  y = below ? y + gap : y - gap;
  x = Math.max(120, Math.min(w - 120, x)); y = Math.max(8, Math.min(h - 8, y));
  const crit = opts.crit === 'hit' ? 'box-shadow:0 0 22px 4px rgba(255,205,80,.75);border-color:#ffd25a;' : opts.crit === 'miss' ? 'box-shadow:0 0 22px 4px rgba(220,40,40,.7);border-color:#e04040;' : '';
  const tag = opts.crit === 'hit' ? '<div style="font-size:11px;letter-spacing:2px;color:#ffd25a;font-weight:800">¡CRÍTICO!</div>' : opts.crit === 'miss' ? '<div style="font-size:11px;letter-spacing:2px;color:#ff6a5a;font-weight:800">PIFIA</div>' : '';
  R.label.innerHTML = '<div style="background:rgba(18,14,11,.9);border:1px solid #8a6d3b;border-radius:12px;padding:6px 14px;color:#f3e6c8;' + crit + '">' + tag +
    '<div style="font-size:12px;opacity:.85">' + esc(opts.label) + '</div>' +
    '<div style="font-family:Cinzel,Georgia,serif;font-weight:800;font-size:30px;line-height:1.1;color:#fff">' + esc(String(opts.total ?? '')) + '</div>' +
    (opts.sub ? '<div style="font-size:11px;opacity:.7;max-width:260px;overflow:hidden;text-overflow:ellipsis">' + esc(opts.sub) + '</div>' : '') + '</div>';
  R.label.style.left = x + 'px'; R.label.style.top = y + 'px';
  R.label.style.transform = below ? 'translate(-50%,0)' : 'translate(-50%,-100%)'; R.label.style.opacity = 1;
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function run(opts){
  const mount = opts.mount && opts.mount.isConnected && opts.mount.clientWidth > 80 && opts.mount.clientHeight > 80 ? opts.mount : document.body;
  ensureRenderer(mount);
  layout(opts.inset);
  const items = expand(opts.dice || []);
  if (!items.length) return;
  try { await document.fonts.load('800 64px Cinzel'); } catch(e){}
  const theme = typeof opts.color === 'object' ? opts.color : themeFor(opts.color);
  const rand = rng(opts.seed);
  const { frames, hits } = simulate(items, rand);
  const last = frames[frames.length - 1];
  // Cara que queda arriba en cada dado → simetría para mostrar el valor pedido
  clearMeshes();
  const fixes = items.map((it, i) => {
    const D = def(kindOf(it.type));
    const q = new Quaternion(last[i][3], last[i][4], last[i][5], last[i][6]);
    const upLocal = new Vector3(0, 1, 0).applyQuaternion(q.clone().invert());
    let top = 0, best = -2;
    D.keys.forEach((k, j) => { const d = k[0]*upLocal.x + k[1]*upLocal.y + k[2]*upLocal.z; if (d > best){ best = d; top = j; } });
    const want = D.labelOf.indexOf(it.target);
    return symmetry(D, want, top);
  });
  const meshes = items.map(it => {
    const { geo, mats } = meshParts(it.type, theme);
    const m = new Mesh(geo, mats);
    m.castShadow = true; R.scene.add(m); return m;
  });
  R.meshes = meshes;
  R.label.style.opacity = 0;
  R.canvas.style.transition = 'none'; R.canvas.style.opacity = 1;
  void R.canvas.offsetWidth; R.canvas.style.transition = 'opacity ' + FADE_MS + 'ms';

  const tmpQ = new Quaternion(), qa = new Quaternion(), qb = new Quaternion();
  const apply = t => {
    const fi = Math.max(0, Math.min(frames.length - 1, t)), i0 = Math.floor(fi), i1 = Math.min(frames.length - 1, i0 + 1), a = fi - i0;
    meshes.forEach((m, k) => {
      const A = frames[i0][k], B = frames[i1][k];
      m.position.set(A[0] + (B[0] - A[0]) * a, A[1] + (B[1] - A[1]) * a, A[2] + (B[2] - A[2]) * a);
      qa.set(A[3], A[4], A[5], A[6]); qb.set(B[3], B[4], B[5], B[6]);
      tmpQ.slerpQuaternions(qa, qb, a).multiply(fixes[k]);
      m.quaternion.copy(tmpQ);
    });
  };
  await new Promise(resolve => {
    const t0 = performance.now(); let hi = 0;
    const tick = now => {
      const t = (now - t0) / 1000 * FPS;
      while (hi < hits.length && hits[hi].f <= t){ if (opts.sound !== false) clack(hits[hi].v); hi++; }
      apply(t); renderOnce();
      if (t < frames.length) R.raf = requestAnimationFrame(tick);
      else resolve();
    };
    R.raf = requestAnimationFrame(tick);
  });
  showLabel(opts, meshes);
  // comprobación: qué valor muestra arriba cada dado (útil para depurar)
  lastShown = items.map((it, i) => {
    const D = def(kindOf(it.type)), up = new Vector3(0, 1, 0).applyQuaternion(meshes[i].quaternion.clone().invert());
    let top = 0, best = -2; D.keys.forEach((k, j) => { const d = k[0]*up.x + k[1]*up.y + k[2]*up.z; if (d > best){ best = d; top = j; } });
    return { type: it.type, want: it.target, shown: D.labelOf[top], tilt: +best.toFixed(3) };
  });
  opts.onSettled && opts.onSettled();
}

let lastShown = [];
export function lastResult(){ return lastShown; }
const queue = []; let busy = false, gen = 0;
function pump(){
  if (busy || !queue.length) return;
  busy = true; gen++;
  const done = () => {
    busy = false;
    if (queue.length){ pump(); return; }
    // mantener el resultado unos segundos y desvanecer
    const myGen = gen;
    setTimeout(() => {
      if (myGen !== gen || busy || !R) return;
      R.canvas.style.opacity = 0; R.label.style.opacity = 0;
      setTimeout(() => { if (myGen === gen && !busy && R){ clearMeshes(); renderOnce(); } }, FADE_MS + 50);
    }, HOLD_MS);
  };
  run(queue.shift()).then(done, e => { console.warn('dice3d', e); done(); });
}

/** Lanza una tirada 3D. Si ya hay dados rodando, espera a que caigan. */
export function play(opts){ queue.push(opts); pump(); }
