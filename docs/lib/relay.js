// One relay connection that never gives up. The CLASP client's own reconnect stops after ten tries,
// a send while the socket is down is dropped without a word, and relay.clasp.to forgets a session's
// subscriptions after 300 s in which it forwarded nothing to it. So this rebuilds the client itself,
// with jittered and capped backoff, restores every subscription, and renews a quiet session.

export const RELAY_URL = 'wss://relay.clasp.to';
const RENEW_QUIET_MS = 240_000;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;

export class Relay {
  constructor(name, url = RELAY_URL) {
    this.name = name;
    this.url = url;
    this.client = null;
    this.up = false;
    this.subs = [];
    this.tries = 0;
    this.lastRx = 0;
    this.closed = false;
    this.opening = false;
    this.retryTimer = 0;
    this.onUp = () => {};
    this.onDown = () => {};
    this.watch = setInterval(() => this._check(), 5000);
    document.addEventListener('visibilitychange', () => {
      // A phone that slept usually wakes holding a dead socket that still reads as open.
      if (document.visibilityState === 'visible' && (!this.up || Date.now() - this.lastRx > 20_000)) this.rebuild();
    });
  }

  start() { this._open(); return this; }

  on(pattern, cb) {
    const sub = { pattern, cb, off: null };
    this.subs.push(sub);
    if (this.client && this.up) sub.off = this._subscribe(this.client, sub);
    return () => {
      this.subs = this.subs.filter(s => s !== sub);
      try { sub.off && sub.off(); } catch (e) { /* the client may already be gone */ }
    };
  }

  // Both return false when the message could not go out, so callers can decide to resend.
  set(address, value) { return this._send('set', address, value); }
  emit(address, value) { return this._send('emit', address, value); }

  rebuild() {
    if (this.closed) return;
    this._drop();
    clearTimeout(this.retryTimer);
    this.tries = 0;
    this._open();
  }

  close() {
    this.closed = true;
    clearInterval(this.watch);
    clearTimeout(this.retryTimer);
    this._drop();
  }

  _subscribe(client, sub) {
    return client.on(sub.pattern, (value, address) => {
      this.lastRx = Date.now();
      try { sub.cb(value, address); } catch (e) { console.error(e); }
    });
  }

  _send(kind, address, value) {
    if (!this.client || !this.up) return false;
    try {
      this.client[kind](address, value);
      return true;
    } catch (e) {
      this.rebuild();
      return false;
    }
  }

  _check() {
    if (this.closed || !this.up) return;
    if (Date.now() - this.lastRx > RENEW_QUIET_MS) this.rebuild();
  }

  _drop() {
    const c = this.client;
    this.client = null;
    const was = this.up;
    this.up = false;
    for (const s of this.subs) s.off = null;
    if (c) { try { c.close(); } catch (e) { /* already closed */ } }
    if (was) this.onDown();
  }

  async _open() {
    if (this.closed || this.opening) return;
    if (!window.CLASP) { this._retry(); return; }
    this.opening = true;
    const c = new CLASP.Clasp(this.url, { name: this.name, reconnect: false });
    try {
      await Promise.race([
        c.connect(),
        new Promise((_, no) => setTimeout(() => no(new Error('connect timed out')), CONNECT_TIMEOUT_MS)),
      ]);
    } catch (e) {
      this.opening = false;
      try { c.close(); } catch (x) { /* never opened */ }
      this._retry();
      return;
    }
    this.opening = false;
    if (this.closed) { try { c.close(); } catch (e) {} return; }
    this.client = c;
    this.up = true;
    this.tries = 0;
    this.lastRx = Date.now();
    c.onDisconnect?.(() => {
      if (this.client !== c) return;
      this._drop();
      this._retry();
    });
    for (const s of this.subs) s.off = this._subscribe(c, s);
    this.onUp();
  }

  _retry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.tries);
    this.tries++;
    this.retryTimer = setTimeout(() => this._open(), base * (0.5 + Math.random()));
  }
}

// Short random ids for players and rounds. No I, O, 0 or 1, so a code read off a badge is unambiguous.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function code(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => ALPHA[x % ALPHA.length]).join('');
}

export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
