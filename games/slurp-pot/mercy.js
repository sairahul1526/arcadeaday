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
export function firstTry(lvl) {
  const c = lvl.first > 0 ? Math.round(lvl.first) : 0;
  if (!c || !(lvl.T - c > 0)) return lvl;
  return { ...lvl, T: lvl.T - c, grace: (lvl.grace > 0 ? +lvl.grace : 0) - c, cut: c };
}
/** The step the next level starts on after a win at this step. */
export const carryAfterWin = step => Math.max(0, Math.min(step, MERCY_MAX) - 1);
