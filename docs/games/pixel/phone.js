import { h, timers, coalesced } from '../../lib/phone-kit.js';
import { COLS, ROWS } from './rules.js';

const HOLD_MS = 5000;

export function mount(root, api) {
  const t = timers();
  const prompt = h('b');
  const painters = h('span.small');
  const canvas = h('canvas.figure.draw', { width: 720, height: 480, 'aria-label': 'the shared canvas. drag to paint.' });
  const c = canvas.getContext('2d');
  const colors = [['1', 'black', '#000', '#fff'], ['2', 'red', '#d0021b', '#fff'], ['0', 'eraser', '#fff', '#000']]
    .map(([v, label, bg, fg]) => h('button.btn.swatch', { 'aria-pressed': String(v === '1'), style: { background: bg, color: fg }, onclick: () => pick(v) }, label));
  const inkText = h('span');
  const inkFill = h('i');
  const shownBtn = h('button.btn', { 'aria-pressed': 'false', onclick: toggleShown }, 'show what the badge shows');
  root.append(h('div.split', {}, prompt, painters), canvas, h('div.tools', {}, ...colors),
    h('div', {}, h('div.split.small', {}, h('span', {}, 'ink'), inkText), h('div.meter', { 'aria-hidden': 'true' }, inkFill)),
    shownBtn, h('p.prose', {}, 'the badge reprints the canvas about every 6 s while people paint. red prints black on the badge.'));

  let view = null, you = null, lastYou = null, youAt = 0, color = '1', pending = new Map(), sent = new Map(), showShown = false, painting = false, last = null, warned = false;

  function pick(v) { color = v; colors.forEach(b => b.setAttribute('aria-pressed', String(b.textContent === { 1: 'black', 2: 'red', 0: 'eraser' }[v]))); }
  function toggleShown() {
    showShown = !showShown;
    shownBtn.setAttribute('aria-pressed', String(showShown));
    shownBtn.textContent = showShown ? 'back to the live canvas' : 'show what the badge shows';
    paint();
  }

  function inkNow() {
    if (!you || !you.inkMax) return 0;
    let n = you.ink, next = you.nextMs - (Date.now() - youAt);
    while (next <= 0 && n < you.inkMax) { n++; next += you.everyMs; }
    return Math.max(0, n - pending.size);
  }

  // What this phone shows for a cell: an unsent stroke, then a sent one the host has not echoed.
  function cellAt(i, now) {
    if (pending.has(i)) return pending.get(i);
    const s = sent.get(i);
    if (s) { if (view.cells[i] === s.c || now - s.at > HOLD_MS) sent.delete(i); else return s.c; }
    return view.cells[i];
  }

  function paint() {
    if (!view) return;
    const cw = canvas.width / COLS, ch = canvas.height / ROWS, now = Date.now();
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < COLS * ROWS; i++) {
      const v = showShown ? view.shown[i] : cellAt(i, now);
      if (v === '0') continue;
      c.fillStyle = v === '2' && !showShown ? '#d0021b' : '#000';
      c.fillRect(Math.floor((i % COLS) * cw), Math.floor(Math.floor(i / COLS) * ch), Math.ceil(cw), Math.ceil(ch));
    }
    c.strokeStyle = 'rgba(0,0,0,.1)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 1; x < COLS; x++) { c.moveTo(Math.round(x * cw) + 0.5, 0); c.lineTo(Math.round(x * cw) + 0.5, canvas.height); }
    for (let y = 1; y < ROWS; y++) { c.moveTo(0, Math.round(y * ch) + 0.5); c.lineTo(canvas.width, Math.round(y * ch) + 0.5); }
    c.stroke();
  }

  function cellOf(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(COLS - 1, Math.floor(((e.clientX - r.left) / r.width) * COLS))),
      Math.max(0, Math.min(ROWS - 1, Math.floor(((e.clientY - r.top) / r.height) * ROWS)))];
  }

  function paintCell(x, y) {
    const i = y * COLS + x;
    if (cellAt(i, Date.now()) === color) return true;
    if (inkNow() <= 0) { if (!warned) { warned = true; api.note('out of ink. it refills by itself.', true); } return false; }
    pending.set(i, color);
    return true;
  }

  // A finger jumps several cells between events, so every cell on the line between gets paint.
  function paintTo(e) {
    if (!view || showShown) return;
    const [x1, y1] = cellOf(e);
    let [x0, y0] = last || [x1, y1];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!paintCell(x0, y0) || (x0 === x1 && y0 === y1)) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    last = [x1, y1];
    paint();
  }

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); painting = true; last = null; warned = false; canvas.setPointerCapture(e.pointerId); paintTo(e); });
  canvas.addEventListener('pointermove', e => { if (painting) for (const ev of coalesced(e)) paintTo(ev); });
  const end = () => { painting = false; last = null; flush(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function flush() {
    if (!pending.size) return;
    const p = [...pending].map(([i, v]) => [i % COLS, Math.floor(i / COLS), Number(v)]);
    if (api.send('paint', { p })) {
      const now = Date.now();
      for (const [i, v] of pending) sent.set(i, { c: v, at: now });
      if (you) you.ink = Math.max(0, you.ink - pending.size);
    }
    pending.clear();
    paint();
  }

  t.every(250, () => { if (painting) flush(); });
  t.every(500, () => {
    const max = you && you.inkMax, n = inkNow();
    inkText.textContent = max ? `${n} of ${max}` : '';
    inkFill.style.width = max ? `${(100 * n) / max}%` : '0';
  });
  return {
    update(v, y) {
      view = v;
      if (y && y !== lastYou) { lastYou = y; you = { ...y }; youAt = Date.now(); }
      prompt.textContent = v.prompt;
      painters.textContent = `${v.painters} painted`;
      paint();
    },
    destroy: () => t.stop(),
  };
}
