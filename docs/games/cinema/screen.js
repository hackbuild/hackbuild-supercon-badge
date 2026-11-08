import * as S from '../../lib/screen.js';
import { COLS, ROWS } from './rules.js';

const STRIP = 32;

export function frame(c, bits, pal, box = { x: 0, y: 0, w: S.W, h: S.H - STRIP }) {
  S.drawBits(c, S.unpackBits(bits, COLS, ROWS), COLS, ROWS, box, pal.ink);
}

// The projector loops a premiere itself; the badge gets one model per frame.
export function draw(c, m, { color, join, tick = 0 }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.kind === 'frame') {
    frame(c, m.bits, pal);
    S.label(c, `${m.prompt}, frame ${m.n} of ${m.of}`, 12, S.H - STRIP + 4, 22, pal.ink);
    return;
  }
  if (m.premiere && color) {
    const f = m.premiere.frames[tick % m.premiere.frames.length];
    frame(c, f, pal, { x: 0, y: 0, w: 690, h: 460 });
    S.label(c, `${m.premiere.prompt}, by ${m.premiere.by.slice(0, 4).join(', ')}`.slice(0, 60), 12, 470, 22, pal.ink);
  } else {
    c.fillStyle = pal.ink;
    c.fillRect(0, 0, 720, 96);
    S.text(c, '2 fps cinema', { x: 24, y: 8, w: 672, h: 80 }, { size: 72, color: pal.paper, valign: 'middle' });
    S.text(c, 'draw one frame of a loop on your phone. full reels play here.', { x: 28, y: 120, w: 670, h: 150 }, { size: 52 });
  }
  const y0 = m.premiere && color ? 510 : 300;
  m.open.slice(0, 4).forEach((r, i) => {
    S.label(c, `${r.prompt}`.slice(0, 34), 28, y0 + i * 40, 22, pal.ink);
    for (let k = 0; k < 12; k++) {
      c.fillStyle = k < r.drawn ? pal.red : pal.paper;
      c.strokeStyle = pal.ink;
      c.lineWidth = 2;
      c.fillRect(470 + k * 20, y0 + i * 40 + 2, 16, 20);
      c.strokeRect(470 + k * 20, y0 + i * 40 + 2, 16, 20);
    }
  });
  S.joinBox(c, join, 744, 28, 200, pal);
}
