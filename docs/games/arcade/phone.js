import { h } from '../../lib/phone-kit.js';
import { CONSOLES, DIRS } from './consoles.js';

// A press shorter than this still reaches the host: the relay keeps only the newest mask.
const MIN_HOLD_MS = 70;
const ARROWS = { up: '^', down: 'v', left: '<', right: '>' };

export function mount(root, api) {
  const head = h('p.big');
  const seat = h('p.kicker');
  const pad = h('div.pad', { role: 'group', 'aria-label': 'directions' });
  const keys = h('div.keys', { role: 'group', 'aria-label': 'buttons' });
  root.append(head, seat, pad, keys, h('p.small', {}, 'hold a button as long as you want it held. the projector shows the game live; the badge catches up about every two seconds.'));

  let view = null, core = '', mask = 0, sent = -1;
  const downAt = new Map();

  function send() {
    if (mask === sent) return;
    if (api.send('pad', { m: mask })) sent = mask;
  }

  function hold(bit, on) {
    if (on) { downAt.set(bit, Date.now()); mask |= 1 << bit; send(); return; }
    const wait = MIN_HOLD_MS - (Date.now() - (downAt.get(bit) || 0));
    const up = () => { mask &= ~(1 << bit); send(); };
    if (wait > 0) setTimeout(up, wait); else up();
  }

  function key(bit, label, aria) {
    const b = h('button', { type: 'button', 'aria-label': aria || label }, label);
    const on = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.setAttribute('aria-pressed', 'true'); hold(bit, true); };
    const off = () => { if (b.getAttribute('aria-pressed') !== 'true') return; b.setAttribute('aria-pressed', 'false'); hold(bit, false); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('lostpointercapture', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  }

  function build() {
    const c = CONSOLES[core];
    pad.replaceChildren(...[null, 0, null, 2, null, 3, null, 1, null].map(i => (i === null ? h('span') : key(i, ARROWS[DIRS[i]], DIRS[i]))));
    keys.replaceChildren(...c.buttons.map(([label], i) => key(4 + i, label)));
  }

  function draw() {
    if (!view) return;
    head.textContent = view.rom ? view.rom.name : 'waiting for the host to load a game';
    pad.hidden = keys.hidden = !view.rom;
    if (view.rom && view.rom.core !== core && CONSOLES[view.rom.core]) { core = view.rom.core; mask = 0; sent = -1; build(); }
  }

  const release = () => { if (mask) { mask = 0; send(); } };
  document.addEventListener('visibilitychange', release);
  return {
    update(v, y) {
      view = v;
      seat.textContent = y && y.seat ? `you are player ${y.seat}` : view.seats > 1 ? 'press anything to get a player' : 'everyone shares one controller';
      draw();
    },
    destroy() { release(); document.removeEventListener('visibilitychange', release); },
  };
}
