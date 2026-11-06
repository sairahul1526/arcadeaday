// Slurp Pot: the follow camera's width, shared by render3d.js, render2d.js and the crumb sizing.
// Its own file because render2d.js may never import render3d/props (three.js) and render3d should not pull the whole
// 2D fallback into every boot. logic.js VIEW_R / SEE_R stay on the old width on purpose: they are sim, not camera.

/**
 * World units across the screen when following a pot of radius r (portrait; landscape multiplies by 1.35).
 * DECISION (11-06 Fri, round 2, curator "25 to 30 % of the width", kid13 "L1 pot is tiny"): 1.6 + 6.2 r, so the pot spans
 * about 17 % of a portrait screen at r 0.3 and 26 % at r 1 (it was 13 % and 22 %). The pull-back cap still wins late.
 */
export const camW = r => 1.6 + 6.2 * r;
/**
 * The width the record, og and cover framings were tuned on (modes.js timeline, §12.2, §12.3). From r 1.2 up, where the og and
 * cover pots and the back half of the video live, it is the old 3.6 + 7.2 r. Below that it closes in, because the hook opens on
 * a pot of r 0.14 that was 20 px across on a 540 px frame (FIX-LIST-3 R1). The two lines meet at r 1.2, so no zoom jumps.
 */
export const camWRec = r => (r < 1.2 ? 1.2 + 9.2 * r : 3.6 + 7.2 * r);
/**
 * R1: the view waits close on the pot until the first touch, then eases out to the follow width, so the first thing on
 * screen is the character. Render only. L1 is the first impression and sits closest. Reduced motion, record and retries skip it.
 */
export const camOpenW = n => (n === 1 ? 0.72 : 0.84);
export const CAM_OPEN_S = 2.2;
/** Near + far table the view may show past the board in depth (the clamps' 0.6 u + 2 u), and that view's slack. */
export const CAM_EDGE = 2.6, CAM_SLACK = 1.15;
/**
 * The last-bite finisher, in seconds after the bite: when the push-in lands, when the boss hits the stew, when the camera
 * starts back and when it is home. Milestones (isMilestone, L10 ... L60) get the long beat with a held half-swallowed frame.
 * Both renderers read these. game.js and ui.js can too: this file imports nothing.
 */
export const FIN_BEAT = { push: 0.3, boom: 1.25, back: 1.4, end: 1.9 };
// DECISION (FIX-LIST-3 R5): the held frame runs 0.5 s longer (hold 1.6 -> 2.1, the rest moved with it). end must stay under the
// card: sim win 1.34 s after the bite + game.js FIN_BIG_CARD_S 2.0 = 3.34 s. ui.js reads boom and back from here.
export const FIN_BIG = { push: 0.55, boom: 2.4, back: 2.55, end: 3.1, sink: 1.05, hold: 2.1 };   // the boss sits half in from sink to hold
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How far the finisher's boss has gone into the stew, 0 to 1, by the finisher's clock. A milestone stalls near the halfway mark, still creeping, so the long hold is not a frozen frame. */
export const finQ = (B, t) => (B === FIN_BIG ? 0.5 * sstep(0.5, B.sink, t) + 0.1 * Math.min(1, Math.max(0, (t - B.sink) / (B.hold - B.sink))) + 0.4 * sstep(B.hold, B.boom, t) : sstep(0.32, B.boom, t));
/** R5: the world's speed through a milestone's held frame, 1 to 0.3: confetti hangs and the stew slows while the pot strains. Render clock only. */
export const finSlow = (B, t) => (B === FIN_BIG ? 1 - 0.7 * sstep(B.sink - 0.2, B.sink, t) * (1 - sstep(B.hold - 0.1, B.hold + 0.1, t)) : 1);
/**
 * R6: L60's fireworks, by the finisher's clock in seconds after the bite, shared by both renderers. at = when a shell bursts,
 * x and y = where on screen (-1 to 1, y up, kept in the upper part: the pot sits low). rise = how long its rocket climbs, 0 for none.
 */
export const FIREWORKS = n => (n === 60 ? [
  { at: 2.42, x: -0.5, y: 0.24, rise: 0.5, c: 0 }, { at: 2.6, x: 0.52, y: 0.3, rise: 0.55, c: 1 }, { at: 2.78, x: 0.02, y: 0.1, rise: 0.5, c: 2 },
  { at: 2.95, x: -0.62, y: 0.72, rise: 0.4, c: 3 }, { at: 3.12, x: 0.6, y: 0.74, rise: 0.4, c: 4 }, { at: 3.3, x: -0.1, y: 0.28, rise: 0.45, c: 1 }, { at: 3.6, x: 0.34, y: 0.12, rise: 0.45, c: 0 },
] : null);
export const FIREWORK_COLS = [['#FF5A4F', '#FFD0C8'], ['#FFD34D', '#FFF6D0'], ['#4FC3FF', '#DCF4FF'], ['#7CE08A', '#E4FFE8'], ['#FF7FB0', '#FFE3EF']];
/**
 * How much bigger a milestone's boss is drawn, render only (the sim's a never changes): up to BOSS_BIG, stopping when its
 * footprint would pass the board's rim by more than 0.9 u. b = { x0, x1, z0, z1 }. L60's lighthouse was a 40 px tower in a corner.
 */
export const BOSS_BIG = 1.6;
export const bossBoost = (a, x, z, b) => Math.max(1, Math.min(BOSS_BIG, ((b ? Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z) : 1e3) + 0.9) / Math.max(1e-3, a)));
/** Pull-back cap never lets the pot pass this share of the screen width: width >= r * CAM_POT_FLOOR. */
export const CAM_POT_FLOOR = 4;
/** The title's width. Portrait keeps 7.5. Landscape scales with the aspect, so the same depth of board shows as on a phone
 *  and the whole picnic reads behind the UI at 1440x900, 1920x1080 and 844x390 (a flat 15 sat on one blanket). */
export const camTitle = (w, h) => (w > h ? Math.max(15, 14 * w / h) : 7.5);
