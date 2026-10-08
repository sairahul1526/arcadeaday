# Daily game playbook

This is the pipeline the daily run follows to ship one new game. Every game must be one you would be proud to see with 10M plays. If a game isn't great, don't ship it: iterate until it is.

Two audiences, both matter: people scrolling TikTok/Reels (the video) and people searching Google for a game to play (the page). Every game ships with a page that ranks for a real search phrase.

## 0. Context
- Repo: `/Users/sairahul/Documents/projects/poki` → GitHub `sairahul1526/arcadeaday` (branch `main`).
- Live: `https://arcadeaday.com/<slug>/`. `games/games.json` is the source of truth. `node tools/build-site.mjs` generates the hub (`/`), 404, sitemap, robots and each game page's `<!-- build:head -->` / `<!-- build:body -->` blocks from it. Never hand-edit generated parts. The Cloudflare Pages project is still named `onemoretry-games`. arcadeaday.com and www are proxied CNAMEs to `onemoretry-games.pages.dev`. The old pages.dev host still serves the site too, so share only arcadeaday.com links.
- Brand: **Arcade a Day**, "a new free game every day." Each game is "Day N" in order of release. Shipped games are listed in `games/games.json`. Never repeat a core mechanic.
- Reference implementation: `games/kiss-the-edge/` (canvas + procedural Web Audio, record mode, og mode). Copy its patterns, not its game.

## 1. Scout (≤ 20 min)
- In the browser, look at what's hot: poki.com (new and trending), crazygames.com, itch.io HTML5 "popular this week", and hyper-casual hits (Voodoo, SayGames, Ketchapp).
- Briefly play 2–3 candidates to feel the core loop.
- Pick a **proven core mechanic**, then add one **original twist** that makes it fresh and video-friendly.

## 2. Ideation gate
Write 3 concepts. Score each 1–5 on:
1. **One-second read**: a scrolling viewer understands it instantly.
2. **One input**: tap, hold or swipe, learned in 3 seconds.
3. **Near-miss tension**: "ooh!" moments, skill visible on video.
4. **Juice**: screen shake, particles, pops, combos, sounds that feel good.
5. **Progression and escalation**: speed, intensity or music builds up, so you want one more run.
6. **Shareable twist**: something people comment on ("wait, the music changes?!").
7. **Session length**: the first death comes in 10–40 s and retry is instant.
8. **Search demand**: there's a 2–4 word phrase people already type into Google that this game honestly is ("frog tongue game online", "drift game online"). Check with `node tools/keywords.mjs "<seed>" ...`: 5 = DataForSEO volume ≥ 1k/mo or a full autocomplete list, 1 = no completions at all. Prefer phrases with low difficulty: the site is new and can't win "free online games" yet.

Only build a concept that scores ≥ 32/40. Otherwise ideate again. Virality still comes first: never pick a weaker game just because its keyword is bigger.

## 3. Build (games/<slug>/)
- Plain HTML5 Canvas 2D with ES modules. No build step, no external libraries. Fonts from Google Fonts only.
- Mobile-first portrait. Pointer, touch and keyboard all work. DPR-aware. Must work at 375×812 and on desktop.
- All sound is procedural Web Audio (music plus SFX), with a mute toggle. Audio unlocks on the first gesture.
- Retention features:
  - best score
  - "NEW BEST!" mid-run
  - instant retry (tap anywhere)
  - coins/unlockables (localStorage)
  - escalating difficulty
  - first-run tutorial prompts
  - Web Share
  - vibration
  - a "more games →" link to `../`
- Page shell: copy `games/kiss-the-edge/index.html` and keep its rules, which the build lints:
  - `<!-- build:head --><!-- /build:head -->` right after the viewport meta, and `<!-- build:body --><!-- /build:body -->` right before the game script. Don't write title, description, canonical, og or twitter tags yourself. The build fills them from games.json, plus `/site.css`, JSON-LD and the `.back` links ("how to play" / "more games").
  - `html, body` must not set `overflow: hidden` or `height: 100%`, because the info sheet scrolls one screen below the game. Put `touch-action: none` on the canvas, not on body. Keep `#garage { touch-action: none; } #garage .panel { touch-action: pan-y; overscroll-behavior: contain; }` and the hidden-scrollbar rule.
  - The `keydown` handler copies Kiss the Edge's: ignore non-game keys, then `if (mode !== 'play' && scrollY > 40) return;` (keys don't start a game while someone reads the sheet), then `preventDefault()` **before** the `e.repeat` check. Otherwise each auto-repeat of a held Space scrolls the page mid-run. On top of that, the build's shared script stops Space from ever scrolling any page.
- The in-game share URL and the record-mode end card use `arcadeaday.com/<slug>`.
- **Record-mode contract** (`?record=1`), needed by `tools/record.mjs`:
  - Render a fixed 1080×1920 canvas.
  - Use a fixed 1/60 s timestep, driven only by `window.__rec.step(n)`. It returns `{t, mode, score, dead, corners, streak}`, where `mode` becomes `'over'` at the end.
  - `window.__rec.frame(q)` returns a JPEG data URL of the canvas.
  - `window.__rec.audio(dur)` returns a base64 WAV rendered with `OfflineAudioContext`, from the logged events and music state.
  - Set `window.__recReady = true` once fonts are loaded.
  - A scripted bot plays well, builds to the climax, then fails at a planned moment (`crash=<n>`).
  - Query params:
    - `hook=line1|line2` draws a caption for the first ~3.5 s
    - `cap2=` draws a tension caption before the crash
    - the end card shows the title, "play free, no download →" and the URL.
- **OG mode** (`?og=1`): a clean 1200×630 title layout for `tools/og.mjs`.

## 4. QA loop (at least 2 rounds)
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

## 5. SEO page (games.json)
Copy an existing entry and fill every field. The build refuses missing ones.
- `slug`, `title`, `tagline`, `date` (YYYY-MM-DD, IST), `accent`, `icon` (one emoji), `store` (the game's localStorage prefix, e.g. `ffl_`, so the hub can show "your best"), `shop` (name, item noun, `[NAME, price]` list straight from game.js).
- `share.title` / `share.description`: the punchy social copy for og tags.
- `seo.keyword`: the primary phrase from the ideation check. Pick the most specific one with real demand. The slug and game title stay brandable; the keyword goes in:
  - `seo.title`: ≤ 60 chars, pattern `<Title>: <Keyword-ish Phrase> · Play Free Online`.
  - `seo.description`: 110–160 chars. Say what you do in the game, include the keyword, and end with "no download" or "works on phone".
  - `seo.h1`: `<Title>: the <keyword phrase>` or similar.
- `seo.intro` (2 paragraphs), `howTo` (5–6 steps with real point values), `controls`, `tips` (5–6, specific to this game), `faq` (4–5 real questions a player would google), `genre`, `imageAlt` (describe the og image).
- Every fact must match game.js: point values, prices, names, controls. Read the code, don't guess. Write for players, not robots: no keyword stuffing, and the keyword appears naturally 2–4 times.
- Run `node tools/build-site.mjs`. It must print no PROBLEMS. Then open `/<slug>/#how` at 375×812 and 1440×900 and check the sheet looks right, "back to the game" works, and a swipe on the game doesn't scroll the page.

## 6. Ship
1. Add the game to the README table.
2. Run `node tools/og.mjs <slug>` and look at `games/<slug>/og.jpg` (it's also the tile art on the hub). Then run `node tools/build-site.mjs` and `node tools/og.mjs hub` so the hub and its share image include the new game.
3. Commit (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), then `git push`.
4. Deploy with `npx wrangler pages deploy games --project-name onemoretry-games --branch main --commit-dirty=true`. Never pass `--force`.
5. Run `curl` against the live URLs. Every file must return 200. `/sitemap.xml` must list the new game, and a junk URL must return 404.
6. Run `node tools/indexnow.mjs` to ping Bing and co. Google picks the page up from the sitemap, which is registered in Search Console.

## 7. Video
- Run `node tools/record.mjs <slug> --secs 40 --out videos/<date>-<slug>.mp4 --query "seed=..&crash=..&hook=..|..&cap2=.."`.
- Target 20–30 s:
  - hook in the first second
  - build-up
  - climax
  - dramatic fail
  - end card with the URL
- Make sure the end card loops nicely back into the start.
- Review frames at 0.5 s, the climax, the fail and the end card. Re-record if anything is off.
- Write `videos/<date>-<slug>.md`:
  - TikTok/Reels caption (hook + question + "link in bio"), 5–8 hashtags
  - an X post
  - a pinned-comment idea

## 8. Report
The final message must include:
- the live URL
- the video path
- the caption
- a 3-line summary of the game and the twist
- the primary keyword and the SEO title.
