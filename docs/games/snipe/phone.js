import { h, seconds, timers } from '../../lib/phone-kit.js';

export function mount(root, api) {
  const t = timers();
  const head = h('p.big');
  const hint = h('p.prose');
  const input = h('input', { id: 'code', maxLength: 4, autocapitalize: 'characters', autocomplete: 'off', spellcheck: false, className: 'code' });
  const go = h('button.btn.go', { type: 'submit' }, 'claim it');
  const form = h('form.stack', { onsubmit: e => { e.preventDefault(); claim(input.value.trim().toUpperCase()); } },
    h('div', {}, h('label', { htmlFor: 'code' }, 'code on the badge'), input), go);
  const result = h('p.result');
  const claims = h('ol.results');
  root.append(head, hint, form, result, h('h3.small', {}, 'this round'), claims);

  let view = null, you = null;

  function claim(c) {
    if (c.length !== 4) { api.note('the code is 4 letters.', true); return; }
    if (api.send('claim', { c })) { result.textContent = `claiming ${c}.`; input.value = ''; }
  }

  // A phone that opened the page from the badge's QR carries the code in the link.
  function fromLink() {
    const c = api.linkCode();
    if (c && view && view.live) { api.clearLinkCode(); claim(c); }
  }

  function draw() {
    if (!view) return;
    head.textContent = view.live ? `code live, ${seconds(api.left(view))}` : 'watch the badge';
    hint.textContent = view.live ? 'scan the qr code on the badge, or type the 4 letters.' : 'a new code appears when the badge finishes drawing.';
    const y = you && you.r === view.round ? you : null;
    if (y && y.claimed) result.textContent = `claimed. ${ordinal(y.claimed.place)} in ${(y.claimed.ms / 1000).toFixed(1)} s, +${y.claimed.pts}.`;
    else if (result.textContent.startsWith('claimed.')) result.textContent = '';
    form.hidden = !!(y && y.claimed);
    claims.replaceChildren(...(view.claims.length ? view.claims.map(([n, ms, pts]) => h('li', {}, `${n}, ${(ms / 1000).toFixed(1)} s, +${pts}`)) : [h('li', {}, 'nobody yet')]));
    fromLink();
  }

  t.every(500, draw);
  return { update(v, y) { view = v; you = y; draw(); }, destroy: () => t.stop() };
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
