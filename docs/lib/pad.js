// Controller parts for phone pages, laid out like the console they stand for. Every part holds
// with pointer capture, so a thumb that drifts off a key keeps it held until it lifts.
import { h } from './phone-kit.js';

const GLYPH = { up: '↑', down: '↓', left: '←', right: '→' };

function buzz() { if (navigator.vibrate) navigator.vibrate(7); }

// One key. on(true) when pressed, on(false) when let go.
export function key(label, on, cls = '', aria = label) {
  const k = h(`div.key${cls ? `.${cls.split(' ').join('.')}` : ''}`, { role: 'button', 'aria-label': aria }, label);
  let pid = null;
  k.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (pid !== null) return;
    pid = e.pointerId;
    try { k.setPointerCapture(pid); } catch (err) { /* an old browser holds without capture */ }
    k.classList.add('down');
    buzz();
    on(true);
  });
  const up = () => { if (pid === null) return; pid = null; k.classList.remove('down'); on(false); };
  k.addEventListener('pointerup', up);
  k.addEventListener('pointercancel', up);
  k.addEventListener('contextmenu', e => e.preventDefault());
  return k;
}

// A d-pad you can slide a thumb around: the position picks the directions, diagonals included.
// onDir(direction, held) fires on every change.
export function dpad(onDir) {
  const wrap = h('div.dpad', { role: 'group', 'aria-label': 'directions' });
  const cells = {};
  const at = { 2: 'up', 4: 'left', 6: 'right', 8: 'down' };
  for (let c = 1; c <= 9; c++) {
    const d = at[c];
    if (d) { cells[d] = h('div.key', { 'aria-label': d }, GLYPH[d]); wrap.append(cells[d]); } else wrap.append(h(c === 5 ? 'div.hub' : 'div'));
  }
  const held = { up: false, down: false, left: false, right: false };
  const set = (d, on) => { if (held[d] === on) return; held[d] = on; cells[d].classList.toggle('down', on); if (on) buzz(); onDir(d, on); };
  const read = e => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2), t = 0.28;
    set('up', y < -t); set('down', y > t); set('left', x < -t); set('right', x > t);
  };
  let pid = null;
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); pid = e.pointerId; try { wrap.setPointerCapture(pid); } catch (err) { /* see key() */ } read(e); });
  wrap.addEventListener('pointermove', e => { if (pid === e.pointerId) read(e); });
  const rel = () => { pid = null; Object.keys(held).forEach(d => set(d, false)); };
  wrap.addEventListener('pointerup', rel);
  wrap.addEventListener('pointercancel', rel);
  wrap.addEventListener('contextmenu', e => e.preventDefault());
  return { el: wrap, cells };
}

// An analog stick. onMove(x, y) with each in -1 to 1, y down, and 0, 0 when let go.
export function stick(onMove) {
  const nub = h('div.nub');
  const wrap = h('div.stick', { role: 'group', 'aria-label': 'analog stick' }, nub);
  let pid = null;
  const set = e => {
    const r = wrap.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    nub.style.transform = `translate(calc(-50% + ${x * 50}%), calc(-50% + ${y * 50}%))`;
    onMove(x, y);
  };
  const rel = () => { pid = null; nub.style.transform = ''; onMove(0, 0); };
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); pid = e.pointerId; try { wrap.setPointerCapture(pid); } catch (err) { /* see key() */ } set(e); });
  wrap.addEventListener('pointermove', e => { if (pid === e.pointerId) set(e); });
  wrap.addEventListener('pointerup', rel);
  wrap.addEventListener('pointercancel', rel);
  return wrap;
}
