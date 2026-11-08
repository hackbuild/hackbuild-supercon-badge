import { h, seconds, timers } from '../../lib/phone-kit.js';

export function mount(root, api) {
  const t = timers();
  const nowImg = h('img.figure', { alt: '' });
  const nowTitle = h('p.big');
  const nowBy = h('p.small');
  const queue = h('p.prose');
  const wait = h('p.result');
  const grid = h('div.gifgrid');
  root.append(nowImg, nowTitle, nowBy, queue, h('h3', {}, 'ask for one'), wait, grid);

  let view = null, you = null, youAt = 0, built = '';

  function draw() {
    if (!view) return;
    const n = view.now;
    nowImg.hidden = !(n && n.url);
    if (n && n.url && nowImg.getAttribute('src') !== n.url) { nowImg.src = n.url; nowImg.alt = n.title; }
    nowTitle.textContent = n ? n.title : view.loading ? `loading ${view.loading}` : 'nothing playing yet';
    nowBy.textContent = n && n.by ? `asked for by ${n.by}` : n ? 'picked by the wearer' : '';
    queue.textContent = view.queue.length ? `coming up: ${view.queue.map(q => q.title).join(', ')}.` : '';
    const ids = view.presets.map(p => p.id).join(',');
    if (ids !== built) {
      built = ids;
      grid.replaceChildren(...view.presets.map(p => h('button.gifpick', { onclick: () => { if (api.send('request', { id: p.id })) api.note(`asked for ${p.title}.`); } },
        h('img', { src: p.thumb || p.url, alt: '', loading: 'lazy' }), h('span', {}, p.title))));
    }
    const left = you ? Math.max(0, you.wait - (Date.now() - youAt)) : 0;
    wait.textContent = !view.requests ? 'requests are off right now.' : left ? `your next request in ${seconds(left)}.` : '';
    grid.querySelectorAll('button').forEach(b => { b.disabled = !view.requests || left > 0; });
  }

  t.every(1000, draw);
  return { update(v, y) { view = v; if (y && y !== you) { you = y; youAt = Date.now(); } draw(); }, destroy: () => t.stop() };
}
