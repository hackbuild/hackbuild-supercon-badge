// Plays the game rules through the situations a room of 100 people creates, without a browser.
// node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Rules modules fetch their data relative to themselves; Node's fetch cannot read files.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.protocol !== 'file:') return realFetch(url, opts);
  const text = await readFile(u, 'utf8');
  return { ok: true, json: async () => JSON.parse(text), text: async () => text };
};

const load = async id => (await import(`../../docs/games/${id}/rules.js`)).default;
const DEFAULTS = Object.fromEntries((await import('../../docs/games/registry.js')).GAMES.map(g => [g.id, Object.fromEntries(g.settings.map(s => [s.key, s.def]))]));

// A small stand-in for the host engine's context.
function room(id, rules, players, cfg = {}) {
  const r = { now: 1_000_000, scores: {}, names: {}, wins: [], media: {}, cleared: [], jobs: [], state: null, seq: 0 };
  players.forEach((p, i) => { r.names[p] = `p${i}`; });
  r.ctx = () => ({
    now: r.now, epoch: 'EPOCH1', state: r.state, cfg: { ...DEFAULTS[id], ...cfg }, active: players, name: p => r.names[p] || 'someone',
    award: (p, n) => { r.scores[p] = (r.scores[p] || 0) + n; }, win: (p, why) => r.wins.push([p, why]), you: () => {}, stream: () => {},
    media: (k, v) => { r.media[k] = v; }, clearUpload: p => r.cleared.push(p), job: fn => r.jobs.push(fn),
  });
  r.state = rules.init(r.ctx());
  r.input = (pid, t, msg) => rules.input[t](r.ctx(), pid, msg);
  r.tick = () => rules.tick(r.ctx());
  r.view = () => rules.view(r.ctx());
  r.you = pid => rules.you(r.ctx(), pid);
  r.wait = ms => { r.now += ms; return r.tick(); };
  return r;
}
const ids = n => Array.from({ length: n }, (_, i) => `PLAYER${String(i).padStart(4, '0')}`);

test('hill: one player alone still gets their answer on the badge', async () => {
  const hill = await load('hill');
  const [a] = ids(1);
  const r = room('hill', hill, [a]);
  r.input(a, 'answer', { r: 1, a: 'my only answer' });
  r.wait(100);
  r.wait(3100);
  assert.equal(r.state.phase, 'vote');
  assert.deepEqual(r.you(a).pair, []);
  r.wait(100);
  r.wait(3100);
  assert.equal(r.state.phase, 'show');
  assert.equal(r.view().winner.text, 'my only answer');
  r.wait(DEFAULTS.hill.showS * 1000 + 10);
  assert.equal(r.state.phase, 'answer');
  assert.equal(r.state.round, 2);
});

test('hill: two players judge each other with a yes or skip', async () => {
  const hill = await load('hill');
  const [a, b] = ids(2);
  const r = room('hill', hill, [a, b]);
  r.input(a, 'answer', { r: 1, a: 'answer from a' });
  r.input(b, 'answer', { r: 1, a: 'answer from b' });
  r.wait(100); r.wait(3100);
  const ya = r.you(a), yb = r.you(b);
  assert.equal(ya.pair.length, 1);
  assert.equal(ya.pair[0].text, 'answer from b');
  r.input(a, 'vote', { r: 1, k: 0, pick: ya.pair[0].i });
  r.input(b, 'vote', { r: 1, k: 0, pick: -1 });
  r.wait(100); r.wait(3100);
  assert.equal(r.view().winner.text, 'answer from b');
});

test('hill: 120 players, five pairs each, the most liked answer wins', async () => {
  const hill = await load('hill');
  const people = ids(120);
  const r = room('hill', hill, people);
  people.forEach((p, i) => r.input(p, 'answer', { r: 1, a: i === 7 ? 'the funny one' : `plain answer ${i}` }));
  r.wait(100); r.wait(3100);
  assert.equal(r.state.phase, 'vote');
  let judged = 0;
  for (const p of people) {
    for (let k = 0; k < 5; k++) {
      const y = r.you(p);
      if (!y.pair.length) break;
      const funny = y.pair.find(e => e.text === 'the funny one');
      const pick = funny ? funny.i : y.pair[Math.floor(Math.random() * y.pair.length)].i;
      r.input(p, 'vote', { r: 1, k: y.k, pick });
      judged++;
    }
  }
  assert.equal(judged, 600);
  r.wait(100); r.wait(3100);
  assert.equal(r.state.phase, 'show');
  assert.equal(r.view().winner.text, 'the funny one');
  const funny = r.state.subs[7];
  assert.ok(funny.n >= 3, `the funny one was judged ${funny.n} times`);
});

test('hill: nobody answers, the prompt waits, then moves on', async () => {
  const hill = await load('hill');
  const r = room('hill', hill, ids(3));
  const first = r.view().q;
  r.wait(DEFAULTS.hill.answerS * 1000 + 1);
  assert.equal(r.state.phase, 'answer');
  r.wait(DEFAULTS.hill.answerS * 1000 + 1);
  assert.notEqual(r.view().q, first);
});

test('hill: filtered words and stale rounds are refused', async () => {
  const hill = await load('hill');
  const [a] = ids(1);
  const r = room('hill', hill, [a]);
  assert.match(r.input(a, 'answer', { r: 1, a: 'f u c k this' }).note, /filter/);
  assert.match(r.input(a, 'answer', { r: 9, a: 'late' }).note, /closed/);
});

test('parts: spelling slack, scoring order, choices, and one credit', async () => {
  const parts = await load('parts');
  const { matches } = await import('../../docs/games/parts/rules.js');
  assert.ok(matches({ answer: 'SOT-23', accept: [] }, 'sot23'));
  assert.ok(!matches({ answer: 'DIP-8', accept: [] }, 'dip 18'));
  assert.ok(!matches({ answer: 'DIP-14', accept: [] }, 'dip16'), 'a different number is never a typo');
  assert.ok(matches({ answer: 'ESP32-WROOM-32', accept: [] }, 'esp32 wrom 32'));
  const [a, b, c] = ids(3);
  const r = room('parts', parts, [a, b, c]);
  const answer = parts.deck(r.ctx()).find(p => p.id === r.state.partId).answer;
  assert.ok(r.input(a, 'guess', { r: 1, text: 'nope' }).note);
  r.input(a, 'guess', { r: 1, text: answer });
  r.input(b, 'guess', { r: 1, text: answer.toLowerCase() });
  assert.equal(r.scores[a], 100);
  assert.equal(r.scores[b], 85);
  assert.equal(r.wins.length, 1);
  assert.equal(r.wins[0][0], a);
  assert.equal(r.input(c, 'choose', { r: 1, c: 0 }), null, 'choices wait for the hint time');
  r.now += DEFAULTS.parts.hintS * 1000;
  const v = r.view();
  assert.equal(v.choices.length, 4);
  r.input(c, 'choose', { r: 1, c: v.choices.indexOf(answer) });
  assert.equal(r.scores[c], 25);
  r.wait(100);
  assert.equal(r.state.until - r.now <= 2600, true, 'everyone done ends the round early');
  r.wait(3000);
  assert.equal(r.state.phase, 'reveal');
  assert.ok(r.view().pins);
});

test('parts: every baked part has pads and a sane answer', async () => {
  const data = JSON.parse(await readFile(new URL('../../docs/parts/parts.json', import.meta.url), 'utf8'));
  assert.ok(data.parts.length >= 30);
  for (const p of data.parts) {
    assert.ok(p.pads.length > 0, p.id);
    assert.ok(p.answer && Array.isArray(p.accept), p.id);
  }
});

test('snake: majority moves, lopsided votes end the turn early, reverse is ignored', async () => {
  const snake = await load('snake');
  const people = ids(5);
  const r = room('snake', snake, people);
  people.forEach(p => r.input(p, 'dir', { turn: 0, d: 'D' }));
  r.wait(10);
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.dir, 'D');
  people.forEach(p => r.input(p, 'dir', { turn: 1, d: 'U' }));
  r.wait(10);
  assert.equal(r.state.dir, 'D', 'a reverse is refused');
});

test('snipe: code goes live when the badge has drawn it, or after 25 s', async () => {
  const snipe = await load('snipe');
  const [a, b] = ids(2);
  const r = room('snipe', snipe, [a, b]);
  const code = r.state.code;
  assert.match(r.input(a, 'claim', { c: code }).note, /no code/);
  snipe.badge.shown(r.ctx(), `EPOCH1.${r.state.round}`);
  assert.ok(r.state.live);
  r.input(a, 'claim', { c: code });
  r.input(b, 'claim', { c: code });
  assert.deepEqual([r.scores[a], r.scores[b]], [100, 85]);
  r.wait(DEFAULTS.snipe.holdS * 1000 + 1);
  assert.notEqual(r.state.code, code);
  r.wait(25_001);
  assert.ok(r.state.live, 'falls back to live without the badge');
});

test('cinema: claims fill reels, a full reel premieres, idle half reels premiere too', async () => {
  const cinema = await load('cinema');
  const people = ids(30);
  const r = room('cinema', cinema, people);
  people.forEach(p => r.input(p, 'claim', {}));
  assert.equal(r.state.open.length, 3);
  for (const p of people.slice(0, 12)) {
    const y = r.you(p).claim;
    r.input(p, 'frame', { reel: y.reel, slot: y.slot, bits: 'AAAA' });
  }
  r.wait(10);
  assert.ok(r.state.premiere, 'a full reel premiered');
  assert.equal(r.state.premiere.frames.length, 12);
  for (const p of people.slice(12, 18)) { const y = r.you(p).claim; r.input(p, 'frame', { reel: y.reel, slot: y.slot, bits: 'AAAA' }); }
  r.wait(DEFAULTS.cinema.claimS * 1000 + 31_000 + 120_001);
  assert.ok(r.state.queue.length + (r.state.premiere && r.state.premiere.id !== 1 ? 1 : 0) >= 1, 'a half reel went to premiere');
});

test('booth: uploads wait for approval, votes pick the reign, and photos are deleted after', async () => {
  const booth = await load('booth');
  const [a, b, c] = ids(3);
  const r = room('booth', booth, [a, b, c]);
  booth.upload(r.ctx(), a, JSON.stringify({ img: 'AAAA', consent: true }));
  booth.upload(r.ctx(), b, JSON.stringify({ img: 'BBBB', consent: true }));
  assert.equal(booth.upload(r.ctx(), c, JSON.stringify({ img: 'CCCC' })), null, 'no consent, no upload');
  assert.equal(Object.keys(r.media).length, 0, 'nothing public before approval');
  for (const p of booth.pending(r.ctx())) booth.decide(r.ctx(), p.id, true);
  assert.equal(Object.keys(r.media).length, 2);
  const y = r.you(c);
  assert.equal(y.pair.length, 2);
  const bId = r.state.photos.find(p => p.pid === b).id;
  r.input(c, 'pick', { k: 0, pick: bId });
  r.wait(10);
  assert.equal(r.state.reign.pid, b);
  r.wait(DEFAULTS.booth.reignS * 1000 + 1);
  assert.equal(r.media[`booth.${bId}`], '', 'deleted after its reign');
  assert.ok(r.cleared.includes(b));
});

test('gifs: phones ask from the presets with a cooldown, the queue plays in order, and a GIF loops', async () => {
  const gifs = await load('gifs');
  const [a, b] = ids(2);
  const r = room('gifs', gifs, [a, b]);
  assert.equal(r.input(a, 'request', { id: 'not-a-preset' }), null);
  assert.ok(r.input(a, 'request', { id: 'you-dont-say' }).changed);
  assert.match(r.input(a, 'request', { id: 'hackerman' }).note, /30 s/);
  assert.match(r.input(b, 'request', { id: 'you-dont-say' }).note, /already/);
  r.tick();
  assert.equal(r.jobs.length, 1, 'the first request starts decoding');
  assert.equal(r.state.loading, 'you don\'t say');
  // Stand in for the decoder finishing.
  r.state.loading = '';
  r.state.now = { id: 1, title: 'you don\'t say', url: 'x', by: 'p0', frames: ['AA', 'BB'], w: 240, h: 168, at: r.now };
  const reel = gifs.badge.reel(r.ctx());
  assert.equal(reel.loops, 0, 'a gif loops until the next one');
  assert.equal(gifs.badge.key(r.ctx()), reel.key, 'no still interrupts the loop');
  const off = room('gifs', gifs, [a], { requests: false });
  assert.match(off.input(a, 'request', { id: 'cage' }).note, /off/);
});

test('registry: the input table answers only to the handlers a game defines', async () => {
  const { rulesFor } = await import('../../docs/games/registry.js');
  const rules = await rulesFor('snake');
  assert.equal(typeof rules.input.dir, 'function');
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(rules.input[key], undefined, key);
});

test('snake: prototype keys are not directions, and three taps do not steer a crowd', async () => {
  const snake = await load('snake');
  const people = ids(20);
  const r = room('snake', snake, people);
  for (const d of ['constructor', '__proto__', 'toString', 'hasOwnProperty', ['U'], '', 'UD']) assert.equal(r.input(people[0], 'dir', { turn: 0, d }), null);
  assert.deepEqual(r.state.tally, { U: 0, D: 0, L: 0, R: 0 });
  assert.deepEqual(r.state.voted, {});
  people.slice(0, 3).forEach(p => r.input(p, 'dir', { turn: 0, d: 'D' }));
  r.wait(10);
  assert.equal(r.state.turn, 0, 'three of twenty do not end the turn');
  people.slice(3, 10).forEach(p => r.input(p, 'dir', { turn: 0, d: 'D' }));
  r.wait(10);
  assert.equal(r.state.turn, 1, 'half the room ends it');
});

test('hill: skipping a prompt opens a new round, so votes from the old phase are refused', async () => {
  const hill = await load('hill');
  const [a, b] = ids(2);
  const r = room('hill', hill, [a, b]);
  r.input(a, 'answer', { r: 1, a: 'answer from a' });
  r.input(b, 'answer', { r: 1, a: 'answer from b' });
  r.wait(100); r.wait(3100);
  assert.equal(r.state.phase, 'vote');
  hill.controls()[1].run(r.ctx());
  assert.equal(r.state.phase, 'answer');
  assert.equal(r.state.round, 2);
  assert.match(r.input(a, 'answer', { r: 1, a: 'late from a' }).note, /closed/);
});

test('booth: a voter who arrived before the photos gets a pair, and one picture is one entry', async () => {
  const booth = await load('booth');
  const [a, b, c, d] = ids(4);
  const r = room('booth', booth, [a, b, c, d]);
  const up = (p, img) => booth.upload(r.ctx(), p, JSON.stringify({ img, consent: true }));
  const approveAll = () => { for (const p of booth.pending(r.ctx())) booth.decide(r.ctx(), p.id, true); };
  up(a, 'AAAA');
  approveAll();
  r.wait(10);
  assert.ok(r.state.reign, 'the first approved photo takes the badge');
  assert.deepEqual(r.you(d).pair, []);
  up(b, 'BBBB');
  up(c, 'CCCC');
  approveAll();
  assert.equal(r.you(d).pair.length, 2, 'the empty pair is drawn again once photos arrive');
  assert.equal(up(b, 'BBBB'), null, 'an upload the relay hands over again is not a second photo');
  assert.equal(r.state.photos.filter(p => p.pid === b && p.img).length, 1);
  const first = r.state.photos.find(p => p.pid === b);
  up(b, 'DDDD');
  assert.equal(first.status, 'replaced', 'a new photo replaces an approved one');
  assert.equal(r.media[`booth.${first.id}`], '');
  assert.equal(r.state.photos.filter(p => p.pid === b && p.status === 'pending').length, 1);
  assert.equal(up(b, 7), null);
  assert.equal(up(b, ''), null);
  assert.equal(booth.upload(r.ctx(), b, 'null'), null);
});

test('cinema: junk frames score nothing, replays get fresh keys, and the premiere queue is capped', async () => {
  const cinema = await load('cinema');
  const [a] = ids(1);
  const r = room('cinema', cinema, [a]);
  r.input(a, 'claim', {});
  const held = r.you(a).claim;
  for (const bits of ['', '***', 'AAAA'.repeat(100), 7, null]) r.input(a, 'frame', { reel: held.reel, slot: held.slot, bits });
  assert.equal(r.scores[a] || 0, 0);
  assert.ok(r.you(a).claim, 'the claim is still held');
  for (let i = 0; i < 12 * 12; i++) {
    r.input(a, 'claim', {});
    const c = r.you(a).claim;
    r.input(a, 'frame', { reel: c.reel, slot: c.slot, bits: 'AAAA' });
  }
  assert.equal(r.state.queue.length, 8);
  assert.equal(r.state.queue.at(-1).id, 12, 'the newest reels are kept');
  r.wait(1);
  const replay = () => { cinema.controls()[1].run(r.ctx()); r.wait(1); return r.state.premiere.id; };
  const [x, y] = [replay(), replay()];
  assert.notEqual(x, y);
  assert.ok(x > 12 && y > 12, 'a replay never reuses the key of a reel that has not played');
});

test('gifs: a decode that never returns, or lands late, cannot hold the queue or the screen', async () => {
  const gifs = await load('gifs');
  const [a] = ids(1);
  const r = room('gifs', gifs, [a]);
  gifs.playNow(r.ctx(), { title: 'slow', url: 'x' });
  assert.equal(r.state.loading, 'slow');
  gifs.enqueue(r.ctx(), { title: 'next', url: 'y' });
  assert.equal(r.wait(1000), false, 'still loading');
  assert.equal(r.state.queue.length, 1);
  assert.equal(r.wait(61_000), true, 'gives up on the decode');
  assert.equal(r.state.loading, '');
  r.wait(250);
  assert.equal(r.state.loading, 'next');
  await r.jobs[0](r.ctx()).catch(() => {});
  assert.equal(r.state.loading, 'next', 'the old decode does not clear the new one');
  assert.equal(r.state.now, null, 'and cannot put its picture up');
});

test('gifs: a short gif keeps every frame, and a held frame is not lost to sampling', async () => {
  const { pickFrames } = await import('../../docs/games/gifs/pick.js');
  assert.deepEqual([...pickFrames([100, 100, 100, 100, 3000], 10)], [0, 1, 2, 3, 4]);
  const uniform = [...pickFrames(Array(30).fill(100), 10)];
  assert.equal(uniform.length, 10);
  assert.equal(uniform[0], 0);
  const held = [...pickFrames([...Array(19).fill(50), 3000], 10)];
  assert.ok(held.includes(19), 'the long final frame is kept');
  assert.ok(held.length > 3 && held.length <= 10);
  assert.ok(held.every((f, i) => f >= 0 && f < 20 && (i === 0 || f > held[i - 1])));
});

test('parts: a removed part is skipped, and parts sharing a footprint share their answers', async () => {
  const parts = await load('parts');
  const [a, b] = ids(2);
  const r = room('parts', parts, [a, b]);
  const extra = id => ({ id, answer: id.toUpperCase(), accept: [], chip: '', fact: '', pads: [['1', 0, 0, 1, 1, 'r', 0]], lines: [], pins: {} });
  const skip = () => parts.controls()[1].run(r.ctx());
  parts.addPart(r.ctx(), extra('extra-1'));
  r.state.order = ['extra-1', 'dip8'];
  r.state.at = 0;
  skip();
  assert.equal(r.state.partId, 'extra-1');
  const round = r.state.round;
  parts.removePart(r.ctx(), 'extra-1');
  assert.notEqual(r.state.partId, 'extra-1', 'the part on the badge moves on when it is removed');
  assert.equal(r.state.round, round + 1);
  parts.addPart(r.ctx(), extra('extra-2'));
  r.state.order = ['extra-2', 'dip14'];
  r.state.at = 0;
  parts.removePart(r.ctx(), 'extra-2');
  skip();
  assert.equal(r.state.partId, 'dip14', 'a removed part ahead in the order is passed over');

  r.state.order = ['cdp1802'];
  r.state.at = 0;
  skip();
  assert.equal(r.state.partId, 'cdp1802');
  r.now += DEFAULTS.parts.hintS * 1000;
  assert.ok(!r.view().choices.includes('DIP-40'), 'the footprint twin is never offered as a wrong choice');
  assert.ok(r.input(a, 'guess', { r: r.state.round, text: 'DIP-40' }).changed);
  r.state.order = ['dip40'];
  r.state.at = 0;
  skip();
  assert.ok(r.input(b, 'guess', { r: r.state.round, text: 'cosmac' }).changed);
});

test('snake: with nobody here the snake waits instead of playing itself to death', async () => {
  const snake = await load('snake');
  const r = room('snake', snake, []);
  for (let i = 0; i < 40; i++) assert.equal(r.wait(DEFAULTS.snake.turnS * 1000 + 1), false);
  assert.equal(r.state.turn, 0);
  assert.equal(r.state.over, false);
});

test('snipe: a phone that keeps guessing is cut off for the round, and gets a fresh start in the next', async () => {
  const snipe = await load('snipe');
  const [a, b] = ids(2);
  const r = room('snipe', snipe, [a, b]);
  snipe.badge.shown(r.ctx(), `EPOCH1.${r.state.round}`);
  const code = r.state.code;
  for (let i = 0; i < 5; i++) assert.match(r.input(a, 'claim', { c: 'ZZZZ' }).note, /not the code/);
  assert.match(r.input(a, 'claim', { c: code }).note, /too many/);
  assert.equal(r.scores[a], undefined);
  assert.ok(r.input(b, 'claim', { c: code }).changed, 'other phones are not affected');
  r.wait(DEFAULTS.snipe.holdS * 1000 + 1);
  snipe.badge.shown(r.ctx(), `EPOCH1.${r.state.round}`);
  assert.ok(r.input(a, 'claim', { c: r.state.code }).changed);
});

test('gifs: stop drops a decode still in flight, so the gif does not come back after it', async () => {
  const gifs = await load('gifs');
  const r = room('gifs', gifs, ids(1));
  gifs.playNow(r.ctx(), { title: 'slow', url: 'x' });
  const id = r.state.loadId;
  gifs.controls()[1].run(r.ctx());
  assert.equal(r.state.loading, '');
  assert.notEqual(r.state.loadId, id, 'the decode in flight no longer owns the screen');
});

test('arcade: each controller is held while anyone dealt to it holds it', async () => {
  const { held, seatOf } = await import('../../docs/games/arcade/rules.js');
  const s = { order: ['a', 'b', 'c'], masks: { a: 1, b: 2, c: 4 } };
  assert.deepEqual(held(s, 1, ['a', 'b', 'c']), [7]);
  assert.deepEqual(held(s, 2, ['a', 'b', 'c']), [5, 2]);
  assert.equal(seatOf(s, 'c', 2), 0);
  assert.deepEqual(held(s, 2, ['b']), [0, 2]);
});

test('gifs: a link joins the library once, phones can ask for it, and it can be removed', async () => {
  const rules = (await import('../../docs/games/gifs/rules.js')).default;
  const ctx = { now: 100_000, cfg: { requests: true }, state: null, name: () => 'x', award() {} };
  ctx.state = rules.init(ctx);
  const item = { title: 'dance', url: 'https://example.com/dance.gif' };
  assert.equal(rules.addToLibrary(ctx, item), true);
  assert.equal(rules.addToLibrary(ctx, item), false);
  const id = ctx.state.library[0].id;
  assert.ok(rules.view(ctx).presets.some(p => p.id === id));
  assert.deepEqual(rules.input.request(ctx, 'p1', { id }), { changed: true });
  assert.equal(ctx.state.queue[0].url, item.url);
  rules.removeFromLibrary(ctx, id);
  assert.equal(ctx.state.library.length, 0);
  ctx.state.library = [];
  assert.equal(rules.init(ctx).library.length, 0);
});
