import { h, seconds, timers, coalesced } from '../../lib/phone-kit.js';
import { packBits, unpackBits } from '../../lib/screen.js';
import { COLS, ROWS } from './rules.js';

export function mount(root, api) {
  const t = timers();
  const player = h('canvas.figure', { width: COLS * 10, height: ROWS * 10, 'aria-label': 'the latest premiere, looping' });
  const pc = player.getContext('2d');
  const playing = h('p.small');
  const grab = h('button.btn.go', { onclick: () => api.send('claim', {}) }, 'draw a frame');
  const waitText = h('p.prose');
  const idle = h('div.stack', {}, grab, waitText);
  const task = h('p.q');
  const timer = h('span.timer');
  const pad = h('canvas.figure.draw', { width: COLS * 15, height: ROWS * 15, 'aria-label': 'your frame. drag to draw. the faint lines are the frame before yours.' });
  const c = pad.getContext('2d');
  const pen = h('button.btn', { 'aria-pressed': 'true', onclick: () => pick(1) }, 'pen');
  const eraser = h('button.btn', { 'aria-pressed': 'false', onclick: () => pick(0) }, 'eraser');
  const wipe = h('button.btn', { onclick: () => { cells.fill(0); paint(); } }, 'clear');
  const send = h('button.btn.go', { onclick: submit }, 'send my frame');
  const drawing = h('div.stack', { hidden: true }, h('div.split', {}, task, timer), pad, h('div.tools', {}, pen, eraser, wipe), send,
    h('p.prose', {}, 'the faint drawing is the frame before yours. move things a little and it animates.'));
  root.append(player, playing, idle, drawing);

  let view = null, you = null, cells = new Uint8Array(COLS * ROWS), under = new Uint8Array(COLS * ROWS), ink = 1, held = '', down = false, last = null, tick = 0, gotAt = 0;

  function pick(v) { ink = v; pen.setAttribute('aria-pressed', String(v === 1)); eraser.setAttribute('aria-pressed', String(v === 0)); }

  function paint() {
    const cw = pad.width / COLS, ch = pad.height / ROWS;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, pad.width, pad.height);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i] && !under[i]) continue;
      c.fillStyle = cells[i] ? '#000' : 'rgba(208,2,27,.22)';
      c.fillRect((i % COLS) * cw, Math.floor(i / COLS) * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }

  function cellOf(e) {
    const r = pad.getBoundingClientRect();
    return [Math.max(0, Math.min(COLS - 1, Math.floor(((e.clientX - r.left) / r.width) * COLS))), Math.max(0, Math.min(ROWS - 1, Math.floor(((e.clientY - r.top) / r.height) * ROWS)))];
  }

  function line(e) {
    const [x1, y1] = cellOf(e);
    let [x0, y0] = last || [x1, y1];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      cells[y0 * COLS + x0] = ink;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    last = [x1, y1];
    paint();
  }

  pad.addEventListener('pointerdown', e => { e.preventDefault(); down = true; last = null; pad.setPointerCapture(e.pointerId); line(e); });
  pad.addEventListener('pointermove', e => { if (down) for (const ev of coalesced(e)) line(ev); });
  pad.addEventListener('pointerup', () => { down = false; });
  pad.addEventListener('pointercancel', () => { down = false; });

  function submit() {
    const cl = you && you.claim;
    if (!cl) return;
    if (!cells.some(Boolean)) { api.note('draw something first.', true); return; }
    if (api.send('frame', { reel: cl.reel, slot: cl.slot, bits: packBits(cells, COLS, ROWS) })) {
      api.note('frame sent. it plays when its reel is full.');
      cells = new Uint8Array(COLS * ROWS);
    }
  }

  function play() {
    const p = view && view.premiere;
    pc.fillStyle = '#fff';
    pc.fillRect(0, 0, player.width, player.height);
    if (!p || !p.frames.length) { player.hidden = true; playing.textContent = 'no reel has premiered yet. the first full reel plays here.'; return; }
    player.hidden = false;
    const f = unpackBits(p.frames[tick % p.frames.length], COLS, ROWS);
    pc.fillStyle = '#000';
    for (let i = 0; i < f.length; i++) if (f[i]) pc.fillRect((i % COLS) * 10, Math.floor(i / COLS) * 10, 10, 10);
    playing.textContent = `now playing: ${p.prompt}, by ${p.by.slice(0, 6).join(', ')}`;
  }

  function draw() {
    if (!view) return;
    const cl = you && you.claim;
    drawing.hidden = !cl;
    idle.hidden = !!cl;
    if (cl) {
      const id = `${cl.reel}.${cl.slot}`;
      if (id !== held) { held = id; gotAt = Date.now(); cells = new Uint8Array(COLS * ROWS); under = unpackBits(cl.onion, COLS, ROWS); paint(); }
      task.textContent = `${cl.prompt}, frame ${cl.slot + 1} of ${view.frames}`;
    } else {
      held = '';
      waitText.textContent = view.open.length
        ? `drawing now: ${view.open.map(r => `${r.prompt} ${r.drawn} of ${view.frames}`).join(', ')}.`
        : 'grab a frame to start the first reel.';
    }
  }

  t.every(250, () => { tick++; play(); });
  t.every(500, () => { const cl = you && you.claim; if (cl) timer.textContent = seconds(cl.left - (Date.now() - gotAt)); });
  return { update(v, y) { view = v; you = y; draw(); }, destroy: () => t.stop() };
}
