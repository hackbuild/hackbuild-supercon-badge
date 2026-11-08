// Talks to the badge over its private relay path: signed commands, screens sent in acked chunks,
// and a signed live ink stream. The key never leaves this browser. It names the path and signs
// each message.

// 16000 raw bytes is about 21 KB of base64 per message, well under the relay's 64 KB limit, and
// three chunks travel at once. The badge acks chunks in order and ignores any out of order.
const CHUNK = 16000;
const WINDOW = 3;
const STALL_MS = 4000;
const te = new TextEncoder();
export const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function zlib(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3000) s += String.fromCharCode(...bytes.subarray(i, i + 3000));
  return btoa(s);
}

// One file holding many compressed screens: a frame count, then each frame's offset, then frames.
export function reelBlob(frames) {
  const head = 2 + 4 * frames.length;
  const out = new Uint8Array(head + frames.reduce((n, f) => n + f.length, 0));
  const dv = new DataView(out.buffer);
  dv.setUint16(0, frames.length, true);
  let at = head;
  frames.forEach((f, i) => { dv.setUint32(2 + 4 * i, at, true); out.set(f, at); at += f.length; });
  return out;
}

export class Badge {
  constructor(relay) {
    this.relay = relay;
    this.base = '';
    this.key = null;
    this.state = null;
    this.states = 0;
    this.online = false;
    this.lastState = 0;
    this.queue = Promise.resolve();
    this.nonceWaiters = [];
    this.ackWaiters = new Set();
    this.xfer = 0;
    this.xferId = '';
    this.inkSession = Math.random().toString(36).slice(2, 8);
    this.inkSeq = 0;
    this.onState = () => {};
    this.onOnline = () => {};
    this.onPress = () => {};
    this.acked = new Map();
  }

  async open(secret) {
    this.base = `/hb/badge/${hex(await crypto.subtle.digest('SHA-256', te.encode(secret))).slice(0, 16)}`;
    this.key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    this.relay.on(`${this.base}/**`, (v, a) => this._msg(v, a));
    this.relay.onUp = (prev => () => { prev(); this.hello(); })(this.relay.onUp);
    this.relay.onDown = (prev => () => { prev(); this._offline(); })(this.relay.onDown);
    // The relay keeps the badge's session only while it forwards something to it.
    setInterval(() => this.relay.emit(`${this.base}/keep`, 'k'), 30_000);
    setInterval(() => { if (this.online && Date.now() - this.lastState > 45_000) { this._offline(); this.hello(); } }, 5000);
    this.hello();
  }

  hello() { this.relay.emit(`${this.base}/keep`, 'hello'); }

  _offline() {
    if (!this.online && !this.states) return;
    this.online = false;
    this.states = 0;
    this.onState();
  }

  _msg(value, address) {
    if (address === `${this.base}/state`) {
      try { this.state = JSON.parse(value); } catch (e) { return; }
      this.states++;
      this.lastState = Date.now();
      // The first copy can be the relay's stored one. A second proves the badge is awake.
      if (this.states >= 2 && !this.online) { this.online = true; this.onOnline(); }
      this.nonceWaiters.splice(0).forEach(f => f());
      this.onState();
    } else if (address === `${this.base}/ack`) {
      const [id, n] = String(value).split(':');
      if (id !== this.xferId || !Number.isInteger(Number(n))) return;
      this.acked.set(id, Math.max(this.acked.has(id) ? this.acked.get(id) : -2, Number(n)));
      [...this.ackWaiters].forEach(f => f());
    } else if (address === `${this.base}/press` && (value === 'a' || value === 'b')) {
      this.onPress(value);
    }
  }

  get busy() { return !!(this.state && this.state.busy); }
  get app() { return this.state ? this.state.app : ''; }

  _waitNonce(old, ms) {
    if (this.state && this.state.n !== old) return Promise.resolve(true);
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(false), ms);
      this.nonceWaiters.push(() => { if (this.state && this.state.n !== old) { clearTimeout(t); resolve(true); } });
    });
  }

  command(c, v) {
    const run = async () => {
      if (!this.state) throw new Error('no badge yet');
      // A session renewal on the badge takes a few seconds, so one lost command is sent again.
      for (let attempt = 0; attempt < 2; attempt++) {
        const nonce = this.state.n;
        const body = JSON.stringify({ n: nonce, c, v });
        const sig = hex(await crypto.subtle.sign('HMAC', this.key, te.encode(body)));
        this.relay.emit(`${this.base}/cmd`, `${sig}:${body}`);
        if (await this._waitNonce(nonce, attempt ? 12000 : 7000)) return;
      }
      throw new Error('the badge did not answer.');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  play(mode, extra = {}) { return this.command('play', { mode, ...extra }); }

  // Resolves when the badge has acked chunk n or later, or after ms with whether it did.
  _waitAcked(id, n, ms) {
    return new Promise(resolve => {
      const done = () => (this.acked.get(id) ?? -2) >= n;
      if (done()) { resolve(true); return; }
      const finish = ok => { clearTimeout(t); this.ackWaiters.delete(check); resolve(ok); };
      const check = () => { if (done()) finish(true); };
      const t = setTimeout(() => finish(done()), ms);
      this.ackWaiters.add(check);
    });
  }

  // Sends a file in chunks, a few at a time. When the acks stall, it goes back to the first chunk
  // the badge has not acked and sends from there, so a dropped message costs one pause. The badge
  // holds one transfer and a new start replaces it, so a newer send or cancel() ends this loop.
  async _transfer(cmd, bytes, extra) {
    const mine = ++this.xfer;
    const id = Math.random().toString(36).slice(2, 8);
    this.xferId = id;
    const current = () => { if (mine !== this.xfer) throw new Error('a newer send replaced this one.'); };
    try {
      const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
      const total = Math.ceil(bytes.length / CHUNK);
      await this.command(cmd, { id, size: bytes.length, sha, ...extra });
      current();
      if (!await this._waitAcked(id, -1, 10000)) throw new Error('the badge did not start the transfer.');
      current();
      let sent = 0, stalls = 0;
      const send = i => this.relay.emit(`${this.base}/chunk`, `${id}:${i}:${b64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK))}`);
      while ((this.acked.get(id) ?? -2) < total - 1) {
        const acked = this.acked.get(id) ?? -1;
        if (sent <= acked) sent = acked + 1;
        while (sent < total && sent - acked <= WINDOW) send(sent++);
        const moved = await this._waitAcked(id, acked + 1, STALL_MS);
        current();
        if (moved) { stalls = 0; continue; }
        if (++stalls > 4) throw new Error('the badge stopped answering during the send.');
        sent = (this.acked.get(id) ?? -1) + 1;
      }
    } finally {
      if (this.xferId === id) this.xferId = '';
      this.acked.delete(id);
    }
  }

  // Stops the send in progress, so chunks of a screen nobody wants stop going out.
  cancel() { this.xfer++; }

  // A compressed screen. Resolves once every chunk is acked, before the panel has drawn it.
  // to: 'play' sends it to the games app, then: 'ink' makes it the page live ink draws on.
  sendScreen(z, { color = false, to = '', then = '' } = {}) { return this._transfer('img', z, { color, to, then }); }

  // loops 0 plays the reel until something else is sent.
  sendReel(blob, { loops = 2 } = {}) { return this._transfer('reel', blob, { loops }); }

  // Drains the badge's LED bar over ms, for a game phase. Fire and forget.
  lights(ms, color = [0, 0, 6]) { return this.command('lights', { ms, c: color }).catch(() => {}); }

  // One live ink batch. Numbered rather than nonced, so a stream never waits a round trip.
  async ink(strokes) {
    const seq = ++this.inkSeq;
    const msg = `${this.inkSession}:${seq}:${strokes}`;
    const sig = hex(await crypto.subtle.sign('HMAC', this.key, te.encode(msg))).slice(0, 32);
    this.relay.emit(`${this.base}/ink`, `${this.inkSession}:${seq}:${sig}:${strokes}`);
  }

  // Waits for the panel to start and then finish a redraw. Only a busy report that arrived after
  // the send counts: the tail of the previous redraw must not pass for this one.
  waitDrawn(ms = 60000) {
    return new Promise(resolve => {
      const t0 = Date.now(), from = this.states;
      let seenBusy = false;
      const iv = setInterval(() => {
        if (this.busy && this.states > from) seenBusy = true;
        const neverStarted = !seenBusy && Date.now() - t0 > 8000;
        if ((seenBusy && !this.busy) || neverStarted || Date.now() - t0 > ms) { clearInterval(iv); resolve(!this.busy); }
      }, 150);
    });
  }
}
