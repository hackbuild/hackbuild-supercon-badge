// Flash snipe: every round puts a new four letter code on the badge. The first claims score most,
// sliding down from 100. A code goes live only once the badge has finished drawing it, so nobody
// sees it early; if the badge is away, it goes live after 25 s and the projector shows it.

import { code } from '../../lib/protocol.js';
import { clean } from '../../lib/words.js';

const FALLBACK_MS = 25_000;

function next(ctx, s) {
  if (s.claims.length) s.best = s.claims.slice(0, 3).map(c => ({ name: c.name, ms: c.ms }));
  s.round++;
  s.code = code(4);
  s.live = false;
  s.claims = [];
  s.waitingSince = ctx.now;
  s.until = 0;
}

function goLive(ctx, s) {
  s.live = true;
  s.liveAt = ctx.now;
  s.until = ctx.now + ctx.cfg.holdS * 1000;
}

export default {
  init(ctx) {
    const s = { round: 0, code: '', live: false, liveAt: 0, until: 0, claims: [], best: [], waitingSince: 0 };
    next(ctx, s);
    return s;
  },

  input: {
    claim(ctx, pid, msg) {
      const s = ctx.state, guess = clean(msg.c, 8).toUpperCase();
      if (!s.live) return { note: 'no code is live. wait for the badge to flash.' };
      if (guess !== s.code) return { note: 'that is not the code on the badge right now.' };
      if (s.claims.some(c => c.pid === pid)) return { note: 'you already claimed this one.' };
      const pts = Math.max(10, 100 - 15 * s.claims.length);
      s.claims.push({ pid, name: ctx.name(pid), ms: ctx.now - s.liveAt, pts });
      ctx.award(pid, pts);
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    if (!s.live && ctx.now - s.waitingSince > FALLBACK_MS) { goLive(ctx, s); return true; }
    if (s.live && ctx.now >= s.until) { next(ctx, s); return true; }
    return false;
  },

  view(ctx) {
    const s = ctx.state;
    return { round: s.round, live: s.live, left: s.live ? Math.max(0, s.until - ctx.now) : 0,
      claims: s.claims.slice(0, 5).map(c => [c.name, c.ms, c.pts]), best: s.best.map(c => [c.name, c.ms]) };
  },

  you(ctx, pid) {
    const s = ctx.state, i = s.claims.findIndex(c => c.pid === pid);
    return { r: s.round, claimed: i >= 0 ? { place: i + 1, ms: s.claims[i].ms, pts: s.claims[i].pts } : null };
  },

  youKey(ctx, pid) { const s = ctx.state; return `${s.round}.${s.live}.${s.claims.some(c => c.pid === pid)}`; },

  badge: {
    mode: 'still',
    key: ctx => `${ctx.epoch}.${ctx.state.round}`,
    model: ctx => { const s = ctx.state; return { round: s.round, code: s.code, live: s.live, best: s.best, claims: s.claims.length }; },
    shown(ctx, key) { const s = ctx.state; if (key === `${ctx.epoch}.${s.round}` && !s.live) goLive(ctx, s); },
  },

  controls: () => [
    { label: 'next code now', run: ctx => next(ctx, ctx.state) },
  ],

  stats(ctx) {
    const s = ctx.state, left = Math.max(0, Math.ceil((s.until - ctx.now) / 1000));
    return [['round', s.round], ['code', s.live ? `${s.code}, live, ${left} s left` : `${s.code}, waiting for the badge`], ['claims', s.claims.length]];
  },
};
