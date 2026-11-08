// Name that package: the badge shows a footprint, phones type its name. The first right answer
// scores most and can win a capsule credit. After a few seconds four choices appear for anyone
// stuck, worth less. The reveal shows the pinout from the KiCad symbol and who got it first.
//
// The parts are footprints and pin names from the KiCad libraries, baked by tools/parts/build.py
// into parts/parts.json. The host can add more from KiCad's library while the game runs.

import { clean } from '../../lib/words.js';
import { shuffle, hash32 } from '../../lib/protocol.js';

const DATA = await fetch(new URL('../../parts/parts.json', import.meta.url)).then(r => r.json()).catch(() => ({ parts: [] }));
const TRIES = 3;
const EARLY_MS = 2500;

const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

// Exact on the name or any accepted spelling, with one typo forgiven on names of 5 or more
// characters and two on names of 9 or more. The numbers must match exactly: DIP-16 is not a
// typo of DIP-14, and this crowd would say so.
const digits = t => t.replace(/[^0-9]/g, '');
export function matches(part, guess) {
  const g = norm(guess);
  if (!g) return false;
  return [part.answer, ...part.accept].some(a => {
    const n = norm(a);
    if (n === g) return true;
    const slack = n.length >= 9 ? 2 : n.length >= 5 ? 1 : 0;
    return slack > 0 && digits(n) === digits(g) && lev(n, g) <= slack;
  });
}

function partsOf(s) { return [...DATA.parts, ...(s.extra || [])]; }
function part(s) { return partsOf(s).find(p => p.id === s.partId); }

// Two parts drawn from one footprint, like the Z80 and the CDP1802 in a DIP-40, share their answers:
// the picture is the same, so either name is right.
function twinsOf(s, p) {
  const shape = JSON.stringify(p.pads);
  return partsOf(s).filter(x => x.id !== p.id && JSON.stringify(x.pads) === shape);
}

function ask(ctx, s) {
  const all = partsOf(s);
  if (!all.length) return;
  // The order was shuffled earlier; a part the host has since removed is skipped.
  let p = null;
  while (!p) {
    if (s.at >= s.order.length) { s.order = shuffle(all.map(x => x.id), `${ctx.epoch}.${s.round}`); s.at = 0; }
    s.partId = s.order[s.at++];
    p = part(s);
  }
  const twins = twinsOf(s, p);
  s.twins = twins.map(x => x.id);
  // Three wrong choices with different answers, picked the same way for every phone.
  const others = shuffle(all.filter(x => !s.twins.includes(x.id) && norm(x.answer) !== norm(p.answer)).map(x => x.answer), `${s.round}.${p.id}`)
    .filter((a, i, arr) => arr.indexOf(a) === i).slice(0, 3);
  const choices = shuffle([p.answer, ...others], hash32(`${p.id}.${s.round}`));
  s.choices = choices;
  s.phase = 'ask';
  s.answers = {};
  s.firsts = [];
  s.askedAt = ctx.now;
  s.until = ctx.now + ctx.cfg.askS * 1000;
}

function geom(p) { return { pads: p.pads, lines: p.lines }; }

function done(s, a) { return a && (a.ok || a.tries >= TRIES || a.chose); }

export default {
  init(ctx) {
    const old = ctx.state || {};
    const s = { order: [], at: 0, round: 1, extra: old.extra || [] };
    ask(ctx, s);
    return s;
  },

  input: {
    guess(ctx, pid, msg) {
      const s = ctx.state, p = part(s);
      if (s.phase !== 'ask' || msg.r !== s.round || !p) return null;
      const a = s.answers[pid] || (s.answers[pid] = { ok: false, tries: 0 });
      if (done(s, a)) return null;
      a.tries++;
      const text = clean(msg.text, 40), right = [p, ...partsOf(s).filter(x => (s.twins || []).includes(x.id))];
      if (!right.some(x => matches(x, text))) return { note: a.tries >= TRIES ? 'out of guesses for this one.' : `not it. ${TRIES - a.tries} guess${TRIES - a.tries === 1 ? '' : 'es'} left.` };
      const rank = s.firsts.length;
      a.ok = true;
      a.ms = ctx.now - s.askedAt;
      a.pts = Math.max(40, 100 - 15 * rank);
      a.rank = rank + 1;
      s.firsts.push({ pid, name: ctx.name(pid), ms: a.ms });
      ctx.award(pid, a.pts);
      if (rank === 0 && ctx.cfg.credits) ctx.win(pid, `were first to name the ${p.answer}`);
      return { changed: true };
    },
    choose(ctx, pid, msg) {
      const s = ctx.state, p = part(s);
      if (s.phase !== 'ask' || msg.r !== s.round || !p) return null;
      if (ctx.now - s.askedAt < ctx.cfg.hintS * 1000) return null;
      const a = s.answers[pid] || (s.answers[pid] = { ok: false, tries: 0 });
      if (done(s, a)) return null;
      a.chose = true;
      if (s.choices[msg.c] === p.answer) {
        a.ok = true;
        a.ms = ctx.now - s.askedAt;
        a.pts = 25;
        a.via = 'choice';
        ctx.award(pid, a.pts);
      }
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state, now = ctx.now;
    if (!s.partId) { ask(ctx, s); return !!s.partId; }
    if (now < s.until) {
      const here = ctx.active;
      if (s.phase === 'ask' && here.length && s.until - now > EARLY_MS && here.every(pid => done(s, s.answers[pid]))) { s.until = now + EARLY_MS; return true; }
      return false;
    }
    if (s.phase === 'ask') { s.phase = 'reveal'; s.until = now + ctx.cfg.revealS * 1000; } else { s.round++; ask(ctx, s); }
    return true;
  },

  view(ctx) {
    const s = ctx.state, p = part(s);
    if (!p) return { phase: 'empty' };
    const hint = s.phase === 'ask' && ctx.now - s.askedAt >= ctx.cfg.hintS * 1000;
    const solved = Object.values(s.answers).filter(a => a.ok).length;
    const base = { phase: s.phase, round: s.round, left: Math.max(0, s.until - ctx.now), geom: geom(p), solved,
      hintIn: Math.max(0, ctx.cfg.hintS * 1000 - (ctx.now - s.askedAt)) };
    if (s.phase === 'ask') return { ...base, choices: hint ? s.choices : null };
    return { ...base, answer: p.answer, chip: p.chip, fact: p.fact, pins: p.pins, firsts: s.firsts.slice(0, 5).map(f => [f.name, f.ms]) };
  },

  you(ctx, pid) {
    const s = ctx.state, a = s.answers[pid];
    return { r: s.round, ok: !!(a && a.ok), tries: a ? a.tries : 0, triesMax: TRIES, chose: !!(a && a.chose), pts: a && a.pts, rank: a && a.rank, via: a && a.via };
  },

  youKey(ctx, pid) {
    const s = ctx.state, a = s.answers[pid];
    return `${s.round}.${s.phase}.${a ? `${a.tries}.${a.ok}.${a.chose}` : ''}`;
  },

  badge: {
    mode: 'still',
    countdown: ctx => { const s = ctx.state; return { key: `${s.round}.${s.phase}.${s.until}`, ms: s.phase === 'ask' ? s.until - ctx.now : 0 }; },
    key: ctx => `${ctx.state.round}.${ctx.state.phase}`,
    model(ctx) {
      const s = ctx.state, p = part(s);
      if (!p) return null;
      if (s.phase === 'ask') return { phase: 'ask', round: s.round, geom: geom(p), pads: p.pads.length };
      return { phase: 'reveal', round: s.round, geom: geom(p), pins: p.pins, answer: p.answer, chip: p.chip, fact: p.fact,
        first: s.firsts[0] ? [s.firsts[0].name, s.firsts[0].ms] : null };
    },
  },

  controls: () => [
    { label: 'reveal now', run: ctx => { if (ctx.state.phase === 'ask') ctx.state.until = 0; } },
    { label: 'skip to the next part', run: ctx => { const s = ctx.state; s.round++; ask(ctx, s); } },
  ],

  headline(ctx) { const s = ctx.state, p = part(s); return { big: `round ${s.round}, ${s.phase}, ${Math.max(0, Math.ceil((s.until - ctx.now) / 1000))}s`, small: p ? `answer: ${p.answer}. ${s.firsts.length} named it.` : '' }; },

  stats(ctx) {
    const s = ctx.state, p = part(s), left = Math.max(0, Math.ceil((s.until - ctx.now) / 1000));
    return [['round', s.round], ['part', p ? `${p.answer}${p.chip ? `, ${p.chip}` : ''}` : 'none'], ['phase', `${s.phase}, ${left} s left`],
      ['named it', s.firsts.length], ['parts in the deck', partsOf(s).length]];
  },

  // Used by the host page's part finder.
  addPart(ctx, p) { ctx.state.extra = [...(ctx.state.extra || []).filter(x => x.id !== p.id), p]; },
  // Removing the part on the badge moves on to the next one under a new round, so phones redraw.
  removePart(ctx, id) {
    const s = ctx.state;
    s.extra = (s.extra || []).filter(x => x.id !== id);
    if (s.partId === id) { s.round++; ask(ctx, s); }
  },
  deck: ctx => partsOf(ctx.state),
};
