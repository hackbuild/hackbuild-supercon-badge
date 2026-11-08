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
  const r = { now: 1_000_000, scores: {}, names: {}, wins: [], media: {}, cleared: [], state: null, seq: 0 };
  players.forEach((p, i) => { r.names[p] = `p${i}`; });
  r.ctx = () => ({
    now: r.now, epoch: 'EPOCH1', state: r.state, cfg: { ...DEFAULTS[id], ...cfg }, active: players, name: p => r.names[p] || 'someone',
    award: (p, n) => { r.scores[p] = (r.scores[p] || 0) + n; }, win: (p, why) => r.wins.push([p, why]), you: () => {}, stream: () => {},
    media: (k, v) => { r.media[k] = v; }, clearUpload: p => r.cleared.push(p),
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
