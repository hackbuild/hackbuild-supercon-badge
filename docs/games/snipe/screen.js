import * as S from '../../lib/screen.js';

// The projector hides a code until it is live, so nobody in the room types it before the badge
// has finished drawing it.
export function draw(c, m, { color, join, stage }) {
  const pal = S.palette(color);
  if (!m) return;
  const hidden = stage && !m.live;
  const target = `${join.url}.${m.code}`;
  if (hidden) S.text(c, 'next code coming', { x: 20, y: 20, w: 480, h: 480 }, { size: 90, valign: 'middle' });
  else S.qr(c, target, 20, 20, 480, pal);
  S.label(c, `round ${m.round}`, 28, 532, 30, pal.ink);
  c.fillStyle = pal.ink;
  c.fillRect(540, 20, 400, 200);
  S.text(c, hidden ? '....' : m.code, { x: 560, y: 40, w: 360, h: 160 }, { font: `600 {}px ${S.MONO}`, size: 150, color: pal.paper, align: 'center', valign: 'middle' });
  S.label(c, 'scan it or type it.', 548, 236, 26, pal.ink);
  S.label(c, 'first claim scores 100.', 548, 270, 26, pal.red);
  S.label(c, 'last round', 548, 340, 24, pal.ink);
  if (!m.best.length) S.label(c, 'nobody yet', 548, 376, 28, pal.ink);
  m.best.forEach((b, i) => S.label(c, `${i + 1}. ${b.name.slice(0, 12)} ${(b.ms / 1000).toFixed(1)}s`, 548, 376 + i * 40, 28, pal.ink));
  S.text(c, 'flash snipe', { x: 548, y: 520, w: 392, h: 120 }, { size: 72, valign: 'bottom' });
}
