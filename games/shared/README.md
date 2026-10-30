# games/shared: the v2 platform layer

Everything here is copied into every YouTube Playables build. `tools/build-playables.mjs` copies it to the zip root and rewrites `../shared/` to `./`. It is not a site page: `build-site.mjs` skips it.

- `platform.js`: the `P` API. Game code never touches `localStorage`, `visibilitychange`, `pagehide`, `navigator.share`, `window.open` or outbound links directly.
- `fonts.css` + `fonts/`: self-hosted woff2 fonts under the SIL OFL 1.1 (licences in `fonts/ofl-*.txt`):
  - **Lilita One** (display)
  - **Nunito** (UI, variable weight 400–900)

## `P` in one screen

```js
import P from '../shared/platform.js';
drawLoadingFrame();
P.firstFrame();                                   // the loading frame is on screen
await P.init({ store: 'abc_', version: 2, defaults: { v: 2, best: 0, ... }, migrate: old => upgraded });
P.onPause(() => { stopLoop(); audioCtx.suspend(); });
P.onResume(() => { startLoop(); if (P.audioOn) audioCtx.resume(); });
P.onAudio(on => (on && !P.paused ? audioCtx.resume() : audioCtx.suspend()));
await document.fonts.load('40px "Lilita One"');
P.ready();                                        // interactable; always after firstFrame()
```

| Member | Notes |
|---|---|
| `P.env` | `'yt'` or `'web'` |
| `P.qa` | `true` under `?qa=1` |
| `P.data` | the save object (always has `v` and an integer `best`) |
| `P.init(o)` | Awaits `ytgame.game.loadData()` on yt and `localStorage[store+'save']` on web. An empty string, corrupt JSON or a non-object gives you `defaults`. A save with `v < version` goes through `migrate(old)` and is written straight back. Missing top-level keys are filled from `defaults`. |
| `P.save()` | Debounced: the first call writes at once, later calls at most once a second. A pending save is flushed on pause and on `pagehide`. yt: `saveData(JSON)`. web: `store+'save'` and `store+'best'`. |
| `P.flush()` | writes a pending save now |
| `P.best(n)` | Floors `n` to an integer. If it beats `data.best`, it raises `data.best`, saves, and on yt calls `sendScore({value})`. Returns `true` when `n` is a new best. |
| `P.audioOn`, `P.onAudio(cb)` | the host audio flag (always `true` on web, where the game keeps its own mute) |
| `P.onPause(cb)`, `P.onResume(cb)`, `P.paused` | yt: `system.onPause`/`onResume`. web: `visibilitychange`/`pagehide`/`pageshow`. |
| `P.firstFrame()`, `P.ready()` | Idempotent. `ready()` calls `firstFrame()` first if it hasn't run yet. |
| `P.canShare`, `P.canLink`, `P.showMute` | `false` on yt |
| `P.share({title,text,url})` | Web Share, falling back to the clipboard. Resolves `true`/`false`. No-op on yt. |
| `P.link(url)` | navigates (for example `P.link('../')` for "more games"); no-op on yt |
| `P.lang` | `system.getLanguage()` on yt, `navigator.language` on web |
| `P.error(e)` | `console.warn` plus `health.logError()` on yt. It never throws, and it is never a console error. |

When `P.qa` is on, `window.__P = P` as well.

## Build convention (`tools/build-playables.mjs`)
The game's web `index.html` is the only input page.

**Styles and markup:**
- **Every `<style>` block is game CSS** and is copied verbatim. Keep site-only rules out of it; they live in `/site.css`, which is never copied.
- **Exactly one `<!-- yt:body --> … <!-- /yt:body -->` block** holds the game markup: the canvas plus any overlay DOM (shop panel, toast). It must not contain `<a href>`, build markers, `.back` or `.sheet`. Put it around the canvas and overlays, before `<!-- build:body -->`.
- `<link rel="stylesheet">` tags pointing at `../shared/*.css` or fonts.googleapis.com are kept. Prefer `<link rel="stylesheet" href="../shared/fonts.css">`.

**Entry point:** the entry is always `game.js`, an ES module. Inline scripts in `index.html` are not copied.

**What gets copied:** every file in `games/<slug>/` except `index.html` and `og.jpg`, plus `games/shared/*` (except this README). A file name that clashes with a shared file fails the build.

**Paths and file names:**
- relative paths only
- file names `[a-z0-9_.-]`
- never `import`/`src`/`href`/`url()` with `../` anything except `../shared/`

The build fails on any of these:
- an absolute path
- a bad file name
- a file over 30 MiB
- more than 8,000 files
- a bundle over 30 MiB
- a missing `yt:body` block or `game.js`
- links or site chrome in the markup

On failure it deletes `games/yt/<slug>/`.

```
node tools/build-playables.mjs <slug>                       # games/<slug>/ -> games/yt/<slug>/ + dist/playables/<slug>.zip
node tools/build-playables.mjs --src tools/fixtures/hello-playable
node tools/playables-check.mjs <slug> [--browsers chromium,firefox,webkit]
```

## QA contract for `tools/playables-check.mjs`
The checker always loads `games/yt/<slug>/?qa=1`. Under `?qa=1` (`P.qa`) the game must expose these:

```js
window.__qa = () => ({ t, mode, level, progress, score /* optional */ });
//   t        game time in seconds: advances only while the loop runs, frozen while paused
//   mode     a string; it must be exactly 'play' while a level is in progress
//   level    the current level number
//   progress saved progress as an integer (e.g. levels beaten): 0 on a fresh or corrupt save,
//            >= 1 once level 1 is won, restored after a reload
//   score    optional; if present it must not change across a live resize
window.__qaInput = () => [{ type: 'tap' | 'down' | 'move' | 'up' | 'wait', x, y, ms }];
//   CSS-pixel pointer actions that move the game forward from where it is now:
//   title/map -> press play -> win the level -> next. Return [] when there is nothing to do yet;
//   the checker polls about every 50-100 ms. Prefer 'tap'. 'down'/'move'/'up' use real CDP touch on
//   Chromium but synthetic touch PointerEvents on Firefox/WebKit. Aim at where the target WILL be
//   (about 60 ms ahead).
window.__qaOldSave = () => ({ save: '<JSON string of an older save version>', progress: N });
//   After loading this save, __qa().progress must equal N, and the saved JSON's v must be higher.
```

The game must also do these things:
- call `P.best(...)` with an integer at the latest when level 1 is won, so a `sendScore` happens
- save progress when level 1 is won
- create its AudioContext the normal way (`new AudioContext()`), because the checker tracks every instance
- keep every AudioContext out of the `running` state while it is paused or while `P.audioOn` is false
