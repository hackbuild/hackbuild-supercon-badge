import * as S from '../../lib/screen.js';
import * as fp from './footprint.js';

export function draw(c, m, { color, join }) {
  const pal = S.palette(color);
  if (!m) return;
  if (m.phase === 'ask') {
    c.fillStyle = pal.ink;
    c.fillRect(0, 0, 720, 96);
    S.text(c, 'name that package', { x: 24, y: 8, w: 672, h: 80 }, { size: 70, color: pal.paper, valign: 'middle' });
    fp.draw(c, m.geom, { x: 20, y: 110, w: 690, h: 550 }, { ink: pal.ink, paper: pal.paper, accent: pal.red });
    S.joinBox(c, join, 744, 28, 200, pal);
    S.label(c, `round ${m.round}`, 750, 300, 26, pal.ink);
    S.label(c, `${m.pads} pads`, 750, 336, 26, pal.ink);
    S.text(c, 'type it on your phone', { x: 748, y: 400, w: 196, h: 160 }, { size: 40 });
    return;
  }
  S.band(c, m.chip && m.chip !== m.answer ? `${m.answer}, here as the ${m.chip}` : m.answer, pal, 96);
  fp.draw(c, m.geom, { x: 16, y: 104, w: 700, h: 560 }, { ink: pal.ink, paper: pal.paper, accent: pal.red, pins: m.pins, labelSize: 20 });
  S.text(c, m.answer, { x: 732, y: 112, w: 212, h: 120 }, { size: 64, valign: 'middle' });
  S.text(c, m.fact || '', { x: 732, y: 244, w: 212, h: 220 }, { font: `600 {}px ${S.MONO}`, size: 24, lead: 1.2 });
  S.label(c, m.first ? 'first:' : 'nobody named it', 732, 488, 22, pal.ink);
  if (m.first) {
    S.text(c, m.first[0], { x: 732, y: 518, w: 212, h: 60 }, { size: 40, color: pal.red });
    S.label(c, `${(m.first[1] / 1000).toFixed(1)} s`, 732, 590, 24, pal.ink);
  }
}
