// The hill: a prompt goes to every phone, everyone answers, everyone judges pairs of answers, and
// the best goes up on the badge. Then the next prompt starts by itself. The host does nothing.
//
// Play throughs it is built for:
//   alone        you answer, nobody votes, your answer goes up. The loop never sticks.
//   two people   each judges the other's answer as a yes or skip; a yes wins.
//   a room       each voter judges up to five pairs; with a hundred answers each is judged
//                about ten times, and the best share of wins takes the badge.
// A phase ends three seconds after everyone here has answered or used their votes.

import { clean, blocked } from '../../lib/words.js';
import { shuffle } from '../../lib/protocol.js';
import { pairFor, judge, best, score } from '../shared/pairs.js';
import { PROMPTS } from './prompts.js';

const VOTES_EACH = 5;
const EARLY_MS = 3000;

function prompt(s) { return PROMPTS[s.order[s.at % s.order.length]]; }

function begin(ctx, s) {
  s.phase = 'answer';
  s.subs = [];
  s.votes = {};
  s.results = null;
  s.empties = 0;
  s.until = ctx.now + ctx.cfg.answerS * 1000;
}

function tally(ctx, s) {
  const top = best(s.subs);
  if (!top) return;
  const e = top.e;
  s.winner = { text: e.text, name: ctx.name(e.pid), pid: e.pid, q: prompt(s), round: s.round };
  s.hidden = false;
  ctx.award(e.pid, 100);
  if (ctx.cfg.credits) ctx.win(e.pid, 'won a round of the hill');
  s.results = [...s.subs].sort((a, b) => score(b) - score(a)).slice(0, 5)
    .map(x => ({ text: x.text, name: ctx.name(x.pid), w: x.w, n: x.n }));
}

function allDone(ctx, s) {
  const here = ctx.active;
  if (!here.length) return false;
  if (s.phase === 'answer') return s.subs.length > 0 && here.every(pid => s.subs.some(x => x.pid === pid));
  if (s.phase === 'vote') return here.every(pid => { const v = voter(s, pid); return v.k >= VOTES_EACH || !v.pair.length; });
  return false;
}

function voter(s, pid) {
  if (!s.votes[pid]) s.votes[pid] = { k: 0, pair: pairFor(s.subs, pid, s.round, 0) };
  return s.votes[pid];
}

export default {
  init(ctx) {
    const old = ctx.state || {};
    const s = { order: shuffle(PROMPTS.map((_, i) => i), ctx.epoch), at: 0, round: 1, winner: old.winner || null, hidden: false };
    begin(ctx, s);
    return s;
  },

  input: {
    answer(ctx, pid, msg) {
      const s = ctx.state;
      if (s.phase !== 'answer' || msg.r !== s.round) return { note: 'answers for that prompt have closed.' };
      const text = clean(msg.a, 60).toLowerCase();
      if (text.length < 2) return { note: 'write a few words first.' };
      if (blocked(text)) return { note: 'that answer did not pass the word filter.' };
      const mine = s.subs.find(x => x.pid === pid);
      if (mine) mine.text = text;
      else if (s.subs.length < 500) { s.subs.push({ pid, text, w: 0, n: 0 }); ctx.award(pid, 10); }
      else return { note: 'this round is full. vote in the next phase.' };
      return { changed: true };
    },
    vote(ctx, pid, msg) {
      const s = ctx.state;
      if (s.phase !== 'vote' || msg.r !== s.round) return null;
      const v = voter(s, pid);
      if (msg.k !== v.k || !v.pair.length) return null;
      const won = judge(s.subs, v.pair, msg.pick);
      if (won) ctx.award(won.pid, 10);
      ctx.award(pid, 2);
      v.k++;
      v.pair = v.k < VOTES_EACH ? pairFor(s.subs, pid, s.round, v.k) : [];
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state, now = ctx.now;
    if (now < s.until) {
      if (s.until - now > EARLY_MS && allDone(ctx, s)) { s.until = now + EARLY_MS; return true; }
      return false;
    }
    if (s.phase === 'answer') {
      if (!s.subs.length) {
        // Nobody answered: wait a little longer, and after two empty waits try another prompt.
        s.empties++;
        if (s.empties >= 2) { s.at++; s.empties = 0; }
        s.until = now + ctx.cfg.answerS * 1000;
        return true;
      }
      s.phase = 'vote';
      s.votes = {};
      s.until = now + ctx.cfg.voteS * 1000;
    } else if (s.phase === 'vote') {
      tally(ctx, s);
      s.phase = 'show';
      s.until = now + ctx.cfg.showS * 1000;
    } else {
      s.round++;
      s.at++;
      begin(ctx, s);
    }
    return true;
  },

  view(ctx) {
    const s = ctx.state;
    const judged = Object.values(s.votes).reduce((n, v) => n + v.k, 0);
    return { phase: s.phase, round: s.round, left: Math.max(0, s.until - ctx.now), q: prompt(s), answers: s.subs.length, judged,
      winner: s.hidden ? null : s.winner, results: s.phase === 'show' ? s.results : null };
  },

  you(ctx, pid) {
    const s = ctx.state, mine = s.subs.find(x => x.pid === pid);
    if (s.phase === 'answer') return { r: s.round, sent: mine ? mine.text : '' };
    if (s.phase === 'vote') {
      const v = voter(s, pid);
      return { r: s.round, k: v.k, left: VOTES_EACH - v.k, pair: v.pair.map(i => ({ i, text: s.subs[i].text })), mine: mine ? mine.text : '' };
    }
    if (!mine) return { r: s.round };
    const place = [...s.subs].sort((a, b) => score(b) - score(a)).indexOf(mine) + 1;
    return { r: s.round, mine: { text: mine.text, w: mine.w, n: mine.n, place, of: s.subs.length } };
  },

  youKey(ctx, pid) {
    const s = ctx.state, v = s.votes[pid], mine = s.subs.find(x => x.pid === pid);
    return `${s.round}.${s.phase}.${v ? v.k : 0}.${mine ? mine.text : ''}`;
  },

  badge: {
    mode: 'still',
    countdown: ctx => { const s = ctx.state; return s.phase === 'show' ? { key: `${s.round}.show`, ms: 0 } : { key: `${s.round}.${s.phase}.${s.until}`, ms: s.until - ctx.now }; },
    key: ctx => { const s = ctx.state; return `${s.round}.${s.phase}.${s.hidden}.${s.at}`; },
    model(ctx) {
      const s = ctx.state;
      return { phase: s.phase, round: s.round, q: prompt(s), answers: s.subs.length, winner: s.hidden ? null : s.winner };
    },
  },

  controls: () => [
    { label: 'end this phase now', run: ctx => { ctx.state.until = 0; } },
    { label: 'skip this prompt', run: ctx => { const s = ctx.state; s.at++; begin(ctx, s); } },
    { label: 'take the winner off the badge', run: ctx => { ctx.state.hidden = true; } },
  ],

  headline(ctx) { const s = ctx.state; return { big: `round ${s.round}, ${s.phase === 'show' ? 'the winner' : s.phase}, ${Math.max(0, Math.ceil((s.until - ctx.now) / 1000))}s`, small: s.phase === 'show' && s.winner ? `${s.winner.text}, by ${s.winner.name}` : prompt(s) }; },

  stats(ctx) {
    const s = ctx.state, left = Math.max(0, Math.ceil((s.until - ctx.now) / 1000));
    return [['round', s.round], ['phase', `${s.phase}, ${left} s left`], ['prompt', prompt(s)], ['answers', s.subs.length],
      ['on the badge', s.winner && !s.hidden ? `${s.winner.text}, by ${s.winner.name}` : 'nothing yet']];
  },
};
