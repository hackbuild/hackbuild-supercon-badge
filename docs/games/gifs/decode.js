// Turns a GIF into a handful of one bit frames for the badge, on the host page.
// gifuct-js (MIT) parses the file in any browser, Safari included.
import { parseGIF, decompressFrames } from 'https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm';
import { dither, packBits } from '../../lib/screen.js';

// 240 by 168 is the panel's shape at a quarter of its size: coarse dots that compress small and
// transfer fast, which suits a meme better than a sharp picture would.
export const FW = 240, FH = 168;

export async function load(source) {
  if (source instanceof ArrayBuffer) return source;
  let r;
  try { r = await fetch(source); } catch (e) { throw new Error('that site does not let pages load its gifs. download the gif and upload it instead.'); }
  if (!r.ok) throw new Error(`the gif link answered ${r.status}.`);
  return r.arrayBuffer();
}

export async function decode(source, { maxFrames = 12, halftone = true } = {}) {
  const gif = parseGIF(await load(source));
  const raw = decompressFrames(gif, true);
  if (!raw.length) throw new Error('that file has no frames.');
  const w = gif.lsd.width, h = gif.lsd.height;
  const full = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const fc = full.getContext('2d', { willReadFrequently: true });
  const patch = document.createElement('canvas');
  const pc = patch.getContext('2d');
  const small = Object.assign(document.createElement('canvas'), { width: FW, height: FH });
  const sc = small.getContext('2d', { willReadFrequently: true });

  // Spread the picked frames over the GIF's own timing, not its frame count.
  const total = raw.reduce((n, f) => n + (f.delay || 100), 0);
  const want = Math.min(maxFrames, raw.length);
  const picks = new Set();
  let t = 0;
  raw.forEach((f, i) => { if (picks.size < want && t >= (picks.size * total) / want) picks.add(i); t += f.delay || 100; });

  const frames = [];
  let saved = null;
  raw.forEach((f, i) => {
    if (f.disposalType === 3) saved = fc.getImageData(0, 0, w, h);
    patch.width = f.dims.width;
    patch.height = f.dims.height;
    const img = pc.createImageData(f.dims.width, f.dims.height);
    img.data.set(f.patch);
    pc.putImageData(img, 0, 0);
    fc.drawImage(patch, f.dims.left, f.dims.top);
    if (picks.has(i)) frames.push(shrink(full, sc, halftone));
    if (f.disposalType === 2) fc.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    else if (f.disposalType === 3 && saved) fc.putImageData(saved, 0, 0);
  });
  return { frames, w: FW, h: FH, delay: Math.round(total / raw.length), count: raw.length };
}

function shrink(full, sc, halftone) {
  sc.fillStyle = '#fff';
  sc.fillRect(0, 0, FW, FH);
  const k = Math.min(FW / full.width, FH / full.height), dw = full.width * k, dh = full.height * k;
  sc.drawImage(full, (FW - dw) / 2, (FH - dh) / 2, dw, dh);
  const d = sc.getImageData(0, 0, FW, FH).data, gray = new Float32Array(FW * FH);
  for (let i = 0; i < FW * FH; i++) {
    const a = d[i * 4 + 3] / 255;
    gray[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a);
  }
  const bits = halftone ? dither(gray, FW, FH, 0.15) : gray.map(g => (g < 128 ? 1 : 0));
  return packBits(bits, FW, FH);
}
