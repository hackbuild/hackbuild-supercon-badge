// Drives the real badge through the site's own badge.js: wake into Play, LED countdown, an endless
// reel, then listens for user a and user b. Run from tools/loadtest: node hw-check.mjs
import { readFileSync } from 'node:fs';
import { Clasp } from '@clasp-to/core';

globalThis.window = globalThis;
globalThis.CLASP = { Clasp };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };

const { Relay } = await import('../../docs/lib/relay.js');
const { Badge, zlib, reelBlob } = await import('../../docs/lib/badge.js');

const key = JSON.parse(readFileSync(new URL('../../badge/secret.local.json', import.meta.url))).key;
const W = 960, H = 672, ROW = W / 8;
const say = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const t0 = Date.now();

// A bar that steps across the screen, with a frame number in blocks along the bottom.
function frame(i, n) {
  const px = new Uint8Array(ROW * H * 2);
  const x0 = Math.round((W - 160) * i / (n - 1));
  for (let y = 120; y < 552; y++) for (let x = x0; x < x0 + 160; x++) px[y * ROW + (x >> 3)] |= 0x80 >> (x & 7);
  for (let b = 0; b <= i; b++) for (let y = 600; y < 640; y++) for (let x = 40 + b * 60; x < 80 + b * 60; x++) px[y * ROW + (x >> 3)] |= 0x80 >> (x & 7);
  for (let x = 0; x < W; x++) { px[10 * ROW + (x >> 3)] |= 0x80 >> (x & 7); px[(H - 10) * ROW + (x >> 3)] |= 0x80 >> (x & 7); }
  return zlib(px);
}

const relay = new Relay('hw-check');
const badge = new Badge(relay);
const presses = [];
badge.onPress = b => { presses.push(b); say('button', b); };
let last = '';
badge.onState = () => {
  const s = badge.state, line = `app=${s.app} busy=${s.busy} play=${s.play} loop=${s.loop} frame=${s.frame} fast_ms=${s.fast_ms}`;
  if (line !== last) { last = line; say('state', line); }
};
relay.start?.();
await badge.open(key);
while (!badge.online) await new Promise(r => setTimeout(r, 200));
say('badge online');

await badge.play('join');
say('play join sent');
await badge.waitDrawn(40000);
await badge.lights(8000, [0, 0, 8]);
say('lights countdown 8 s sent');

if (process.argv[2] === 'stream') {
  // A bar crossing a 240 by 168 frame, sent every 150 ms, faster than the panel can draw.
  let draws = 0, wasBusy = false;
  const prev = badge.onState;
  badge.onState = () => { prev(); if (badge.busy && !wasBusy) draws++; wasBusy = badge.busy; };
  const t = Date.now();
  for (let i = 0; Date.now() - t < 20000; i++) {
    const px = new Uint8Array(5040), x0 = (i * 12) % 200;
    for (let y = 30; y < 140; y++) for (let x = x0; x < x0 + 40; x++) px[(y * 240 + x) >> 3] |= 0x80 >> (x & 7);
    await badge.frame(Buffer.from(px).toString('base64'));
    await new Promise(r => setTimeout(r, 150));
  }
  say(`streamed 20 s, the panel started ${draws} draws, ${(20 / Math.max(1, draws)).toFixed(2)} s each`);
  await new Promise(r => setTimeout(r, 7000));
  await badge.play('join');
  setTimeout(() => process.exit(0), 3000);
} else if (process.argv[2] === 'live') {
  for (let i = 0; i < 6; i++) {
    const z = await frame(i, 6), t = Date.now();
    await badge.sendScreen(z, { to: 'play', then: 'live' });
    const sent = Date.now() - t;
    await badge.waitDrawn(20000);
    say(`live screen ${i}: sent ${sent} ms, on the panel after ${Date.now() - t} ms`);
  }
  await new Promise(r => setTimeout(r, 9000));
  say('waited for the clean pass');
  await badge.play('join');
  setTimeout(() => process.exit(0), 3000);
} else {
const frames = await Promise.all(Array.from({ length: 6 }, (_, i) => frame(i, 6)));
const ts = Date.now();
await badge.sendReel(reelBlob(frames), { loops: 0 });
say(`reel of 6 sent in ${Date.now() - ts} ms, endless`);
await new Promise(r => setTimeout(r, 30000));

say('press user a, then user b, in the next 20 s');
await new Promise(r => setTimeout(r, 20000));
await badge.play('join');
say(`back to join. presses seen: ${presses.join(',') || 'none'}`);
setTimeout(() => process.exit(0), 3000);
}
