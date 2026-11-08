import { h, seconds, timers } from '../../lib/phone-kit.js';
import * as fp from './footprint.js';

export function mount(root, api) {
  const t = timers();
  const head = h('b');
  const timer = h('span.timer');
  const canvas = h('canvas.figure', { width: 720, height: 560, 'aria-label': 'the footprint to name' });
  const c = canvas.getContext('2d');
  const input = h('input', { id: 'pkg', maxLength: 40, autocapitalize: 'characters', autocomplete: 'off', spellcheck: false, placeholder: 'for example SOT-23' });
  const go = h('button.btn.go', { onclick: guess }, 'name it');
  const tries = h('p.prose');
  const choices = h('div.choices');
  const hint = h('p.prose');
  const result = h('p.result');
  const askBox = h('div.stack', {}, h('div', {}, h('label', { htmlFor: 'pkg' }, 'what package is this?'), input), go, tries, hint, choices);
  const answer = h('p.big');
  const chip = h('p.kicker');
  const fact = h('p.prose');
  const firsts = h('ol.results');
  const revealBox = h('div.stack', { hidden: true }, answer, chip, fact, firsts);
  root.append(h('div.split', {}, head, timer), canvas, result, askBox, revealBox);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') guess(); });

  let view = null, you = null, drawn = '', buzzed = false;

  function guess() {
    const text = input.value.trim();
    if (!text) { api.note('type a package name first.', true); return; }
    if (api.send('guess', { r: view.round, text })) { input.select(); result.textContent = 'checking.'; }
  }

  function choose(i) {
    if (api.send('choose', { r: view.round, c: i })) { choices.querySelectorAll('button').forEach(b => { b.disabled = true; }); }
  }

  function picture() {
    const key = `${view.round}.${view.phase}`;
    if (key === drawn) return;
    drawn = key;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    fp.draw(c, view.geom, { x: 10, y: 10, w: canvas.width - 20, h: canvas.height - 20 },
      { accent: '#d0021b', pins: view.phase === 'reveal' ? view.pins : null, labelSize: 22 });
  }

  function draw() {
    if (!view) return;
    if (view.phase === 'empty') { head.textContent = 'no parts loaded'; return; }
    picture();
    head.textContent = `round ${view.round}, ${view.phase === 'ask' ? `${view.solved} named it` : 'the answer'}`;
    timer.textContent = seconds(api.left(view));
    const y = you && you.r === view.round ? you : null;
    askBox.hidden = view.phase !== 'ask' || !!(y && (y.ok || y.chose || y.tries >= y.triesMax));
    revealBox.hidden = view.phase !== 'reveal';
    if (y && y.ok && !buzzed) { buzzed = true; api.buzz(); }
    if (y && y.ok) result.textContent = y.via === 'choice' ? `right, from the choices. +${y.pts}` : `right. ${ordinal(y.rank)} to name it, +${y.pts}`;
    else if (y && (y.chose || y.tries >= y.triesMax)) result.textContent = 'not this time. the answer shows soon.';
    else result.textContent = '';
    if (view.phase === 'ask') {
      tries.textContent = y && y.tries ? `${y.triesMax - y.tries} guess${y.triesMax - y.tries === 1 ? '' : 'es'} left.` : 'three guesses. spelling can be a little off.';
      const show = view.choices && !(y && y.tries >= y.triesMax);
      hint.textContent = show ? 'stuck? pick one, worth less:' : view.hintIn > 0 ? `choices appear in ${seconds(Math.max(0, view.hintIn - (Date.now() - api.arrived(view))))}.` : '';
      if (show && !choices.children.length) choices.replaceChildren(...view.choices.map((label, i) => h('button.btn', { onclick: () => choose(i) }, label)));
      if (!show) choices.replaceChildren();
    } else {
      answer.textContent = view.answer;
      chip.textContent = view.chip && view.chip !== view.answer ? `shown here as the ${view.chip}` : '';
      fact.textContent = view.fact || '';
      firsts.replaceChildren(...(view.firsts || []).map(([n, ms]) => h('li', {}, `${n}, ${(ms / 1000).toFixed(1)} s`)));
    }
  }

  t.every(500, () => { if (view) { timer.textContent = seconds(api.left(view)); if (view.phase === 'ask') draw(); } });
  return {
    update(v, y) {
      if (view && v.round !== view.round) { input.value = ''; choices.replaceChildren(); buzzed = false; }
      view = v;
      you = y;
      draw();
    },
    destroy: () => t.stop(),
  };
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
