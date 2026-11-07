// PLACARD crowd games. The host page runs these rules and is the only writer of game state; phones
// write only their own input. Every value a phone sees carries durations, never clock times, because
// the host phone and the players' phones do not agree on the time.

import { code, hash32 } from './relay.js';

export const PROTOCOL = 1;
export const W = 960, H = 672;

export const GAME_LIST = [
  { id: 'pixel', name: 'pixel commons', verb: 'make together', blurb: 'paint a shared canvas. ink refills over time.' },
  { id: 'hill', name: 'the hill', verb: 'write and vote', blurb: 'write a quip, then vote it onto the badge.' },
  { id: 'snipe', name: 'flash snipe', verb: 'race', blurb: 'every redraw shows a new code. first to claim it scores most.' },
  { id: 'snake', name: 'snake by committee', verb: 'steer together', blurb: 'the room votes every move.' },
];

export const DEFAULTS = {
  pixel: { batchS: 20, promptMin: 20, inkMax: 24, inkEveryS: 4 },
  hill: { answerS: 90, voteS: 60, resultS: 12, votesEach: 5 },
  snipe: { holdS: 30 },
  snake: { turnS: 6 },
};

// ---- moderation ----

const BLOCK = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'tranny', 'whore', 'slut', 'cock', 'dick', 'pussy', 'bitch', 'porn', 'kys'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

export function clean(text, max) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function blocked(text) {
  const flat = String(text).toLowerCase().replace(/[01345@$!7]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
  return BLOCK.some(w => flat.includes(w));
}

// ---- content ----

export const PIXEL_PROMPTS = ['draw a resistor', 'draw the 555', 'draw a robot', 'draw a heart', 'draw a capsule', 'draw a soldering iron', 'draw a smiley', 'draw a led', 'draw a cat', 'draw the badge'];

export const HILL_PROMPTS = [
  { q: 'worst thing to hear at a badge talk', seed: 'it worked on my bench' },
  { q: 'a bad name for a hackerspace', seed: 'the liability hut' },
  { q: 'what the magic smoke is actually for', seed: 'it is the firmware' },
  { q: 'the real reason the board was late', seed: 'the footprint was mirrored' },
  { q: 'worst place to put an esp32', seed: 'inside another esp32' },
  { q: 'a new feature for next year\'s badge', seed: 'a battery that lasts past friday' },
  { q: 'what the capsule machine is really dispensing', seed: 'regret, in a sphere' },
  { q: 'the one rule every hackerspace needs', seed: 'label your stuff or lose it' },
];

// ---- the host's state ----

export function newRoom() {
  return { v: PROTOCOL, kind: null, epoch: code(6), names: {}, scores: {}, banned: {}, seq: {}, cfg: structuredClone(DEFAULTS), g: null };
}

export function startGame(room, kind, now) {
  room.kind = kind;
  room.epoch = code(6);
  room.seq = {};
  room.g = INIT[kind](room, now);
  return room;
}

const INIT = {
  pixel(room, now) {
    const old = room.g && room.g.cells ? room.g : null;
    return {
      cells: old ? old.cells : '0'.repeat(PIX_C * PIX_R),
      shown: old ? old.shown : '0'.repeat(PIX_C * PIX_R),
      prompt: old ? old.prompt : 0,
      promptAt: now,
      ink: {},
      painters: {},
      last: [],
    };
  },
  hill(room, now) {
    const p = HILL_PROMPTS[0];
    return {
      phase: 'answer', round: 1, prompt: 1, until: now + room.cfg.hill.answerS * 1000,
      champ: { text: p.seed, q: p.q, name: 'hack.build', pid: '', held: 0 },
      prev: null, subs: [], votes: {}, result: null,
    };
  },
  snipe(room, now) {
    return { round: 0, code: '', live: false, liveAt: 0, until: 0, claims: [], best: [], waiting: true };
  },
  snake(room, now) {
    const g = { best: 0, turn: 0, until: now + room.cfg.snake.turnS * 1000 };
    snakeReset(g);
    return g;
  },
};

export function addScore(room, pid, n) {
  if (!pid || !n) return;
  room.scores[pid] = (room.scores[pid] || 0) + n;
}

export function top(room, n) {
  return Object.entries(room.scores)
    .filter(([pid]) => !room.banned[pid])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pid, s]) => [room.names[pid] || 'someone', s]);
}

// Applies one phone's input. Returns { you } with what that phone should be told, or null.
export function input(room, pid, msg, now) {
  if (!room.g || room.banned[pid] || msg.e !== room.epoch) return null;
  if (!(msg.s > (room.seq[pid] || 0))) return null;
  room.seq[pid] = msg.s;
  const fn = INPUT[room.kind] && INPUT[room.kind][msg.t];
  return fn ? fn(room, room.g, pid, msg, now) : null;
}

// Advances timers. Returns true when the view changed.
export function tick(room, now, badge) {
  const fn = TICK[room.kind];
  return fn ? fn(room, room.g, now, badge) : false;
}

// ---- pixel commons ----

export const PIX_C = 36, PIX_R = 24;

function inkOf(room, g, pid, now) {
  const c = room.cfg.pixel, e = g.ink[pid];
  if (!e) return { n: c.inkMax, at: now };
  const gained = Math.floor((now - e.at) / (c.inkEveryS * 1000));
  if (!gained) return e;
  const n = Math.min(c.inkMax, e.n + gained);
  return { n, at: n >= c.inkMax ? now : e.at + gained * c.inkEveryS * 1000 };
}

export function pixelYou(room, pid, now) {
  const g = room.g, e = inkOf(room, g, pid, now), c = room.cfg.pixel;
  const nextMs = e.n >= c.inkMax ? 0 : c.inkEveryS * 1000 - (now - e.at);
  return { ink: e.n, inkMax: c.inkMax, nextMs, everyMs: c.inkEveryS * 1000 };
}

const INPUT = {
  pixel: {
    paint(room, g, pid, msg, now) {
      const e = inkOf(room, g, pid, now);
      const list = Array.isArray(msg.p) ? msg.p.slice(0, room.cfg.pixel.inkMax) : [];
      const cells = g.cells.split('');
      let used = 0;
      for (const item of list) {
        if (used >= e.n || !Array.isArray(item)) break;
        const [x, y, c] = item;
        if (!(x >= 0 && x < PIX_C && y >= 0 && y < PIX_R) || !['0', '1', '2'].includes(String(c))) continue;
        const i = (y | 0) * PIX_C + (x | 0);
        if (cells[i] === String(c)) continue;
        cells[i] = String(c);
        used++;
      }
      if (used) {
        g.cells = cells.join('');
        g.ink[pid] = { n: e.n - used, at: e.n >= room.cfg.pixel.inkMax ? now : e.at };
        g.painters[pid] = 1;
        g.last = [room.names[pid] || 'someone', ...g.last.filter(n => n !== room.names[pid])].slice(0, 4);
        addScore(room, pid, used);
      }
      return { you: pixelYou(room, pid, now), changed: used > 0 };
    },
  },
  hill: {
    answer(room, g, pid, msg) {
      if (g.phase !== 'answer') return null;
      const text = clean(msg.a, 48).toLowerCase();
      if (text.length < 2) return { you: { hill: { note: 'too short.' } } };
      if (blocked(text)) return { you: { hill: { note: 'that answer did not pass the word filter.' } } };
      const mine = g.subs.find(s => s.pid === pid);
      if (mine) mine.text = text;
      else if (g.subs.length < 400) {
        g.subs.push({ pid, text, w: 0, l: 0 });
        addScore(room, pid, 5);
      } else return { you: { hill: { note: 'this round is full. vote in the next phase.' } } };
      return { you: { hill: { r: g.round, sent: text } }, changed: true };
    },
    vote(room, g, pid, msg) {
      if (g.phase !== 'vote') return null;
      const v = g.votes[pid] || { n: 0, at: -1 };
      if (msg.r !== g.round || msg.i !== v.at || v.n >= room.cfg.hill.votesEach) return { you: hillYou(room, pid) };
      const s = g.subs[msg.i];
      if (s) {
        if (msg.w === 'c') s.w++; else s.l++;
        addScore(room, pid, 1);
      }
      v.n++;
      g.votes[pid] = v;
      v.at = matchup(room, pid, v.n);
      return { you: hillYou(room, pid), changed: false };
    },
  },
  snipe: {
    claim(room, g, pid, msg, now) {
      const guess = clean(msg.c, 8).toUpperCase();
      if (!g.live || guess !== g.code) return { you: { snipe: { note: g.live ? 'that code is not on the badge now.' : 'no code is live. wait for the flash.' } } };
      if (g.claims.some(c => c.pid === pid)) return { you: { snipe: { note: 'you already claimed this one.' } } };
      const pts = Math.max(10, 100 - 15 * g.claims.length);
      const ms = now - g.liveAt;
      g.claims.push({ pid, name: room.names[pid] || 'someone', ms, pts });
      addScore(room, pid, pts);
      return { you: { snipe: { r: g.round, pts, place: g.claims.length, ms } }, changed: true };
    },
  },
  snake: {
    dir(room, g, pid, msg) {
      if (g.over || msg.t !== 'dir' || msg.turn !== g.turn || !DIRS[msg.d]) return null;
      const old = g.voted[pid];
      if (old === msg.d) return null;
      if (old) g.tally[old]--;
      g.voted[pid] = msg.d;
      g.tally[msg.d]++;
      return { you: { snake: { turn: g.turn, d: msg.d } }, changed: true };
    },
  },
};

// ---- the hill ----

// Each voter sees the hill against one challenger, picked from a hash so no list goes to every phone.
function matchup(room, pid, n) {
  const g = room.g, others = [];
  g.subs.forEach((s, i) => { if (s.pid !== pid) others.push(i); });
  if (!others.length) return -1;
  return others[hash32(`${pid}.${g.round}.${n}`) % others.length];
}

export function hillYou(room, pid) {
  const g = room.g;
  if (g.phase === 'answer') {
    const mine = g.subs.find(s => s.pid === pid);
    return { hill: { r: g.round, sent: mine ? mine.text : '' } };
  }
  if (g.phase === 'vote') {
    let v = g.votes[pid];
    if (!v) { v = { n: 0, at: matchup(room, pid, 0) }; g.votes[pid] = v; }
    const done = v.n >= room.cfg.hill.votesEach || v.at < 0;
    return { hill: { r: g.round, i: done ? -1 : v.at, text: done ? '' : g.subs[v.at].text, left: room.cfg.hill.votesEach - v.n } };
  }
  const mine = g.subs.find(s => s.pid === pid);
  return { hill: { r: g.round, mine: mine ? { text: mine.text, w: mine.w, l: mine.l } : null } };
}

function hillEndVote(room, g) {
  let best = null;
  for (const s of g.subs) {
    const n = s.w + s.l;
    if (n < 2 || s.w < 2) continue;
    const rate = s.w / n;
    if (rate <= 0.5) continue;
    if (!best || rate > best.rate || (rate === best.rate && s.w > best.s.w)) best = { s, rate };
  }
  const p = HILL_PROMPTS[(g.prompt - 1) % HILL_PROMPTS.length];
  if (best) {
    g.prev = g.champ;
    g.champ = { text: best.s.text, q: p.q, name: room.names[best.s.pid] || 'someone', pid: best.s.pid, held: 0 };
    addScore(room, best.s.pid, 50);
    g.result = { took: true, text: best.s.text, name: g.champ.name, rate: Math.round(best.rate * 100) };
  } else {
    g.champ.held++;
    if (g.champ.pid) addScore(room, g.champ.pid, 20);
    g.result = { took: false, held: g.champ.held };
  }
}

export function hillVeto(room, now) {
  const g = room.g;
  if (!g || room.kind !== 'hill') return;
  if (g.champ.pid) room.banned[g.champ.pid] = 1;
  const p = HILL_PROMPTS[(g.prompt - 1) % HILL_PROMPTS.length];
  g.champ = g.prev && !room.banned[g.prev.pid] ? g.prev : { text: p.seed, q: p.q, name: 'hack.build', pid: '', held: 0 };
  g.prev = null;
}

// ---- flash snipe ----

function snipeNext(room, g, now) {
  if (g.claims.length) g.best = [...g.claims.slice(0, 3)];
  g.round++;
  g.code = code(4);
  g.live = false;
  g.claims = [];
  g.waiting = true;
  g.until = 0;
}

// ---- snake by committee ----

export const SNAKE_C = 15, SNAKE_R = 12;
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };

function snakeReset(g) {
  g.snake = [[5, 6], [4, 6], [3, 6]];
  g.dir = 'R';
  g.score = 0;
  g.over = false;
  g.overTurns = 0;
  g.tally = { U: 0, D: 0, L: 0, R: 0 };
  g.voted = {};
  g.split = null;
  g.food = snakeFood(g);
}

function snakeFood(g) {
  const free = [];
  for (let y = 0; y < SNAKE_R; y++) for (let x = 0; x < SNAKE_C; x++) if (!g.snake.some(([a, b]) => a === x && b === y)) free.push([x, y]);
  return free[Math.floor(Math.random() * free.length)] || [0, 0];
}

function snakeStep(room, g) {
  const votes = g.tally.U + g.tally.D + g.tally.L + g.tally.R;
  let pick = g.dir;
  if (votes) {
    const order = Object.entries(g.tally).sort((a, b) => b[1] - a[1]);
    const winner = order.find(([d, n]) => n === order[0][1] && d !== OPP[g.dir]);
    if (winner && winner[1] === order[0][1]) pick = winner[0];
  }
  g.split = { ...g.tally, pick };
  g.dir = pick;
  const [hx, hy] = g.snake[0], [dx, dy] = DIRS[pick];
  const nx = hx + dx, ny = hy + dy;
  const hit = nx < 0 || ny < 0 || nx >= SNAKE_C || ny >= SNAKE_R || g.snake.slice(0, -1).some(([a, b]) => a === nx && b === ny);
  const winners = Object.keys(g.voted).filter(p => g.voted[p] === pick);
  if (hit) {
    g.over = true;
    g.overTurns = 0;
  } else {
    g.snake.unshift([nx, ny]);
    if (nx === g.food[0] && ny === g.food[1]) {
      g.score++;
      g.best = Math.max(g.best, g.score);
      g.food = snakeFood(g);
      winners.forEach(p => addScore(room, p, 5));
    } else g.snake.pop();
    winners.forEach(p => addScore(room, p, 1));
  }
  g.turn++;
  g.tally = { U: 0, D: 0, L: 0, R: 0 };
  g.voted = {};
}

const TICK = {
  pixel(room, g, now) {
    if (now - g.promptAt >= room.cfg.pixel.promptMin * 60_000) {
      g.prompt = (g.prompt + 1) % PIXEL_PROMPTS.length;
      g.promptAt = now;
      return true;
    }
    return false;
  },
  hill(room, g, now) {
    if (now < g.until) return false;
    const c = room.cfg.hill;
    if (g.phase === 'answer') {
      if (g.subs.length < 1) { g.until = now + c.answerS * 1000; return false; }
      g.phase = 'vote';
      g.votes = {};
      g.until = now + c.voteS * 1000;
    } else if (g.phase === 'vote') {
      hillEndVote(room, g);
      g.phase = 'result';
      g.until = now + c.resultS * 1000;
    } else {
      g.phase = 'answer';
      g.round++;
      g.prompt++;
      g.subs = [];
      g.votes = {};
      g.result = null;
      g.until = now + c.answerS * 1000;
    }
    return true;
  },
  snipe(room, g, now, badge) {
    if (g.round === 0) { snipeNext(room, g, now); return true; }
    // The code goes live only once the badge has finished drawing it, so nobody sees it early.
    if (g.waiting && badge && badge.shownKey === `snipe.${room.epoch}.${g.round}`) {
      g.waiting = false;
      g.live = true;
      g.liveAt = now;
      g.until = now + room.cfg.snipe.holdS * 1000;
      return true;
    }
    if (g.live && now >= g.until) { snipeNext(room, g, now); return true; }
    return false;
  },
  snake(room, g, now) {
    if (now < g.until) return false;
    if (g.over) {
      g.overTurns++;
      if (g.overTurns >= 2) snakeReset(g);
    } else snakeStep(room, g);
    g.until = now + room.cfg.snake.turnS * 1000;
    return true;
  },
};

export function snakeLopsided(room, now) {
  const g = room.g, t = g.tally, n = t.U + t.D + t.L + t.R;
  // A clear majority ends the turn early, but never sooner than the badge can show it.
  return n >= 3 && Math.max(t.U, t.D, t.L, t.R) / n >= 0.8 && g.until - now > 2500;
}

// ---- what the phones see ----

export function view(room, now, players, badge) {
  const g = room.g;
  const base = { v: PROTOCOL, kind: room.kind, epoch: room.epoch, players, top: top(room, 5) };
  if (!g) return base;
  const left = g.until ? Math.max(0, g.until - now) : 0;
  switch (room.kind) {
    case 'pixel':
      return { ...base, cells: g.cells, shown: g.shown, prompt: PIXEL_PROMPTS[g.prompt], painters: Object.keys(g.painters).length, last: g.last,
        nextBadgeMs: badge && badge.nextMs != null ? badge.nextMs : null };
    case 'hill':
      return { ...base, phase: g.phase, round: g.round, left, q: HILL_PROMPTS[(g.prompt - 1) % HILL_PROMPTS.length].q,
        champ: { text: g.champ.text, q: g.champ.q, name: g.champ.name, held: g.champ.held }, subs: g.subs.length,
        result: g.result };
    case 'snipe':
      return { ...base, round: g.round, live: g.live, waiting: g.waiting, left, claims: g.claims.slice(0, 5).map(c => [c.name, c.ms, c.pts]), best: g.best.map(c => [c.name, c.ms]) };
    case 'snake':
      return { ...base, snake: g.snake, food: g.food, dir: g.dir, score: g.score, best: g.best, turn: g.turn, left, tally: g.tally, split: g.split, over: g.over };
    default:
      return base;
  }
}

// What decides whether the badge needs a new frame. Fast moving numbers stay out of it.
export function badgeKey(room) {
  const g = room.g;
  if (!g) return 'none';
  switch (room.kind) {
    case 'pixel': return `pixel.${g.cells}.${g.prompt}`;
    case 'hill': return `hill.${g.round}.${g.phase}.${g.champ.text}.${g.champ.held}`;
    case 'snipe': return `snipe.${room.epoch}.${g.round}`;
    case 'snake': return `snake.${g.turn}.${g.over}.${g.score}`;
    default: return 'none';
  }
}

// ---- drawing the badge frame ----
// Black and white only: fast refresh has no red, and red would come out black anyway.

const INK = '#000', PAPER = '#fff';
const DISPLAY = '"Permanent Marker", "Arial Black", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export async function loadFonts() {
  try {
    await Promise.all([document.fonts.load(`80px ${DISPLAY}`), document.fonts.load(`700 30px ${MONO}`)]);
  } catch (e) { /* a missing font falls back to the system face */ }
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// Largest size at which the text fits the box, wrapped.
function fit(ctx, text, font, box, start, lead = 1.08) {
  for (let size = start; size >= 14; size -= 2) {
    ctx.font = font.replace('{}', size);
    const lines = wrap(ctx, text, box.w);
    if (lines.length * size * lead <= box.h && lines.every(l => ctx.measureText(l).width <= box.w)) return { size, lines };
  }
  ctx.font = font.replace('{}', 14);
  return { size: 14, lines: wrap(ctx, text, box.w) };
}

function block(ctx, text, font, box, start, { align = 'left', valign = 'top', color = INK, lead = 1.08 } = {}) {
  const { size, lines } = fit(ctx, text, font, box, start, lead);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  const totalH = lines.length * size * lead;
  let y = box.y + (valign === 'middle' ? (box.h - totalH) / 2 : valign === 'bottom' ? box.h - totalH : 0);
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  for (const l of lines) { ctx.fillText(l, x, y); y += size * lead; }
  ctx.textAlign = 'left';
  return size;
}

function label(ctx, text, x, y, size = 22, color = INK) {
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

export function drawQR(ctx, text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, m = Math.floor(size / (n + quiet * 2));
  const real = m * (n + quiet * 2);
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, real, real);
  ctx.fillStyle = INK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * m, y + (r + quiet) * m, m, m);
  return real;
}

function joinBox(ctx, url, roomCode, x, y, size) {
  const s = drawQR(ctx, url, x, y, size);
  label(ctx, 'scan to play', x + 8, y + s + 6, 22);
  label(ctx, `room ${roomCode}`, x + 8, y + s + 34, 22);
}

export function drawBadge(ctx, room, url, roomCode, now) {
  const g = room.g;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  if (!g) return;
  DRAW[room.kind](ctx, room, g, url, roomCode, now);
}

const DRAW = {
  pixel(ctx, room, g, url, roomCode) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, 104);
    block(ctx, PIXEL_PROMPTS[g.prompt], `{}px ${DISPLAY}`, { x: 20, y: 12, w: 700, h: 84 }, 76, { color: PAPER, valign: 'middle' });
    label(ctx, `${Object.keys(g.painters).length} painters`, 744, 40, 26, PAPER);
    const cell = 21, ox = 12, oy = 116;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(ox - 3, oy - 3, PIX_C * cell + 6, PIX_R * cell + 6);
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] === '0') continue;
      ctx.fillStyle = INK;
      ctx.fillRect(ox + (i % PIX_C) * cell, oy + Math.floor(i / PIX_C) * cell, cell, cell);
    }
    joinBox(ctx, url, roomCode, 778, 120, 176);
    label(ctx, 'paint with', 790, 400, 22);
    label(ctx, 'your phone', 790, 428, 22);
    if (g.last.length) {
      label(ctx, 'latest', 790, 488, 20);
      g.last.slice(0, 3).forEach((n, i) => label(ctx, n.slice(0, 11), 790, 514 + i * 28, 20));
    }
  },
  hill(ctx, room, g, url, roomCode) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, 120);
    block(ctx, g.champ.q, `700 {}px ${MONO}`, { x: 24, y: 14, w: 912, h: 92 }, 38, { color: PAPER, valign: 'middle' });
    block(ctx, g.champ.text, `{}px ${DISPLAY}`, { x: 28, y: 146, w: 680, h: 330 }, 120, { valign: 'middle', lead: 1.05 });
    const held = g.champ.held ? `, held ${g.champ.held} round${g.champ.held === 1 ? '' : 's'}` : '';
    label(ctx, `by ${g.champ.name}${held}`.slice(0, 44), 28, 500, 28);
    const word = g.phase === 'answer' ? 'answer now' : g.phase === 'vote' ? 'vote now' : g.result && g.result.took ? 'new champion' : 'it held';
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.strokeRect(24, 566, 470, 86);
    block(ctx, word, `{}px ${DISPLAY}`, { x: 40, y: 574, w: 440, h: 70 }, 64, { valign: 'middle' });
    joinBox(ctx, url, roomCode, 744, 360, 200);
    label(ctx, 'take the hill.', 520, 600, 24);
  },
  snipe(ctx, room, g, url, roomCode) {
    const target = `${url}.${g.code}`;
    const s = drawQR(ctx, target, 20, 20, 480);
    label(ctx, `round ${g.round}`, 28, s + 32, 30);
    ctx.fillStyle = INK;
    ctx.fillRect(540, 20, 400, 200);
    block(ctx, g.code, `{}px ${MONO}`.replace('{}px', '700 {}px'), { x: 560, y: 40, w: 360, h: 160 }, 150, { color: PAPER, align: 'center', valign: 'middle' });
    label(ctx, 'scan it or type it.', 548, 236, 26);
    label(ctx, 'first claim scores 100.', 548, 270, 26);
    label(ctx, 'last round', 548, 340, 24);
    const best = g.best.length ? g.best : [];
    if (!best.length) label(ctx, 'nobody yet', 548, 376, 28);
    best.forEach((c, i) => label(ctx, `${i + 1}. ${c.name.slice(0, 12)} ${(c.ms / 1000).toFixed(1)}s`, 548, 376 + i * 40, 28));
    block(ctx, 'flash snipe', `{}px ${DISPLAY}`, { x: 548, y: 520, w: 392, h: 120 }, 72, { valign: 'bottom' });
  },
  snake(ctx, room, g, url, roomCode) {
    const cell = 46, ox = 12, oy = 12;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeRect(ox - 4, oy - 4, SNAKE_C * cell + 8, SNAKE_R * cell + 8);
    for (let x = 0; x < SNAKE_C; x++) for (let y = 0; y < SNAKE_R; y++) {
      ctx.fillStyle = INK;
      ctx.fillRect(ox + x * cell + cell / 2 - 2, oy + y * cell + cell / 2 - 2, 4, 4);
    }
    g.snake.forEach(([x, y], i) => {
      ctx.fillStyle = INK;
      ctx.fillRect(ox + x * cell + 3, oy + y * cell + 3, cell - 6, cell - 6);
      if (i === 0) { ctx.fillStyle = PAPER; ctx.fillRect(ox + x * cell + 15, oy + y * cell + 15, 16, 16); }
    });
    const [fx, fy] = g.food;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ox + fx * cell + cell / 2, oy + fy * cell + cell / 2, cell / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    const rx = 726;
    if (g.over) block(ctx, 'game over', `{}px ${DISPLAY}`, { x: rx, y: 12, w: 224, h: 120 }, 60, { lead: 1 });
    else {
      label(ctx, 'score', rx, 16, 22);
      block(ctx, String(g.score), `700 {}px ${MONO}`, { x: rx, y: 42, w: 224, h: 80 }, 76);
    }
    label(ctx, `best ${g.best}`, rx, 132, 22);
    label(ctx, `turn ${g.turn}`, rx, 160, 22);
    if (g.split) {
      const n = g.split.U + g.split.D + g.split.L + g.split.R;
      label(ctx, n ? `last vote, ${n}` : 'no votes', rx, 200, 20);
      const names = { U: 'up', D: 'down', L: 'left', R: 'right' };
      ['U', 'D', 'L', 'R'].forEach((d, i) => label(ctx, `${g.split.pick === d ? '>' : ' '} ${names[d]} ${g.split[d]}`, rx, 226 + i * 26, 20));
    }
    joinBox(ctx, url, roomCode, rx, 344, 210);
  },
};

// Black plane then red plane, 120 bytes a row, leftmost pixel in the top bit, as the firmware stores them.
export function toPlanes(ctx) {
  const d = ctx.getImageData(0, 0, W, H).data, ROW = W / 8;
  const out = new Uint8Array(ROW * H * 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 384) out[y * ROW + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}
