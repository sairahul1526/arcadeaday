// Slurp Pot: the follow camera's width, shared by render3d.js, render2d.js and the crumb sizing.
// Its own file because render2d.js may never import render3d/props (three.js) and render3d should not pull the whole
// 2D fallback into every boot. logic.js VIEW_R / SEE_R stay on the old width on purpose: they are sim, not camera.

/**
 * World units across the screen when following a pot of radius r (portrait; landscape multiplies by 1.35).
 * DECISION (11-06 Fri, round 2, curator "25 to 30 % of the width", kid13 "L1 pot is tiny"): 1.6 + 6.2 r, so the pot spans
 * about 17 % of a portrait screen at r 0.3 and 26 % at r 1 (it was 13 % and 22 %). The pull-back cap still wins late.
 */
export const camW = r => 1.6 + 6.2 * r;
/** The width the record, og and cover framings were tuned on (modes.js timeline, §12.2, §12.3): they keep it. */
export const camWRec = r => 3.6 + 7.2 * r;
/** Near + far table the view may show past the board in depth (the clamps' 0.6 u + 2 u), and that view's slack. */
export const CAM_EDGE = 2.6, CAM_SLACK = 1.15;
/**
 * The last-bite finisher, in seconds after the bite: when the push-in lands, when the boss hits the stew, when the camera
 * starts back and when it is home. Milestones (isMilestone, L10 ... L60) get the long beat with a held half-swallowed frame.
 * Both renderers read these. game.js and ui.js can too: this file imports nothing.
 */
export const FIN_BEAT = { push: 0.3, boom: 1.25, back: 1.4, end: 1.9 };
export const FIN_BIG = { push: 0.55, boom: 1.9, back: 2.05, end: 2.6, sink: 1.05, hold: 1.6 };   // the boss sits half in from sink to hold
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How far the finisher's boss has gone into the stew, 0 to 1, by the finisher's clock. A milestone stalls at the halfway mark. */
export const finQ = (B, t) => (B === FIN_BIG ? 0.5 * sstep(0.5, B.sink, t) + 0.5 * sstep(B.hold, B.boom, t) : sstep(0.32, B.boom, t));
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
