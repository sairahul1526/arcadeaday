// Knot Kitty level data access: campaign levels, Daily Knot (IST date seeded), Bonus Tangles.
// DECISION: if a level id is missing from the data (only while generation is in progress), getLevel falls back
//   to the nearest generated level with a console.warn instead of throwing; check.mjs fails on any gap.
// DECISION: the daily colour permutation shuffles only the colours the board uses (so the §7.2 palette rules
//   still hold); perm is a full 0..5 array, identity for unused colours.
import LEVELS from './levels-data.js';
import DAILIES from './dailies-data.js';
import { LEVELS as LEVEL_TOTAL, DAILY_START } from './consts.js';
import { rng, transformLevel } from './rules.js';

export const LEVEL_COUNT = LEVEL_TOTAL;
if (LEVELS.length !== LEVEL_COUNT) console.warn(`[levels] ${LEVELS.length}/${LEVEL_COUNT} levels in levels-data.js`);

const byId = new Map(LEVELS.map(l => [l.id, l]));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const copy = o => JSON.parse(JSON.stringify(o));

export function getLevel(id) {
  let L = byId.get(id);
  if (!L) {
    let best = null;
    for (const l of LEVELS) if (!best || Math.abs(l.id - id) < Math.abs(best.id - id)) best = l;
    if (!best) throw new Error('no levels generated');
    console.warn(`[levels] L${id} not generated yet, using L${best.id}`);
    L = { ...best, id };
  }
  return deepFreeze(copy(L));
}

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function daysBetween(a, b) {
  const t = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}
export function istDateKey(now = Date.now()) {
  return new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
}

const pool = () => (DAILIES.length ? DAILIES : LEVELS.filter(l => l.id >= 11));

function makeTransform(board, r) {
  const mx = r() < 0.5, my = r() < 0.5;
  const used = [...new Set(board.strands.map(s => s.c).filter(c => c < 6))].sort((a, b) => a - b);
  const shuffled = used.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const perm = [0, 1, 2, 3, 4, 5];
  used.forEach((c, k) => { perm[c] = shuffled[k]; });
  return { mx, my, perm };
}

export function dailyIndex(dateKey) {
  const P = pool();
  const day = daysBetween(DAILY_START, dateKey);
  const i = (((day * 37) % 60) + 60) % 60 % P.length;
  return { i, ...makeTransform(P[i], rng(hash(dateKey))) };
}

export function getDaily(dateKey) {
  const { i, mx, my, perm } = dailyIndex(dateKey);
  const L = transformLevel(pool()[i], { mx, my, perm });
  L.id = 0; L.name = 'Daily Knot'; L.daily = i; L.date = dateKey;
  return deepFreeze(L);
}

export function getBonus(i) {
  const P = pool();
  const k = ((i % 60) + 60) % 60 % P.length;
  const L = transformLevel(P[k], makeTransform(P[k], rng(hash('bonus' + i))));
  L.id = 0; L.name = 'Bonus Tangle ' + (i + 1); L.bonus = i;
  return deepFreeze(L);
}
