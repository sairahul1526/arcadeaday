-- Analytics events from games/shared/platform.js (P.event) via functions/api/ev.js.
-- Apply: npx wrangler d1 execute arcadeaday-events --remote --file tools/analytics/schema.sql
-- No cookies, IPs or cross-session ids: `s` is random per page load, `age` is days since this device first opened the game.
CREATE TABLE IF NOT EXISTS ev (
  id    INTEGER PRIMARY KEY,
  ts    INTEGER NOT NULL,  -- server time, ms
  day   TEXT    NOT NULL,  -- IST date, YYYY-MM-DD
  host  TEXT    NOT NULL,  -- arcadeaday.com, www.arcadeaday.com or a *.pages.dev preview
  game  TEXT    NOT NULL,  -- slug from the page path
  e     TEXT    NOT NULL,  -- session_start, session_end, level_start, level_complete, level_fail, quit_level, ...
  lvl   TEXT,              -- d.id when the game sends one
  s     TEXT,              -- session id (one page load)
  age   INTEGER,           -- 0 = first day on this device, 1 = next day, ...
  mob   INTEGER,           -- 1 = touch device
  cc    TEXT,              -- country (Cloudflare)
  d     TEXT               -- the event data as JSON, at most 512 chars
);
CREATE INDEX IF NOT EXISTS ev_game_day ON ev (game, day, e);
CREATE INDEX IF NOT EXISTS ev_s ON ev (s);
