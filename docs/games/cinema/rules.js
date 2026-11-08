// 2 fps cinema: each phone draws one frame of a 12 frame loop, seeing the frame before it faintly
// underneath. A finished reel premieres: it plays on the badge as a flip book, one quick pass a
// frame, and loops on every phone and the projector at 4 frames a second.
//
// With a big crowd several reels fill at once, one claim per phone. A claim not drawn in time goes
// back to the pool. A reel left half drawn for two minutes premieres with what it has.

export const COLS = 48, ROWS = 32, FRAMES = 12;
const MAX_OPEN = 10, IDLE_PREMIERE_MS = 120_000, PREMIERE_MS = 45_000, GRACE_MS = 30_000;
export const PROMPTS = ['a bouncing ball', 'a walking robot', 'a blinking led', 'a capsule dropping out of the machine', 'a rocket launch',
  'a spinning gear', 'a waving hand', 'a growing plant', 'a jumping frog', 'a sine wave', 'a heartbeat', 'lightning'];

function newReel(ctx, s) {
  const reel = { id: ++s.reelCount, prompt: PROMPTS[(s.reelCount - 1) % PROMPTS.length], frames: Array(FRAMES).fill(''), by: Array(FRAMES).fill(''), claims: {}, lastAt: ctx.now };
  s.open.push(reel);
  return reel;
}

function claimOf(s, pid, now) {
  for (const reel of s.open) for (const [slot, c] of Object.entries(reel.claims)) if (c.pid === pid && c.until + GRACE_MS > now) return { reel, slot: +slot };
  return null;
}

function onion(reel, slot) {
  for (let i = slot - 1; i >= 0; i--) if (reel.frames[i]) return reel.frames[i];
  return '';
}

function premiere(ctx, s, reel) {
  const frames = reel.frames.map((f, i) => [f, reel.by[i]]).filter(([f]) => f);
  if (!frames.length) return;
  s.open = s.open.filter(r => r !== reel);
  s.queue.push({ id: reel.id, prompt: reel.prompt, frames: frames.map(f => f[0]), by: [...new Set(frames.map(f => f[1]))] });
}

export default {
  init(ctx) {
    const old = ctx.state;
    return { reelCount: old ? old.reelCount : 0, open: [], queue: [], premiere: old ? old.premiere : null, premiereAt: 0 };
  },

  input: {
    claim(ctx, pid) {
      const s = ctx.state;
      if (claimOf(s, pid, ctx.now)) return { changed: false };
      for (const reel of s.open) {
        for (let slot = 0; slot < FRAMES; slot++) {
          const c = reel.claims[slot];
          if (!reel.frames[slot] && (!c || c.until + GRACE_MS < ctx.now)) {
            reel.claims[slot] = { pid, until: ctx.now + ctx.cfg.claimS * 1000 };
            return { changed: true };
          }
        }
      }
      if (s.open.length >= MAX_OPEN) return { note: 'every reel is busy. try again in a minute.' };
      newReel(ctx, s).claims[0] = { pid, until: ctx.now + ctx.cfg.claimS * 1000 };
      return { changed: true };
    },
    frame(ctx, pid, msg) {
      const s = ctx.state, held = claimOf(s, pid, ctx.now);
      if (!held || held.reel.id !== msg.reel || held.slot !== msg.slot) return { note: 'that frame is no longer yours. grab another one.' };
      if (typeof msg.bits !== 'string' || msg.bits.length > 300) return null;
      const { reel, slot } = held;
      reel.frames[slot] = msg.bits;
      reel.by[slot] = ctx.name(pid);
      reel.lastAt = ctx.now;
      delete reel.claims[slot];
      ctx.award(pid, 20);
      if (reel.frames.every(Boolean)) premiere(ctx, s, reel);
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    let changed = false;
    for (const reel of [...s.open]) {
      const drawn = reel.frames.filter(Boolean).length;
      const claimed = Object.values(reel.claims).some(c => c.until + GRACE_MS > ctx.now);
      if (drawn >= FRAMES / 2 && !claimed && ctx.now - reel.lastAt > IDLE_PREMIERE_MS) { premiere(ctx, s, reel); changed = true; }
    }
    if (s.queue.length && (!s.premiere || ctx.now - s.premiereAt > PREMIERE_MS)) {
      s.premiere = s.queue.shift();
      s.premiereAt = ctx.now;
      changed = true;
    }
    return changed;
  },

  view(ctx) {
    const s = ctx.state;
    return { open: s.open.map(r => ({ id: r.id, prompt: r.prompt, drawn: r.frames.filter(Boolean).length })), queued: s.queue.length,
      premiere: s.premiere, frames: FRAMES };
  },

  you(ctx, pid) {
    const s = ctx.state, held = claimOf(s, pid, ctx.now);
    if (!held) return { claim: null };
    const c = held.reel.claims[held.slot];
    return { claim: { reel: held.reel.id, slot: held.slot, prompt: held.reel.prompt, onion: onion(held.reel, held.slot), left: Math.max(0, c.until - ctx.now) } };
  },

  youKey(ctx, pid) { const h = claimOf(ctx.state, pid, ctx.now); return h ? `${h.reel.id}.${h.slot}` : 'none'; },

  badge: {
    mode: 'reel',
    reel(ctx) {
      const p = ctx.state.premiere;
      if (!p) return null;
      return { key: `reel.${ctx.epoch}.${p.id}`, frames: p.frames.map((bits, i) => ({ kind: 'frame', bits, prompt: p.prompt, n: i + 1, of: p.frames.length })) };
    },
    // Between premieres the badge shows the reels in progress, redrawn every few frames.
    key(ctx) { const s = ctx.state; return `progress.${s.open.map(r => `${r.id}:${Math.floor(r.frames.filter(Boolean).length / 3)}`).join(',')}`; },
    gapMs: () => 20_000,
    model(ctx) {
      const s = ctx.state;
      return { kind: 'progress', open: s.open.map(r => ({ prompt: r.prompt, drawn: r.frames.filter(Boolean).length })), premiere: s.premiere ? { prompt: s.premiere.prompt, frames: s.premiere.frames, by: s.premiere.by } : null };
    },
  },

  controls: () => [
    { label: 'premiere the fullest reel now', run: ctx => {
      const s = ctx.state, reel = [...s.open].sort((a, b) => b.frames.filter(Boolean).length - a.frames.filter(Boolean).length)[0];
      if (reel) premiere(ctx, s, reel);
    } },
    { label: 'replay the last premiere', run: ctx => { const s = ctx.state; if (s.premiere) { s.queue.unshift({ ...s.premiere, id: s.premiere.id + 0.5 }); s.premiereAt = 0; } } },
  ],

  stats(ctx) {
    const s = ctx.state;
    return [['reels drawing', s.open.length], ['frames drawn', s.open.reduce((n, r) => n + r.frames.filter(Boolean).length, 0)],
      ['waiting to premiere', s.queue.length], ['last premiere', s.premiere ? s.premiere.prompt : 'none yet']];
  },
};
