# Daily game playbook

This is the pipeline the daily run follows to ship one new game. Every game must be one you would be proud to see with 10M plays. If a game isn't great, don't ship it: iterate until it is.

## 0. Context
- Repo: `/Users/sairahul/Documents/projects/poki` → GitHub `sairahul1526/arcadeaday` (branch `main`).
- Live: `https://arcadeaday.com/<slug>/`. The hub at `/` renders `games/games.json`. The Cloudflare Pages project is still named `onemoretry-games`. arcadeaday.com and www are proxied CNAMEs to `onemoretry-games.pages.dev`. The old pages.dev host still serves the site too, so share only arcadeaday.com links.
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

Only build a concept that scores ≥ 28/35. Otherwise ideate again.

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
- OG/meta tags and canonical link pointing at `https://arcadeaday.com/<slug>/`. The in-game share URL and the record-mode end card use `arcadeaday.com/<slug>`.
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

## 5. Ship
1. Add the game to `games/games.json` (slug, title, tagline, date YYYY-MM-DD, accent) and to the README table.
2. Run `node tools/og.mjs <slug>`, then look at `games/<slug>/og.jpg`.
3. Commit (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), then `git push`.
4. Deploy with `npx wrangler pages deploy games --project-name onemoretry-games --branch main --commit-dirty=true`. Never pass `--force`.
5. Run `curl` against the live URLs. Every file must return 200.

## 6. Video
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

## 7. Report
The final message must include:
- the live URL
- the video path
- the caption
- a 3-line summary of the game and the twist.
