// Tells Bing, Yandex, Seznam, Naver (IndexNow) about new or changed pages. Run after a deploy.
// usage: node tools/indexnow.mjs [url ...]   (no args = every URL in games/sitemap.xml)
import { readFile } from 'node:fs/promises';
import { SITE, INDEXNOW_KEY } from './site.mjs';

let urls = process.argv.slice(2);
if (!urls.length) urls = [...(await readFile('games/sitemap.xml', 'utf8')).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const host = new URL(SITE).host;
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${SITE}${INDEXNOW_KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow ${res.status} ${res.statusText} for ${urls.length} URLs`);
if (res.status >= 300) process.exit(1);
