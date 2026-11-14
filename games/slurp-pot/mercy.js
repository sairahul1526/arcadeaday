// Slurp Pot mercy (GDD §3.8). Pure maths, shared by game.js and tools/slurp-pot/slow-hand.mjs.
// A time-out on a level or a Daily makes the next try easier: more clock, and from the third try a bigger pot.
// The extra seconds are grace, so they buy no stars. A win hands one step less to the next level, so a slow hand
// stops failing every level, while a fast hand, who wins on the first or second try, never sees it.
export const MERCY_STEP = 0.3, MERCY_MAX = 3;
export const MERCY_GROW = [1, 1, 1.1, 1.15]; // starting pot size by step

const pace = lvl => lvl.T - (lvl.grace > 0 ? +lvl.grace : 0);
export const mercySecs = (lvl, step) => Math.min(step, MERCY_MAX) * Math.round(MERCY_STEP * pace(lvl));
export const mercyGrow = step => MERCY_GROW[Math.max(0, Math.min(step, MERCY_MAX))];

/** The level to play at this step: a copy with the extra clock and pot, or the level itself at step 0. */
export function withMercy(lvl, step) {
  const m = mercySecs(lvl, step);
  if (!(m > 0)) return lvl;
  const g = mercyGrow(step), out = { ...lvl, T: lvl.T + m, grace: (lvl.grace > 0 ? +lvl.grace : 0) + m, mercy: m };
  if (g > 1) { out.r0 = lvl.r0 * g; out.mercyGrow = g; }
  return out;
}
// FIX-LIST-7 A1 (11-09): first-try tension. spec.first is the seconds a clean first try loses (tools/slurp-pot/first-try.mjs
// sets it so the average hand loses about 1 first try in 5, 1 in 3 on every 5th level). It is negative grace, so the pace
// (T − grace) and the 3-star line do not move; only the clock is shorter. game.js plays it only with no help carried, no
// fail on this level yet, and save.calm at 0: a time-out sets calm to CALM_LEVELS, so the next levels play the stored clock.
export const CALM_LEVELS = 2;
// DECISION (11-14, B1): the fail card read "RETRY +100 s" on L5 because the retry gift is the first-try cut coming back PLUS step-1 mercy,
// and the cut ran to 90 s on a 160 s clock (a first-try clock of 30 s). Try 2 had no stakes. Two caps now hold at play time (spec.first
// still stores what the tension wants, so a loosened cap is a one-line change here): a first-try clock is at least FIRST_FLOOR of the
// stored clock, and cut + step-1 mercy (what the button offers after a first fail) is at most GIFT_MAX. A cut under CUT_MIN is not played.
// Cost, measured in studio/2026-11-14/levels/: the average hand finishes in 30 to 50 % of T, so a clock over 60 % of T no longer loses it
// a first try. The tension for that hand has to come from hazards (B4 spikes, chilis), not from the clock.
export const FIRST_FLOOR = 0.6, GIFT_MAX = 38, CUT_MIN = 6;
/** Seconds the first try loses on this stored level (0 when no cut is played). */
export function firstCut(lvl) {
  const want = lvl.first > 0 ? Math.round(lvl.first) : 0;
  if (!want) return 0;
  const c = Math.min(want, Math.floor((1 - FIRST_FLOOR) * lvl.T), GIFT_MAX - mercySecs(lvl, 1));
  return c >= CUT_MIN && lvl.T - c > 0 ? c : 0;
}
export function firstTry(lvl) {
  const c = firstCut(lvl);
  if (!c) return lvl;
  return { ...lvl, T: lvl.T - c, grace: (lvl.grace > 0 ? +lvl.grace : 0) - c, cut: c };
}
/** Seconds the fail card offers on top of the clock the player just lost on: step 1 adds the cut that comes back, later steps only their own increment. */
export const retryGift = (lvl, step, cut = 0) => mercySecs(lvl, step) - (step > 1 ? mercySecs(lvl, step - 1) : 0) + (step === 1 ? cut | 0 : 0);
/** The step the next level starts on after a win at this step. */
export const carryAfterWin = step => Math.max(0, Math.min(step, MERCY_MAX) - 1);
