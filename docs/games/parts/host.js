// The host page's part finder: search the KiCad library, preview a footprint, add it to the deck.
import { h } from '../../lib/phone-kit.js';
import * as kicad from './kicad.js';
import * as fp from './footprint.js';

export function mount(el, engine) {
  const q = h('input', { id: 'kq', placeholder: 'for example sot-363 or dip-24', autocomplete: 'off' });
  const find = h('button.btn', { onclick: search }, 'search kicad');
  const msg = h('p.prose');
  const list = h('div.hits');
  const preview = h('canvas.figure', { width: 480, height: 300, hidden: true });
  const answer = h('input', { id: 'ka', placeholder: 'the answer players type' });
  const accept = h('input', { id: 'kc', placeholder: 'other spellings, comma separated' });
  const add = h('button.btn.go', { onclick: addPart, hidden: true }, 'add to the deck');
  const form = h('div.stack', { hidden: true }, preview,
    h('div', {}, h('label', { htmlFor: 'ka' }, 'answer'), answer),
    h('div', {}, h('label', { htmlFor: 'kc' }, 'also accept'), accept), add);
  const deck = h('ul.deck');
  el.append(
    h('h3', {}, 'add parts from kicad'),
    h('div.row2', {}, h('div', {}, h('label', { htmlFor: 'kq' }, 'search the kicad footprint library'), q), find),
    msg, list, form, h('h3', {}, 'parts you added'), deck);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  let picked = null;

  async function search() {
    msg.textContent = 'searching.';
    list.replaceChildren();
    try {
      const hits = await kicad.search(q.value);
      msg.textContent = hits.length ? `${hits.length} footprints. pick one to preview.` : 'nothing matched. try fewer words.';
      list.replaceChildren(...hits.map(path => h('button.btn.hit', { onclick: () => pick(path) }, kicad.nameOf(path))));
    } catch (e) { msg.textContent = e.message; }
  }

  async function pick(path) {
    msg.textContent = 'fetching the footprint.';
    try {
      const g = await kicad.footprint(path);
      if (!g.pads.length) { msg.textContent = 'that footprint has no pads.'; return; }
      picked = { path, g };
      const c = preview.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, preview.width, preview.height);
      fp.draw(c, g, { x: 8, y: 8, w: preview.width - 16, h: preview.height - 16 }, { accent: '#d0021b' });
      const name = kicad.nameOf(path);
      answer.value = name.split('_')[0];
      accept.value = name.toLowerCase();
      preview.hidden = add.hidden = form.hidden = false;
      msg.textContent = `${g.pads.length} pads. set the answer, then add it.`;
    } catch (e) { msg.textContent = e.message; }
  }

  function addPart() {
    if (!picked || !answer.value.trim()) return;
    const ctx = engine.ctx(Date.now());
    engine.rules.addPart(ctx, {
      id: `kicad-${kicad.nameOf(picked.path)}`.toLowerCase().replace(/[^a-z0-9.-]/g, '-'),
      answer: answer.value.trim(), accept: accept.value.split(',').map(s => s.trim()).filter(Boolean),
      chip: '', fact: `KiCad footprint ${kicad.nameOf(picked.path)}.`, pads: picked.g.pads, lines: picked.g.lines, pins: {},
      src: `github.com/KiCad/kicad-footprints ${picked.path}`, sym: '',
    });
    engine.dirty.save = true;
    msg.textContent = `added ${answer.value.trim()}. it comes up in a later round.`;
    form.hidden = true;
    update();
  }

  function update() {
    if (engine.room.kind !== 'parts' || !engine.rules) return;
    const extra = engine.room.games.parts.extra || [];
    deck.replaceChildren(...(extra.length ? extra.map(p => h('li', {}, h('span', {}, p.answer),
      h('button.btn', { onclick: () => { engine.rules.removePart(engine.ctx(Date.now()), p.id); engine.dirty.save = true; update(); } }, 'remove'))) : [h('li', {}, 'none yet. the deck has the built in parts.')]));
  }
  update();
  return { update };
}
