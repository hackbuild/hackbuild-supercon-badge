import { h, timers, canvasPoint, coalesced } from '../../lib/phone-kit.js';
import { W, H } from '../../lib/screen.js';
import { drawStroke, strokeLength } from './strokes.js';
import { applyBatch } from './screen.js';

const FLUSH_MS = 250;
const MIN_STEP = 5;

export function mount(root, api) {
  const t = timers();
  const prompt = h('b');
  const who = h('span.small');
  const canvas = h('canvas.figure.draw', { width: W, height: H, 'aria-label': 'the shared page. drag to draw.' });
  const c = canvas.getContext('2d');
  const sizes = ['fine', 'medium', 'thick'].map((label, i) => h('button.btn', { 'aria-pressed': String(i === 1), onclick: () => pickSize(i) }, label));
  const pen = h('button.btn', { 'aria-pressed': 'true', onclick: () => pickColor(1) }, 'ink');
  const eraser = h('button.btn', { 'aria-pressed': 'false', onclick: () => pickColor(0) }, 'eraser');
  const inkText = h('span');
  const inkFill = h('i');
  const page = h('p.prose');
  root.append(h('div.split', {}, prompt, who), canvas,
    h('div.tools', {}, ...sizes, pen, eraser),
    h('div', {}, h('div.split.small', {}, h('span', {}, 'ink'), inkText), h('div.meter', { 'aria-hidden': 'true' }, inkFill)),
    page);
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);

  // The snapshot is a small picture, so it is only used to catch up: on joining and on a new page.
  let view = null, you = null, youAt = Date.now(), size = 1, color = 1, stroke = null, outbox = [], spent = 0, needSnap = true;

  function pickSize(i) { size = i; sizes.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); }
  function pickColor(v) { color = v; pen.setAttribute('aria-pressed', String(v === 1)); eraser.setAttribute('aria-pressed', String(v === 0)); }

  function inkLeft() {
    if (!you || !you.inkMax) return 0;
    return Math.max(0, Math.min(you.inkMax, you.ink + ((Date.now() - youAt) / 1000) * you.inkPerS) - spent);
  }

  function point(e) {
    const [x, y] = canvasPoint(canvas, e);
    return [Math.round(Math.max(0, Math.min(W - 1, x))), Math.round(Math.max(0, Math.min(H - 1, y)))];
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!view) return;
    canvas.setPointerCapture(e.pointerId);
    stroke = { size, color, pts: point(e) };
    drawStroke(c, stroke);
  });
  canvas.addEventListener('pointermove', e => {
    if (!stroke) return;
    for (const ev of coalesced(e)) {
      const [x, y] = point(ev), n = stroke.pts.length;
      if (Math.hypot(x - stroke.pts[n - 2], y - stroke.pts[n - 1]) < MIN_STEP) continue;
      const seg = { size, color, pts: [stroke.pts[n - 2], stroke.pts[n - 1], x, y] };
      if (strokeLength(seg) > inkLeft()) { api.note('out of ink for a moment. it refills fast.', true); continue; }
      stroke.pts.push(x, y);
      drawStroke(c, seg);
      if (stroke.pts.length >= 60) cut();
    }
  });
  const end = () => { if (stroke) cut(true); stroke = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // Long strokes go out in pieces, so others see a line grow instead of appearing at once.
  function cut(last = false) {
    const st = stroke;
    spent += strokeLength(st);
    outbox.push(`${st.size},${st.color},${st.pts.join(',')}`);
    const n = st.pts.length;
    stroke = last ? null : { size: st.size, color: st.color, pts: [st.pts[n - 2], st.pts[n - 1]] };
  }

  function flush() {
    if (stroke && stroke.pts.length >= 4) cut();
    if (!outbox.length || !view) return;
    api.send('ink', { p: view.page, st: outbox.splice(0, 24) });
  }

  const stopLive = api.live(batch => {
    applyBatch(c, batch);
  });
  const stopSnap = api.media('ink', url => {
    if (!url || !needSnap) return;
    needSnap = false;
    const img = new Image();
    img.onload = () => c.drawImage(img, 0, 0, W, H);
    img.src = url;
  });

  t.every(FLUSH_MS, flush);
  t.every(400, () => {
    const left = inkLeft(), max = you && you.inkMax;
    inkText.textContent = max ? `${Math.floor((100 * left) / max)}%` : '';
    inkFill.style.width = max ? `${(100 * left) / max}%` : '0';
  });
  return {
    update(v, y) {
      if (view && v.page !== view.page) { c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); outbox = []; needSnap = true; }
      view = v;
      if (y && y !== you) { you = y; youAt = Date.now(); spent = 0; }
      prompt.textContent = v.prompt;
      who.textContent = `${v.painters} drawing`;
      page.textContent = `page ${v.page}, ${v.coverage}% covered. a new page starts at ${v.fullAt}%. the badge shows strokes about a second after you draw.`;
    },
    destroy() { t.stop(); stopLive(); stopSnap(); },
  };
}
