// A stand-in badge on the relay, for testing the host pages without hardware. It checks every
// signature and nonce the way badge/lib/hb_link.py does, acks chunks in order and drops the rest,
// inflates every frame it gets, reports busy for as long as the real panel would, and writes each
// screen it would show to out/ as a PNG.
//
//   cd tools/loadtest && node badge-emu.mjs [seconds] [--press a@20,b@40] [--drop 0.1]

import { Clasp } from '@clasp-to/core';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const SECONDS = Number(args.find((a, i) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith('--')) || 120);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const PRESS = flag('--press').split(',').filter(Boolean).map(p => p.split('@'));
const DROP = Number(flag('--drop') || 0);
const OUT = new URL('./emu-out/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const key = JSON.parse(readFileSync(new URL('../../badge/secret.local.json', import.meta.url))).key;
const base = '/hb/badge/' + createHash('sha256').update(key).digest('hex').slice(0, 16);
const W = 960, H = 672, PLANE = (W / 8) * H;
const T = { still: 4300, quick: 1250, clean: 4100 };

const state = { n: randomBytes(8).toString('hex'), app: 'logo', busy: false, fast_ms: 0, play: 'join', loop: false, frame: 0 };
const started = Date.now();
const log = (...a) => console.log(((Date.now() - started) / 1000).toFixed(1).padStart(6), ...a);
const stats = { cmds: 0, badSig: 0, stale: 0, chunks: 0, dupChunks: 0, screens: 0, reels: 0, inkBatches: 0, inkStrokes: 0, inkBadSig: 0 };

const c = new Clasp('wss://relay.clasp.to', { name: 'badge emulator' });
await c.connect();
let dirty = true, transfer = null, busyUntil = 0, reelGen = 0, inkSid = '', inkSeq = -1, inkActive = false, inkDirty = false, shot = 0;

const publish = () => { dirty = false; c.set(base + '/state', JSON.stringify({ ...state, up: Math.round((Date.now() - started) / 1000), wifi: 'emulator' })); };
const send = (suffix, text) => { if (Math.random() >= DROP) c.emit(base + suffix, text); };

function png(planes, name) {
  // One bit greyscale PNG of the black plane, red drawn as black too.
  const row = W / 8, raw = Buffer.alloc((row + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (row + 1)] = 0;
    for (let x = 0; x < row; x++) raw[y * (row + 1) + 1 + x] = ~(planes[y * row + x] | planes[PLANE + y * row + x]) & 0xff;
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let k = n; for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; return k >>> 0; });
  const crc = b => { let x = 0xffffffff; for (const v of b) x = crcT[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 1; ihdr[9] = 0;
  writeFileSync(new URL(name, OUT), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function busyFor(ms) { state.busy = true; busyUntil = Date.now() + ms; dirty = true; }

async function playReel(frames, loops, gen) {
  state.loop = loops === 0;
  for (let loop = 0; loops === 0 || loop < loops; loop++) {
    for (let i = 0; i < frames.length; i++) {
      if (gen !== reelGen) return;
      state.frame = i;
      busyFor(T.quick);
      await new Promise(r => setTimeout(r, T.quick));
    }
  }
  state.loop = false;
  busyFor(T.clean);
}

function finish(t) {
  const buf = Buffer.concat(t.parts);
  if (createHash('sha256').update(buf).digest('hex') !== t.sha) { log('FAIL checksum', t.id); return; }
  if (t.cmd === 'reel') {
    const count = buf.readUInt16LE(0), frames = [];
    for (let i = 0; i < count; i++) {
      const at = buf.readUInt32LE(2 + 4 * i), end = i + 1 < count ? buf.readUInt32LE(2 + 4 * (i + 1)) : buf.length;
      const planes = inflateSync(buf.subarray(at, end));
      if (planes.length !== PLANE * 2) { log('FAIL reel frame size', i, planes.length); return; }
      frames.push(planes);
    }
    png(frames[0], `reel-${++shot}-first.png`);
    stats.reels++;
    log(`reel: ${count} frames, ${buf.length} bytes, loops ${t.loops}`);
    state.app = 'play'; state.play = 'reel';
    reelGen++;
    playReel(frames, t.loops, reelGen);
    return;
  }
  const planes = inflateSync(buf);
  if (planes.length !== PLANE * 2) { log('FAIL screen size', planes.length); return; }
  png(planes, `screen-${++shot}.png`);
  stats.screens++;
  reelGen++;
  state.loop = false;
  state.app = t.to === 'play' ? 'play' : 'image';
  state.play = t.then === 'ink' ? 'ink' : 'frame';
  inkActive = t.then === 'ink';
  log(`screen: ${buf.length} bytes${t.then ? `, then ${t.then}` : ''}`);
  busyFor(T.still);
}

c.on(base + '/**', (value, address) => {
  const v = String(value);
  if (address === base + '/keep') { if (v === 'hello') dirty = true; return; }
  if (address === base + '/cmd') {
    const i = v.indexOf(':'), sig = v.slice(0, i), body = v.slice(i + 1);
    if (createHmac('sha256', key).update(body).digest('hex') !== sig) { stats.badSig++; log('bad signature'); return; }
    const msg = JSON.parse(body);
    if (msg.n !== state.n) { stats.stale++; log('stale nonce'); return; }
    stats.cmds++;
    state.n = randomBytes(8).toString('hex');
    dirty = true;
    const val = msg.v || {};
    if (msg.c === 'play') { reelGen++; state.app = 'play'; state.play = val.mode; inkActive = val.mode === 'ink'; log('play', val.mode); }
    else if (msg.c === 'lights') log('lights', val.ms);
    else if (msg.c === 'img' || msg.c === 'reel') {
      transfer = { cmd: msg.c, id: val.id, size: val.size, sha: val.sha, to: val.to, then: val.then, loops: val.loops ?? 2, next: 0, got: 0, parts: [] };
      send('/ack', `${val.id}:-1`);
    } else log('command', msg.c);
    return;
  }
  if (address === base + '/chunk' && transfer) {
    const [id, seq, data] = [v.slice(0, v.indexOf(':')), ...v.slice(v.indexOf(':') + 1).split(/:(.*)/s)];
    if (id !== transfer.id) return;
    if (Number(seq) !== transfer.next) { stats.dupChunks++; return; }
    const raw = Buffer.from(data, 'base64');
    transfer.parts.push(raw);
    transfer.got += raw.length;
    transfer.next++;
    stats.chunks++;
    send('/ack', `${id}:${seq}`);
    if (transfer.got >= transfer.size) { const t = transfer; transfer = null; finish(t); }
    return;
  }
  if (address === base + '/ink') {
    const parts = v.split(':'), [sid, seqText, sig] = parts, data = parts.slice(3).join(':'), seq = Number(seqText);
    if (createHmac('sha256', key).update(`${sid}:${seq}:${data}`).digest('hex').slice(0, 32) !== sig) { stats.inkBadSig++; return; }
    if (sid === inkSid && seq <= inkSeq) return;
    inkSid = sid; inkSeq = seq;
    if (!inkActive) return;
    stats.inkBatches++;
    stats.inkStrokes += data.split(';').filter(s => /^\d/.test(s)).length;
    inkDirty = true;
  }
});

c.emit(base + '/keep', 'boot');
for (const [b, at] of PRESS) setTimeout(() => { log('press', b); c.emit(base + '/press', b); }, Number(at) * 1000);
let lastState = 0;
const timer = setInterval(() => {
  const now = Date.now();
  if (state.busy && now > busyUntil && !state.loop) { state.busy = false; dirty = true; }
  if (inkActive && inkDirty && !state.busy) { inkDirty = false; busyFor(T.quick); }
  if (dirty || now - lastState > 30_000) { lastState = now; publish(); }
}, 100);
setTimeout(() => { clearInterval(timer); console.log(JSON.stringify(stats)); process.exit(0); }, SECONDS * 1000);
log('emulated badge on', base);
