// Pixel commons: one shared 36 by 24 canvas. Every phone has ink that refills over time, so no
// one person can take over the picture. Phones see every pixel land live; the badge prints the
// canvas whenever it changed and the last print is done, about every 6 s.

export const COLS = 36, ROWS = 24;
export const PROMPTS = ['draw a resistor', 'draw the 555', 'draw a robot', 'draw a heart', 'draw a capsule', 'draw a soldering iron',
  'draw a smiley', 'draw an led', 'draw a cat', 'draw the badge'];

function inkOf(ctx, pid) {
  const c = ctx.cfg, e = ctx.state.ink[pid], every = c.inkEveryS * 1000;
  if (!e) return { n: c.inkMax, at: ctx.now };
  const gained = Math.floor((ctx.now - e.at) / every);
  if (!gained) return e;
  const n = Math.min(c.inkMax, e.n + gained);
  return { n, at: n >= c.inkMax ? ctx.now : e.at + gained * every };
}

export default {
  init(ctx) {
    const old = ctx.state;
    const blank = '0'.repeat(COLS * ROWS);
    return { cells: old ? old.cells : blank, shown: old ? old.shown : blank, prompt: old ? old.prompt : 0, promptAt: ctx.now, ink: {}, painters: {}, last: [] };
  },

  input: {
    paint(ctx, pid, msg) {
      const s = ctx.state, e = inkOf(ctx, pid);
      const cells = s.cells.split('');
      let used = 0;
      for (const item of Array.isArray(msg.p) ? msg.p.slice(0, ctx.cfg.inkMax) : []) {
        if (used >= e.n || !Array.isArray(item)) break;
        const [x, y, c] = item;
        if (!(x >= 0 && x < COLS && y >= 0 && y < ROWS) || ![0, 1, 2].includes(c)) continue;
        const i = (y | 0) * COLS + (x | 0);
        if (cells[i] === String(c)) continue;
        cells[i] = String(c);
        used++;
      }
      if (!used) return null;
      s.cells = cells.join('');
      s.ink[pid] = { n: e.n - used, at: e.n >= ctx.cfg.inkMax ? ctx.now : e.at };
      s.painters[pid] = 1;
      const nm = ctx.name(pid);
      s.last = [nm, ...s.last.filter(n => n !== nm)].slice(0, 4);
      ctx.award(pid, used);
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    if (ctx.now - s.promptAt < ctx.cfg.promptMin * 60_000) return false;
    s.prompt = (s.prompt + 1) % PROMPTS.length;
    s.promptAt = ctx.now;
    return true;
  },

  view(ctx) {
    const s = ctx.state;
    return { cells: s.cells, shown: s.shown, prompt: PROMPTS[s.prompt], painters: Object.keys(s.painters).length, last: s.last };
  },

  you(ctx, pid) {
    const e = inkOf(ctx, pid), c = ctx.cfg;
    return { ink: e.n, inkMax: c.inkMax, nextMs: e.n >= c.inkMax ? 0 : c.inkEveryS * 1000 - (ctx.now - e.at), everyMs: c.inkEveryS * 1000 };
  },

  youKey(ctx, pid) { const e = ctx.state.ink[pid]; return e ? `${e.n}.${e.at}` : 'full'; },

  badge: {
    live: true,
    mode: 'still',
    key: ctx => `${ctx.state.prompt}.${ctx.state.cells}`,
    gapMs: ctx => ctx.cfg.batchS * 1000,
    model: ctx => { const s = ctx.state; return { cells: s.cells, prompt: PROMPTS[s.prompt], painters: Object.keys(s.painters).length, last: s.last }; },
    // The key holds the canvas the badge just drew, which phones can ask to see.
    shown(ctx, key) { ctx.state.shown = key.slice(key.indexOf('.') + 1); },
  },

  controls: () => [
    { label: 'next prompt', run: ctx => { ctx.state.promptAt = 0; } },
    { label: 'wipe the canvas', run: ctx => { ctx.state.cells = '0'.repeat(COLS * ROWS); } },
  ],

  headline(ctx) { const s = ctx.state; return { big: PROMPTS[s.prompt], small: `${Object.keys(s.painters).length} painted` }; },

  stats(ctx) {
    const s = ctx.state;
    return [['prompt', PROMPTS[s.prompt]], ['painters', Object.keys(s.painters).length], ['pixels set', (s.cells.match(/[12]/g) || []).length]];
  },
};
