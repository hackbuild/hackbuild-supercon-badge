// Meme gifs: the wearer puts GIFs on the badge, and phones can ask for one from the preset list.
// The host decodes a GIF into a dozen one bit frames and the badge loops them, one quick pass a
// frame, until the next GIF. Phones and the projector show the real GIF.

import { PRESETS, preset } from './presets.js';

const COOLDOWN_MS = 30_000;
const MAX_QUEUE = 12;
const LOAD_GIVE_UP_MS = 60_000;

// The job keeps its own handle on the state: the room may have moved to another game by the time
// a decode finishes, and only the newest request may land.
function play(ctx, item) {
  const s = ctx.state, id = (s.loadId || 0) + 1;
  s.loadId = id;
  s.loading = item.title;
  s.loadAt = ctx.now;
  ctx.job(async c => {
    try {
      const { decode } = await import('./decode.js');
      const d = await decode(item.file || item.url, { maxFrames: c.cfg.frames, halftone: c.cfg.halftone });
      if (s.loadId === id) s.now = { id: ++s.played, title: item.title, url: item.url || '', by: item.by || '', frames: d.frames, w: d.w, h: d.h, at: c.now };
    } finally {
      if (s.loadId === id) s.loading = '';
    }
  });
}

function next(ctx) {
  const s = ctx.state;
  const item = s.queue.shift();
  if (item) play(ctx, item);
}

export default {
  init(ctx) {
    const old = ctx.state;
    return { queue: [], now: old ? old.now : null, loading: '', played: old ? old.played : 0, asked: {} };
  },

  input: {
    request(ctx, pid, msg) {
      const s = ctx.state, p = preset(msg.id);
      if (!ctx.cfg.requests) return { note: 'requests are off right now.' };
      if (!p) return null;
      const wait = (s.asked[pid] || 0) + COOLDOWN_MS - ctx.now;
      if (wait > 0) return { note: `one request every 30 s. try again in ${Math.ceil(wait / 1000)} s.` };
      if (s.queue.some(q => q.url === p.url)) return { note: 'that one is already coming up.' };
      if (s.queue.length >= MAX_QUEUE) return { note: 'the queue is full. try again soon.' };
      s.asked[pid] = ctx.now;
      s.queue.push({ title: p.title, url: p.url, by: ctx.name(pid) });
      ctx.award(pid, 1);
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    // A decode that never came back, from a fetch that hung or a page reloaded mid way, must not hold the queue.
    if (s.loading && ctx.now - (s.loadAt || 0) > LOAD_GIVE_UP_MS) { s.loading = ''; return true; }
    if (s.loading) return false;
    const due = !s.now || ctx.now - s.now.at > ctx.cfg.holdS * 1000;
    if (due && s.queue.length) { next(ctx); return true; }
    return false;
  },

  view(ctx) {
    const s = ctx.state, n = s.now;
    return { now: n ? { title: n.title, url: n.url, by: n.by, frames: n.frames.length } : null, loading: s.loading,
      queue: s.queue.map(q => ({ title: q.title, by: q.by })), requests: !!ctx.cfg.requests,
      presets: PRESETS.map(p => ({ id: p.id, title: p.title, url: p.url })) };
  },

  you(ctx, pid) { return { wait: Math.max(0, (ctx.state.asked[pid] || 0) + COOLDOWN_MS - ctx.now) }; },
  youKey(ctx, pid) { return String(ctx.state.asked[pid] || 0); },

  badge: {
    mode: 'reel',
    reel(ctx) {
      const n = ctx.state.now;
      if (!n) return null;
      return { key: `gif.${n.id}`, loops: 0, frames: n.frames.map(bits => ({ kind: 'gif', bits, w: n.w, h: n.h })) };
    },
    // While a GIF loops, this matches the reel's key, so no still interrupts it.
    key: ctx => (ctx.state.now ? `gif.${ctx.state.now.id}` : `idle.${ctx.state.queue.length}`),
    model(ctx) {
      const s = ctx.state, n = s.now;
      return { kind: 'idle', now: n ? { title: n.title, url: n.url, by: n.by, first: n.frames[0], w: n.w, h: n.h } : null, queue: s.queue.length };
    },
  },

  controls: () => [
    { label: 'next gif', run: ctx => next(ctx) },
    // A decode still in flight is dropped too, or the gif would come back after the stop.
    { label: 'stop the gif', run: ctx => { const s = ctx.state; s.now = null; s.loading = ''; s.loadId = (s.loadId || 0) + 1; } },
  ],

  headline(ctx) { const s = ctx.state; return { big: s.loading ? 'loading a gif' : s.now ? s.now.title : 'pick a gif below', small: s.queue.length ? `${s.queue.length} queued` : 'tap one to play it now' }; },

  stats(ctx) {
    const s = ctx.state;
    return [['playing', s.now ? `${s.now.title}${s.now.by ? `, asked for by ${s.now.by}` : ''}` : 'nothing'],
      ['loading', s.loading || 'nothing'], ['queued', s.queue.length]];
  },

  // The host page's GIF panel.
  playNow(ctx, item) { play(ctx, item); },
  enqueue(ctx, item) { if (ctx.state.queue.length < MAX_QUEUE) ctx.state.queue.push(item); },
};
