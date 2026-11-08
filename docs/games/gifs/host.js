// The wearer's GIF panel: tap a preset, paste a link or pick a file, and it plays.
import { h } from '../../lib/phone-kit.js';
import { PRESETS } from './presets.js';

const tile = (g, onplay, onremove) => h('div.giftile', {},
  h('button.gifpick', { onclick: onplay }, h('img', { src: g.thumb || g.url, alt: '', loading: 'lazy' }), h('span', {}, g.title)),
  onremove ? h('button.btn.quiet', { onclick: onremove, 'aria-label': `remove ${g.title} from the library` }, 'remove') : null);

export function mount(el, engine) {
  const url = h('input', { id: 'gifUrl', placeholder: 'https://media.giphy.com/...gif', autocomplete: 'off', inputmode: 'url' });
  const playUrl = h('button.btn', { onclick: () => fromUrl(true) }, 'play now');
  const queueUrl = h('button.btn', { onclick: () => fromUrl(false) }, 'queue it');
  const file = h('input', { type: 'file', accept: 'image/gif', id: 'gifFile' });
  const msg = h('p.prose');
  const grid = h('div.gifgrid');
  const lib = h('div.gifgrid');
  el.append(
    h('h3', {}, 'tap one to play it now'), grid,
    h('h3', {}, 'your library'), lib,
    h('h3', {}, 'or any gif'),
    h('div', {}, h('label', { htmlFor: 'gifUrl' }, 'gif link'), url),
    h('div.pair2', {}, playUrl, queueUrl),
    h('div', {}, h('label', { htmlFor: 'gifFile' }, 'a gif file from this device'), file),
    msg,
    h('p.small', {}, 'a link must point at the gif itself. on giphy, open a gif and use its media link. if a site blocks it, save the gif and pick the file.'));

  grid.replaceChildren(...PRESETS.map(p => tile(p, () => start({ title: p.title, url: p.url }))));

  let shown = '';
  function drawLibrary() {
    if (!engine.rules || engine.room.kind !== 'gifs') return;
    const list = engine.ctx(Date.now()).state.library || [];
    const key = list.map(g => g.id).join(',');
    if (key === shown) return;
    shown = key;
    lib.replaceChildren(...(list.length ? list.map(g => tile(g, () => start({ title: g.title, url: g.url }), () => {
      engine.rules.removeFromLibrary(engine.ctx(Date.now()), g.id);
      engine.dirty.view = engine.dirty.save = true;
      drawLibrary();
    })) : [h('p.small', {}, 'gifs you play from a link land here, and phones can ask for them.')]));
  }
  drawLibrary();

  function start(item, now = true) {
    if (!engine.rules || engine.room.kind !== 'gifs') return;
    const ctx = engine.ctx(Date.now());
    if (now) { engine.rules.playNow(ctx, item); msg.textContent = `loading ${item.title}. the badge starts it in a few seconds.`; } else { engine.rules.enqueue(ctx, item); msg.textContent = `queued ${item.title}.`; }
    engine.dirty.view = engine.dirty.save = true;
  }

  function fromUrl(now) {
    const u = url.value.trim();
    if (!/^https:\/\/\S+$/.test(u)) { msg.textContent = 'paste a link that starts with https.'; return; }
    const item = { title: u.split('/').slice(-2, -1)[0] || 'a gif', url: u };
    if (engine.rules && engine.room.kind === 'gifs' && engine.rules.addToLibrary(engine.ctx(Date.now()), item)) drawLibrary();
    start(item, now);
  }

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    start({ title: f.name.replace(/\.gif$/i, '').slice(0, 40), url: '', file: await f.arrayBuffer() });
    file.value = '';
  });

  return { update: drawLibrary };
}
