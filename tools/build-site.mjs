// Builds everything search engines (and people browsing) see, from games/games.json:
//   games/index.html            hub: hero for today's game, tile grid, about/FAQ, JSON-LD
//   games/<slug>/index.html     only the <!-- build:head --> and <!-- build:body --> blocks
//                               (title/meta/JSON-LD, and the info sheet under the game)
//   games/404.html, sitemap.xml, robots.txt, <indexnow-key>.txt
// Files are only rewritten when their content changes, so sitemap lastmod = last real change.
// usage: node tools/build-site.mjs
import { readFile, writeFile, stat } from 'node:fs/promises';
import { SITE, NAME, INDEXNOW_KEY, DROP_UTC_HOUR } from './site.mjs';

const ROOT = 'games/';
const games = JSON.parse(await readFile(ROOT + 'games.json', 'utf8'));
games.forEach((g, i) => (g.order = i));
const byDate = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
byDate.forEach((g, i) => (g.day = i + 1));
const newest = [...byDate].reverse();
const latest = newest[0];

// ------------------------------------------------------------ helpers
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const url = g => `${SITE}${g.slug}/`;
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap" rel="stylesheet">';
const ORG = { '@type': 'Organization', '@id': SITE + '#org', name: NAME, url: SITE };
const LOGO = `<a class="logo" href="/"><i aria-hidden="true">🕹️</i><span>ARCADE <b>A DAY</b></span></a>`;

const problems = [];
function check(g) {
  const s = g.seo || {};
  for (const k of ['keyword', 'title', 'description', 'h1', 'imageAlt', 'intro', 'howTo', 'controls', 'tips', 'faq'])
    if (!s[k] || (Array.isArray(s[k]) && !s[k].length)) problems.push(`${g.slug}: seo.${k} is missing`);
  for (const k of ['icon', 'store', 'share']) if (!g[k]) problems.push(`${g.slug}: ${k} is missing`);
  if (s.title && s.title.length > 60) problems.push(`${g.slug}: seo.title is ${s.title.length} chars (max 60)`);
  if (s.description && (s.description.length < 110 || s.description.length > 160)) problems.push(`${g.slug}: seo.description is ${s.description.length} chars (want 110-160)`);
  if (s.keyword && s.title) {
    const hay = (s.title + ' ' + s.description + ' ' + s.h1).toLowerCase();
    const miss = s.keyword.toLowerCase().split(/\s+/).filter(w => !hay.includes(w));
    if (miss.length) problems.push(`${g.slug}: keyword words not in title/description/h1: ${miss.join(', ')}`);
  }
}
games.forEach(check);

function tile(g, { badge = false, lazy = true } = {}) {
  return `<li><a class="tile" href="/${g.slug}/" style="--accent:${esc(g.accent)}">
  <img src="/${g.slug}/og.jpg" alt="${esc(g.seo.imageAlt)}" width="1200" height="630"${lazy ? ' loading="lazy"' : ''} decoding="async">${badge ? '<span class="pill new">NEW</span>' : ''}
  <div class="tb"><div><h3>${esc(g.title)}</h3><small data-best="${esc(g.store)}">Day ${g.day} · ${shortDate(g.date)}</small></div><span class="go">${PLAY}</span></div>
</a></li>`;
}
const nextTile = `<li><div class="tile next" id="next"><div class="ph" aria-hidden="true">?</div><div class="tb"><div><h3>Day ${latest.day + 1}</h3><small>drops in <time data-next>soon</time></small></div></div></div></li>`;

// Shared client script: countdown to the next drop, "NEW TODAY" badge, best scores from each game's localStorage.
const clientJs = `<script>
(() => {
  const LATEST = ${JSON.stringify(latest.date)}, H = ${DROP_UTC_HOUR};
  const istDay = t => new Date(t + 330 * 60e3).toISOString().slice(0, 10);
  const today = istDay(Date.now());
  document.querySelectorAll('[data-today]').forEach(el => { if (el.dataset.today === today) el.textContent = 'NEW TODAY'; });
  document.querySelectorAll('[data-best]').forEach(el => {
    let v = 0;
    try { v = JSON.parse(localStorage.getItem(el.dataset.best + 'best')) || 0; } catch (e) {}
    if (v > 0) el.textContent += (el.dataset.full ? '🏆 your best: ' : ' · best ') + v;
  });
  const target = () => {
    let d = today;
    if (LATEST >= today) d = istDay(Date.now() + 864e5);
    return Date.parse(d + 'T' + String(H).padStart(2, '0') + ':00:00Z');
  };
  const els = document.querySelectorAll('[data-next]');
  if (!els.length) return;
  const tick = () => {
    const ms = target() - Date.now();
    let txt = 'any minute';
    if (ms > 0) {
      const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      txt = (h ? h + 'h ' : '') + String(m).padStart(h ? 2 : 1, '0') + 'm' + (innerWidth >= 520 || !h ? ' ' + String(ss).padStart(2, '0') + 's' : '');
    }
    els.forEach(el => (el.textContent = txt));
  };
  tick();
  setInterval(tick, 1000);
})();
</script>`;

const header = `<header class="top"><div class="wrap">${LOGO}<a class="drop" href="/#next"><span class="dot"></span><span>Day ${latest.day + 1} <span class="lbl">drops </span>in <time data-next>soon</time></span></a></div></header>`;
const footer = `<footer class="foot wrap">© ${new Date().getFullYear()} ${NAME} · a new free game every day · <a href="/">all games</a></footer>`;

// ------------------------------------------------------------ hub
const hubTitle = 'Arcade a Day: Free Browser Games, a New One Every Day';
const hubDesc = "Free browser games with no download and no sign-up. A new one-tap arcade game drops every day and works on phone and desktop. Play today's game now.";
const hubFaq = [
  ['Are the games really free?', 'Yes. Every game on Arcade a Day is free to play in your browser. No download, no install, no sign-up.'],
  ['When does the new game come out?', 'A new game drops every day. The timer at the top of the page counts down to the next one.'],
  ['Do the games work on my phone?', 'Yes. Every game is made for phones first, held upright, and works just as well with a mouse or keyboard on a computer.'],
  ['Is my progress saved?', 'Your best scores, coins and unlocks are saved in your browser on the device you play on.'],
];
const hubLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': SITE + '#site', name: NAME, url: SITE, description: hubDesc, publisher: { '@id': SITE + '#org' } },
    ORG,
    { '@type': 'ItemList', name: 'Arcade a Day games', itemListElement: newest.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: url(g), name: g.title })) },
    { '@type': 'FAQPage', mainEntity: hubFaq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ],
};
const hub = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<!-- generated by tools/build-site.mjs from games.json. Edit the generator, not this file. -->
<title>${esc(hubTitle)}</title>
<meta name="description" content="${esc(hubDesc)}">
<link rel="canonical" href="${SITE}">
<meta name="robots" content="max-image-preview:large">
<meta name="theme-color" content="#f1efff">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="Arcade a Day — a new free game every day">
<meta property="og:description" content="Tiny, ridiculously addictive browser games. A new one every day. Free, no download.">
<meta property="og:image" content="${SITE}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${SITE}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕹️</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONT}
<link rel="stylesheet" href="/site.css">
<link rel="preload" as="image" href="/${latest.slug}/og.jpg" fetchpriority="high">
<style>
  .hl { margin: 26px 0 0; font: clamp(22px, 3vw, 30px)/1.1 var(--display); }
  .hl span { color: var(--pink); }
  .ogcard { display: none; }
  body.og { overflow: hidden; width: 1200px; height: 630px; }
  body.og > :not(.ogcard) { display: none; }
  body.og .ogcard { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; height: 630px; }
  .ogcard .logo { font-size: 92px; gap: 26px; }
  .ogcard .logo i { width: 120px; height: 120px; border-radius: 34px; font-size: 68px; box-shadow: 0 10px 0 #b3236a, 0 24px 40px -10px rgba(255, 62, 138, .7); }
  .ogcard p { margin: 0; font: 36px/1.1 var(--display); color: var(--dim); }
  .ogcard p b { color: var(--ink); font-weight: inherit; }
  .ogcard .row { display: flex; gap: 22px; margin-top: 8px; }
  .ogcard .row img { width: 300px; aspect-ratio: 1200 / 630; object-fit: cover; border-radius: 18px; border: 4px solid #fff; box-shadow: var(--shadow); }
</style>
${ld(hubLd)}
</head>
<body class="site">
${header}
<main class="wrap">
  <h1 class="hl">Free browser games. <span>A new one every day.</span></h1>
  <section class="hero" style="--accent:${esc(latest.accent)}" aria-label="Today's game">
    <a class="art" href="/${latest.slug}/"><img src="/${latest.slug}/og.jpg" alt="${esc(latest.seo.imageAlt)}" width="1200" height="630" fetchpriority="high"><span class="pill new" data-today="${latest.date}">LATEST</span></a>
    <div class="info">
      <div class="kick"><span class="pill day">DAY ${latest.day}</span><span>${longDate(latest.date)}</span></div>
      <h2>${esc(latest.title)}</h2>
      <p>${esc(latest.tagline)}</p>
      <span class="best" data-best="${esc(latest.store)}" data-full="1"></span>
      <div class="cta"><a class="btn" href="/${latest.slug}/">${PLAY} PLAY</a><a class="btn ghost" href="/${latest.slug}/#how">How to play</a></div>
    </div>
  </section>
  <section class="shelf" aria-labelledby="all">
    <div class="shelf-h"><h2 id="all">All games</h2><span>${games.length} game${games.length === 1 ? '' : 's'} · free · no download</span></div>
    <ul class="tiles">
${newest.map((g, i) => tile(g, { badge: i === 0, lazy: i > 3 })).join('\n')}
${nextTile}
    </ul>
  </section>
  <section class="about">
    <h2>Play free games online, no download</h2>
    <p>${NAME} is a tiny game studio that ships a brand-new arcade game every single day. Every game is free and runs right in your browser, on your phone or your computer. There's nothing to download, no app to install and no account to make: tap a game and you're playing in a second.</p>
    <p>Each game is built around one simple input (tap, hold or let go) plus a twist that makes you want one more try. Runs are short, retries are instant, and your best scores, coins and unlocks stay saved on your device.</p>
    <div class="faq">
${hubFaq.map(([q, a]) => `      <div><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('\n')}
    </div>
  </section>
</main>
${footer}
<div class="ogcard" aria-hidden="true">
  <span class="logo"><i>🕹️</i><span>ARCADE <b>A DAY</b></span></span>
  <p><b>a new free game every day.</b> no download.</p>
  <div class="row">${newest.slice(0, 3).map(g => `<img src="/${g.slug}/og.jpg" alt="">`).join('')}</div>
</div>
<script>if (new URLSearchParams(location.search).has('og')) document.body.classList.add('og');</script>
${clientJs}
</body>
</html>
`;

// ------------------------------------------------------------ 404
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Page not found · ${NAME}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f1efff">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕹️</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONT}
<link rel="stylesheet" href="/site.css">
</head>
<body class="site">
${header}
<main class="wrap">
  <div class="lost"><b>404</b><h1>This level doesn't exist</h1><p>But today's game does, and it's free.</p><a class="btn" href="/${latest.slug}/">${PLAY} PLAY ${esc(latest.title.toUpperCase())}</a></div>
  <section class="shelf"><div class="shelf-h"><h2>All games</h2></div><ul class="tiles">
${newest.map((g, i) => tile(g, { badge: i === 0 })).join('\n')}
  </ul></section>
</main>
${footer}
${clientJs}
</body>
</html>
`;

// ------------------------------------------------------------ game pages
function gameHead(g) {
  const s = g.seo;
  const graph = [
    {
      '@type': 'VideoGame',
      '@id': url(g) + '#game',
      name: g.title,
      url: url(g),
      description: s.description,
      image: url(g) + 'og.jpg',
      datePublished: g.date,
      inLanguage: 'en',
      genre: s.genre || ['Arcade'],
      gamePlatform: ['Web browser'],
      applicationCategory: 'Game',
      operatingSystem: 'Any',
      playMode: 'SinglePlayer',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      publisher: { '@id': SITE + '#org' },
      author: { '@id': SITE + '#org' },
    },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: NAME, item: SITE }, { '@type': 'ListItem', position: 2, name: g.title, item: url(g) }] },
    { '@type': 'FAQPage', mainEntity: s.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ORG,
  ];
  return `<!-- build:head (generated by tools/build-site.mjs from games.json) -->
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
<link rel="canonical" href="${url(g)}">
<meta name="robots" content="max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(g.share.title)}">
<meta property="og:description" content="${esc(g.share.description)}">
<meta property="og:image" content="${url(g)}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${url(g)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/site.css">
${FONT}
${ld({ '@context': 'https://schema.org', '@graph': graph })}
<!-- /build:head -->`;
}

function gameBody(g) {
  const s = g.seo;
  const more = newest.filter(o => o.slug !== g.slug).slice(0, 8);
  const shop = g.shop
    ? `<h2>${esc(g.shop.name)} prices</h2>
      <p>Every run pays coins (◆). Spend them in the ${esc(g.shop.name.toUpperCase())} to unlock new ${esc(g.shop.item.toLowerCase())}s:</p>
      <table><thead><tr><th>${esc(g.shop.item)}</th><th>Price</th></tr></thead><tbody>
${g.shop.items.map(([n, p]) => `        <tr><td>${esc(n)}</td><td>${p ? '◆ ' + p.toLocaleString('en-US') : 'free (starter)'}</td></tr>`).join('\n')}
      </tbody></table>`
    : '';
  return `<!-- build:body (generated by tools/build-site.mjs from games.json) -->
<nav class="back" aria-label="Site"><a href="#how">how to play</a><a href="/">more games</a></nav>
<div class="sheet" id="how" style="--accent:${esc(g.accent)}">
  <header class="top"><div class="wrap">${LOGO}<a class="drop" href="#"><span>▲ back to the game</span></a></div></header>
  <main class="wrap">
    <ol class="crumbs"><li><a href="/">${NAME}</a></li><li>${esc(g.title)}</li></ol>
    <section class="gamebar">
      <div class="ic" aria-hidden="true">${g.icon}</div>
      <div><h1>${esc(s.h1)}</h1><div class="tags"><span class="pill day">DAY ${g.day}</span><span class="pill soft">${longDate(g.date)}</span>${(s.genre || []).map(x => `<span class="pill soft">${esc(x)}</span>`).join('')}<span class="pill soft">Free · no download</span></div></div>
      <a class="btn" href="#">${PLAY} PLAY</a>
    </section>
    <div class="cols">
      <article class="doc">
        <p class="lead">${esc(s.intro[0])}</p>
${s.intro.slice(1).map(p => `        <p>${esc(p)}</p>`).join('\n')}
        <h2>How to play ${esc(g.title)}</h2>
        <ol>
${s.howTo.map(x => `          <li>${esc(x)}</li>`).join('\n')}
        </ol>
        <h2>Controls</h2>
        <table><thead><tr><th>On</th><th>Controls</th></tr></thead><tbody>
${s.controls.map(([a, b]) => `          <tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('\n')}
        </tbody></table>
        <h2>Tips for a higher score</h2>
        <ul>
${s.tips.map(x => `          <li>${esc(x)}</li>`).join('\n')}
        </ul>
        ${shop}
        <h2>${esc(g.title)} FAQ</h2>
${s.faq.map(([q, a]) => `        <h3>${esc(q)}</h3>\n        <p>${esc(a)}</p>`).join('\n')}
        <div class="replay"><a class="btn" href="#">${PLAY} PLAY ${esc(g.title.toUpperCase())}</a></div>
      </article>
      <aside class="side">
        <div class="shelf-h"><h2>More free games</h2><a href="/">see all</a></div>
        <ul class="tiles">
${more.map(o => tile(o)).join('\n')}
${nextTile}
        </ul>
      </aside>
    </div>
  </main>
  ${footer}
</div>
${clientJs}
<!-- /build:body -->`;
}

// The info sheet needs a scrollable page: html/body must not hide overflow, touch-action:none
// belongs on the canvas, and the keyboard handler must ignore keys while the sheet is in view.
async function lintGame(g, html) {
  const js = await readFile(`${ROOT}${g.slug}/game.js`, 'utf8');
  if (/html,\s*body\s*{[^}]*overflow:\s*hidden/.test(html)) problems.push(`${g.slug}: html, body must not set overflow: hidden (the info sheet scrolls)`);
  if (/\bbody\s*{[^}]*touch-action:\s*none/.test(html)) problems.push(`${g.slug}: move touch-action: none from body to canvas`);
  if (!/canvas\s*{[^}]*touch-action:\s*none/.test(html)) problems.push(`${g.slug}: canvas needs touch-action: none`);
  if (!/keydown[\s\S]{0,120}scrollY/.test(js)) problems.push(`${g.slug}: game.js keydown handler should start with: if (scrollY > 40) return;`);
}

function replaceBlock(html, name, block, slug) {
  const re = new RegExp(`<!-- build:${name}[\\s\\S]*?<!-- /build:${name} -->`);
  if (!re.test(html)) {
    problems.push(`${slug}: missing <!-- build:${name} --> ... <!-- /build:${name} --> markers`);
    return html;
  }
  return html.replace(re, () => block);
}

// ------------------------------------------------------------ write
const changed = [];
async function put(path, content) {
  let old = null;
  try {
    old = await readFile(ROOT + path, 'utf8');
  } catch {}
  if (old !== content) {
    await writeFile(ROOT + path, content);
    changed.push(path);
  }
}
const mdate = async path => (await stat(ROOT + path)).mtime.toISOString().slice(0, 10);

for (const g of games) {
  const p = `${g.slug}/index.html`;
  let html = await readFile(ROOT + p, 'utf8');
  html = replaceBlock(html, 'head', gameHead(g), g.slug);
  html = replaceBlock(html, 'body', gameBody(g), g.slug);
  await lintGame(g, html);
  await put(p, html);
}
await put('index.html', hub);
await put('404.html', notFound);
await put('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
await put(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);

const urls = [{ loc: SITE, last: await mdate('index.html'), img: SITE + 'og.jpg' }];
for (const g of newest) urls.push({ loc: url(g), last: await mdate(`${g.slug}/index.html`), img: url(g) + 'og.jpg' });
await put(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.last}</lastmod><image:image><image:loc>${u.img}</image:loc></image:image></url>`).join('\n')}
</urlset>
`,
);

console.log(changed.length ? 'wrote ' + changed.join(', ') : 'no changes');
if (problems.length) {
  console.error('\nPROBLEMS:\n- ' + problems.join('\n- '));
  process.exit(1);
}
