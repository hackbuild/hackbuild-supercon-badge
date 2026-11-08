import * as S from '../../lib/screen.js';
import { PW, PH } from './rules.js';

const STRIP = 56;

export function portrait(c, img, box, ink = '#000') {
  S.drawBits(c, S.unpackBits(img, PW, PH), PW, PH, box, ink);
}

export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.reign) {
    const h = S.H - STRIP, w = Math.round((h * PW) / PH);
    portrait(c, m.reign.img, { x: Math.round((S.W - w) / 2), y: 0, w, h }, pal.ink);
    c.fillStyle = pal.ink;
    c.fillRect(0, S.H - STRIP, S.W, STRIP);
    S.text(c, `${m.reign.name}, picked by the room`, { x: 16, y: S.H - STRIP + 6, w: S.W - 32, h: STRIP - 12 }, { size: 40, color: pal.paper, valign: 'middle' });
    return;
  }
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, 720, 96);
  S.text(c, 'dither booth', { x: 24, y: 8, w: 672, h: 80 }, { size: 72, color: pal.paper, valign: 'middle' });
  S.text(c, 'take a selfie on your phone. the room votes one onto this badge.', { x: 28, y: 124, w: 680, h: 300 }, { size: 64, valign: 'middle' });
  S.label(c, m.approved ? `${m.approved} portraits in the vote` : 'opt in only. photos are deleted after their turn.', 28, 470, 24, pal.red);
  S.joinBox(c, join, 744, 28, 200, pal);
}
