// The wearer's approval queue. Nothing a stranger sends reaches the badge or another phone until
// it is approved here, unless the wearer turns on automatic approval.
import { h } from '../../lib/phone-kit.js';
import { PW, PH } from './rules.js';
import { portrait } from './screen.js';

export function mount(el, engine) {
  const head = h('h3', {}, 'portraits waiting for you');
  const list = h('div.queue');
  el.append(head, list);
  let drawn = '';

  function update() {
    if (engine.room.kind !== 'booth' || !engine.rules) return;
    const ctx = engine.ctx(Date.now());
    const waiting = engine.rules.pending(ctx);
    const key = waiting.map(p => p.id).join(',');
    head.textContent = waiting.length ? `portraits waiting for you, ${waiting.length}` : 'no portraits waiting';
    if (key === drawn) return;
    drawn = key;
    list.replaceChildren(...waiting.map(p => {
      const cv = h('canvas.figure', { width: PW, height: PH });
      const c = cv.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, PW, PH);
      portrait(c, p.img, { x: 0, y: 0, w: PW, h: PH });
      const decide = yes => { engine.rules.decide(engine.ctx(Date.now()), p.id, yes); engine.dirty.save = engine.dirty.view = true; engine.youQueue.add(p.pid); update(); };
      return h('div.queued', {}, cv, h('p.small', {}, engine.room.names[p.pid] || 'someone'),
        h('div.pair2', {}, h('button.btn.go', { onclick: () => decide(true) }, 'approve'), h('button.btn', { onclick: () => decide(false) }, 'reject')));
    }));
  }
  update();
  return { update };
}
