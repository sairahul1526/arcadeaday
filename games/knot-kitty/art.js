// Knot Kitty: art.js. Illustrated sprites made with tools/art/kie.mjs (spec: tools/knot-kitty/art.json).
// Same-origin relative paths only (Playables CSP img-src 'self'). Code-drawn fallbacks stay in render.js, so a
// missing or not-yet-decoded image never breaks a frame: img(id) returns null until the image is ready.
//
//   await loadArt(FIRST);     // before P.firstFrame(): the art the first screen needs
//   loadArt();                // everything else, in the background
//   img('kit-tabby-sad')      // HTMLImageElement (decoded) or null
//   kittenArt(id, happy)      // sprite id for kitten of level id (1..60); bosses on every 10th level
//   bgArt(world)              // backdrop id for world 1..6
//   WINS                      // celebration illustration ids
//   want(id)                  // img(id), and starts a lazy load if it was never requested (wide backdrops)
//   bgWideArt(world)          // 16:9 backdrop id for world 1..6 (desktop only, lazy: never in ALL)

export const KITTENS = ['tabby', 'tuxedo', 'calico', 'siamese', 'black', 'grey', 'persian', 'browntabby',
  'cream', 'bengal', 'tortie', 'ginger-white'];
export const BOSSES = { 10: 'b10', 20: 'b20', 30: 'b30', 40: 'b40', 50: 'b50', 60: 'b60' };
import { SEASON_END } from './consts.js';

export const BGS = [null, 'den', 'pumpkin', 'cabin', 'cafe', 'attic', 'roof'];
export const WINS = ['win-yarnhug', 'win-pile', 'win-nap', 'win-ribbon'];

export const ALL = [
  ...KITTENS.flatMap(k => [`kit-${k}-sad`, `kit-${k}-happy`]),
  ...Object.values(BOSSES).flatMap(b => [`boss-${b}-sad`, `boss-${b}-happy`]),
  ...BGS.filter(Boolean).map(b => `bg-${b}`),
  ...WINS,
  'kit-hero-idle',
];
// DECISION: the title shows world 2 (Pumpkin Night) until SEASON_END (same IST-date rule as game.js seasonWorld),
// so FIRST must hold the backdrop the title actually paints, plus the painted Kitty it sits in front of. Otherwise
// the code-drawn room shows first and the painting pops in about a second later on 4G.
const TITLE_BG = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) < SEASON_END ? 'bg-pumpkin' : 'bg-den';
export const FIRST = ['kit-hero-idle', 'kit-tabby-sad', 'kit-tabby-happy', TITLE_BG];

const cache = new Map(); // id -> { im, ok, p }

function one(id) {
  let e = cache.get(id);
  if (e) return e.p;
  const im = new Image();
  e = { im, ok: false, p: null };
  e.p = new Promise(res => {
    im.onload = () => {
      const done = () => { e.ok = true; res(true); };
      im.decode ? im.decode().then(done, done) : done();
    };
    im.onerror = () => { e.bad = true; res(false); };
  });
  im.src = `art/${id}.webp`;
  cache.set(id, e);
  return e.p;
}

/** Load ids (default: all). Resolves when every one has loaded or failed; never rejects. */
export function loadArt(ids = ALL) { return Promise.all(ids.map(one)); }

/** The decoded image, or null (not loaded yet, failed, or unknown id). */
export function img(id) { const e = cache.get(id); return e && e.ok ? e.im : null; }

/** Sprite id for the kitten rescued on level id (1-based). */
export function kittenArt(id, happy = false) {
  const m = happy ? 'happy' : 'sad';
  if (BOSSES[id]) return `boss-${BOSSES[id]}-${m}`;
  const k = KITTENS[((Math.max(1, id | 0) - 1) % KITTENS.length)];
  return `kit-${k}-${m}`;
}

export const bgArt = world => `bg-${BGS[Math.min(6, Math.max(1, world | 0))]}`;
export const bgWideArt = world => `bgw-${BGS[Math.min(6, Math.max(1, world | 0))]}`;

/** img(id), and if id was never requested, start loading it now (null until decoded). For lazy, optional art. */
export function want(id) { if (!cache.has(id)) one(id); return img(id); }

/** Has id finished (loaded or failed)? Lets callers stop waiting on a missing file. */
export function settled(id) { const e = cache.get(id); return !!e && (e.ok || e.bad); }
