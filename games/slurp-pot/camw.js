// Slurp Pot: the follow camera's width, shared by render3d.js, render2d.js and the crumb sizing.
// Its own file because render2d.js may never import render3d/props (three.js) and render3d should not pull the whole
// 2D fallback into every boot. logic.js VIEW_R / SEE_R stay on the old width on purpose: they are sim, not camera.

/** World units across the screen when following a pot of radius r (portrait; landscape multiplies by 1.35). */
export const camW = r => 2.6 + 6.6 * r;
/** The width the record, og and cover framings were tuned on (modes.js timeline, §12.2, §12.3): they keep it. */
export const camWRec = r => 3.6 + 7.2 * r;
/** Near + far table the view may show past the board in depth (the clamps' 0.6 u + 2 u), and that view's slack. */
export const CAM_EDGE = 2.6, CAM_SLACK = 1.15;
/** Pull-back cap never lets the pot pass this share of the screen width: width >= r * CAM_POT_FLOOR. */
export const CAM_POT_FLOOR = 4;
/** The title's width. Portrait keeps 7.5. Landscape scales with the aspect, so the same depth of board shows as on a phone
 *  and the whole picnic reads behind the UI at 1440x900, 1920x1080 and 844x390 (a flat 15 sat on one blanket). */
export const camTitle = (w, h) => (w > h ? Math.max(15, 14 * w / h) : 7.5);
