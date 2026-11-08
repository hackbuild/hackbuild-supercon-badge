// Draws a footprint from its pads and outline (mm, KiCad frame, y down) into a box, scaled to fit.
// Pads are [number, x, y, w, h, shape, kind]: shape c circle, o oval, r rect; kind 1 through hole,
// 2 mounting hole, 0 surface mount. Outline items are [x0, y0, x1, y1] or ['c', cx, cy, r].

export function bounds(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const [, x, y, w, h] of geom.pads) { grow(x - w / 2, y - h / 2); grow(x + w / 2, y + h / 2); }
  for (const l of geom.lines || []) {
    if (l[0] === 'c') { grow(l[1] - l[3], l[2] - l[3]); grow(l[1] + l[3], l[2] + l[3]); } else { grow(l[0], l[1]); grow(l[2], l[3]); }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function draw(c, geom, box, { ink = '#000', paper = '#fff', accent = ink, pins = null, labelSize = 18 } = {}) {
  if (!geom || !geom.pads || !geom.pads.length) return;
  const b = bounds(geom);
  const room = pins ? 0.62 : 0.92;
  const k = Math.min((box.w * room) / (b.x1 - b.x0 || 1), (box.h * room) / (b.y1 - b.y0 || 1));
  const ox = box.x + box.w / 2 - b.cx * k, oy = box.y + box.h / 2 - b.cy * k;
  const X = x => ox + x * k, Y = y => oy + y * k;

  c.strokeStyle = ink;
  c.lineWidth = Math.max(2, k * 0.12);
  c.beginPath();
  for (const l of geom.lines || []) {
    if (l[0] === 'c') { c.moveTo(X(l[1]) + l[3] * k, Y(l[2])); c.arc(X(l[1]), Y(l[2]), l[3] * k, 0, Math.PI * 2); } else { c.moveTo(X(l[0]), Y(l[1])); c.lineTo(X(l[2]), Y(l[3])); }
  }
  c.stroke();

  for (const [num, x, y, w, hgt, shape, kind] of geom.pads) {
    const pw = Math.max(2, w * k), ph = Math.max(2, hgt * k), px = X(x), py = Y(y);
    if (kind === 2) {
      c.beginPath();
      c.arc(px, py, Math.min(pw, ph) / 2, 0, Math.PI * 2);
      c.lineWidth = 2;
      c.stroke();
      continue;
    }
    c.fillStyle = String(num) === '1' ? accent : ink;
    c.beginPath();
    if (shape === 'c') c.arc(px, py, Math.min(pw, ph) / 2, 0, Math.PI * 2);
    else if (shape === 'o' && c.roundRect) c.roundRect(px - pw / 2, py - ph / 2, pw, ph, Math.min(pw, ph) / 2);
    else c.rect(px - pw / 2, py - ph / 2, pw, ph);
    c.fill();
    if (kind === 1) {
      c.fillStyle = paper;
      c.beginPath();
      c.arc(px, py, Math.min(pw, ph) * 0.24, 0, Math.PI * 2);
      c.fill();
    }
  }

  if (pins) labels(c, geom, pins, b, X, Y, { ink, labelSize, k });
}

// Pin names sit outside the pad, on the side away from the middle of the part. On dense parts
// only every pin that has room gets a label.
function labels(c, geom, pins, b, X, Y, { ink, labelSize, k }) {
  const seen = new Set();
  const named = geom.pads.filter(p => pins[p[0]] && !seen.has(p[0]) && seen.add(p[0]));
  if (!named.length) return;
  let pitch = Infinity;
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < Math.min(named.length, i + 6); j++) {
    const d = Math.hypot(named[i][1] - named[j][1], named[i][2] - named[j][2]);
    if (d > 0.01) pitch = Math.min(pitch, d);
  }
  const size = Math.max(11, Math.min(labelSize, pitch * k * 0.8));
  const every = size < 12 ? 2 : 1;
  c.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
  c.fillStyle = ink;
  c.textBaseline = 'middle';
  named.forEach((p, i) => {
    if (i % every) return;
    const [num, x, y, w, h] = p;
    const dx = x - b.cx, dy = y - b.cy;
    const side = Math.abs(dx) / (b.x1 - b.x0 || 1) >= Math.abs(dy) / (b.y1 - b.y0 || 1);
    const name = String(pins[num]).slice(0, 12);
    if (side) {
      c.textAlign = dx < 0 ? 'right' : 'left';
      c.fillText(name, X(x) + (dx < 0 ? -1 : 1) * (w * k / 2 + 6), Y(y));
    } else {
      c.save();
      c.translate(X(x), Y(y) + (dy < 0 ? -1 : 1) * (h * k / 2 + 6));
      c.rotate(-Math.PI / 2);
      c.textAlign = dy < 0 ? 'left' : 'right';
      c.fillText(name, 0, 0);
      c.restore();
    }
  });
  c.textAlign = 'left';
}
