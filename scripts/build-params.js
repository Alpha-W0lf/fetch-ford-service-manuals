#!/usr/bin/env node
/** Build params.json from captured network hook payload. Usage: node scripts/build-params.js <vehicle-id> '<workshop-post-body>' '<wiring-url>' */
const fs = require('fs');
const path = require('path');
const qs = require('qs');

const [,, vehicleId, workshopBody, wiringUrl] = process.argv;
if (!vehicleId || !workshopBody) {
  console.error('Usage: build-params.js <vehicle-id> <workshop-post-body> [wiring-tableofcontent-url]');
  process.exit(1);
}

const workshopParsed = qs.parse(workshopBody);
const workshop = {};
for (const k of [
  'vehicleId','modelYear','channel','book','bookTitle','WiringBookCode','WiringBookTitle',
  'booktype','country','language','contentmarket','contentlanguage','languageOdysseyCode',
  'searchNumber','Vid','byvin','marketGroup','category','CategoryDescription'
]) {
  if (workshopParsed[k] != null && workshopParsed[k] !== '') workshop[k] = String(workshopParsed[k]);
}

const wiring = { bookType: 'svg', languageCode: 'ENUSA' };
if (wiringUrl) {
  const u = new URL(wiringUrl);
  if (u.searchParams.get('environment')) wiring.environment = u.searchParams.get('environment');
  if (u.searchParams.get('bookType')) wiring.bookType = u.searchParams.get('bookType');
  if (u.searchParams.get('languageCode')) wiring.languageCode = u.searchParams.get('languageCode');
}

const params = {
  workshop: {
    ...workshop,
    byvin: workshop.byvin || 'NO',
    country: workshop.country || 'USA',
    language: workshop.language || 'EN-US',
    contentmarket: workshop.contentmarket || 'US',
    contentlanguage: workshop.contentlanguage || 'EN',
    languageOdysseyCode: workshop.languageOdysseyCode || 'ENUSA',
    searchNumber: workshop.searchNumber || '0',
    Vid: workshop.Vid || 'CZF',
    marketGroup: workshop.marketGroup || 'NA',
    channel: workshop.channel || '9',
    booktype: workshop.booktype || 'ody',
  },
  wiring,
  pre_2003: { alphabeticalIndexURL: 'https://www.fordservicecontent.com/pubs/content/.....' },
};

const root = path.join(__dirname, '..');
const out = path.join(root, 'vehicles', vehicleId, 'params.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(params, null, 2) + '\n');

const queuePath = path.join(root, 'templates/vehicles.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const v = queue.vehicles.find(x => x.id === vehicleId);
if (v) v.status = 'pending';
fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');

console.log('Wrote', out);
console.log('book', params.workshop.book, 'vehicleId', params.workshop.vehicleId, 'env', params.wiring.environment);
