// POST /api/ev: one analytics event from games/shared/platform.js (P.event), stored in D1 (binding EV, table ev,
// tools/analytics/schema.sql). Body: { g: slug, e: event, d: data, s: session id, a: age in days, m: touch 0/1 }.
// No cookies, no IPs, nothing that outlives a page load. Junk is dropped quietly; the answer is always 204.

const HOSTS = /^(www\.)?arcadeaday\.com$|\.pages\.dev$|^localhost$|^127\.0\.0\.1$/;
const MAX_BODY = 2048, MAX_D = 512;
const IST = 5.5 * 3600e3;

const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const hostOf = request => {
  try { return new URL(request.headers.get('Origin') || request.headers.get('Referer') || '').hostname; } catch { return ''; }
};

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const host = hostOf(request);
    if (!HOSTS.test(host) || !env.EV) return done();
    const txt = await request.text();
    if (txt.length > MAX_BODY) return done();
    const b = JSON.parse(txt);
    const game = String(b.g || ''), e = String(b.e || '');
    if (!/^[a-z0-9-]{1,40}$/.test(game) || !/^[a-z0-9_]{1,32}$/.test(e)) return done();
    const s = /^[a-z0-9]{1,16}$/.test(b.s) ? b.s : null;
    const age = Number.isInteger(b.a) && b.a >= 0 && b.a < 100000 ? b.a : null;
    const mob = b.m ? 1 : 0;
    const data = b.d && typeof b.d === 'object' && !Array.isArray(b.d) ? b.d : {};
    const lvl = data.id == null ? null : String(data.id).slice(0, 32);
    const d = JSON.stringify(data).slice(0, MAX_D);
    const ts = Date.now();
    const day = new Date(ts + IST).toISOString().slice(0, 10);
    const cc = (request.cf && request.cf.country) || null;
    waitUntil(env.EV.prepare('INSERT INTO ev (ts, day, host, game, e, lvl, s, age, mob, cc, d) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ts, day, host, game, e, lvl, s, age, mob, cc, d).run().catch(() => {}));
  } catch {}
  return done();
}
