# Knot Kitty: fix list for the next run (QA swarm, 2026-10-16 night)

Source reports: qa/phone.md, qa/desktop.md, qa/playables.md, qa/feel.md, qa/state.md (screenshots in qa/*/).
QA scores:
- phone: touch 7, readability 6
- desktop: 6
- playables: compliance 8, video 5, thumbnail 6
- feel: fun 7, juice 6, art 8, audio 6, meta 6
No BLOCKERs.

## Round 1: MAJOR (must fix before the critics)
1. **Glyphs that look like YouTube controls.** The colour-blind glyphs read as play, pause and record (render.js:35-38), which PLAYBOOK §2 bans. Replace them with non-UI shapes (heart, star, diamond, paw, moon, leaf…). Make them visible at 320×480 at 1× (phone M3).
2. **Taps lost during spool fly-off.** A two-tap burst drops a tap, because `sess.buffered` holds only one (play.js commit ~302). Queue the taps and show the pending pull at once (phone M2, feel #7).
3. **Wrong booster at 320×480.** The 44 px hit areas overlap, so Undo fires Hint. Fix layout.js boosterRects / ui.js hitBtn by picking the nearest centre, or a 2-row layout (phone M1). Boosters are 26 px; raise them toward 44.
4. **Board too small on big screens.** fitBoard caps the unit at 90 px (layout.js ~104, render.js ~2030), so at 4K the board covers 10–17% of the width. Scale it with the viewport (desktop M1, playables).
5. **Desktop has no hover or pointer cursor** (ui.js pointer move). Fix that (desktop M2).
6. **The Z kink at strand bends is still visible** (render.js drawYarnRun) (desktop M3).
7. **Boosters charge when they can't be used:** Slot already used, Undo with nothing to undo, Hint on a doomed board. Check first, then charge (ui.js tapBooster/loseBooster vs play.js applyBooster) (state M1).
8. **No way back to All Beaten or Bonus Tangles.** Make the map trophy tappable (ui.js drawMap/mapTap) (state M2).
9. **Video (?record=1):**
   - the "CHAIN ×3!" pop never appears
   - two callouts overlap at 13.3–15 s
   - 4.5 s of dead air at 6.5–11 s
   - the end-card Kitty is about 4 px tall: drawKitty takes px, but modes.js passes 2.6*k*1.6
   - the win must be 3★
   - frame 1 needs the hook caption
   - use a 20-strand board
10. **Lose card:** Kitty stays happy (kittyAnim('sad') is not honoured), the card covers the top of the board, and free strands get no ✕.

## Round 2: feel and juice (needed to reach critic ≥ 8 / mean 9)
- Spools 2× bigger, drawn as wooden bobbins (render.js spool, layout.js rack).
- A celebration on every chain (play.js arrive a>=2→a>=1, ui 'chain', audio).
- Combo escalation for back-to-back spools: pitch ladder, hit-stop, shake.
- Kitten names, plus a Kitten Corner room where rescued kittens play.
- Denser late boards with readable boss shapes. Re-check readability at 24–26 crossings once levels v2 lands.
- Sync the star sounds to the 'star' event. Improve the win-card wording.
- OG thumbnail: a denser, tilted board with the kitten front and centre.

## MINOR
- **Map:** the World 2 banner sits under PLAY with no backing strip; map scroll is kept in raw px across a resize.
- **Screens:** Daily from the title swaps the world; the haptics toggle shows on desktop; Esc does nothing on the map; hard seams between world bands.
- **Duplicate link:** the in-canvas "more games" duplicates the web nav chip. Hide it when nav.back exists (ui.js ~960).
- **Performance:** with no GPU, large backing stores drop to 14–22 fps (game.js MAX_PIXELS). Lower the cap.
- **Host pause:** taps still go through while the host has paused; pause listeners are wired only after the save loads.
- **Daily:**
  - a clock set backwards pays the daily again
  - a daily won 15+ days ago can be won again
  - a replayed bonus pays again
  - the GDD says daily replays are allowed, but the UI disables them
- **Win card:** pause→Map during the kitten-free beat skips it.
- **Lesser points:** the basket shows on L1; small board in landscape; booster fly-in passes over Undo.
- **Checker:** also assert `__qa().T` in the checker (tools/playables-check.mjs) so a regression in in-game time is caught.

## Fix round 1 status (2026-10-16 night): logs in studio/2026-10-16/fix1/
- RENDER done: new glyphs, Z kink, bobbins, sad Kitty, pending pulse, shake/hitStop, OG redo. Left: L40 has 1/3 empty board (levels).
- META/AUDIO done: daily/bonus exploits, kittenName(i), chain/combo ladder, spool thunk, star-synced bells, lose sting.
- PLAY done: tap queue (0 lost in 6/6 bursts), chain/spoolDone events, canUseBooster, host-pause input, win beat, MAX_PIXELS 6.0M. Left: at 4K dpr1 (8.3M px) the scene.js bake gets re-copied each frame in software Chromium; tile or cap the bake.
- UI done: nearest-centre booster hits (44–46 px phone), uncapped board (~66% safe height at 1440), hover + cursors, booster guard, tappable trophy, map strips, Esc→title, lose card docked + ✕, CHAIN/COMBO pops, kitten names, L1 no basket. Spools ~1.55× (not 2×) to keep the board size.
- MODES done: 20-strand deterministic showcase, hook on frame 0, gaps ≤1.2 s, CHAIN ×3 at ~16 s, 3★ win, 520 px end-card Kitty, one callout at a time. Left for UI: in normal play the CHAIN pop overlaps the HUD subtitle, and COMBO overwrites CHAIN ×3 in the same frame (queue pops).
