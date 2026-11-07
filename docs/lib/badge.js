// Talks to the badge over its private relay path: signed commands, and screens sent in acked chunks.
// The key never leaves this browser. It names the path and signs each command.

const CHUNK = 9000;
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
    this.ackWaiter = null;
    this.onState = () => {};
  }

  async open(secret) {
    this.base = `/hb/badge/${hex(await crypto.subtle.digest('SHA-256', te.encode(secret))).slice(0, 16)}`;
    this.key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    this.relay.on(`${this.base}/**`, (v, a) => this._msg(v, a));
    this.relay.onUp = (prev => () => { prev(); this.hello(); })(this.relay.onUp);
    this.relay.onDown = (prev => () => { prev(); this.online = false; this.states = 0; this.onState(); })(this.relay.onDown);
    // The relay keeps the badge's session only while it forwards something to it.
    setInterval(() => this.relay.emit(`${this.base}/keep`, 'k'), 30_000);
    setInterval(() => {
      if (this.online && Date.now() - this.lastState > 45_000) { this.online = false; this.states = 0; this.onState(); this.hello(); }
    }, 5000);
    this.hello();
  }

  hello() { this.relay.emit(`${this.base}/keep`, 'hello'); }

  _msg(value, address) {
    if (address === `${this.base}/state`) {
      try { this.state = JSON.parse(value); } catch (e) { return; }
      this.states++;
      this.lastState = Date.now();
      // The first copy can be the relay's stored one. A second proves the badge is awake.
      if (this.states >= 2) this.online = true;
      this.nonceWaiters.splice(0).forEach(f => f());
      this.onState();
    } else if (address === `${this.base}/ack` && this.ackWaiter) {
      this.ackWaiter(String(value));
    }
  }

  get busy() { return !!(this.state && this.state.busy); }

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

  _waitAck(want) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.ackWaiter = null; reject(new Error('the badge stopped answering during the send.')); }, 20000);
      this.ackWaiter = got => { if (got === want) { clearTimeout(t); this.ackWaiter = null; resolve(); } };
    });
  }

  // Sends one compressed screen. Resolves once every chunk is acked, before the panel has drawn it.
  async sendScreen(z, color = false) {
    const sha = hex(await crypto.subtle.digest('SHA-256', z));
    const id = Math.random().toString(36).slice(2, 8);
    const count = Math.ceil(z.length / CHUNK);
    const started = this._waitAck(`${id}:-1`);
    await this.command('img', { id, size: z.length, sha, color });
    await started;
    for (let i = 0; i < count; i++) {
      const acked = this._waitAck(`${id}:${i}`);
      this.relay.emit(`${this.base}/chunk`, `${id}:${i}:${b64(z.subarray(i * CHUNK, (i + 1) * CHUNK))}`);
      await acked;
    }
  }

  // Waits for the panel to start and then finish a redraw.
  waitDrawn(ms = 45000) {
    return new Promise(resolve => {
      const t0 = Date.now();
      let seenBusy = this.busy;
      const iv = setInterval(() => {
        if (this.busy) seenBusy = true;
        const quietStart = !seenBusy && Date.now() - t0 > 8000;
        if ((seenBusy && !this.busy) || quietStart || Date.now() - t0 > ms) { clearInterval(iv); resolve(!this.busy); }
      }, 150);
    });
  }
}
