import * as S from '../../lib/screen.js';

// answer and vote phases put the prompt on the badge; the show phase puts the winner there.
export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.phase === 'show' && m.winner) {
    S.band(c, m.winner.q, pal);
    S.text(c, m.winner.text, { x: 28, y: 140, w: 690, h: 380 }, { size: 120, valign: 'middle', lead: 1.05 });
    S.label(c, `by ${m.winner.name}`.slice(0, 40), 28, 548, 30, pal.red);
    S.label(c, `round ${m.round}, the room's pick`, 28, 592, 22, pal.ink);
    S.joinBox(c, join, 744, 396, 200, pal);
    return;
  }
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, 720, 96);
  S.text(c, m.phase === 'vote' ? 'vote now' : 'answer now', { x: 24, y: 8, w: 672, h: 80 }, { size: 72, color: pal.paper, valign: 'middle' });
  S.text(c, m.q, { x: 28, y: 124, w: 680, h: 300 }, { size: 84, valign: 'middle' });
  S.label(c, m.phase === 'vote' ? `${m.answers} answers. pick the funniest on your phone.` : 'write yours on your phone.', 28, 446, 24, pal.red);
  if (m.winner) {
    c.strokeStyle = pal.ink;
    c.lineWidth = 3;
    c.strokeRect(24, 496, 690, 152);
    S.label(c, `last round, ${m.winner.name}:`.slice(0, 44), 40, 508, 20, pal.ink);
    S.text(c, m.winner.text, { x: 40, y: 540, w: 660, h: 96 }, { size: 44, valign: 'middle' });
  }
  S.joinBox(c, join, 744, 28, 200, pal);
  S.label(c, `round ${m.round}`, 750, 300, 26, pal.ink);
}
