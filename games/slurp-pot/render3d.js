// Slurp Pot renderer (Render role): three.js scene, stencil hole, instanced props, hero pot, camera, fx.
// GDD §7.3–§7.7, §13.3; D25 (the hole is a stencil, never a ground discard), D31 (big SIZE UP beats), D33 (look).
// three comes only from ./vendor/three.bundle.js (named imports). Pools are created once in initRender.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, BufferGeometry, BufferAttribute,
  InstancedBufferAttribute, MeshLambertMaterial, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial,
  CanvasTexture, Color, Vector2, Vector3, Matrix4, Quaternion, HemisphereLight, DirectionalLight, Fog, CircleGeometry,
  CylinderGeometry, PlaneGeometry, TorusGeometry, RingGeometry, BoxGeometry, SphereGeometry, SRGBColorSpace, RepeatWrapping, BackSide,
  DynamicDrawUsage, AlwaysStencilFunc, EqualStencilFunc, NotEqualStencilFunc, ReplaceStencilOp, mergeGeometries,
} from './vendor/three.bundle.js';
import * as props from './props.js';
import * as LD from './levels-data.js';
import { KINDS, KIND_ID } from './catalog.js';
import { edible, createWorld } from './logic.js';
import { TIER, DPR_MIN, DPR_START, DPR_STEP, FX_MAX, ITEM_MAX, isMilestone } from './consts.js';
import { dressLayout } from './dress.js';
import { camW, camWRec, camTitle, CAM_EDGE, CAM_SLACK, CAM_POT_FLOOR, FIN_BEAT, FIN_BIG, finQ, finSlow, bossBoost, camOpenW, CAM_OPEN_S, camViewK, camLand, FIREWORKS, FIREWORK_COLS } from './camw.js';

// R3 food readability, render copy only (sim sizes, fits and the "too big" cue never change). T0 and open-line food keep
// an on-screen radius of FOOD_FLOOR_PX (11 on a 390 px phone, the baked tier scale counted) up to FOOD_BOOST_MAX; T1
// draws × FOOD_T1_BOOST. DECISION (11-06): any boost stops at FOOD_RIM of the pot's radius, so food that fits never reads
// as bigger than the pot, and it can't pop when it starts to fit (the limit is continuous in r).
const FOOD_FLOOR_PX = 11, FOOD_BOOST_MAX = 3.2, FOOD_T1_BOOST = 1.3, FOOD_RIM = 0.8;
const foodVis = K => (K.food ? (K.tier === 0 ? 1.3 : K.tier === 1 ? 1.12 : 1) : 1);
// R7 boss finisher, real seconds from the final bite. The sim's tip ends ~1.34 s in (0.5 sim s under the 1.2 s slow-mo), so
// the boss is gone just after the boom and the camera is back by the end, well inside Core's 4.1 s bite-to-card wait. The beats
// live in camw.js (FIN_BEAT, FIN_BIG), shared with render2d.
const FIN_POT = 0.72;

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
const F_ING = 1, F_FRAGILE = 8, F_GATE = 16, F_BOSS = 32, F_BELT = 128, F_HOT = 512;
const HOOD = { picnic: '#F5B323', market: '#2FB5A5', harbour: '#E04F4F' };   // belt end hoods per town
const SWAY = new Set(['hedge', 'tree', 'bush', 'parasol']);
const WUV = props.WHITE_UV || [0.0635, 0.0635];
const BELT_TOP = props.BELT_TOP || 0.06, BELT_PERIOD = props.BELT_PERIOD || 0.5, SEA_Y = -0.32;
const DEC_SH = ITEM_MAX + 8, DEC_FL = 128, DEC_MAX = DEC_SH + DEC_FL;   // decal pool: shadows first, then flats
// Per-town lights (GDD §7.2 moods; physical-light intensities as tuned for picnic on 11-03).
const LIGHT = {
  picnic: { sky: '#FFF6E8', gnd: '#B08A62', hi: 1.75, sun: '#FFF1D6', si: 2.0 },
  market: { sky: '#FFF1E6', gnd: '#B9876A', hi: 1.75, sun: '#FFE6C8', si: 2.05 },
  harbour: { sky: '#F4FBFF', gnd: '#A08A6E', hi: 1.8, sun: '#FFF8EC', si: 2.0 },
};
// crack splat colour per stack kind (what spills): tea, jam, yolk, syrup, cream
const SPLAT = { teacups: '#8A5A2B', jarstack: '#C2185B', eggcrate: '#FFC93C', wafflestack: '#C77A1E', platepile: '#FFF6E3' };
// paired bus names (WED-BRIEF vs GDD spelling) → one canonical name, deduped per frame
const EV_ALIAS = { courseDone: 'course', tier: 'cakeTier', gullWarn: 'gull' };
const ALIASED = new Set(Object.values(EV_ALIAS));

// ------------------------------------------------------------------ module state
let renderer = null, scene = null, camera = null, canvas = null, gl = null;
let tier = 'high', REC = false, OGP = false, STILL = false, dpr = 1, cssW = 1, cssH = 1;
let play = { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.6 };
const U = { time: { value: 0 }, edge: { value: 0 }, calm: { value: 0 } };
let time = 0, ppu = 50;
let hemi, sun, fog;
let propMat, potMat, gullMat;
const kindMesh = [];                   // by catalog index
const kindCnt = new Int32Array(KINDS.length);
let used = [];                         // catalog indices present in the loaded level
let staticMesh, staticMat, groundTex = null, blankTex, curTown = null, LV = null, BB = null;   // BB = board bounds
let holeG, rimDisc, pitStew, stewMat, rimXray;
const GREATER_DEPTH = 6;   // three's GreaterDepth: the bundle does not export the name
let potRoot, potG = null, potExtras = {}, skin = null, warmGlow = null;
let eyes, eyeMat;
let decMesh, decA, bbMk, bbP, bbM, fxMesh, fxP, fxC, fxR;
const fScr = new Float32Array(DEC_FL * 16), fScrM = new Float32Array(DEC_FL * 4);   // flats, appended after shadows
let atlasCv, atlasCtx, atlasTex;
const iconCell = new Int16Array(KINDS.length).fill(-1), iconLoaded = new Set();
let gullMesh = null, gullA = null;
let beltMesh = null, beltMat = null, beltTex = null;
let cakeRest = null, cakeTop = null, cakeKey = '', cakeH = 0, cakeCat = -1;
let splatMesh = null, lidMesh = null, wipeMesh = null, wipeT = -1;
const splats = [];
const uBC = new Vector2(), uBH = new Vector2(1, 1);   // board centre / half extents (harbour foam)
let lostFn = null, ctxHandlers = null;

// per-world state
let W = null, itemCat = null, itemRot = null, prevSt = null, prevHid = null, prevKind = null;
const eGlow = new Float32Array(ITEM_MAX), eOcc = new Float32Array(ITEM_MAX), wobT = new Float32Array(ITEM_MAX);
const popT = new Float32Array(ITEM_MAX), rollA = new Float32Array(ITEM_MAX), rollH = new Float32Array(ITEM_MAX);
const rollQ = new Float32Array(ITEM_MAX * 4);   // accumulated rolling orientation per item (ball kinds)
const WHEELS = new Set(['cheesewheel']);   // rolling kinds that roll like a wheel (axle = local x, yaw = heading)
const lastX = new Float32Array(ITEM_MAX), lastZ = new Float32Array(ITEM_MAX), rattleT = new Float32Array(ITEM_MAX);
const crackT = new Float32Array(ITEM_MAX), prevCrack = new Uint8Array(ITEM_MAX);
const gH = new Float32Array(4), gBank = new Float32Array(4), gPitch = new Float32Array(4), gY = new Float32Array(4), gOn = new Uint8Array(4);
const lid = { on: false, pop: 0, jig: 0, steamT: 0 };
let hotT = 0, potLift = 0, truckYaw = 0, truckStop = false, truckSq = 0, glance = null, bossRing = null;
const evSeen = new Set();

// pot + camera state
const pot = { x: 0, z: 0, r: 0.3, rVis: 0.3 };
const cam = { x: 0, z: 0, vx: 0, vz: 0, rCam: 0.3, yaw: 0, pitch: 55 * D2R, wv: 6, ax: 0, ay: 0 };
let recSnap = false;   // record: the first frame after levelStart puts the camera on its goal (no spring in from the last shot)
let titleOn = false, titleT = 0, reveal = null, punchT = 0, punchA = 0.08, bossCamT = -1, bossCamA = 0.1, shakeX = 0, shakeZ = 0, recWinT = -1;
let openK = 0, openT = -1, openW = 1;         // R1: the close opening view, 1 until the first touch, then eases to 0
let apK = 0, apFit = null, apWait = 0, bossNear = null;   // R5: L60's pre-bite framing of pot and lighthouse
let fw = null;                                // R6: L60's fireworks
let fin = null, finHold = false, flashA = 0, flashMesh = null, calm = false;   // boss finisher state, warm flash, prefers-reduced-motion
const mood = { biteT: 0, biteK: 1, flash: 0, biteDx: 0, biteDz: 1, sizeT: 0, happyT: 0, wideT: 0, squintT: 0, bumpDx: 0, bumpDz: 0,
  celebrateT: -1, sad: false, worried: false, blinkIn: 3, blinkT: -1, sqzT: 0, lookX: 0, lookY: -0.08,
  lid: 0, happy: 0, wide: 0, worry: 0, droop: 0, squeeze: 0, dim: 1, sink: 0, tilt: 0, tiltDx: 0, tiltDz: 1, shockT: -1 };
const _m = new Matrix4(), _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _p = new Vector3(), _s = new Vector3();
const _v = new Vector3(), _ax = new Vector3(), _up = new Vector3(0, 1, 0);

// frame timing / adaptive DPR
let lastNow = 0, fpsEma = 0;
const win = [];
let winStart = 0;

// ------------------------------------------------------------------ perf tier (D10)
/** 'low' | 'mid' | 'high' from the GPU renderer string and the UA (GDD §13.3). */
export function detectTier(g) {
  // DECISION (11-04): unchanged until the orchestrator's adb test of ?tier=mid on the Realme (Mali-G57 MC2, holds
  // 60 at low/dpr 1.25). The proposed narrower low regex is in studio/2026-11-04/render/notes.txt (TIER_LOW_NEXT).
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
    sh.uniforms.uTime = U.time; sh.uniforms.uEdge = U.edge;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nvarying vec4 vFx;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFx = aFx;
#ifdef USE_INSTANCING
if (aFx.w > 0.5 && aFx.w < 1.5) {
  float sw = sin(uTime * 2.513 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.6) * 0.03 * min(position.y, 1.0);
  transformed.x += sw; transformed.z += sw * 0.6;
}
// R7: the chili's flame. Its vertices carry a full-red vertex colour; the body, stem and shine never do.
if (aFx.w > 2.5 && color.r > 0.95) {
  float ph = uTime * 15.0 + instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
  transformed.x += 0.13 * sin(ph) * position.y * position.y / max(position.y, 0.05);
  transformed.y *= 1.0 + 0.14 * sin(ph * 1.37);
}
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFx;
uniform float uTime;
uniform float uEdge;
float spB2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float spB4(vec2 a) { return spB2(0.5 * a) * 0.25 + spB2(a); }`)
      .replace('void main() {', `void main() {
  if (vFx.y < 0.999 && spB4(gl_FragCoord.xy) >= vFx.y) discard;`)
      .replace('#include <opaque_fragment>', `{
  vec3 spV = normalize(vViewPosition);
  float spE = 1.0 - clamp(abs(dot(normal, spV)), 0.0, 1.0), spF = spE * spE;
  float spFood = step(1.5, vFx.w);
  outgoingLight += vec3(1.0, 0.91, 0.67) * 0.25 * spF * (1.0 - spFood);
  // R2 (round 2): every edible turns a soft ink line where it curves away from the eye, so a waffle reads on planks. Warm
  // food on a warm floor has no hue or value gap for the eye to catch; a dark edge makes one, at no extra draw.
  // FIX-LIST-3 R2: on the harbour deck the line starts earlier and a cool light band sits just inside it, so a brown crumb has a
  // bright edge and a dark edge against the grey planks. A uniform: no cost per item, and the other towns don't change.
  outgoingLight += vec3(0.8, 0.92, 1.0) * (uEdge * spFood * 0.34) * smoothstep(0.1, 0.3, spE) * (1.0 - smoothstep(0.3, 0.5, spE));
  outgoingLight = mix(outgoingLight, vec3(0.13, 0.07, 0.045), spFood * (0.8 + 0.15 * uEdge) * smoothstep(0.3 - 0.06 * uEdge, 0.68 - 0.1 * uEdge, spE));
  outgoingLight = outgoingLight * (1.0 + 0.04 * vFx.x) + vec3(0.55) * vFx.x * spF;
  // R4 (round 2): a slow breath, not the old 10 rad/s buzz, so the glow reads as "this is the one" and not as a fault.
  outgoingLight += vec3(1.0, 0.65, 0.07) * vFx.z * (0.26 + 0.14 * sin(uTime * 3.77)) * (0.5 + spF);
  // R7: the flame lights itself.
  if (vFx.w > 2.5 && vColor.r > 0.95) outgoingLight = mix(outgoingLight, vColor.rgb * 1.1, 0.85);
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'sp-prop-v3';
  return m;
}

const SH_GROUND_V = `attribute vec4 aM; varying vec2 vUv; varying vec4 vM;
void main() { vUv = uv * 2.0 - 1.0; vM = aM; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const COV = 'float cov(float d) { float w = max(fwidth(d), 1e-4); return clamp(0.5 - d / w, 0.0, 1.0); }';

function makeDecalMat() {
  // DECISION (11-04, perf): blob shadows, the pot's ring shadow and every flat marker share ONE instanced pool and
  // one draw (was two): vM = (type, phase, alpha, extra). Shadows are written first, flats after, so instance
  // order = paint order. Types: 10 blob · 11 pot ring · 0 halo · 1 gate · 2 gull telegraph (extra = warn) · 3 shock ·
  // 4 boss floor glow · 5 chili hazard. Type 11's extra = the rim's edge as a fraction of the decal's radius.
  return stencilSkip(new ShaderMaterial({
    uniforms: { uTime: U.time, uCalm: U.calm },
    vertexShader: SH_GROUND_V,
    fragmentShader: `uniform float uTime; uniform float uCalm; varying vec2 vUv; varying vec4 vM;
${COV}
// Four chevrons round a marker, tips inward, the same arrow the conveyors use. o pulls them in. x = coverage, y = its ink edge.
vec2 chev(float r, float ang, float o) {
  float u = fract(ang * 0.63662 + 0.5) - 0.5, v = r - (0.85 - o) - abs(u) * 0.42, m = step(abs(u), 0.25);
  return vec2(cov(abs(v) - 0.05), cov(abs(v) - 0.085)) * m;
}
void main() {
  float r = length(vUv); vec4 c;
  if (vM.x > 10.5) {
    // FIX-LIST-3 R1: the pot's ground halo. A saturated gold glow off the rim, one crisp bright ring with an ink edge that reads
    // on cream gingham, grey planks and cobbles alike, and a slow breath. Its px floor (update) marks a tiny pot in a wide shot.
    float r0 = vM.w, wd = 1.0 - r0, pu = mix(0.5 + 0.5 * sin(uTime * 2.8), 0.6, uCalm);
    float rc = r0 + wd * (0.5 + 0.1 * pu), hw = wd * 0.1;
    float aG = (0.66 + 0.2 * pu) * (1.0 - smoothstep(r0 + wd * 0.3, 1.0, r)), aI = 0.62 * cov(abs(r - rc) - hw * 1.8), aR = cov(abs(r - rc) - hw);
    vec3 col = mix(mix(vec3(1.0, 0.6, 0.05), vec3(0.227, 0.141, 0.094), aI), vec3(1.0, 0.8, 0.16), aR);
    c = vec4(col, max(aG, max(aI, aR)));
  } else if (vM.x > 9.5) {
    // R4: the blob gets a tight dark core that peeks out round the item's foot, so a tomato reads on red gingham and a
    // white sandwich on a white deck with no extra draw.
    c = vec4(0.227, 0.141, 0.094, 0.28 * (1.0 - smoothstep(0.2, 1.0, r)) + 0.34 * (1.0 - smoothstep(0.66, 0.94, r)));
  } else if (vM.x < 0.5) {
    float pu = 0.5 + 0.5 * sin(uTime * 7.54 + vM.y);
    // R5: the ring breathes and has a thin ink edge, so gold still reads on tan cobbles and harbour planks, not just gingham.
    float rc = 0.77 + 0.07 * pu;
    float ring = cov(abs(r - rc) - 0.085), edge = cov(abs(r - rc) - 0.125);
    float fill = (1.0 - smoothstep(0.15, 0.8, r)) * 0.22;
    c = vec4(mix(vec3(0.227, 0.141, 0.094), vec3(1.0, 0.827, 0.302), max(ring, 0.0)), max(max(ring * (0.74 + 0.26 * pu), edge * 0.5), fill * (0.6 + 0.4 * pu)));
  } else if (vM.x < 1.5) {
    float ang = atan(vUv.y, vUv.x) + uTime * 0.35;
    float dash = step(0.45, fract(ang * 14.0 / 6.2832));
    c = vec4(1.0, 0.98, 0.94, cov(abs(r - 0.86) - 0.05) * dash * 0.9);
  } else if (vM.x < 2.5) {
    // gull telegraph. FIX-LIST-3 R4: a solid red fill growing with warn (0.3 R → R over 1.6 s) inside a fixed thick ring, so the
    // ring says where and the fill says when. White chevrons close in on the target and the beat quickens as the gull commits.
    float w = clamp(vM.w, 0.0, 1.0), rf = 0.72 * mix(0.3, 1.0, w), pu = mix(0.5 + 0.5 * sin(uTime * (9.0 + 13.0 * w)), 0.7, uCalm);
    float aF = (1.0 - smoothstep(rf - 0.03, rf, r)) * (0.36 + 0.34 * w) * (0.78 + 0.22 * pu);
    float aR = cov(abs(r - 0.74) - 0.055), aI = 0.5 * cov(abs(r - 0.74) - 0.09);
    vec2 ch = chev(r, atan(vUv.y, vUv.x), 0.045 * w * (1.0 - uCalm));
    vec3 col = mix(vec3(0.227, 0.141, 0.094), vec3(0.93, 0.15, 0.11), max(aF, aR) / max(max(aF, aR) + aI * (1.0 - aR), 1e-3));
    col = mix(mix(col, vec3(0.227, 0.141, 0.094), ch.y * 0.6), vec3(1.0), ch.x);
    c = vec4(col, max(max(aF, aR * (0.74 + 0.26 * pu)), max(aI, max(ch.x, ch.y * 0.5))));
  } else if (vM.x > 4.5) {
    // FIX-LIST-3 R3: "keep off", in the L30 conveyor's grammar: a pulsing red pad, a thick red ring and gold chevrons with an ink
    // edge, so it reads at 390 wide. Reduced motion holds it steady.
    float pu = mix(0.5 + 0.5 * sin(uTime * 6.3 + vM.y), 0.6, uCalm);
    float aF = (1.0 - smoothstep(0.69, 0.72, r)) * (0.2 + 0.32 * pu), aR = cov(abs(r - 0.72) - 0.05), aI = 0.5 * cov(abs(r - 0.72) - 0.085);
    vec2 ch = chev(r, atan(vUv.y, vUv.x), 0.03 * pu * (1.0 - uCalm));
    vec3 col = mix(vec3(0.227, 0.141, 0.094), vec3(0.95, 0.14, 0.09), max(aF, aR) / max(max(aF, aR) + aI * (1.0 - aR), 1e-3));
    col = mix(mix(col, vec3(0.227, 0.141, 0.094), ch.y * 0.6), vec3(1.0, 0.83, 0.3), ch.x);
    c = vec4(col, max(max(aF, aR), max(aI, max(ch.x, ch.y * 0.5))));
  } else if (vM.x > 3.5) {
    // R4: the boss stands in a pool of its own light. Breathes with the shader glow on the prop.
    float pu = 0.5 + 0.5 * sin(uTime * 3.77), g = 1.0 - smoothstep(0.2, 1.0, r);
    c = vec4(1.0, 0.76, 0.26, g * g * (0.44 + 0.26 * pu));
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
  // DECISION (11-04, perf): the pit wall and the stew are one mesh + one draw (aPit 1 = pit, flat sRGB aCol;
  // 0 = stew). BackSide for both: the stew disc is flipped (faces −y) so from above we see its back face.
  return stencilOnly(new ShaderMaterial({
    uniforms: { uTime: U.time, uDim: { value: 1 }, uHot: { value: 0 } },
    vertexShader: `attribute vec3 aCol; attribute float aPit; varying vec2 vP; varying vec3 vCol; varying float vPit;
void main() { vP = position.xz; vCol = aCol; vPit = aPit; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uDim; uniform float uHot; varying vec2 vP; varying vec3 vCol; varying float vPit;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  if (vPit > 0.5) { gl_FragColor = vec4(vCol, 1.0); return; }
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
  gl_FragColor = vec4(mix(col, vec3(0.93, 0.13, 0.06), uHot * 0.72) * uDim, 1.0);
}`,
    side: BackSide,
  }));
}
function makeGullMat() {
  // DECISION (11-04, perf): every gull is one instance of one merged mesh (body + both wings, aWing ±1 on wing
  // vertices); the flap is a vertex rotation about each wing's hinge (pivots ±0.2, 0.38), aGf = (phase, amp, rate).
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing;\nattribute vec3 aGf;\nuniform float uTime;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float spA = aWing * aGf.y * sin(uTime * aGf.z + aGf.x); float spC = cos(spA), spS = sin(spA);
objectNormal.xy = vec2(spC * objectNormal.x - spS * objectNormal.y, spS * objectNormal.x + spC * objectNormal.y);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec2 spP = vec2(aWing * 0.2, 0.38), spQ = transformed.xy - spP;
  transformed.xy = spP + vec2(spC * spQ.x - spS * spQ.y, spS * spQ.x + spC * spQ.y); }`);
  };
  m.customProgramCacheKey = () => 'sp-gull-v1';
  return m;
}
function makeBeltMat(tex) {
  // DECISION (11-04): belt surfaces are one boot-created mesh; arrows scroll in the vertex shader per belt speed
  // (aSpd = |v| / BELT_PERIOD texture periods per second), so no per-frame texture offset and any belt count.
  const m = stencilSkip(new MeshLambertMaterial({ vertexColors: true, map: tex }));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSpd;\nuniform float uTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y -= mod(uTime * aSpd, 1.0);\n#endif');
  };
  m.customProgramCacheKey = () => 'sp-belt-v1';
  return m;
}
function patchStatic(m) {
  // DECISION (11-04): Harbour water is part of the merged static layer (uv.x > 500 marks sea vertices, which skip
  // the ground map): two crossed sine swells shade it, crests and a wobbling foam band at the board edge go to
  // #E8FBFF. No extra mesh or draw call; the sea plane sits at SEA_Y under the pier deck.
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uBC = { value: uBC }; sh.uniforms.uBH = { value: uBH };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWat;\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWat = step(500.0, uv.x);\nvWp = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uBC;\nuniform vec2 uBH;\nvarying float vWat;\nvarying vec3 vWp;')
      .replace('#include <map_fragment>', 'if (vWat < 0.5) {\n#include <map_fragment>\n}')
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vWat > 0.5) {
  vec2 p = vWp.xz;
  float hw = 0.5 + 0.25 * sin(p.x * 1.3 + uTime * 1.1) * sin(p.y * 0.9 - uTime * 0.8) + 0.25 * sin((p.x + p.y) * 2.1 - uTime * 1.7);
  diffuseColor.rgb *= 0.92 + 0.14 * hw;
  vec2 q = abs(p - uBC) - uBH; float dB = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float foam = (1.0 - smoothstep(0.05, 0.55 + 0.15 * sin(uTime * 2.0 + p.x * 3.1 + p.y * 2.3), dB)) * 0.8;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.807, 0.965, 1.0), max(smoothstep(0.84, 0.98, hw) * 0.35, foam));
}`);
  };
  m.customProgramCacheKey = () => 'sp-static-v1';
  return m;
}
function makeFlashMat() {
  // R7: the finisher's warm flash, a full-screen clip-space quad that exists for ~0.4 s (one extra draw only while it shows).
  return new ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    vertexShader: 'varying vec2 vQ; void main() { vQ = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float uA; varying vec2 vQ;
void main() {
  float r = length(vQ);
  gl_FragColor = vec4(mix(vec3(1.0, 0.95, 0.72), vec3(1.0, 0.62, 0.2), clamp(r * 0.8, 0.0, 1.0)), uA * (1.0 - 0.45 * clamp(r * 0.7, 0.0, 1.0)));
}`,
    transparent: true, depthTest: false, depthWrite: false,
  });
}
function makeWipeMat() {
  // DECISION (11-04): the Feast steam wipe is a full-screen clip-space quad (no camera): a noisy cream steam front
  // sweeps left → right, covers the screen at 0.3 s (when Core swaps the course) and clears by 0.6 s.
  return new ShaderMaterial({
    uniforms: { uT: { value: 0 }, uTime: U.time, uAsp: { value: 1 } },
    vertexShader: 'varying vec2 vQ; void main() { vQ = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float uT; uniform float uTime; uniform float uAsp; varying vec2 vQ;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 1.7) + 0.125 * vn(p * 4.01 + 3.1); }
void main() {
  vec2 p = vec2(vQ.x * uAsp, vQ.y);
  float n = fbm(p * 2.2 + vec2(-uTime * 1.5, uTime * 0.4));
  float front = -2.0 + 7.8 * min(uT, 0.5), back = -2.0 + 7.8 * max(uT - 0.5, 0.0);
  float x = vQ.x + (n - 0.5) * 0.9;
  float a = (1.0 - smoothstep(front - 0.35, front + 0.1, x)) * smoothstep(back - 0.1, back + 0.35, x);
  vec3 col = mix(vec3(0.93, 0.89, 0.84), vec3(1.0, 0.98, 0.95), smoothstep(0.3, 0.75, n));
  if (a < 0.005) discard;
  gl_FragColor = vec4(col, a * 0.97);
}`,
    transparent: true, depthTest: false, depthWrite: false,
  });
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
    // FIX-LIST-3 R1: no depth test. The eyes draw last (renderOrder 10), so no bin, tree or boss can ever bury the face.
    transparent: true, depthWrite: false, depthTest: false,
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
/** Picnic: a mown park lawn at street level. Stripes run toward the horizon (one colour per cell keeps them crisp). */
function lawnGeo(cx, cz) {
  const NX = 56, g = new PlaneGeometry(200, 200, NX, 28).rotateX(-PI / 2).toNonIndexed();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  const A = new Color('#93D66A'), A2 = new Color('#83CA5C'), B = new Color('#6CB24E');
  for (let t = 0; t < n; t += 3) {
    const mx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, c = Math.floor((mx + 100) / (200 / NX)) & 1 ? A : A2;
    for (let i = t; i < t + 3; i++) {
      const v = sstep(9, 46, Math.hypot(p.getX(i), p.getZ(i)));
      col[i * 3] = lerp(c.r, B.r, v); col[i * 3 + 1] = lerp(c.g, B.g, v); col[i * 3 + 2] = lerp(c.b, B.b, v);
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return prep(g).translate(cx, -0.5, cz);
}
const _cA = new Color(), _cB = new Color();
/** prep() + one flat colour (linear, like props.js), with an optional bottom-darkening ramp over `ao` u. */
function tint(g, hex, ao = 0, aoY = 0, keepUv = false) {
  if (!keepUv && g.attributes.uv) g.deleteAttribute('uv');
  g = prep(g);
  const p = g.attributes.position, c = g.attributes.color.array; _cA.set(hex);
  for (let i = 0; i < p.count; i++) {
    const f = ao > 0 ? 1 - 0.28 * (1 - sstep(aoY, aoY + ao, p.getY(i))) : 1;
    c[i * 3] = _cA.r * f; c[i * 3 + 1] = _cA.g * f; c[i * 3 + 2] = _cA.b * f;
  }
  return g;
}
function box(w, h, d, hex, x, y, z) { return tint(new BoxGeometry(w, h, d), hex).translate(x, y, z); }
function quadUp(w, d, hex, x, y, z, ry = 0) { return tint(new PlaneGeometry(w, d).rotateX(-PI / 2), hex).rotateY(ry).translate(x, y, z); }
function quadFront(w, h, hex, x, y, z) { return tint(new PlaneGeometry(w, h), hex).translate(x, y, z); }   // faces +z
function hs32(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/** Market: cobbled street at table height (ground uv continues the board's cobble), vignette to the fog. */
function streetGeo(cx, cz, town) {
  const g = new PlaneGeometry(200, 200, 40, 40).rotateX(-PI / 2).toNonIndexed();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const A = new Color('#907F68'), B = new Color('#7A6A56'), T = props.GROUND_TILE || 4;
  for (let i = 0; i < n; i++) {
    const t = sstep(9, 46, Math.hypot(p.getX(i), p.getZ(i)));
    col[i * 3] = lerp(A.r, B.r, t); col[i * 3 + 1] = lerp(A.g, B.g, t); col[i * 3 + 2] = lerp(A.b, B.b, t);
    uv[i * 2] = p.getX(i) / T; uv[i * 2 + 1] = p.getZ(i) / T;
  }
  g.setAttribute('color', new BufferAttribute(col, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2));
  return prep(g).translate(cx, -0.5, cz);
}
/** Harbour: the sea (uv.x > 500 flags water for the static shader), deeper toward the horizon. */
function seaGeo(cx, cz) {
  const g = new PlaneGeometry(240, 240, 48, 48).rotateX(-PI / 2).toNonIndexed();
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const A = new Color('#2AA7C9'), B = new Color('#1E8FB3');
  for (let i = 0; i < n; i++) {
    const x = p.getX(i) + cx, z = p.getZ(i) + cz, t = sstep(12, 60, Math.hypot(p.getX(i), p.getZ(i)));
    col[i * 3] = lerp(A.r, B.r, t); col[i * 3 + 1] = lerp(A.g, B.g, t); col[i * 3 + 2] = lerp(A.b, B.b, t);
    uv[i * 2] = 1000 + x * 0.5; uv[i * 2 + 1] = z * 0.5;
  }
  g.setAttribute('color', new BufferAttribute(col, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2));
  return prep(g).translate(cx, SEA_Y, cz);
}
/** One toy shopfront, front face on z = 0 facing +z, base at y = −0.5 (street level). ~80 tris. */
function facade(w, H, wall, rng) {
  const out = [], y0 = -0.5, dark = '#4A3B52', cream = '#FFF1DC';
  out.push(tint(new BoxGeometry(w, H, 2.5), wall, 1.2, y0).translate(0, y0 + H / 2, -1.25));
  out.push(box(w + 0.16, 0.2, 0.3, wall === cream ? '#E6D6BA' : cream, 0, y0 + H - 0.1, 0.05));   // cornice
  // shop floor: door + window under a striped awning
  const doorX = (rng() < 0.5 ? -1 : 1) * (w / 2 - 0.55);
  out.push(quadFront(0.62, 1.15, '#6A452C', doorX, y0 + 0.58, 0.012));
  out.push(quadFront(Math.max(0.8, w - 1.9), 0.8, dark, -doorX * 0.35, y0 + 0.75, 0.012));
  const ns = Math.max(4, Math.round(w / 0.42)), aw = new PlaneGeometry(w + 0.1, 0.95, ns, 1).rotateX(-PI / 2).rotateX(0.45).toNonIndexed();
  const vl = new PlaneGeometry(w + 0.1, 0.2, ns, 1).toNonIndexed();
  for (const [g, y, z] of [[aw, y0 + 1.55, 0.42], [vl, y0 + 1.27, 0.83]]) {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let v = 0; v < g.attributes.position.count; v++) { const k = Math.floor(v / 6) % ns; _cA.set(k % 2 ? cream : '#2FB5A5'); c[v * 3] = _cA.r; c[v * 3 + 1] = _cA.g; c[v * 3 + 2] = _cA.b; }
    g.setAttribute('color', new BufferAttribute(c, 3));
    g.deleteAttribute('uv'); out.push(prep(g).translate(0, y, z));
  }
  // upper floors: two windows each with a cream sill
  for (let fy = y0 + 2.2; fy + 0.9 < y0 + H - 0.2; fy += 1.25) {
    for (const sx of [-0.27, 0.27]) {
      const x = sx * w;
      out.push(quadFront(0.5, 0.7, dark, x, fy + 0.35, 0.012));
      out.push(box(0.64, 0.07, 0.12, cream, x, fy - 0.02, 0.05));
    }
  }
  return out;
}
/** Market Street backdrop: shopfronts ~2.5 u off the far edge and both flanks (never the near side). */
function marketBackdrop(parts, x0, x1, z0, z1, rng) {
  const walls = ['#C4643F', '#FFD3A6', '#7A4C9E', '#FF7A59', '#FFF1DC'];
  const row = (len, place) => {
    for (let s = 0; s < len;) {
      const w = 2.6 + rng() * 1.6, H = 3.5 + rng() * 3.0, wall = walls[(rng() * walls.length) | 0];
      if (s + w > len + 1) break;
      for (const g of facade(w, H, wall, rng)) parts.push(place(g, s + w / 2));
      s += w + 0.05;
    }
  };
  const far = z0 - 2.5, L = x1 - x0 + 12;
  row(L, (g, u) => g.translate(x0 - 6 + u, 0, far));
  const fl = (z1 - 1) - (z0 - 2.5);
  row(fl, (g, u) => g.rotateY(PI / 2).translate(x0 - 2.5, 0, far + u));
  row(fl, (g, u) => g.rotateY(-PI / 2).translate(x1 + 2.5, 0, far + u));
}
/** Triangle soup (flat position list, one colour per vertex list) as a static part: facets stay low-poly. */
function soup(pos, cols) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
  g.computeVertexNormals();
  return prep(g);
}
/** A clipped hedge along +x from 0 to len, front face on z = 0 facing +z, base at street level. ~6 tris per 0.55 u. */
function hedgeWall(len, H, rng) {
  const y0 = -0.5, n = Math.max(2, Math.round(len / 0.55)), pos = [], cols = [];
  const lo = new Color('#2F7F3A'), mid = new Color('#46A24E'), hi = new Color('#6CC66F');
  const tops = Array.from({ length: n + 1 }, (_, i) => y0 + H + 0.14 * Math.sin(i * 1.7 + rng() * 2) + rng() * 0.16);
  const quad = (a, b, c, d, ca, cb) => {   // a, b on the lower edge; c, d on the upper edge
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const k of [ca, ca, cb, ca, cb, cb]) cols.push(k.r, k.g, k.b);
  };
  for (let i = 0; i < n; i++) {
    const xa = (i / n) * len, xb = ((i + 1) / n) * len, ta = tops[i], tb = tops[i + 1];
    const ma = y0 + (ta - y0) * 0.55, mb = y0 + (tb - y0) * 0.55;
    quad([xa, y0, 0.05], [xb, y0, 0.05], [xb, mb, 0.2], [xa, ma, 0.2], lo, mid);
    quad([xa, ma, 0.2], [xb, mb, 0.2], [xb, tb, 0], [xa, ta, 0], mid, hi);
    quad([xa, ta, 0], [xb, tb, 0], [xb, tb - 0.1, -1.1], [xa, ta - 0.1, -1.1], hi, mid);
  }
  return soup(pos, cols);
}
/** White picket fence along +x from 0 to len, front face toward +z, base at street level. 3 tris a picket + 2 rails. */
function picketFence(len) {
  const y0 = -0.5, pos = [], cols = [], w = 0.075, h = 0.62, tip = 0.1, step = 0.3;
  const cream = new Color('#FFF6E6'), shade = new Color('#D9CDBB');
  const tri = (a, b, c, ca, cb, cc) => { pos.push(...a, ...b, ...c); for (const k of [ca, cb, cc]) cols.push(k.r, k.g, k.b); };
  for (let x = step / 2; x < len; x += step) {
    const l = [x - w, y0, 0], r = [x + w, y0, 0], tl = [x - w, y0 + h, 0], tr = [x + w, y0 + h, 0], t = [x, y0 + h + tip, 0];
    tri(l, r, tr, shade, shade, cream); tri(l, tr, tl, shade, cream, cream); tri(tl, tr, t, cream, cream, cream);
  }
  for (const y of [0.2, 0.46]) {
    const a = [0, y0 + y, -0.03], b = [len, y0 + y, -0.03], c = [len, y0 + y + 0.07, -0.03], d = [0, y0 + y + 0.07, -0.03];
    tri(a, b, c, shade, shade, shade); tri(a, c, d, shade, shade, shade);
  }
  return soup(pos, cols);
}
/** Picnic Park backdrop: a picket fence and a clipped hedge past the far edge and both flanks, sunflowers, then trees
 *  melting into the fog. The near side only gets flat things (tufts, daisies, flowerbeds): tall decor there blurs over the HUD. */
function picnicBackdrop(parts, x0, x1, z0, z1, rng) {
  const off = 3.7, far = z0 - off, xl = x0 - off, xr = x1 + off, flank = z1 + 2.5 - far;
  const place = (kind, x, z, s, ry) => {
    try { parts.push(prep(props.geometryFor(kind).clone()).scale(s, s, s).rotateY(ry).translate(x, -0.5, z)); } catch (e) { /* skip */ }
  };
  const patch = (x, z, r) => parts.push(tint(new CircleGeometry(r, 9).rotateX(-PI / 2), '#6FB552').scale(1, 1, 0.8).translate(x, -0.494, z));
  const run = (geo, side) => parts.push(
    side === 0 ? geo.translate(xl - 8, 0, far)
      : side < 0 ? geo.rotateY(PI / 2).translate(xl, 0, far + flank) : geo.rotateY(-PI / 2).translate(xr, 0, far));
  run(picketFence(xr - xl + 16), 0); run(picketFence(flank), -1); run(picketFence(flank), 1);
  const hed = 0.95, back = 0.5;
  parts.push(hedgeWall(xr - xl + 22, hed, rng).translate(xl - 11, 0, far - back));
  parts.push(hedgeWall(flank, hed, rng).rotateY(PI / 2).translate(xl - back, 0, far + flank));
  parts.push(hedgeWall(flank, hed, rng).rotateY(-PI / 2).translate(xr + back, 0, far));
  // sunflowers lean over the fence on the far side, trees rise behind the hedge
  for (let x = xl + 0.8 + rng() * 2; x < xr - 0.5; x += 2.3 + rng() * 2.6) place('sunflower', x, far - 0.2 + rng() * 0.3, 0.85 + rng() * 0.3, (rng() - 0.5) * 0.7);
  for (let x = xl - 6 + rng() * 2; x < xr + 6; x += 3.4 + rng() * 2.6) {
    place('tree', x, far - 2.6 - rng() * 4.5, 1.25 + rng() * 0.7, rng() * TAU);
    if (rng() < 0.5) place('bush', x + 1.5, far - 1.9 - rng(), 1.3 + rng() * 0.5, rng() * TAU);
  }
  for (const [s, ex] of [[-1, xl], [1, xr]]) {
    for (let z = far + 2; z < z1 + 2; z += 4 + rng() * 3) place('tree', ex + s * (2.4 + rng() * 3.5), z, 1.2 + rng() * 0.6, rng() * TAU);
  }
  // the lawn inside the fence: tufts, daisies and mown patches, all low enough to pass under the HUD
  const scatter = i => {
    const k = i % 5;
    return k === 0 ? [lerp(x0 - 3.2, x1 + 3.2, rng()), z0 - 0.7 - rng() * 2.6]
      : k === 1 ? [x0 - 0.7 - rng() * 2.6, lerp(z0, z1, rng())]
        : k === 2 ? [x1 + 0.7 + rng() * 2.6, lerp(z0, z1, rng())]
          : [lerp(x0 - 3, x1 + 3, rng()), z1 + 0.7 + rng() * 3.6];
  };
  for (let i = 0; i < 18; i++) { const [x, z] = scatter(i); place('grasstuft', x, z, 1 + rng() * 0.5, rng() * TAU); }
  for (let i = 0; i < 10; i++) { const [x, z] = scatter(i); patch(x, z, 0.5 + rng() * 0.8); }
  const petals = ['#FFFFFF', '#FFFFFF', '#FFC93C', '#FF9EC4'];
  for (let i = 0; i < 40; i++) {
    const [x, z] = scatter(i), c = petals[(rng() * 4) | 0];
    parts.push(tint(new CircleGeometry(0.075, 5).rotateX(-PI / 2), c).translate(x, -0.488, z));
    parts.push(tint(new CircleGeometry(0.03, 4).rotateX(-PI / 2), c === '#FFC93C' ? '#FF7A59' : '#FFC93C').translate(x, -0.484, z));
  }
  place('flowerbed', x0 - 1.1, z1 + 1.2, 1.4, 0.3); place('flowerbed', x1 + 1.1, z1 + 1.5, 1.2, -0.4);
}
/** Harbour Pier: pilings just outside the deck edge and a few toy sailboats out at sea. */
function harbourBackdrop(parts, x0, x1, z0, z1, rng) {
  const pile = (x, z) => {
    parts.push(tint(new CylinderGeometry(0.16, 0.17, 1.02, 8, 1, true), '#7E5636', 0.5, -0.9).translate(x, -0.39, z));
    parts.push(tint(new CircleGeometry(0.16, 8).rotateX(-PI / 2), '#A87A47').translate(x, 0.12, z));
  };
  const o = 0.2;
  for (let x = x0 + 0.6; x <= x1 - 0.6 + 1e-6; x += (x1 - x0 - 1.2) / Math.max(1, Math.round((x1 - x0 - 1.2) / 2.6))) { pile(x, z0 - o); pile(x, z1 + o); }
  for (let z = z0 + 0.6; z <= z1 - 0.6 + 1e-6; z += (z1 - z0 - 1.2) / Math.max(1, Math.round((z1 - z0 - 1.2) / 2.6))) { pile(x0 - o, z); pile(x1 + o, z); }
  const nb = 3 + (rng() < 0.5 ? 1 : 0);
  for (let k = 0; k < nb; k++) {
    const side = k % 3, s = 0.9 + rng() * 0.5;
    const bx = side === 0 ? lerp(x0 - 4, x1 + 4, (k + rng()) / nb) : side === 1 ? x0 - 6 - rng() * 6 : x1 + 6 + rng() * 6;
    const bz = side === 0 ? z0 - 7 - rng() * 10 : lerp(z0 - 4, (z0 + z1) / 2, rng());
    const ry = rng() * TAU, hull = rng() < 0.6 ? '#E04F4F' : '#FFFFFF';
    const b = [
      tint(new CylinderGeometry(0.5, 0.36, 0.42, 6, 1), hull, 0.3, -0.21).scale(1, 1, 2.4).translate(0, 0.05, 0),
      tint(new CylinderGeometry(0.5, 0.5, 0.06, 6, 1), hull === '#FFFFFF' ? '#E04F4F' : '#FFFFFF').scale(1, 1, 2.4).translate(0, 0.27, 0),
      tint(new CylinderGeometry(0.035, 0.035, 2.4, 5), '#F6ECD6').translate(0, 1.45, 0.1),
    ];
    const sail = new BufferGeometry(), sp = [0, 0.45, 0.2, 0, 2.55, 0.18, 0, 0.45, -0.95];
    sail.setAttribute('position', new BufferAttribute(new Float32Array([...sp, sp[0], sp[1], sp[2], sp[6], sp[7], sp[8], sp[3], sp[4], sp[5]]), 3));
    b.push(tint(sail, '#F6ECD6'));
    for (const g of b) parts.push(g.scale(s, s, s).rotateY(ry).translate(bx, SEA_Y, bz));
  }
}
/** Belt fallback (Art's beltGeometry contract): runs along local +z (length `along`), `across` wide on x. */
function beltFallback(across, along) {
  const fr = [], hw = across / 2 + 0.06, hl = along / 2;
  for (const s of [-1, 1]) {
    fr.push(box(0.1, 0.1, along + 0.12, '#2B2F3A', s * hw, 0.05, 0));
    fr.push(box(0.12, 0.03, along + 0.14, '#FFCF3D', s * hw, 0.11, 0));
  }
  for (const e of [-1, 1]) fr.push(tint(new CylinderGeometry(0.06, 0.06, across + 0.08, 8).rotateZ(PI / 2), '#8A93A3').translate(0, 0.05, e * (hl - 0.02)));
  const frame = mergeGeometries(fr, false); fr.forEach((g) => g.dispose());
  const surface = new PlaneGeometry(across, along, 1, 1).rotateX(-PI / 2).toNonIndexed();
  const p = surface.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / across + 0.5; uv[i * 2 + 1] = p.getZ(i) / BELT_PERIOD; }
  surface.setAttribute('uv', new BufferAttribute(uv, 2));
  return { frame, surface: tint(surface, '#FFFFFF', 0, 0, true).translate(0, BELT_TOP, 0), fresh: true };
}
/** Hood fallback: a toy tunnel over a belt end, opening toward −z, footprint z ±0.22. */
function hoodFallback(across, hex) {
  const hw = across / 2 + 0.12, out = [];
  for (const s of [-1, 1]) out.push(box(0.1, 0.5, 0.44, hex, s * hw, 0.25, 0));
  out.push(box(2 * hw + 0.12, 0.1, 0.48, '#FFF1DC', 0, 0.53, 0));
  out.push(box(2 * hw, 0.5, 0.06, hex, 0, 0.25, 0.19));
  out.push(tint(new PlaneGeometry(2 * hw - 0.1, 0.44).rotateY(PI), '#2A2230').translate(0, 0.25, 0.155));   // dark inside, faces the opening
  const g = mergeGeometries(out, false); out.forEach((o) => o.dispose()); return g;
}
/** Nest fallback (Art's nestGeometry contract): twig ring r 0.45, ~0.16 high, dark bowl. */
function nestFallback() {
  const out = [tint(new TorusGeometry(0.4, 0.09, 6, 18).rotateX(-PI / 2), '#8A5A33', 0.12, 0).translate(0, 0.08, 0),
    tint(new CircleGeometry(0.38, 16).rotateX(-PI / 2), '#5E3B22').translate(0, 0.035, 0)];
  const g = mergeGeometries(out, false); out.forEach((o) => o.dispose()); return g;
}
/** Splat fallback: a noisy flat blob + droplets, radius 1 (scaled by the stack's a). */
function splatFallback(hex, rng) {
  const g = new CircleGeometry(1, 14).rotateX(-PI / 2).toNonIndexed(), p = g.attributes.position;
  const ph = rng() * TAU;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r > 1e-4) { const a = Math.atan2(z, x), k = 0.78 + 0.16 * Math.sin(a * 5 + ph) + 0.08 * Math.sin(a * 11 + ph * 2); p.setX(i, x * k); p.setZ(i, z * k); }
  }
  const out = [tint(g, hex)];
  for (let k = 0; k < 4; k++) { const a = ph + k * 1.7, r = 1.05 + 0.25 * rng(); out.push(tint(new CircleGeometry(0.1 + 0.08 * rng(), 7).rotateX(-PI / 2), hex).translate(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  const m = mergeGeometries(out, false); out.forEach((o) => o.dispose()); return m;
}

/** Pit wall (aPit 1, flat sRGB gradient gold → ink) + the stew disc (aPit 0, flipped to face −y), one geometry. */
function pitStewGeo() {
  const pg = new CylinderGeometry(0.97, 0.97, 1.7, 44, 6, true).translate(0, -0.85, 0).toNonIndexed();
  const sd = new CircleGeometry(0.97, 48).rotateX(PI / 2).translate(0, -0.55, 0).toNonIndexed();
  const stops = [[0, new Color('#F5B323')], [0.12, new Color('#E59A1F')], [0.33, new Color('#B4621C')], [1, new Color('#3A2418')]];
  const np = pg.attributes.position.count, ns = sd.attributes.position.count, n = np + ns;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), pit = new Float32Array(n), c = new Color();
  pos.set(pg.attributes.position.array, 0); pos.set(sd.attributes.position.array, np * 3);
  for (let i = 0; i < np; i++) {
    const t = -pos[i * 3 + 1] / 1.7; let a = stops[0], b = stops[1];
    for (let s = 1; s < stops.length; s++) { a = stops[s - 1]; b = stops[s]; if (t <= stops[s][0]) break; }
    const u = clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1), f = 0.84 + 0.16 * clamp(-pos[i * 3 + 2] / 0.97, -1, 1);
    c.setRGB(lerp(a[1].r, b[1].r, u) * f, lerp(a[1].g, b[1].g, u) * f, lerp(a[1].b, b[1].b, u) * f);   // linear
    col[i * 3] = linToS(c.r); col[i * 3 + 1] = linToS(c.g); col[i * 3 + 2] = linToS(c.b);
    pit[i] = 1;
  }
  pg.dispose(); sd.dispose();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aCol', new BufferAttribute(col, 3));
  g.setAttribute('aPit', new BufferAttribute(pit, 1));
  return g;
}
function linToS(v) { return v < 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 0.41666) - 0.055; }
/** Gull body + both wings merged (wings moved to their hinges), aWing = 0 body · +1 left · −1 right. */
function gullMergedGeo() {
  if (!props.gullGeometry) return null;
  const body = props.gullGeometry(), u = body.userData || {};
  if (!u.wingL || !u.wingR) return null;
  const pl = u.pivotL || [0.2, 0.38, 0], pr = u.pivotR || [-0.2, 0.38, 0];
  const parts = [prep(body.clone()), prep(u.wingL.clone()).translate(pl[0], pl[1], pl[2]), prep(u.wingR.clone()).translate(pr[0], pr[1], pr[2])];
  const g = mergeGeometries(parts, false);
  const n0 = parts[0].attributes.position.count, n1 = parts[1].attributes.position.count, n = g.attributes.position.count;
  const w = new Float32Array(n);
  for (let i = n0; i < n; i++) w[i] = i < n0 + n1 ? 1 : -1;
  g.setAttribute('aWing', new BufferAttribute(w, 1));
  parts.forEach((p) => p.dispose());
  return g;
}
/** Art's beltArrowTexture contract: 64² chevrons pointing to the canvas top (= +v = travel), repeat-wrapped. */
function beltArrowFallback() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#3B3646'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#4A4458'; g.fillRect(0, 0, 4, 64); g.fillRect(60, 0, 4, 64);
  g.strokeStyle = '#F5B323'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(16, 42); g.lineTo(32, 24); g.lineTo(48, 42); g.stroke();
  const t = new CanvasTexture(c); t.anisotropy = 4; return t;
}
function beltPlaceholder() {
  const g = prep(new PlaneGeometry(0.01, 0.01).rotateX(-PI / 2).translate(0, -60, 0));
  g.setAttribute('aSpd', new BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}
/** A cake geometry for the cake InstancedMeshes: position/normal/color only (propMat's contract). */
function cakeShell(src) {
  const g = new BufferGeometry();
  for (const n of ['position', 'normal', 'color']) if (src.attributes[n]) g.setAttribute(n, src.attributes[n]);
  if (src.index) g.setIndex(src.index);
  return g;
}
/** The Simmer lid hat (pot-local units, radius 0.42): a tin dome + a dark knob, origin at the lid's rim. */
function lidGeo() {
  const dome = tint(new SphereGeometry(0.42, 16, 6, 0, TAU, 0, PI / 2).scale(1, 0.5, 1), '#C9D3E0');
  const lip = tint(new TorusGeometry(0.42, 0.03, 4, 20).rotateX(-PI / 2), '#AEB8C6');
  const knob = tint(new SphereGeometry(0.075, 8, 5), '#3A2418').scale(1, 0.8, 1).translate(0, 0.24, 0);
  const g = mergeGeometries([dome, lip, knob], false); [dome, lip, knob].forEach((o) => o.dispose()); return g;
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
  // DECISION (11-04, §12.3): og = the right 54 % of the 1200×630 frame is the 3D hero (ui.js paints the left 46 %
  // teal panel over the canvas), so the camera anchor is that half's centre at 60 % height. og and cover are stills
  // (STILL): the camera follows the pot exactly, with no board clamp, so the hero never slides off its anchor.
  const qs = typeof location !== 'undefined' ? location.search : '';
  REC = !!opts.record || /[?&](?:record|og)=1\b|[?&]cover=(?:wide|tall|square)\b/.test(qs);
  OGP = /[?&]og=1\b/.test(qs) && !/[?&]cover=/.test(qs);
  STILL = OGP || /[?&]cover=(?:wide|tall|square)\b/.test(qs);
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

  // static layer (board, ground, surfaces, decor, table): one merged Mesh, rebuilt at loadLevel
  blankTex = new CanvasTexture(Object.assign(document.createElement('canvas'), { width: 4, height: 4 }));
  { const c = blankTex.image.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 4, 4); }
  blankTex.colorSpace = SRGBColorSpace; blankTex.wrapS = blankTex.wrapT = RepeatWrapping;
  staticMat = patchStatic(stencilSkip(new MeshLambertMaterial({ vertexColors: true, map: blankTex })));
  staticMesh = new Mesh(lawnGeo(0, 0), staticMat);
  staticMesh.frustumCulled = false; scene.add(staticMesh);

  // the hole (D25): rim disc writes stencil 1; pit and stew draw only where stencil == 1
  holeG = new Group(); scene.add(holeG);
  const discMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  discMat.stencilWrite = true; discMat.stencilRef = 1; discMat.stencilFunc = AlwaysStencilFunc; discMat.stencilZPass = ReplaceStencilOp;
  rimDisc = new Mesh(new CircleGeometry(1, 56).rotateX(-PI / 2).translate(0, 0.001, 0), discMat);
  rimDisc.renderOrder = -2; rimDisc.frustumCulled = false;
  stewMat = makeStewMat();
  pitStew = new Mesh(pitStewGeo(), stewMat);
  pitStew.renderOrder = -1; pitStew.frustumCulled = false;
  holeG.add(rimDisc, pitStew);

  potRoot = new Group(); scene.add(potRoot);
  // FIX-LIST-3 R1: the near rim shows through whatever stands in front of it. A flat arc just above the rim that only passes where
  // something is already nearer than it (GreaterDepth), so it is one small draw whatever the item count and invisible on a clear
  // board. Near arc only: the back of the rim is never hidden by items, and skin lids and crowns live there.
  rimXray = new Mesh(new RingGeometry(0.92, 1.12, 40, 1, PI - 0.3, PI + 0.6).rotateX(-PI / 2).translate(0, 0.19, 0),
    new MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false, depthFunc: GREATER_DEPTH, toneMapped: false }));
  rimXray.frustumCulled = false; rimXray.renderOrder = 9; potRoot.add(rimXray);
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
    eyeMat = makeEyeMat(); eyeMat.uniforms.uLidCol.value = sv(LID[skin && skin.replace('+g', '')] || LID.sunny);
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
    // DECISION (11-05, art lane): the smallest foods were a few pixels at 390 wide, so tier 0 draws 30 % larger and tier 1
    // 12 %. Render only: sim sizes, what fits the pot and the "too big" cue are unchanged (these are always edible).
    const vis = foodVis(K);
    if (vis !== 1) { const q = base.attributes.position.clone(); for (let i = 0; i < q.array.length; i++) q.array[i] *= vis; g.setAttribute('position', q); }
    const cap = capFor(K);
    const fx = instAttr(g, 'aFx', cap, 4);
    const m = new InstancedMesh(g, propMat, cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false;
    const ud = base.userData || {};
    m.userData = { K, fx, cap, catA: ud.fp || K.a, h: ud.h || K.h || K.a, sway: SWAY.has(K.id) ? 1 : K.id === 'chili' ? 3 : K.food ? 2 : 0, top: ud.top, slots: ud.slots };   // aFx.w: 1 sway, 2 edge, 3 edge + flame
    scene.add(m); kindMesh[K.i] = m;
  }

  // decals (blob shadows + flat markers, one pool), billboards, particles
  { const g = quadXZ(); decA = instAttr(g, 'aM', DEC_MAX, 4); decMesh = pool(g, makeDecalMat(), DEC_MAX, 1); }
  { const g = new PlaneGeometry(1, 1); bbP = instAttr(g, 'aP', 48, 4); bbM = instAttr(g, 'aM', 48, 4); bbMk = pool(g, makeBillboardMat(), 48, 8); }
  { const g = new PlaneGeometry(1, 1); fxP = instAttr(g, 'aP', FX_MAX, 4); fxC = instAttr(g, 'aC', FX_MAX, 4); fxR = instAttr(g, 'aR', FX_MAX, 4); fxMesh = pool(g, makeFxMat(), FX_MAX, 9); }

  // twists (L21+): every mesh/material/instanced attribute exists from boot; loadLevel only swaps geometry
  gullMat = makeGullMat();
  try {
    const g = gullMergedGeo();
    if (g) { gullA = instAttr(g, 'aGf', 4, 3); gullMesh = pool(g, gullMat, 4, 0); gullMesh.visible = false; }
  } catch (e) { gullMesh = null; gullA = null; }
  beltTex = props.beltArrowTexture ? props.beltArrowTexture() : beltArrowFallback();
  beltTex.wrapS = beltTex.wrapT = RepeatWrapping; beltTex.colorSpace = SRGBColorSpace;
  beltMat = makeBeltMat(beltTex);
  beltMesh = new Mesh(beltPlaceholder(), beltMat); beltMesh.visible = false; beltMesh.frustumCulled = false; scene.add(beltMesh);
  {
    const mk = () => {
      const g = cakeShell(props.bossTierGeometry ? props.bossTierGeometry('boss-weddingcake', 0) : new BoxGeometry(1, 1, 1));
      const fx = instAttr(g, 'aFx', 1, 4), m = new InstancedMesh(g, propMat, 1);
      m.instanceMatrix.setUsage(DynamicDrawUsage); m.count = 0; m.visible = false; m.frustumCulled = false; m.userData.fx = fx;
      scene.add(m); return m;
    };
    cakeRest = mk(); cakeTop = mk();
  }
  splatMesh = new Mesh(new PlaneGeometry(0.01, 0.01).rotateX(-PI / 2).translate(0, -60, 0), staticMat);
  splatMesh.visible = false; splatMesh.frustumCulled = false; scene.add(splatMesh);
  lidMesh = new Mesh(lidGeo(), potMat); lidMesh.visible = false; lidMesh.frustumCulled = false; potRoot.add(lidMesh);
  wipeMesh = new Mesh(new PlaneGeometry(2, 2), makeWipeMat());
  wipeMesh.visible = false; wipeMesh.frustumCulled = false; wipeMesh.renderOrder = 20; scene.add(wipeMesh);
  flashMesh = new Mesh(new PlaneGeometry(2, 2), makeFlashMat());
  flashMesh.visible = false; flashMesh.frustumCulled = false; flashMesh.renderOrder = 21; scene.add(flashMesh);
  try { calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { calm = false; }
  U.calm.value = calm ? 1 : 0;

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
  const one = (m) => {
    keep(m); m.visible = true;
    if (m.count < 1) { m.count = 1; _m.makeTranslation(0, -80, 0); m.setMatrixAt(0, _m); m.instanceMatrix.needsUpdate = true; }
  };
  for (const m of kindMesh) if (m) one(m);
  for (const m of [gullMesh, cakeRest, cakeTop]) if (m) one(m);
  for (const m of [decMesh, bbMk, fxMesh]) { keep(m); m.visible = true; if (m.count < 1) m.count = 1; }
  for (const o of [warmGlow, beltMesh, splatMesh, lidMesh, wipeMesh, flashMesh]) if (o) { keep(o); o.visible = true; }
  // Without KHR_parallel_shader_compile, three logs a console warning from compileAsync; compile synchronously instead.
  try {
    if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* compile on first draw */ }
  // DECISION (11-06): these frames draw into ONE pixel. Every pool (and the pot with its lid) is visible here on the boot
  // camera, and when warm-up loses its 2.5 s race on a slow device the frame sat behind the title: a giant pot and lid
  // under the 2D hero. Programs, buffers and textures still get their first real draw. Scissor is scoped to the call,
  // because the game loop may run between these frames once the title is up.
  for (let f = 0; f < 2; f++) {
    renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    await new Promise((r) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(r) : setTimeout(r, 16)));
  }
  for (const [o, v, c] of saved) { o.visible = v; if (c !== undefined) o.count = c; }
}

// ------------------------------------------------------------------ level / skin
/** Fills the static layer for this level (one merged Mesh) and resets per-level render state. */
export function loadLevel(L, skinId) {
  // DECISION (11-04): each town sets its own hemisphere + sun (LIGHT). Per-level twist state (splats, the Simmer lid
  // hat, the boss glance, the cake build, crack timers, gull smoothing) resets here; a running Feast steam wipe keeps
  // going across the swap (Core reloads the course while the wipe covers the screen).
  // DECISION (11-04): the kinds a level uses include stack contents (it.stack), so their pools are drawn.
  if (!renderer || !L) return;
  LV = L; W = null;
  const town = TOWN[L.town] ? L.town : 'picnic';
  buildStatic(L, town);
  U.edge.value = town === 'harbour' ? 1 : 0;
  if (town !== curTown) {
    const T = TOWN[town], Lt = LIGHT[town] || LIGHT.picnic;
    scene.background.set(T.sky); fog.color.set(T.fog);
    hemi.color.set(Lt.sky); hemi.groundColor.set(Lt.gnd); hemi.intensity = Lt.hi;
    sun.color.set(Lt.sun); sun.intensity = Lt.si;
    let tex = null;
    try { tex = props.groundTexture(town); } catch (e) { tex = null; }
    if (groundTex && groundTex !== tex) groundTex.dispose();
    groundTex = tex;
    if (tex) { tex.wrapS = tex.wrapT = RepeatWrapping; tex.colorSpace = SRGBColorSpace; tex.needsUpdate = true; }
    staticMat.map = tex || blankTex; staticMat.needsUpdate = false;
    curTown = town;
  }
  for (const K of KINDS) if (K.ing && (K.town === town || K.town === 'all') && iconCell[K.i] > 0 && K.icon) loadIcon(iconCell[K.i], 'art/' + K.icon + '.webp', true);
  // kinds present in this level (stack contents included)
  for (const c of used) if (kindMesh[c]) { kindMesh[c].visible = false; kindMesh[c].count = 0; }
  const set = new Set();
  for (const it of L.items || []) {
    for (const k of [it.kind].concat(Array.isArray(it.stack) ? it.stack : [])) { const c = KIND_ID[k]; if (c !== undefined && kindMesh[c]) set.add(c); }
  }
  used = [...set];
  setSkin(skinId || skin || 'sunny');
  // reset moods, fx, camera
  resetMood();
  for (let i = 0; i < FX_MAX; i++) fl[i] = 0;
  fxN = 0; fxMesh.count = 0; fxMesh.visible = false;
  reveal = null; punchT = 0; bossCamT = -1; recWinT = -1; fin = null; finHold = false; flashA = 0; shakeX = shakeZ = 0;
  openK = 0; openT = -1; apK = 0; apFit = null; bossNear = null; fw = null;
  const sp = L.spawn || { x: 0, z: 0 }, r0 = +L.r0 || 0.3;
  pot.x = +sp.x || 0; pot.z = +sp.z || 0; pot.r = r0; pot.rVis = r0;
  cam.x = pot.x; cam.z = pot.z; cam.vx = cam.vz = 0; cam.rCam = r0;
  // twists
  splats.length = 0; rebuildSplats();
  lid.on = false; lid.pop = lid.jig = lid.steamT = 0; lidMesh.visible = false;
  glance = null; bossRing = null; hotT = 0; potLift = 0; truckSq = 0; truckStop = false; truckYaw = 0;
  cakeKey = ''; cakeH = 0;
  for (const m of [cakeRest, cakeTop]) { m.count = 0; m.visible = false; }
  crackT.fill(0); prevCrack.fill(0); gOn.fill(0);
  if (gullMesh) { gullMesh.count = 0; gullMesh.visible = false; }
}

function buildStatic(L, town) {
  // DECISION: off-board decor on the near side (z > z1, toward the camera) is skipped: at 55° pitch it sits between
  // the camera and the play area and reads as a big blurry blob over the bottom HUD (seen at 390×844).
  // DECISION (11-05, art lane): Picnic's bare brown table read as a void around the board on phones, so the ground is now
  // a mown lawn with a picket fence, hedge, sunflowers and trees past the far edge and flanks (flat things only on the near side).
  // DECISION (11-04, §7.2–§7.3): the ground is per town: Picnic the lawn, Market a cobbled street with toy
  // shopfront rows ~2.5 u past the far edge and both flanks (never the near side), Harbour the sea (water beyond every
  // board edge, swell + edge foam in patchStatic) with pilings and a few sailboats. Off-board decor sits at street
  // level (−0.5) or at the waterline in Harbour. Everything static merges into the one mesh (D25: one draw).
  // DECISION (11-04, z-fight): overlapping surfaces step up 0.006 u per overlap level (cap 2) in list order, so a
  // later blanket always sits on the one under it (no coplanar flicker); a surface with its own s.y keeps it.
  // DECISION (11-04): belt frames + both end hoods, the food truck's faint dashed loop (with a dashed circle at each
  // stop) and the gull roost (post, perch, ground nest where stolen food lands) are static too; only the belt
  // surfaces (scrolling arrows) are a separate boot-created mesh whose geometry is swapped here.
  const x0 = num(L.x0, -(L.W || 10) / 2), x1 = num(L.x1, (L.W || 10) / 2), z0 = num(L.z0, -(L.D || 10) / 2), z1 = num(L.z1, (L.D || 10) / 2);
  const Wd = num(L.W, x1 - x0), Dd = num(L.D, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rng = mulberry32(hs32('sp' + (L.n ?? L.id ?? '') + town));
  const parts = [town === 'market' ? streetGeo(cx, cz, town) : town === 'harbour' ? seaGeo(cx, cz) : lawnGeo(cx, cz)], fresh = [];
  try { const b = props.boardGeometry(Wd, Dd, town); fresh.push(b); parts.push(prep(b.clone()).translate(cx, 0, cz)); } catch (e) { /* board missing: ground only */ }
  if (town === 'market') marketBackdrop(parts, x0, x1, z0, z1, rng);
  else if (town === 'harbour') harbourBackdrop(parts, x0, x1, z0, z1, rng);
  else picnicBackdrop(parts, x0, x1, z0, z1, rng);
  const surf = L.surfaces || [], sb = [], lvl = [];
  for (let k = 0; k < surf.length; k++) {
    const s = surf[k], cr = Math.abs(Math.cos(s.rot || 0)), sr = Math.abs(Math.sin(s.rot || 0));
    const hx = ((+s.w || 1) * cr + (+s.d || 1) * sr) / 2, hz = ((+s.w || 1) * sr + (+s.d || 1) * cr) / 2;
    const bx = [s.x - hx, s.x + hx, s.z - hz, s.z + hz];
    let lv = 0;
    for (let j = 0; j < k; j++) { const o = sb[j]; if (o[0] < bx[1] - 1e-3 && o[1] > bx[0] + 1e-3 && o[2] < bx[3] - 1e-3 && o[3] > bx[2] + 1e-3) lv = Math.max(lv, lvl[j] + 1); }
    sb.push(bx); lvl.push(Math.min(2, lv));
    try {
      const g = props.surfaceGeometry(s.type, s.w, s.d, s.color, town); fresh.push(g);
      parts.push(prep(g.clone()).rotateY(s.rot || 0).translate(s.x, typeof s.y === 'number' ? s.y : lvl[k] * 0.006, s.z));
    } catch (e) { /* skip one bad surface */ }
  }
  // R8: floor dressing and pile mats (dress.js), one merged mesh like the rest; low tier gets half of it
  for (const d of dressLayout(L, town, tier === 'low')) {
    try {
      const g = props.dressGeometry(d); fresh.push(g);
      parts.push(prep(g.clone()).rotateY(d.rot).translate(d.x, 0, d.z));
    } catch (e) { /* skip one bad piece */ }
  }
  const dy = town === 'harbour' ? SEA_Y - 0.05 : -0.5;
  for (const d of L.decor || []) {
    if (d.z > z1 + 0.2) continue;
    try {
      const g = prep(props.geometryFor(d.kind).clone()), s = d.s || 1;
      const inside = d.x > x0 && d.x < x1 && d.z > z0 && d.z < z1;
      parts.push(g.scale(s, s, s).rotateY(d.rot || 0).translate(d.x, inside ? 0 : dy, d.z));
    } catch (e) { /* skip */ }
  }
  // belts: frame + hoods static, surfaces into beltMesh (aSpd per vertex)
  const bs = [], hoodHex = HOOD[town] || HOOD.picnic;
  for (const b of L.belts || []) {
    const len = +b.w || 4, wid = +b.d || 1.4, v = b.v != null ? +b.v : 1.2;
    const th = (+b.rot || 0) + PI / 2 + (v < 0 ? PI : 0);   // local +z = travel (cos rot, −sin rot) · sign(v)
    let bg = null;
    try { bg = props.beltGeometry ? props.beltGeometry(wid, len, town) : null; } catch (e) { bg = null; }
    if (!bg || !bg.frame || !bg.surface) bg = beltFallback(wid, len);
    parts.push(prep(bg.frame.clone()).rotateY(th).translate(b.x, 0, b.z));
    const sg = prep(bg.surface.clone()).rotateY(th).translate(b.x, 0, b.z);
    sg.setAttribute('aSpd', new BufferAttribute(new Float32Array(sg.attributes.position.count).fill(Math.abs(v) / BELT_PERIOD), 1));
    bs.push(sg);
    if (bg.fresh) { bg.frame.dispose(); bg.surface.dispose(); }
    let hg = null;
    try { hg = props.hoodGeometry ? props.hoodGeometry(wid, town) : null; } catch (e) { hg = null; }
    const hf = !hg; if (hf) hg = hoodFallback(wid, hoodHex);
    const dx = Math.sin(th), dz = Math.cos(th), off = len / 2 - 0.22;
    parts.push(prep(hg.clone()).rotateY(th).translate(b.x + dx * off, 0, b.z + dz * off));          // in: opening upstream
    parts.push(prep(hg.clone()).rotateY(th + PI).translate(b.x - dx * off, 0, b.z - dz * off));     // out: opening downstream
    if (hf) hg.dispose();
  }
  {
    const old = beltMesh.geometry;
    let g = null;
    if (bs.length) { try { g = mergeGeometries(bs, false); } catch (e) { g = null; } }
    for (const p of bs) if (p !== g) p.dispose();
    beltMesh.geometry = g || beltPlaceholder(); beltMesh.visible = !!g;
    if (old && old !== beltMesh.geometry) old.dispose();
  }
  // the food truck's loop: faint dashes (0.5 on, 0.4 off) and a dashed circle at each stop
  const tp = L.truckPath || [];
  if (tp.length >= 2) {
    _cB.set('#FFFFFF'); _cA.set((props.GROUND_BASE && props.GROUND_BASE[town]) || '#FFF1DC').lerp(_cB, 0.4);
    const col = '#' + _cA.getHexString();
    for (let k = 0; k < tp.length; k++) {
      if (tp.length === 2 && k === 1) break;   // a two-point loop is one back-and-forth line
      const p = tp[k], q = tp[(k + 1) % tp.length], ddx = q.x - p.x, ddz = q.z - p.z, len = Math.hypot(ddx, ddz);
      if (len < 0.6) continue;
      const ry = Math.atan2(ddx, ddz), ux = ddx / len, uz = ddz / len;
      for (let s = 0.3; s + 0.5 <= len - 0.3 + 1e-6; s += 0.9) parts.push(quadUp(0.12, 0.5, col, p.x + ux * (s + 0.25), 0.035, p.z + uz * (s + 0.25), ry));
    }
    for (const p of tp) if (p.stop) for (let k = 0; k < 14; k++) { const an = (k / 14) * TAU; parts.push(quadUp(0.1, 0.2, col, p.x + Math.cos(an) * 0.8, 0.035, p.z + Math.sin(an) * 0.8, -an)); }
  }
  // gull roost: a post with a perch at GULL_Y (≈3) over a ground nest where stolen food lands (spiral r 0.35 + 0.18 k)
  if (L.roost) {
    const rx = +L.roost.x, rz = +L.roost.z;
    let ng = null;
    try { ng = props.nestGeometry ? props.nestGeometry() : null; } catch (e) { ng = null; }
    const nf = !ng; if (nf) ng = nestFallback();
    parts.push(prep(ng.clone()).scale(1.7, 1.2, 1.7).translate(rx, 0, rz));
    parts.push(tint(new CylinderGeometry(0.085, 0.1, 2.95, 7), '#8A5A33', 0.8, 0).translate(rx, 1.475, rz));
    parts.push(tint(new CylinderGeometry(0.26, 0.2, 0.08, 10), '#A87A47').translate(rx, 2.95, rz));
    if (nf) ng.dispose();
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
  uBC.set(cx, cz); uBH.set(Wd / 2, Dd / 2);
}
/** Crack splats: one merged geometry on the static material, swapped when a stack spills. */
function rebuildSplats() {
  const old = splatMesh.geometry, parts = [];
  for (const s of splats) {
    let g = null;
    try { g = props.splatGeometry ? prep(props.splatGeometry(s.kind).clone()) : null; } catch (e) { g = null; }
    if (!g) g = splatFallback(s.col, mulberry32(s.seed));
    parts.push(g.scale(s.r, 1, s.r).rotateY(s.rot).translate(s.x, s.y, s.z));
  }
  let g = null;
  if (parts.length) { try { g = mergeGeometries(parts, false); } catch (e) { g = null; } }
  for (const p of parts) if (p !== g) p.dispose();
  splatMesh.geometry = g || new PlaneGeometry(0.01, 0.01).rotateX(-PI / 2).translate(0, -60, 0);
  splatMesh.visible = !!g;
  if (old && old !== splatMesh.geometry) old.dispose();
}
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/** Swaps the hero pot skin (props.potGroup body gets the gold-enamel Phong material). */
export function setSkin(id) {
  if (!potRoot) return;
  const skins = props.POT_SKINS || ['sunny'];
  const gild = typeof id === 'string' && id.endsWith('+g');   // Gild: game.js sends 'skin+g' for a gilded pot
  if (gild) id = id.slice(0, -2);
  id = skins.indexOf(id) >= 0 ? id : 'sunny';
  const key = gild ? id + '+g' : id;
  if (key === skin && potG) return;
  if (potG) potRoot.remove(potG);
  let g = null;
  try { g = props.potGroup(id, gild); } catch (e) { g = null; }
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
  potG = g; potRoot.add(g); skin = key;
  if (eyeMat) eyeMat.uniforms.uLidCol.value = sv(LID[id] || LID.sunny);
  rimXray.material.color.set(LID[id] || LID.sunny).lerp(new Color(1, 1, 1), 0.25);
}

// ------------------------------------------------------------------ resize / tier / stats
export function resize(w, h, playRect) {
  // DECISION (11-04, §12.3): in ?og=1 the play rect is the right 54 % panel (pot at its centre, 60 % height),
  // whatever the landscape HUD layout says: the og view has no HUD, only the teal panel on the left.
  cssW = Math.max(1, w | 0 || 1); cssH = Math.max(1, h | 0 || 1);
  if (playRect) play = { ...playRect };
  if (OGP) { const x0 = Math.round(cssW * 0.46); play = { x: x0, y: 0, w: cssW - x0, h: cssH, cx: (x0 + cssW) / 2, cy: cssH * 0.6 }; }
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
  // board is never hazed and the ground beyond it melts into the town's fog colour instead of a muddy band
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
  // DECISION (11-04, record): REC never clamps in depth. Both the far-edge clamp and the near-edge pin left the big
  // pot at the far end (the cake's spot) at ~40 % height, under the centred ORDER UP ticket at 20 s; the video keeps
  // the pot on its anchor (60 %) and lets table show past the far edge instead. x still clamps as in play.
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
  return [lo(b.x0, b.x1, mnx, mxx, gx, 2, false), REC ? gz : lo(b.z0, b.z1, mnz, mxz, gz, 0.6, true)];
}
function springTo(gx, gz, dt) {   // critically damped, ω = 9 (exact step, stable for any dt)
  const w = 9, e = Math.exp(-w * dt);
  for (const [k, v] of [['x', 'vx'], ['z', 'vz']]) {
    const g = k === 'x' ? gx : gz, d0 = cam[k] - g, v0 = cam[v], B = v0 + w * d0;
    cam[k] = g + (d0 + B * dt) * e; cam[v] = (v0 - w * B * dt) * e;
  }
}
function followWv() {
  let wv = (REC ? camWRec : camW)(cam.rCam);
  if (cssW > cssH) wv *= camLand(cssW, cssH);
  return REC ? wv : Math.min(wv, boardCapWv(cam.rCam)) * camViewK(cssW, cssH, LV && LV.n);
}
/**
 * R2: the widest follow view that still leaves the board filling the screen.
 * DECISION (11-06, kid13 "end of L1 is a mostly empty table, sky and trees"): the board stops growing but the pot does
 * not, so past a point the follow width only buys table and sky. The depth the play rect sees at the 55° pitch is linear
 * in the width, so the cap is closed form: (board depth + the clamps' 2.6 u) × 1.15 slack, over that depth per unit of
 * width. The slack keeps a strip of backdrop past the far edge, which reads as a diorama and shows ~15 % more food than
 * an exact fit. Width caps at board + 4 u. The pot just grows in frame (~35–45 % of a portrait screen at the end of a
 * level); CAM_POT_FLOOR stops a tiny Daily or Feast board or a Mega pot from filling the screen.
 */
function boardCapWv(r) {
  const b = BB; if (!b) return Infinity;
  const pt = play.h > 1 ? play.y : 0, pb = play.h > 1 ? play.y + play.h : cssH, p = 55 * D2R, T = Math.tan(20 * D2R);
  const reach = y => Math.sin(p) / Math.tan(Math.max(0.08, p - Math.atan((play.cy - y) / (cssH / 2) * T)));
  const perWv = (reach(pt) - reach(pb)) / (2 * T * (cssW / cssH));
  const cap = Math.min(b.x1 - b.x0 + 4, (b.z1 - b.z0 + CAM_EDGE) * CAM_SLACK / Math.max(0.1, perWv));
  return Math.max(cap, r * CAM_POT_FLOOR);
}
/** Screen px of a floor point, for keepPot and revealFit (placeCamera first). */
const floorPx = (x, z) => { _v.set(x, 0, z).project(camera); return [(_v.x + 1) / 2 * cssW, (1 - _v.y) / 2 * cssH]; };
const playEdges = pad => {
  const ok = play.w > 1 && play.h > 1;
  return ok ? [play.x + pad, play.x + play.w - pad, play.y + pad, play.y + play.h - pad] : [pad, cssW - pad, pad, cssH - pad];
};
/**
 * R6: slide a camera centre until the whole pot sits inside the play rect. The pot beats the board clamp.
 * DECISION (11-06 Fri, round 2, kid13 on L60's walk, sheet-b60-end.png): clampGoal measures the play rect's ground corners and
 * the far ones are the widest, so at the end of a level, with the board filling the view, the near flanks had far less room
 * than the clamp thought. A big pot walking up the right rail hung half off the screen for 5 s. Table past the flank is the
 * smaller loss. A pot bigger than the rect centres in it.
 */
function keepPot(gx, gz, wv, yaw, pitch, ax, ay, pad) {
  placeCamera(gx, gz, wv, yaw, pitch, ax, ay);
  const r = Math.max(0.05, pot.rVis), [px, py] = floorPx(pot.x, pot.z), rx = floorPx(pot.x + r, pot.z)[0] - px, rd = floorPx(pot.x, pot.z + r)[1] - py;
  const [l, R, t, b] = playEdges(pad), up = 1.3 * rd, dn = 1.15 * rd;   // the rim stands up off the floor, the eyes hang over the lip
  if (!(rx > 0.01) || !(rd > 0.01)) return [gx, gz];
  const ox = 2 * rx >= R - l ? (l + R) / 2 - px : px - rx < l ? l - px + rx : px + rx > R ? R - px - rx : 0;
  const oy = up + dn >= b - t ? (t + b + up - dn) / 2 - py : py - up < t ? t - py + up : py + dn > b ? b - py - dn : 0;
  return [gx - ox * r / rx, gz - oy * r / rd];
}
/**
 * R6: the level-start boss shot, framed so pot and boss are both in the play rect. Widens from the boss's own close-up only as
 * far as it has to. DECISION (11-06 Fri, round 2, art director dk_Lv4_a.png): the old shot sat on the boss alone, so a far boss
 * opened on a giant boss and no pot. Runs once per level, on the first frame of the shot.
 */
function revealFit(R, wv0, yaw, pitch, ax, ay) {
  const [l, r, t, b] = playEdges(14), rv = Math.max(0.05, pot.rVis), sp = Math.max(0.3, Math.sin(pitch));
  // The box round both, or null when a point is behind the camera: a close camera on a boss 23 u from the pot has the pot behind
  // it, the projection flips and the centring runs off to millions (seen on L4 at 1440x900, a screenful of sky).
  const measure = () => {
    if (_v.set(pot.x, 0, pot.z).applyMatrix4(camera.matrixWorldInverse).z > -0.1 || _v.set(R.x, 0, R.z).applyMatrix4(camera.matrixWorldInverse).z > -0.1) return null;
    const [px, py] = floorPx(pot.x, pot.z), [bx, by] = floorPx(R.x, R.z), su = floorPx(pot.x + 1, pot.z)[0] - px, sb = floorPx(R.x + 1, R.z)[0] - bx;
    return { su, sb, x0: Math.min(px - rv * su, bx - R.a * sb), x1: Math.max(px + rv * su, bx + R.a * sb),
      y0: Math.min(py - 1.3 * rv * su, by - 1.8 * R.a * sb), y1: Math.max(py + 1.15 * rv * su, by + R.a * sb * sp) };
  };
  const frame = W => {
    let cx = (pot.x + R.x) / 2, cz = (pot.z + R.z) / 2;
    for (let k = 0; k < 6; k++) {
      placeCamera(cx, cz, W, yaw, pitch, ax, ay);
      const m = measure();
      if (!m) return { x: cx, z: cz, wv: W, ok: false };
      const s = Math.max(1e-3, (m.su + m.sb) / 2);
      cx -= ((l + r) / 2 - (m.x0 + m.x1) / 2) / s; cz -= ((t + b) / 2 - (m.y0 + m.y1) / 2) / (s * sp);
    }
    placeCamera(cx, cz, W, yaw, pitch, ax, ay);
    const m = measure();
    return { x: cx, z: cz, wv: W, ok: !!m && m.x1 - m.x0 <= r - l && m.y1 - m.y0 <= b - t && m.x0 >= l - 2 && m.x1 <= r + 2 && m.y0 >= t - 2 && m.y1 <= b + 2 };
  };
  let lo = Math.max(wv0, R.wv), best = frame(lo);
  if (best.ok) return best;
  let hi = lo;
  for (let k = 0; k < 8 && !best.ok; k++) { lo = hi; hi *= 1.5; best = frame(hi); }
  if (!best.ok) return { x: pot.x, z: pot.z, wv: wv0 };   // nothing frames both: skip the wide shot, never open on sky
  for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2, f = frame(m); if (f.ok) { hi = m; best = f; } else lo = m; }
  return best;
}
function updateCamera(dt) {
  // DECISION (11-04, §12.3): og/cover stills follow the pot exactly (no board clamp) and skip every camera ease
  // (radius, pitch, anchor): modes.js paints only the last ~30 of the 1,092 og steps, so an eased camera was caught
  // mid-zoom and 120 px left of the anchor. og zooms to 0.8 × the follow width (the pot spans ~55 % of the panel).
  // Record snaps the anchor too (its play rect never changes; it started 70 px off and eased in over the hook).
  // DECISION (11-04, tail cut 11-07): in record mode the camera pulls straight up 0.15 s after the win, over 0.75 s (it lands before the 18.0 s end card; was 0.3 + 1.1 s before viral r6):
  // pitch 55° → 78° and the view widens until the board's near edge reaches the play-rect bottom (capped at 1.8 ×),
  // with the goal and anchor kept on the pot, so the pot stays below the centred ORDER UP ticket while the board
  // shows eaten bare. Counted in painted frames only. loadLevel / levelStart reset it (the 20.5 s loop).
  // DECISION (11-04): the boss ② glance (35 % of the way to the boss) is scaled down so the pot stays within 70 % of
  // the room between its anchor and the play-rect edge, and the view widens 12 % at the glance peak: on L28 the full
  // 35 % pushed the pot off the bottom of a 390×844 screen for ~0.6 s while the player still steers.
  const land = cssW > cssH;
  if (STILL) cam.rCam = pot.r; else cam.rCam += (pot.r - cam.rCam) * ek(dt, 0.45);
  let wv = followWv() * (OGP ? 0.8 : 1), yawT = 0, pitchT = 55 * D2R, ax = play.cx, ay = play.cy;
  // R1: close on the pot until the first touch, out to the follow width over CAM_OPEN_S. Reads the world, not the 'start' event, so a
  // world that started while this renderer was away (a swap from 2D, a Feast course) still lets go.
  if (openK > 0 && !titleOn) {
    if (openT < 0 && W && W.tStart != null) openT = 0;
    if (openT >= 0) { openT += dt; openK = 1 - inOut(Math.min(1, openT / CAM_OPEN_S)); }
    wv *= lerp(1, openW, openK);
  }
  let pull = 0;
  if (recWinT >= 0 && REC && !STILL && !titleOn) {
    recWinT += dt;
    pull = inOut(clamp((recWinT - 0.15) / 0.75, 0, 1));
    if (pull > 0 && BB) {
      const lowPx = Math.max(80, (play.h > 1 ? play.y + play.h : cssH) - ay), dz = Math.max(1, BB.z1 + 1 - pot.z);
      const fit = cssW * dz * Math.sin(78 * D2R) / lowPx * 1.05;
      pitchT = lerp(pitchT, 78 * D2R, pull); wv = lerp(wv, Math.max(wv, Math.min(fit, wv * 1.8)), pull);
    }
  }
  if (titleOn) {
    titleT += dt;
    cam.yaw += 0.12 * dt; yawT = cam.yaw; pitchT = 48 * D2R; wv = camTitle(cssW, cssH); ay = cssH * 0.5;
  } else {
    cam.yaw += (Math.atan2(Math.sin(-cam.yaw), Math.cos(-cam.yaw))) * ek(dt, 0.35);
    yawT = cam.yaw;
  }
  cam.pitch += (pitchT - cam.pitch) * ek(dt, 0.35);
  cam.ax += (ax - cam.ax) * ek(dt, 0.25); cam.ay += (ay - cam.ay) * ek(dt, 0.25);
  if (Math.abs(cam.ax - ax) > cssW || !(cam.ax > -1e8) || REC) { cam.ax = ax; cam.ay = ay; }
  if (STILL) cam.pitch = pitchT;
  if (punchT > 0) { punchT = Math.max(0, punchT - dt); wv *= 1 + punchA * (1 - (1 - punchT / 0.5) ** 2) * (punchT > 0 ? 1 : 0); }
  if (bossCamT >= 0) {
    bossCamT += dt;
    const t = bossCamT;
    wv *= t < 0.3 ? 1 - bossCamA * sstep(0, 0.3, t) : 1 - bossCamA + bossCamA * sstep(0.3, 0.9, t);
    const amp = t < 0.25 && !calm ? 0.12 * pot.r * (1 - t / 0.25) : 0;
    shakeX = (rnd() * 2 - 1) * amp; shakeZ = (rnd() * 2 - 1) * amp;
    if (t > 0.9) { bossCamT = -1; shakeX = shakeZ = 0; }
  }
  // FIX-LIST-3 R5: L60's lighthouse stands in a far corner, under the HUD from the follow view, and only came on screen with the
  // bite. Over the last 6 u the view frames pot and boss together in the play rect, as tight as both allow. The fit is a search,
  // so it refreshes 4 times a second, on this one level, near this one boss. The finisher takes over from wherever this is.
  const apT = bossNear && !fin && !calm && !titleOn ? 1 - sstep(bossNear.e, bossNear.e + 6, bossNear.d) : 0;
  apK += (apT - apK) * ek(dt, 0.3);
  if (apK < 0.002 && !apT) { apK = 0; apFit = null; }
  else if (bossNear && (apWait -= dt) <= 0) { apWait = 0.25; apFit = revealFit(bossNear, 0.55 * wv, 0, cam.pitch, cam.ax, cam.ay); }
  if (apFit) wv = Math.exp(lerp(Math.log(wv), Math.log(apFit.wv), apK));
  // R7 finisher: punch in until the pot spans FIN_POT of the screen width, at any board or boss size (L40's stall and
  // L60's corner boss are tiny against a late pot, so the shot is framed on the pot and the boss is scaled up to it).
  // DECISION (11-06): the zoom eases in log space so its speed reads even, and the goal drops the board clamp as the zoom
  // lands, or a bite at the board edge would frame the pot off-centre. Record, og and cover never set fin.
  // DECISION (11-06): zoom and pitch ease back, but goal and anchor stay on the pot (holdK) until the next level. With the
  // board clamp back a far-edge pot rose behind the ORDER UP band for the 2 s before the card (L21 at 820x1180).
  let finK = 0, holdK = finHold ? 1 : 0;
  if (fin) {
    fin.t += dt;
    const t = fin.t, B = fin.B, big = B === FIN_BIG;
    if (!fin.boom && t >= B.boom) { fin.boom = true; finBoom(big); }
    finK = calm ? 0 : sstep(0, B.push, t) * (1 - sstep(B.back, B.end, t));   // reduced motion: the camera stays put, the boss still goes in
    holdK = sstep(0, B.push, t);
    wv *= Math.exp(finK * Math.log(Math.min(1, 2 * pot.rVis * Math.max(1 / FIN_POT, cssW / cssH / 0.62) / wv)));
    // Milestones creep in a little more through the held frame, and the pot rumbles as it strains on the boss.
    if (big && !calm) wv *= 1 - 0.08 * sstep(B.sink, B.hold, t) * (1 - sstep(B.boom, B.back, t));
    const hold = big && t >= B.sink * 0.8 && t < B.boom ? 0.18 + 0.3 * sstep(B.sink, B.boom, t) : 0;
    const pk = Math.max(hold, t < 0.2 ? 0.45 * (1 - t / 0.2) : t >= B.boom && t < B.boom + 0.4 ? (big ? 1.5 : 1) * (1 - (t - B.boom) / 0.4) : 0);
    const amp = calm ? 0 : 0.022 * wv * pk;
    shakeX = (rnd() * 2 - 1) * amp; shakeZ = (rnd() * 2 - 1) * amp;
    if (t > B.end) { fin = null; finHold = true; shakeX = shakeZ = 0; }
  }
  let fx0 = pot.x, fz0 = pot.z;
  if (glance && !titleOn) {   // two-course boss ② glance: 35 % toward the boss and back over 1.2 s (pot kept in view)
    glance.t += dt;
    const k = glance.t >= 1.2 ? 0 : Math.sin(PI * glance.t / 1.2);
    wv *= 1 + 0.12 * k;
    const dx = (glance.x - pot.x) * 0.35, dz = (glance.z - pot.z) * 0.35, pxu = cssW / wv, sp = Math.max(0.3, Math.sin(cam.pitch));
    const pb = play.h > 1 ? play.y + play.h : cssH, pt = play.h > 1 ? play.y : 0, pl = play.w > 1 ? play.x : 0, pr = play.w > 1 ? play.x + play.w : cssW;
    const roomX = 0.7 * Math.max(40, Math.min(cam.ax - pl, pr - cam.ax)) / pxu;
    const roomZ = 0.7 * Math.max(40, dz < 0 ? pb - cam.ay : cam.ay - pt) / (pxu * sp);
    const s = Math.min(1, roomX / Math.max(1e-3, Math.abs(dx)), roomZ / Math.max(1e-3, Math.abs(dz)));
    fx0 += dx * s * k; fz0 += dz * s * k;
    if (glance.t >= 1.2) glance = null;
  }
  cam.wv = wv;
  // The finisher looks down into the pot (a round stew reads better than an ellipse) and sits it low, under the centred
  // ORDER UP band that ui.js stamps on the final bite.
  // The 72 % anchor is capped so the face (eyes on the near rim) stays in frame: on wide screens the pot fills 62 % of the
  // height and a fixed anchor put the eyes past the bottom edge. The cap reads the live zoom, so it relaxes as the shot pulls back.
  const pitch = finK > 0 ? lerp(cam.pitch, 68 * D2R, finK) : cam.pitch;
  const anY = holdK > 0 ? lerp(cam.ay, Math.min(cssH * 0.72, cssH - 6 - 1.25 * Math.sin(pitch) * pot.rVis * cssW / wv), holdK) : cam.ay;
  let [gx, gz] = titleOn ? (BB ? [(BB.x0 + BB.x1) / 2, (BB.z0 + BB.z1) / 2] : [pot.x, pot.z])
    : STILL ? [fx0, fz0] : clampGoal(fx0, fz0, wv, yawT, pitch, cam.ax, anY);
  if (apFit) { gx = lerp(gx, apFit.x, apK); gz = lerp(gz, apFit.z, apK); }
  const keep = !titleOn && !STILL && !REC && holdK <= 0;   // the finisher frames the pot itself
  if (keep) [gx, gz] = keepPot(gx, gz, wv, yawT, pitch, cam.ax, anY, 12);
  if (holdK > 0) { gx = lerp(gx, pot.x, holdK); gz = lerp(gz, pot.z, holdK); if (finK > 0) { cam.x = lerp(cam.x, gx, finK * 0.35); cam.z = lerp(cam.z, gz, finK * 0.35); } }
  if (reveal) {
    reveal.t += dt;
    const t = reveal.t;
    if (t >= 1.3) reveal = null;
    else {
      cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0;
      if (!reveal.fit) { cam.ax = ax; cam.ay = ay; reveal.fit = revealFit(reveal, wv, yawT, cam.pitch, ax, ay); }   // the anchor still springs from the title: a fit on it slides off
      const F = reveal.fit;
      // The zoom eases in log space and the centre tracks it, so the pot's offset from its anchor only ever shrinks: a plain
      // lerp of both swung a far pot out of frame halfway down the glide.
      const e = t < 0.7 ? 0 : inOut((t - 0.7) / 0.6), Wv = Math.exp(lerp(Math.log(F.wv), Math.log(wv), e)), k = (1 - e) * Wv / F.wv;
      // Perspective swells the near pot faster than the zoom, so keepPot has the last word on the way down.
      const [rx, rz] = e > 0 ? keepPot(gx + (F.x - gx) * k, gz + (F.z - gz) * k, Wv, yawT, cam.pitch, cam.ax, cam.ay, 12) : [F.x, F.z];
      placeCamera(rx, rz, Wv, yawT, cam.pitch, cam.ax, cam.ay);
      return;
    }
  }
  // 11-07 (viral r5): frame 0 of the clip had the camera still springing in, with the pot hidden under the hook caption.
  if (titleOn || STILL || recSnap) { cam.x = gx; cam.z = gz; cam.vx = cam.vz = 0; recSnap = false; } else springTo(gx, gz, dt);
  if (keep) [cam.x, cam.z] = keepPot(cam.x, cam.z, wv, yawT, pitch, cam.ax, anY, 3);   // the spring lags a pot at full speed
  placeCamera(cam.x + shakeX, cam.z + shakeZ, wv, yawT, pitch, cam.ax, anY);
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
  Object.assign(mood, { biteT: 0, biteK: 1, flash: 0, sizeT: 0, happyT: 0, wideT: 0, squintT: 0, celebrateT: -1, sad: false, worried: false,
    blinkIn: 2 + rnd() * 2, blinkT: -1, sqzT: 0, lid: 0, happy: 0, wide: 0, worry: 0, droop: 0, squeeze: 0, dim: 1, sink: 0, tilt: 0, shockT: -1 });
  rattleT.fill(0); wobT.fill(0); popT.fill(0);
}
function itemXZ(i) { return W && i >= 0 && i < W.n ? [W.ix[i], W.iz[i]] : [pot.x, pot.z]; }
function rimPoint(k = 0) {   // a point on the front rim (toward the camera)
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  return [pot.x + fx * pot.rVis * 0.95 + fz * k * pot.rVis * 0.3, 0.08 * pot.rVis + 0.03, pot.z + fz * pot.rVis * 0.95 - fx * k * pot.rVis * 0.3];
}
function flash(a) { flashA = Math.max(flashA, calm ? a * 0.35 : a); }
/** R7: the boss is down. Gulp, burst of confetti and sparkles out of the pot, big flash; sized by the punched-in view. */
function celebrate() {
  mood.celebrateT = 0; mood.happyT = 1.6; mood.worried = false;
  spawn(pot.x, 0.3 + pot.rVis * 0.3, pot.z, 0, 1.0, 0, 1.3, Math.max(0.16, 0.35 * pot.rVis), '#FF6F8E', 3, -0.2, 0.6);
  sparkleRing(10, '#FFE27A', 2.2);
}
function finBoom(big = false) {
  const rv = pot.rVis, vu = 2 * rv / FIN_POT, M = mood, y = 0.25 * rv + potLift;
  flash(big ? 0.85 : 0.62);
  M.biteT = 0.18; M.biteK = big ? 2.1 : 1.6; M.sizeT = 0.2; M.flash = 1; M.shockT = 0; M.happyT = 2;
  // Confetti fountains from the whole stew and flies past the screen edges (shape 1 has 2.2/s of drag, so reach = speed / 2.2).
  const cols = ['#FFD34D', '#E5483B', '#4CC26A', '#FFF6E6', '#4FA8E8', '#FF7FB0'], n = (tier === 'low' ? 70 : 120) * (big ? 1.5 : 1);
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, rr = rv * (0.25 + 0.7 * rnd()), sp = vu * (0.9 + 1.7 * rnd());
    spawn(pot.x + Math.cos(a) * rr, y, pot.z + Math.sin(a) * rr, Math.cos(a) * sp, vu * (1.2 + 1.3 * rnd()), Math.sin(a) * sp, 1.2 + 0.7 * rnd(), 0.05 * vu * (0.7 + 0.6 * rnd()), cols[k % cols.length], 1, 1.2 * vu);
  }
  burst(pot.x, y, pot.z, tier === 'low' ? 14 : 28, ['#FFE27A', '#FFF3C4'], { speed: 0.7 * vu, up: 0.9 * vu, size: 0.08 * vu, shape: 2, grav: 0.6 * vu, life: 0.9 });
  sparkleRing(big ? 22 : 14, '#FFE27A', (big ? 0.7 : 0.5) * vu);
  if (big) bossRing = { t: 0, x: pot.x, z: pot.z, R: 1.5 * rv };
  if (fin && fin.win) celebrate();
}
/**
 * FIX-LIST-3 R6: L60's fireworks. Shells are placed by screen position on a plane between camera and pot, so they sit in the sky of
 * the shot at any aspect, and sized off that plane's smaller screen side. They use the particle pool and run on their own clock, so
 * they carry on behind the card. Low tier: 4 shells, half the sparks, no rocket trails. Reduced motion: 2 quiet shells, no rockets.
 */
function fwStart() {
  let S = LV ? FIREWORKS(LV.n) : null;
  if (!S) return;
  if (calm) S = [S[1], S[3]]; else if (tier === 'low') S = S.slice(0, 4);
  fw = { t: 0, n: calm ? 14 : tier === 'low' ? 18 : 28, s: S.map(o => ({ ...o, done: false })) };
}
function fwAt(nx, ny) {
  const cp = camera.position, d = 0.62 * Math.hypot(pot.x - cp.x, cp.y, pot.z - cp.z);
  _v.set(nx, ny, 0.5).unproject(camera).sub(cp).normalize();
  return [cp.x + _v.x * d, cp.y + _v.y * d, cp.z + _v.z * d, 2 * d * Math.tan(camera.fov * D2R / 2) * Math.min(1, cssW / cssH)];
}
function updateFireworks(dt) {
  fw.t += dt;
  let left = 0;
  for (const S of fw.s) {
    if (S.done) continue;
    left++;
    if (fw.t >= S.at) {
      S.done = true;
      // The shot pulls back through the show and sparks stay put in the world, so a shell fired in the close-up is scaled for the wide view.
      const [x, y, z, u0] = fwAt(S.x, S.y), u = u0 * clamp(followWv() / Math.max(1e-3, cam.wv), 1, 3), C = FIREWORK_COLS[S.c], sp = (calm ? 0.22 : 0.42) * u;
      for (let k = 0; k < fw.n; k++) {
        const a = rnd() * TAU, e = rnd() * 2 - 1, q = Math.sqrt(1 - e * e), v = sp * (0.72 + 0.28 * rnd());
        spawn(x, y, z, Math.cos(a) * q * v, e * v, Math.sin(a) * q * v, 0.95 + 0.35 * rnd(), 0.06 * u * (0.8 + 0.4 * rnd()), C[k % 3 ? 0 : 1], 2, 0.2 * u);
      }
      if (!calm) { spawn(x, y, z, 0, 0, 0, 0.24, 0.2 * u, '#FFF6E0', 2, 0); flash(0.08); }
    } else if (!calm && tier !== 'low' && S.rise > 0 && fw.t >= S.at - S.rise) {
      const k = 1 - (S.at - fw.t) / S.rise, [x, y, z, u] = fwAt(S.x * (0.7 + 0.3 * k), lerp(-0.2, S.y, k * (2 - k)));
      spawn(x, y, z, 0, -0.05 * u, 0, 0.26, 0.03 * u, FIREWORK_COLS[S.c][1], 2, 0.1 * u);
    }
  }
  if (!left) fw = null;
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
  // DECISION (11-04): Sim sends some beats under two names (courseDone+course, tier+cakeTier, gull+gullWarn);
  // both map to one canonical name and fire once per frame per item (evSeen clears at the start of update).
  const cn = EV_ALIAS[ev] || (ALIASED.has(ev) ? ev : null);
  if (cn) { const key = cn + ':' + (d.i ?? ''); if (evSeen.has(key)) return; evSeen.add(key); ev = cn; }
  switch (ev) {
    case 'bite': {
      // DECISION (11-05, art lane): the bite has to read at phone size. The squash deepens with the chain and the food's
      //   size, and the stew flashes, so a run of bites looks like a run instead of the same small nod.
      const cn = d.n | 0;
      mood.biteT = 0.18; mood.sqzT = 0.1; mood.biteK = 1 + 0.5 * Math.min(1, cn / 8) + 0.1 * Math.min(4, d.tier | 0);
      mood.flash = Math.min(1, 0.6 + 0.08 * cn);
      const [x, z] = itemXZ(d.i); const dx = x - pot.x, dz = z - pot.z, L = Math.hypot(dx, dz) || 1;
      mood.biteDx = dx / L; mood.biteDz = dz / L;
      if (d.ing) sparkleRing(5, '#FFF3C4', 1.1);
      else if (cn >= 3) sparkleRing(Math.min(6, cn - 1), '#FFE27A', 1.1);
      break;
    }
    case 'sizeUp': {
      mood.sizeT = 0.2; mood.happyT = Math.max(mood.happyT, 0.4);
      sparkleRing(BIG_STEPS.has(d.step | 0) ? 14 : 7, '#FFE27A', 1.8);
      if (BIG_STEPS.has(d.step | 0)) { punchT = 0.5; punchA = 0.08; mood.shockT = 0; }
      break;
    }
    case 'padlock': {
      mood.wideT = 0.9; drool();
      const [x, z] = itemXZ(d.i);
      const h = W && d.i >= 0 ? itemTop(d.i) : 1;
      burst(x, h + 0.3, z, 18, ['#FFD34D', '#FFF3C4', '#F5B323'], { speed: 1.6, up: 2.4, size: 0.1, shape: 2, grav: 3 });
      if (d.i >= 0 && d.i < ITEM_MAX) { popT[d.i] = 0.25; bossRing = { t: 0, x, z, R: 1.5 * (W ? W.ia[d.i] : 1) }; }   // R4: the unlock lands
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
      const [x, z] = itemXZ(d.i);
      // DECISION (11-06, R7): record, og and cover keep their tuned beat (§12.2 times the video to it). In play the final
      // bite runs the finisher; any other boss bite gets the small version: twice the zoom dip and a soft flash.
      if (!REC && d.final) {
        const B = LV && isMilestone(LV.n) ? FIN_BIG : FIN_BEAT;
        fin = { t: 0, i: d.i, boom: false, B, ang: Math.atan2(x - pot.x, z - pot.z) }; glance = null; flash(0.28); mood.wideT = B.boom;
        fwStart();
      }
      else { bossCamT = 0; mood.wideT = 0.8; bossCamA = REC ? 0.1 : 0.2; if (!REC) flash(0.2); }
      const m = REC ? 1 : Math.max(1, 0.6 * pot.rVis);   // late pots: confetti that still reads against the big view
      burst(x, 0.4 + pot.rVis * 0.5, z, 70, ['#FFD34D', '#E5483B', '#4CC26A', '#FFF6E6'], { speed: 2.6 * m, up: 4.2 * m, size: 0.11 * m, shape: 1, grav: 5 * m, life: 1.6 });
      break;
    }
    case 'win': {
      // The sim wins ~1.34 s after the bite, in the middle of a milestone's held frame: the party waits for the gulp.
      if (fin && !fin.boom) { fin.win = true; mood.worried = false; if (REC && !STILL) recWinT = 0; break; }
      if (REC && !STILL) recWinT = 0;
      celebrate();
      break;
    }
    case 'fail': mood.sad = true; mood.worried = false; break;
    case 'lowTime': mood.worried = true; break;
    case 'refuse': case 'shove': {
      // DECISION (11-04, §4.5 Simmer): the lid hat appears on the pot the first time a refusal happens on a capped
      // level and jiggles on every later refusal / shove.
      mood.squintT = 0.3;
      if (W && W.cap > 0 && !lid.on) { lid.on = true; lid.pop = 0.3; }
      if (lid.on) lid.jig = 0.35;
      break;
    }
    case 'hot': {
      // R7: the pot bit a chili. Squint, red flush, and steam jets out of the top. Sized off the view, like the crumbs.
      mood.squintT = 0.5; mood.tilt = 0; hotT = 0.75;
      const vu = (REC ? camWRec : camW)(pot.rVis);
      burst(pot.x, 0.1 + potLift + 0.4 * pot.rVis, pot.z, 12, ['#FFFFFF', '#FFE3D2'], { speed: 0.07 * vu, up: 0.32 * vu, size: 0.05 * vu, shape: 4, grav: -0.08 * vu, grow: 1.6, life: 0.85, a: 0.7 });
      burst(pot.x, 0.1 + potLift + 0.2 * pot.rVis, pot.z, 8, ['#FF5A1F', '#FFB02E'], { speed: 0.12 * vu, up: 0.25 * vu, size: 0.016 * vu, shape: 0, grav: 0.5 * vu, life: 0.5 });
      break;
    }
    case 'boil':
      mood.squintT = 0.3; if (lid.on) lid.jig = 0.35;
      burst(pot.x, 0.1 + potLift, pot.z, 6, '#FFFFFF', { speed: 0.3, up: 1.2, size: 0.12 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.4, grow: 1.5, life: 0.9, a: 0.6 });
      break;
    case 'crack': {
      const i = d.i;
      if (W && i >= 0 && i < W.n) startCrack(i);
      const [x, z] = itemXZ(i), id = W && i >= 0 && W.kindNames ? W.kindNames[W.kind[i]] : '';
      burst(x, 0.15, z, 12, ['#FFF6E6', SPLAT[id] || '#FFE14D', '#F4A493'], { speed: 1.2, up: 1.6, size: 0.06, shape: 0, life: 0.7 });
      break;
    }
    case 'wobble': if (d.i >= 0 && d.i < ITEM_MAX) wobT[d.i] = 0.4; break;
    case 'sizzle': sparkleRing(8, '#FFB347', 1.6); burst(pot.x, 0.1, pot.z, 4, '#FFFFFF', { speed: 0.2, up: 1.0, size: 0.1 * Math.max(0.6, pot.rVis), shape: 4, grav: -0.5, grow: 1.6, life: 1.0, a: 0.55 }); break;
    case 'chain': {   // every fifth bite in a chain: a full ring and a small camera nudge (a big size up punches 0.08)
      sparkleRing(12, (d.n | 0) >= 10 ? '#FFB347' : '#FFE27A', 1.5);
      if (punchT <= 0) { punchT = 0.5; punchA = 0.03; }
      break;
    }
    case 'start': if (reveal) reveal.t = Math.max(reveal.t, 0.7); break;   // straight into the glide: a cut from the wide shot jars
    case 'levelStart': {
      resetMood();
      lid.on = false; lid.pop = lid.jig = lid.steamT = 0; glance = null; bossRing = null; recWinT = -1; fin = null; finHold = false; flashA = 0; fw = null;
      const w = d.w || W, n = LV && LV.n;
      openT = -1; openK = !d.retry && !REC && !OGP && !STILL && !calm ? 1 : 0; openW = camOpenW(n); recSnap = REC && !STILL;
      // L1 opens on the pot, not on a boss the new player has no use for yet (FIX-LIST-3 R1).
      // 11-07 (viral r5): no boss reveal in a record run. Its wide frame was the clip's first frame (the pot a speck) and it cut in 0.3 s later.
      if (!d.retry && n !== 1 && !REC && w && w.tickets && w.tickets.length) {
        const b = w.tickets[w.ti | 0] && w.tickets[w.ti | 0].boss;
        if (b >= 0 && b < w.n) {
          const a = w.ia[b];
          reveal = { t: 0, x: w.ix[b], z: w.iz[b], a, wv: (2.2 * a) / 0.6, fit: null };
        }
      }
      break;
    }
    case 'course': {
      // DECISION (11-04): two-course boss ② reveal = a pop, a shock ring on the boss and a 1.2 s camera glance
      // (35 % of the way toward it and back); no input lock. A Feast course end (no new boss) does nothing here.
      const w = W;
      if (!w || !w.tickets) break;
      const tk = w.tickets[w.ti | 0], b = tk ? tk.boss : -1;
      if (b >= 0 && b < w.n && w.st[b] === 0) {
        const x = w.ix[b], z = w.iz[b], a = w.ia[b];
        popT[b] = 0.25; bossRing = { t: 0, x, z, R: 1.3 * a }; glance = { t: 0, x, z };
        burst(x, (itemCat ? itemTop(b) : 1) + 0.2, z, 18, ['#FFE27A', '#FFF3C4', '#F5B323'], { speed: 1.5, up: 2.4, size: 0.1, shape: 2, grav: 3 });
      }
      break;
    }
    case 'cakeTier': {
      const i = d.i;
      if (i >= 0 && i < ITEM_MAX) popT[i] = 0.25;
      const [x, z] = itemXZ(i);
      if (!REC) { bossCamT = 0; bossCamA = 0.14; flash(0.16); }   // R7 small version; the record course's cake keeps its beat
      burst(x, Math.max(0.4, cakeH * 0.8), z, 22, ['#FFF6E3', '#FF9EC4', '#FFFFFF', '#FFB3C7'], { speed: 1.7, up: 2.6, size: 0.08, shape: 0, life: 0.8 });
      break;
    }
    case 'truckHorn': {
      truckSq = 0.3;
      const i = d.i >= 0 ? d.i : W && W.truck ? W.truck.i : -1;
      if (W && i >= 0 && i < W.n) {
        const a = W.ia[i], bx = W.ix[i] - Math.sin(truckYaw) * a * 0.95, bz = W.iz[i] - Math.cos(truckYaw) * a * 0.95;
        burst(bx, 0.18, bz, 5, '#E9E4DA', { speed: 0.4, up: 0.6, size: 0.14, shape: 4, grav: -0.4, grow: 1.6, life: 0.7, a: 0.7 });
      }
      break;
    }
    case 'steal': {
      const G = W && W.gulls && W.gulls[d.g | 0];
      if (G) burst(G.x, G.y, G.z, 9, ['#FFFFFF', '#E6ECF2', '#C9D3E0'], { speed: 1.0, up: 0.8, size: 0.07, shape: 1, grav: 1.2, life: 1.0 });
      break;
    }
    case 'nest': {
      if (d.i >= 0 && d.i < ITEM_MAX) popT[d.i] = 0.25;
      const [x, z] = itemXZ(d.i);
      burst(x, 0.12, z, 8, ['#C8A15A', '#A87A47', '#E3C27A'], { speed: 0.8, up: 1.2, size: 0.05, shape: 1, grav: 5, life: 0.6 });
      break;
    }
    case 'gullMiss': {
      const G = W && W.gulls && W.gulls[d.g | 0];
      if (G) burst(G.x, G.y, G.z, 6, '#FFF3C4', { speed: 0.8, up: 1.0, size: 0.08, shape: 2, grav: 2, life: 0.5 });
      break;
    }
    case 'feastWipe': wipeT = 0; break;
    case 'spawn':
      if (d.i >= 0 && d.i < ITEM_MAX) {
        popT[d.i] = 0.25;
        const [x, z] = itemXZ(d.i);
        burst(x, 0.1, z, 4, '#FFFFFF', { speed: 0.3, up: 0.9, size: 0.12, shape: 4, grav: -0.4, grow: 1.4, life: 0.6, a: 0.55 });
      }
      break;
    default: break;
  }
}

// ------------------------------------------------------------------ per-frame update
function catOf(w, i, it) {
  const id = w.kindNames ? w.kindNames[w.kind[i]] : undefined;
  if (id !== undefined && KIND_ID[id] !== undefined) return KIND_ID[id];
  return it && KIND_ID[it.kind] !== undefined ? KIND_ID[it.kind] : -1;
}
function bindWorld(w) {
  W = w;
  const n = Math.min(w.n | 0, ITEM_MAX);
  itemCat = new Int16Array(n); itemRot = new Float32Array(n); prevSt = new Uint8Array(n); prevHid = new Uint8Array(n); prevKind = new Int16Array(n);
  const items = (w.level && w.level.items) || (LV && LV.items) || [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    itemCat[i] = catOf(w, i, it);
    itemRot[i] = it && typeof it.rot === 'number' ? it.rot : 0;
    prevSt[i] = w.st[i]; prevHid[i] = w.hid ? w.hid[i] : 0; prevKind[i] = w.kind[i];
    eGlow[i] = 0; eOcc[i] = 1; rollA[i] = 0; rollH[i] = itemRot[i]; rollQ.fill(0, i * 4, i * 4 + 3); rollQ[i * 4 + 3] = 1; lastX[i] = w.ix[i]; lastZ[i] = w.iz[i];
    prevCrack[i] = w.cracked && w.cracked[i] ? 1 : 0; crackT[i] = 0;
  }
  const set = new Set(used);
  for (let i = 0; i < n; i++) {
    if (itemCat[i] >= 0 && kindMesh[itemCat[i]]) set.add(itemCat[i]);
    const so = w.stackOf && w.stackOf[i];
    if (so) for (const k of so) { const c = KIND_ID[k]; if (c !== undefined && kindMesh[c]) set.add(c); }
  }
  used = [...set];
  truckYaw = w.truck && w.truck.i >= 0 ? +w.truck.ang || 0 : 0;
  gOn.fill(0); cakeKey = '';
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

// ---- twist helpers: crack spill, splats, the wedding cake build
const crDx = new Float32Array(ITEM_MAX), crDz = new Float32Array(ITEM_MAX);
const CRACK_T = 0.45, SPLAT_MAX = 12, CAKE_BODY = 0.62;   // CAKE_BODY: bossTierGeometry body cylinder height per unit a
function startCrack(i) {
  if (!W || i < 0 || i >= ITEM_MAX || prevCrack[i]) return;
  prevCrack[i] = 1; crackT[i] = CRACK_T;
  const dx = W.ix[i] - pot.x, dz = W.iz[i] - pot.z, L = Math.hypot(dx, dz) || 1;
  crDx[i] = dx / L; crDz[i] = dz / L;
}
function addSplat(i, x, z) {
  // DECISION (11-04): a cracked stack leaves a splat in its spill colour 1.1 a past the stack (away from the pot),
  // radius 0.6 a, merged into one static-material mesh (one extra draw only while splats exist; max 12, oldest out).
  const id = W && W.kindNames ? W.kindNames[W.kind[i]] : '', a = W ? W.ia[i] : 0.5;
  if (splats.length >= SPLAT_MAX) splats.shift();
  splats.push({ x: x + crDx[i] * a * 1.1, y: 0.038, z: z + crDz[i] * a * 1.1, r: 0.6 * a, col: SPLAT[id] || '#FFF6E3', seed: hs32(id + ':' + i + ':' + splats.length), rot: rnd() * TAU, kind: id });
  rebuildSplats();
}
function cakeBuild(Ck, key) {
  // DECISION (11-04, L53): the cake is drawn from Art's per-tier geometry, not the 3-tier kind mesh: the remaining
  // tiers stack bottom-up (tiers[k] scale, each sits on the body of the one below), the lower ones merged into
  // cakeRest, the current (edible) top tier alone in cakeTop so it can glow. Rebuilt only when a tier is eaten.
  cakeKey = key;
  const n = Ck.n, rest = [];
  let y = 0, top = null;
  for (let k = n - 1; k >= Ck.tier; k--) {
    const t = n === 1 ? 0 : Math.round((k * 2) / (n - 1)), src = props.bossTierGeometry('boss-weddingcake', t), ak = +Ck.tiers[k] || 1;
    const hh = (src.userData && src.userData.h) || 0.7;
    const g = prep(src.clone()).scale(ak, ak, ak).translate(0, y, 0);
    if (k === Ck.tier) { top = g; cakeH = y + hh * ak; } else rest.push(g);
    y += Math.min(hh, CAKE_BODY) * ak;
  }
  let rg = null;
  if (rest.length) { try { rg = mergeGeometries(rest, false); } catch (e) { rg = null; } }
  for (const g of rest) if (g !== rg) g.dispose();
  swapCake(cakeRest, rg); swapCake(cakeTop, top);
}
function swapCake(m, g) {
  if (!g) { m.userData.empty = true; return; }
  g.deleteAttribute('uv'); g.setAttribute('aFx', m.userData.fx);
  const old = m.geometry;
  m.geometry = g; m.userData.empty = false;
  if (old && old !== g) { old.deleteAttribute('aFx'); old.dispose(); }   // keep the boot-created instanced aFx alive
}
function cakePut(m, x, y, z, S, occ, glow, bossGlow) {
  if (m.userData.empty) { m.count = 0; m.visible = false; return; }
  _p.set(x, y, z); _s.set(S, S, S); _m.compose(_p, _q, _s); _m.toArray(m.instanceMatrix.array, 0);
  const f = m.userData.fx.array; f[0] = glow; f[1] = occ; f[2] = bossGlow; f[3] = 0;
  m.count = 1; m.visible = true; m.instanceMatrix.needsUpdate = true; m.userData.fx.needsUpdate = true;
}

/** Interpolates and writes every instance for this frame. Safe with w = null (title without a world). */
export function update(w, dt, alpha = 1) {
  // DECISION: the title backdrop (GDD §9 "live three scene, slow orbit") needs food on the board even when the
  // caller passes no world: build an untouched world of the loaded level once (typed arrays only, no GPU objects).
  // DECISION: the boost uses each item's own apparent size (perspective depth vs the pot's), and T0 aims at
  // 12 px diameter (GDD minimum 10 px) because Art's contact scene showed T0 too small at r0 on 390×844.
  // DECISION (11-04, twists): belt riders and the pot on a belt sit BELT_TOP up; a gull carries its item under
  // its feet; nest items sit in the bowl; the truck turns smoothly to w.truck.ang and squashes on its horn;
  // fragile pieces shiver every 2.5 s (a 0.5 s, 0.05 rad tremble) and stack contents ride their slots, falling
  // off away from the pot over 0.45 s when the stack cracks. Gulls are one instanced mesh (≤ 4) with a fading
  // blob shadow and the growing 1.6 s telegraph under the target.
  // DECISION (11-04, Art relay): rolling kinds pivot about their centre (h / 2), not their base, and roll by
  // distance / that radius. Balls (apple, orange, coconut) keep an accumulated orientation per item, so a turn
  // never snaps them; the cheesewheel (WHEELS) yaws to its roll heading (≤ 90° turn, either way) and spins about
  // its axle (local x), so it rolls like a wheel.
  // DECISION (11-04): an item that jumps > 0.8 u in one step (belt wrap, Feast respawn) snaps instead of sliding
  // across the board in the interpolated frames, and its roll does not count the jump.
  if (!renderer) return;
  evSeen.clear();
  dt = clamp(+dt || 0, 0, 0.1);
  alpha = clamp(+alpha || 0, 0, 1);
  const slow = fin ? finSlow(fin.B, fin.t) : 1;   // R5: the held frame's slow-mo, for everything on the render clock
  time += dt * slow; U.time.value = time;
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
  let lift = 0;
  if (w && w.belts) for (const b of w.belts) {
    const dx = pot.x - b.x, dz = pot.z - b.z, c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    if (Math.abs(dx * c - dz * s) < b.w / 2 && Math.abs(dx * s + dz * c) < b.d / 2) { lift = BELT_TOP; break; }
  }
  potLift += (lift - potLift) * ek(dt, 0.06);
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
  const decArr = decMesh.instanceMatrix.array, decM = decA.array;
  const bP = bbP.array, bM = bbM.array;
  let look = null, lookPri = -1, lookD = 1e9;
  bossNear = null;
  for (const m of [cakeRest, cakeTop]) { m.count = 0; m.visible = false; }
  truckSq = Math.max(0, truckSq - dt);
  if (w && itemCat) {
    const n = itemCat.length, st = w.st, tp = w.tp, ix = w.ix, iz = w.iz, ipx = w.ipx, ipz = w.ipz, ia = w.ia;
    const fl8 = w.flags, glow = w.glow, hid = w.hid, Gs = w.gulls || [];
    const TR = w.truck, trI = TR && TR.i >= 0 ? TR.i : -1;
    if (trI >= 0) { const d = Math.atan2(Math.sin(TR.ang - truckYaw), Math.cos(TR.ang - truckYaw)); truckYaw += d * ek(dt, 0.12); }
    const Ck = w.cake, ckI = Ck && Ck.i >= 0 && Ck.n > 0 && props.bossTierGeometry ? Ck.i : -1;
    const eyeY = 0.12 * rv, mile = !!LV && isMilestone(LV.n);
    const lastBoss = !REC && !!LV && LV.n === 60 && (!w.tickets || (w.ti | 0) >= w.tickets.length - 1);
    for (let i = 0; i < n; i++) {
      if (prevKind[i] !== w.kind[i]) {   // Feast respawn: spawnItem rewrote this slot's kind
        prevKind[i] = w.kind[i];
        const nc = catOf(w, i, null);
        itemCat[i] = nc; rollA[i] = 0; rollQ.fill(0, i * 4, i * 4 + 3); rollQ[i * 4 + 3] = 1; eGlow[i] = 0; lastX[i] = ix[i]; lastZ[i] = iz[i]; prevCrack[i] = 0; crackT[i] = 0;
        if (nc >= 0 && kindMesh[nc] && used.indexOf(nc) < 0) { used.push(nc); kindCnt[nc] = 0; }
      }
      const s = st[i], finI = !!fin && fin.i === i && (s === 1 || (s === 2 && !fin.boom));   // a milestone's boss outlives its sim tip
      if (s === 2 && !finI) {
        if (prevSt[i] === 1) {   // swallowed: crumbs fly out of the stew in the kind colour
          const K = KINDS[itemCat[i]] || null, tierN = K ? K.tier | 0 : 0;
          // DECISION (11-05, art lane): sized by the view, not the pot, so a crumb is ~6 px on a phone at L1 and at L60.
          const vu = (REC ? camWRec : camW)(rv);
          burst(pot.x, 0.05 + potLift, pot.z, Math.min(16, 6 + 2 * tierN), [K ? K.color : '#FFD36E', '#FFD36E', '#FF8A2A'], { speed: 0.13 * vu, up: 0.42 * vu, size: 0.017 * vu * (1 + 0.15 * tierN), grav: vu, life: 0.6 });
        }
        prevSt[i] = 2; continue;
      }
      if (s === 2) prevSt[i] = 1;   // held past its tip: the crumbs still fly when the finisher lets go of it
      const hd = hid ? hid[i] : 0;
      if (hd) { prevHid[i] = 1; continue; }
      if (prevHid[i]) { prevHid[i] = 0; popT[i] = 0.25; }
      if (s !== 2) prevSt[i] = s;
      const c = itemCat[i], m = c >= 0 ? kindMesh[c] : null;
      if (!m) continue;
      const ud = m.userData, K = ud.K, isCake = i === ckI;
      let x = ipx[i] + (ix[i] - ipx[i]) * alpha, z = ipz[i] + (iz[i] - ipz[i]) * alpha;
      if (Math.abs(ix[i] - ipx[i]) + Math.abs(iz[i] - ipz[i]) > 0.8) { x = ix[i]; z = iz[i]; lastX[i] = x; lastZ[i] = z; }   // belt wrap / respawn: no smear
      const a = ia[i], dx = pot.x - x, dz = pot.z - z, dist = Math.hypot(dx, dz);
      const boss = fl8[i] & F_BOSS, ing = fl8[i] & F_ING, open = glow[i] > 0, belt = fl8[i] & F_BELT;
      // readability boost (render only, §7.4)
      const dI = Math.max(0.1, (x - cp.x) * fwx - cp.y * fwy + (z - cp.z) * fwz);
      const app = a * ppu * (dPot / dI);
      const vis = foodVis(K);
      let boost = 1;
      if ((ing && open) || K.tier === 0) { const fl = FOOD_FLOOR_PX / vis; if (app < fl) boost = Math.min(FOOD_BOOST_MAX, fl / Math.max(app, 1e-3)); }
      else if (K.tier === 1 && K.food) boost = FOOD_T1_BOOST;
      if (boost > 1) boost = Math.max(1, Math.min(boost, FOOD_RIM * rv / Math.max(1e-3, a * vis)));
      // R4 (round 2): a milestone's boss is drawn as big as the board's rim lets it, render only. The sim's a never changes.
      if (boss && mile) boost = bossBoost(a, x, z, BB);
      // FIX-LIST-3 R3: a chili was 7 px on a phone. Half as big again, with a floor. It goes down whatever its size, so no rim cap.
      const hot = K.id === 'chili';
      if (hot) boost = Math.min(2.4, Math.max(1.5, 15 / Math.max(app * vis, 1e-3)));
      let sc = (a / ud.catA) * boost, y = 0, sy = 1;
      if (isCake) { const key = Ck.n + ':' + Ck.tier + ':' + Ck.tiers.join(','); if (key !== cakeKey) cakeBuild(Ck, key); }
      const h = isCake ? cakeH * sc * ud.catA / Math.max(1e-4, a) : ud.h * sc;
      if (belt) y += BELT_TOP;
      if (s === 3) y += 0.05;
      if (s === 5) for (const G of Gs) if (G.i === i && G.st === 2) { x = G.x; z = G.z; y = Math.max(0, G.y - 0.12 - h); }
      // rotation: base yaw, rolling, wobble, tip
      const yaw = i === trI ? truckYaw : itemRot[i];
      const rc = K.roll ? h * 0.5 : 0;   // rolling kinds pivot about their centre (see the compose below)
      if (K.roll) {
        const mx = x - lastX[i], mz = z - lastZ[i], md = Math.hypot(mx, mz), rr = Math.max(0.05, rc);
        if (WHEELS.has(K.id)) {
          if (md > 1e-4 && md < 1) {
            let d = Math.atan2(mx, mz) - rollH[i]; d = Math.atan2(Math.sin(d), Math.cos(d));
            if (d > PI / 2) d -= PI; else if (d < -PI / 2) d += PI;   // a wheel rolls either way: never turn > 90°
            rollH[i] += d * Math.min(1, (md * 6) / rr);
            rollA[i] += (mx * Math.sin(rollH[i]) + mz * Math.cos(rollH[i])) / rr;
          }
          _q.setFromAxisAngle(_up, rollH[i]); _ax.set(1, 0, 0); _q2.setFromAxisAngle(_ax, rollA[i]); _q.multiply(_q2);
        } else {
          _q.fromArray(rollQ, i * 4);
          if (md > 1e-4 && md < 1) { _ax.set(mz / md, 0, -mx / md); _q2.setFromAxisAngle(_ax, md / rr); _q.premultiply(_q2).normalize(); _q.toArray(rollQ, i * 4); }
          _q2.setFromAxisAngle(_up, yaw); _q.multiply(_q2);
        }
      } else _q.setFromAxisAngle(_up, yaw);
      lastX[i] = x; lastZ[i] = z;
      const cracked = (w.cracked && w.cracked[i]) || prevCrack[i];
      if (cracked && !prevCrack[i]) startCrack(i);
      if (wobT[i] > 0) {
        wobT[i] = Math.max(0, wobT[i] - dt);
        _ax.set(1, 0, 0.4).normalize(); _q2.setFromAxisAngle(_ax, Math.sin(time * 38) * 0.16 * (wobT[i] / 0.4)); _q.premultiply(_q2);
      } else if (fl8[i] & F_FRAGILE && s === 0 && !cracked) {
        const ph = (time + i * 0.37) % 2.5;
        if (ph < 0.5) { _ax.set(0.4, 0, 1).normalize(); _q2.setFromAxisAngle(_ax, Math.sin(ph * 50) * 0.05 * (1 - ph / 0.5)); _q.premultiply(_q2); }
      }
      if (popT[i] > 0) { popT[i] = Math.max(0, popT[i] - dt); const p = 1 - popT[i] / 0.25; sc *= p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - 0.12 * ((p - 0.7) / 0.3); }
      if (i === trI && truckSq > 0) { const p = 1 - truckSq / 0.3; sy = 1 + 0.12 * Math.sin(p * TAU) * (1 - p); }
      let shAlpha = 1;
      if (finI) {
        // R7: the boss swells to the pot's size, hangs over the stew, then shrinks and spirals in. Driven by the finisher's
        // real clock, not tp: tp crawls under the slow-mo and sprints after it, and this has to land on the boom.
        // Round 2 (R5): on a milestone it sinks halfway, sticks there with the pot straining on it, then goes down in one gulp.
        const B = fin.B, mile = B === FIN_BIG, t = fin.t, inP = sstep(0, mile ? 0.42 : 0.28, t), q = finQ(B, t), spin = fin.ang + TAU * 1.6 * q * q;
        const big = Math.max(1.25, (mile ? 1.25 : 1.05) * rv / Math.max(1e-3, a * boost));
        const rad = 0.42 * rv * (1 - q);
        x = lerp(x, pot.x + Math.sin(spin) * rad, inP); z = lerp(z, pot.z + Math.cos(spin) * rad, inP);
        const pop = 1 + 0.16 * Math.sin(PI * clamp(t / (mile ? 0.5 : 0.34), 0, 1));
        sc *= lerp(1, big, inP) * pop * (1 - 0.94 * q * q);
        const sink = mile ? 0.5 * ud.h * sc * sstep(0.08, 0.5, q) : 0;   // half its height, at the size it is drawn right now
        y = 0.3 * rv * inP * (1 - q) - sink - (h + 0.5 * rv) * sstep(0.55, 1, q);
        sy *= 1 + 0.3 * q;
        _q2.setFromAxisAngle(_up, TAU * 1.6 * q * q); _q.premultiply(_q2);
        if (mile && !calm && t > B.sink * 0.8 && t < B.boom) { _ax.set(1, 0, 0.3).normalize(); _q2.setFromAxisAngle(_ax, Math.sin(t * 34) * 0.07 * sstep(B.sink * 0.8, B.hold, t)); _q.premultiply(_q2); }
        shAlpha = 0;
      } else if (s === 1) {
        const p = clamp(tp[i], 0, 1), L = dist || 1;
        if (boss && !REC) sc *= 1 + 0.4 * Math.sin(PI * sstep(0, 0.7, p));   // R7 small version: non-final bosses swell as they go
        _ax.set(dz / L, 0, -dx / L);
        _q2.setFromAxisAngle(_ax, 70 * D2R * sstep(0, 0.6, p)); _q.premultiply(_q2);
        // DECISION (11-05, art lane): a slurp, not a sink. The food is dragged to the middle of the pot and stretches along
        //   the pull (the tip above points its local y at the pot). Render only: the sim's tip time and position don't change.
        const pull = 0.85 * sstep(0, 0.75, p);
        x += dx * pull; z += dz * pull;
        sy *= 1 + 0.55 * Math.sin(PI * sstep(0.05, 0.8, p));
        y -= (h * 1.2 + 0.55 * rv) * sstep(0.3, 1, p);
        sc *= 1 - 0.45 * sstep(0.6, 1, p);
        shAlpha = 1 - sstep(0.1, 0.6, p);
      }
      if (s === 5) shAlpha *= 1 - 0.75 * clamp(y / 4, 0, 1);
      if (rattleT[i] > 0) { rattleT[i] = Math.max(0, rattleT[i] - dt); }
      // edible rim light (fits and within 3r), occluder fade
      const eTarget = s !== 1 && !finI && dist < 3 * pot.r && !(fl8[i] & F_HOT) && edible(w, i) ? 1 : 0;   // R7: a chili goes down but is no invitation
      eGlow[i] += (eTarget - eGlow[i]) * ek(dt, 0.05);
      let occ = 1;
      // A milestone's open boss never ghosts: its boosted body always "hit" the pot, so L60's lighthouse dithered away just as it
      // mattered. The pot's rim and eyes draw through it now (rimXray, depthTest off).
      if (s !== 1 && !finI && !titleOn && h > 0.22 && z > pot.z - a - 0.1 && !(boss && open && mile)) {
        const fz = Math.cos(cam.yaw), fx = Math.sin(cam.yaw);
        const hit = segHitsCyl(cp.x, cp.y, cp.z, pot.x, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x - rv, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x + rv, 0.05, pot.z, x, z, a * boost, h)
          || segHitsCyl(cp.x, cp.y, cp.z, pot.x + fx * rv, eyeY, pot.z + fz * rv, x, z, a * boost, h);
        if (hit) occ = 0.28;   // 11-07 (art-director r5): 0.4 still hid half the pot behind an L1 bin; the ghost is thinner now
      }
      // 11-07 (art-director, viral r4): food going in shows solid at once. It used to ease back from its ghost over the whole 0.3 s tip, so the gulp itself read as a speckled smear.
      eOcc[i] = s === 1 ? 1 : eOcc[i] + (occ - eOcc[i]) * ek(dt, occ < eOcc[i] ? 0.05 : 0.1);
      if (lastBoss && boss && open && s === 0) bossNear = { x, z, a: Math.max(a * boost, h / 1.8), wv: 0, d: dist, e: rv + a * boost };
      const oc = eOcc[i] > 0.995 ? 1 : eOcc[i];
      // instance (the cake draws its own tier meshes instead of the 3-tier kind mesh)
      if (isCake) {
        const S = sc * ud.catA / Math.max(1e-4, a);
        cakePut(cakeRest, x, y, z, S, oc, 0, 0);
        cakePut(cakeTop, x, y, z, S, oc, eGlow[i], open ? 1 : 0.3);
      } else {
        const k = kindCnt[c];
        if (k < ud.cap) {
          _p.set(x, y, z); _s.set(sc, sc * sy, sc);
          if (rc > 0) { _v.set(0, rc, 0).applyQuaternion(_q); _p.x -= _v.x; _p.y += rc - _v.y; _p.z -= _v.z; }
          _m.compose(_p, _q, _s); _m.toArray(m.instanceMatrix.array, k * 16);
          const f = ud.fx.array, o = k * 4;
          f[o] = eGlow[i]; f[o + 1] = oc; f[o + 2] = boss ? (open ? 1 : mile ? 0.55 : 0) : 0; f[o + 3] = ud.sway;
          kindCnt[c] = k + 1;
        }
      }
      // stack contents on their slots; on a crack they tumble off away from the pot, then leave a splat
      const so = w.stackOf && w.stackOf[i];
      if (so && so.length && ud.slots && ud.top != null && (!cracked || crackT[i] > 0)) {
        const t = cracked ? 1 - crackT[i] / CRACK_T : 0, ex = crDx[i], ez = crDz[i];
        if (t > 0) { _ax.set(ez, 0, -ex); _q3.setFromAxisAngle(_ax, -t * 2.4); }
        for (let j = 0; j < so.length && j < ud.slots.length; j++) {
          const c2 = KIND_ID[so[j]], m2 = c2 !== undefined ? kindMesh[c2] : null;
          if (!m2 || kindCnt[c2] >= m2.userData.cap) continue;
          const u2 = m2.userData, sc2 = sc * u2.K.a / u2.catA, sl = ud.slots[j];
          _v.set(sl[0] * sc, ud.top * sc, sl[1] * sc).applyQuaternion(_q);
          let px = x + _v.x, py = y + _v.y, pz = z + _v.z;
          if (t > 0) {
            const out = t * (a * 1.2 + 0.12 * j);
            px += ex * out; pz += ez * out; py = Math.max(0, py * (1 - t * t)) + Math.sin(PI * t) * 0.25 * a;
            _q2.copy(_q3).multiply(_q);
          } else _q2.copy(_q);
          _p.set(px, py, pz); _s.set(sc2, sc2, sc2);
          _m.compose(_p, _q2, _s); const k2 = kindCnt[c2]; _m.toArray(m2.instanceMatrix.array, k2 * 16);
          const f2 = u2.fx.array; f2[k2 * 4] = 0; f2[k2 * 4 + 1] = oc; f2[k2 * 4 + 2] = 0; f2[k2 * 4 + 3] = u2.sway;
          kindCnt[c2] = k2 + 1;
        }
      }
      if (crackT[i] > 0) { crackT[i] = Math.max(0, crackT[i] - dt); if (crackT[i] === 0) addSplat(i, x, z); }
      // blob shadow (the cake's is its bottom tier)
      if (nSh < DEC_SH - 6 && shAlpha > 0.01) {
        const aS = isCake ? +Ck.tiers[Ck.n - 1] || a : a;
        const S = 2.2 * aS * boost * vis * (s === 1 ? 1 - 0.45 * sstep(0.6, 1, tp[i]) : 1);
        nSh = shInst(decArr, decM, nSh, x, z, S, 10, shAlpha, 0.042 + (belt ? BELT_TOP : 0));
      }
      if (s === 1 || s === 5 || finI) continue;
      // markers: halo (open-line ingredient), gate outline, padlock (locked boss), icon (open line, within 6 u)
      if (ing && open) {
        const R = Math.max(1.6 * a * boost * vis, 11 / ppu);
        nF = flatInst(fScr, fScrM, nF, x, z, R, 0, i * 1.7, 1, 0);
        if (dist < 6 && nB < 48 && iconCell[c] > 0) {
          const bob = 0.04 * Math.sin(time * 5 + i);
          nB = bbInst(bP, bM, nB, x, y + h + 0.08 + 10 / ppu + bob, z, 20 / ppu, 1, 1, iconCell[c]);
        }
      }
      if (boss && (open || mile)) nF = flatInst(fScr, fScrM, nF, x, z, 2.1 * a * boost, 4, 0, open ? 1 : 0.6, 0);
      if (hot) nF = flatInst(fScr, fScrM, nF, x, z, Math.max(1.5 * a * boost * vis, 28 / ppu), 5, i * 1.3, 1, 0);
      if (fl8[i] & F_GATE) nF = flatInst(fScr, fScrM, nF, x, z, 1.15 * a, 1, 0, 1, 0);
      if (boss && !open && nB < 48) {
        const sz = Math.max(28 / ppu, 0.42 * a), rt = rattleT[i];
        const jx = rt > 0 ? Math.sin(time * 60) * 0.05 * sz * (rt / 0.4) : 0;
        nB = bbInst(bP, bM, nB, x + jx, y + h + 0.35 + sz * 0.5, z, sz, 0, 1, 0);
      }
      // look-at priority: open-line ingredient > open boss > edible item
      const pri = ing && open ? 3 : boss && open ? 2 : eTarget ? 1 : 0;
      if (pri > 0 && (pri > lookPri || (pri === lookPri && dist < lookD))) { lookPri = pri; lookD = dist; look = [x - pot.x, z - pot.z]; }
    }
  }
  // the pot's ground halo (type 11): its band is 16 to 40 px past the rim at any pot size, and it never shrinks under 46 px, so even a
  // tiny pot in a wide shot has a mark on it
  if (!titleOn) {
    const Rg = Math.max(1.12 * rv + clamp(0.47 * rv, 16 / ppu, 40 / ppu), 46 / ppu);
    nSh = shInst(decArr, decM, nSh, pot.x, pot.z, 2 * Rg, 11, 1, 0.04 + potLift);
    decM[(nSh - 1) * 4 + 3] = 1.02 * rv / Rg;
  }
  // SIZE UP shock ring (big beats only, D31)
  if (mood.shockT >= 0) {
    mood.shockT += dt;
    const p = mood.shockT / 0.5;
    if (p >= 1) mood.shockT = -1;
    else nF = flatInst(fScr, fScrM, nF, pot.x, pot.z, rv * (1.1 + 1.3 * (1 - (1 - p) * (1 - p))), 3, 0, 1, p);
  }
  // two-course boss ② reveal ring
  if (bossRing) {
    bossRing.t += dt;
    const p = bossRing.t / 0.6;
    if (p >= 1) bossRing = null;
    else nF = flatInst(fScr, fScrM, nF, bossRing.x, bossRing.z, bossRing.R * (0.7 + 0.6 * (1 - (1 - p) * (1 - p))), 3, 0, 1, p);
  }
  // gulls (L41+): one instanced mesh, banked/pitched toward the flight, flap per state, shadow + telegraph
  if (gullMesh) {
    const Gs = (w && w.gulls) || [], arr = gullMesh.instanceMatrix.array, ga = gullA.array;
    let nG = 0;
    for (let g = 0; g < Gs.length && nG < 4; g++) {
      const G = Gs[g];
      if (typeof G.x !== 'number') continue;
      if (!gOn[g]) { gOn[g] = 1; gH[g] = G.h || 0; gY[g] = G.y; gBank[g] = 0; gPitch[g] = 0; }
      const dh = Math.atan2(Math.sin((G.h || 0) - gH[g]), Math.cos((G.h || 0) - gH[g]));
      gH[g] += dh * ek(dt, 0.12);
      gBank[g] += (clamp(-dh * 1.6, -0.55, 0.55) - gBank[g]) * ek(dt, 0.15);
      const vy = dt > 0 ? (G.y - gY[g]) / dt : 0; gY[g] = G.y;
      gPitch[g] += (clamp(-vy * 0.14, -0.45, 0.45) - gPitch[g]) * ek(dt, 0.15);
      _q.setFromAxisAngle(_up, gH[g]);
      _ax.set(1, 0, 0); _q2.setFromAxisAngle(_ax, gPitch[g]); _q.multiply(_q2);
      _ax.set(0, 0, 1); _q2.setFromAxisAngle(_ax, gBank[g]); _q.multiply(_q2);
      _p.set(G.x, G.y, G.z); _s.set(1.2, 1.2, 1.2);
      _m.compose(_p, _q, _s); _m.toArray(arr, nG * 16);
      const sI = G.st | 0, amp = [0.06, 0.15, 0.5, 0.45][sI] ?? 0.2, rate = [3, 6, 14, 12][sI] ?? 6;
      ga[nG * 3] = g * 1.3; ga[nG * 3 + 1] = amp; ga[nG * 3 + 2] = rate;
      nG++;
      nSh = shInst(decArr, decM, nSh, G.x, G.z, 0.9, 10, 1 - 0.75 * clamp(G.y / 4, 0, 1), 0.042);
      if (sI === 1 && G.i >= 0 && w && G.i < w.n) nF = flatInst(fScr, fScrM, nF, G.tx, G.tz, Math.max(0.5, 1.3 * w.ia[G.i] + 0.2, 44 / ppu), 2, 0, 1, G.warn || 0);
    }
    flush(gullMesh, [gullMesh.instanceMatrix, gullA], nG);
  }
  for (const c of used) {
    const m = kindMesh[c]; if (!m) continue;
    const n = kindCnt[c];
    m.count = n; m.visible = n > 0;
    if (n) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true; const f = m.userData.fx; f.clearUpdateRanges(); f.addUpdateRange(0, n * 4); f.needsUpdate = true; }
  }
  // decals: shadows first, then flats (instance order = paint order), one draw
  decArr.set(fScr.subarray(0, nF * 16), nSh * 16); decM.set(fScrM.subarray(0, nF * 4), nSh * 4);
  flush(decMesh, [decMesh.instanceMatrix, decA], nSh + nF);
  flush(bbMk, [bbP, bbM], nB);
  // Feast steam wipe (0.6 s; Core swaps the course at the half-way cover)
  if (wipeT >= 0) {
    wipeT += dt / 0.6;
    const u = wipeMesh.material.uniforms;
    u.uT.value = Math.min(1, wipeT); u.uAsp.value = cssW / cssH;
    wipeMesh.visible = wipeT < 1;
    if (wipeT >= 1) wipeT = -1;
  } else wipeMesh.visible = false;
  if (flashA > 0.004) { flashMesh.material.uniforms.uA.value = flashA; flashMesh.visible = true; flashA *= Math.exp(-dt / 0.13); }
  else { flashA = 0; flashMesh.visible = false; }

  updatePot(dt, look);
  if (fw) updateFireworks(dt);
  updateFx(dt * slow);
}
/** Starts the Feast steam wipe (also started by the feastWipe bus event). */
export function steamWipe() { wipeT = 0; }
function shInst(arr, M, n, x, z, S, type, a, y) {
  if (n >= DEC_SH) return n;
  const o = n * 16;
  arr.fill(0, o, o + 16); arr[o] = S; arr[o + 5] = S; arr[o + 10] = S; arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  M[n * 4] = type; M[n * 4 + 1] = 0; M[n * 4 + 2] = a; M[n * 4 + 3] = 0;
  return n + 1;
}
function flatInst(arr, M, n, x, z, R, type, phase, a, extra) {
  if (n >= DEC_FL) return n;
  const S = (2 * R) / 0.8, o = n * 16;
  arr.fill(0, o, o + 16); arr[o] = S; arr[o + 5] = S; arr[o + 10] = S; arr[o + 12] = x; arr[o + 13] = 0.05 + type * 0.002; arr[o + 14] = z; arr[o + 15] = 1;
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
  // DECISION: sclera radius = max(0.16·rVis, 6.5 px) capped at 0.26·rVis, so the face reads at L1's tiny pot.
  potRoot.visible = holeG.visible = eyes.visible = !titleOn;
  rimXray.visible = !fin;   // the finisher's boss hangs over the rim on purpose
  const rv = pot.rVis, M = mood;
  // timers
  M.biteT = Math.max(0, M.biteT - dt); M.sizeT = Math.max(0, M.sizeT - dt); M.happyT = Math.max(0, M.happyT - dt);
  M.wideT = Math.max(0, M.wideT - dt); M.squintT = Math.max(0, M.squintT - dt); M.sqzT = Math.max(0, M.sqzT - dt);
  // squash/tilt/overshoot/bob
  let sy = 1;
  if (M.biteT > 0) { const t = 0.18 - M.biteT; const lo = 1 - 0.12 * M.biteK, hi = 1 + 0.07 * M.biteK; sy = t < 0.06 ? lerp(1, lo, t / 0.06) : t < 0.12 ? lerp(lo, hi, (t - 0.06) / 0.06) : lerp(hi, 1, (t - 0.12) / 0.06); }
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
  potRoot.position.set(pot.x, yOff + potLift, pot.z);
  potRoot.scale.set(rv * over, rv * over * sy, rv * over);
  if (ang > 0) { _ax.set(tdz, 0, -tdx).normalize(); potRoot.quaternion.setFromAxisAngle(_ax, ang); } else potRoot.quaternion.identity();
  holeG.position.set(pot.x, potLift, pot.z); holeG.scale.setScalar(rv);
  // skin lights
  if (potExtras.lights) potExtras.lights.visible = Math.sin(time * TAU * 1.0) > -0.3;
  if (potExtras.lightsA) potExtras.lightsA.visible = Math.sin(time * TAU * 2) > 0;
  if (potExtras.lightsB) potExtras.lightsB.visible = Math.sin(time * TAU * 2) <= 0;
  if (potExtras.sparkle) potExtras.sparkle.scale.setScalar(0.8 + 0.25 * Math.abs(Math.sin(time * 3.1)));
  // stew dim
  M.dim += ((M.sad ? 0.6 : 1) - M.dim) * ek(dt, 0.3);
  M.flash = Math.max(0, M.flash - dt * 5);
  stewMat.uniforms.uDim.value = M.dim + 0.6 * M.flash;
  // R7: a chili flushes the stew and the pot's skin red, then it fades. One uniform and one colour, no new material.
  hotT = Math.max(0, hotT - dt);
  const hk = sstep(0, 0.2, hotT);
  stewMat.uniforms.uHot.value = hk;
  potMat.emissive.setRGB(0.069 + 0.5 * hk, 0.025 - 0.015 * hk, 0);
  // Simmer lid hat (§4.5): perched on the back rim, tipped back like a hat, pops on, jiggles on refusals; while the
  // pot boils over, steam puffs out from under it every 0.12 s.
  // DECISION (11-04): the lid lives in pot-local units (child of potRoot), so it scales with the pot for free.
  if (lid.on && !titleOn) {
    lid.pop = Math.max(0, lid.pop - dt); lid.jig = Math.max(0, lid.jig - dt);
    const boiling = W && W.boil > 0;
    if (boiling) {
      lid.jig = Math.max(lid.jig, 0.2);
      lid.steamT -= dt;
      if (lid.steamT <= 0) {
        lid.steamT = 0.12;
        const bx = -Math.sin(cam.yaw), bz = -Math.cos(cam.yaw);
        burst(pot.x + bx * 0.45 * rv, (0.3 * rv) + potLift, pot.z + bz * 0.45 * rv, 2, '#FFFFFF', { speed: 0.25, up: 1.1, size: 0.1 * Math.max(0.6, rv), shape: 4, grav: -0.5, grow: 1.6, life: 0.8, a: 0.6 });
      }
    } else lid.steamT = 0;
    const yaw = cam.yaw, j = Math.sin(time * 55) * 0.06 * (lid.jig / 0.35);
    lidMesh.position.set(-Math.sin(yaw) * 0.62, 0.16 + Math.abs(j) * 0.5, -Math.cos(yaw) * 0.62);
    _ax.set(Math.cos(yaw), 0, -Math.sin(yaw)); lidMesh.quaternion.setFromAxisAngle(_ax, -0.42 + j);
    const p = 1 - lid.pop / 0.3, ps = lid.pop > 0 ? (p < 0.7 ? (p / 0.7) * 1.15 : 1.15 - 0.15 * ((p - 0.7) / 0.3)) : 1;
    lidMesh.scale.setScalar(Math.max(0.01, ps));
    lidMesh.visible = true;
  } else lidMesh.visible = false;

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
  const S = Math.min(Math.max(0.16 * rv, 6.5 / ppu), 0.26 * rv) * (1 + 0.04 * (over - 1) * 8);
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
  // shared props geometries stay cached in props.js; materials shared between meshes are disposed once below
  for (const m of kindMesh) if (m) { m.geometry.dispose(); m.dispose(); }
  for (const m of [decMesh, bbMk, fxMesh]) if (m) { m.geometry.dispose(); m.material.dispose(); m.dispose(); }
  for (const m of [gullMesh, cakeRest, cakeTop]) if (m) { m.geometry.dispose(); m.dispose(); }
  for (const m of [beltMesh, splatMesh, lidMesh, warmGlow]) if (m) m.geometry.dispose();
  if (wipeMesh) { wipeMesh.geometry.dispose(); wipeMesh.material.dispose(); }
  if (flashMesh) { flashMesh.geometry.dispose(); flashMesh.material.dispose(); }
  staticMesh.geometry.dispose(); staticMat.dispose();
  if (groundTex) groundTex.dispose();
  if (beltTex) beltTex.dispose();
  if (beltMat) beltMat.dispose();
  atlasTex.dispose(); blankTex.dispose(); propMat.dispose(); potMat.dispose(); stewMat.dispose(); eyeMat.dispose(); gullMat.dispose();
  pitStew.geometry.dispose(); rimDisc.geometry.dispose(); rimDisc.material.dispose(); eyes.geometry.dispose(); rimXray.geometry.dispose(); rimXray.material.dispose();
  renderer.dispose();
  renderer = null; scene = null; camera = null; W = null; LV = null; BB = null; curTown = null; skin = null; potG = null;
  gullMesh = gullA = beltMesh = beltMat = beltTex = cakeRest = cakeTop = splatMesh = lidMesh = wipeMesh = flashMesh = null;
  splats.length = 0; wipeT = -1; lid.on = false; cakeKey = '';
  kindMesh.length = 0; used = [];
}
