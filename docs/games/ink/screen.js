// Live ink has no still screen: the badge and the projector draw the strokes as they arrive.
// The projector calls applyBatch for each live batch, on top of the page snapshot.
import * as S from '../../lib/screen.js';
import { parseStroke, drawStroke } from './strokes.js';

export const live = true;

export function draw(c, m, { color }) {
  const pal = S.palette(color);
  if (!m) return;
  S.label(c, `${m.prompt}, page ${m.page}`, 16, H_LABEL, 22, pal.ink);
}

const H_LABEL = S.H - 34;

// Returns true when the batch starts a new page, so the caller can clear first.
export function applyBatch(c, batch, scale = 1, color = false) {
  let fresh = false;
  for (const text of batch.split(';')) {
    if (text.startsWith('page,')) { fresh = true; c.fillStyle = '#fff'; c.fillRect(0, 0, S.W * scale, S.H * scale); continue; }
    const st = parseStroke(text);
    if (st) drawStroke(c, st, scale, color ? '#1a1a1a' : '#000');
  }
  return fresh;
}
