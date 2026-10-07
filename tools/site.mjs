// Site-wide constants shared by build-site.mjs and indexnow.mjs.
export const SITE = 'https://arcadeaday.com/';
export const NAME = 'Arcade a Day';
export const INDEXNOW_KEY = '074e724abf421094c3fb14677ffab29f';
// The daily scheduled run starts at 12:00 IST (06:30 UTC). The hub countdown
// targets this UTC hour, which leaves time for the build, QA and deploy.
export const DROP_UTC_HOUR = 9;
