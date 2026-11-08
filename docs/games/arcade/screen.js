import * as S from '../../lib/screen.js';

// A snapshot fills the panel: 240 by 168 dots, four pixels each.
export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.kind === 'frame') {
    S.drawBits(c, S.unpackBits(m.bits, m.w, m.h), m.w, m.h, { x: 0, y: 0, w: S.W, h: S.H }, pal.ink);
    return;
  }
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, 720, 96);
  S.text(c, 'retro arcade', { x: 24, y: 8, w: 672, h: 80 }, { size: 72, color: pal.paper, valign: 'middle' });
  S.text(c, m.rom ? `${m.rom}. your phone is the controller.` : 'a game starts soon. your phone is the controller.', { x: 28, y: 130, w: 680, h: 300 }, { size: 64, valign: 'middle' });
  S.joinBox(c, join, 744, 28, 200, pal);
}
