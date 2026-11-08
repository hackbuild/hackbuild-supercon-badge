import { h } from '../../lib/phone-kit.js';
import { key, dpad, stick } from '../../lib/pad.js';
import { CONSOLES, DIRS, buttons } from './consoles.js';

// A press shorter than this still reaches the host: the relay keeps only the newest input.
const MIN_HOLD_MS = 70;
const STICK_EVERY_MS = 40;

export function mount(root, api) {
  const head = h('p.big');
  const seat = h('p.kicker');
  const pad = h('div.controller');
  root.append(h('div.split', {}, head, seat), pad, h('p.small', {}, 'the projector shows the game live. the badge catches up every couple of seconds.'));

  let view = null, core = '', mask = 0, x = 0, y = 0, sentKey = '', stickAt = 0, stickTimer = 0;
  const downAt = new Map();

  function send() {
    const k = `${mask}.${x}.${y}`;
    if (k === sentKey) return;
    if (api.send('pad', { m: mask, x, y })) sentKey = k;
  }

  function hold(bit, on) {
    if (on) { downAt.set(bit, Date.now()); mask |= 1 << bit; send(); return; }
    const wait = MIN_HOLD_MS - (Date.now() - (downAt.get(bit) || 0));
    const up = () => { mask &= ~(1 << bit); send(); };
    if (wait > 0) setTimeout(up, wait); else up();
  }

  function move(nx, ny) {
    x = Math.round(nx * 100);
    y = Math.round(ny * 100);
    clearTimeout(stickTimer);
    const wait = STICK_EVERY_MS - (Date.now() - stickAt);
    // Let go always goes out at once, so the stick never sticks.
    if (wait <= 0 || (!x && !y)) { stickAt = Date.now(); send(); } else stickTimer = setTimeout(() => { stickAt = Date.now(); send(); }, wait);
  }

  function build() {
    const c = CONSOLES[core], list = buttons(core);
    const bitOf = b => 4 + list.indexOf(b);
    const k = (b, cls) => key(b.l, on => hold(bitOf(b), on), `${cls}${b.c ? ` tint c-${b.c}` : ''}${b.p ? ` ${b.p}` : ''}`);
    const parts = [];
    if (c.sh) {
      const L = h('div.sh-grp'), C = h('div.sh-grp'), R = h('div.sh-grp');
      c.sh.forEach(b => (/^l/.test(b.l) ? L : /^r/.test(b.l) ? R : C).append(k(b, 'bumper')));
      parts.push(h('div.pad-shoulders', {}, L, C, R));
    }
    const left = h('div.cluster', {}, dpad((d, on) => hold(DIRS.indexOf(d), on)).el);
    if (c.stick) left.append(stick(move));
    const mid = h('div.cluster.mid', {}, ...(c.sys || []).map(b => k(b, 'pill')));
    const right = h('div.cluster');
    if (c.cb) right.append(h('div.cpad', {}, h('div'), k(c.cb[0], 'round'), h('div'), k(c.cb[2], 'round'), h('div.clabel', {}, 'c'), k(c.cb[3], 'round'), h('div'), k(c.cb[1], 'round'), h('div')));
    if (c.face6) right.append(h('div.face6', {}, h('div.row6', {}, ...c.face6.slice(0, 3).map(b => k(b, 'round'))), h('div.row6', {}, ...c.face6.slice(3).map(b => k(b, 'round')))));
    else if (c.face4) right.append(h('div.face', {}, ...c.face4.map(b => k(b, 'round'))));
    else if (c.abdiag) right.append(h('div.abdiag', {}, k(c.abdiag[0], 'round b'), k(c.abdiag[1], 'round a')));
    else if (c.face) right.append(h('div.facerow', {}, ...c.face.map(b => k(b, 'round'))));
    parts.push(h('div.pad-body', {}, left, mid, right));
    pad.replaceChildren(...parts);
  }

  function draw() {
    if (!view) return;
    head.textContent = view.rom ? view.rom.name : 'waiting for a game';
    pad.hidden = !view.rom;
    if (view.rom && view.rom.core !== core && CONSOLES[view.rom.core]) { core = view.rom.core; mask = 0; x = y = 0; sentKey = ''; build(); }
  }

  const release = () => { if (mask || x || y) { mask = 0; x = y = 0; send(); } };
  document.addEventListener('visibilitychange', release);
  return {
    update(v, yv) {
      view = v;
      seat.textContent = yv && yv.seat ? `player ${yv.seat}` : view.seats > 1 ? 'press anything to get a player' : 'everyone shares one controller';
      draw();
    },
    destroy() { release(); clearTimeout(stickTimer); document.removeEventListener('visibilitychange', release); },
  };
}
