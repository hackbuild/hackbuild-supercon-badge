// Drawing kit for 960 by 672 screens. The same draw code feeds the badge (reduced to one bit,
// black on white) and the projector view (in color), so a screen looks the same in both places.

export const W = 960, H = 672;
export const DISPLAY = '"Permanent Marker", "Arial Black", sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

// The badge's fast refresh has no red, so red only shows on the projector.
export function palette(color) {
  return { ink: '#000', paper: '#fff', red: color ? '#d0021b' : '#000' };
}

export async function loadFonts() {
  try {
    await Promise.all([document.fonts.load(`80px ${DISPLAY}`), document.fonts.load(`600 30px ${MONO}`)]);
  } catch (e) { /* a missing font falls back to the system face */ }
}

export function clear(c, pal) {
  c.fillStyle = pal.paper;
  c.fillRect(0, 0, W, H);
}

function wrap(c, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (c.measureText(t).width <= maxW || !line) line = t;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// The largest size at which the text fits the box, wrapped.
function fit(c, text, font, box, start, lead) {
  for (let size = start; size >= 14; size -= 2) {
    c.font = font.replace('{}', size);
    const lines = wrap(c, text, box.w);
    if (lines.length * size * lead <= box.h && lines.every(l => c.measureText(l).width <= box.w)) return { size, lines };
  }
  c.font = font.replace('{}', 14);
  return { size: 14, lines: wrap(c, text, box.w) };
}

export function text(c, value, box, { font = `{}px ${DISPLAY}`, size = 80, color = '#000', align = 'left', valign = 'top', lead = 1.08 } = {}) {
  const f = fit(c, value, font, box, size, lead);
  c.fillStyle = color;
  c.textBaseline = 'top';
  c.textAlign = align;
  const total = f.lines.length * f.size * lead;
  let y = box.y + (valign === 'middle' ? (box.h - total) / 2 : valign === 'bottom' ? box.h - total : 0);
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  for (const l of f.lines) { c.fillText(l, x, y); y += f.size * lead; }
  c.textAlign = 'left';
  return f.size;
}

export function label(c, value, x, y, size = 22, color = '#000') {
  c.font = `600 ${size}px ${MONO}`;
  c.fillStyle = color;
  c.textBaseline = 'top';
  c.fillText(value, x, y);
}

export function band(c, value, pal, h = 112) {
  c.fillStyle = pal.ink;
  c.fillRect(0, 0, W, h);
  text(c, value, { x: 24, y: 12, w: W - 48, h: h - 24 }, { font: `600 {}px ${MONO}`, size: 40, color: pal.paper, valign: 'middle' });
}

export function qr(c, value, x, y, size, pal = palette(false)) {
  const q = qrcode(0, 'M');
  q.addData(value);
  q.make();
  const n = q.getModuleCount(), quiet = 2, m = Math.floor(size / (n + quiet * 2));
  const real = m * (n + quiet * 2);
  c.fillStyle = pal.paper;
  c.fillRect(x, y, real, real);
  c.fillStyle = pal.ink;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(x + (k + quiet) * m, y + (r + quiet) * m, m, m);
  return real;
}

export function joinBox(c, join, x, y, size, pal) {
  const s = qr(c, join.url, x, y, size, pal);
  label(c, 'scan to play', x + 6, y + s + 4, 20, pal.ink);
  label(c, `room ${join.code}`, x + 6, y + s + 30, 20, pal.ink);
  return s;
}

// Black plane then red plane, 120 bytes a row, leftmost pixel in the top bit, as the badge stores
// them. Anything darker than mid grey is black.
export function toPlanes(c) {
  const d = c.getImageData(0, 0, W, H).data, row = W / 8;
  const out = new Uint8Array(row * H * 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 384) out[y * row + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}

// A one bit grid, packed eight cells to a byte, as base64 text that fits in a relay value.
export function packBits(cells, w, h) {
  const out = new Uint8Array(Math.ceil((w * h) / 8));
  for (let i = 0; i < w * h; i++) if (cells[i]) out[i >> 3] |= 0x80 >> (i & 7);
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackBits(text, w, h) {
  const cells = new Uint8Array(w * h);
  if (!text) return cells;
  let s;
  try { s = atob(text); } catch (e) { return cells; }
  for (let i = 0; i < w * h && (i >> 3) < s.length; i++) cells[i] = (s.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return cells;
}

export function drawBits(c, cells, w, h, box, color = '#000') {
  const cw = box.w / w, ch = box.h / h;
  c.fillStyle = color;
  for (let i = 0; i < w * h; i++) {
    if (!cells[i]) continue;
    c.fillRect(Math.floor(box.x + (i % w) * cw), Math.floor(box.y + Math.floor(i / w) * ch), Math.ceil(cw), Math.ceil(ch));
  }
}

// Atkinson dithering to one bit, the halftone look that suits e-paper. contrast is -1 to 1.
export function dither(gray, w, h, contrast = 0) {
  const k = (1 + contrast) / (1 - Math.min(0.95, contrast));
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = Math.max(0, Math.min(255, (gray[i] - 128) * k + 128));
  const out = new Uint8Array(w * h);
  const spread = (x, y, e) => { if (x >= 0 && x < w && y < h) g[y * w + x] += e; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, old = g[i], v = old < 128 ? 0 : 255;
    out[i] = v ? 0 : 1;
    const e = (old - v) / 8;
    spread(x + 1, y, e); spread(x + 2, y, e); spread(x - 1, y + 1, e);
    spread(x, y + 1, e); spread(x + 1, y + 1, e); spread(x, y + 2, e);
  }
  return out;
}
