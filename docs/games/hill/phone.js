import { h, seconds, timers } from '../../lib/phone-kit.js';

export function mount(root, api) {
  const t = timers();
  const timer = h('span.timer');
  const phase = h('b');
  const q = h('p.q');
  const input = h('input', { maxLength: 60, autocapitalize: 'off', autocomplete: 'off', placeholder: '60 letters at most', id: 'hillA' });
  const sendBtn = h('button.btn.go', { onclick: send }, 'send my answer');
  const sent = h('p.prose');
  const answerBox = h('div.stack', {}, q, h('div', {}, h('label', { htmlFor: 'hillA' }, 'your answer'), input), sendBtn, sent);
  const voteHead = h('p.q', {}, 'which one is funnier?');
  const cards = h('div.stack');
  const skip = h('button.btn.quiet', { onclick: () => vote(-1) }, 'skip this one');
  const votesLeft = h('p.prose');
  const voteBox = h('div.stack', { hidden: true }, voteHead, cards, skip, votesLeft);
  const winHead = h('p.kicker', {}, 'on the badge now');
  const winText = h('p.big');
  const winBy = h('p.prose');
  const results = h('ol.results');
  const mine = h('p.prose');
  const showBox = h('div.stack', { hidden: true }, winHead, winText, winBy, mine, results);
  root.append(h('div.split', {}, phase, timer), answerBox, voteBox, showBox);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  let view = null, you = null, voted = -1;

  function send() {
    const a = input.value.trim();
    if (a.length < 2) { api.note('write a few words first.', true); return; }
    if (api.send('answer', { r: view.round, a })) { sent.textContent = 'sending.'; input.blur(); }
  }

  function vote(pick) {
    if (!you || you.r !== view.round || !you.pair || voted === you.k) return;
    if (api.send('vote', { r: view.round, k: you.k, pick })) {
      voted = you.k;
      cards.querySelectorAll('button').forEach(b => { b.disabled = true; });
      skip.disabled = true;
      votesLeft.textContent = 'counted. the next pair is on its way.';
    }
  }

  function draw() {
    if (!view) return;
    const p = view.phase;
    phase.textContent = `round ${view.round}, ${p === 'answer' ? 'write' : p === 'vote' ? 'vote' : 'the winner'}`;
    timer.textContent = p === 'show' ? '' : seconds(api.left(view));
    answerBox.hidden = p !== 'answer';
    voteBox.hidden = p !== 'vote';
    showBox.hidden = p !== 'show';
    const y = you && you.r === view.round ? you : null;
    if (p === 'answer') {
      q.textContent = view.q;
      sent.textContent = y && y.sent ? `sent: "${y.sent}". you can change it until the time runs out.` : `${view.answers} answers so far.`;
      sendBtn.textContent = y && y.sent ? 'change my answer' : 'send my answer';
    } else if (p === 'vote') {
      cards.replaceChildren();
      if (!y) { votesLeft.textContent = 'getting your first pair.'; skip.hidden = true; return; }
      const pair = y.pair || [];
      skip.hidden = !pair.length;
      skip.disabled = voted === y.k;
      voteHead.textContent = pair.length === 1 ? 'should this one go on the badge?' : 'which one is funnier?';
      for (const e of pair) {
        cards.append(h('button.card', { onclick: () => vote(e.i), disabled: voted === y.k }, pair.length === 1 ? 'yes, this one' : '', h('span', {}, e.text)));
      }
      votesLeft.textContent = !pair.length
        ? (y.k ? 'you have voted. the winner shows when everyone is done.' : 'no other answers to judge this round. yours still counts.')
        : `${y.left} vote${y.left === 1 ? '' : 's'} left.${y.mine ? ` yours is "${y.mine}", it will not come up for you.` : ''}`;
    } else {
      winText.textContent = view.winner ? view.winner.text : 'nobody answered';
      winBy.textContent = view.winner ? `by ${view.winner.name}. the next prompt starts in ${seconds(api.left(view))}.` : '';
      results.replaceChildren(...(view.results || []).map(r => h('li', {}, r.n ? `${r.text}, ${r.name}, picked ${r.w} of ${r.n}` : `${r.text}, ${r.name}`)));
      mine.textContent = !y || !y.mine ? '' : y.mine.n ? `yours placed ${y.mine.place} of ${y.mine.of}, picked ${y.mine.w} of ${y.mine.n} times.` : `yours placed ${y.mine.place} of ${y.mine.of}. nobody else voted this round.`;
    }
  }

  t.every(500, () => { if (view) timer.textContent = view.phase === 'show' ? '' : seconds(api.left(view)); });
  return {
    update(v, y) {
      if (view && v.round !== view.round) { input.value = ''; voted = -1; }
      view = v;
      you = y;
      draw();
    },
    destroy: () => t.stop(),
  };
}
