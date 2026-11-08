import * as S from '../../lib/screen.js';

// The projector shows the real GIF over its screen; this is what it shows underneath and what
// the badge shows between GIFs. Each frame of a reel fills the panel exactly.
export function overlay(m) { return m && m.now && m.now.url ? m.now.url : ''; }

export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.kind === 'gif') {
    S.drawBits(c, S.unpackBits(m.bits, m.w, m.h), m.w, m.h, { x: 0, y: 0, w: S.W, h: S.H }, pal.ink);
    return;
  }
  if (m.now && m.now.first) {
    S.drawBits(c, S.unpackBits(m.now.first, m.now.w, m.now.h), m.now.w, m.now.h, { x: 0, y: 0, w: S.W, h: S.H }, pal.ink);
    return;
  }
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, 720, 96);
  S.text(c, 'meme gifs', { x: 24, y: 8, w: 672, h: 80 }, { size: 72, color: pal.paper, valign: 'middle' });
  S.text(c, 'pick one on your phone and it plays here.', { x: 28, y: 130, w: 680, h: 280 }, { size: 72, valign: 'middle' });
  S.label(c, m.queue ? `${m.queue} in the queue` : 'the queue is empty', 28, 460, 26, pal.red);
  S.joinBox(c, join, 744, 28, 200, pal);
}
