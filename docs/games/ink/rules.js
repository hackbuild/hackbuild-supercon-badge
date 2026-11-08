// Live ink: everyone draws on one page and the badge shows it about once a second.
//
// Phones send strokes four times a second. The host checks each against that phone's ink, draws
// it onto its own copy of the page, and batches every stroke from every phone into one stream
// that goes to all phones, the projector and the badge. The badge draws the strokes itself, so
// nothing big ever travels to it. A snapshot of the page lets late joiners catch up. When the
// page is too full, a new one starts.
//
// A stroke is text: "size,color,x0,y0,x1,y1,..." in panel pixels, size 0 to 2, color 1 ink, 0 erase.

import { W, H } from '../../lib/screen.js';
import { parseStroke, strokeLength, drawStroke } from './strokes.js';

const MAX_STROKES = 24;
const SNAP_MS = 3000;
export const PROMPTS = ['draw anything', 'draw a robot', 'draw the capsule machine', 'draw a circuit', 'draw your favorite chip',
  'draw a cat', 'draw a rocket', 'draw the supercon badge', 'draw a soldering iron', 'draw a monster'];

const pages = new Map();

// The host's copy of a page, kept outside the saved state; a saved snapshot restores it.
function page(ctx) {
  const s = ctx.state, id = `${ctx.epoch}.${s.page}`;
  if (!pages.has(id)) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, W, H);
    pages.set(id, { cv, c });
    if (s.snap) {
      const img = new Image();
      img.onload = () => c.drawImage(img, 0, 0, W, H);
      img.src = s.snap;
    }
  }
  return pages.get(id);
}

const encode = st => `${st.size},${st.color},${st.pts.join(',')}`;

function inkOf(ctx, pid) {
  const s = ctx.state, e = s.ink[pid], max = ctx.cfg.inkMax;
  if (!e) return max;
  return Math.min(max, e.n + ((ctx.now - e.at) / 1000) * ctx.cfg.inkPerS);
}

function newPage(ctx) {
  const s = ctx.state;
  // A page canvas is 2.5 MB; a long event fills a page every minute or two, so only the live one is kept.
  pages.delete(`${ctx.epoch}.${s.page}`);
  s.page++;
  s.snap = '';
  s.coverage = 0;
  s.prompt = PROMPTS[s.page % PROMPTS.length];
  ctx.stream(`page,${s.page}`);
  ctx.media('ink', '');
}

function coverage(cv) {
  const small = document.createElement('canvas');
  small.width = 120;
  small.height = 84;
  const c = small.getContext('2d');
  c.drawImage(cv, 0, 0, 120, 84);
  const d = c.getImageData(0, 0, 120, 84).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
  return Math.round((100 * dark) / (120 * 84));
}

// A small picture of the page for late joiners and the projector, kept under the relay's limit.
function snapshot(cv) {
  for (const [w, h] of [[480, 336], [320, 224], [240, 168]]) {
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    small.getContext('2d').drawImage(cv, 0, 0, w, h);
    const url = small.toDataURL('image/png');
    if (url.length < 60000) return url;
  }
  return '';
}

export default {
  init(ctx) {
    const old = ctx.state;
    pages.clear();
    return { page: old ? old.page + 1 : 1, prompt: PROMPTS[0], snap: '', snapAt: 0, changedAt: 0, coverage: 0, ink: {}, painters: {}, last: [] };
  },

  input: {
    ink(ctx, pid, msg) {
      const s = ctx.state, list = Array.isArray(msg.st) ? msg.st.slice(0, MAX_STROKES) : [];
      if (msg.p !== s.page) return null;
      let left = inkOf(ctx, pid), drew = 0;
      const pg = page(ctx);
      for (const text of list) {
        const st = parseStroke(text);
        if (!st) continue;
        const cost = strokeLength(st);
        if (cost > left) break;
        left -= cost;
        drawStroke(pg.c, st);
        ctx.stream(encode(st));
        drew++;
      }
      s.ink[pid] = { n: left, at: ctx.now };
      if (drew) {
        s.changedAt = ctx.now;
        if (!s.painters[pid]) s.painters[pid] = 1;
        const nm = ctx.name(pid);
        s.last = [nm, ...s.last.filter(x => x !== nm)].slice(0, 5);
        ctx.award(pid, drew);
      }
      return { changed: false, note: drew < list.length ? 'out of ink for a moment. it refills fast.' : '' };
    },
  },

  tick(ctx) {
    const s = ctx.state;
    if (s.changedAt > s.snapAt && ctx.now - s.snapAt > SNAP_MS) {
      const pg = page(ctx);
      s.snapAt = ctx.now;
      s.coverage = coverage(pg.cv);
      s.snap = snapshot(pg.cv);
      ctx.media('ink', s.snap);
      if (s.coverage >= ctx.cfg.fullAt) newPage(ctx);
      return true;
    }
    return false;
  },

  view(ctx) {
    const s = ctx.state;
    return { page: s.page, prompt: s.prompt, painters: Object.keys(s.painters).length, coverage: s.coverage, fullAt: ctx.cfg.fullAt, last: s.last };
  },

  you(ctx, pid) {
    return { ink: Math.floor(inkOf(ctx, pid)), inkMax: ctx.cfg.inkMax, inkPerS: ctx.cfg.inkPerS };
  },

  youKey(ctx, pid) { return `${ctx.state.page}.${ctx.state.ink[pid] ? Math.floor(ctx.state.ink[pid].at / 2000) : 0}`; },

  badge: {
    mode: 'ink',
    key: ctx => `${ctx.epoch}.${ctx.state.page}`,
    model: ctx => ({ page: ctx.state.page, prompt: ctx.state.prompt, painters: Object.keys(ctx.state.painters).length }),
    snapshot(ctx, c) { c.drawImage(page(ctx).cv, 0, 0); },
  },

  controls: () => [
    { label: 'new page', run: ctx => newPage(ctx) },
  ],

  headline(ctx) { const s = ctx.state; return { big: `page ${s.page}, ${s.coverage}% covered`, small: `${Object.keys(s.painters).length} drawing. ${s.prompt}.` }; },

  stats(ctx) {
    const s = ctx.state;
    return [['page', s.page], ['prompt', s.prompt], ['covered', `${s.coverage}%, new page at ${ctx.cfg.fullAt}%`], ['painters', Object.keys(s.painters).length]];
  },
};
