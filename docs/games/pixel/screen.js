import * as S from '../../lib/screen.js';
import { COLS, ROWS } from './rules.js';

export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, S.W, 104);
  S.text(c, m.prompt, { x: 20, y: 12, w: 700, h: 84 }, { size: 76, color: pal.paper, valign: 'middle' });
  S.label(c, `${m.painters} painters`, 744, 40, 26, pal.paper);
  const cell = 21, ox = 12, oy = 116;
  c.strokeStyle = pal.ink;
  c.lineWidth = 3;
  c.strokeRect(ox - 3, oy - 3, COLS * cell + 6, ROWS * cell + 6);
  for (let i = 0; i < m.cells.length; i++) {
    const v = m.cells[i];
    if (v === '0') continue;
    c.fillStyle = v === '2' ? pal.red : pal.ink;
    c.fillRect(ox + (i % COLS) * cell, oy + Math.floor(i / COLS) * cell, cell, cell);
  }
  S.joinBox(c, join, 778, 120, 176, pal);
  S.label(c, 'paint with', 790, 400, 22, pal.ink);
  S.label(c, 'your phone', 790, 428, 22, pal.ink);
  if (m.last.length) {
    S.label(c, 'latest', 790, 488, 20, pal.ink);
    m.last.slice(0, 3).forEach((n, i) => S.label(c, n.slice(0, 11), 790, 514 + i * 28, 20, pal.ink));
  }
}
