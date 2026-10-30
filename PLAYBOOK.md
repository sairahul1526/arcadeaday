# Daily game playbook v2: the studio

Arcade a Day ships **one new game every day**. From Day 10 (2026-10-16), every game must feel like a big studio spent years on it. In the user's words, it should be "really god level good, as if 1000s of game devs worked on it for years".

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

### Playables CSP
Emulate it exactly:
```
default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:
```

### Official test suite
The official test suite is at https://developers.google.com/youtube/gaming/playables/test_suite. After deploy, drive it with Playwright: enter `https://arcadeaday.com/yt/<slug>/` as the Game URL and read the MUST/SHOULD results. If it insists on an invite code we don't have, note that in the report and rely on `playables-check.mjs`.

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
4. **Data-driven iteration.** `P.event` fires level_start / level_complete / level_fail / quit_level / session_end. It stays a no-op until a Cloudflare endpoint exists (a user action). Fix where players quit; add levels and seasonal content to games that work.
5. **Portal relationships.** `studio/portals.md` is the relationship log: submission URLs, requirements, contacts, what was sent, replies, genres asked for, licence status. Pitch licences, and ask portals which genres they want.

**Cadence:** one new full game per week (never two per IST day), shipped only through the §4 gate. Every run is a studio day: preflight (read this, `studio/STATE.md`, `studio/portals.md`, games.json) → daily scout into `studio/scout/<date>/SCOUT.md` → advance the current game ≥ 1 stage → on ship days, §7–§10 plus portal packs → on other days, grow one live game (drop-off fix, levels or seasonal content, a portal pack for an older game worth distributing, or a portal email draft).

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
