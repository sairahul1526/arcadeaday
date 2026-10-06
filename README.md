# Arcade a Day

Tiny, addictive browser games. A new one every day. Free, no download, no sign-up.

**Play:** https://arcadeaday.com

| Game | Released | Play |
| --- | --- | --- |
| **Kiss the Edge**: drift to the beat. The closer you cut it, the harder the music hits. | 2026-10-06 | [play](https://arcadeaday.com/kiss-the-edge/) |

## Layout

```
games/                 everything here is deployed as-is (static, no build step)
  index.html           hub page, renders games.json
  games.json           game list (newest shown first)
  <slug>/              one folder per game: index.html, game.js, audio.js, og.jpg
tools/
  record.mjs           deterministic gameplay recorder: 1080x1920 60fps MP4 + offline-rendered soundtrack
  og.mjs               1200x630 share image from a game's title screen
```

## Run locally

```bash
npm install
npx http-server games -p 8787 -c-1
```

## Record a video

Each game supports `?record=1`: fixed timestep, a scripted bot, and audio rendered offline from the event log.

```bash
node tools/record.mjs kiss-the-edge --query "seed=11&crash=22&hook=the music only gets better|if you ALMOST crash"
```

## Deploy

```bash
npx wrangler pages deploy games --project-name onemoretry-games --branch main
```
