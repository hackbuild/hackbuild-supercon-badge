// Live ink strokes as text: "size,color,x0,y0,x1,y1,..." in panel pixels, size 0 to 2, color 1
// for ink and 0 to erase. The badge firmware reads the same format (badge/lib/hb_ink.py).
import { W, H } from '../../lib/screen.js';

export const SIZES = [3, 6, 12];
// Thicker lines cost more ink, but not in proportion, so a thick line still feels generous.
const COST = [1, 1.5, 3];
const MAX_POINTS = 64;

export function parseStroke(text) {
  const v = String(text).split(',').map(n => parseInt(n, 10));
  if (v.length < 4 || v.some(n => !Number.isFinite(n))) return null;
  const size = Math.max(0, Math.min(2, v[0])), color = v[1] ? 1 : 0;
  const pts = [];
  for (let i = 2; i + 1 < v.length && pts.length < MAX_POINTS * 2; i += 2) pts.push(Math.max(0, Math.min(W - 1, v[i])), Math.max(0, Math.min(H - 1, v[i + 1])));
  return { size, color, pts };
}

export function strokeLength(st) {
  let n = SIZES[st.size];
  for (let i = 2; i + 1 < st.pts.length; i += 2) n += Math.hypot(st.pts[i] - st.pts[i - 2], st.pts[i + 1] - st.pts[i - 1]);
  return n * COST[st.size];
}

export function drawStroke(c, st, scale = 1, ink = '#000', paper = '#fff') {
  c.strokeStyle = st.color ? ink : paper;
  c.fillStyle = c.strokeStyle;
  c.lineWidth = SIZES[st.size] * scale;
  c.lineCap = c.lineJoin = 'round';
  const p = st.pts;
  if (p.length === 2) { c.fillRect((p[0] - SIZES[st.size] / 2) * scale, (p[1] - SIZES[st.size] / 2) * scale, SIZES[st.size] * scale, SIZES[st.size] * scale); return; }
  c.beginPath();
  c.moveTo(p[0] * scale, p[1] * scale);
  for (let i = 2; i + 1 < p.length; i += 2) c.lineTo(p[i] * scale, p[i + 1] * scale);
  c.stroke();
}

