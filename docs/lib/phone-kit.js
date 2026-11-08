// Small helpers for the phone controllers: a DOM builder and timers that stop with the game.

// h('button.btn.go', { onclick }, 'send') builds an element. Strings become text, never HTML.
export function h(spec, attrs = {}, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export function seconds(ms) { return `${Math.max(0, Math.ceil(ms / 1000))}s`; }

export function timers() {
  const ids = [];
  return {
    every(ms, fn) { ids.push(setInterval(fn, ms)); },
    stop() { ids.splice(0).forEach(clearInterval); },
  };
}

// Pointer position on a canvas in its own pixel units, so drawing works at any display size.
export function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
}

export function coalesced(e) {
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  return list.length ? list : [e];
}
