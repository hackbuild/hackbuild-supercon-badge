import { h, seconds, timers } from '../../lib/phone-kit.js';
import { board } from './screen.js';

const ARROWS = { U: '^', D: 'v', L: '<', R: '>' };
const NAMES = { U: 'up', D: 'down', L: 'left', R: 'right' };

export function mount(root, api) {
  const t = timers();
  const score = h('b');
  const timer = h('span.timer');
  const canvas = h('canvas.figure', { width: 600, height: 480, 'aria-label': 'the snake board' });
  const c = canvas.getContext('2d');
  const pads = {};
  const pad = h('div.pad', { role: 'group', 'aria-label': 'vote a direction' });
  for (const d of [null, 'U', null, 'L', null, 'R', null, 'D', null]) {
    if (!d) { pad.append(h('span')); continue; }
    pads[d] = h('button', { 'aria-label': NAMES[d], 'aria-pressed': 'false', onclick: () => vote(d) }, ARROWS[d]);
    pad.append(pads[d]);
  }
  const bars = h('div.bars');
  root.append(h('div.split', {}, score, timer), canvas, pad, bars);

  let view = null, you = null, mine = '';

  function vote(d) {
    if (!view || view.over) return;
    if (api.send('dir', { turn: view.turn, d })) { mine = d; paintPad(); }
  }

  function paintPad() {
    const chosen = you && you.turn === view.turn && you.d ? you.d : mine;
    for (const [d, b] of Object.entries(pads)) { b.setAttribute('aria-pressed', String(d === chosen)); b.disabled = view.over; }
  }

  function draw() {
    if (!view) return;
    score.textContent = view.over ? 'game over' : `score ${view.score}, best ${view.best}`;
    timer.textContent = seconds(api.left(view));
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    board(c, view, { x: 6, y: 6, w: canvas.width - 12, h: canvas.height - 12 }, { ink: '#000', paper: '#fff', red: '#d0021b' });
    paintPad();
    const tl = view.tally, n = tl.U + tl.D + tl.L + tl.R;
    bars.replaceChildren(...['U', 'D', 'L', 'R'].map(d => h('div', {}, h('span', {}, NAMES[d]), h('i', { style: { width: `${n ? (100 * tl[d]) / n : 0}%` } }), h('b', {}, String(tl[d])))));
  }

  t.every(500, () => { if (view) timer.textContent = seconds(api.left(view)); });
  return {
    update(v, y) {
      // A vote carries into the next turn until it changes, so the snake keeps going where you point.
      if (view && v.turn !== view.turn && mine && !v.over) api.send('dir', { turn: v.turn, d: mine });
      if (v.over) mine = '';
      view = v;
      you = y;
      draw();
    },
    destroy: () => t.stop(),
  };
}
