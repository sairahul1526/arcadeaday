// Slurp Pot renderer (Render role): three.js scene, stencil hole, instanced props, hero pot, camera, fx.
// GDD §7.3–§7.7, §13.3; D25 (the hole is a stencil, never a ground discard), D31 (big SIZE UP beats), D33 (look).
// three comes only from ./vendor/three.bundle.js (named imports). Pools are created once in initRender.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, BufferGeometry, BufferAttribute,
  InstancedBufferAttribute, MeshLambertMaterial, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial,
  CanvasTexture, Color, Vector3, Matrix4, Quaternion, HemisphereLight, DirectionalLight, Fog, CircleGeometry,
  CylinderGeometry, PlaneGeometry, TorusGeometry, SRGBColorSpace, RepeatWrapping, BackSide, DynamicDrawUsage,
  AlwaysStencilFunc, EqualStencilFunc, NotEqualStencilFunc, ReplaceStencilOp, mergeGeometries,
} from './vendor/three.bundle.js';
import * as props from './props.js';
import * as LD from './levels-data.js';
import { KINDS, KIND_ID } from './catalog.js';
import { edible, createWorld } from './logic.js';
import { TIER, DPR_MIN, DPR_START, DPR_STEP, FX_MAX, ITEM_MAX } from './consts.js';

// ------------------------------------------------------------------ small helpers
const PI = Math.PI, TAU = 2 * PI, D2R = PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ek = (dt, tau) => 1 - Math.exp(-dt / tau);
const lerp = (a, b, t) => a + (b - a) * t;
const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const hexN = (h) => parseInt(String(h || '#FFFFFF').replace('#', '').slice(0, 6), 16) || 0;
const s3 = (h) => { const n = hexN(h); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const sv = (h) => new Vector3(...s3(h));   // sRGB values straight to ShaderMaterials (they skip colour conversion)
function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(0x5107B07);          // render-only RNG (blinks, fx): never Math.random, never the sim

const TOWN = {
  picnic: { sky: '#8FD3FF', fog: '#CFEFFF' },
  market: { sky: '#FFC9A6', fog: '#FFE6D2' },
  harbour: { sky: '#9EE3F5', fog: '#D8F6FF' },
};
// Eyelid colour per skin = the skin's rim enamel (props.js potParts), so blinks read as the pot's own lids.
const LID = { sunny: '#F5B323', cauldron: '#C8743A', wok: '#D9412F', teapot: '#2FB5A5', ricecooker: '#E6D6BA',
  dutch: '#8FE3C8', steamer: '#D9B36B', royal: '#FFD23F', ufo: '#C9D3E0', starladle: '#2B3A8C' };
const BIG_STEPS = new Set([2, 5, 8, 11]);   // D31
const F_ING = 1, F_GATE = 16, F_BOSS = 32;
const SWAY = new Set(['hedge', 'tree', 'bush', 'parasol']);
const WUV = props.WHITE_UV || [0.0635, 0.0635];

// ------------------------------------------------------------------ module state
let renderer = null, scene = null, camera = null, canvas = null, gl = null;
let tier = 'high', REC = false, dpr = 1, cssW = 1, cssH = 1;
let play = { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.6 };
const U = { time: { value: 0 } };
let time = 0, ppu = 50;
let hemi, sun, fog;
let propMat, potMat, gullMat;
const kindMesh = [];                   // by catalog index
const kindCnt = new Int32Array(KINDS.length);
let used = [];                         // catalog indices present in the loaded level
let staticMesh, staticMat, groundTex = null, blankTex, curTown = null, LV = null, BB = null;   // BB = board bounds
let holeG, rimDisc, pit, stew, stewMat;
let potRoot, potG = null, potExtras = {}, skin = null, warmGlow = null;
let eyes, eyeMat;
let shMesh, shA, flatMk, flatA, bbMk, bbP, bbM, fxMesh, fxP, fxC, fxR;
let atlasCv, atlasCtx, atlasTex;
const iconCell = new Int16Array(KINDS.length).fill(-1), iconLoaded = new Set();
let gullG = null;
let lostFn = null, ctxHandlers = null;

// per-world state
let W = null, itemCat = null, itemRot = null, prevSt = null, prevHid = null;
const eGlow = new Float32Array(ITEM_MAX), eOcc = new Float32Array(ITEM_MAX), wobT = new Float32Array(ITEM_MAX);
const popT = new Float32Array(ITEM_MAX), rollA = new Float32Array(ITEM_MAX), rollH = new Float32Array(ITEM_MAX);
const lastX = new Float32Array(ITEM_MAX), lastZ = new Float32Array(ITEM_MAX), rattleT = new Float32Array(ITEM_MAX);

// pot + camera state
const pot = { x: 0, z: 0, r: 0.3, rVis: 0.3 };
const cam = { x: 0, z: 0, vx: 0, vz: 0, rCam: 0.3, yaw: 0, pitch: 55 * D2R, wv: 6, ax: 0, ay: 0 };
let titleOn = false, titleT = 0, reveal = null, punchT = 0, bossCamT = -1, shakeX = 0, shakeZ = 0;
const mood = { biteT: 0, biteDx: 0, biteDz: 1, sizeT: 0, happyT: 0, wideT: 0, squintT: 0, bumpDx: 0, bumpDz: 0,
  celebrateT: -1, sad: false, worried: false, blinkIn: 3, blinkT: -1, sqzT: 0, lookX: 0, lookY: -0.08,
  lid: 0, happy: 0, wide: 0, worry: 0, droop: 0, squeeze: 0, dim: 1, sink: 0, tilt: 0, tiltDx: 0, tiltDz: 1, shockT: -1 };
const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3();
const _v = new Vector3(), _ax = new Vector3(), _up = new Vector3(0, 1, 0);

// frame timing / adaptive DPR
let lastNow = 0, fpsEma = 0;
const win = [];
let winStart = 0;

// ------------------------------------------------------------------ perf tier (D10)
/** 'low' | 'mid' | 'high' from the GPU renderer string and the UA (GDD §13.3). */
export function detectTier(g) {
  let s = '';
  try {
    let ctx = g;
    if (!ctx && typeof document !== 'undefined') { const c = document.createElement('canvas'); ctx = c.getContext('webgl2') || c.getContext('webgl'); }
    if (ctx) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      s = String((ext && ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || ctx.getParameter(ctx.RENDERER) || '');
    }
  } catch (e) { s = ''; }
  if (/Mali-G[0-5]\d|Adreno \(TM\) [3-6]\d\d|PowerVR|SwiftShader|llvmpipe/.test(s)) return 'low';
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /Macintosh/.test(ua));
  return mobile ? 'mid' : 'high';
}

function dprCap() {
  const T = TIER[tier] || TIER.high;
  const dev = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.max(DPR_MIN, Math.min(T.dprMax, Math.sqrt((T.mp * 1e6) / Math.max(1, cssW * cssH)), dev));
}
function applySize() {
  if (!renderer) return;
  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH, false);
}

// ------------------------------------------------------------------ materials
function stencilSkip(m) {   // ground, surfaces, shadows, flat markers: never inside the hole
  m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = NotEqualStencilFunc; return m;
}
function stencilOnly(m) {   // pit + stew: only inside the hole
  m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = EqualStencilFunc; return m;
}

function makePropMat() {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nvarying vec4 vFx;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFx = aFx;
#ifdef USE_INSTANCING
if (aFx.w > 0.0) {
  float sw = sin(uTime * 2.513 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.6) * 0.03 * aFx.w * min(position.y, 1.0);
  transformed.x += sw; transformed.z += sw * 0.6;
}
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFx;
uniform float uTime;
float spB2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float spB4(vec2 a) { return spB2(0.5 * a) * 0.25 + spB2(a); }`)
      .replace('void main() {', `void main() {
  if (vFx.y < 0.999 && spB4(gl_FragCoord.xy) >= vFx.y) discard;`)
      .replace('#include <opaque_fragment>', `{
  vec3 spV = normalize(vViewPosition);
  float spF = 1.0 - clamp(abs(dot(normal, spV)), 0.0, 1.0); spF *= spF;
  outgoingLight += vec3(1.0, 0.91, 0.67) * 0.25 * spF;
  outgoingLight = outgoingLight * (1.0 + 0.04 * vFx.x) + vec3(0.55) * vFx.x * spF;
  outgoingLight += vec3(1.0, 0.65, 0.07) * vFx.z * (0.2 + 0.12 * sin(uTime * 10.05)) * (0.5 + spF);
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'sp-prop-v1';
  return m;
}

const SH_GROUND_V = `attribute vec4 aM; varying vec2 vUv; varying vec4 vM;
void main() { vUv = uv * 2.0 - 1.0; vM = aM; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const COV = 'float cov(float d) { float w = max(fwidth(d), 1e-4); return clamp(0.5 - d / w, 0.0, 1.0); }';

function makeShadowMat() {   // blob (type 0) and the pot's soft ring (type 1); #3A2418
  return stencilSkip(new ShaderMaterial({
    vertexShader: SH_GROUND_V,
    fragmentShader: `varying vec2 vUv; varying vec4 vM;
void main() {
  float r = length(vUv); float a;
  if (vM.y < 0.5) a = 0.28 * (1.0 - smoothstep(0.2, 1.0, r));
  else a = 0.35 * (1.0 - smoothstep(0.0, 0.2, abs(r - 0.74))) * (1.0 - smoothstep(0.9, 1.0, r));
  a *= vM.x; if (a < 0.004) discard;
  gl_FragColor = vec4(0.227, 0.141, 0.094, a);
}`,
    transparent: true, depthWrite: false,
  }));
}
function makeFlatMat() {   // halo (0) · dashed gate outline (1) · gull warn (2) · SIZE UP shock ring (3)
  return stencilSkip(new ShaderMaterial({
    uniforms: { uTime: U.time },
    vertexShader: SH_GROUND_V,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec4 vM;
${COV}
void main() {
  float r = length(vUv); vec4 c;
  if (vM.x < 0.5) {
    float pu = 0.5 + 0.5 * sin(uTime * 7.54 + vM.y);
    float ring = cov(abs(r - 0.8) - 0.1);
    float fill = (1.0 - smoothstep(0.15, 0.8, r)) * 0.22;
    c = vec4(1.0, 0.827, 0.302, max(ring * (0.62 + 0.38 * pu), fill * (0.6 + 0.4 * pu)));
  } else if (vM.x < 1.5) {
    float ang = atan(vUv.y, vUv.x) + uTime * 0.35;
    float dash = step(0.45, fract(ang * 14.0 / 6.2832));
    c = vec4(1.0, 0.98, 0.94, cov(abs(r - 0.86) - 0.05) * dash * 0.9);
  } else if (vM.x < 2.5) {
    c = vec4(0.227, 0.141, 0.094, (1.0 - smoothstep(0.72, 0.84, r)) * 0.3 + cov(abs(r - 0.8) - 0.05) * 0.45);
  } else {
    float p = vM.w;
    c = vec4(1.0, 0.953, 0.769, cov(abs(r - 0.82) - 0.12 * (1.0 - p) - 0.01) * (1.0 - p));
  }
  c.a *= vM.z; if (c.a < 0.004) discard;
  gl_FragColor = c;
}`,
    transparent: true, depthWrite: false,
  }));
}
function makeBillboardMat() {   // padlocks + ingredient icons from the atlas; aP = (x, y, z, size u)
  return new ShaderMaterial({
    uniforms: { uMap: { value: atlasTex } },
    vertexShader: `attribute vec4 aP; attribute vec4 aM; varying vec2 vUv; varying vec2 vM;
void main() { vec4 mv = viewMatrix * vec4(aP.xyz, 1.0); mv.xy += position.xy * aP.w; gl_Position = projectionMatrix * mv; vUv = uv; vM = aM.zw; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; varying vec2 vM;
void main() {
  float cell = vM.y; float col = mod(cell, 8.0), row = floor(cell / 8.0);
  vec2 st = vec2((col + vUv.x) / 8.0, 1.0 - (row + 1.0 - vUv.y) / 8.0);
  vec4 t = texture2D(uMap, st); t.a *= vM.x; if (t.a < 0.01) discard;
  gl_FragColor = t;
}`,
    transparent: true, depthWrite: false,
  });
}
function makeFxMat() {   // crumbs/droplets (0) · confetti (1) · sparkle (2) · heart (3) · steam (4)
  return new ShaderMaterial({
    vertexShader: `attribute vec4 aP; attribute vec4 aC; attribute vec4 aR; varying vec2 vUv; varying vec4 vC; varying float vSh;
void main() {
  vec4 mv = viewMatrix * vec4(aP.xyz, 1.0);
  vec2 q = position.xy;
  if (aR.y > 0.5 && aR.y < 1.5) q.x *= 0.15 + 0.55 * abs(cos(aR.z));
  float c = cos(aR.x), s = sin(aR.x);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  mv.xy += q * aP.w;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0; vC = aC; vSh = aR.y;
}`,
    fragmentShader: `varying vec2 vUv; varying vec4 vC; varying float vSh;
void main() {
  vec2 p = vUv; float a = 1.0;
  if (vSh < 0.5) a = 1.0 - smoothstep(0.65, 1.0, length(p));
  else if (vSh < 1.5) a = 1.0;
  else if (vSh < 2.5) { float d = abs(p.x) * abs(p.y); a = clamp(1.0 - d * 14.0 - length(p) * 0.75, 0.0, 1.0); a = max(a, 1.0 - smoothstep(0.05, 0.32, length(p))); }
  else if (vSh < 3.5) { vec2 h = p * 1.3; h.y += 0.2; float t = h.x * h.x + h.y * h.y - 1.0; float f = t * t * t - h.x * h.x * h.y * h.y * h.y; a = 1.0 - smoothstep(-0.03, 0.03, f); }
  else a = (1.0 - smoothstep(0.15, 1.0, length(p))) * 0.85;
  a *= vC.a; if (a < 0.01) discard;
  gl_FragColor = vec4(vC.rgb, a);
}`,
    transparent: true, depthWrite: false,
  });
}
function makeStewMat() {   // glowing stew: radial #FFD36E → #FF8A2A → #C4501A, swirling herb flecks, 3 bubbles
  return stencilOnly(new ShaderMaterial({
    uniforms: { uTime: U.time, uDim: { value: 1 } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uDim; varying vec2 vP;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  float r = length(vP);
  vec3 col = mix(vec3(1.0, 0.827, 0.431), vec3(1.0, 0.541, 0.165), smoothstep(0.05, 0.6, r));
  col = mix(col, vec3(0.769, 0.314, 0.102), smoothstep(0.55, 0.98, r));
  float ang = atan(vP.y, vP.x) + uTime * 0.22 * (1.25 - r);
  vec2 q = vec2(cos(ang), sin(ang)) * r * 3.3 + 9.0;
  vec2 g = floor(q), f = fract(q);
  float hh = h21(g);
  vec2 o = vec2(h21(g + 7.1), h21(g + 3.3)) * 0.6 + 0.2;
  float herb = (1.0 - smoothstep(0.12, 0.19, length((f - o) * vec2(1.0, 1.7)))) * step(0.45, hh) * (1.0 - smoothstep(0.72, 0.88, r));
  col = mix(col, mix(vec3(0.365, 0.682, 0.231), vec3(0.243, 0.541, 0.18), step(0.7, hh)), herb * 0.92);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float tt = uTime / (0.8 + 0.3 * fi) + fi * 0.37;
    float cyc = floor(tt), ph = fract(tt);
    vec2 bp = (vec2(h21(vec2(cyc, fi + 0.5)), h21(vec2(fi + 2.5, cyc + 1.7))) - 0.5) * 1.05;
    float br = 0.06 + 0.1 * ph, fade = 1.0 - smoothstep(0.78, 1.0, ph);
    float db = length(vP - bp);
    col = mix(col, vec3(1.0, 0.93, 0.66), (1.0 - smoothstep(br * 0.75, br, db)) * 0.6 * fade);
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, br * 0.4, length(vP - bp - vec2(-0.32, -0.32) * br))) * 0.85 * fade);
  }
  col += vec3(1.0, 0.95, 0.8) * (1.0 - smoothstep(0.0, 0.3, length(vP - vec2(-0.3, -0.32)))) * 0.22;
  gl_FragColor = vec4(col * uDim, 1.0);
}`,
  }));
}
function makeEyeMat() {   // two view-space billboard discs: sclera, pupil+glint, lids, ^^, brows, blush
  return new ShaderMaterial({
    uniforms: {
      uC0: { value: new Vector3() }, uC1: { value: new Vector3() }, uS: { value: 0.05 },
      uLook: { value: new Vector3() }, uLid: { value: 0 }, uHappy: { value: 0 }, uWide: { value: 0 },
      uSqueeze: { value: 0 }, uWorry: { value: 0 }, uDroop: { value: 0 }, uBlush: { value: 1 }, uLidCol: { value: sv(LID.sunny) },
    },
    vertexShader: `attribute vec2 corner; attribute float side; uniform vec3 uC0; uniform vec3 uC1; uniform float uS;
varying vec2 vUv; varying float vSide;
void main() { vec3 c = side < 0.5 ? uC0 : uC1; vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += corner * uS * 2.1;
  gl_Position = projectionMatrix * mv; vUv = corner * 2.1; vSide = side; }`,
    fragmentShader: `uniform vec3 uLook; uniform float uLid; uniform float uHappy; uniform float uWide; uniform float uSqueeze;
uniform float uWorry; uniform float uDroop; uniform float uBlush; uniform vec3 uLidCol;
varying vec2 vUv; varying float vSide;
${COV}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec2 p = vUv; float sg = vSide < 0.5 ? -1.0 : 1.0;
  vec3 dark = vec3(0.227, 0.141, 0.094);
  float R = 1.0 + 0.25 * uWide;
  vec2 bq = (p - vec2(1.12 * sg, -0.82)) / vec2(0.6, 0.36);
  float A = (1.0 - smoothstep(0.45, 1.0, length(bq))) * 0.9 * uBlush;
  vec3 col = vec3(1.0, 0.604, 0.659);
  float dS = length(p) - R;
  float sclA = cov(dS), olA = cov(dS - 0.18);
  vec2 pc = uLook.xy * R - vec2(0.0, 0.22 * uDroop);
  float pr = 0.56 * (1.0 + 0.3 * uWide) * (1.0 - 0.22 * uSqueeze);
  vec3 ec = mix(vec3(1.0), dark, cov(length(p - pc) - pr));
  ec = mix(ec, vec3(1.0), cov(length(p - pc - vec2(-0.32, 0.34) * pr) - 0.19));
  float lidOn = step(0.002, uLid + uDroop);
  float lidY = R * (1.0 - 2.0 * uLid) - p.x * sg * 0.4 * uDroop;
  ec = mix(ec, uLidCol, cov(lidY - p.y) * lidOn);
  ec = mix(ec, dark, cov(abs(p.y - lidY) - 0.09) * lidOn);
  vec3 eyeC = mix(dark, ec, sclA);
  float eyeA = olA;
  float arcA = cov(abs(length(p - vec2(0.0, -0.7)) - 1.0) - 0.22) * smoothstep(-0.5, -0.3, p.y);
  eyeC = mix(eyeC, dark, uHappy);
  eyeA = mix(eyeA, arcA, uHappy);
  col = mix(col, eyeC, eyeA); A = eyeA + A * (1.0 - eyeA);
  float brA = cov(seg(p, vec2(sg * 0.95, 1.32), vec2(-sg * 0.5, 1.68)) - 0.14) * uWorry;
  col = mix(col, vec3(0.725, 0.467, 0.055), brA); A = brA + A * (1.0 - brA);
  if (A < 0.004) discard;
  gl_FragColor = vec4(col, A);
}`,
    transparent: true, depthWrite: false,
  });
}

// ------------------------------------------------------------------ geometry helpers
function quadXZ() { return new PlaneGeometry(1, 1).rotateX(-PI / 2); }
function instAttr(geo, name, n, size) {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage); geo.setAttribute(name, a); return a;
}
function pool(geo, mat, n, order) {
  const m = new InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false; m.renderOrder = order;
  scene.add(m); return m;
}
function flush(m, attrs, n) {
  m.count = n; m.visible = n > 0;
  if (!n) return;
  for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
}
/** Non-indexed, exactly position/normal/color/uv (the props.js contract) so mergeGeometries accepts it. */
function prep(g) {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color || g.attributes.color.itemSize !== 3) {
    const c = new Float32Array(n * 3).fill(1), src = g.attributes.color;
    if (src) for (let i = 0; i < n; i++) { c[i * 3] = src.getX(i); c[i * 3 + 1] = src.getY(i); c[i * 3 + 2] = src.getZ(i); }
    g.setAttribute('color', new BufferAttribute(c, 3));
  }
  if (!g.attributes.uv) {
    const u = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { u[i * 2] = WUV[0]; u[i * 2 + 1] = WUV[1]; }
    g.setAttribute('uv', new BufferAttribute(u, 2));
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') g.deleteAttribute(k);
  g.morphAttributes = {};
  return g;
}
function tableGeo(cx, cz) {   // #7A5236 table with a soft radial vignette (vertex colours, white ground uv)
  const g = new PlaneGeometry(200, 200, 40, 40).rotateX(-PI / 2).toNonIndexed();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  const A = new Color('#7A5236'), B = new Color('#6A452C');
  for (let i = 0; i < n; i++) {
    const t = sstep(9, 46, Math.hypot(p.getX(i), p.getZ(i)));
    col[i * 3] = lerp(A.r, B.r, t); col[i * 3 + 1] = lerp(A.g, B.g, t); col[i * 3 + 2] = lerp(A.b, B.b, t);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return prep(g).translate(cx, -0.5, cz);
}

// ------------------------------------------------------------------ icon atlas (8 × 8 cells of 96 px)
const CELL = 96;
function cellXY(c) { return [(c % 8) * CELL, Math.floor(c / 8) * CELL]; }
// DECISION (D33): the ingredient marker is a gold map-pin (point down at the item), not a round chip: a cream disc
// with a dark ring above a red fruit read as a googly eye at game size, and faces belong only to the pot.
function drawChip(c) {
  const [x, y] = cellXY(c), g = atlasCtx, cx = x + CELL / 2, cy = y + 38, R = 33;
  g.clearRect(x, y, CELL, CELL);
  g.beginPath();
  g.arc(cx, cy, R, PI * 0.78, PI * 0.22);
  g.lineTo(cx, y + CELL - 3);
  g.closePath();
  g.fillStyle = '#F5B323'; g.fill();
  g.beginPath(); g.arc(cx, cy, R - 7, 0, TAU); g.fillStyle = '#FFF6E6'; g.fill();
}
function drawFallbackIcon(c, color) {
  drawChip(c);
  const [x, y] = cellXY(c), g = atlasCtx;
  g.beginPath(); g.arc(x + CELL / 2, y + 38, 17, 0, TAU); g.fillStyle = color || '#E8463A'; g.fill();
}
function drawFallbackPadlock() {
  const [x, y] = cellXY(0), g = atlasCtx, cx = x + CELL / 2;
  g.clearRect(x, y, CELL, CELL);
  g.lineWidth = 9; g.strokeStyle = '#7A5236';
  g.beginPath(); g.arc(cx, y + 40, 18, PI, 0); g.lineTo(cx + 18, y + 50); g.moveTo(cx - 18, y + 40); g.lineTo(cx - 18, y + 50); g.stroke();
  g.fillStyle = '#F5B323'; g.strokeStyle = '#3A2418'; g.lineWidth = 5;
  g.beginPath(); g.roundRect ? g.roundRect(cx - 30, y + 44, 60, 44, 10) : g.rect(cx - 30, y + 44, 60, 44); g.fill(); g.stroke();
  g.fillStyle = '#3A2418'; g.beginPath(); g.arc(cx, y + 62, 6, 0, TAU); g.fill(); g.fillRect(cx - 3, y + 62, 6, 14);
}
function loadIcon(c, url, chip) {
  if (iconLoaded.has(c) || typeof Image === 'undefined') return;
  iconLoaded.add(c);
  const img = new Image();
  img.onload = () => {
    const [x, y] = cellXY(c);
    if (chip) { drawChip(c); atlasCtx.drawImage(img, x + 22, y + 12, CELL - 44, CELL - 44); }
    else { atlasCtx.clearRect(x, y, CELL, CELL); atlasCtx.drawImage(img, x + 2, y + 2, CELL - 4, CELL - 4); }
    atlasTex.needsUpdate = true;
  };
  img.onerror = () => {};
  img.src = url;   // document-relative (index.html sits next to art/)
}
function buildAtlas() {
  atlasCv = document.createElement('canvas'); atlasCv.width = atlasCv.height = CELL * 8;
  atlasCtx = atlasCv.getContext('2d');
  drawFallbackPadlock();
  let c = 1;
  for (const K of KINDS) if (K.ing && c < 64) { iconCell[K.i] = c; drawFallbackIcon(c, K.color); c++; }
  atlasTex = new CanvasTexture(atlasCv);
  loadIcon(0, 'art/icon-padlock.webp', false);
}

// ------------------------------------------------------------------ init
/** Creates the renderer and every pool/material at boot (GDD §13.3, §13.6). */
export async function initRender(cv, opts = {}) {
  // DECISION: the GDD's 0.85/1.1 intensities were tuned for three's legacy lighting; r187 is physical
  // (no ×π), so they read dark. Hemisphere 1.75 + sun 2.0 gives the same exposure. Tuned from screenshots.
  canvas = cv;
  REC = !!opts.record || (typeof location !== 'undefined' && /[?&]record=1\b/.test(location.search));
  renderer = new WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', stencil: true });
  renderer.outputColorSpace = SRGBColorSpace;
  gl = renderer.getContext();
  tier = opts.tier === 'low' || opts.tier === 'mid' || opts.tier === 'high' ? opts.tier : detectTier(gl);
  cssW = Math.max(1, cv.clientWidth || cv.width || 1); cssH = Math.max(1, cv.clientHeight || cv.height || 1);
  dpr = REC ? 1 : Math.min(dprCap(), DPR_START);
  applySize();

  scene = new Scene();
  scene.background = new Color(TOWN.picnic.sky);
  fog = new Fog(TOWN.picnic.fog, 20, 60); scene.fog = fog;
  camera = new PerspectiveCamera(40, cssW / cssH, 0.1, 200);
  hemi = new HemisphereLight('#FFF6E8', '#B08A62', 1.75);
  sun = new DirectionalLight('#FFF1D6', 2.0); sun.position.set(-4, 10, 5);
  scene.add(hemi, sun);

  buildAtlas();
  propMat = makePropMat();
  potMat = new MeshPhongMaterial({ vertexColors: true, specular: 0xfff0b0, shininess: 70, emissive: 0x4a2c00 });
  gullMat = new MeshLambertMaterial({ vertexColors: true });

  // static layer (board, ground, surfaces, decor, table): one merged Mesh, rebuilt at loadLevel
  blankTex = new CanvasTexture(Object.assign(document.createElement('canvas'), { width: 4, height: 4 }));
  { const c = blankTex.image.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 4); }
  blankTex.colorSpace = SRGBColorSpace; blankTex.wrapS = blankTex.wrapT = RepeatWrapping;
  staticMat = stencilSkip(new MeshLambertMaterial({ vertexColors: true, map: blankTex }));
  staticMesh = new Mesh(tableGeo(0, 0), staticMat);
  staticMesh.frustumCulled = false; scene.add(staticMesh);

  // the hole (D25): rim disc writes stencil 1; pit and stew draw only where stencil == 1
  holeG = new Group(); scene.add(holeG);
  const discMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  discMat.stencilWrite = true; discMat.stencilRef = 1; discMat.stencilFunc = AlwaysStencilFunc; discMat.stencilZPass = ReplaceStencilOp;
  rimDisc = new Mesh(new CircleGeometry(1, 56).rotateX(-PI / 2).translate(0, 0.001, 0), discMat);
  rimDisc.renderOrder = -2; rimDisc.frustumCulled = false;
  const pg = new CylinderGeometry(0.97, 0.97, 1.7, 44, 6, true).translate(0, -0.85, 0);
  {
    const p = pg.attributes.position, n = p.count, col = new Float32Array(n * 3);
    const stops = [[0, new Color('#F5B323')], [0.12, new Color('#E59A1F')], [0.33, new Color('#B4621C')], [1, new Color('#3A2418')]];
    for (let i = 0; i < n; i++) {
      const t = -p.getY(i) / 1.7; let a = stops[0], b = stops[1];
      for (let s = 1; s < stops.length; s++) if (t <= stops[s][0]) { a = stops[s - 1]; b = stops[s]; break; } else { a = stops[s - 1]; b = stops[s]; }
      const u = clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1), f = 0.84 + 0.16 * clamp(-p.getZ(i) / 0.97, -1, 1);
      col[i * 3] = lerp(a[1].r, b[1].r, u) * f; col[i * 3 + 1] = lerp(a[1].g, b[1].g, u) * f; col[i * 3 + 2] = lerp(a[1].b, b[1].b, u) * f;
    }
    pg.setAttribute('color', new BufferAttribute(col, 3));
  }
  pit = new Mesh(pg, stencilOnly(new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  pit.renderOrder = -1; pit.frustumCulled = false;
  stewMat = makeStewMat();
  stew = new Mesh(new CircleGeometry(0.97, 48).rotateX(-PI / 2).translate(0, -0.55, 0), stewMat);
  stew.renderOrder = -1; stew.frustumCulled = false;
  holeG.add(rimDisc, pit, stew);

  potRoot = new Group(); scene.add(potRoot);
  warmGlow = new Mesh(new PlaneGeometry(0.01, 0.01), props.potGlowMaterial ? props.potGlowMaterial() : new MeshBasicMaterial());
  warmGlow.visible = false; warmGlow.position.set(0, -60, 0); scene.add(warmGlow);   // compiles the skin-lights program at warm-up
  setSkin('sunny');

  // eyes: one mesh, two quads (dummy position; the shader places them)
  {
    const g = new BufferGeometry(), cs = [], sd = [];
    for (let s = 0; s < 2; s++) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { cs.push(x, y); sd.push(s); }
    g.setAttribute('position', new BufferAttribute(new Float32Array(36), 3));
    g.setAttribute('corner', new BufferAttribute(new Float32Array(cs), 2));
    g.setAttribute('side', new BufferAttribute(new Float32Array(sd), 1));
    eyeMat = makeEyeMat(); eyeMat.uniforms.uLidCol.value = sv(LID[skin] || LID.sunny);
    eyes = new Mesh(g, eyeMat); eyes.frustumCulled = false; eyes.renderOrder = 10; scene.add(eyes);
  }

  // props: one InstancedMesh per catalog kind, capacity from levels-data kindMax (D25)
  for (const K of KINDS) {
    let base;
    try { base = props.geometryFor(K.id); } catch (e) { base = null; }
    if (!base || !base.attributes || !base.attributes.position) continue;
    const g = new BufferGeometry();
    for (const n of ['position', 'normal', 'color']) if (base.attributes[n]) g.setAttribute(n, base.attributes[n]);
    if (base.index) g.setIndex(base.index);
    const cap = capFor(K);
    const fx = instAttr(g, 'aFx', cap, 4);
    const m = new InstancedMesh(g, propMat, cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false;
    const ud = base.userData || {};
    m.userData = { K, fx, cap, catA: ud.fp || K.a, h: ud.h || K.h || K.a, sway: SWAY.has(K.id) ? 1 : 0 };
    scene.add(m); kindMesh[K.i] = m;
  }

  // shadows, markers, particles
  { const g = quadXZ(); shA = instAttr(g, 'aM', ITEM_MAX + 4, 4); shMesh = pool(g, makeShadowMat(), ITEM_MAX + 4, 1); }
  { const g = quadXZ(); flatA = instAttr(g, 'aM', 96, 4); flatMk = pool(g, makeFlatMat(), 96, 2); }
  { const g = new PlaneGeometry(1, 1); bbP = instAttr(g, 'aP', 48, 4); bbM = instAttr(g, 'aM', 48, 4); bbMk = pool(g, makeBillboardMat(), 48, 8); }
  { const g = new PlaneGeometry(1, 1); fxP = instAttr(g, 'aP', FX_MAX, 4); fxC = instAttr(g, 'aC', FX_MAX, 4); fxR = instAttr(g, 'aR', FX_MAX, 4); fxMesh = pool(g, makeFxMat(), FX_MAX, 9); }

  try { if (props.gullGroup) { gullG = props.gullGroup(gullMat); gullG.visible = false; gullG.traverse((o) => { o.frustumCulled = false; }); scene.add(gullG); } } catch (e) { gullG = null; }

  // context loss: three restores its own GL state; game.js refills the level on restore
  ctxHandlers = {
    lost: (e) => { e.preventDefault(); if (lostFn) lostFn(true); },
    restored: () => { if (lostFn) lostFn(false); },
  };
  cv.addEventListener('webglcontextlost', ctxHandlers.lost, false);
  cv.addEventListener('webglcontextrestored', ctxHandlers.restored, false);
  placeCamera(0, 0, 6, 0, cam.pitch, cssW / 2, cssH * 0.6);
  return { tier };
}

function capFor(K) {
  // DECISION: levels-data kindMax (max live count per kind over L1–60 + dailies + record) sizes each pool;
  // kinds it does not list (or an empty table) fall back to boss 3 · T0–T1 96 · else 48 (capped at ITEM_MAX).
  const km = LD && LD.kindMax;
  let v = km ? km[K.id] ?? km[K.i] : undefined;
  if (!(v > 0)) v = K.boss ? 3 : K.tier <= 1 ? 96 : 48;
  return clamp(v | 0, 1, ITEM_MAX);
}

/** compileAsync + 2 frames with every pool visible, then restore (GDD §13.6). */
export async function warmUp() {
  if (!renderer) return;
  const saved = [];
  const keep = (o) => saved.push([o, o.visible, o.count]);
  for (const m of kindMesh) if (m) { keep(m); m.visible = true; if (m.count < 1) { m.count = 1; _m.makeTranslation(0, -80, 0); m.setMatrixAt(0, _m); m.instanceMatrix.needsUpdate = true; } }
  for (const m of [shMesh, flatMk, bbMk, fxMesh]) { keep(m); m.visible = true; if (m.count < 1) m.count = 1; }
  keep(warmGlow); warmGlow.visible = true;
  if (gullG) { keep(gullG); gullG.visible = true; }
  // Without KHR_parallel_shader_compile, three logs a console warning from compileAsync; compile synchronously instead.
  try {
    if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* compile on first draw */ }
  for (let f = 0; f < 2; f++) { renderer.render(scene, camera); await new Promise((r) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(r) : setTimeout(r, 16))); }
  for (const [o, v, c] of saved) { o.visible = v; if (c !== undefined) o.count = c; }
}

// ------------------------------------------------------------------ level / skin
/** Fills the static layer for this level (one merged Mesh) and resets per-level render state. */
export function loadLevel(L, skinId) {
  if (!renderer || !L) return;
  LV = L; W = null;
  const town = TOWN[L.town] ? L.town : 'picnic';
  buildStatic(L, town);
  if (town !== curTown) {
    const T = TOWN[town];
    scene.background.set(T.sky); fog.color.set(T.fog);
    let tex = null;
    try { tex = props.groundTexture(town); } catch (e) { tex = null; }
    if (groundTex && groundTex !== tex) groundTex.dispose();
    groundTex = tex;
    if (tex) { tex.wrapS = tex.wrapT = RepeatWrapping; tex.colorSpace = SRGBColorSpace; tex.needsUpdate = true; }
    staticMat.map = tex || blankTex; staticMat.needsUpdate = false;
    curTown = town;
  }
  for (const K of KINDS) if (K.ing && (K.town === town || K.town === 'all') && iconCell[K.i] > 0 && K.icon) loadIcon(iconCell[K.i], 'art/' + K.icon + '.webp', true);
  // kinds present in this level
  for (const c of used) if (kindMesh[c]) { kindMesh[c].visible = false; kindMesh[c].count = 0; }
  const set = new Set();
  for (const it of L.items || []) { const c = KIND_ID[it.kind]; if (c !== undefined && kindMesh[c]) set.add(c); }
  used = [...set];
  setSkin(skinId || skin || 'sunny');
  // reset moods, fx, camera
  resetMood();
  for (let i = 0; i < FX_MAX; i++) fl[i] = 0;
  fxN = 0; fxMesh.count = 0; fxMesh.visible = false;
  reveal = null; punchT = 0; bossCamT = -1;
  const sp = L.spawn || { x: 0, z: 0 }, r0 = +L.r0 || 0.3;
  pot.x = +sp.x || 0; pot.z = +sp.z || 0; pot.r = r0; pot.rVis = r0;
  cam.x = pot.x; cam.z = pot.z; cam.vx = cam.vz = 0; cam.rCam = r0;
}

function buildStatic(L, town) {
  // DECISION: off-board decor on the near side (z > z1, toward the camera) is skipped: at 55° pitch it sits between
  // the camera and the play area and reads as a big blurry blob over the bottom HUD (seen at 390×844).
  const x0 = num(L.x0, -(L.W || 10) / 2), x1 = num(L.x1, (L.W || 10) / 2), z0 = num(L.z0, -(L.D || 10) / 2), z1 = num(L.z1, (L.D || 10) / 2);
  const Wd = num(L.W, x1 - x0), Dd = num(L.D, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const parts = [tableGeo(cx, cz)], fresh = [];
  try { const b = props.boardGeometry(Wd, Dd, town); fresh.push(b); parts.push(prep(b.clone()).translate(cx, 0, cz)); } catch (e) { /* board missing: table only */ }
  for (const s of L.surfaces || []) {
    try {
      const g = props.surfaceGeometry(s.type, s.w, s.d, s.color, town); fresh.push(g);
      parts.push(prep(g.clone()).rotateY(s.rot || 0).translate(s.x, 0, s.z));
    } catch (e) { /* skip one bad surface */ }
  }
  for (const d of L.decor || []) {
    if (d.z > z1 + 0.2) continue;
    try {
      const g = prep(props.geometryFor(d.kind).clone()), s = d.s || 1;
      const inside = d.x > x0 && d.x < x1 && d.z > z0 && d.z < z1;
      parts.push(g.scale(s, s, s).rotateY(d.rot || 0).translate(d.x, inside ? 0 : -0.5, d.z));
    } catch (e) { /* skip */ }
  }
  let merged = null;
  try { merged = mergeGeometries(parts, false); } catch (e) { merged = null; }
  if (!merged) merged = parts[0];
  for (const p of parts) if (p !== merged) p.dispose();
  for (const f of fresh) f.dispose();   // board/surface builders return fresh geometries; decor ones are cached
  const old = staticMesh.geometry;
  staticMesh.geometry = merged;
  if (old && old !== merged) old.dispose();
  BB = { x0, x1, z0, z1 };
}
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/** Swaps the hero pot skin (props.potGroup body gets the gold-enamel Phong material). */
export function setSkin(id) {
  if (!potRoot) return;
  const skins = props.POT_SKINS || ['sunny'];
  id = skins.indexOf(id) >= 0 ? id : 'sunny';
  if (id === skin && potG) return;
  if (potG) potRoot.remove(potG);
  let g = null;
  try { g = props.potGroup(id); } catch (e) { g = null; }
  if (!g) {
    const t = new TorusGeometry(1, 0.11, 10, 40).rotateX(-PI / 2).translate(0, 0.03, 0);
    const n = t.attributes.position.count, c = new Float32Array(n * 3), gc = new Color('#F5B323');
    for (let i = 0; i < n; i++) { c[i * 3] = gc.r; c[i * 3 + 1] = gc.g; c[i * 3 + 2] = gc.b; }
    t.setAttribute('color', new BufferAttribute(c, 3));
    g = new Group(); const b = new Mesh(t, potMat); b.name = 'body'; g.add(b);
  }
  potExtras = {};
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.name === 'body') o.material = potMat; else potExtras[o.name] = o;
  });
  potG = g; potRoot.add(g); skin = id;
  if (eyeMat) eyeMat.uniforms.uLidCol.value = sv(LID[id] || LID.sunny);
}

// ------------------------------------------------------------------ resize / tier / stats
export function resize(w, h, playRect) {
  cssW = Math.max(1, w | 0 || 1); cssH = Math.max(1, h | 0 || 1);
  if (playRect) play = { ...playRect };
  if (!(play.cx >= 0)) play.cx = cssW / 2;
  if (!(play.cy >= 0)) play.cy = cssH * 0.6;
  dpr = REC ? 1 : clamp(dpr, DPR_MIN, dprCap());
  applySize();
}
export function setTier(t) {
  if (t !== 'low' && t !== 'mid' && t !== 'high') return;
  tier = t; dpr = REC ? 1 : Math.min(dprCap(), DPR_START); applySize();
}
export function stats() {
  const r = renderer ? renderer.info.render : { calls: 0, triangles: 0 };
  return { drawCalls: r.calls, tris: r.triangles, fps: Math.round(fpsEma * 10) / 10, dpr, tier };
}
export function pxPerU() { return ppu; }
export function worldToScreen(x, z) {
  if (!camera) return { x: 0, y: 0, on: false };
  _v.set(x, 0, z).project(camera);
  const sx = (_v.x + 1) / 2 * cssW, sy = (1 - _v.y) / 2 * cssH;
  return { x: sx, y: sy, on: _v.z < 1 && sx >= 0 && sx <= cssW && sy >= 0 && sy <= cssH };
}
export function onContextLost(fn) { lostFn = typeof fn === 'function' ? fn : null; }
export function title(on) { const v = !!on; if (v !== titleOn) titleT = 0; titleOn = v; }

// ------------------------------------------------------------------ camera
function placeCamera(tx, tz, wv, yaw, pitch, ax, ay) {
  // DECISION: fog starts just past the board's farthest corner (view depth) and is opaque 16 u later, so the
  // board is never hazed and the table beyond it melts into the town's fog colour instead of a muddy brown band
  // (portrait at a big radius sees ~2.8 × Wv deep). Without a board: d + 4 … d + 38 (GDD).
  const aspect = cssW / cssH;
  const d = wv / (2 * Math.tan(20 * D2R) * aspect);
  camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, tz + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.up.set(0, 1, 0);
  camera.lookAt(tx, 0, tz);
  camera.aspect = aspect; camera.near = Math.max(0.05, d * 0.08); camera.far = d + 80;
  camera.setViewOffset(cssW, cssH, cssW / 2 - ax, cssH / 2 - ay, cssW, cssH);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const b = BB;
  if (b) {
    const cp = camera.position, fx = tx - cp.x, fy = -cp.y, fz = tz - cp.z, fl = Math.hypot(fx, fy, fz) || 1;
    let md = 0;
    for (const x of [b.x0 - 1, b.x1 + 1]) for (const z of [b.z0 - 1, b.z1 + 1]) md = Math.max(md, ((x - cp.x) * fx - cp.y * fy + (z - cp.z) * fz) / fl);
    fog.near = Math.max(d + 4, md + 1); fog.far = fog.near + 16;
  } else { fog.near = d + 4; fog.far = d + 38; }
  ppu = cssW / wv;
  return d;
}
const _c = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
/** Clamp the follow goal so no more than 2 u of table shows past the board (ground hits of the play-rect corners). */
function clampGoal(gx, gz, wv, yaw, pitch, ax, ay) {
  // DECISION: the corners are the play rect's (HUD strips excluded), not the canvas's: the table under the HUD
  // doesn't count, and the board can use the whole visible play area.
  // DECISION: when the view is larger than board + 2 u on both sides (big pot, portrait), centring on the board
  // pushed the pot far off its anchor; instead keep following the pot inside the swapped bounds, so the excess
  // table shows on one flank only (x; depth uses the near-edge pin below).
  // DECISION: the near side (+z, screen bottom, no HUD there in portrait) allows only 0.6 u of table (≤ 2 u per
  // GDD §7.4): 2 u showed a flat ~130 px brown band under the board on 390×844; 0.6 u keeps the board's front bevel
  // in view as the diorama edge. Far side and flanks keep 2 u.
  // DECISION: in depth, when the whole board fits (swapped bounds), pin the board's near edge to the bottom of the
  // play rect: any other goal shows a flat table band under the board; the spare depth goes to the far side.
  const b = BB; if (!b) return [gx, gz];
  placeCamera(gx, gz, wv, yaw, pitch, ax, ay);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  const cp = camera.position, okP = play.w > 1 && play.h > 1;
  const nL = okP ? -1 + 2 * clamp(play.x / cssW, 0, 0.45) : -1, nR = okP ? -1 + 2 * clamp((play.x + play.w) / cssW, 0.55, 1) : 1;
  const nT = okP ? 1 - 2 * clamp(play.y / cssH, 0, 0.45) : 1, nB = okP ? 1 - 2 * clamp((play.y + play.h) / cssH, 0.55, 1) : -1;
  [[nL, nB], [nR, nB], [nR, nT], [nL, nT]].forEach(([nx, ny], k) => {
    const v = _c[k].set(nx, ny, 0.5).unproject(camera).sub(cp);
    const dy = Math.min(v.y, -0.08 * v.length());
    const t = -cp.y / dy, hx = cp.x + v.x * t - gx, hz = cp.z + v.z * t - gz;
    mnx = Math.min(mnx, hx); mxx = Math.max(mxx, hx); mnz = Math.min(mnz, hz); mxz = Math.max(mxz, hz);
  });
  const lo = (a0, a1, mn, mx, g, m1, pinNear) => {
    const L0 = a0 - 2 - mn, L1 = a1 + m1 - mx;   // allowed goal range
    if (L0 > L1) return pinNear ? L1 : clamp(g, L1, L0);
    return clamp(g, L0, L1);
  };
  return [lo(b.x0, b.x1, mnx, mxx, gx, 2, false), lo(b.z0, b.z1, mnz, mxz, gz, 0.6, true)];
}
function springTo(gx, gz, dt) {   // critically damped, ω = 9 (exact step, stable for any dt)
  const w = 9, e = Math.exp(-w * dt);
  for (const [k, v] of [['x', 'vx'], ['z', 'vz']]) {
    const g = k === 'x' ? gx : gz, d0 = cam[k] - g, v0 = cam[v], B = v0 + w * d0;
    cam[k] = g + (d0 + B * dt) * e; cam[v] = (v0 - w * B * dt) * e;
  }
}
function followWv() {
  let wv = 3.6 + 7.2 * cam.rCam;
  if (cssW > cssH) wv *= 1.35;
  return wv;
}
function updateCamera(dt) {
  const land = cssW > cssH;
  cam.rCam += (pot.r - cam.rCam) * ek(dt, 0.45);
  let wv = followWv(), yawT = 0, pitchT = 55 * D2R, ax = play.cx, ay = play.cy;
  if (titleOn) {
    titleT += dt;
    cam.yaw += 0.12 * dt; yawT = cam.yaw; pitchT = 48 * D2R; wv = land ? 15 : 7.5; ay = cssH * 0.5;
  } else {
    cam.yaw += (Math.atan2(Math.sin(-cam.yaw), Math.cos(-cam.yaw))) * ek(dt, 0.35);
    yawT = cam.yaw;
  }
  cam.pitch += (pitchT - cam.pitch) * ek(dt, 0.35);
  cam.ax += (ax - cam.ax) * ek(dt, 0.25); cam.ay += (ay - cam.ay) * ek(dt, 0.25);
  if (Math.abs(cam.ax - ax) > cssW || !(cam.ax > -1e8)) { cam.ax = ax; cam.ay = ay; }
  if (punchT > 0) { punchT = Math.max(0, punchT - dt); wv *= 1 + 0.08 * (1 - (1 - punchT / 0.5) ** 2) * (punchT > 0 ? 1 : 0); }
  if (bossCamT >= 0) {
    bossCamT += dt;
    const t = bossCamT;
    wv *= t < 0.3 ? 1 - 0.1 * sstep(0, 0.3, t) : 0.9 + 0.1 * sstep(0.3, 0.9, t);
    const amp = t < 0.25 ? 0.12 * pot.r * (1 - t / 0.25) : 0;
    shakeX = (rnd() * 2 - 1) * amp; shakeZ = (rnd() * 2 - 1) * amp;
    if (t > 0.9) { bossCamT = -1; shakeX = shakeZ = 0; }
  }
  cam.wv = wv;
  let [gx, gz] = titleOn ? (BB ? [(BB.x0 + BB.x1) / 2, (BB.z0 + BB.z1) / 2] : [pot.x, pot.z]) : clampGoal(pot.x, pot.z, wv, yawT, cam.pitch, cam.ax, cam.ay);
  if (reveal) {
    reveal.t += dt;
    const t = reveal.t;
    if (t >= 1.3) reveal = null;
    else {
      cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0;
      const e = t < 0.7 ? 0 : inOut((t - 0.7) / 0.6);
      placeCamera(lerp(reveal.x, gx, e), lerp(reveal.z, gz, e), lerp(Math.max(wv, reveal.wv), wv, e), yawT, cam.pitch, cam.ax, cam.ay);
      return;
    }
  }
  if (titleOn) { cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0; } else springTo(gx, gz, dt);
  placeCamera(cam.x + shakeX, cam.z + shakeZ, wv, yawT, cam.pitch, cam.ax, cam.ay);
}

// ------------------------------------------------------------------ particles (CPU sim, one instanced pool)
const fpx = new Float32Array(FX_MAX * 3), fvx = new Float32Array(FX_MAX * 3), fl = new Float32Array(FX_MAX);
const fL = new Float32Array(FX_MAX), fsz = new Float32Array(FX_MAX), fcol = new Float32Array(FX_MAX * 4);
const frot = new Float32Array(FX_MAX * 3), fshape = new Uint8Array(FX_MAX), fgrav = new Float32Array(FX_MAX), fgrow = new Float32Array(FX_MAX);
let fxHead = 0, fxN = 0;
function spawn(x, y, z, vx, vy, vz, life, size, col, shape, grav = 6, grow = 0, a = 1) {
  const i = fxHead; fxHead = (fxHead + 1) % FX_MAX;
  fpx[i * 3] = x; fpx[i * 3 + 1] = y; fpx[i * 3 + 2] = z;
  fvx[i * 3] = vx; fvx[i * 3 + 1] = vy; fvx[i * 3 + 2] = vz;
  fl[i] = life; fL[i] = life; fsz[i] = size; fshape[i] = shape; fgrav[i] = grav; fgrow[i] = grow;
  const c = typeof col === 'string' ? s3(col) : col;
  fcol[i * 4] = c[0]; fcol[i * 4 + 1] = c[1]; fcol[i * 4 + 2] = c[2]; fcol[i * 4 + 3] = a;
  frot[i * 3] = rnd() * TAU; frot[i * 3 + 1] = (rnd() * 2 - 1) * 8; frot[i * 3 + 2] = rnd() * TAU;
}
function burst(x, y, z, n, col, opt = {}) {
  const sp = opt.speed || 1.5, up = opt.up ?? 2, life = opt.life || 0.6, size = opt.size || 0.06;
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, s = sp * (0.4 + 0.6 * rnd());
    const c = Array.isArray(col) && typeof col[0] === 'string' ? col[(rnd() * col.length) | 0] : col;
    spawn(x, y, z, Math.cos(a) * s, up * (0.5 + 0.5 * rnd()), Math.sin(a) * s, life * (0.7 + 0.6 * rnd()), size * (0.7 + 0.6 * rnd()), c, opt.shape || 0, opt.grav ?? 6, opt.grow || 0, opt.a ?? 1);
  }
}
function updateFx(dt) {
  let n = 0;
  const P = fxP.array, C = fxC.array, R = fxR.array;
  for (let i = 0; i < FX_MAX; i++) {
    if (fl[i] <= 0) continue;
    fl[i] -= dt;
    if (fl[i] <= 0) continue;
    const j = i * 3, sh = fshape[i];
    const drag = sh === 1 ? 2.2 : sh === 4 ? 1.5 : 0.6;
    fvx[j + 1] -= fgrav[i] * dt;
    const dk = Math.exp(-drag * dt);
    fvx[j] *= dk; fvx[j + 1] *= sh === 1 ? dk : 1; fvx[j + 2] *= dk;
    fpx[j] += fvx[j] * dt; fpx[j + 1] += fvx[j + 1] * dt; fpx[j + 2] += fvx[j + 2] * dt;
    if (fpx[j + 1] < 0.02 && sh !== 4 && fvx[j + 1] < 0 && !(sh === 0 && fgrav[i] < 0)) { fpx[j + 1] = 0.02; fvx[j + 1] *= -0.35; fvx[j] *= 0.6; fvx[j + 2] *= 0.6; }
    frot[j] += frot[j + 1] * dt; frot[j + 2] += 9 * dt;
    const lf = fl[i] / fL[i], o = n * 4;
    P[o] = fpx[j]; P[o + 1] = fpx[j + 1]; P[o + 2] = fpx[j + 2]; P[o + 3] = fsz[i] * (1 + fgrow[i] * (1 - lf));
    C[o] = fcol[i * 4]; C[o + 1] = fcol[i * 4 + 1]; C[o + 2] = fcol[i * 4 + 2]; C[o + 3] = fcol[i * 4 + 3] * Math.min(1, lf * 4);
    R[o] = frot[j]; R[o + 1] = sh; R[o + 2] = frot[j + 2]; R[o + 3] = 0;
    n++;
  }
  fxN = n;
  flush(fxMesh, [fxP, fxC, fxR], n);
}

// ------------------------------------------------------------------ fx events (bus → onFx)
function resetMood() {
  Object.assign(mood, { biteT: 0, sizeT: 0, happyT: 0, wideT: 0, squintT: 0, celebrateT: -1, sad: false, worried: false,
    blinkIn: 2 + rnd() * 2, blinkT: -1, sqzT: 0, lid: 0, happy: 0, wide: 0, worry: 0, droop: 0, squeeze: 0, dim: 1, sink: 0, tilt: 0, shockT: -1 });
  rattleT.fill(0); wobT.fill(0); popT.fill(0);
}
function itemXZ(i) { return W && i >= 0 && i < W.n ? [W.ix[i], W.iz[i]] : [pot.x, pot.z]; }
function rimPoint(k = 0) {   // a point on the front rim (toward the camera)
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  return [pot.x + fx * pot.rVis * 0.95 + fz * k * pot.rVis * 0.3, 0.08 * pot.rVis + 0.03, pot.z + fz * pot.rVis * 0.95 - fx * k * pot.rVis * 0.3];
}
function sparkleRing(n, col, up = 1.4) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rnd() * 0.3, r = pot.rVis * 1.05;
    spawn(pot.x + Math.cos(a) * r, 0.1, pot.z + Math.sin(a) * r, Math.cos(a) * 0.9, up * (0.6 + 0.6 * rnd()), Math.sin(a) * 0.9, 0.55 + rnd() * 0.25, Math.max(0.05, 0.14 * pot.rVis) * (0.8 + 0.5 * rnd()), col, 2, 2.5);
  }
}
function drool() {
  for (let k = 0; k < 3; k++) { const [x, y, z] = rimPoint(k - 1); spawn(x, y, z, (k - 1) * 0.1, 0.25, 0.25, 0.55, Math.max(0.035, 0.07 * pot.rVis), '#FFD34D', 0, 3.5); }
}
/** Bus events → pot/eye/camera/fx (GDD §7.7 animation list). Accepts (ev, data), (data, ev) or ({type,…}). */
export function onFx(ev, data) {
  // DECISION (D33): the SIZE UP sparkles are a transient burst that flies off, never a ring/arc gauge around the pot.
  if (ev && typeof ev === 'object') { const d = ev; ev = typeof data === 'string' ? data : d.type; data = d; }
  else if (typeof data === 'string' && typeof ev !== 'string') { const t = data; data = ev; ev = t; }
  if (!renderer || typeof ev !== 'string') return;
  const d = data || {};
  switch (ev) {
    case 'bite': {
      mood.biteT = 0.18; mood.sqzT = 0.1;
      const [x, z] = itemXZ(d.i); const dx = x - pot.x, dz = z - pot.z, L = Math.hypot(dx, dz) || 1;
      mood.biteDx = dx / L; mood.biteDz = dz / L;
      if (d.ing) sparkleRing(5, '#FFF3C4', 1.1);
      break;
    }
    case 'sizeUp': {
      mood.sizeT = 0.2; mood.happyT = Math.max(mood.happyT, 0.4);
      sparkleRing(BIG_STEPS.has(d.step | 0) ? 14 : 7, '#FFE27A', 1.8);
      if (BIG_STEPS.has(d.step | 0)) { punchT = 0.5; mood.shockT = 0; }
      break;
    }
    case 'padlock': {
      mood.wideT = 0.9; drool();
      const [x, z] = itemXZ(d.i);
      const h = W && d.i >= 0 ? itemTop(d.i) : 1;
      burst(x, h + 0.3, z, 18, ['#FFD34D', '#FFF3C4', '#F5B323'], { speed: 1.6, up: 2.4, size: 0.1, shape: 2, grav: 3 });
      break;
    }
    case 'bossNudge': if (d.i >= 0 && d.i < ITEM_MAX) rattleT[d.i] = 0.4; mood.squintT = 0.3; break;
    case 'bump': {
      mood.squintT = 0.3;
      const [x, z] = itemXZ(d.i); const dx = x - pot.x, dz = z - pot.z, L = Math.hypot(dx, dz) || 1;
      mood.bumpDx = -dx / L; mood.bumpDz = -dz / L; mood.tilt = 1;
      burst(pot.x + (dx / L) * pot.rVis * 1.1, 0.05, pot.z + (dz / L) * pot.rVis * 1.1, 5, '#E9D8BC', { speed: 0.6, up: 0.6, size: 0.05 + 0.05 * pot.rVis, shape: 4, grav: -0.3, grow: 1.2, life: 0.5, a: 0.7 });
      break;
    }
    case 'bossBite': {
      bossCamT = 0; mood.wideT = 0.8;
      const [x, z] = itemXZ(d.i);
      burst(x, 0.4 + pot.rVis * 0.5, z, 70, ['#FFD34D', '#E5483B', '#4CC26A', '#FFF6E6'], { speed: 2.6, up: 4.2, size: 0.11, shape: 1, grav: 5, life: 1.6 });
      break;
    }
    case 'win': {
      mood.celebrateT = 0; mood.happyT = 1.6; mood.worried = false;
      spawn(pot.x, 0.3 + pot.rVis * 0.3, pot.z, 0, 1.0, 0, 1.3, Math.max(0.16, 0.35 * pot.rVis), '#FF6F8E', 3, -0.2, 0.6);
      sparkleRing(10, '#FFE27A', 2.2);
      break;
    }
    case 'fail': mood.sad = true; mood.worried = false; break;
    case 'lowTime': mood.worried = true; break;
    case 'refuse': case 'shove': mood.squintT = 0.3; break;
    case 'boil': mood.squintT = 0.3; burst(pot.x, 0.1, pot.z, 6, '#FFFFFF', { speed: 0.3, up: 1.2, size: 0.12 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.4, grow: 1.5, life: 0.9, a: 0.6 }); break;
    case 'crack': { const [x, z] = itemXZ(d.i); burst(x, 0.15, z, 12, ['#FFF6E6', '#FFE14D', '#F4A493'], { speed: 1.2, up: 1.6, size: 0.06, shape: 0, life: 0.7 }); break; }
    case 'wobble': if (d.i >= 0 && d.i < ITEM_MAX) wobT[d.i] = 0.4; break;
    case 'sizzle': sparkleRing(8, '#FFB347', 1.6); burst(pot.x, 0.1, pot.z, 4, '#FFFFFF', { speed: 0.2, up: 1.0, size: 0.1 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.5, grow: 1.6, life: 1.0, a: 0.55 }); break;
    case 'chain': if ((d.n | 0) >= 3) sparkleRing(3, '#FFF3C4', 1.0); break;
    case 'start': reveal = null; break;
    case 'levelStart': {
      resetMood();
      const w = d.w || W;
      if (!d.retry && w && w.tickets && w.tickets.length) {
        const b = w.tickets[w.ti | 0] && w.tickets[w.ti | 0].boss;
        if (b >= 0 && b < w.n) {
          const a = w.ia[b];
          reveal = { t: 0, x: w.ix[b], z: w.iz[b], wv: (2.2 * a) / 0.6 };
        }
      }
      break;
    }
    case 'spawn': if (d.i >= 0 && d.i < ITEM_MAX) popT[d.i] = 0.25; break;
    default: break;
  }
}

// ------------------------------------------------------------------ per-frame update
function bindWorld(w) {
  W = w;
  const n = Math.min(w.n | 0, ITEM_MAX);
  const kmap = (w.kindNames || []).map((id) => (KIND_ID[id] !== undefined ? KIND_ID[id] : -1));
  itemCat = new Int16Array(n); itemRot = new Float32Array(n); prevSt = new Uint8Array(n); prevHid = new Uint8Array(n);
  const items = (w.level && w.level.items) || (LV && LV.items) || [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    itemCat[i] = kmap[w.kind[i]] ?? (it ? KIND_ID[it.kind] ?? -1 : -1);
    itemRot[i] = it && typeof it.rot === 'number' ? it.rot : 0;
    prevSt[i] = w.st[i]; prevHid[i] = w.hid ? w.hid[i] : 0;
    eGlow[i] = 0; eOcc[i] = 1; rollA[i] = 0; rollH[i] = 0; lastX[i] = w.ix[i]; lastZ[i] = w.iz[i];
  }
  const set = new Set(used);
  for (let i = 0; i < n; i++) if (itemCat[i] >= 0 && kindMesh[itemCat[i]]) set.add(itemCat[i]);
  used = [...set];
  if (w.level && w.level !== LV) LV = w.level;
}
function itemTop(i) {
  const c = itemCat ? itemCat[i] : -1, m = c >= 0 ? kindMesh[c] : null;
  return m ? (m.userData.h * W.ia[i]) / m.userData.catA : 0.5;
}
function segHitsCyl(ax, ay, az, bx, by, bz, cx, cz, rad, h) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  if (L2 < 1e-9) return false;
  const t = ((cx - ax) * dx + (cz - az) * dz) / L2;
  const qx = ax + dx * t - cx, qz = az + dz * t - cz, d2 = qx * qx + qz * qz;
  if (d2 > rad * rad) return false;
  const dt = Math.sqrt((rad * rad - d2) / L2), t0 = Math.max(0, t - dt), t1 = Math.min(0.97, t + dt);
  if (t0 > t1) return false;
  const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
  return Math.min(y0, y1) < h && Math.max(y0, y1) > 0;
}

/** Interpolates and writes every instance for this frame. Safe with w = null (title without a world). */
export function update(w, dt, alpha = 1) {
  // DECISION: the title backdrop (GDD §9 "live three scene, slow orbit") needs food on the board even when the
  // caller passes no world: build an untouched world of the loaded level once (typed arrays only, no GPU objects).
  // DECISION: the boost uses each item's own apparent size (perspective depth vs the pot's), and T0 aims at
  // 12 px diameter (GDD minimum 10 px) because Art's contact scene showed T0 too small at r0 on 390×844.
  if (!renderer) return;
  dt = clamp(+dt || 0, 0, 0.1);
  alpha = clamp(+alpha || 0, 0, 1);
  time += dt; U.time.value = time;
  if (w && w !== W) bindWorld(w);
  if (!w && titleOn && LV && (!W || W.level !== LV)) bindWorld(createWorld(LV, { mode: 'level' }));
  if (!w) w = W;
  // pot (interpolated)
  if (w) {
    const P = w.pot;
    pot.x = P.px + (P.x - P.px) * alpha; pot.z = P.pz + (P.z - P.pz) * alpha;
    const r = P.pr + (P.r - P.pr) * alpha;
    pot.r = r * (P.rEff > P.r ? P.rEff / P.r : 1);
  }
  const rT = titleOn ? Math.max(pot.r, 0.8) : pot.r;
  pot.rVis += (rT - pot.rVis) * ek(dt, 0.12);
  updateCamera(dt);
  const rv = pot.rVis;

  // ---- items
  const cp = camera.position;
  // per-item perspective: items farther up the screen are smaller than ppu says (ppu is measured at the pot)
  _ax.set(cam.x - cp.x, -cp.y, cam.z - cp.z).normalize();
  const fwx = _ax.x, fwy = _ax.y, fwz = _ax.z;
  const dPot = Math.max(0.1, (pot.x - cp.x) * fwx - cp.y * fwy + (pot.z - cp.z) * fwz);
  for (const c of used) kindCnt[c] = 0;
  let nSh = 0, nF = 0, nB = 0;
  const shArr = shMesh.instanceMatrix.array, shM = shA.array, fArr = flatMk.instanceMatrix.array, fM = flatA.array;
  const bP = bbP.array, bM = bbM.array;
  let look = null, lookPri = -1, lookD = 1e9;
  if (w && itemCat) {
    const n = itemCat.length, st = w.st, tp = w.tp, ix = w.ix, iz = w.iz, ipx = w.ipx, ipz = w.ipz, ia = w.ia;
    const fl8 = w.flags, glow = w.glow, hid = w.hid;
    const eyeY = 0.12 * rv;
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if (s === 2) {
        if (prevSt[i] === 1) {   // swallowed: crumbs fly out of the stew in the kind colour
          const K = KINDS[itemCat[i]] || null, tierN = K ? K.tier | 0 : 0;
          burst(pot.x, 0.05, pot.z, Math.min(12, 3 + 2 * tierN), [K ? K.color : '#FFD36E', '#FFD36E', '#FF8A2A'], { speed: 0.6 + 0.4 * rv, up: 1.4 + rv, size: Math.max(0.03, 0.045 * Math.sqrt(rv) + 0.015 * tierN), life: 0.5 });
        }
        prevSt[i] = 2; continue;
      }
      const hd = hid ? hid[i] : 0;
      if (hd) { prevHid[i] = 1; continue; }
      if (prevHid[i]) { prevHid[i] = 0; popT[i] = 0.25; }
      prevSt[i] = s;
      const c = itemCat[i], m = c >= 0 ? kindMesh[c] : null;
      if (!m) continue;
      const ud = m.userData, K = ud.K;
      let x = ipx[i] + (ix[i] - ipx[i]) * alpha, z = ipz[i] + (iz[i] - ipz[i]) * alpha;
      const a = ia[i], dx = pot.x - x, dz = pot.z - z, dist = Math.hypot(dx, dz);
      const boss = fl8[i] & F_BOSS, ing = fl8[i] & F_ING, open = glow[i] > 0;
      // readability boost (render only, §7.4)
      const dI = Math.max(0.1, (x - cp.x) * fwx - cp.y * fwy + (z - cp.z) * fwz);
      const app = a * ppu * (dPot / dI);
      let boost = 1;
      if (ing && open && app < 7) boost = Math.min(2.5, 7 / Math.max(app, 1e-3));
      else if (K.tier === 0 && app < 6) boost = Math.min(1.6, 6 / Math.max(app, 1e-3));
      let sc = (a / ud.catA) * boost, y = 0;
      const h = ud.h * sc;
      // rotation: base yaw, rolling, wobble, tip
      let yaw = itemRot[i];
      if (K.roll) {
        const mx = x - lastX[i], mz = z - lastZ[i], md = Math.hypot(mx, mz);
        if (md > 1e-4 && md < 1) { rollH[i] = Math.atan2(mx, mz); rollA[i] += md / Math.max(0.05, a); }
        _q.setFromAxisAngle(_up, rollH[i]); _ax.set(1, 0, 0); _q2.setFromAxisAngle(_ax, rollA[i]); _q.multiply(_q2);
        _q2.setFromAxisAngle(_up, yaw - rollH[i]); _q.multiply(_q2);
      } else _q.setFromAxisAngle(_up, yaw);
      lastX[i] = x; lastZ[i] = z;
      if (wobT[i] > 0) {
        wobT[i] = Math.max(0, wobT[i] - dt);
        _ax.set(1, 0, 0.4).normalize(); _q2.setFromAxisAngle(_ax, Math.sin(time * 38) * 0.16 * (wobT[i] / 0.4)); _q.premultiply(_q2);
      }
      if (popT[i] > 0) { popT[i] = Math.max(0, popT[i] - dt); const p = 1 - popT[i] / 0.25; sc *= p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - 0.12 * ((p - 0.7) / 0.3); }
      let shAlpha = 1;
      if (s === 1) {
        const p = clamp(tp[i], 0, 1), L = dist || 1;
        _ax.set(dz / L, 0, -dx / L);
        _q2.setFromAxisAngle(_ax, 70 * D2R * sstep(0, 0.6, p)); _q.premultiply(_q2);
        y = -(h * 1.2 + 0.55 * rv) * sstep(0.3, 1, p);
        sc *= 1 - 0.45 * sstep(0.6, 1, p);
        shAlpha = 1 - sstep(0.1, 0.6, p);
      }
      if (rattleT[i] > 0) { rattleT[i] = Math.max(0, rattleT[i] - dt); }
      // edible rim light (fits and within 3r), occluder fade
      const eTarget = s !== 1 && dist < 3 * pot.r && edible(w, i) ? 1 : 0;
      eGlow[i] += (eTarget - eGlow[i]) * ek(dt, 0.05);
      let occ = 1;
      if (s !== 1 && !titleOn && h > 0.22 && z > pot.z - a - 0.1) {
        const fz = Math.cos(cam.yaw), fx = Math.sin(cam.yaw);
        const hit = segHitsCyl(cp.x, cp.y, cp.z, pot.x, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x - rv, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x + rv, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x + fx * rv, eyeY, pot.z + fz * rv, x, z, a * boost, h);
        if (hit) occ = 0.4;
      }
      eOcc[i] += (occ - eOcc[i]) * ek(dt, occ < eOcc[i] ? 0.05 : 0.1);
      // instance
      const k = kindCnt[c];
      if (k < ud.cap) {
        _p.set(x, y, z); _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s); _m.toArray(m.instanceMatrix.array, k * 16);
        const f = ud.fx.array, o = k * 4;
        f[o] = eGlow[i]; f[o + 1] = eOcc[i] > 0.995 ? 1 : eOcc[i]; f[o + 2] = boss && open ? 1 : 0; f[o + 3] = ud.sway;
        kindCnt[c] = k + 1;
      }
      // blob shadow
      if (nSh < ITEM_MAX && shAlpha > 0.01) {
        const S = 2.2 * a * boost * (s === 1 ? 1 - 0.45 * sstep(0.6, 1, tp[i]) : 1), o = nSh * 16;
        shArr[o] = S; shArr[o + 5] = S; shArr[o + 10] = S; shArr[o + 12] = x; shArr[o + 13] = 0.035; shArr[o + 14] = z; shArr[o + 15] = 1;
        shArr[o + 1] = shArr[o + 2] = shArr[o + 3] = shArr[o + 4] = shArr[o + 6] = shArr[o + 7] = shArr[o + 8] = shArr[o + 9] = shArr[o + 11] = 0;
        shM[nSh * 4] = shAlpha; shM[nSh * 4 + 1] = 0; nSh++;
      }
      if (s === 1) continue;
      // markers: halo (open-line ingredient), gate outline, padlock (locked boss), icon (open line, within 6 u)
      if (ing && open && nF < 95) {
        const R = Math.max(1.6 * a * boost, 11 / ppu);
        nF = flatInst(fArr, fM, nF, x, z, R, 0, i * 1.7, 1, 0);
        if (dist < 6 && nB < 48 && iconCell[c] > 0) {
          const bob = 0.04 * Math.sin(time * 5 + i);
          nB = bbInst(bP, bM, nB, x, h + 0.08 + 10 / ppu + bob, z, 20 / ppu, 1, 1, iconCell[c]);
        }
      }
      if (fl8[i] & F_GATE && nF < 95) nF = flatInst(fArr, fM, nF, x, z, 1.15 * a, 1, 0, 1, 0);
      if (boss && !open && nB < 48) {
        const sz = Math.max(28 / ppu, 0.42 * a), rt = rattleT[i];
        const jx = rt > 0 ? Math.sin(time * 60) * 0.05 * sz * (rt / 0.4) : 0;
        nB = bbInst(bP, bM, nB, x + jx, h + 0.35 + sz * 0.5, z, sz, 0, 1, 0);
      }
      // look-at priority: open-line ingredient > open boss > edible item
      const pri = ing && open ? 3 : boss && open ? 2 : eTarget ? 1 : 0;
      if (pri > 0 && (pri > lookPri || (pri === lookPri && dist < lookD))) { lookPri = pri; lookD = dist; look = [x - pot.x, z - pot.z]; }
    }
  }
  // the pot's soft ring shadow (type 1)
  if (!titleOn) {
    const S = 2.9 * rv, o = nSh * 16;
    shArr.fill(0, o, o + 16); shArr[o] = S; shArr[o + 5] = S; shArr[o + 10] = S; shArr[o + 12] = pot.x; shArr[o + 13] = 0.03; shArr[o + 14] = pot.z; shArr[o + 15] = 1;
    shM[nSh * 4] = 1; shM[nSh * 4 + 1] = 1; nSh++;
  }
  // SIZE UP shock ring (big beats only, D31)
  if (mood.shockT >= 0) {
    mood.shockT += dt;
    const p = mood.shockT / 0.5;
    if (p >= 1) mood.shockT = -1;
    else nF = flatInst(fArr, fM, nF, pot.x, pot.z, rv * (1.1 + 1.3 * (1 - (1 - p) * (1 - p))), 3, 0, 1, p);
  }
  // gulls (twist L41+): telegraph ring + the toy gull
  if (gullG) {
    const g = w && w.gulls && w.gulls[0];
    gullG.visible = !!(g && typeof g.x === 'number');
    if (gullG.visible) {
      gullG.position.set(g.x, typeof g.y === 'number' ? g.y : 1.5, g.z); gullG.rotation.y = g.h || 0;
      gullG.children.forEach((ch, k) => { if (/wing/i.test(ch.name)) ch.rotation.z = Math.sin(time * 14) * 0.5 * (k % 2 ? 1 : -1); });
      if (g.warn && nF < 95) nF = flatInst(fArr, fM, nF, g.tx ?? g.x, g.tz ?? g.z, Math.max(0.5, pot.r * 1.2), 2, 0, 1, 0);
    }
  }
  for (const c of used) {
    const m = kindMesh[c]; if (!m) continue;
    const n = kindCnt[c];
    m.count = n; m.visible = n > 0;
    if (n) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true; const f = m.userData.fx; f.clearUpdateRanges(); f.addUpdateRange(0, n * 4); f.needsUpdate = true; }
  }
  shMesh.count = nSh; shMesh.visible = nSh > 0; shMesh.instanceMatrix.needsUpdate = true; shA.needsUpdate = true;
  flatMk.count = nF; flatMk.visible = nF > 0; flatMk.instanceMatrix.needsUpdate = true; flatA.needsUpdate = true;
  flush(bbMk, [bbP, bbM], nB);

  updatePot(dt, look);
  updateFx(dt);
}
function flatInst(arr, M, n, x, z, R, type, phase, a, extra) {
  const S = (2 * R) / 0.8, o = n * 16;
  arr.fill(0, o, o + 16); arr[o] = S; arr[o + 5] = S; arr[o + 10] = S; arr[o + 12] = x; arr[o + 13] = 0.045 + type * 0.002; arr[o + 14] = z; arr[o + 15] = 1;
  M[n * 4] = type; M[n * 4 + 1] = phase; M[n * 4 + 2] = a; M[n * 4 + 3] = extra;
  return n + 1;
}
function bbInst(P, M, n, x, y, z, size, type, a, cell) {
  P[n * 4] = x; P[n * 4 + 1] = y; P[n * 4 + 2] = z; P[n * 4 + 3] = size;
  M[n * 4] = type; M[n * 4 + 1] = 0; M[n * 4 + 2] = a; M[n * 4 + 3] = cell;
  return n + 1;
}

// ------------------------------------------------------------------ the hero pot + eyes
function updatePot(dt, look) {
  // DECISION: on the title the UI draws the 2D pot-hero (GDD §9 title row) over this scene, so the 3D pot, its
  // hole, ring shadow and eyes are hidden and the camera orbits the board centre: one pot on screen, never two.
  // DECISION: sclera radius = max(0.16·rVis, 4.5 px) capped at 0.26·rVis, so the face reads at L1's tiny pot.
  potRoot.visible = holeG.visible = eyes.visible = !titleOn;
  const rv = pot.rVis, M = mood;
  // timers
  M.biteT = Math.max(0, M.biteT - dt); M.sizeT = Math.max(0, M.sizeT - dt); M.happyT = Math.max(0, M.happyT - dt);
  M.wideT = Math.max(0, M.wideT - dt); M.squintT = Math.max(0, M.squintT - dt); M.sqzT = Math.max(0, M.sqzT - dt);
  // squash/tilt/overshoot/bob
  let sy = 1;
  if (M.biteT > 0) { const t = 0.18 - M.biteT; sy = t < 0.06 ? lerp(1, 0.92, t / 0.06) : t < 0.12 ? lerp(0.92, 1.04, (t - 0.06) / 0.06) : lerp(1.04, 1, (t - 0.12) / 0.06); }
  const over = M.sizeT > 0 ? 1 + 0.12 * Math.sin(PI * (1 - M.sizeT / 0.2)) : 1;
  let yOff = 0.015 * pot.r * Math.sin(TAU * 0.9 * time);
  if (M.celebrateT >= 0) { M.celebrateT += dt; const t = M.celebrateT; if (t < 0.36) yOff += 0.22 * rv * Math.abs(Math.sin(PI * t / 0.12)) * (1 - t / 0.45); else M.celebrateT = -1; }
  M.sink += ((M.sad ? 0.05 : 0) - M.sink) * ek(dt, 0.2);
  yOff -= M.sink;
  // tilt: 3° toward a bite, 5° away from a bump
  let tdx = 0, tdz = 0, ang = 0;
  if (M.biteT > 0) { tdx = M.biteDx; tdz = M.biteDz; ang = 3 * D2R * Math.sin(PI * (1 - M.biteT / 0.18)); }
  if (M.squintT > 0 && M.tilt) { tdx = M.bumpDx; tdz = M.bumpDz; ang = 5 * D2R * Math.sin(PI * (1 - M.squintT / 0.3)); }
  if (M.squintT <= 0) M.tilt = 0;
  potRoot.position.set(pot.x, yOff, pot.z);
  potRoot.scale.set(rv * over, rv * over * sy, rv * over);
  if (ang > 0) { _ax.set(tdz, 0, -tdx).normalize(); potRoot.quaternion.setFromAxisAngle(_ax, ang); } else potRoot.quaternion.identity();
  holeG.position.set(pot.x, 0, pot.z); holeG.scale.setScalar(rv);
  // skin lights
  if (potExtras.lights) potExtras.lights.visible = Math.sin(time * TAU * 1.0) > -0.3;
  if (potExtras.lightsA) potExtras.lightsA.visible = Math.sin(time * TAU * 2) > 0;
  if (potExtras.lightsB) potExtras.lightsB.visible = Math.sin(time * TAU * 2) <= 0;
  if (potExtras.sparkle) potExtras.sparkle.scale.setScalar(0.8 + 0.25 * Math.abs(Math.sin(time * 3.1)));
  // stew dim
  M.dim += ((M.sad ? 0.6 : 1) - M.dim) * ek(dt, 0.3);
  stewMat.uniforms.uDim.value = M.dim;

  // eyes: blink (render RNG), squint, sleepy, sad, worried, happy, wide
  M.blinkIn -= dt;
  if (M.blinkIn <= 0 && M.blinkT < 0) { M.blinkT = 0; M.blinkIn = 2.5 + rnd() * 2.5; }
  let blink = 0;
  if (M.blinkT >= 0) { M.blinkT += dt; blink = M.blinkT < 0.06 ? M.blinkT / 0.06 : 1 - (M.blinkT - 0.06) / 0.06; if (M.blinkT > 0.12) { M.blinkT = -1; blink = 0; } }
  const sleepy = titleOn && titleT > 8;
  const lidT = Math.max(M.squintT > 0 ? 0.5 : 0, M.sad ? 0.3 : 0, sleepy ? 0.55 : 0);
  M.lid += (lidT - M.lid) * ek(dt, 0.06);
  M.happy += ((M.happyT > 0 ? 1 : 0) - M.happy) * ek(dt, 0.04);
  M.wide += ((M.wideT > 0 ? 1 : 0) - M.wide) * ek(dt, 0.05);
  M.worry += ((M.worried && !M.sad ? 1 : 0) - M.worry) * ek(dt, 0.1);
  M.droop += ((M.sad ? 1 : 0) - M.droop) * ek(dt, 0.15);
  M.squeeze += ((M.sqzT > 0 ? 1 : 0) - M.squeeze) * ek(dt, 0.03);
  let lx = 0, ly = -0.06;
  if (look) {
    const L = Math.hypot(look[0], look[1]) || 1, cy = Math.cos(cam.yaw), sy2 = Math.sin(cam.yaw);
    const sx = (look[0] * cy - look[1] * sy2) / L, sz = (look[0] * sy2 + look[1] * cy) / L;   // camera-relative
    lx = 0.31 * sx; ly = -0.31 * sz * 0.8;
  }
  if (sleepy) { lx = 0; ly = -0.12; }
  M.lookX += (lx - M.lookX) * ek(dt, 0.1); M.lookY += (ly - M.lookY) * ek(dt, 0.1);
  const jit = M.worry > 0.05 ? 0.04 * M.worry : 0;
  const u = eyeMat.uniforms;
  u.uLook.value.set(M.lookX + (rnd() * 2 - 1) * jit, M.lookY + (rnd() * 2 - 1) * jit, 0);
  u.uLid.value = Math.min(1, Math.max(M.lid, blink));
  u.uHappy.value = M.happy; u.uWide.value = M.wide; u.uWorry.value = M.worry; u.uDroop.value = M.droop; u.uSqueeze.value = M.squeeze;
  // placement: front rim (toward the camera), billboarded, pulled toward the camera so the rim never hides them
  const S = Math.min(Math.max(0.16 * rv, 4.5 / ppu), 0.26 * rv) * (1 + 0.04 * (over - 1) * 8);
  const sep = Math.max(0.21 * rv, 1.08 * S);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  const ey = (0.13 * rv + S * 0.15) * sy + yOff;
  const cp = camera.position;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const ex = pot.x + fx * 0.97 * rv + fz * side * sep, ez = pot.z + fz * 0.97 * rv - fx * side * sep;
    _v.set(cp.x - ex, cp.y - ey, cp.z - ez).normalize().multiplyScalar(0.3 * rv + S);
    (k === 0 ? u.uC0 : u.uC1).value.set(ex + _v.x, ey + _v.y, ez + _v.z);
  }
  u.uS.value = S;
}

// ------------------------------------------------------------------ draw
export function draw() {
  if (!renderer) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (lastNow) {
    const ft = now - lastNow;
    if (ft > 0 && ft < 250) {
      fpsEma = fpsEma ? fpsEma + (1000 / ft - fpsEma) * 0.1 : 1000 / ft;
      win.push(ft);
    }
    if (!REC && now - winStart > 2000) {
      if (win.length >= 20) {
        const s = win.slice().sort((a, b) => a - b), med = s[s.length >> 1];
        const cap = dprCap();
        let nd = dpr;
        if (med > 20) nd = Math.max(DPR_MIN, dpr - DPR_STEP);
        else if (med < 13) nd = Math.min(cap, dpr + DPR_STEP);
        if (nd !== dpr) { dpr = nd; applySize(); }
      }
      win.length = 0; winStart = now;
    }
  } else winStart = now;
  lastNow = now;
  renderer.render(scene, camera);
}

export function dispose() {
  if (!renderer) return;
  if (canvas && ctxHandlers) {
    canvas.removeEventListener('webglcontextlost', ctxHandlers.lost, false);
    canvas.removeEventListener('webglcontextrestored', ctxHandlers.restored, false);
  }
  scene.traverse((o) => {
    if (o.isMesh && o.geometry && o !== staticMesh) { /* shared props geometries stay cached in props.js */ }
  });
  for (const m of kindMesh) if (m) { m.geometry.dispose(); m.dispose(); }
  for (const m of [shMesh, flatMk, bbMk, fxMesh]) if (m) { m.geometry.dispose(); m.material.dispose(); m.dispose(); }
  staticMesh.geometry.dispose(); staticMat.dispose();
  if (groundTex) groundTex.dispose();
  atlasTex.dispose(); blankTex.dispose(); propMat.dispose(); potMat.dispose(); stewMat.dispose(); eyeMat.dispose(); gullMat.dispose();
  pit.geometry.dispose(); pit.material.dispose(); stew.geometry.dispose(); rimDisc.geometry.dispose(); rimDisc.material.dispose(); eyes.geometry.dispose();
  renderer.dispose();
  renderer = null; scene = null; camera = null; W = null; LV = null; BB = null; curTown = null; skin = null; potG = null;
  kindMesh.length = 0; used = [];
}
