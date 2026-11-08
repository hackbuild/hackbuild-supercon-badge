import { h, seconds, timers } from '../../lib/phone-kit.js';
import { dither, packBits } from '../../lib/screen.js';
import { PW, PH } from './rules.js';
import { portrait } from './screen.js';

const STATUS = {
  none: '', pending: 'your portrait is waiting for the wearer to approve it.', approved: 'your portrait is in the vote.',
  reigning: 'your portrait is on the badge right now.', shown: 'your portrait had its turn and was deleted.',
  rejected: 'the wearer passed on your portrait. you can try another.', replaced: '', withdrawn: 'you took your portrait back. it was deleted.',
  deleted: 'your portrait was deleted.',
};

export function mount(root, api) {
  const t = timers();
  const status = h('p.result');
  const reign = h('p.prose');
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', id: 'shot' });
  const preview = h('canvas.figure', { width: PW, height: PH, hidden: true, 'aria-label': 'your portrait, dithered for e-paper' });
  const contrast = h('input', { type: 'range', min: -60, max: 60, value: 0, id: 'contrast', 'aria-label': 'contrast' });
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const send = h('button.btn.go', { onclick: submit, disabled: true }, 'send my portrait');
  const withdraw = h('button.btn', { onclick: () => api.send('withdraw', {}), hidden: true }, 'take my portrait back');
  const shoot = h('div.stack', {},
    h('label.btn.go', { htmlFor: 'shot' }, 'take a selfie'), file, preview,
    h('div', { hidden: true, id: 'tune' }, h('label', { htmlFor: 'contrast' }, 'contrast'), contrast),
    h('label.check', {}, consent, ' show my photo on a stranger\'s badge and on phones here for a few minutes'),
    send, withdraw,
    h('p.small', {}, 'your photo goes only to the host, sealed. if the wearer approves it, the room can vote on it. after its turn on the badge it is deleted.'));
  const voteHead = h('p.q', {}, 'which portrait goes on the badge next?');
  const pair = h('div.pair');
  const voteLeft = h('p.prose');
  const vote = h('div.stack', { hidden: true }, voteHead, pair, voteLeft);
  root.append(status, reign, vote, shoot);
  file.hidden = true;

  let view = null, you = null, gray = null, bits = null, shown = '', subs = [];

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = PW;
      cv.height = PH;
      const c = cv.getContext('2d');
      // Crop the middle to the badge's shape.
      const k = Math.max(PW / img.width, PH / img.height), w = PW / k, hgt = PH / k;
      c.drawImage(img, (img.width - w) / 2, (img.height - hgt) / 2, w, hgt, 0, 0, PW, PH);
      const d = c.getImageData(0, 0, PW, PH).data;
      gray = new Float32Array(PW * PH);
      for (let i = 0; i < PW * PH; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      URL.revokeObjectURL(img.src);
      render();
    };
    img.src = URL.createObjectURL(f);
  });
  contrast.addEventListener('input', render);
  consent.addEventListener('change', () => { send.disabled = !(bits && consent.checked); });

  function render() {
    if (!gray) return;
    bits = dither(gray, PW, PH, Number(contrast.value) / 100);
    const c = preview.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, PW, PH);
    portrait(c, packBits(bits, PW, PH), { x: 0, y: 0, w: PW, h: PH });
    preview.hidden = false;
    root.querySelector('#tune').hidden = false;
    send.disabled = !consent.checked;
  }

  async function submit() {
    if (!bits || !consent.checked) return;
    send.disabled = true;
    send.textContent = 'sending';
    const ok = await api.upload(JSON.stringify({ img: packBits(bits, PW, PH), consent: true }));
    send.textContent = 'send my portrait';
    if (ok) { api.note('sent. the wearer approves portraits before anyone sees them.'); gray = bits = null; preview.hidden = true; consent.checked = false; }
    else { send.disabled = false; api.note('could not send. check the connection and try again.', true); }
  }

  function showPair(ids) {
    const key = ids.join('-');
    if (key === shown) return;
    shown = key;
    subs.forEach(stop => stop());
    subs = [];
    pair.replaceChildren();
    for (const id of ids) {
      const cv = h('canvas', { width: PW, height: PH });
      const btn = h('button.photo', { onclick: () => pick(id), 'aria-label': 'vote for this portrait' }, cv);
      pair.append(btn);
      subs.push(api.media(`booth.${id}`, img => {
        const c = cv.getContext('2d');
        c.fillStyle = '#fff';
        c.fillRect(0, 0, PW, PH);
        if (img) portrait(c, img, { x: 0, y: 0, w: PW, h: PH });
      }));
    }
  }

  function pick(id) {
    if (!you || !you.pair.length) return;
    if (api.send('pick', { k: you.k, pick: id })) pair.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }

  function draw() {
    if (!view) return;
    const y = you || { mine: 'none', pair: [] };
    status.textContent = STATUS[y.mine] || '';
    withdraw.hidden = !['pending', 'approved', 'reigning'].includes(y.mine);
    reign.textContent = view.reign ? `on the badge: ${view.reign.name}, ${seconds(api.left(view))} left.` : `${view.approved} portraits in the vote.`;
    vote.hidden = !y.pair || !y.pair.length;
    if (!vote.hidden) { showPair(y.pair); voteLeft.textContent = `${y.left} votes left this turn.`; } else { showPair([]); }
  }

  t.every(1000, () => { if (view && view.reign) reign.textContent = `on the badge: ${view.reign.name}, ${seconds(api.left(view))} left.`; });
  return { update(v, y) { view = v; you = y; draw(); }, destroy() { t.stop(); subs.forEach(s => s()); } };
}
