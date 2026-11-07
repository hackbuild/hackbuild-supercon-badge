// Simulated phones for the crowd games. Each one opens its own relay socket, as a real phone does,
// joins in batches of 10 so the public relay does not see one burst, and plays whatever game the
// host runs. It reports what each phone received and how long the host took to answer an input.
//
//   cd tools/loadtest && npm install && node loadtest.mjs ROOM [phones] [seconds]

import { Clasp } from '@clasp-to/core';

const ROOM = (process.argv[2] || '').toUpperCase();
const N = Number(process.argv[3] || 150);
const SECONDS = Number(process.argv[4] || 180);
if (!/^[A-Z0-9]{4}$/.test(ROOM)) { console.error('usage: node loadtest.mjs ROOM [phones] [seconds]'); process.exit(1); }

const P = `/hb/play/${ROOM}`;
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const id = () => Array.from({ length: 10 }, () => A[Math.floor(Math.random() * A.length)]).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUIPS = ['the solder was decorative', 'we shipped the test jig', 'my multimeter lies', 'it is always the ground', 'the smoke left first', 'blame the bootloader', 'flux is a lifestyle', 'reflow by hair dryer'];

const stats = { joined: 0, failed: 0, drops: 0, rx: 0, views: 0, inputs: 0, answered: 0, lat: [] };

async function phone(n) {
  const pid = id();
  const c = new Clasp('wss://relay.clasp.to', { name: `load ${n}`, reconnect: true });
  try { await c.connect(); } catch (e) { stats.failed++; return; }
  stats.joined++;
  c.onDisconnect?.(() => { stats.drops++; });
  let view = null, you = null, seq = 0, lastTurn = -1, answeredRound = -1, waiting = new Map();
  const send = (t, body) => {
    if (!view) return;
    seq++;
    waiting.set(seq, Date.now());
    stats.inputs++;
    c.set(`${P}/in/${pid}`, JSON.stringify({ e: view.epoch, s: seq, t, ...body }));
  };
  c.on(`${P}/view`, v => { stats.rx++; stats.views++; try { view = JSON.parse(v); } catch (e) {} });
  c.on(`${P}/board`, () => { stats.rx++; });
  c.on(`${P}/hb`, () => { stats.rx++; });
  c.on(`${P}/you/${pid}`, v => {
    stats.rx++;
    try { you = JSON.parse(v); } catch (e) { return; }
    // The host answers each input it accepts, so the oldest unanswered send dates this reply.
    const first = waiting.keys().next();
    if (!first.done) { stats.lat.push(Date.now() - waiting.get(first.value)); waiting.delete(first.value); stats.answered++; }
    waiting.clear();
  });
  c.set(`${P}/who/${pid}`, `load ${n}`);
  c.emit(`${P}/beat`, pid);
  const beat = setInterval(() => c.emit(`${P}/beat`, pid), 10_000);
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    await sleep(500 + Math.random() * 1500);
    if (!view || !view.kind) continue;
    if (view.kind === 'snake' && view.turn !== lastTurn && !view.over) {
      lastTurn = view.turn;
      const opp = { U: 'D', D: 'U', L: 'R', R: 'L' }[view.dir];
      const opts = ['U', 'D', 'L', 'R'].filter(d => d !== opp);
      send('dir', { turn: view.turn, d: opts[Math.floor(Math.random() * opts.length)] });
    } else if (view.kind === 'pixel' && Math.random() < 0.15) {
      const p = Array.from({ length: 3 + Math.floor(Math.random() * 5) }, () => [Math.floor(Math.random() * 36), Math.floor(Math.random() * 24), 1 + Math.floor(Math.random() * 2)]);
      send('paint', { p });
    } else if (view.kind === 'hill') {
      if (view.phase === 'answer' && answeredRound !== view.round) {
        answeredRound = view.round;
        send('answer', { a: `${QUIPS[Math.floor(Math.random() * QUIPS.length)]} ${n}` });
      } else if (view.phase === 'vote' && you && you.hill && you.hill.r === view.round && you.hill.i >= 0) {
        const i = you.hill.i;
        you.hill.i = -1;
        send('vote', { r: view.round, i, w: Math.random() < 0.5 ? 'c' : 'h' });
      }
    }
  }
  clearInterval(beat);
  c.close();
}

const t0 = Date.now();
const runs = [];
for (let i = 0; i < N; i += 10) {
  for (let k = i; k < Math.min(N, i + 10); k++) runs.push(phone(k));
  await sleep(3000);
  process.stdout.write(`joined ${stats.joined}, failed ${stats.failed}\n`);
}
const report = setInterval(() => {
  const s = (Date.now() - t0) / 1000;
  const lat = [...stats.lat].sort((a, b) => a - b);
  const pct = q => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : 0);
  console.log(`${Math.round(s)} s: phones ${stats.joined}, drops ${stats.drops}, per phone ${(stats.rx / Math.max(1, stats.joined) / s).toFixed(2)} msg/s, inputs ${stats.inputs}, answered ${stats.answered}, host reply p50 ${pct(0.5)} ms p95 ${pct(0.95)} ms`);
}, 15_000);
await Promise.all(runs);
clearInterval(report);
console.log('done');
process.exit(0);
