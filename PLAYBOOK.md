# Daily game playbook v2: the studio

Arcade a Day ships **one new game every week** (v3 cadence, §11; Days 1–10 shipped daily). From Day 10 (2026-10-16), every game must feel like a big studio spent years on it. In the user's words, it should be "really god level good, as if 1000s of game devs worked on it for years".

Days 1–9 were one-tap score toys: one mechanic, sparse scenes, overlapping popup text, all built by one agent in one day. v2 runs each day as a studio instead:
- research
- broad ideation
- a judged tournament
- a prototype bake-off
- specialist production
- a QA swarm
- a critic panel that blocks shipping until the game is great

The user authorized using the **whole usage limit and as many subagents as help**. Never skip or shrink a stage to save tokens. Do scale agents where they make the game better, not for show.

Every game ships to two places from **one codebase**:
1. **arcadeaday.com/<slug>/**: the web build, with its SEO page, share button and "more games" links. It serves Google search traffic and TikTok/Reels/X video traffic.
2. **YouTube Playables**: a clean build in `games/yt/<slug>/` plus `dist/playables/<slug>.zip` that passes every Playables requirement (§2, §3). The user submits it from their main account once YouTube onboards them. We never submit anything to YouTube.

## 0. Context
- **Repo:** `/Users/sairahul/Documents/projects/poki` → GitHub `sairahul1526/arcadeaday` (branch `main`).
- **Live:** `https://arcadeaday.com/<slug>/`.
- **Site build:**
  - `games/games.json` is the source of truth.
  - `node tools/build-site.mjs` generates the hub (`/`), 404, sitemap, robots and each game page's `<!-- build:head -->` / `<!-- build:body -->` blocks from it. Never hand-edit generated parts.
- **Hosting:**
  - The Cloudflare Pages project is still named `onemoretry-games`. arcadeaday.com and www are proxied CNAMEs to it.
  - The old pages.dev host still serves the site too, so share only arcadeaday.com links.
- **Brand:** Arcade a Day, "a new free game every day". Each game is "Day N" in release order. Never repeat a core mechanic from `games/games.json`.
- **Code to reuse:** Days 1–9 are v1 games (single screen, portrait-first, no SDK). They stay web-only unless the user asks. Copy their *techniques* (procedural Web Audio in `kiss-the-edge/audio.js`, record mode, og mode, QA bots), not their scope. The first v2 game becomes the reference for later v2 games.
- **Two-games-a-day guard:** one game per IST calendar day. A `wip/<slug>` branch left by a run that missed the gate (§4) is finished and shipped by the next run instead of starting a new game.

## 1. The quality bar
The bar is the best of YouTube Playables, Poki and the top of the mobile casual charts. The user pointed at two examples:
- **Scraps:** a hex puzzle with level goals, a 3,240/5,000 progress bar, boosters and a full Halloween scene.
- **Cat Market:** a 3D low-poly idle restaurant.

Every game must have all of these:
- **Hook:** fun in the first 5 seconds, with no reading.
- **Depth:** a skill ceiling. Level 60 is still interesting, and a better player visibly beats a casual one.
- **Content:**
  - Either ≥ 40 levels (handcrafted, or generator-made and then curated), or an endless structure with ≥ 6 distinct phases/biomes.
  - Every level has a goal and star ratings, and progress is always visible (map, path or progress bar).
  - A new mechanic or twist arrives every ~5–8 levels.
  - When content runs out, say so clearly ("All 60 levels beaten! New levels soon") and offer an endless or daily mode.
- **Meta:**
  - currency, unlockables (skins, themes, characters) and boosters/power-ups
  - milestone rewards and a daily challenge seeded by the date
  - the first session gives an average player ≥ 20 minutes of fresh content, and there's a reason to come back tomorrow.
- **Art:**
  - A fully themed, layered scene: backdrop, midground, props, characters, ambient animation and lighting.
  - One palette and style from an art bible.
  - No flat empty backgrounds. Every screen should look like a store screenshot, and the game should read at thumbnail size.
- **Feel:**
  - Juice on every action: anticipation, squash/stretch, particles, hit-stop, sound, and screen shake used sparingly.
  - 60 fps.
- **Audio:** a music loop per world/theme plus layered SFX. Use procedural Web Audio, or small local audio files.
- **UI:**
  - Screens: title, level map/select, HUD, pause menu, win/lose screens with one obvious next action, and a shop/collection.
  - **One callout on screen at a time. No text overlaps or clipping at any size.**
- **Onboarding:** levels 1–3 teach by playing (hand pointer, ghost moves, a forced first win), never with text walls.
- **Fairness:**
  - Every level is proven winnable by a solver or bot.
  - The difficulty curve is tuned with human-like bots (reaction lag, timing noise, greed).
  - A failure always feels like the player's fault.

## 2. Platform requirements (every game, both builds)
- **Any aspect ratio and size:**
  - Covers portrait, landscape and square, from 320×480 to 3840×2160.
  - Live resize and rotation keep all state: no restart, no orientation lock.
  - Lay out from a safe play rect that always fits, and fill the extra space with scene, never black bars.
- **Input:** every action works by touch AND by mouse alone (pointer events). Keyboard is a bonus. No hover-only or right-click features.
- **Crisp at any DPR:** size the backing store to CSS size × DPR (cap DPR at 2.5 for speed). Never upscale a low-res canvas.
- **Esc:** never `preventDefault()` it.
- **Platform layer:** everything goes through `games/shared/platform.js` (`P`): saves, the audio flag, pause/resume, ready signals, score, and share/link permissions. Game code never touches `localStorage`, `visibilitychange`, `navigator.share` or outbound links directly.
- **On YouTube (`P.env === 'yt'`):**
  - none of these: share prompt, link out of the game, "more games", exit button, overall mute button, icons that look like YouTube's controls, ad calls
  - respect `P.audioOn` instead of a mute button. In-game settings may still offer music/SFX sliders.
- **Paths and origins:**
  - relative paths only; file names `[a-z0-9_.-]`
  - no CDN and no other-origin requests, except Google Fonts. Prefer self-hosted woff2 in `games/shared/fonts/`.
  - libraries only when vendored as local files with an MIT/BSD-style license (e.g. a three.js build when the concept truly needs 3D).
- **Size and speed:**
  - initial load < 5 MiB; total < 15 MiB; each file < 512 KiB where possible (the hard MUST is < 30 MiB)
  - interactive in < 3 s on fast 4G
  - JS heap < 256 MB
- **Save:**
  - one versioned JSON object (`v`), < 100 KiB
  - `migrate()` handles every older version, and progress survives a reload
- **Pause:** `P.onPause` stops the game loop, timers and audio (suspend the AudioContext). `P.onResume` restores them.
- **Score:** call `P.best(n)` with an integer whenever the saved best rises. The GDD defines what "score" means for the game (e.g. total stars or best endless distance).

## 3. Shared infrastructure
The first v2 run builds this, and every v2 game depends on it. Later runs only fix or extend it, carefully, and re-run `tools/playables-check.mjs` on every v2 game afterwards.

### `games/shared/platform.js`
The game uses it like this:

```js
import P from '../shared/platform.js';
await P.init({ store: 'abc_', version: 1, defaults: {...}, migrate: (old) => upgraded });
```

The API:

| Member | What it does |
|---|---|
| `P.env` | `'web'` or `'yt'`; `'yt'` when `typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV` |
| `P.data` | the save object; mutate it, then call `P.save()` |
| `P.save()` | debounced to at most once a second. yt: `ytgame.game.saveData(JSON)`. web: `localStorage[store+'save']`, and also `localStorage[store+'best']`, which the hub reads for "your best" |
| `P.best(n)` | raises `data.best` if `n` is higher, saves, and on yt calls `ytgame.engagement.sendScore({value: n})` (integer), so the best score sent always equals the saved best |
| `P.audioOn`, `P.onAudio(cb)` | yt: `system.isAudioEnabled()` / `onAudioEnabledChange`. web: always on, with the game's own mute |
| `P.onPause(cb)`, `P.onResume(cb)` | yt: `system.onPause` / `onResume`. web: `visibilitychange`/`pagehide`, allowed **only** here and only for web |
| `P.firstFrame()` | call once the loading screen's first frame is drawn (yt: `game.firstFrameReady()`) |
| `P.ready()` | call once the game is interactable (yt: `game.gameReady()`); must come after `firstFrame()` |
| `P.canShare`, `P.canLink`, `P.showMute` | `false` on yt |
| `P.lang` | from `system.getLanguage()`; English-only is fine for now |
| `P.error(e)` | yt: `health.logError()` |
| `P.event(name, data)` | analytics beacon to `/api/ev` (see Analytics below); pass the level as `data.id` |

`P.init` must await `ytgame.game.loadData()` and handle an empty string (no save yet).

### `tools/build-playables.mjs <slug>`
Writes `games/yt/<slug>/`, which is deployed so YouTube's official test suite can load it over https, and zips it to `dist/playables/<slug>.zip`. Its generated `index.html`:
- `<script src="https://www.youtube.com/game_api/v1"></script>` is the **first** script
- then the game's CSS, its canvas and `<script type="module" src="./game.js">`
- none of these: `site.css`, build markers, SEO tags, the info sheet, links

The script also:
- copies the game's files and `shared/platform.js` (plus fonts), rewriting `../shared/` imports to `./`
- fails on any absolute path (`src="/`, `href="/`, `url(/`, `from '/`), a bad file name, a file over 30 MiB, more than 8,000 files, or an initial bundle over 30 MiB.

### `tools/playables-check.mjs <slug>`
Serves `games/yt/<slug>/` locally with the Playables CSP header below. Playwright routes `https://www.youtube.com/game_api/v1` to a **mock SDK** that sets `IN_PLAYABLES_ENV = true`, logs every call with timestamps, keeps `saveData` in memory and can fire pause, resume and audio changes. It runs on Chromium, Firefox and WebKit (`npx playwright install firefox webkit` if they're missing) at phone, tablet and desktop sizes in both orientations.

It prints a PASS/FAIL table and exits non-zero on any MUST failure. Checks:
- **SDK and timing:**
  - the SDK script loads before any game code
  - `firstFrameReady` comes before `gameReady`
  - `gameReady` arrives within 5 s
- **Sandbox:**
  - no CSP violations and no console errors
  - no requests to other origins (Google Fonts allowed)
  - no `window.open` and no `<a href>` outbound
- **Save:**
  - `loadData` is awaited before the first `saveData`
  - the save is < 500 KiB, and a reload with the mock save restores progress
  - an old-version save migrates
- **Pause:** pause stops game time (`__qa().t` frozen) and audio (AudioContext not `running`), and resume restores both.
- **Audio flag:** `isAudioEnabled=false` means silence; toggling it live works.
- **Score:** `sendScore` values are integers and the last one equals the saved best.
- **Input and layout:**
  - Esc is not default-prevented
  - live resize from portrait to landscape to square mid-level keeps state
  - touch-only and mouse-only both complete level 1
  - screenshots of every size go to `studio/<date>/qa/playables/`
- **Bundle:** sizes, file names and file count.

### Hosting and repo setup
- `games/_headers` gives `/yt/*` the header `X-Robots-Tag: noindex` plus the Playables CSP, and `robots.txt` disallows `/yt/`.
- `build-site.mjs` ignores `shared/` and `yt/`.
- `.gitignore` adds `studio/` and `dist/`.
- Prove the infra on a tiny fixture game (`tools/fixtures/hello-playable/`) before the day's game depends on it.

### Analytics (live since 2026-11-02)
- **Path:** `P.event(name, data)` sends a beacon to `/api/ev`. That is `functions/api/ev.js`, a Pages Function that ships with the normal `wrangler pages deploy`. It writes to the D1 database `arcadeaday-events`, table `ev` (`tools/analytics/schema.sql`). The repo-root `wrangler.toml` holds the D1 binding `EV` and is the Pages project's config: edit settings there, never in the dashboard.
- **Automatic events:** `platform.js` sends `session_start` on `P.ready()`, with the referrer host. On every hide it sends `session_end` with the visible seconds so far.
- **Game events:** every game sends `level_start`, `level_complete`, `level_fail` and `quit_level`, with the level as `id`, plus `stars` and `secs` where they exist.
- **Where events go out:** only from arcadeaday.com, www and `*.pages.dev` previews. Never from YouTube, a portal build or `?qa=1`. On localhost only with `?ev=1`, under `wrangler pages dev games` (launch config `pages-dev`).
- **Privacy:** no cookies, no IPs, no ids that outlive a page load. `age` is days since this device first opened the game, from `localStorage[store+'first']`. Country comes from Cloudflare.
- **Read it:**
  - `node tools/analytics/report.mjs [--days 7] [--game slug] [--previews] [--local]` prints sessions, median length, returning share, referrers and the level funnel with its biggest drop-off.
  - Ad-hoc SQL: `npx wrangler d1 execute arcadeaday-events --remote --command "..."`.
- **Limits:** the free tier allows 100k D1 writes a day, about 5–10k sessions. If a game breaks out, sample the level events before the limit hits; a failed write never affects the game.

### Playables CSP
Emulate it exactly:
```
default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:
```

### Official test suite
The official test suite is at https://developers.google.com/youtube/gaming/playables/test_suite. After deploy, open it in the built-in browser pane (in headless Playwright the tool's panel renders empty, as of 2026-10-30). Set the viewport to about 1000x1400 so the whole game frame shows, type `https://arcadeaday.com/yt/<slug>/` into the Game URL field, press the reload button, then play level 1 in the frame so "sendScore called with an integer" turns green. Read the MUST/SHOULD results, and reset the viewport afterwards. If it insists on an invite code we don't have, note that in the report and rely on `playables-check.mjs`.

### `tools/art/kie.mjs`: AI art (kie.ai, added 2026-10-30)
Every game from Day 10 on uses real illustrated art: characters, bosses, backgrounds, win art, the portal cover and the icon. Code-drawn shapes are no longer the default. The key is `KIE_API_KEY` in `~/.config/arcadeaday.env`; never print, log or commit it.

Commands:
- `node tools/art/kie.mjs credits`: balance. Log it before and after each art batch.
- `node tools/art/kie.mjs batch tools/<slug>/art.json [--only a,b] [--force]`:
  - the main path; runs 4 at a time
  - skips assets that already exist
  - writes `games/<slug>/art/<id>.webp` (shipped) and keeps the raw 1K PNGs in `studio/art-raw/` (never shipped)
  - writes prompts and task ids to `tools/<slug>/art.manifest.json`
- `gen --prompt … --out x.webp [--cutout] [--ref a.png] [--aspect 16:9] [--max 512]`: one-offs.
- `cutout in.png out.png`: removes the background (Recraft).
- `optimize in.png out.webp --max 256`: sips plus cwebp, keeping alpha.

Defaults:
- model `nano-banana-2` at 1K, with `--ref` image inputs for style consistency
- about 9 credits per image with cutout

Rules:
- **One style for the whole game.**
  - The spec's `style` string is the art bible in one paragraph: line weight, shading, palette, camera, mood. It's prefixed to every prompt.
  - Generate the hero character first. Approve it, then pass it as a `refs` entry for every other character so they all match.
  - Prompts always say "plain white background, centered, full body" for anything that gets `cutout: true`.
- **Variety is cheap now.** Make 6–12 character variants, a distinct look for every boss, 3–5 backgrounds (one per world or band), and several win/celebration illustrations, instead of recolouring one sprite.
- **Size budget:**
  - sprites `max` 256 (512 for hero and boss)
  - backgrounds 1024–1280 without cutout
  - the whole `art/` folder under 3 MB
  - preload behind the loading screen, then call `firstFrameReady` once the first screen's art is decoded
- **Same-origin only:** load images by relative path (`art/x.webp`). Playables' CSP allows `img-src 'self'`, so never hot-link kie URLs.
- **Portal media** (cover, icon, banner at each portal's sizes): generate them from the same refs into `dist/portals/<slug>/media/`. The cover is the most important image we make, because it decides clicks on every portal. Make 3 options and have the viral-marketer critic pick.
- **Review:** look at every generated image before it's wired in. Regenerate anything off-model, with extra fingers or limbs, garbled text, or the wrong style. The art-direction QA lane (G10) and the art-director critic judge the final art.
- No text inside generated images. The UI renders text, so it's crisp and translatable.

## 4. The studio pipeline
**You** (the scheduled session) are the executive producer and orchestrator.
- **Spawning:** spawn subagents with the Agent tool, `run_in_background: true`, many in one message for parallel fan-out. The Workflow tool is fine for big fan-outs: the user explicitly asked for multi-agent orchestration at any scale.
- **Briefs:** every agent starts cold. Give each one a self-contained brief:
  - the repo path and the files to read (this playbook, the GDD)
  - its exact deliverable and output path
  - the interface contract
  - the quality bar (§1)
  - the blocker list below
- **Outputs:** agents write their work under `studio/<date>/…` (gitignored) and return a ≤ 15-line summary. Keep your own context lean: read their files only when you need them.
- **Questions:** subagents can't ask the user anything, so decide yourself.
- **File ownership:** never let two agents edit the same file at the same time.
- **Default agent types:**
  - research: Trend Researcher
  - prototypes: Rapid Prototyper
  - production: Frontend Developer or general-purpose
  - adversarial QA: Evidence Collector and Reality Checker
  - personas and judges: general-purpose with a persona brief

The stages:

| Stage | Agents (parallel) | Output | Gate |
|---|---|---|---|
| **A. Research** | 5: **(1)** YouTube Playables catalog: what's featured and most played, genres, session shapes. **(2)** Mobile casual and hybrid-casual top charts this month and the mechanics behind them. **(3)** Poki and CrazyGames hot/new. **(4)** TikTok/Reels/Shorts game trends (satisfying, ASMR, sorting, rage). **(5)** Search demand via `node tools/keywords.mjs`. | `research/*.md` | each cites real examples |
| **B. Ideation** | 8 lenses × 4 concepts = 32: proven-hit remix, hybrid-casual puzzle, physics toy, satisfying/sorting, light idle/tycoon, arcade skill, meme/zeitgeist, Playables-native (levels, short sessions, broad 8–80 audience). Each concept gives a pitch, core loop, meta loop, level/twist plan, art theme, the 25 s video beat, a keyword, and the proven hit it builds on. | `concepts/*.md` | |
| **C. Tournament** | 6 judges score all 32 on §5, independently: Playables curator, top mobile designer (Royal Match / Block Blast calibre), 13-year-old gamer, art director, viral marketer, producer (scope realism). Then a devil's advocate attacks the top 5. | `tournament.md` | top 3 finalists ≥ 42/50, none vetoed for scope |
| **D. Prototype bake-off** | 3 builders, one per finalist (~90 min): greybox core loop, 5 levels, `?qa=1` bot. Then 4 playtesters (casual adult, gamer kid, designer, Playables curator) play all 3 with Playwright at phone and desktop sizes, with screenshots. | `proto-*/`, `playtest.md` | winner chosen by **play**, not pitch: fun in 30 s, wants more, bot metrics |
| **E. GDD** | 1 lead designer writes it; 2 reviewers (designer, engineer) attack it; the lead finalizes. | `docs/gdd/<date>-<slug>.md` (committed) | covers every item below |
| **F. Production** | 6–8 specialists on separate files to the GDD's interfaces: core/engine, levels + solver, **art generation** (`tools/<slug>/art.json` → `tools/art/kie.mjs batch`, starting on day one of F so the renderer can draw real sprites), renderer, UI/menus/tutorial, audio, meta/economy/save, modes (record/og/qa) + platform wiring. Then 1 integrator wires it all together and plays it end to end. | `games/<slug>/` | plays start to finish with no errors |
| **G. QA swarm** | 10, each writing a report with screenshots (detail below). | `qa/*.md` | |
| **H. Fix rounds** | You triage every QA finding into one prioritized list. Fix agents work in parallel by file ownership, then the failing QA lanes re-run. Repeat until clean. | | zero blockers |
| **I. Critic gate** | 6 critics, fresh agents that never saw the build process, play the game cold and score 1–10 with reasons: Playables curator, top mobile designer, 13-year-old, art director, viral marketer, first-time grandparent. | `critics.md` | **every critic ≥ 8 and mean ≥ 9, with zero blockers.** Otherwise a polish round targets the lowest scores (F–H again). |
| **J. Ship** | §7–§10 | | |

The GDD (stage E) must contain:
- the fantasy and hook
- controls
- core loop, meta loop and economy numbers
- the level list and twist schedule
- the difficulty curve
- what "score" means
- the art bible: palette, shapes, scene layers, characters, animation list, UI style, plus the **art list** for `tools/<slug>/art.json`: the style paragraph, every asset id, its prompt, size and cutout, and the portal cover concepts
- the audio bible
- every screen and flow
- the tutorial script
- the Playables notes
- the video beat sheet
- the module map with exact interfaces, so specialists can build in parallel

The 10 QA swarm lanes (stage G):
1. **Aspect/device matrix:** 360×640, 375×812, 390×844, 768×1024, 820×1180, 1024×768, 1080×1080, 1440×900, 1920×1080, 2560×1440. Include a live resize mid-level.
2. **First-time player:** no instructions given. Does the tutorial teach it? Does anyone get stuck for more than 20 s?
3. **Difficulty curve:** bots at three skill levels (casual, average, expert) play every level and produce win-rate and attempts curves.
4. **Solvability:** a solver or bot proves every level winnable.
5. **Playables compliance:** `build-playables` + `playables-check`.
6. **Performance:**
   - fps at 4× CPU throttle on a phone profile
   - load time, heap and bundle size
7. **Readability and overlap:** a frame-by-frame review of every screen and callout at three sizes.
8. **Audio:**
   - mix levels, and no clipping
   - pause and the audio flag both silence it
9. **Chaos:**
   - input spam and multi-touch
   - rapid resize, pause/resume spam
   - corrupt or old saves
10. **Art direction critique:** compares screenshots to the art bible and the §1 bar.

**Blockers.** Any one of these blocks shipping:
- a console error
- text overlap or clipping at any tested size
- a Playables MUST failure
- an unwinnable level
- a first-time player stuck for more than 20 s
- a median below 50 fps on the throttled phone profile
- blurry rendering
- sound while paused or while the audio flag is off
- progress lost on reload
- a layout broken by a live resize
- a dead end (a screen with no way forward)

**Time.**
- Start at the scheduled time and aim to ship by ~22:00 IST. Capture the IST date at the start (`TZ=Asia/Kolkata date +%F`) and use it for `date` and file names even if work runs past midnight.
- If the gate isn't met by 22:30 IST, ship only if the critic mean is ≥ 8 with zero blockers, and say so in the report.
- Otherwise don't publish. Commit everything to the branch `wip/<slug>`, push it, and report what's missing. The next run finishes and ships it first.

## 5. Ideation rubric (v2)
Score each concept 1–5 on all 10 criteria. A concept needs **≥ 42/50**, and the producer can veto any concept that can't reach the §1 bar in one day with the team.
1. **One-second read:** a scrolling viewer, or a thumbnail, gets it instantly.
2. **Five-second learn:** one gesture type, learned by playing.
3. **Mastery depth:** a real skill ceiling, where better players visibly do better.
4. **Content and progression:** levels, goals, twists, meta and unlocks fill a 20+ minute first session and bring players back tomorrow.
5. **Juice and feel:** every action is satisfying on its own.
6. **Art direction potential:** a themed, distinctive full scene that looks premium at thumbnail size.
7. **Shareable moment:** a video beat people comment on ("wait, WHAT?").
8. **Playables fit:** works in every aspect ratio, plays in short sessions with little text, appeals to ages 8–80, and fits a genre that performs on YouTube (puzzle, casual, arcade, sports, word).
9. **Proven demand:** the core is proven by a current top-chart or trending game. Name it.
10. **Search demand:** a 2–4 word phrase people already type into Google that this game honestly is. Check it with `node tools/keywords.mjs "<seed>" ...`: 5 means DataForSEO volume ≥ 1k/mo or a full autocomplete list, and 1 means no completions. Prefer low difficulty.

Virality and fun come first: never pick a weaker game because its keyword is bigger.

## 6. Build rules
- Plain JS ES modules, no build step. Canvas 2D by default. WebGL is allowed with a vendored local library when 3D makes the game (§2).
- Split the code into modules with owners: `game.js` (entry + state machine), `levels.js`, `render.js`, `ui.js`, `audio.js`, `meta.js`, `modes.js` (record/og/qa). Every game imports `../shared/platform.js`.
- Retention:
  - best score / NEW BEST
  - instant retry
  - stars, unlocks and a daily challenge
  - first-run tutorial
  - vibration on web only, never from bots
- Web-only extras behind `P.canShare` / `P.canLink`: Web Share, a "more games →" link to `../`, and the share URL `arcadeaday.com/<slug>`.
- **Web page shell:** copy `games/kiss-the-edge/index.html` and keep its rules, which the build lints:
  - **Build markers:** `<!-- build:head --><!-- /build:head -->` goes right after the viewport meta, and `<!-- build:body --><!-- /build:body -->` right before the game script. Don't write title, description, canonical, og or twitter tags yourself. The build fills them from games.json, plus `/site.css`, JSON-LD and the `.back` links ("how to play" / "more games").
  - **Scrolling:**
    - `html, body` must not set `overflow: hidden` or `height: 100%`, because the info sheet scrolls one screen below the game.
    - Put `touch-action: none` on the canvas, not on body.
    - Keep `#garage { touch-action: none; } #garage .panel { touch-action: pan-y; overscroll-behavior: contain; }` and the hidden-scrollbar rule.
  - **`keydown` handler:** copy Kiss the Edge's:
    1. Ignore non-game keys.
    2. `if (mode !== 'play' && scrollY > 40) return;`, so keys don't start a game while someone reads the sheet.
    3. Call `preventDefault()` **before** the `e.repeat` check (never for Esc). Otherwise auto-repeat of a held Space scrolls the page mid-run.
- **Record-mode contract** (`?record=1`), needed by `tools/record.mjs`:
  - Render a fixed 1080×1920 canvas.
  - Use a fixed 1/60 s timestep, driven only by `window.__rec.step(n)`. It returns `{t, mode, score, dead, ...}`, where `mode` becomes `'over'` at the end.
  - `window.__rec.frame(q)` returns a JPEG data URL of the canvas.
  - `window.__rec.audio(dur)` returns a base64 WAV rendered with `OfflineAudioContext`.
  - Set `window.__recReady = true` once fonts are loaded.
  - A scripted bot plays a showcase run (a later, prettier level is fine) that builds to a climax and then fails or wins dramatically at a planned moment.
  - Query params:
    - `hook=line1|line2` draws a caption for the first ~3.5 s
    - `cap2=` draws a tension caption before the climax
    - the end card shows the title, "play free, no download →" and the URL.
- **OG mode** (`?og=1`): a clean 1200×630 title layout with the hero hand-placed mid-action, for `tools/og.mjs`.
- **QA hooks** (`?qa=1`):
  - `window.__qa()` returns state (including `t` = game time).
  - Add level-skip and solver hooks, and `__qaAhead(sec)` for games where an object keeps moving after the player lets go.

## 7. SEO page (games.json)
Copy an existing entry and fill every field. The build refuses missing ones.
- **Basics:**
  - `slug`, `title`, `tagline`, `date` (YYYY-MM-DD, IST), `accent`, `icon` (one emoji)
  - `store`: the platform save prefix, e.g. `abc_`. The hub reads `<store>best`.
  - `shop`: the name, item noun and `[NAME, price]` list, straight from the game's shop/collection code.
- **Share copy:** `share.title` / `share.description`, the punchy social copy for og tags.
- **Keyword:** `seo.keyword` is the primary phrase from the ideation check. Pick the most specific one with real demand. The slug and game title stay brandable; the keyword goes in:
  - `seo.title`: ≤ 60 chars, pattern `<Title>: <Keyword-ish Phrase> · Play Free Online`
  - `seo.description`: 110–160 chars. Say what you do in the game, include the keyword, and end with "no download" or "works on phone".
  - `seo.h1`: `<Title>: the <keyword phrase>` or similar.
- **Content fields:**
  - `seo.intro`: 2 paragraphs
  - `howTo`: 5–6 steps with real point values
  - `controls`
  - `tips`: 5–6, specific to this game
  - `faq`: 4–5 real questions a player would google
  - `genre`
  - `imageAlt`: describes the og image
- **Accuracy:** every fact must match the code: points, prices, names, controls, level counts. Read it, don't guess. The keyword appears naturally 2–4 times; no stuffing.
- **Check:** run `node tools/build-site.mjs`. It must print no PROBLEMS. Then check `/<slug>/#how` at 375×812 and 1440×900:
  - the sheet looks right
  - "back to the game" works
  - a swipe on the game doesn't scroll the page

## 8. Ship
1. Add the game to the README table.
2. Make the share images:
   1. Run `node tools/og.mjs <slug>` and look at `games/<slug>/og.jpg`.
   2. Run `node tools/build-site.mjs`.
   3. Run `node tools/og.mjs hub`.
3. Build the Playables version:
   1. Run `node tools/build-playables.mjs <slug>`.
   2. Run `node tools/playables-check.mjs <slug>`. It must be all PASS.
4. Commit everything, including the GDD and any playbook lessons. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Then `git push origin main`.
5. Deploy with `npx wrangler pages deploy games --project-name onemoretry-games --branch main --commit-dirty=true`. Never pass `--force`.
6. Check the live site with `curl`:
   - the hub, the game, `og.jpg`, the game's JS, `/yt/<slug>/` and `/sitemap.xml` all return 200
   - the sitemap lists the new game and excludes `/yt/`
   - a junk URL returns 404
   - `/yt/<slug>/` sends the CSP and noindex headers.
7. Run the official Playables test suite against `https://arcadeaday.com/yt/<slug>/` (§3).
8. Run `node tools/indexnow.mjs`.

## 9. Video
1. Record with `node tools/record.mjs <slug> --secs 40 --out videos/<date>-<slug>.mp4 --query "seed=..&hook=..|..&cap2=.."`.
2. Aim for 20–30 s:
   1. a hook in the first second
   2. the build-up
   3. the climax
   4. a dramatic fail or a jaw-drop win
   5. an end card with the URL that loops cleanly back to the start
3. Show the game's depth: a richer level, the progress map or an unlock moment, not just level 1.
4. Review frames before recording, and again at 0.5 s, the climax, the fail and the end card. Re-record if anything is off.
5. Write `videos/<date>-<slug>.md`:
   - a TikTok/Reels caption (hook + question + "link in bio") with 5–8 hashtags including #arcadeaday
   - an X post
   - a pinned-comment idea

## 10. Report
The final message must include:
- "Arcade a Day · Day N: <Title>", the live URL and the hub URL
- the video path and the caption, ready to paste
- the Playables zip path, with the `playables-check` result and the official test suite result
- the critic scores (each critic and the mean), and how many agents ran
- 3 lines on what the game is, its hook, its depth and its twist
- the primary keyword and the SEO title
- any blocker and the exact fix the user needs to make

## 11. v3 strategy: Anul's playbook (distribution first), from 2026-10-30
The user switched strategy after reading Anul Agarwal's (@anulagarwal) articles. His AI-made Suika variant reached 50M+ players, hit #1 on Coolmath mobile and earned $25K+, mostly from non-exclusive portal licences ($1.5–2.5K each). **Ads are not the focus:** never design around ads, never build an ad system. A portal SDK goes in only where that portal requires it, at natural breaks, and never gates gameplay.

Pillars, in priority order:
1. **Distribution is the business.** Fewer, better games, each on as many portals as possible. A great game that lives only on arcadeaday.com is unfinished.
2. **Scout proven hits and remix them.** Keep the proven core mechanic, change the theme, add one twist. Never a 1:1 clone of the current trending hit. Every concept names the store/portal hit, its rating or play-count evidence, the twist, and which portals would want it.
3. **Quality and engagement.** Portals promote long sessions, replay and return visits. Design for the first 10 seconds, the first 5 minutes and day 2. Family-friendly, so Coolmath-type portals accept it. The GDD states the session-length target, the replay hook, the day-2 reason and the level count.
4. **Data-driven iteration.** `P.event` fires session_start / session_end (automatic) and level_start / level_complete / level_fail / quit_level into D1 (§3 Analytics, live since 2026-11-02). Every Saturday improve run reads `node tools/analytics/report.mjs` first. Fix where players quit; add levels and seasonal content to games that work.
5. **Portal relationships.** `studio/portals.md` is the relationship log: submission URLs, requirements, contacts, what was sent, replies, genres asked for, licence status. Pitch licences, and ask portals which genres they want.

**Cadence (the user, 2026-10-30): one game a week.** "think, create, improve, build with the best outputs for a week, from monday to saturday and upload on sunday".
- **Monday, think:** full scout (YouTube, Reels, Play Store viral, store charts, mega-hit teardown, portals) → ≥ 5 mega-hit-league concepts (≥ 2 built on a recent viral Play game) → §5 scoring → winner → GDD → `wip/<slug>` branch.
- **Tuesday, create the core:** core loop + juice on the platform layer, level tools and tuning bots, hero art approved, first playable.
- **Wednesday, create the content:** all art, the full level set tuned by bots, meta (dailies, collection, unlocks), audio, desktop/landscape layouts.
- **Thursday, build it solid:** portal adapter, analytics, Playables build (playables-check PASS), full QA swarm, every blocker fixed.
- **Friday, improve:** critic panel r1 → fix round → critic panel r2 → fix round.
- **Saturday, finish:** polish to the gate (every critic ≥ 8, mean ≥ 9, zero blockers); prepare games.json, README, og, portal packs, SUBMIT.md, pitches, Playables zip, video. Push to `wip/<slug>`, don't deploy.
- **Sunday, release and upload:** last fix round + panel if needed; ship (§7–§10) only through the full gate, otherwise the game gets one more week; then the Sunday portal uploads for every signed-in portal.
- Never more than one new game a week, never two on the same IST day. Every run moves the game at least one §4 stage; spare time on Mon–Sat goes to one live-game task (drop-off fix, levels/seasonal content, a portal pack for an older game, or a portal email draft). The old deadline fallback (mean ≥ 8) no longer applies to new games.

**Portal targets and packs** (`dist/portals/<portal>/<slug>.zip` and `dist/portals/<slug>-SUBMIT.md`, with media in `dist/portals/<slug>/media/`):
- Coolmath (licence pitch: `dist/portals/<slug>-pitch-coolmath.md`)
- CrazyGames (Basic Launch, then Full Launch)
- GameDistribution (open upload, syndicated widely)
- GamePix (revenue share or licence pitch)
- other licence buyers found while scouting
- YouTube Playables (reach)
- Poki only for a breakout hit, and only with the user's OK, because of its web exclusivity

The user does every account, upload, submission and email. Runs prepare everything, so the user's part takes minutes.

**Platform:** `P.portal` (from `?portal=` or `window.__PORTAL`) drives a thin adapter for each SDK's required lifecycle (init, loading done, gameplay start/stop, pause/mute, happy time). It is a no-op on web and yt.

## Lessons: v3 scouting (2026-10-30)
- vidIQ (`vidiq_youtube_search`, `vidiq_trending_videos`, `vidiq_outliers`, `vidiq_instagram_tiktok_outlier_search`) works without an auth prompt. Use it for YouTube and IG/TikTok scouting instead of browsing Instagram. Outlier multiples are inflated on tiny channels, so rank by views and views per hour.
- There's no live Google Play top-free chart: AppBrain refuses connections and Appfigures returns 403. Use the iTunes RSS/lookup and Astro for iOS, and treat Play numbers as unverified snippets.
- GameDistribution's catalog is client-rendered, so WebFetch gets no list. Scout it with a real browser or skip it.
- Coolmath's top 10 is evergreen skill and logic games (Suika is #7). For licences, prefer logic puzzles with infinite or daily replay over trend clones.
- Viral game clips are raw screen recordings that start mid-action and loop, with a challenge caption. Start record mode mid-pull.

## Lessons: art and portal packs (2026-10-30)
- **kie.ai consistency:** generate one hero sprite first, look at it, then pass its raw PNG as `refs` to every other item. 12 breeds, 6 bosses, wins and covers stayed on-model. A full set of 46 sprites cost about 400 credits and came to 1.3 MB of webp.
- **Characters leak into backgrounds:** a style paragraph that describes eyes and noses makes nano-banana add a cat to "no characters" scenes. Background prompts must say "empty scene, NO animals, NO cats, NO people", and every background needs a look before it ships.
- **Set `rawDir: studio/art-raw/<slug>/media`** in every media spec. The default derives the folder from outDir's parent, so `dist/portals/<slug>/media/raw` became `studio/art-raw/media/raw`, which the next game would overwrite.
- **Portal covers:** make three concepts at 1K, pick one by thumbnail contrast (bright subject on a dark, saturated sky won), then re-make it at 16:9 (2K), 2:3 and 1:1 with the pick as the ref. `node tools/portal-media.mjs <slug> "<Title>"` renders the exact sizes, clean and titled.
- **Serve `games/` as the web root** for local QA (`npx http-server games -p <port>`). Serving the repo root 404s `/site.css` and the "more games" thumbnails, and every agent reports those as console errors.
- **Portal SDK timing:** CrazyGames v3 `game.*` calls are only valid after `await SDK.init()`. The GameDistribution SDK may keep its own reference to `GD_OPTIONS.onEvent`, so hook into the forwarder the portal build defines (`window.__gdOnEvent`); don't replace onEvent after load. `firstFrame()` can run before `loadData()`, so every CG call path must call `initPortal()` first.

## Lessons: the 5-lane QA swarm (2026-10-30)
- **Five lanes in parallel (layout, first-time, perf, chaos + portals, art) found 6 blockers in about 45 minutes** that one generalist pass had missed, and three lanes found the same one (the win sunburst). Give every lane the §4 blocker list and a port, and serve `games/` as the root.
- **Decorative layers drawn after text count as text overlap.** A row's glow or sunburst must be clipped to its own row (`g.rect` clip) or drawn before the rows above it.
- **Settings must apply live:** a slider that saves but only takes effect on reload is a blocker. Wire the settings bus to the audio setters and test it in the same session (`qa/perf/perf-audio.mjs` measures RMS through an analyser).
- **Frame governors:** budget backing pixels, not dpr, and skip about 30 frames after every window resize (re-bakes are slow by design). A dpr cap ratchet turned a resize drag into half resolution for the whole session.
- **Input guards:** a lost `pointerup` must not freeze input for long. 2 s is enough to ignore a real second finger.
- **Web chrome over the canvas** ("how to play", "more games") is an accidental-tap risk during play. Show it on the title and map only.
- **Two tabs of a whole-save game erase each other** (last write wins). On the web, merge before every save and on `P.onStoredChange`: progress takes the max or union, and currency, boosters and settings come together from the newest write, so a merge never duplicates yarn. Read through `P.readStored()`, never `localStorage` (Playables warns, even about the word in a comment).
- **Every small label is 12 px or more on compact screens:** queue labels, chips, badges and sub-captions all need `Math.max(12, …)`. A text-size matrix at 10 sizes finds them; eyeballing 2 sizes does not.

## Lessons: critic panel r1 → fix round 2 (2026-10-30)
- **Six critics scored 7–8 (mean 7.75) with zero blockers on a build QA called clean.** What they flagged was the play itself: early levels with no decisions (a greedy policy 3-starred 13 of 20), instruction text at 12 px written in jargon ("Hold 1 or fewer for 3★"), a lose card with no way out, and no content after the last level. Run the panel *before* the final polish, not after.
- **Tune early levels by the greedy bot's 3-star share, not its win rate.** The target is 98% wins and 16–34% 3-star on L4–L20, so new players win but rarely max. A board that random taps can beat (the L10 boss before the retune) reads as "too easy" to every critic.
- **Split fix agents by file ownership** (UI-CARDS: ui.js; UI-LAYOUT: layout.js and index.html chrome; RENDER: render/scene/art; LEVELS: rules/levels/data). Four in parallel finished in about 50 minutes with no conflicts. Where two need the same file, one owns it and the other sends exact edits.
- **The Playables warnings match text, not calls.** A comment with the word "navigator.share" and a hard-coded `https://arcadeaday.com` share URL both warn. Build share URLs from `location.origin + location.pathname`, and gate sharing with `P.canShare` (off on yt and the portals).
- **Every lose card offers a way forward:** Undo, Hint and +1 Slot with counts (buy-and-use at 0), plus a free Hint after 2 losses on the same level. Every new mechanic gets a "?" next to the level title that shows its coach lines again.
- **Content after the campaign:** generated bonus boards with their own ramp (bonus-data.js, 60 boards, about 98 KB) answer "what do I play after L60?" cheaply. Re-dressed remixes of campaign boards don't.

## Lessons: critic panel r2 → fix round 3 (2026-10-30)
- **r2 moved the mean only 7.75 → 7.92, and new blockers came from the fixes themselves.** The new "+N more" pill covered the badge on tablet, the boss banner sat on the HUD, and the share card hid "Level N" behind the kitten. Screenshot every fix at 390x844, 360x640, 820x1180 and 1440x900 before the next panel, and give each overlay one owner function that returns its box, so collision code (tags, coach marks) and drawing can never disagree (`R.moreChip`).
- **Banners and overlays must never fade over text.** Put a banner in empty space (the spool rack), keep it fully opaque, and leave by scaling out. A fade lets the HUD read through it, and critics call that an overlap.
- **Mid-game 3★ should be reachable but rare.** After the retune the average bot 3-starred 0–7% of L21–L60, and par was never explained. Raise par above the solver's optimum when needed (`stats.opt` keeps the optimum, and `check.mjs` enforces `opt <= par < cap`), add a breather level every ~5, and teach the 3★ rule in words at its intro ("keep the basket nearly empty for 3 stars"). Target: average-bot win ≥ 0.65 and 3★ 15–40% per band.
- **Unlock a mode at the level that teaches its pieces.** The Daily used key/lock pairs from day one but unlocked at L7, before keys are taught (L14). It now unlocks after L13. Labels must say what is actually there ("Bonus tangle 3", "Play on: Bonus Tangles + the Daily Knot"), never "Endless" or "soon".
- **After a level pass, run `tune4.mjs merge` last.** The older `tune3.mjs merge` and `gen.mjs --merge` rebuild levels-data.js from older parts and silently revert the newer pass.
- **A mechanic's first level must be easy (critic r3, fix round 4).** L8 "Tied Up" introduced knots with a 3-slot basket, and only 69% of average-bot runs and 29% of casual runs won it, which two critics called a cliff. Give an intro level one more basket slot (`KK4_FORCE=1 tune4.mjs relief <id>`; knot levels change cap only, because a re-dress drops the knot) and keep the real spike a few levels later.
- **Coach-mark bubbles hang below their whole row, not just the chip they explain.** The "+1 more" bubble aimed at the chip and sat on the active spools' badges on phone, or on the HUD world name in landscape. Point the target box down to the shelf so the placer puts the bubble in open space.
- **Desktop Share needs a picture fallback.** Firefox and many desktop browsers have no Web Share. Write a `ClipboardItem` holding both image/png and text/plain, so an image paste gets the card and a text box gets the dare and link. Fall back to copying the text only.

## Lessons: QA and tuning (Days 1–9)
These still apply in v2. Give the relevant ones to every QA, bot and video agent.

- Run `node tools/record.mjs <slug> --snap 2,8,15,20,24 --query "..."` and look at every PNG critically. Check:
  - Is it beautiful?
  - Is it readable?
  - Does anything overlap or go off-screen?
- Play it in the browser pane at mobile size (375×812) and at desktop size. There must be no console errors, and the title, play, death, retry, garage/shop and mute flows must all work.
- Be honest: would a 16-year-old send this to a friend? If not, fix it.
- Unattended (scheduled) runs can't start the preview dev server. Instead, drive the real page with Playwright: serve `games/`, open `?qa=1` at 375×812 (isMobile, hasTouch) and at 1440×900, and play with real `page.mouse` down/up. Add a `window.__qa()` state getter behind `?qa` and use it to build a noisy "human" bot with ~150 ms reaction lag. Its scores tell you whether the difficulty is fair.
- Scouting: games embedded on Poki/CrazyGames don't load in the browser pane (blank iframe). Scout from the trending/new lists and thumbnails instead.
- Scale the world by height on wide screens (e.g. `min(SW/460, SH/720)`). Otherwise the hero is tiny on desktop.
- Keep the camera from letting the hero climb under the score HUD, especially in record mode, where the HUD sits lower.
- Bonus moves that end in a death (SKIM etc.) should only pay out once you survive them. A "+2" on the death frame feels broken.
- For timing games, give the QA bot the game's own timing (phase, period, amplitude via `__qa()`) and add Gaussian timing noise (σ 25/50/80 ms = good/average/casual player). Extrapolating velocity from sampled frames is too noisy at headless 30 fps. Target: casual reaches the first zone change, good players go 2–3× further.
- Attract-mode bots must not call `navigator.vibrate` (or any player-only side effect). Gate those on `!run.bot`.
- itch.io shows a Cloudflare challenge in the browser pane. Skip it (never solve the challenge) and scout from Poki/CrazyGames lists instead.
- QA bots must fire taps on **game time**, not on wall-clock `setTimeout`. Under headless load, the `dt` cap (0.05) makes game time run slower than real time, so wall-clock bots tap early and report fake deaths. Check `__qa().t >= aim` inside a rAF loop.
- If the QA page server is hand-rolled, serve `.css` as `text/css`. Otherwise `/site.css` is rejected and the info sheet looks broken (it isn't).
- Waves or moving ground: paint everything behind the water (hills, sky) all the way to the bottom of the screen. Otherwise unpainted canvas shows through as black slabs in the troughs. OG renders catch this.
- When a number caption sits next to a live HUD count (e.g. "1 more to the record"), the video `cap2` must agree with the HUD on every frame it shows. Use a vague cap2 ("SO close…") if it appears several skips before the crash.
- A real-world record (88 skips) makes a great built-in target: a progress bar with a WR flag on the HUD and the game-over card ("1 skip short of the world record"), and the video ends one short.
- CrazyGames `/t/trending` is a 404 now. Scout from `crazygames.com/hot` and `/new` instead.
- Precision scoring with integer readouts (e.g. "50%") needs a small assist toward the target. Without one, the perfect window was ~0.4 px and hits were pure luck. Tune the assist with the human bot until a skilled bot lands ~15–20% perfects and a casual one lands a few.
- Swipe bots: the first stroke sample must sit **outside** the target. If you advance the swipe before the first sample, the stroke starts inside the fruit and never registers as a cut.
- One callout at a time:
  - New pops fade the older ones, but only pops past ~0.15 s, so a combo pop pushed in the same frame doesn't kill the main one.
  - When a target sits under the HUD, move its pop *below* it rather than clamping it onto the % labels.
  - A big centre callout (PERFECT) carries its own points and yields (starts fading) on the next cut.
- Juice splats: draw each as a single filled path with a few blobs. Many separate circles read as bubble clutter.
- Record-mode crash: trigger the scripted fail toss at `cuts >= crashAt`, not `crashAt - 1`. Otherwise the bot clears the bait before the fail plan applies.
- Put on-canvas hints like "tap anywhere to retry" just under the game-over card. At the screen bottom they sit behind the "how to play / more games" chips.
- "Get as close as you dare" games (hold to grow, release before contact): set the slow-mo from a **target closing speed** in mm per real second (`ts = V / worldClosingSpeed`, V rising with level), not a fixed time scale. The gap closes several times faster than the radius grows when the target is far from the anchor, so a fixed slow-mo was unplayable (good bot died at balloon 0–6) and the next try was endless (casual bot averaged 25). Make the first 2–3 rounds gentler so nobody dies on the tutorial.
- Long-surviving bots make QA runs crawl: cap a profile at ~50 rounds and run mobile and desktop QA in parallel in the background.
- Wide screens: if the title sits over the play area, give landscape its own title layout (words on the left, camera shifted so the scene sits right).
- Record-mode bots aiming for a tiny gap must predict the next frame's gap and release early, or they overshoot into a pop at 60 fps steps. Scan a few `seed`s with a quick headless loop and pick one where the crash target looks dramatic on screen.
- Hide the HUD score while `cap2` is showing in record mode; they share the top band.
- Games where the object keeps moving after release (spin decays, settles): the QA bot must predict the outcome **if it let go now** (expose `__qaAhead(sec)` that simulates forward with hold=false). Assuming the state freezes at release made every bot look terrible.
- A rare "jackpot" outcome (landing on the cap): use an asymmetric assist, a strong settle toward the normal result and a weaker one toward the jackpot. That makes it a skill shot, not a lottery. Target: good bot hits it every few landings, casual bot almost never.
- Need double moves (two flips) without making singles twitchy: add a wind-up. Holding past ~0.7 s ramps the speed up, instead of raising the base speed.
- In unattended runs the browser pane may be declined. Use Playwright screenshots from a scratchpad script (mobile 375×812 and desktop 1440×900); don't retry the pane.

## Lessons: Day 8 (Bin It)
- Pseudo-3D (a perspective camera with z-sorted boxes) reads great on a portrait screen, but the horizontal FOV is narrow (about ±12°). Put props you need to see (the fan that explains the wind) mid-room at |x| ≤ 1.3 m, z ≈ 6, turned toward the camera. Things on the side walls near you are off-screen.
- A thrown object's arc passes through the top HUD. Redraw the in-flight object after the HUD, and hide HUD pills (wind) during rim/death moments so "RIM OUT!" pops don't collide with them.
- Canvas gotcha: drawing extra paths (creases) inside a clip and then calling fill() or stroke() uses the last path. Keep the outline in a Path2D.
- Tune difficulty with a quick Node Monte Carlo of the outcome model (landing error = aim noise + partial wind correction) before Playwright. Then confirm in Playwright that real swipes at `__qaAng(e)` land at exactly e (Bin It: e = 0.000).
- 11 throws at about 2.2 s each overran 30 s. Script the crash at throw 9 for a 30 s cut.

## Lessons: Day 9 (Reel Greedy)
- A perfect bot lies about difficulty. The first Monte Carlo had sharks snapping 0–6% of runs, so the game felt toothless. Give the sim bot a human reaction lag (re-decide every ~0.35 s with ±15 u of noise) and a greed factor that pulls it toward fish. Then tune hazards until snaps are about 13–19% at 70–150 m and bites rise with depth.
- Hazards that just drift past never create drama. Sharks needed two behaviours: homing (drift toward the nearest chain node once the hook is full or heading up) and a short lunge when the hook or chain is right ahead. Add an edge "!" warning, plus a first-sighting tip so the lunge feels fair.
- One callout at a time: hide the tutorial hint whenever a banner (SHARK!, SNAPPED!) is up. Two texts at once read as noise on a phone.
- Wide screens: two-line key hints, and check that decor such as rock boulders doesn't poke above the waterline when the playfield is letterboxed (clamp to the surface y).
- A verlet chain of caught fish is the hero visual. Spacing must scale with fish size (4 + L·0.5) or the chain clumps into a blob.
- Video: a scripted 330 u/s "crash" shark that snaps the line about 11 m from the boat with 14 fish on it is the money shot. Freeze the bot's steering so it can't dodge it.
- Review the video frames *before* recording, not just in QA. The record run found two callouts at once ("REEL IN!" over a fading zone banner) and a bare "0" in the HUD the moment the line snapped. Showing the lost points struck through, live, makes the fail land twice as hard.
- World-gen changes reshuffle seeds. Re-run a seed sweep (outcome, tUp, tSnap, maxFish per seed) before reusing yesterday's record query.

## Lessons: Day 10 (first v2 run)
- macOS is case-insensitive: writing `tournament.md` overwrote the stage brief `TOURNAMENT.md`. Give briefs and outputs distinct names (e.g. `GDD-BRIEF.md` vs `docs/gdd/…`, `PLAYTEST.md` vs `playtest.md` is NOT safe).
- Subagents may be blocked by a harness hook from writing `REPORT.md`-style report files. Every brief must say "if a write is refused, don't work around it; return the findings in your final message", and the orchestrator saves them.
- No DataForSEO credentials (`.env` missing): `tools/keywords.mjs` falls back to Google autocomplete only. Score search demand on autocomplete depth and say so in the report.
- Playables extras worth building in from the start: a haptics on/off toggle if the game vibrates, Esc closes dialogs, a labelled Pause screen, separate music and SFX controls.
- The Day 10 session was interrupted twice (process exits). Background agents died mid-task and about 6 hours were lost between Stage D and Stage E, so production only started at 20:40 IST. Make every agent write its deliverable early and refine it in place. After any restart, check `studio/<date>/` for partial work and resume agents with SendMessage instead of relaunching them.
- Extract `consts.js` verbatim from the GDD yourself (awk the §13.2 code block) and add `games/<slug>/package.json` with `{"type":"module"}`, so every role, Node harnesses included, can start in parallel at once.
- Day 10 missed the 22:30 gate: production finished ~22:45 (started 20:40 after a ~6 h interruption gap), so integration/QA/critics roll to the next run from branch `wip/knot-kitty`. Next run: merge wip → integrate leftovers → QA swarm → fix levels difficulty (strand counts below GDD) → critics → ship Day 10 before starting Day 11.
- Day 10 overnight: after the gate was missed, QA (5 lanes) + fix round 1 (5 file-owned fixers + levels) ran past midnight on the wip branch, with a shared FIX-BRIEF.md of cross-module contracts (event names, exported helpers). Zero merge conflicts and playables-check stayed green. Reuse that pattern: one owner per file, contracts written down before launch.

## Lessons: Knot Kitty update (2026-10-31, first Saturday improve run)
- Run an update like a build day: write UPDATE-BRIEF.md first with file owners (META-UI: ui/meta/game/layout/render; LEVELS: data files + tools), contracts (data formats unchanged, SAVE_V bump + migrate, check.mjs and playables-check as gates) and the 7 screenshot sizes. Two owners, zero conflicts.
- A portal adapter is dead until its name is in `PORTALS` in platform.js. The Playgama branch in `initPortal` was written but never ran, because `__PORTAL='playgama'` wasn't whitelisted; the perf/portals QA lane caught it by checking the built zip at runtime. Adding a portal = whitelist + `initPortal` branch + `build-portal.mjs` script tag + a runtime check of the built index.html.
- Playgama Bridge v2: `bridge.initialize()` returns a promise. Queue every bridge call behind it (`pgReady`), send `platform.sendMessage('game_ready')` from `P.ready()`, and follow `AUDIO_STATE_CHANGED` / `PAUSE_STATE_CHANGED`. Never block the game on it.
- New screens break the 12 px floor first: price chips, sub-lines in tinted rows, confirm lines, counters. Use a `txtMin` helper that tries shorter copy, then wraps to 2 lines, and never shrinks below 12.5 px. Write the short copy up front ("Saves a missed day").
- Screenshots taken before a fix round are stale. Re-run the layout audit (text-size + overlap script) after every fix round and look at the compact 360×640 shots again before shipping.
- Save shape change: bump SAVE_V, give new fields defaults in `sanitize`, keep `migrate` accepting every old version, and merge cross-tab (bitmask progress OR'd; spendables like shields from the newest write). The save lane loads real v0/v1 saves and chaos-tests claims. Accepted gap: an old cached build writing a v2 save drops the new fields.
- Harder late game without cliffs: set band targets per decade (bot-mix avg win, casual win, decision turns) and keep bosses near 0.44 and no non-boss below ~0.5. Remix via new tune parts merged through the existing tune chain, so `check.mjs` stays the single gate. L41–60 went from "cluttered" to ~8.5 decision turns.
- After the final level, the main title/map button should point at the daily loop (Daily, then Bonus when Daily is done), never a replay. A finished campaign needs goals past the end: per-world collection sets, a 7-day streak ladder with a day-7 gift, a shop sink that protects the streak, and a bonus track with a gift every N wins.
- A HUD icon placed beside the title must clear the subtitle line as well when its circle reaches down that far, and short landscape HUDs need a compact fallback. The layout audit misses this because drawn circles aren't text boxes. Look at zoomed landscape HUD crops at 667×375, 740×360, 844×390 and 915×412, using the longest titles (the last level and the Daily).
- Portal uploads (2026-11-01): open each dev portal read-only first and check for "Log in"/sign-up pages before planning anything. Coolmath's "Submit Your Game" is a Google Form with no upload field (it needs a play URL and a contact name and email), so keep a paste-ready answer sheet in `dist/portals/<slug>-coolmath-form.md`, and only submit when the contact email is recorded in studio/portals.md by the user.
- Playgama's automatic build check rejects a zip without `playgama-bridge-config.json` next to `index.html` ("Invalid Playgama Bridge config file path"); `build-portal.mjs` now writes a minimal one. A re-upload doesn't replace a failed build in the console: delete the failed build first, then upload. The console also wants a 1080×1920 portrait cover (scale the 800×1200 cover to 1280×1920 and centre-crop). Sandbox publish gives a public playgama.ai/play/<id> link at once; Review unlocks only after the Sandbox targets are met.
- Playgama moderation (Review, not Sandbox) also requires Bridge storage instead of localStorage, `platform.language` for localization, and `showInterstitial()` at natural pauses. `games/shared/platform.js` does the first two for every game since 2026-11-05 (a Knot Kitty rebuild picks them up). Interstitials need a `P.breakpoint()` call at a natural pause: Slurp Pot has one on win-card NEXT, Knot Kitty has none yet.
- GamePix dev dashboard (my.gamepix.com): Create New Game takes title, main tag, up to 4 extra tags (custom "Select tags" modal: search, tick, OK) and a 100-500 char description. The game page then has Info (orientation, desktop/mobile friendly, engine, SDK integration: Save), Assets (icon 256x256 ≤1 MB, cover 1360x850 ≤1.5 MB; click the slot's Add first, then attach the file to the hidden input, or nothing uploads), Editorial (How to Play is required, max 500 chars), Build (zip with index.html at root, Upload, wait about 30 s for "Build ready") and Submit for Review. Preview opens the build in a GamePix test player that logs every SDK call. Make the cover from the 1920x1080 title cover: scale to 1511x850 and crop 1360x850 anchored left, because a centre crop cuts the title.
- Two Chrome profiles are connected to Claude in Chrome. The selected browser can flip between them mid-task, which makes "tab not in group" errors. Re-select the profile that holds the portal tabs (list_connected_browsers, then select_browser) instead of opening new tabs, because a signed-out profile shows "session expired".

## Lessons: Monday scout + bake-off (2026-11-02, first weekly Monday)
- **Pick where store velocity and video heat overlap.** Arrow/ring/tile puzzles own Play install velocity but get almost no views; block puzzles, physics "grow/escape" sims, runners and hole "tiny-to-huge" clips own video. The winner needs a proven store core *and* a growth or chain moment a 6-second clip can show.
- **Build into portal gaps:** level-based hole games and crowd/gate runners are mobile mega-hits missing from every portal hot list, while sort/jam/merge/block are crowded there (≥ 10 block clones on CrazyGames). Playtesters called the block-puzzle finalist "Block Blast with a skin", which ended it despite a slightly higher score.
- **Name-check before naming:** search the title on Poki, CrazyGames, the stores and the web before it goes into the GDD. "Gobble Pot" collided with Poki's "Gobble" (a Fancade hole game) and became "Slurp Pot" at Stage D.
- **Agent playtesters pause real-time games** between screenshots (1–20 s per decision), so steering feels coarse and turn-based builds score higher than they should. Weight real-time builds by bot metrics and a headed GPU run as well, and say so in the bake-off verdict. The devil's advocate predicted this; forward its fixes to builders mid-build, not after.
- **3D in the browser:** headless Chromium renders WebGL with SwiftShader (software), so 3D fps must be measured headed with the GPU (`headless:false`, `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`). CDP CPU throttling doesn't throttle GPU fill rate, so low-end Android stays untested until a real phone opens a Pages preview: ask the user midweek.
- **three.js in production:** r187 ships no `three.module.min.js`. Production bundles a tree-shaken entry (`tools/<slug>/three-entry.js`, named imports from the npm `three` devDependency, addons via `three/addons/...`) with esbuild into `games/<slug>/vendor/three.bundle.js`. Even a bare renderer+scene+mesh entry is about 520 KiB, so the budget is ≤ 600 KiB raw / 160 KiB gzip, and build-playables' one '> 512 KiB' warning for it is expected. **Never put anything under `games/shared/`** that isn't shipped to every game: build-playables copies the whole folder and fails on uppercase names (a vendored `vendor/three/LICENSE` broke it for every game). Prototype copies live in `studio/vendor/three/` (local only). Never load three from a CDN (Playables CSP).
- **A harness hook blocks subagents from writing report `.md` files** (REPORT.md, playtest-*.md). Ask every agent to return its report text in the final message as well, and save it yourself; never work around the block.

## Lessons: Tuesday core build (2026-11-03, Slurp Pot)
- **Eight file-owned roles in parallel built a first playable in one afternoon** (Core, Sim, Levels, Render, Art, UI, Audio, Meta), all briefed from one `studio/<date>/BUILD-BRIEF.md` that points at the GDD §13 module map and interfaces. No file conflicts. Cross-role requests go into each role's notes.txt, and the orchestrator applies them or carries them to the next day (`studio/<date>/WED-CARRYOVER.txt`).
- **Run a differentiation pass before UI and Art start.** Put the 2–3 closest hits side by side and write down what we must not copy (timer shape and position, booster row, size gauge, "+1" pops, settings cog). It becomes a GDD decision row that overrides older sections. It's cheaper than re-skinning after critics say "clone".
- **On YouTube, Esc during play belongs to the host** (it leaves fullscreen). Esc may close our cards, but pausing goes on P (and the on-screen button). Check *every* key handler: game.js and ui.js both opened Pause on Esc, and playables-check presses Esc before its pause/resume test, so "resume restores game time" failed in all three browsers.
- **`__qaInput` actions must all carry finite x/y, `up` included.** The checker synthesizes touch pointer events at `elementFromPoint(x, y)` in Firefox/WebKit, so a bare `{type:'up'}` crashes the whole run there (Chromium's CDP path hides it).
- **Comments in index.html are checked too.** The "no site chrome" check matches the text `build:body` anywhere in the Playables index.html, including a CSS comment. Never write build-marker names in comments.
- **Don't run timing gates while tuners are running.** Level tuners use every core (load average 17), so headless gates time out ("gameReady within 5 s", "mouse-only completes level 1") for no real reason. Finish or stop tuning first, then run playables-check and the sweep on an idle machine.
- **three warns from `compileAsync` when `KHR_parallel_shader_compile` is missing** (every headless run), and a console warning is a blocker. Call `compileAsync` only when `renderer.extensions.has('KHR_parallel_shader_compile')`, else `renderer.compile`.
- **Background tools inside a subagent:** a subagent that starts long jobs in the background can end its turn "waiting", so its report never arrives. Ask agents to run long tuners in the foreground with a wall-clock cap, or SendMessage them to finish when the jobs are done.

## Lessons: Wednesday content day (2026-11-04, Slurp Pot)
- **RAM rule (user, 16 GB Mac):** one Playwright browser per agent, closed in a `finally`; `memory_pressure | tail -1` must show ≥ 25 % free before any launch (≥ 30 % for headed GPU runs); tuners use `--jobs 3`; one node job per agent at a time; stop servers and watchers when a batch ends. A background watchdog that alerts below 20 % free shows quickly whether a dip is ours or another session's (Whisper jobs of about 3.5 GB each caused the 13 % dip at 10:52). Never kill another session's processes.
- **og/record tools need the full MIME map and a readiness wait.** Serving `.webp`/`.glb`/`.mp3`/`.ogg` as octet-stream broke art and audio in record runs. A three.js boot under machine load took 8.7–20 s, so `record.mjs` now waits up to 60 s for `__recReady`, and `og.mjs` waits for `__ogReady` (only for games whose code sets it) before its `--wait`.
- **Check the og frame against the record timeline.** The og step count (18.2 s) was already past the cake tipping into the pot (the win heart was showing). The moment that sells the game was at 17.0 s. Look at the og shot next to the record snaps at ±1 s.
- **One scheduled task can run twice.** A 10:07 run and the regular 13:04 fire both drove Slurp Pot on one branch. The second run took the first for finished: it committed a checkpoint, rewrote the STATE block and left a detached tune loop (ppid 1). A run should call `list_task_runs` first. If another run of the same task is `running`, it reports and stands down. A detached loop it finds is left to finish, with no second tuner beside it. A "succeeded" run is not necessarily over: its own subagents can wake it again (the 13:04 run woke at 14:39 and started a second detached loop over L22–L60). The live run should tell the other run's agents to stand down, or ask the user to stop that session.
- **Network drops end subagents but not their jobs.** ENOTFOUND stopped two agents mid-step while their tune run and http.server kept going. Resume the agent with SendMessage, telling it which pid is its own and which isn't, and never start a second copy of a job that is still running.
- **Bots must be measurably worse than greedy.** When casual sits 10–25 points over goal.casual on many levels and average gets 3★ on 100 % of a level type, T can't fix it (the greedy window pins T). Fix the bot model (casual lag, heading noise, hesitation; a smaller look-ahead for average), not the targets. Stage bot changes in a copy while a tuner runs, because each tune batch re-imports bots.js. Then re-tune every level against the new bots.
- **Feast length: tune the clock constant first.** Runs were 1.5× the GDD ticket band. Moving `FEAST.add0` 14 → 12 put Picnic and Harbour inside expert 14–20 / casual 5–9, and only the outlier town (Market) needed easier courses.
- **The Android fps check needs an unlocked phone.** rAF stops behind a secure lock screen, and `wm dismiss-keyguard` won't clear a PIN. Never type a PIN or change phone settings. Ask the user to unlock the phone and leave Chrome open on the preview, then run `studio/<date>/orch/phone-fps.mjs` over `adb forward tcp:9222 localabstract:chrome_devtools_remote` (raw CDP, no local browser).

## Lessons: Thursday morning (2026-11-05, Slurp Pot)
- **The weekly model limit can end every subagent at once.** The Levels agent died with HTTP 429 ("You've hit your weekly limit"), but the main session kept working and the agent's files were safe on disk. Keep long jobs in plain scripts (`runbatches.sh`, tuner, verify) so the orchestrator can carry them alone, and tell the user the reset time: critic panels need agents, so the limit can threaten the Friday and Saturday gates.
- **A deterministic tuner gives the same answer until something changes.** Same seeds, same pick, so a second pass over a failing level is wasted. Use new seed bumps (`tune.mjs --from 20 --seeds 41`), a new spec, or a wider band.
- **Stored bot stats go stale after a bot change.** L3 kept its layout and timer, but its casual win rate went from a stored 78 % to a measured 35 % once the reworked bots ran it. `verify.mjs --stats` only reads what was stored, so re-measure a level before you trust it, and look at the worst levels by eye: a gate count can improve while one early level gets much worse.
- **When a level is pinned between the greedy and casual windows, sweep T on the stored layout by hand.** The tuner weights greedy twice as much as casual, which is the wrong call on early levels and on cliffs, where the player's first impression is at stake. A small script that runs `verifySpec` at 3–4 timers per level, three levels at a time, takes minutes.
- **Small open boards are sprint levels.** On the Islands layout, average bots finish in 30–40 s on any board while greedy swings 25–59 s by seed, so a long timer hands every human bot 3★, and bigger bosses fail the margin and food gates. Give them bigger orders and T near 46–52 instead.
- **Facebook Instant Games is free and open, but it's slow to go live.** Each game needs its own Facebook app and reviews, and the one-time Approved Partner Program (1–4 weeks) comes first. Upload is web UI only, so it's a user step. The build side is `tools/build-portal.mjs <slug> facebook`: `fbapp-config.json` at the zip root, SDK `fbinstant.8.0.js`, `initializeAsync` before any other call, saves through `player.getDataAsync/setDataAsync`. FBInstant has `onPause` but no `onResume`, so a pause with the page still visible has to resume on the next touch. A Privacy Policy URL and a Data Deletion URL are required.
- **A new portal name must go on the `PORTALS` allow-list in `games/shared/platform.js`.** The Facebook build had the adapter and the SDK tag, but `facebook` wasn't on the list, so `portalName` came back empty and `startGameAsync` was never called: the game would have sat on Facebook's loading screen forever with no error. Only a run against a stub SDK that records calls caught it (`studio/2026-11-04/orch/fb-test.mjs`). Test every new portal adapter that way before calling it done.
- **A win rate that doesn't move when the timer moves is a bot bug, not a level.** On L25 the expert stayed at 70.6 % at any T. A trace showed the 0.5 u router grid had no cell centre inside the gap back through an eaten gate once the pot grew, so the bot banned the last ingredients and wandered until time ran out. A force-steered pot took them in 8 s. Before re-tuning a stuck level, trace one losing seed and force-steer the route. The router now retries with 0.35 u less clearance when it finds no path, but only for targets whose zone the pot already fits. After any bot fix, re-run the full `verify.mjs`: L4's stored casual 94 % was really 70 %, and the bots had nothing to do with it (an A/B on the old bots gave 70 too), so a stored pass count flatters the table.

## Lessons: Thursday afternoon (2026-11-05, Slurp Pot)
- **A bot that circles forever means its commands are late, not that the level is broken.** The mouse-only Playables check timed out one run in three to six with the bar frozen at 73–93 %. The wall clock and the game clock agreed and fps was fine, so the game wasn't slow. A state dump showed the pot circling its target with the stick 90° behind the bot. The drive loop took 570 ms because `page.mouse.move(..., { steps: 4 })` is four round trips and each one waits on a renderer frame under software WebGL. One step cut the loop to 220 ms and level 1 from 33–73 s to 21–40 s, with no timeouts in 9 runs. The touch run sends one event per move, which is why only the mouse run failed.
- **Before chasing an input stall, model it headless.** `studio/2026-11-05/levels/l1-lag.mjs` feeds the bot's commands to the sim late. At a 1 s delay it times out about one run in three, which pointed at lag in minutes. Then dump the real state (pot, stick, bot target, bot output) once the bar stops moving: a frozen bar with a moving pot is a different bug from a frozen pot. `PC_TRACE=1` on `playables-check` prints wall against game clock every 5 s.
- **Silence isn't a lost pointerup.** Slurp Pot's touch guard dropped the stick after 2 s without events, so a finger held dead still stopped the pot. A held finger sends nothing. Only a new press can prove the old pointerup was lost, so check there. No test caught it, because the bots always move: reading `input.js` did.
- **`page.waitForFunction` with an `async` predicate doesn't wait.** The returned Promise counts as truthy, so it returns at once. Poll from Node, or make the predicate synchronous.
- **Read the portal's docs for its save rules before a portal pack goes out.** Playgama moderation checks saved progress and the docs say never to save straight to `localStorage`. Our adapter did exactly that, and Knot Kitty's Sandbox build still does until its next rebuild.
- **The ground past the board is part of the game's first frame.** Slurp Pot's Picnic ground was a bare brown table, so on a tall phone the board floated in a void with trees standing on nothing. The art lane scored it 6.5. A mown lawn with stripes, a picket fence, a hedge, sunflowers and trees past the far edge took about 90 lines of geometry in the one static mesh, no new draw calls. Look at what shows around the board at phone size before calling a level's art done. Near the camera, keep only flat things, because anything tall blurs over the HUD.
- **Check an art note against the code before fixing it.** The "moiré on Harbour umbrellas" was the deliberate dither that fades a prop standing in front of the pot, not aliasing. Reading the shot next to the pot's position settled it in a minute.
- **Tiny always-edible food can draw bigger than its physics.** Tier 0 food (a 0.07–0.11) was a few pixels at 390 wide. Scaling only the render copy by 1.3 costs nothing: sim sizes, fit rules and the "too big" cue stay put.
- **On wide screens, carry the art past the column.** The map's flat side bands became the same town art, mirrored at each seam and dimmed, so the trail stays the subject. Wash locked towns across the full width too, or the wings look unlocked.
- **`tune.mjs --write` holds a snapshot of the specs.** Applying timers or specs while it runs gets overwritten. Finish every hand edit first, then start the search.
- **A shell throttle needs a test before a long batch.** `sweep.sh` waited on `$(jobs -r | wc -l)`, and in zsh that subshell sees no jobs, so all 23 lines launched at once (load 160, four rows in five minutes). Let `xargs -P 8` do the throttling, and check `ps` a minute after any batch starts.
- **A seed search makes old sweep rows stale.** Timer rows belong to one layout. Move the file aside when layouts change, or a pick can read a timer measured on a level that no longer exists.
- **A level far below its casual target wants a smaller start and more small food, not more time.** Slurp Pot L43 sat at casual 28, and adding 9 seconds only reached 55 while average 3★ went to 72. Start r0 .3 with more tier 0 food plus a fresh seed search gave casual 75 and a full pass. The reverse doesn't hold: a harder mix on L20 took casual to 100.
- **Check a mock's timing before you believe a blocker.** The "taps during an ad" fail came back on every run because the mock ad closed at 400 ms and the tap loop ran past it. Hold the mock open longer than the test, then read the result.
- **Big screenshots can fail on a loaded machine.** `Page.captureScreenshot` gave "Unable to capture screenshot" on the largest contact sheets with the tuners running. It's a tool hiccup, not a game bug, and a short retry fixes it.
- A forced QA path can't catch a data-shape bug. `__qaFail` passed `{need, got}` while the real fail passed `{kind, n}`, so a real fail could never say "Out of time!" and the shots all looked right. End one level the real way before trusting a card.
- Reproduce a lane's stall before you believe or dismiss it. The first-time lane's bot "stalled" on desktop in 3 of 3 levels; a clean loop at the same size won L1 to L3 with no stall, so the fault was the lane's harness.
- Never point at something the player can't do yet. A bouncing pointer on a sandwich the pot can't swallow cost a new player a minute. Show the pointer when the item fits, and name the rule on first contact, since a slow push never reaches bump speed.
- Art past a portrait column: blur it (downscale, upscale in steps, no `ctx.filter` on Safari) and give the column a soft shadow. Sharp mirrored art reads as a duplicate and a seam.
- **`build-portal` copies from `games/yt/<slug>`, so run `build-playables` first.** Knot Kitty's Playgama pack came from an Oct 31 copy with no Bridge saves and no ad slot, and it built without a warning. Rebuild in that order, then run pg-test on the zip, never on the source tree.
- **A stale pack passes everything until you test the zip itself.** The chaos lane's only "blocker" was dist zips older than the code. Check zip times against the last commit before you call a pack ready.
- **Size juice by the view, not by the pot.** Crumbs set from the pot radius vanished on the first levels and swamped the late ones, because the camera pulls back as the pot grows. Scale by the follow distance (`3.6 + 7.2 * r`) and they read the same at every size.
- **Check when an event fires before you hang a feature on it.** `chain` only fires on every fifth bite, so effects hung on it missed the first four. The `bite` event carries the count; use that and keep `chain` for the milestone.
- **Filtering on `isPrimary` also blocks the second thumb.** It was meant to keep one pointer on the UI, but it meant Pause and boosters ignored a tap while the other thumb steered, which is how phones are held. Give a second finger a tap-only path on play and pause, and test it with real CDP touch points.
- **CDP `touchEnd` lists the fingers that lift, not the ones that stay.** Passing the steering finger lifted it, and the test blamed the game. Keep this in mind for any multi-touch check.
- **A save copied in two places needs a merge at boot, not only on write.** Facebook loads the server copy first, so a failed `setDataAsync` left the player behind until the next save. One `mergeStored()` in `initMeta` closes it, and the game's own `merge` already keeps the most progress.
- **A long clock for everyone kills the tension for everyone. Give the slow hand a retry-only mercy clock.** Raising Slurp Pot's grace on L6 to L15 made a slow hand win, and casual went to 99 to 100 % with clocks near two minutes. Each straight time-out now adds 0.4 of the pace to the next try, up to three steps, stars stay on the pace, and a win resets it. A fast player still feels the first clock.
- **When you fix a difficulty wall, measure the next levels too.** The slow-hand fix for L4 to L15 didn't remove the wall, it moved it to L16. A sweep over the levels after the fix shows that in one run. A check on the fixed levels alone shows a pass.
- **A new reward can inherit the wrong words.** Small chests on L1 went through the town chest card and would have said "Town chest!" in Picnic Park on the first win. Read the card for every new path into it, not only the new payout.
- **Stricter gates make a pass count look worse.** Levels went from 28/60 to 34/60 while the gates tightened, so old and new counts aren't comparable. Say which gates a count used.
- **Help that resets each level leaves a slow hand failing every level.** Slurp Pot's mercy clock worked on the retry, so the grandparent won a level on try three or four and then started the next one with nothing. Carry part of the help into the next level (one step down per win), so a slow hand settles and a fast hand never sees it.
- **Every retry mercy has to cover the Daily too.** The panel's slow hand lost the Daily four times in a row, because mercy only ran on levels. When you add help to one mode, list the other modes that can fail and decide for each. Feast stays out on purpose, since it has no clock to win.
- **Don't show a new mode right after a hard level.** The Daily intro popped up after a level a slow hand had just fought through. Wait for a calm win before you introduce anything.
- **Read the keys already on a shared data object before you add one.** `data.milestone` was already meta's reward key, so a win-card flag with that name would have broken the reward path. The new flag is `data.bigBoss`.
- **A shared tool's title can differ from the game's.** `portal-media.mjs` drew one plum, two-line title for every game, which fought Slurp Pot's title screen. Keep the look and position per game, and check the existing game's media doesn't move.
- **A `Math.min` in a save merge runs on every write.** It pinned Slurp Pot's mercy carry at 0, and no sim test could see it. Test anything saved through the real save path in a browser, with a reload.
- **Before you tighten a band for one bot, read the other bots' gates.** A level can pass for the bot you tuned and fail for the next one. A gate written before a change may also need rereading. Ask what it stood for, then rewrite it (gate 3a on pile levels asked the wrong question).
- **A star band can bake in stinginess.** Casual 3★ sat at 0 to 5 % from L4 to L20 while casual won about 100 %, and every gate passed because the band said so. A critic called it stingy. Read 3★ rates per bot, not only win rates.
- **Set star pace from measured rates, not a formula.** Chain bonus seconds lift time left, so median time over a star ratio overshoots. The rate can also move 10 to 20 % per second near the line, so step in small moves and rerun.
- **A test player that steers late measures its own control loop.** A bot replayed with lag orbits a target just outside bite range and looks like a stuck level. Before you believe a driver's losses, trace where the pot spends its time.
- **A hint must be a route.** A straight line through a hedge says "push the hedge". Flood around what is solid now and draw the path.
- **A critic script can outlive its agent.** Run test scripts in the foreground with a time limit and stop browsers in `finally`. Six browsers at once took load above 500 and the software GL frame rate spoiled the test.
- **`perl alarm` kills the parent, not its workers.** A tool that spawns its own workers leaves them running, and they hold the pipe open. After a time limit fires, list the workers and stop your own by PID. Scope long tools to the range you need.
- **A gate that never sets a new flag cannot see it.** New card options passed layout-test because the test didn't use them, and a private copy with the flags found 21 failures. Add every new layout flag to the shipped gate's list.
- **Warm art on warm ground gets lost in a grid of thumbs.** Changing only the street on Slurp Pot's cover to cool teal made the pot stand out at 128 px, without touching the character. When a generated edit leaves odd fragments, ask for that one fix with the last image as the reference.
- **A render loop that catches its own errors hides them from the gate.** Slurp Pot's 2D path threw on every frame and the page still reported 0 errors, because `paint` caught it and logged a warning. Count those `[P]` warnings as errors in qa-run.
- **A site build can change what a pack ships.** build-site added a Google Fonts link to the game page, build-playables copied it, and playables-check allowed it, so six packs called another origin. Only the chaos run caught it. Rerun chaos after any build-site change, and drop web fonts when the pack has its own.
- **Cap a kind in a scripted run, then recheck the bumps.** Fewer swing sets pushed the record plan past its slot, and one cap value made the pot hit a gazebo. Check late bite times and bumps after every cap change.

## Lessons: Saturday finish (2026-11-07, Slurp Pot)

- **A subprocess time limit orphans forked workers.** A python `subprocess` timeout killed `verify.mjs` and left its `--vchild` workers running. Run long tools as a background job, or in ranges of four levels or fewer, and list workers afterwards.
- **Check what a phone is showing before you touch it.** An adb test ran while the owner was using the phone and a capture caught a personal feed. Read the foreground app first, stop if it isn't idle, and never capture a personal screen.
- **A critic who jumps levels can't see a retry-only mercy.** Four critics called L6 to L20 too hard after cold `__qaLevel` samples, while the in-order mercy clock clears those levels by try two or three. Make the brief ask for in-order play with tries logged, then read the tries.
- **A gap-fill must count the radius of big props.** The first fill for L1 to L3 found almost nowhere to go, because a slot's clearance ignored what the big props occupy, then the loosened version hit the item cap on L3. Count the prop's radius and cap the fill.
- **A clip's tail after the payoff is dead air.** The record clip sat on an idle pot for seven seconds after the cake went down. Cut the beat sheet to the payoff, and move every timer that hangs off the old end (ticket fade, camera pull, loop, comments) in the same change.
- **A course with no order lines leaves a blank ticket.** The clip's HUD card was an empty cream box over 15 seconds of footage and nobody saw it until a critic did. Put the run's real count there: it is the proof the caption promises.
- **An eased fade outlives a short animation.** Food going into the pot eased back from its ghost dither over the whole 0.3 s tip, so the gulp read as a speckled smear. Snap the value on the state change.
- **The clip's frame 0 is the thumbnail on most feeds.** A level-start reveal shot and a camera still springing in made frame 0 a wide empty field with the pot under the hook caption. In record mode, skip reveals and snap the camera to its goal on the first frame, then check frame 0 on its own.
- **The iris or fade colour should match the card it closes on.** A dark iris over a teal end card read as a cut to black. Use the end card's own colour.
- **Store art and the game have to look like the same game.** A glossy clay cover of a town the clip never shows was called a bait and switch. Generate covers with an in-game frame as the style reference, and show the scene the clip and L1 show.
- **Grace that buys no stars makes every slow win a 1-star win.** Reading 2★ off the full clock and 3★ off the grace-free pace gives a slow hand a visible reward, and leaves the fast bar and the 3★ gate where they were.
- **A feature intro inside the NEXT chain must keep NEXT as the big button.** A first-timer taps the gold button without reading it, so a card that leads with a new mode pulls them sideways. Put the new mode on the second button and keep its badge on the map.
- **When verify's casual bot wins everything but players say the clock is tight, run the slow-hand table before arguing.** On L3 to L12 verify casual won 100 %, while the slow-hand model (lag, aim error) won L11 and L12 in 0 of 30 and L8 in 2 of 30. That matched two critics who played in order. Add the seconds as grace (T and grace up together), so the 3★ pace, the gates and the mercy step don't move.
- **A forced result skips the flows that hang off a real one.** `__qaWin` is quiet, so it never sets `first` and never queues the first-win cards. Test a win chain with a bot that really wins the level.
- **When a clip's timing changes, update its unit test the same day.** modes-test still expected the 25 s loop and a plan covering every course item, so the change looked like four failures. The test lives in studio/, which git ignores, so nothing in the commit flags it.
- **A layout test only guards the bounds the layout hands out.** The landscape shop passed 160k layout checks while ui.js widened one row past its column and drew the Gild button over a booster. When the UI draws in a sub-rect (a column, a split row), the layout must export it and the UI must clip to it, so the test sees it.
- **A landscape multiplier has to follow the aspect, not be one number.** A flat 1.35 follow-width and the 0.88 short-screen zoom (written for portrait) put an 844x390 phone far too close. Scale by w/h with a floor, keep the short-screen factor portrait-only, and shoot 844x390, 640x360 and a 16:10 desktop after any camera change.
- **A landscape phone can sit on the text floor without anyone noticing.** At u 0.75 every ticket font was the 12.5 px floor, a quarter smaller than portrait. Check which sizes are floor-bound, and grow the parts that live in their own column first: that costs no play space.
- **A win-card nudge should name the best thing the bank buys, not the cheapest left.** With 1,387 coins it pointed at a 300 pot; name the priciest affordable item, then the next sink (Gild) when the shelf is empty.
- **A node script with a setTimeout cap needs an explicit exit.** Without `clearTimeout(cap); process.exit(0)` the run waits out the cap after its work is done.
- **Never leave a bare `cat >` without a heredoc in a command chain.** It reads stdin forever, so the whole background job hangs. Pass `</dev/null` to scripted runs.
- **Place a clip's frame-0 dressing where the preroll leaves the pot, not at the spawn.** The first back-fill went behind the spawn point and never showed, because the 0.4 s preroll had already moved the pot 1 unit and the close camera sees under 1 unit either side. Compute the frame-0 position from the route, then check frame 0 on its own.
- **A loop iris should open onto frame 0, not close to a colour.** A clip that ends by irising in on the restarted first frame loops without a seam; one that closes to a dot ends on an empty frame.
- **A tag that hangs below its slot needs its overhang in the layout bounds.** The booster price tag sits 0.45 of its height under each tin; the layout only reserved the tin, so the last tag touched the screen edge at 390x844 while layout-test passed. Export the overhang to the layout and shoot the stack with empty stock (the tag only shows then).
- **Look at the frame before acting on a critic's diagnosis.** "Empty ticket during BOSS UNLOCKED" was the ticket's 0.3 s flip caught mid-frame, and "crawling cross-hatch" was the 'low' tier's render scale (headless SwiftShader runs at 0.75 to 1.25). Find the code path that drew the frame, then decide whether to fix or reject.
- **A new HUD element needs its own named rect in layout-test.** The star pill drew over the ticket for two rounds because the test only checked the rects it already knew about. Add the rect in the same commit as the element.
- **Generated content can pick items that have no art.** The Daily's "eat" line picks the most common food in the level, and six of those foods had no icon, so the card drew a plain red ball. List every value a generator can return, and make art (or a deliberate fallback) for each one.
- **When bots and hand players disagree on difficulty, believe the hand players and the slow-hand model.** The designer's casual bot lost first on L24, while two critics playing by hand lost on L6 and L8. The slow-hand model put a first-timer's first wall at L13. Quote that table in the reply instead of retuning toward the bot.
- **A portal pack copies the Playables build, so build Playables first.** build-portal.mjs zips games/yt/<slug>. Run it before build-playables and the packs ship yesterday's tree: here, without the six new icons and the end-card art. After a rebuild, check that a file added today is in each zip.
- **End a promo clip on the store cover.** The flat teal end card did not look like the thumbnail a viewer would tap. The top two thirds of the end card is now the 800x1200 cover, fading into the teal above the call to action, which stays at 70 % height (clear of the TikTok caption band).
- **A scripted browser driver steers a frame late in headless Chromium.** Chrome hands a dispatched touchmove or pointermove to the page on its next animation frame, and a headless frame is about 0.2 s. So a dispatch-then-advance loop moved the stick one loop behind the bot. The greedy bot used 37 s of the L3 clock in the browser and 19 s in node, and two critics in a row read the orbiting as a hard level. The QA hook now applies the last move it handed out before `__qaAdvance` steps (`input.qaMove`). Before you trust a critic's difficulty numbers, check that the driver's browser times match the node bot.
- **Read the code path before you act on "the pot sat on the boss and never ate it".** A served boss in Slurp Pot is edible at any size (`bossOpen`), so a 30 s hover meant the pot never overlapped it. A size hint would have fixed nothing. Find the rule the critic's frame implies, then check whether the game has that rule.
- **Write a target in the same units as the number beside it.** The win card said "Finish 54s faster for 3 stars" next to "0:11 left", and a slow player could not tell what it asked. It now says "Finish with 0:53 left for 3 stars", the same m:ss clock as the stat. A button next to a second choice should say where it goes ("NEXT · Level 7"), not just "NEXT".
- **Match the QA hand to the persona.** Slurp Pot's `__qaSteer` played every kind on the slow first-time hand, so the kid and mobile critics, who play like regulars, saw 2 stars everywhere and called the stars stingy, while the sim's average bot 3-starred L4-L10 in 87-100 % of runs. `__qaSteer(kind, hand)` now takes 'normal' or 'slow'. Each critic brief names the hand for its persona: slow for the grandparent, normal for the kid, the mobile designer and the marketer.
- **Add grace, not clock, when slow hands lose and fast hands are fine.** Raising T alone also moves the 3-star line. Raising T and grace by the same amount keeps the pace (T - grace) and the 3-star line where they were, and only buys the slow hand time to finish. On L13-L25 slow-hand first-try wins went from 0-11 to 13-16 of 30, with slow-hand 3-stars still 0.
- **Set QA state and read the result inside one `page.evaluate`.** Animation frames step the sim between two evaluates, so a `__qaTime(1.2)` in one call wiped the clock floor the sim had added a frame earlier, and the test reported "no floor". Run the set, step and check in one synchronous evaluate.
- **Let the UI draw one real frame after loading a level before testing a HUD reaction.** The UI builds the new level's HUD on its first frame. A level played to the event inside the same evaluate as `__qaLevel` fired its events at the old HUD, so "BOSS UNLOCKED! +5 s" looked missing. Sleep about 0.5 s after `__qaLevel`, then drive.
- **Grace works in both directions.** Raising T and grace together buys a slow hand time and leaves the 3-star line where it was. Lowering grace with T kept leaves the win odds where they were and brings the 3-star line closer. On L2-L3 a slow hand went from 0 to 6-10 three-star finishes in 30, at no cost to any gate that has a band there.
- **When players lose with every order line done, fix the walk to the boss, not the whole clock.** Flooring the clock at the walk distance when the last padlock pops (distance / speed x 1.3 + 4 s) halved slow-hand done-but-lost runs (88 to 41) and never fired for the normal hand. A/B it against the same seeds with the rule off, so you can show that the fast bar did not move.

## Lessons: Sunday release (2026-11-08, Slurp Pot missed the gate)

- **Deploying from a worktree drops untracked builds.** `games/yt/<slug>/` is untracked, so a fresh worktree of main has none of it, and a deploy from there would take the live /yt/ pages down. Copy every `games/yt/*` into the deploy dir first, then curl each /yt/<slug>/ for 200 after the deploy.
- **The permission layer blocks portal file uploads in a run.** Playgama's "Drop your ZIP here" input was refused. Don't retry it another way. Get each portal to the step right before the upload, then hand the user the exact clicks and the zip path. Plan Sunday uploads as user steps unless the layer allows them.
- **An attestation page is the user's statement, never the run's.** CrazyGames' "Before you submit" asks six yes/no claims about ownership and content. Leave them unticked and list them for the user.
- **Grace that saves the slow hand can flatten the average hand.** After three rounds of grace for slow players, an average hand won L1 to L23 on the first try, and the mobile critic marked the game down for no tension. Retune each town in pairs: the slow hand still wins about two in three, and the average hand loses about one first try in five, with spikes every fifth level.
- **CrazyGames refuses archives.** Its upload zone says "Archive files are not supported", so it needs loose files. Flatten the pack (art/ and fonts/ to the root, fix the paths in art.js and fonts.css), test it locally, then drop the files in. Have build-portal write the flat folder for CrazyGames next to the zip.
- **The CrazyGames QA confirmation needs the user's go-ahead in chat.** The permission layer blocked "I confirm that these results are correct" + Continue while the user was only watching; it went through after the user typed "finish it". Fill in every QA answer, then ask. Don't reload the qa-continue tab: it loses the results. Recover with My Games > Go to QA, play a level, Continue.
- **CrazyGames Details needs two preview videos, and its last step is a revenue-share contract.** Details asks for landscape 16:9 and portrait 2:3 hover videos (at most 20 s, MP4/MOV) besides the three covers. Make them with record mode at the exact size. Record mode is fixed at 1080x1920, so in a scratch copy of the game change the record branch's `A.resize(1080, 1920, REC_DPR)` in modes.js to read `rw`/`rh` from the query (and scale the hand by `Math.min(S.W, S.H) / 1080`), then run tools/record.mjs from that copy with `rw=1920&rh=1080` or `rw=1080&rh=1620` and every caption param empty (`hook=&mid=&cap2=&cap3=&free=`), cut before the URL end card, open on the static cover for 1 s with a 0.4 s fade. Keep each file under 10 MB (two-pass x264 at 3.5 Mbps is about 7.9 MB for 18 s at 60 fps): the Chrome upload bridge refuses anything bigger. Turn on "Show label zone" and keep the title out of the top-left badge corner on every cover and on the video's first frame. Step 4 asks to accept the Developer Terms (a revenue-share contract with Maxflow) and a PEGI 12 statement: both are the user's ticks, and so is Submit for approval.
- **A user signed in and watching can unblock uploads.** In the 11-08 evening session the same Playgama zip upload that was refused in the 1 PM run went through. Plan the Sunday uploads for a live session.
- **A verified Meta business has no website field.** Business details "Edit" goes to the Security Centre, which only shows "Verified". Changing the website on a verified record goes through Meta support, not the settings UI.
