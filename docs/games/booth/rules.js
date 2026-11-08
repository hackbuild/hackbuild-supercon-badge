// Dither booth: opt in selfies, dithered on the phone to one bit at 480 by 336, the halftone look
// e-paper does best. A photo is sealed to the host's key, so nobody else can see it before the
// wearer approves it. Approved portraits go into head to head votes, and the winner holds the
// badge for a few minutes. When its time is up the photo is deleted from the relay.

import { pairFor, score } from '../shared/pairs.js';

export const PW = 480, PH = 336;
const MAX_IMG = 30000;
const VOTES_EACH = 6;

function entry(s, id) { return s.photos.find(p => p.id === id); }
function pool(s) { return s.photos.filter(p => p.status === 'approved'); }

// Pairs hold photo ids, since the pool shifts as photos are approved and shown.
function pairIds(s, pid, k) { const list = pool(s); return pairFor(list, pid, s.reigns, k).map(i => list[i].id); }

function approve(ctx, s, p) {
  p.status = 'approved';
  ctx.media(`booth.${p.id}`, p.img);
}

function drop(ctx, s, p, status) {
  p.status = status;
  p.img = '';
  ctx.media(`booth.${p.id}`, '');
  ctx.clearUpload(p.pid);
}

function nextReign(ctx, s) {
  const choices = pool(s).filter(p => !p.shown);
  if (!choices.length) { s.reign = null; return; }
  choices.sort((a, b) => score(b) - score(a) || a.at - b.at);
  const p = choices[0];
  p.status = 'reigning';
  p.shown = true;
  s.reign = { id: p.id, name: ctx.name(p.pid), pid: p.pid, img: p.img, until: ctx.now + ctx.cfg.reignS * 1000, n: ++s.reigns };
  ctx.award(p.pid, 50);
  s.votes = {};
}

export default {
  init(ctx) {
    return { photos: [], reign: null, reigns: 0, votes: {}, next: 1 };
  },

  // A sealed upload, opened by the host: {img} with the picture as packed bits in base64.
  upload(ctx, pid, text) {
    const s = ctx.state;
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return null; }
    if (typeof msg.img !== 'string' || msg.img.length > MAX_IMG || !msg.consent) return null;
    for (const p of s.photos) if (p.pid === pid && p.status === 'pending') drop(ctx, s, p, 'replaced');
    const p = { id: s.next++, pid, img: msg.img, at: ctx.now, status: 'pending', w: 0, n: 0, shown: false };
    s.photos.push(p);
    if (ctx.cfg.autoApprove) approve(ctx, s, p);
    return { changed: true };
  },

  input: {
    pick(ctx, pid, msg) {
      const s = ctx.state, v = s.votes[pid];
      if (!v || msg.k !== v.k || !v.pair.length) return null;
      for (const id of v.pair) { const p = entry(s, id); if (p) p.n++; }
      const won = v.pair.includes(msg.pick) && entry(s, msg.pick);
      if (won) { won.w++; ctx.award(won.pid, 5); }
      ctx.award(pid, 2);
      v.k++;
      v.pair = v.k < VOTES_EACH ? pairIds(s, pid, v.k) : [];
      return { changed: true };
    },
    withdraw(ctx, pid) {
      const s = ctx.state;
      for (const p of s.photos) if (p.pid === pid && ['pending', 'approved', 'reigning'].includes(p.status)) drop(ctx, s, p, 'withdrawn');
      if (s.reign && s.reign.pid === pid) s.reign = null;
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    if (s.reign && ctx.now < s.reign.until) return false;
    const was = s.reign;
    if (was) { const p = entry(s, was.id); if (p) drop(ctx, s, p, 'shown'); }
    nextReign(ctx, s);
    return was !== s.reign;
  },

  view(ctx) {
    const s = ctx.state;
    return { reign: s.reign ? { name: s.reign.name, left: Math.max(0, s.reign.until - ctx.now), n: s.reign.n } : null,
      left: s.reign ? Math.max(0, s.reign.until - ctx.now) : 0, approved: pool(s).length, pending: s.photos.filter(p => p.status === 'pending').length };
  },

  you(ctx, pid) {
    const s = ctx.state;
    const mine = [...s.photos].reverse().find(p => p.pid === pid);
    const v = s.votes[pid] || (s.votes[pid] = { k: 0, pair: pairIds(s, pid, 0) });
    // A pair that lost a photo to deletion is drawn again.
    if (v.pair.some(id => !entry(s, id) || entry(s, id).status !== 'approved')) v.pair = v.k < VOTES_EACH ? pairIds(s, pid, v.k) : [];
    return { mine: mine ? mine.status : 'none', k: v.k, left: VOTES_EACH - v.k, pair: v.pair };
  },

  youKey(ctx, pid) {
    const s = ctx.state, mine = [...s.photos].reverse().find(p => p.pid === pid), v = s.votes[pid];
    return `${s.reigns}.${mine ? mine.status : ''}.${v ? `${v.k}:${v.pair.join('-')}` : 0}.${pool(s).length > 1}`;
  },

  badge: {
    mode: 'still',
    key: ctx => `${ctx.state.reign ? ctx.state.reign.id : 'open'}`,
    model: ctx => { const r = ctx.state.reign; return r ? { reign: { name: r.name, img: r.img } } : { reign: null, approved: pool(ctx.state).length }; },
  },

  controls: () => [
    { label: 'take the portrait off the badge now', run: ctx => { if (ctx.state.reign) ctx.state.reign.until = 0; } },
    { label: 'delete every photo', run: ctx => { const s = ctx.state; for (const p of s.photos) if (p.img) drop(ctx, s, p, 'deleted'); s.reign = null; } },
  ],

  stop(ctx) {
    const s = ctx.state;
    for (const p of s.photos) if (p.img) drop(ctx, s, p, 'deleted');
    s.reign = null;
  },

  stats(ctx) {
    const s = ctx.state, left = s.reign ? Math.max(0, Math.ceil((s.reign.until - ctx.now) / 1000)) : 0;
    return [['waiting for you', s.photos.filter(p => p.status === 'pending').length], ['in the vote', pool(s).length],
      ['on the badge', s.reign ? `${s.reign.name}, ${left} s left` : 'nobody yet']];
  },

  // For the host page's approval queue.
  pending: ctx => ctx.state.photos.filter(p => p.status === 'pending'),
  decide(ctx, id, yes) {
    const s = ctx.state, p = entry(s, id);
    if (!p || p.status !== 'pending') return;
    if (yes) approve(ctx, s, p); else drop(ctx, s, p, 'rejected');
  },
};
