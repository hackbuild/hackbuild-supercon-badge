import * as S from '../../lib/screen.js';
import { COLS, ROWS } from './rules.js';

const NAMES = { U: 'up', D: 'down', L: 'left', R: 'right' };

export function board(c, m, box, pal) {
  const cell = Math.min(box.w / COLS, box.h / ROWS), ox = box.x, oy = box.y;
  c.strokeStyle = pal.ink;
  c.lineWidth = 4;
  c.strokeRect(ox - 4, oy - 4, COLS * cell + 8, ROWS * cell + 8);
  c.fillStyle = pal.ink;
  for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) c.fillRect(ox + x * cell + cell / 2 - 2, oy + y * cell + cell / 2 - 2, 4, 4);
  m.snake.forEach(([x, y], i) => {
    c.fillStyle = pal.ink;
    c.fillRect(ox + x * cell + 3, oy + y * cell + 3, cell - 6, cell - 6);
    if (i === 0) { c.fillStyle = pal.paper; c.fillRect(ox + x * cell + cell / 3, oy + y * cell + cell / 3, cell / 3, cell / 3); }
  });
  c.fillStyle = pal.red;
  c.beginPath();
  c.arc(ox + m.food[0] * cell + cell / 2, oy + m.food[1] * cell + cell / 2, cell / 2 - 6, 0, Math.PI * 2);
  c.fill();
}

export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  board(c, m, { x: 12, y: 12, w: 690, h: 648 }, pal);
  const rx = 726;
  if (m.over) S.text(c, 'game over', { x: rx, y: 12, w: 224, h: 120 }, { size: 60, lead: 1 });
  else { S.label(c, 'score', rx, 16, 22, pal.ink); S.text(c, String(m.score), { x: rx, y: 42, w: 224, h: 80 }, { font: `600 {}px ${S.MONO}`, size: 76 }); }
  S.label(c, `best ${m.best}`, rx, 132, 22, pal.ink);
  S.label(c, `turn ${m.turn}`, rx, 160, 22, pal.ink);
  if (m.split) {
    const n = m.split.U + m.split.D + m.split.L + m.split.R;
    S.label(c, n ? `last vote, ${n}` : 'no votes', rx, 200, 20, pal.ink);
    ['U', 'D', 'L', 'R'].forEach((d, i) => S.label(c, `${m.split.pick === d ? '>' : ' '} ${NAMES[d]} ${m.split[d]}`, rx, 226 + i * 26, 20, m.split.pick === d ? pal.red : pal.ink));
  }
  S.joinBox(c, join, rx, 344, 210, pal);
}
