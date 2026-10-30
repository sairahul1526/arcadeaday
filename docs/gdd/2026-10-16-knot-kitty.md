# Knot Kitty: Game Design Document (Day 10, 2026-10-16)

Single source of truth for production. Where this GDD gives a number, use it. Where it is silent, decide and add a `// DECISION:` comment at the top of your file. Prototype to reuse: `studio/2026-10-16/proto-knot-kitty/` (`logic.js` rules + exact solver + bots, `gen.mjs` generator, `render.js` yarn drawing, `audio.js` SFX). All paths below are relative to `/Users/sairahul/Documents/projects/poki/` unless absolute.

---

## 1. Fantasy and hook

| | |
|---|---|
| Title | **Knot Kitty** |
| Slug | `knot-kitty` |
| Save prefix (`store`) | `kk_` |
| Tagline | "Pull the yarn in the right order. Free the kitten." |
| Primary SEO keyword | **yarn game online** (alt in copy: "untangle game", "yarn sort puzzle") |
| Genre | Puzzle (untangle + colour sort), ages 8–80 |
| Icon (games.json) | 🧶 |
| Accent | `#E8463A` |

**Fantasy:** a kitten is tied up in a tangle of yarn on a cosy pegboard. You are the knitter's helper: pull the top strand, it slithers peg by peg off the board and winds onto its colour spool. Order matters twice: only a strand with nothing over it can move (**over/under**), and only the two active spools take yarn (**spool order**). Anything else waits in a small **basket**. Fill the basket with no strand that fits a spool, and you're out of room. Pull the last strand and the kitten pops free on the board, shakes, purrs and joins your Kitten Corner.

**Hook in 5 s, no text:** one strand glows and bobs (it's on top), a hand taps it, it zips off with a pluck per peg, a spool winds a third full with a rising "ding", the kitten loosens.

**Depth:** reading depth is the easy half (free strands are lifted and bright). The real skill is the queue: which strand to sacrifice to the basket so that the next spools find their yarn uncovered. Stars measure the basket peak vs the solver's optimum.

---

## 2. Controls

| Action | Touch / mouse | Keyboard (bonus) |
|---|---|---|
| Pull a strand | **Tap** (pointerdown shows a preview, pointerup within 24 CSS px of the down point commits; slide further = cancel) | none (no keyboard strand picking) |
| Peek blockers | Press and hold ≥ 0.35 s on a covered strand: its blockers get red rings, nothing is pulled on release | none |
| Booster | Tap booster button, then (Snip only) tap a target strand | `U` Undo, `H` Hint |
| Pause | Pause button (top-left of HUD) | `P` or `Esc` toggles pause; `Esc` closes any open dialog |
| Menus | Tap buttons | `Enter`/`Space` = the screen's primary button |
| Retry | Retry button in HUD or on cards | `R` |

Rules: pointer events only (`pointerdown/move/up/cancel`), `touch-action:none` on the canvas, primary pointer only (ignore a second simultaneous pointer). Keyboard handler copies Kiss the Edge's rules: ignore non-game keys; `if (screen !== 'play' && scrollY > 40) return;`; `preventDefault()` before the `e.repeat` check, **never** for `Escape`. No hover-only features (hover only lifts a button by 2 px on mouse).

---

## 3. Core loop, meta loop, economy

### 3.1 Board and pieces
- **Peg grid:** `cols × rows` pegs at integer coords, plus half-steps (pegs may sit at x.5 / y.5). Limits: `cols 4..8`, `rows 4..10` (so the board fits 320×480, §7.6). Peg coordinate range `x ∈ [0, cols-1]`, `y ∈ [0, rows-1]`.
- **Strand:** a curve through 2–4 pegs (`pegs`), 2-peg strands bowed by `bow` (fraction of length, |bow| ≤ 0.12), 3–4-peg strands are centripetal Catmull-Rom (proto `strandCurve`). Each strand has colour `c` (0–5, or 6 = rainbow) and depth `d` (higher = on top).
- **Crossing:** two strands intersect at most once; the one with higher `d` is over. A strand is **covered** while any un-pulled strand crosses over it.
- **Geometry rules (generator-enforced, from proto):** min crossing angle 38°, crossing ≥ 0.5 units of arc from a strand end, crossings ≥ 0.62 apart, no near-parallel run (< 0.5 apart away from a crossing), strand centre ≥ 0.45 from other strands' pegs, no two pegs < 0.9 apart.
- **Strand budget:** ≤ 24 strands per normal level, ≤ 26 on bosses and dailies, never more than 28 anywhere (bitmask limit 31).
- **Colours per level:** ≤ 5 (≤ 4 before L21). Every colour count is a multiple of its spools' sizes.

### 3.2 Spools, queue, basket
- `queue`: ordered list of spools. Entry = colour int (`n = 3` strands) or `{c, n: 6}` (Jumbo spool, from L42).
- **2 active spool slots.** At level start the first 2 queue entries are active (L1 has 1 entry, so 1 slot shows; L2 shows both colours).
- **Visible queue:** the next **2** spools sit on the rack shelf to the right of the active ones, NEXT one larger (designer fix: surface the planning horizon). Beyond that: a "+N" chip.
- **Basket:** `cap` slots (3–5). A pulled strand with no active spool of its colour (with room) becomes a yarn ball in the first free basket slot.
- **Spool completes** when it holds `n` strands → it rolls off (0.45 s), the next queue entry rolls into that slot (0.30 s), and immediately absorbs matching basket balls (left to right) until full: a **chain**. If that completes it again, repeat (`settle` loop, proto).
- If two active spools share a colour, a strand goes to the **fuller** one (proto `slotFor`).

### 3.3 Move resolution (one tap)
`canPull(puz, st, id)` is checked in this order; the first failure wins:
1. `removed` → ignore tap.
2. **covered** (any un-pulled strand over it, or over any member of its knot group) → blocked feedback: strand wiggles 0.38 s, red rings (radius 0.45 unit, 3 px stroke `#E8463A`, 0.7 s fade) on each blocking crossing, blocker strands flash a white rim 0.3 s, soft "thup" SFX, kitten flinches. **No penalty** (no hearts, not counted for stars).
3. **locked** (its lock's key strand not yet pulled, from L14) → padlock jiggles + key charm on the key strand pulses + "clack".
4. **paw** (sleepy paw counter > 0, from L28) → paw twitches, counter bubble bounces.
5. **full**: no active spool takes it AND the basket is full → refused. Basket shakes, its rim flashes red, "Basket full!" callout (once per level), strand wiggles. Not a loss. (Fixes "panic-basket" overflow: a loss only happens when there is truly no move.)
6. Otherwise **pull**: the whole knot group is removed in one move (in group order: covered-by-the-other member second). Each strand goes to a spool or the basket; events fire (§13.4).

After each pull:
- **Win**: all strands removed → kitten freed (§7.4), win card after 1.6 s.
- **Stuck** (dead end): not won and `legalMoves(puz, st)` is empty (basket full, no free strand fits a spool, or every free strand is locked/pawed). Detected **the same frame** the pull resolves. As soon as flights land (≤ 0.6 s) the **Out of Room** card opens (§9.6) with Undo / +1 Slot / Retry. Never wait for another tap.
- **Doomed** (soft): the core runs `solve(puz, st, 40000)` in a deferred task after each pull. If it proves no win is reachable (`exact && peak === Infinity`), the Undo booster pulses (scale 1→1.12, 1.2 s loop). No text, no reveal of which move was wrong.
- **Basket warning**: when `bt === effectiveCap - 1` the basket glows amber and the "basket almost full" chime plays (no text after L5).

### 3.4 Input during animations (fix #7)
Rule state resolves instantly; visuals lag. While any spool is **rolling off or rolling in** (`spoolBusy`, ≤ 0.75 s), a committed tap is **buffered** (one slot; a newer tap replaces it) and resolved the frame the incoming spool lands, so the player always sees the spool the strand will go to. The press preview (§3.6) already shows the post-transition target. Strand flights do not block input.

### 3.5 Stars and par
- `par` = solver's minimum possible basket peak (exact DP; beam upper bound if the DP aborts, flagged `exact:false`).
- Stars from the level's basket **peak** `pk`: `pk ≤ par` → 3★; `pk ≤ par + 1` → 2★; else 1★. (Tighter than proto's +2 so stars separate skill; curation enforces the gap, §5.)
- HUD shows the 3★ line as a dashed marker on the basket after slot `par` ("stay left of the line") from L4. Using **Undo** does not lower the recorded peak (peak = max over the whole attempt). Using +1 Slot or Snip caps the result at 2★.

### 3.6 Press preview
On pointerdown over a pullable strand: the strand lifts (+3 px shadow offset), and a dotted ghost arc (cream, 40 % alpha, 2 px dashes) runs from its nearest end to its destination (spool slot or basket slot), destination pulses. On a covered strand: blockers ringed (as §3.3). Release commits (if within 24 px). This makes mis-taps cancellable and shows the basket choice before it is made.

### 3.7 Tap resolution (fix #5)
`pickStrand(x, y)`: candidates = un-pulled strands with screen distance to centre line ≤ `max(18 px, 2.4·sw)`. Keep those within `dmin + 0.9·sw`. Pick the **highest `d`** among them (top strand wins at a crossing). A tap on a crossing therefore always picks the over strand. Highlight strokes use the same cached Path2D as the strand (no separate polyline, which caused the "Z" kink).

### 3.8 Meta loop and economy
**Currency: Yarn Balls** (icon: small red yarn ball, abbreviated 🧶 in copy).

| Source | Amount |
|---|---|
| First win of a level | 10 + 5 × stars (15 / 20 / 25) |
| Star improvement on replay | +5 per new star |
| Replay win (no new stars) | 3 |
| Boss level (L10, 20 … 60) first win | ×2 of the above |
| Daily Knot win | 40 + 10 × stars, + streak bonus 10 × min(streak, 7) |
| Star milestone (every 15 total stars) | gift box: 60 balls + 1 random booster |
| World complete (first win of L10, 20 … 60) | chest: 150 balls + 1 of each unlocked booster |
| Chain bonus (≥ 2 basket balls absorbed by one arriving spool) | +1 per ball absorbed beyond the first (shown as a small coin pop) |

Starting balance 50.

**Boosters** (counts stored in save; bought in the shop or on the Out of Room card):

| Booster | Unlocks (free gift on unlock) | Price | Effect |
|---|---|---|---|
| **Undo** | L4 (gift 3) | 30 | Reverts the last pull exactly (rule state + visuals snap, strand poofs back to its pegs). Unlimited uses per level while stock lasts. |
| **Hint** | L6 (gift 2) | 40 | Glows the solver's best next move from the current state for 4 s (gold rim + hand). If the state is doomed: shows the Undo button pulsing instead and refunds. |
| **+1 Slot** | L9 (gift 1) | 60 | Basket cap +1 for this attempt (max 1 per attempt). Caps stars at 2★. |
| **Snip** | L16 (gift 1) | 80 | Next tapped strand is pulled even if covered/locked/pawed (scissors snip animation). Caps stars at 2★. |

**Shop: Kitty Outfits** (games.json `shop`: name "Kitty Outfits", item noun "outfit"). Worn by the hero Kitty on the rack, map and win card:

| id | Name | Price |
|---|---|---|
| `tabby` | Plain Tabby | 0 (owned) |
| `scarf` | Cosy Scarf | 120 |
| `pumpkin` | Pumpkin Sweater | 200 |
| `witch` | Witch Hat | 300 |
| `snow` | Snowflake Jumper | 400 |
| `bow` | Café Bow Tie | 500 |
| `crown` | Yarn Crown | 750 |
| `astro` | Star Helmet | 1000 |

games.json `shop.items` = `[["Plain Tabby",0],["Cosy Scarf",120],["Pumpkin Sweater",200],["Witch Hat",300],["Snowflake Jumper",400],["Café Bow Tie",500],["Yarn Crown",750],["Star Helmet",1000]]`.

**Collection: Kitten Corner.** Each level's first win rescues that level's kitten (60 kittens: 6 breeds × 10 coat variants, deterministic from level id: breed = `(id-1) % 6`, coat = `floor((id-1)/6)`). Breeds: tabby, tuxedo, calico, siamese, black, ginger. Boss levels give a **golden** kitten variant if won with 3★ (else normal). Kitten Corner screen shows a 6×10 grid of portraits (silhouettes for un-rescued, "?" plate).

**Daily Knot** (§4.5): one per IST date, from L6 unlocked. Streak counter (consecutive IST days won). Missing a day resets to 0.

**Milestones visible on the map:** star bar to the next gift (e.g. "41 / 45 ★"), world chests at the end of each world path.

**Reason to return tomorrow:** the Daily Knot (new board, a kitten silhouette shown "tomorrow's kitten"), the streak flame, and the next world chest.

---

## 4. Levels

### 4.1 How levels are made
Seeded generator + solver-gated curation, run **offline** in Node (`tools/knot-kitty/gen.mjs`), output committed as data (`games/knot-kitty/levels-data.js`, `dailies-data.js`). The game never generates at runtime.

Pipeline per level id `L` (reuse proto `gen.mjs`; extend as below):
1. **Seeds:** `seed = L * 100003 + k`, `k = 0,1,2,…` (deterministic, reproducible).
2. **Geometry:** `genGeometry(spec, rng)` exactly as proto, inside the band's `cols × rows`, peg mask = `shape` template (§4.4) if set, else full rectangle; segment-count mix from band row (`segs`: probabilities of 2/3/4 pegs).
3. **Depth:** 150 random stackings, keep the one maximizing `2·longestChain − freeAtStart` (proto), subject to `free0` range from the band.
4. **Colours:** shuffled balanced assignment (counts from `colors`), colour indices drawn from the band's allowed palette subset (§7.2: never two "near" colours in the same level before L21).
5. **Twist decorations** (§4.3): knots, locks, mystery, paws, rainbow, jumbo, ice. Each is applied with its constraint and must keep the dependency graph acyclic.
6. **Queue:** proto `makeQueue` (from a random valid removal order, jittered by `jitter`), then jumbo merges.
7. **Gate (reject if any fails):** `solve()` exact with limit 600 000 states; `par` within band range; path-independence not assumed (memo key includes spool/basket signature, §13.3); bot targets (§5) on 300 runs each with seeds `seed+1..3`; `free0` in range; visual check: min crossing angle ≥ 38°, `crossings ≥ minX`.
8. **Curation score** (lower is better): `10·Σ band-distance(botRates, targets) + 4·|avgPeak(casual) − par − gapCasual| − 0.02·crossings + 3·(choiceCount < minChoice)`. `choiceCount` = number of states on the solver path where ≥ 2 legal moves exist and at least one of them raises the optimal peak (a real decision).
9. Search each level for up to 90 s or 60 valid candidates, keep the best; run levels in parallel (one Node process per band: `node tools/knot-kitty/gen.mjs --band C`).
10. Output per level: the JSON schema in §13.3 plus `stats`. A summary table goes to `studio/2026-10-16/prod-levels/levels-report.md` (id, seed, strands, crossings, par, rates).
11. **Handcrafted override:** L1 and L2 may be hand-edited in `levels-data.js` after generation if the generator can't hit the exact tutorial shape; they must still pass the gate (`node tools/knot-kitty/check.mjs` re-solves every level and fails on any mismatch).

### 4.2 Level table (per 5-level band)
`segs` = share of 2/3/4-peg strands. `free0` = free strands at start. Rates are first-try win targets for the casual / average / expert bots (§5.2). Bosses (L10, 20, 30, 40, 50, 60) override with the boss row of their band.

| Band | Levels | cols×rows | Strands | Colours | Cap | Queue jitter | segs | free0 | Par | New element (teach level) | Casual / Avg / Expert |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 1 | 4×4 | 3 | 1 | 3 | 0 | 1/0/0 | 1 (strict chain) | 0 | Pull (L1) | 100/100/100 (forced win) |
| A | 2 | 5×5 | 6 | 2 | 3 | 0 (queue `[0,1]`) | .5/.5/0 | 1 | 0 | Over/under (L2) | 100/100/100 |
| A | 3 | 6×6 | 9 | 3 | 3 | 9 | .5/.5/0 | 2 | 1 | Basket + first choice (L3) | ≥ 85/95/100 |
| A | 4–5 | 6×7 | 12 | 4 | 4 | 9 | .5/.4/.1 | 2–3 | 1 | Spool order + NEXT (L4) | 75–90/90+/100 |
| B | 6–9 | 7×8 | 13–15 | 4 | 4 | 9 | .45/.4/.15 | 2–3 | 1 | **Knots** (L8) | 65–80/85+/95+ |
| B | 10 boss | 7×9 cat-head | 18 | 4 | 4 | 10 | .4/.4/.2 | 2–3 | 1–2 | — | 55–70/80+/95+ |
| C | 11–15 | 7×8 | 15–17 | 4 | 4 | 10 | .4/.4/.2 | 2–3 | 1–2 | **Locks & keys** (L14) | 55–75/80+/92+ |
| D | 16–19 | 7×9 | 16–18 | 4 | 4 | 10 | .4/.4/.2 | 2–3 | 1–2 | (Snip unlock L16), mixes | 50–70/75+/90+ |
| D | 20 boss | 8×9 pumpkin | 20 | 4 | 4 | 11 | .35/.45/.2 | 2–3 | 2 | — | 45–60/70+/90+ |
| E | 21–25 | 7×9 | 17–19 | 5 | 4 | 11 | .35/.45/.2 | 2–4 | 1–2 | **Mystery yarn** (L21) | 45–65/72+/90+ |
| F | 26–29 | 8×9 | 18–20 | 5 | 4 | 11 | .35/.45/.2 | 2–4 | 2 | **Sleepy paws** (L28) | 40–60/70+/88+ |
| F | 30 boss | 8×10 heart | 22 | 5 | 5 | 12 | .3/.5/.2 | 3–4 | 2 | — | 35–55/65+/88+ |
| G | 31–35 | 8×9 | 19–21 | 5 | 4 | 12 | .3/.5/.2 | 2–4 | 2 | **Rainbow strand** (L35) | 38–55/65+/88+ |
| H | 36–39 | 8×10 | 20–22 | 5 | 5 | 12 | .3/.5/.2 | 3–4 | 2–3 | mixes (knots+locks) | 35–50/62+/85+ |
| H | 40 boss | 8×10 moon | 24 | 5 | 5 | 12 | .3/.5/.2 | 3–4 | 2–3 | — | 30–45/60+/85+ |
| I | 41–45 | 8×10 | 20–22 | 5 | 5 | 12 | .3/.5/.2 | 3–4 | 2–3 | **Jumbo spool** (L42) | 33–50/60+/85+ |
| J | 46–49 | 8×10 | 21–23 | 5 | 5 | 13 | .3/.5/.2 | 3–4 | 2–3 | **Frozen basket slot** (L49) | 30–45/58+/85+ |
| J | 50 boss | 8×10 star | 25 | 5 | 5 | 13 | .3/.5/.2 | 3–4 | 3 | — | 28–42/55+/82+ |
| K | 51–55 | 8×10 | 22–24 | 5 | 5 | 13 | .3/.5/.2 | 3–4 | 2–3 | all twists mixed (≤ 2 twist kinds per level) | 28–45/55+/82+ |
| M | 56–59 | 8×10 | 22–24 | 5 | 5 | 13 | .3/.5/.2 | 3–4 | 3 | all mixed (≤ 3 kinds) | 25–40/52+/80+ |
| M | 60 boss | 8×10 kitten | 26 | 5 | 5 | 13 | .3/.5/.2 | 3–4 | 3 | finale | 25–38/50+/80+ |

Minimum crossings `minX`: `round(1.1 × strands)` from band B on (L3: 7, L4–5: 12). `minChoice` (real decisions on the solver line): 1 at L3, 2 in A4–B, 3 from C on.

**Twist density after its teach level:** a twist appears in its teach level alone (only that twist new), then in ≥ 2 of the next 4 levels, then in ~40 % of later levels. Per-level twist parameters:

| Twist | Teach | Count per level |
|---|---|---|
| Knots | L8 (1 pair) | 1 pair L8–9, 1–2 from L10, 1–3 from L36 |
| Locks | L14 (1 lock) | 1 L14–16, 1–2 from L17 |
| Mystery | L21 (2 strands) | 2–4 strands, never > 30 % of strands |
| Paws | L28 (1 paw, N=4) | 1–2 paws, N ∈ [3, strands/2] |
| Rainbow | L35 (1) | 0–1 per level |
| Jumbo | L42 (1 of 6) | 0–1 per level |
| Ice slot | L49 (thaw 2) | 0–1, thaw K ∈ {2,3} |

### 4.3 Twist rules (exact) and how each first level teaches it
All twists live in `rules.js` (core logic), are drawn by `render.js`, taught by `ui.js` (hand + ghost, one callout).

1. **Knots (L8 "Tied Up").** `knots: [[a, b]]` pairs of strands that cross each other. A cream knot bead (radius 0.32 unit, ink outline, 3 wrap lines) sits on their crossing. Tapping either pulls **both**; group is free iff every member's blockers ⊆ group ∪ removed (and no lock/paw on any member). Strands resolve in order over-first; each goes to spool/basket independently (a pair may split: one to spool, one to basket). Teach: L8 starts with the knot pair as the only free group; hand taps it; both fly with a "double zip". Callout (above board): "Tied together: they go as one".
2. **Locks & keys (L14 "Lock & Key").** Strand `x` with `lock: k` has a padlock on its first peg; strand `y` with `key: k` carries a brass key charm at its arc midpoint. `x` can't be pulled until `y` is pulled. Up to 3 lock ids per level: lock shapes circle / triangle / square stamped on both padlock and key (colour-blind safe). When `y` leaves, the key flies to the padlock (0.4 s), padlock pops open and drops. Generator: `y` must not transitively depend on `x`. Teach: L14 has one lock; the key strand is free at start; hand points to the key strand after the player first taps the locked one (or after 3 s). Callout: "Pull the key strand to unlock".
3. **Mystery yarn (L21 "Mystery Yarn").** Strands with `m: 1` render as undyed grey wool (`#B9B2AE`, ply pattern hidden, "?" stitch marks) while covered; the frame they become free they **reveal** (0.35 s puff, colour fills along the strand). Logic unchanged; the solver knows the colour. Teach: L21 has 2 mystery strands, one becomes free after the first pull; hand points at it after reveal. Callout: "Grey yarn shows its colour on top".
4. **Sleepy paws (L28 "Cat Nap").** Strand with `paw: N` has a sleeping cat paw resting on it (at the peg nearest the board centre) and a number bubble N. Each pull of any other strand decrements all paw counters (knot pair = 2). At 0 the paw yawns and lifts away (0.5 s). Pullable only when counter is 0. Logic: free requires `st.count >= paw`. Teach: L28 one paw, N = 4; first tap on the pawed strand shows the paw twitch and the bubble bounce; callout: "Wait for the paw: pull N others first".
5. **Rainbow strand (L35 "Rainbow").** `c: 6`. Drawn as 6-colour stripes running along the strand (each 1 unit long), plus a sparkle. Goes to the **fuller** active spool with room (ties: slot 0). If no active spool has room it goes to the basket as a rainbow ball, which any arriving spool absorbs first. Counts as one strand of that spool's colour. Total-count rule: colour counts + rainbow count = Σ spool sizes. Teach: L35 basket at `cap−1` after a forced opening; the rainbow strand is free and saves you. Callout: "Rainbow fits any spool".
6. **Jumbo spool (L42 "Big Spool").** Queue entry `{c, n: 6}`: a taller gold-rimmed spool with 6 fill marks. Stays active longer, so it blocks a slot. Coins: completing a jumbo pops +5. Teach: L42 first queue entry is a jumbo; callout: "Big spool: 6 strands".
7. **Frozen basket slot (L49 "Cold Snap").** Level field `ice: {thaw: K}`: the **last** basket slot is an ice block (crack stages) and can't hold yarn until K spools have completed; effective cap = `cap − 1` until then. Teach: L49 `thaw: 2`, the board forces two quick spool completions; the ice cracks on each completion and shatters at 0. Callout: "Ice slot thaws after 2 spools".

### 4.4 Shape templates (boss boards)
Peg masks over the half-grid, defined in `gen.mjs` as functions `(x, y, cols, rows) → bool`: `pumpkin` (ellipse 0.92×0.80 of the board with a 1-peg stem notch at top), `cathead` (circle + two triangle ears), `heart`, `moon` (circle minus offset circle), `star` (5-point, inner radius 0.5), `kitten` (cat head + body oval). Pegs outside the mask are not available; the board frame still draws the full rectangle, with the silhouette shown as a faint felt patch (§7.3). If no valid candidate in 90 s, retry with the mask dilated by 0.5; never ship a boss without its shape.

### 4.5 Daily Knot, endless, end of content
- `dailies-data.js`: **60** boards generated by the same pipeline with band row "daily": 8×10, 20–24 strands, 5 colours, cap 5, two random twist kinds from those taught by L40 (knots, locks, mystery, paws, rainbow), casual 35–55 %, expert ≥ 85 %.
- **Seeding by IST date:** `key = YYYY-MM-DD` computed in IST (`new Date(Date.now() + 5.5*3600e3).toISOString().slice(0,10)`). `day = daysBetween('2026-10-16', key)`. Board index `i = (day * 37) % 60`. Then a deterministic transform from `rng(hash(key))`: mirror X (50 %), mirror Y (50 %) and a colour permutation of the board's colours (relabel, so `par` stays valid). Same board for every player that day.
- Daily is unlocked after L6. Win → reward (§3.8), streak +1 (once per date), the day stamp on a 7-day strip. Replays allowed, reward once.
- After **L60**: the map's last node shows the trophy; the Next button on L60's win card opens the **All Beaten** screen: "All 60 kittens rescued! New tangles soon" + buttons **Daily Knot** (primary) and **Bonus Tangles** (endless: plays `dailies-data` boards in order `i = bonusIdx % 60` with transform seeded by `bonusIdx`, 10 + 5×stars balls each, no kitten). The game **never** silently loops back to L1. Replaying any old level from the map stays available.

---

## 5. Difficulty curve

### 5.1 Ramp principles (fixes playtest #4, #9)
- Strand count rises by ≤ 3 per level outside bosses (the proto's 15 → 24 jump is banned). Bosses +2–3 over their band.
- A new twist is the **only** new thing in its teach level, with strands −2 vs the band.
- Every level after L3 has ≥ 1 real decision (curation `minChoice`).
- After each boss, the next level is a breather (band's low end of strands, casual target +10).

### 5.2 Bots (in `rules.js`, run by `gen.mjs` and QA)
All bots play only legal moves (rule §3.3: a full-basket non-fitting tap is refused, so bots never "overflow"); a bot loses when stuck.
- **random:** any legal move.
- **casual** (models a first-time phone player): with prob 0.85 picks uniformly among legal strands that fit an active spool, if any; otherwise (or 15 % of the time, a "didn't notice") picks uniformly among all legal moves. Treats mystery strands as unknown colour (never "sees" them fit). Ignores the NEXT spools.
- **average:** always takes a fitting strand if one exists (prefers the fuller spool's colour); when it must basket, prefers a strand whose colour is the NEXT spool's colour, else one already in the basket (pairs up), else random. Sees 1 spool ahead.
- **expert:** proto `look` bot (scores uncovering strands of active + next 2 colours, pairs in basket), plus a 1-ply safety check: never takes a move that makes the state stuck when another move exists.
- Each bot run = 300 games with seeded rng; record `winRate`, `avgPeak` (wins only), `stars` distribution.

### 5.3 Star separation (fixes "stars barely separate skill")
Curation requires, from band B on: `expert.avgPeak ≤ par + 0.6` and `casual.avgPeak ≥ par + 1.2` (on wins). Targets for 3★ rate: casual ≤ 25 %, expert ≥ 60 %.

### 5.4 Fail feels fair
- No penalty for blocked/locked/pawed/full taps (they're feedback, not mistakes).
- A loss only happens at a true dead end, detected instantly, with the reason drawn (full basket, the spools' colours, free strands greyed with a "✕" on each).
- Out of Room offers Undo (most players have stock) before Retry. Retry is instant (≤ 0.3 s, same board).
- The doomed pulse warns before a dead end without solving it for you.
- Readability gate (§7.6) so no loss comes from a misread crossing.

---

## 6. Score
`P.best(n)` with `n = totalStars * 100 + levelsBeaten` (`totalStars` = Σ best stars over L1–60, max 180; `levelsBeaten` = count of levels with ≥ 1★). Only rises. Call it after every win (and on boot after migrate, so the hub/yt score equals the save). Daily and bonus tangles do not change it. Example: L1–5 all 3★ → 1505.

---

## 7. Art bible

### 7.1 Style
Cosy hand-knit storybook, all code-drawn (Canvas 2D paths, gradients, no images). Soft rounded shapes, thick plum-ink outlines (`INK #2B2440`), warm lamp light from the upper left, felt and wood textures made from dashed strokes and subtle noise dots. Line weights in UI units `u` (§9.1): outlines 2.5u on characters/panels, 1.5u on props, 1u on far background. Shadows are offset dark strokes or ellipses with alpha, **never `shadowBlur`** (perf).

### 7.2 Palette

| Role | Hex |
|---|---|
| Ink (outlines, text on light) | `#2B2440` |
| Cream (panels, wool) | `#FFF4E4` |
| Cream shade / stitch | `#E9D3B5` |
| Walnut (frame, wood) | `#6B4329`, light `#9A6A45`, dark `#4A2C1A` |
| Pegboard felt | `#E8D5BC`, felt dots `#D9C2A3` |
| Brass (pegs, keys, locks) | `#E0A93B`, shine `#FFE3A1`, shade `#9C6B1E` |
| Good / primary button | tomato `#E8463A`, bottom `#B8322A` |
| Secondary button | teal `#1FB0A0`, bottom `#167C71` |
| Warning (basket) | amber `#FFB23F` |
| Blocked ring | `#E8463A` |
| Star gold | `#FFC93C`, outline `#B9811A` |

**Yarn colours** (index = `c`). Each has a **glyph** stamped along the strand every 1.1 units of arc (glyph colour = base mixed 45 % with ink, size 0.55·sw), repeated big on its spool label and on basket balls. Colour is never the only signal.

| c | Name | Base | Glyph |
|---|---|---|---|
| 0 | Tomato | `#E8463A` | dots ● |
| 1 | Teal | `#1FB0A0` | chevrons › (pointing along the strand) |
| 2 | Mustard | `#F5B82E` | cross-bars (short bars across the strand) |
| 3 | Sky | `#3D86EE` | double rail = (two thin lines along the strand) |
| 4 | Plum | `#8C55D3` | rings ○ |
| 5 | Lime | `#86C440` | small crosses × |
| 6 | Rainbow | stripes of 0–5, 1 unit each | sparkle ✦ every 2 units |

Colour subsets per band (generator): L1–20 pick from {0,1,2,3}; L21+ any 5 of 6. Hues are ≥ 35° apart; tomato/plum and teal/lime are never both in a level before L31.

### 7.3 Yarn and board rendering
- **Strand width** `sw = clamp(0.27 × unit, 6.5, 22)` CSS px (`unit` = peg spacing in px). Casing (ink) `sw + 2.5`.
- **Draw order:** by depth `d` ascending. Each strand: (1) contact shadow: stroke `rgba(43,36,64,0.30)` width `sw+3`, offset (+1.5, +2.5) px; (2) ink casing; (3) body colour; (4) diagonal ply dashes (darker shade, dash `[0.35sw, 0.55sw]`, width 0.32·sw); (5) glyphs; (6) highlight: white 0.18·sw line offset −0.22·sw on the light side.
- **Free (pullable) strands:** lifted: shadow offset doubled, bright body, highlight on, idle bob 1.5 px at 2.2 Hz (phase per strand), soft cream outer glow (extra stroke `rgba(255,244,228,0.5)` width `sw+6` under the casing).
- **Covered strands:** body mixed 22 % toward `#8F8580`, no highlight, glyphs kept at full contrast (so the glyph identifies colour even when dimmed). Do **not** desaturate further (fix: dim-on-dim confusion).
- **Under-crossing:** the over strand's casing plus a 2 px felt-coloured gap each side (`sw + 6.5` felt stroke drawn just before the over strand, clipped to 0.9 unit around each crossing point) so the lower strand is visibly cut.
- **Pegs:** brass circle radius 0.16 unit (min 3.5 px), ink 1px outline, shine dot. Lock pegs: padlock icon 0.42 unit. Ends of strands loop around their pegs (small ring).
- **Pegboard:** rounded rect, walnut frame 0.35 unit thick with wood grain lines, felt interior with a dotted texture (dots every 0.5 unit, `#D9C2A3`, r 1px). Boss shapes: the silhouette is a slightly lighter felt patch `#F1E2CB` with a stitched outline.
- **Static bake:** all non-moving strands + board are baked to an offscreen canvas, re-baked only when the removed set, lift set, wiggle set or layout changes. Moving strands (flight, wiggle, bob) draw live. Bob can be omitted from the bake and done as a cheap live redraw of the few free strands.
- **Pull flight (proto):** the strand lifts 0.07 s, then slithers off peg by peg from the end nearest its target (pluck SFX per peg), travels along its own path then a curve to the target; duration `clamp(0.34 + len/(2600·ui), 0.34, 0.75)` s; a trail of 4 fluff particles.
- **Spool:** wooden bobbin (walnut flanges, ink outline), height 1.0 rack unit; label disc with glyph. Fill **exactly proportional**: wraps drawn = `round(16 × shown/n)` horizontal yarn bands, so 1/3 looks a third full (fix #8), plus `n` pip dots under it (filled = shown). Wind: spool spins (stripe scroll) 0.4 s and squashes 1.08/0.94. Complete: hop, spin, roll off to the right 0.45 s with confetti in its colour. Enter: rolls in from the shelf 0.30 s with a bounce. Jumbo: 1.4× taller, brass rims, 6 pips.
- **Basket:** woven wicker (two-tone weave `#C98B4E`/`#A86A34`), `cap` round slots; balls = yarn ball with wrap lines + glyph. Ice slot: pale-blue ice cube `#BFE6F5` with crack lines per stage. 3★ line: dashed gold marker after slot `par`.

### 7.4 Characters and animation list
**The kitten (on the board):** sits on the frame's bottom ledge, centred, 1.6 units tall; overlaps only the frame (never strands; generator keeps strands ≥ 0.35 above the last peg row). Coat from §3.8 breed/coat. It is wrapped in 4 yarn loops in the level's first 4 colours.

| State | Trigger | Animation |
|---|---|---|
| Tangled | progress < 25 % | ears down, sad eyes, 4 loops, slow sway |
| Worried | 25–50 % | 3 loops (one drops with a bounce at the threshold), looks at the last pulled strand |
| Hopeful | 50–75 % | 2 loops, ears up, tail wiggle |
| Excited | 75–<100 % | 1 loop, wriggles, little hops |
| Flinch | blocked tap | 0.25 s squish + eyes shut |
| **Freed** | last strand pulled | last loop snaps off, kitten leaps 0.8 unit, spins, lands with squash, shakes (0.4 s), happy eyes `^ ^`, purr hearts (12), stays on the board happy (sitting, tail swish) under the win card |
| Golden | boss 3★ | gold sparkle coat |

**Kitty (hero):** orange tabby (`#F29B4B`, stripes `#C96B26`, belly cream), sits at the rack's left end (portrait) or on top of the rack panel (landscape), wears the selected outfit. Animations: idle (tail sway 0.5 Hz, blink every 3–5 s), swat (paw swipe toward the spool on each wind, 0.25 s), cheer (paws up on spool complete), worried (ears back while basket ≥ cap−1), celebrate (win: jump + spin), sad (Out of Room: droop), sleep (title idle after 10 s: Zzz).

**Ambient cats:** per world, 1–2 small cats in the scene (e.g. one asleep on the shelf with a tail flick every 4 s, one batting a hanging toy). Drawn at 0.6 scale, muted colours so they never compete with the board.

### 7.5 Worlds (6 × 10 levels)
Every world uses the same layers: **backdrop** (wall + window with sky), **midground** (furniture), **props**, **characters** (ambient cats), **ambient animation**, **lighting** (one warm light pool + vignette). Fill the whole screen outside the safe rect with scene, never bars.

| W | Levels | Name | Backdrop | Midground / props | Ambient | Light |
|---|---|---|---|---|---|---|
| 1 | 1–10 | **Autumn Den** | wallpaper `#F3D9B8` with leaf print, window: dusk sky `#F6A86B→#7C4E7A`, maple tree | bookshelf, armchair, knitting basket, 2 small pumpkins, plant | falling leaves past window, mug steam, cat asleep on armchair | lamp pool upper-left `rgba(255,214,150,.35)` |
| 2 | 11–20 | **Pumpkin Night** (Halloween) | dark plum wall `#3B2A4A`, window: full moon `#FFF1C2`, bats, purple sky `#2A1F45→#5B3A6E` | carved jack-o'-lanterns (glowing), candles, witch-hat on a hook, cobweb corners, cauldron of yarn | candle flicker, bats crossing every 8 s, black cat with glowing eyes on the sill | orange jack-o'-lantern glow `rgba(255,140,40,.3)` + moonlight beam |
| 3 | 21–30 | **Snowy Cabin** | log wall `#8A5A3C`, window: snowfall, pines, night blue `#24345C` | fireplace with fire, stockings, rug, cocoa mug | snow particles, fire flicker, cat by the fire | fire glow lower-right |
| 4 | 31–40 | **Cat Café** | mint wall `#CDEBDD` with tiles, big shop window with street | counter, cake stand, chalkboard menu (doodles only, no text), cat tree | steam, ceiling fan, two cats on the cat tree | daylight window light |
| 5 | 41–50 | **Moonlit Attic** | sloped wooden roof `#5A4636`, round window with stars | trunks, dress form with sweater, fairy lights | fireflies/dust motes in moon beam, swinging lightbulb | cool moon beam + warm fairy lights |
| 6 | 51–60 | **Starry Rooftop** | night sky gradient `#141C3F→#3A2B6B`, city silhouettes | rooftop garden, telescope, string lights, blanket fort | twinkling stars, shooting star every 10 s, cat on the chimney | string-light warm pools |

**Seasonal title:** until `2026-11-02` (IST) the title screen and OG use the **Pumpkin Night** scene; after that Autumn Den. A constant `SEASON_END = '2026-11-02'` in `consts.js`; no level data depends on it.

### 7.6 Readability at size (gates)
- 320×480: the largest board (8×10) must give `unit ≥ 24 px` → `sw ≥ 6.5 px`; 375×812: `sw ≥ 8 px`. Glyphs drawn only if `sw ≥ 6.5` (always true by the gate).
- QA gate shot per band's densest level at 320×480 @1×: a reviewer must name the top strand at every crossing and the colour of every strand (via glyph) without zoom.
- Thumbnail (title/OG at 160×90): reads as "a cat + a colourful yarn tangle on a board". Title logo letters ≥ 18 % of thumbnail height.
- Min touch target 44 CSS px for every button; strand hit radius `max(18 px, 2.4·sw)`.

### 7.7 UI style
- Fonts (self-hosted, `../shared/fonts.css`): **Lilita One** for titles, numbers, buttons; **Nunito** 800 for labels/callouts, 700 for small text. Text always has a 2–3u ink stroke or sits on a panel.
- Panels: cream `#FFF4E4`, radius 18u, ink outline 3u, inner stitched border (dashed `#E9D3B5`, dash 6u/5u, inset 7u) = a "felt patch".
- Buttons: pill, height 52u, primary tomato with 4u darker bottom lip; press = move down 3u + squash; icon buttons circles 46u. Disabled = 45 % opacity.
- Logo: "Knot Kitty" in Lilita One, cream fill, 5u ink stroke, a strand of tomato yarn running through the "o" of Knot and a cat-ear notch on the "K" of Kitty.
- Icons (code-drawn): pause (two bars), retry (curved arrow), undo (back arrow), hint (bulb), +1 slot (basket with +), snip (scissors), star, yarn ball, gear, cart, paw (Kitten Corner), calendar (daily). No icon resembles YouTube player controls (no ▶ triangle alone: Play buttons use the word **PLAY**).

---

## 8. Audio bible
All procedural Web Audio in `audio.js`. One `AudioContext` created with `new AudioContext()` on the first user gesture. Graph: `sfxBus → master`, `musicBus → duck → master → destination`. Defaults: master 0.8, music 0.7 × 0.35, sfx 0.9 (settings sliders scale music and sfx buses 0–1, saved).

### 8.1 Music (one 8-bar loop per world, look-ahead scheduler 0.1 s, `setInterval` 25 ms only while running)
Voices (recipes): **pluck** = triangle osc, gain env A 5 ms D 0.35 s, lowpass 2.4 kHz; **bell** = sine + sine×2.76 at 0.3 gain, D 1.2 s; **pad** = 2 detuned sines (±6 cents) through lowpass 900 Hz, A 0.4 s R 0.8 s, gain 0.08; **bass** = triangle, D 0.3 s, gain 0.18; **tick** = 30 ms bandpass noise 6 kHz, gain 0.04; **brush** = 80 ms highpass noise 3 kHz, gain 0.03.

| World | BPM | Key / scale | Chords (2 bars each) | Lead | Perc |
|---|---|---|---|---|---|
| Title / map | world's loop with lowpass 1.2 kHz, −3 dB | | | | |
| 1 Autumn Den | 84 | F major pentatonic | F – Dm – Bb – C | pluck (felt piano feel), 8th-note arps | brush on 2 & 4 |
| 2 Pumpkin Night | 96 | D harmonic minor | Dm – Bb – Gm – A | bell (celesta), staccato | woodblock tick on off-beats |
| 3 Snowy Cabin | 76 | G major | G – Em – C – D | bell high octave (music box) | shaker (6 kHz noise) 8ths, soft |
| 4 Cat Café | 100, swing 0.58 | Bb major | Bb – Gm7 – Cm7 – F7 | pluck + pad (Rhodes feel, 5 Hz tremolo) | brush + bass walk |
| 5 Moonlit Attic | 70 | A Dorian | Am – D – Am – G | pluck harp arps 16ths | none, pad heavier |
| 6 Starry Rooftop | 90 | C Lydian | C – D – Em – D | bell + delay (0.33 s, fb 0.3) | tick 8ths |

Melody: generated once per world from a fixed seed (`rng(world*977)`): 8 bars, one note per beat on chord tones (60 %) or scale steps (40 %), rests 20 %, so it's deterministic and pleasant. Music fades in 1.5 s, crossfades 1 s between worlds.

### 8.2 SFX (reuse proto recipes where named)
| Event | Recipe |
|---|---|
| `pluck(i)` peg release | proto: triangle `420·2^(3i/12)` Hz 0.12 s + sine octave |
| `zip(dur)` strand slither | proto: bandpass noise 700→3200 Hz over `dur`, gain 0.32 |
| `wind(k, n)` spool takes strand (k = new fill) | sine 0.22 s + octave partial (proto); pitch steps C5 E5 G5 for n=3, C5 D5 E5 G5 A5 C6 for n=6, so fill is audible |
| `spoolDone` | proto: thunk 180→70 Hz + two bells 1046/1318 |
| `chain(m)` basket ball absorbed | rising pluck per ball: `660·2^(2m/12)` |
| `basket` | proto: soft thud 260→180 Hz + wicker noise |
| `blocked` | proto: soft "thup" square 140→110 Hz 0.09 s, gain 0.08 |
| `full` (refused basket) | two short amber beeps 660 Hz (proto `warn`) |
| `warn` basket at cap−1 | single 880 Hz triangle 0.08 s |
| `stuck` / lose | proto `fail` (descending 392→196) + sad meow |
| `meow` / `purr` | proto meow; purr = noise lowpass 400 Hz with 24 Hz AM, 1.2 s |
| `win` | proto arpeggio C E G C + kitten meow + purr |
| `star(i)` | bell at 784 / 988 / 1175 Hz, 0.25 s apart |
| `coin` | two sines 1318→1760 Hz 0.06 s |
| `unlock` | clack (noise 2 kHz 20 ms) + bell 1046 |
| `reveal` | sparkle: 4 bells random in 1.5–3 kHz, 40 ms apart |
| `pawYawn` | sine 300→220 Hz 0.4 s with vibrato |
| `iceCrack` / `thaw` | highpass noise burst 4 kHz 60 ms / glass bells 3 notes |
| `undo` | reversed zip: noise 3200→700 Hz 0.25 s |
| `hint` | bell 1568 Hz soft |
| `snip` | two 15 ms noise clicks 40 ms apart, 5 kHz |
| `click` / `buy` / `gift` | proto click / coin×3 / bell arpeggio |

### 8.3 Mix and ducking
Peak target −6 dBFS on master (a `DynamicsCompressor` threshold −10 dB, ratio 4 before destination). Music ducks to 40 % over 0.08 s for win/lose/gift stingers, back over 0.6 s. Max 24 simultaneous SFX voices (drop oldest). Pause: `ctx.suspend()`. `P.audioOn === false` → suspend and keep suspended; settings sliders still save.

---

## 9. Screens and flows

### 9.1 Layout (owned by `layout.js`)
All sizes in CSS px. `W, H` = canvas CSS size. Orientation: `portrait` if `H/W ≥ 1.15`, `landscape` if `W/H ≥ 1.15`, else `square`. Margin `m = 8u`.

| | Portrait / square | Landscape |
|---|---|---|
| `u` (UI unit) | `min(W/390, H/700)`, max 2.6 | `min(W/900, H/520)`, max 2.6 |
| HUD | top band, height 52u, full width | top band 52u, full width |
| Rack (2 active + 2 next spools + Kitty) | below HUD, height 96u | right column (38 % of width), top, height 120u |
| Callout band | below rack, height 34u | right column, below rack, 40u |
| Board | remaining middle area | left 62 % of width, below HUD, full remaining height |
| Tray | bottom band 76u: basket left 62 %, boosters right 38 % (4 × 40u buttons in a 2×2 grid if narrow, else a row) | right column bottom: basket row 70u, boosters row 56u |

`fitBoard(level, rect)`: `unit = min(rect.w / (cols − 1 + 1.2), rect.h / (rows − 1 + 1.2 + 1.4))` (1.4 = kitten ledge), `unit ≤ 90`; board centred; `sw = clamp(0.27·unit, 6.5, 22)`. Gate (§7.6): at 320×480 portrait this gives unit ≥ 24 for 8×10.

Square uses the portrait stack with `u = min(W/520, H/700)`. Everything outside the layout rects is scene. On resize: recompute layout, rebuild strand screen geometry, re-bake, keep all state (rule state, flights re-targeted by slot index, not by pixel).

### 9.2 One callout at a time
`ui.say(text, {pri, dur})`: a single callout slot drawn **only in the callout band** (never over the board, rack or tray). Nunito 800, 18u, shrinks to 13u then wraps to 2 lines; cream pill with ink outline. A new callout replaces the current one only if the current has shown ≥ 0.15 s and `pri ≥ current.pri`; otherwise it queues (max 2 queued, drop older). Callouts are suppressed while a card/dialog is open. The tutorial hand + its callout count as one callout. Big celebratory pops ("CHAIN ×3!", "+5") are drawn at the spool in the rack band with Lilita One and count as the callout (they yield the slot after 0.9 s).

### 9.3 Flow
```
loading → title ─PLAY→ (first run: play L1 directly) | map
map ─PLAY Lx→ play ─win→ win card ─NEXT→ play Lx+1 (or allbeaten after L60)
                    └─stuck→ outofroom ─Undo/+1→ play | ─Retry→ play (same level)
play ─pause→ pause ─Resume→ play | ─Map→ map | ─Restart→ play
title/map ─(icons)→ shop | kittens | settings | daily ─PLAY→ play(kind daily)
```
Every screen has exactly one primary (tomato) button. Esc: closes the topmost dialog (pause, shop, kittens, settings, daily, card → map is NOT triggered by Esc on win/lose; Esc on win/lose does nothing). P toggles pause in play.

### 9.4 Screens

| Screen | Content | Primary action |
|---|---|---|
| **Loading** | Cream background, spinning yarn ball, logo. First frame drawn → `P.firstFrame()`. | — |
| **Title** | Full seasonal scene (§7.5), big logo top third, a mini board with a 6-strand tangle and the tangled kitten centre, Kitty on the right wearing her outfit, ambient cats. Round icon buttons (bottom row): Daily (calendar, red dot if today's not won), Kittens (paw), Shop (cart), Settings (gear). Web only: small "more games" text button (via `P.link('../')`) bottom-left, under `P.canLink`. | **PLAY** (shows "LEVEL 12" under it when progress > 0) |
| **Map** | Vertical scroll (drag with inertia, wheel) up a yarn path through 6 room vignettes (each a mini version of its world scene). Nodes: 34u circles with number; stars under (3 small); current node pulses with Kitty standing on it; locked nodes grey + padlock; boss nodes 46u with shape icon; chest at each world end. Top bar: home, "★ 41 / 45" star bar to next gift, yarn balls count, daily icon. Auto-scrolls to the current node. | **PLAY L12** (bottom, fixed) |
| **Play / HUD** | Top: pause (left), "Level 12" + world name (centre, Lilita 22u / Nunito 13u), retry (right). Rack: Kitty, 2 active spools, NEXT (0.8 size) + next-next (0.6 size), "+N" chip. Callout band. Board + kitten. Tray: basket with `cap` slots + 3★ marker; booster buttons with count badge (or price chip when 0; locked boosters hidden until unlocked). | (play) |
| **Pause** | Dim scene 50 %, felt panel "Paused": Resume, Restart, Map; Music slider, SFX slider, Haptics toggle (web only, only if `navigator.vibrate` exists). | **Resume** |
| **Win card** | Kitten stays visible and happy on the board; the card sits over the tray+rack area (portrait: bottom 55 %; landscape: right column). "Kitten rescued!" (Lilita 34u), 3 stars pop in one by one (0.25 s apart, `star` SFX), "Basket peak 1 · 3★ at 1", yarn balls +20 counting up, new kitten portrait ("joined your Kitten Corner"), NEW BEST tag if score rose. Icons: Replay, Map, Share (web only, `P.canShare`). Gift/chest popups queue after this card closes (one at a time). | **NEXT** |
| **Out of Room** | Card in the same place; the board stays visible with free strands marked ✕ and the basket rim red. "Out of room!" + one line "No strand fits a spool". Buttons: Undo (count), +1 Slot (count or price), Retry. | **Undo** if stock or balance ≥ 30, else **Retry** |
| **Shop** | Tabs Outfits / Boosters. Outfits: 2-col cards (Kitty preview wearing it, name, price or WEAR/WORN). Boosters: 4 rows with icon, effect line, count, Buy (price). Balance top-right. Close (✕) top-right. | Buy / Wear on the selected card |
| **Kitten Corner** | 6×10 grid of kitten portraits (silhouette + "?" if not rescued, gold frame for golden). Count "23 / 60". Close. | Close |
| **Settings** | Music, SFX sliders; Haptics (web); Reset progress (two-step confirm); credits line (fonts OFL). | Close |
| **Daily** | 7-day stamp strip, streak flame + number, today's board preview (silhouette), reward line, countdown to IST midnight if won, "tomorrow's kitten" silhouette. Locked message until L6 ("Beat level 6 to unlock"). | **PLAY TODAY'S KNOT** / **Done! See you tomorrow** (disabled) |
| **All beaten** | Full scene, all 60 kittens parading, "All 60 kittens rescued! New tangles soon". | **Daily Knot**; secondary: Bonus Tangles, Map |

### 9.5 Haptics (web only, never from bots or record/og/qa)
`navigator.vibrate(12)` on pull, `30` on spool complete, `[20,40,20]` on stuck. Gated on `settings.haptics && P.env==='web' && !bot`.

---

## 10. Tutorial script (L1–3 teach by playing; zero text walls)
The tutorial director lives in `ui.js`. "Hand" = code-drawn pointing hand that moves to a target, presses (scale 0.9) and releases, looping every 1.6 s until the player acts. Hand targets come from `api.tapPointFor(id)` (a point on the strand ≥ 0.6 unit from any crossing).

**L1 First Pull** (3 strands, one colour, a strict chain, 1 spool): forced win.
1. 0.0 s: board, kitten tangled. The single free strand bobs and glows. Callout: "Tap the yarn on top".
2. 0.8 s: hand moves to the free strand and presses. Taps elsewhere: a covered tap gives the wiggle + red ring on its blocker; the hand keeps pointing.
3. Pull → zip → spool 1/3, kitten loses a loop. The callout clears. 1.0 s later the hand moves to the newly free strand (no text).
4. 2nd and 3rd pulls → spool full → rolls off → kitten freed → win card (3★). No basket shown in L1.

**L2 Over & Under** (6 strands, 2 colours, both spools active, no basket pressure):
1. Callout: "Only yarn on top can move". The hand points at a free strand only after 3 s of no taps (let them try).
2. If the first tap is on a covered strand: wiggle, red rings on the blockers, and the hand moves to the blocker (the "pull this first" lesson by demonstration). Callout swaps to: "Pull the top one first".
3. Basket is visible but greyed (it appears in L3).

**L3 The Basket** (9 strands, 3 colours, cap 3, par 1): first real choice.
1. Opening: one free strand fits a spool; the hand shows it if idle for 3 s.
2. First time the only free strands don't fit an active spool: a **ghost move** plays: a translucent copy of one free strand flies to the basket slot (0.8 s) while the basket pulses. Callout: "No spool yet? It waits in the basket".
3. The choice: the level is curated so that at the next state there are 2 free strands, one whose colour is the NEXT spool's colour. The NEXT spool bounces once (no text) to draw the eye. No hand here: the player chooses.
4. When the next spool rolls in and pulls the ball from the basket: "CHAIN" pop at the spool. Win card shows the 3★ rule visually: basket icon with the par marker.
5. If the player gets stuck here (shouldn't happen at cap 3 with par 1, curation guarantees casual ≥ 85 %), the Out of Room card offers a free Retry (Undo not unlocked yet).

**L4 Spool Order:** callout "Watch the NEXT spool" while the NEXT spool bounces; Undo unlocks with a gift animation (3 Undo fly into the button) and one callout "Undo takes back a pull".

**Twist teach levels** (L8, 14, 21, 28, 35, 42, 49): one callout with the line in §4.3, shown when the twist object is first on screen, plus the hand pointing at the teaching action after 3 s idle. Each callout shows once per save (`tut` flags).

**Idle hint:** from L4 on, after 15 s with no tap the hand points at a legal move (prefers a strand that fits a spool; never the solver's answer). Disabled in daily.

---

## 11. Playables notes
- `import P from '../shared/platform.js'`. Boot order (in `game.js`): draw loading frame → `P.firstFrame()` → `await P.init({store:'kk_', version:1, defaults: meta.defaults(), migrate: meta.migrate})` → `meta.initMeta()` → `P.best(meta.score())` → `await document.fonts.load('40px "Lilita One"'); await document.fonts.load('800 20px Nunito')` → build title → `P.ready()` (target < 2 s).
- **Hidden on yt** (`P.env==='yt'`): share button, "more games", any link, mute/speaker button, haptics toggle. Settings music/SFX sliders stay.
- **Pause/audio:** `P.onPause` → stop rAF loop, freeze `T`, `audio.suspend()`, flush save. `P.onResume` → restart loop with `last = now` (no dt jump), `audio.resume()` only if `P.audioOn`. `P.onAudio(on)` → suspend/resume. Web: pause screen opens on `P.onPause` if in play.
- **Save** (one JSON object, ≤ 4 KiB typical):
```js
{ v: 1, best: 0,            // best = score (§6), maintained by P.best
  stars: [0 /*×60*/],       // best stars per level, index = id-1
  cur: 1,                   // highest unlocked level (1..60; 61 = all beaten)
  balls: 50,
  boost: { undo: 0, hint: 0, slot: 0, snip: 0 },
  gifted: { undo: false, hint: false, slot: false, snip: false },
  outfits: ['tabby'], wear: 'tabby',
  kittens: [0 /*×60*/],     // 0 none, 1 rescued, 2 golden
  daily: { won: [], streak: 0, last: '' }, // won: last 14 IST date keys
  bonus: 0,                 // next bonus tangle index
  giftsClaimed: 0,          // star milestones claimed (every 15★)
  chests: 0,                // bitmask of world chests claimed (bit w-1)
  set: { music: 0.7, sfx: 0.9, haptics: true },
  tut: {},                  // e.g. { knot: 1 } once its callout was shown
  stats: { plays: 0, wins: 0, pulls: 0 } }
```
- `migrate(old)`: `v` missing or 0 (prototype save `{at: n}` or `{v:0, at:n}`) → `stars[i] = 1` for `i < at`, `cur = at + 1`, `kittens[i] = 1` for `i < at`, everything else defaults, `v = 1`. Unknown fields dropped; arrays padded/truncated to 60; numbers clamped.
- **`?qa=1` contract** (`modes.js`):
  - `__qa()` → `{ t: S.T, mode, level, progress, score }` where `mode` is the screen name and is exactly `'play'` while a level is in progress; `level` = current level id (daily = 0); `progress` = levels beaten (count of `stars > 0`); `score` = `P.data.best`.
  - `__qaInput()`: title → tap PLAY; map → tap PLAY; play → `[{type:'tap', x, y}]` at `tapPointFor(solverMove)` (solver line from the current state, recomputed if state changed; wait while `spoolBusy`); win card → tap NEXT; out of room → tap Retry; otherwise `[]`.
  - `__qaOldSave()` → `{ save: '{"v":0,"best":0,"at":3}', progress: 3 }`.
  - Extras: `__qaLevel(id)` jumps to a level; `__qaSolve()` → solver moves for the current state; `__qaState()` → `{removed, bt, peak, basket, sc, sn, next, stuck, doomed}`; `__qaBot(kind)` plays the rest of the level with a rules bot via real `tapAt` calls; `__qaTap(id)` returns the CSS point for a strand.
- **Build convention:** `index.html` contains exactly one `<!-- yt:body --> … <!-- /yt:body -->` block wrapping `<canvas id="c"></canvas>` only (no DOM overlays; every screen is canvas-drawn), no `<a href>` in it. Entry `game.js`. Fonts via `<link rel="stylesheet" href="../shared/fonts.css">`. Web shell copied from `games/kiss-the-edge/index.html` (build markers, scroll rules, canvas `touch-action:none`). Generator/tools live outside `games/` (they must not ship).
- `P.best(score)` after every level win (and once on boot). Save after every win, purchase, booster use, settings change (debounced by P).

---

## 12. Video and OG

### 12.1 `?record=1` beat sheet (25 s, 1080×1920, fixed 1/60 s, `__rec.step(n)`)
Level: **L20 "Pumpkin Patch"** boss (pumpkin silhouette, Pumpkin Night world, 20 strands, cap 4), outfit Pumpkin Sweater. Script: `modes.js` precomputes a move list offline-at-load: search (DFS over legal moves, ≤ 2 s budget) for a winning line where the basket reaches `cap−1 = 3` around move 11–13 and one arriving spool then absorbs ≥ 3 basket balls (CHAIN ×3); fallback: the winning line with the biggest chain. Taps are executed through the real input path at the listed times.

| s | Beat |
|---|---|
| 0.0–3.5 | Full pumpkin tangle, kitten tangled and sad. Caption `hook` (default `Pull them in the|RIGHT order 🧶`). At 0.6 s the hand presses the glowing top strand: preview arc, zip, plucks, spool winds 1/3. |
| 3.5–9 | 6 quick pulls (one per 0.8 s): spools fill, one completes and rolls off with confetti, Kitty swats and cheers, kitten drops two loops. |
| 9–10.5 | A deliberate tap on a covered strand: wiggle + red rings (teaches the rule to viewers). |
| 10.5–15 | Three pulls go to the basket: 1, 2, 3 of 4, amber glow, Kitty worried. HUD score hidden; caption `cap2` (default `1 slot left… 😬`) from 12.5 to 15.5 s. |
| 15–17.5 | The key pull completes a spool; the next spool rolls in and sucks 3 balls out of the basket one by one: "CHAIN ×3!" pop, basket empty. |
| 17.5–20.5 | Last 5 strands zip off fast; the last one frees the kitten: leap, shake, purr hearts, confetti. |
| 20.5–22.5 | Win card: 3 stars pop, "Level 20 / 60". |
| 22.5–25 | End card: logo, "play free, no download →", `arcadeaday.com/knot-kitty`, scene looping softly. `mode` becomes `'over'` at 25.0 s. |

`__rec.step(n)` returns `{t, mode, score: totalStarsShown, dead: false, pulls, basket}`. `__rec.frame(q)` → JPEG data URL. `__rec.audio(dur)` → base64 WAV via `OfflineAudioContext` replaying the same SFX timeline + music loop. `window.__recReady = true` after fonts load. Captions: Lilita One 78 px, cream with 8 px ink stroke, inside the top 22 % (the HUD hides while a caption shows).

### 12.2 `?og=1` (1200×630)
Pumpkin Night scene filling the frame. Left 46 %: logo (Lilita 120 px), tagline "Pull the yarn. Free the kitten." (Nunito 800, 36 px), a small "PLAY FREE" pill. Right: the L20 pumpkin board tilted −4°, ~40 % cleared, one tomato strand mid-flight toward a spool on the rack above, Kitty mid-swat with the Pumpkin Sweater, the kitten on the ledge mid-leap with 3 hearts. No HUD. Must read at 300×157.

---

## 13. Module map and interfaces

### 13.1 Files and owners (no two roles edit the same file)
| File (under `games/knot-kitty/` unless noted) | Owner role | Purpose |
|---|---|---|
| `index.html`, `consts.js`, `game.js`, `play.js` | **Core** | web shell; constants + event bus; boot, loop, state machine, input; level session (rules + animation sim) |
| `rules.js`, `levels.js`, `levels-data.js`, `dailies-data.js`; `tools/knot-kitty/gen.mjs`, `tools/knot-kitty/check.mjs` (repo root `tools/`) | **Levels** | rules, solver, bots (extend proto `logic.js`); data access; offline generator + checker |
| `render.js`, `scene.js` | **Art** | board, yarn, spools, basket, kitten, Kitty, particles; world scenes, title scene |
| `ui.js`, `layout.js` | **UI** | layout rects, HUD, all screens/cards/map, callouts, tutorial director, buttons |
| `audio.js` | **Audio** | music, SFX, offline render |
| `meta.js` | **Meta** | save schema, migrate, economy, boosters, shop, kittens, daily, score |
| `modes.js` | **Modes** | `?record`, `?og`, `?qa` hooks, record script |

Import graph (no cycles): `consts ← everyone`; `rules ← levels, play, modes`; `levels ← play, ui, modes, meta(dailyIndex only)`; `layout ← play, render, ui`; `render, scene ← game, ui, modes`; `meta ← game, play, ui, modes`; `audio ← game, modes`; `play ← game`; `ui, modes` receive the `api` object from `game.js` (they never import `game.js`/`play.js`).

### 13.2 `consts.js` (Core writes it first, verbatim; others import read-only)
```js
export const TITLE = 'Knot Kitty', SLUG = 'knot-kitty', STORE = 'kk_', SAVE_V = 1;
export const LEVELS = 60, PER_WORLD = 10, DAILY_START = '2026-10-16', SEASON_END = '2026-11-02';
export const ACTIVE = 2, SPOOL_N = 3, RAINBOW = 6, MAX_STRANDS = 28;
export const DPR_CAP = 2.5, TAP_SLOP = 24, PEEK_HOLD = 0.35, IDLE_HINT = 15;
export const DUR = { lift: 0.07, flightMin: 0.34, flightMax: 0.75, spoolLeave: 0.45, spoolEnter: 0.30,
  unbasketDelay: 0.28, unbasketDur: 0.38, kittenFree: 1.6, stuckCard: 0.6, callout: 2.2, wiggle: 0.38, ring: 0.7 };
export const BOOSTERS = { undo: { price: 30, unlock: 4, gift: 3 }, hint: { price: 40, unlock: 6, gift: 2 },
  slot: { price: 60, unlock: 9, gift: 1 }, snip: { price: 80, unlock: 16, gift: 1 } };
export const OUTFITS = [['tabby','Plain Tabby',0],['scarf','Cosy Scarf',120],['pumpkin','Pumpkin Sweater',200],
  ['witch','Witch Hat',300],['snow','Snowflake Jumper',400],['bow','Café Bow Tie',500],['crown','Yarn Crown',750],['astro','Star Helmet',1000]];
export const WORLDS = [null, { key: 'den', name: 'Autumn Den' }, { key: 'pumpkin', name: 'Pumpkin Night' },
  { key: 'cabin', name: 'Snowy Cabin' }, { key: 'cafe', name: 'Cat Café' }, { key: 'attic', name: 'Moonlit Attic' }, { key: 'roof', name: 'Starry Rooftop' }];
export const TEACH = { 8: 'knot', 14: 'lock', 21: 'mystery', 28: 'paw', 35: 'rainbow', 42: 'jumbo', 49: 'ice' };
export const worldOf = id => Math.min(6, Math.floor((id - 1) / PER_WORLD) + 1);
export const bus = (() => { const m = new Map(); return {
  on(t, f) { (m.get(t) || m.set(t, []).get(t)).push(f); },
  off(t, f) { const a = m.get(t); if (a) a.splice(a.indexOf(f) >>> 0, 1); },
  emit(t, d) { for (const f of m.get(t) || []) try { f(d); } catch (e) { console.warn(e); } } }; })();
```

### 13.3 Levels role: `rules.js`, `levels.js`, data, tools
**Level JSON** (one object per level in `levels-data.js` → `export default [ ... ]`, and in `dailies-data.js`):
```js
{ id: 14, name: 'Lock & Key', world: 2, cols: 7, rows: 8, cap: 4, shape: null,      // shape: 'pumpkin'|'cathead'|'heart'|'moon'|'star'|'kitten'|null
  strands: [ { pegs: [[1,0.5],[3,2],[5,1.5]], bow: 0, c: 2, d: 7,                  // proto keys kept
               m: 1, paw: 4, lock: 0, key: 1 } ],                                    // optional: m mystery, paw N, lock id it is locked by, key id it carries
  knots: [[3, 9]],                // optional pairs of strand ids (must cross)
  queue: [2, 0, {c: 1, n: 6}, 3], // int = 3-strand spool, object = jumbo
  ice: { thaw: 2 },               // optional
  par: 1, sol: [5, 0, 1, 8],      // solver line from the start
  stats: { seed, crossings, states, exact, random, casual, average, expert, avgPeak: {casual, expert}, choices } }
```
**Puzzle** (`buildPuzzle(level)`): proto fields `{cols, rows, strands[{id,pegs,bow,c,d,pts,at,m,paw,lock,key}], crossings[{x,y,top,under,ang,sTop,sUnder}], blockers[[ids]], blockMask[], crossOf[], n, full}` plus `group[]` (knot partner id or -1), `lockOf[]` (key strand id that must be gone, or -1), `pawN[]`, `spools: [{c, n}]` (queue normalised), `cap`, `ice` (thaw K or 0). Coordinates in peg units.

**State** (`initState(puz)`): `{ sc:[c|-1], sn:[filled], sk:[size], sid:[queue index|-1], next, basket:[c|-1 ×cap], bt, peak, removed (bitmask), count (strands removed), done (spools completed), moves, dead:false }`.

**Exports of `rules.js`:**
```js
rng(seed) → () => [0,1)
strandCurve(pegs, bow), arcLengths(pts), intersect(A,sA,B,sB), distPointPoly(x,y,pts), pointAt(pts,s,at)   // proto, unchanged
buildPuzzle(level) → Puzzle
initState(puz) → State;  cloneState(st) → State
effectiveCap(puz, st) → int                      // cap − 1 while ice not thawed (st.done < ice)
groupOf(puz, id) → number[]                      // [id] or the knot pair, over-strand first
canPull(puz, st, id, opt = {}) → { ok, why, blockers }   // why: 'removed'|'covered'|'locked'|'paw'|'full'; opt.snip skips covered/locked/paw
destOf(puz, st, id) → [{ id, kind: 'spool', slot } | { id, kind: 'basket', b }]   // per group member, for the press preview
pull(puz, st, id, ev = null, opt = {}) → st      // mutates; precondition canPull ok; pushes events below
legalMoves(puz, st) → number[]                   // one id per pullable group
isWon(puz, st) → bool;  isStuck(puz, st) → bool  // stuck = !won && legalMoves empty
newlyFree(puz, stBefore, stAfter) → number[]     // for mystery reveal + idle bob start
solve(puz, st0 = null, limit = 600000) → { peak, moves, exact, states }   // memo key = removed + '|' + sc,sn,next,basket signature
hintMove(puz, st, limit = 150000) → id | -1      // -1 if doomed or aborted with no beam line
botRun(puz, kind, r) → { win, peak, moves };  botStats(puz, kind, runs = 300, seed = 99) → { winRate, avgPeak, stars:[0,n1,n2,n3] }   // kind: 'random'|'casual'|'average'|'expert'
starsFor(peak, par) → 1|2|3                      // §3.5
transformLevel(level, { mx, my, perm }) → level  // mirror + colour relabel for dailies/bonus
```
Pull events (`ev` array, in order): `{t:'wind', id, slot, spool, k, n}`, `{t:'basket', id, b}`, `{t:'complete', slot, spool, n}`, `{t:'enter', slot, spool, c, n}`, `{t:'unbasket', b, slot, spool, k}`, `{t:'unlock', lock, id}` (a locked strand's key just left), `{t:'paw', id, left}` (counter changed; `left===0` wakes), `{t:'thaw', left}` (ice counter changed; 0 shatters).

**Exports of `levels.js`:**
```js
LEVEL_COUNT                       // 60, asserted equal to data length
getLevel(id) → level              // 1-based, deep-frozen copy
getDaily(dateKey) → level         // §4.5 index + transform; level.id = 0, level.name = 'Daily Knot'
getBonus(i) → level               // id = 0, name = 'Bonus Tangle ' + (i+1)
dailyIndex(dateKey) → { i, mx, my, perm }
istDateKey(now = Date.now()) → 'YYYY-MM-DD'
```
**Tools:** `node tools/knot-kitty/gen.mjs [--band A..M | --level N | --daily] [--secs 90]` writes data files (merging by id) and `studio/2026-10-16/prod-levels/levels-report.md`. `node tools/knot-kitty/check.mjs` re-solves every level + daily, re-runs bots (100 runs), asserts schema, strand budget, colour rules, twist constraints, `par`/`sol` validity; exits non-zero on any failure.

### 13.4 Core role: `game.js`, `play.js`
**`game.js`** (entry, no exports): canvas `#c`, DPR sizing (`min(devicePixelRatio, 2.5)`), resize observer, rAF loop, pointer + key listeners, P boot (§11), screen state machine, builds the `api` object and passes it to `ui.init(api)` and `modes.init(api)`.

**Frame order** (each rAF; record mode calls `api.step(1/60)` instead):
1. `dt = min(0.05, (now − last)/1000)`; if `P.paused` return without advancing.
2. `S.T += dt`.
3. `play.update(dt)` (if a session exists): buffered tap, flights, spools, basket, particles, kitten, stuck/won timers, doomed task result.
4. `ui.update(dt, S)` (callouts, tutorial, card animations, map scroll).
5. Draw: `scene.drawScene(g, S)` → if session on screen: `render.drawPlay(g, S)` → `ui.draw(g, S)` → `modes.overlay(g, S)` (captions, record/og only).
6. `modes.afterFrame(S)`.

**Shared state `S`** (created by `game.js`, mutated only by Core, except `S.ui` which UI owns):
```js
S = { W, H, dpr, T, screen,            // 'loading'|'title'|'map'|'play'|'pause'|'win'|'lose'|'shop'|'kittens'|'settings'|'daily'|'allbeaten'
  L,                                   // layout from layout.computeLayout
  world,                               // 1..6 for the scene (title uses season rule)
  sess: null | {
    kind: 'level'|'daily'|'bonus', id, level, puz, st, hist: [State],   // hist for Undo
    B,                                 // board transform from layout.fitBoard
    geo: [{ pts: [[x,y]] (CSS px), at: [], len, path: Path2D }],        // render.buildGeo
    slots: [{ cur: Spool|null, leaving: Spool|null, leaveT, enterT }],  // Spool = { c, n, shown, spin, bounce, id }
    nextQ: [{ c, n }],                 // visible upcoming spools (rule state order)
    basket: [{ c, arrived, bounce } | null],
    flights: [{ kind: 'strand'|'ball', id, c, dest, t0, dur, p, rev, pegS, plucked }],
    parts: [{ kind: 'fluff'|'conf'|'heart'|'spark', x, y, vx, vy, t, life, c, rot }],
    rings: [{ x, y, t0 }], wiggles: Map /* id → t0 */, lifted: Set /* free ids */,
    press: null | { id, x0, y0, t0, ok, why, dest },
    buffered: null | id, spoolBusy: false,
    kitten: { stage: 0..4, loops: 4, flinch: 0, freeT: -1, golden: false },
    kitty: { anim: 'idle'|'swat'|'cheer'|'worried'|'celebrate'|'sad', t0 },
    revealT: Map /* id → t0 */, unlockFx: [], pawFx: [],
    stuck: false, doomed: false, capped: false, boosterArm: null, hint: null | { id, until },
    result: null | { stars, peak, par, balls, firstWin, newBest, kittenId, gifts: [] },
    shake: 0, bakeKey: '' },
  ui: {} }                             // owned by ui.js
```
**`api`** (object passed to UI and Modes):
```js
api = { S,
  go(screen, data),                    // state machine transition (title/map/shop/… and 'play' with data {kind,id})
  startLevel(kind, id),                // builds session; kind 'level'|'daily'|'bonus'
  retry(), next(), undo() → bool, useBooster(kind) → bool,   // boosters go through meta + play
  pause(), resume(),
  pointer(type, x, y, id),            // type 'down'|'move'|'up'|'cancel' (CSS px); used by modes bots too
  tapAt(x, y),                         // down+up at the same point
  tapPointFor(strandId) → { x, y },    // ≥ 0.6 unit from crossings, on the visible part
  pickStrand(x, y) → id | -1,
  step(dt),                            // advance one fixed step (record/qa)
  resize(W, H, dpr) }
```
Input routing: `pointer` → `ui.pointer(type,x,y,S)` first; if it returns `true` the UI consumed it; else, in `play`, Core handles strand press/peek/commit (§3.6, §3.4, §3.7). Keys → `ui.key(e,S)` then Core (`U`, `H`, `R`, `P`).

**`play.js` exports:** `createSession(kind, id, S) → sess`, `update(dt, S)`, `press(x, y, S)`, `move(x, y, S)`, `release(x, y, S)`, `commit(id, S)`, `undo(S) → bool`, `applyBooster(kind, S) → bool`, `onResize(S)` (re-fit board, rebuild geo, keep state), `tapPointFor(id, S)`, `pickStrand(x, y, S)`.

**Bus events emitted by Core** (Audio, UI, Meta and Modes subscribe):
`press {id, ok, why}`, `pull {id, c, dest, group}`, `pluck {i}`, `wind {slot, k, n, c}`, `spoolDone {slot, c, n}`, `spoolEnter {slot, c, n}`, `chain {m, slot}`, `basket {b, c}`, `blocked {id, why, blockers}`, `full {}`, `basketWarn {}`, `unlock {id}`, `reveal {id}`, `paw {id, left}`, `thaw {left}`, `kittenStage {stage}`, `kittenFree {}`, `win {result}`, `stuck {}`, `doomed {}`, `undo {}`, `booster {kind}`, `hint {id}`, `screen {name}`, `levelStart {kind, id}`, `click {}` (UI emits), `buy {item}` (UI emits), `gift {kind}` (Meta emits), `coins {n}`.

### 13.5 Art role: `render.js`, `scene.js`
```js
// render.js
YARN                                   // [{ base, name, glyph }] index = c (§7.2), plus RAINBOW handling
yarnColor(c, dim) → { body, ply, hi, casing, glyph }
buildGeo(puz, B) → geo[]               // screen-space Path2D per strand (also used for hit-testing)
drawPlay(g, S)                         // board, baked strands, live strands, pegs, twist props, kitten, rack, spools,
                                       // basket, flights, rings, press preview, hint glow, particles, shake
drawStrand(g, geoItem, c, sw, opt)     // opt { dim, lift, wiggleT, mystery, rainbow, glow }
drawSpool(g, x, y, h, c, shown, n, opt);  drawBall(g, x, y, r, c, opt);  drawGlyph(g, c, x, y, size, ang)
drawKitten(g, x, y, s, { stage, loops, flinch, freeT, breed, coat, golden, t, loopColors })
drawKitty(g, x, y, s, anim, t, outfit)
drawStar(g, x, y, r, on, rot);  drawHand(g, x, y, s, press);  drawIcon(g, name, x, y, s, col)   // name: 'pause','retry','undo','hint','slot','snip','star','ball','gear','cart','paw','calendar','share','lock','close','home'
drawMiniBoard(g, rect, level, t)       // static preview for title/daily/map
invalidate()                           // force re-bake next frame
// scene.js
drawScene(g, S)                        // full-screen layered scene for S.world (baked static layers + live ambient)
drawTitleScene(g, W, H, t, season)     // 'pumpkin' | 'den'
drawRoomVignette(g, rect, world, t)    // map strip per world
drawOG(g, S)                           // §12.2 composition at 1200×630 (called by modes)
```
Bake: `render.js` owns an offscreen canvas keyed by `S.sess.bakeKey` (Core sets `bakeKey = removed + '|' + lifted + '|' + W + 'x' + H`); `scene.js` owns its own offscreen bake keyed by world+size.

### 13.6 UI role: `ui.js`, `layout.js`
```js
// layout.js
computeLayout(W, H) → L                // { W, H, u, orient, hud, rack, callout, board, tray, basket, boosters } rects {x,y,w,h}
fitBoard(level, rect) → B              // { ox, oy, unit, sw, x, y, w, h, kitten: { x, y, s } }; peg (i,j) → (ox + i·unit, oy + j·unit)
rackSlots(L) → { active: [{x,y,h}] ×2, next: [{x,y,h}] ×2, more: {x,y}, kitty: {x,y,s} }
basketSlots(L, cap) → [{ x, y, r }]
boosterRects(L) → { undo, hint, slot, snip }   // each {x,y,w,h}
// ui.js
init(api); update(dt, S); draw(g, S)
pointer(type, x, y, S) → bool          // true = consumed
key(e, S) → bool
say(text, { pri = 1, dur = 2.2 } = {})  // the one callout slot (§9.2)
showCard(type, data)                   // 'win'|'lose'|'gift'|'chest'|'unlockBooster'
tutorialFor(levelId) → director | null // internal; reads meta tut flags
```
UI draws every screen in §9.4, the map, the HUD and the hand; it reads meta getters and calls `api` + meta actions; it never mutates `S.sess`.

### 13.7 Audio role: `audio.js`
```js
init()                    // creates AudioContext on first user gesture (called by game.js on first pointerdown/keydown); subscribes to bus events
setMusic(v), setSfx(v)    // 0..1, from meta settings
playWorld(w)              // 0 = title/map variant of current world, 1..6
sfx(name, ...args)        // names from §8.2
suspend(), resume()       // pause / P.onAudio
isRunning() → bool
renderOffline(timeline, durSec) → Promise<string /* base64 WAV */>   // timeline: [{ t, name, args }] + music world
```

### 13.8 Meta role: `meta.js`
```js
defaults() → save (§11); migrate(old) → save
initMeta()                                // after P.init: sanitize, compute score, P.best(score())
score() → int;  progress() → int          // §6; levels beaten
stars(id) → 0..3;  unlocked(id) → bool;  cur() → int
recordWin({ kind, id, stars, peak, capped, chain }) → { balls, firstWin, newStars, kittenId, golden, gifts: [{ kind:'stars'|'chest'|'booster', ... }], newBest }
recordAttempt(kind, id)                   // stats
balance() → int;  addBalls(n);  spend(n) → bool
booster(k) → count;  boosterUnlocked(k) → bool;  useBooster(k) → bool;  buyBooster(k) → bool
unlockGifts(levelIdReached) → [k]         // grants §3.8 gifts once
outfits() → [{ id, name, price, owned, worn }];  buyOutfit(id) → bool;  wear(id)
kittens() → int[60]
daily() → { key, i, won, streak, unlocked, stamps: [bool ×7] };  recordDailyWin(stars) → balls
bonusNext() → i;  recordBonusWin(stars) → balls
settings() → { music, sfx, haptics };  setSetting(k, v)
tutSeen(key) → bool;  markTut(key)
resetAll()
qaOldSave() → { save, progress }
```
All writes end with `P.save()`; `P.best(score())` after `recordWin`.

### 13.9 Modes role: `modes.js`
```js
init(api)          // parse URL: record, og, qa, lv, hook, cap2, seed; installs window.__rec / __qa* hooks; record forces 1080×1920 canvas, outfit 'pumpkin', fixed step
active → { record, og, qa }
overlay(g, S)      // captions and end card in record mode; nothing otherwise
afterFrame(S)
```
Record: `__rec.step(n)` calls `api.step(1/60)` n times and drives scripted `api.pointer` calls at scripted `S.T`; `__rec.frame(q)`, `__rec.audio(dur)` (records every `bus` SFX event with `S.T` and calls `audio.renderOffline`), `__recReady`. OG: draws `scene.drawOG` once fonts load, sets `window.__ogReady = true`. QA: §11.

### 13.10 Build order and test harnesses
1. Core writes `consts.js` first (verbatim §13.2) and a stub `index.html`.
2. Everyone codes to the interfaces in parallel; each tests in `studio/2026-10-16/prod-<role>/` with a harness (Levels: Node; Art/UI: a Playwright page that imports only their module with a fake `S` built from proto `levels-data.js` L4; Audio: OfflineAudioContext render of every SFX; Meta: Node with a fake `P`).
3. Integrator wires, plays L1→L10 at 390×844 touch and 1440×900 mouse, and runs `tools/build-playables.mjs` + `tools/playables-check.mjs`.
