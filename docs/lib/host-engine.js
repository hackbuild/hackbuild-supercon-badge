// The host: the one writer of game state for a room. Phones write only their own input; this
// applies it through the running game's rules, publishes what each phone and the badge should
// show, and keeps the room in this browser so a reload carries on.
//
// Lessons from running doot with 145 phones on the same relay shape this file:
// one writer; presence by heartbeat arrival, never by comparing clocks; a missed heartbeat never
// takes anything away; every send can vanish, so state is republished; one list never goes to
// every phone when a per phone address will do.

import { Relay } from './relay.js';
import { Badge, zlib, reelBlob } from './badge.js';
import * as proto from './protocol.js';
import * as S from './screen.js';
import * as seal from './seal.js';
import * as credit from './credit.js';
import { cleanName } from './words.js';
import { GAMES, rulesFor } from '../games/registry.js';

const SAVE_KEY = 'hb.host.room.v2';
const HOST_KEYS = 'hb.host.keys';
const ACTIVE_MS = 45_000;
const VIEW_GAP_MS = 250, VIEW_GAP_BIG_MS = 500, REPUBLISH_MS = 20_000;
const YOU_PER_TICK = 40;
const LIVE_FLUSH_MS = 150;

export class HostEngine {
  constructor(secret, onChange) {
    this.secret = secret;
    this.onChange = onChange;
    this.say = '';
    this.sayBad = false;
    this.owner = true;
    this.token = Math.random().toString(36).slice(2, 10);
    this.seen = new Map();
    this.lastYou = new Map();
    this.youQueue = new Set();
    this.dirty = { view: true, board: true, save: false, stage: true };
    this.last = { view: 0, board: 0, beat: 0, stage: 0, live: 0, ui: 0 };
    this.liveQueue = [];
    this.jobs = 0;
    this.pending = new Map();
    this.pipe = { busy: false, key: '', at: 0, retryAt: 0, inkMode: false, gen: 0 };
    this.frame = document.createElement('canvas');
    this.frame.width = S.W;
    this.frame.height = S.H;
  }

  // ---- start ----

  async start() {
    this.code = await proto.roomCode(this.secret);
    this.p = proto.paths(this.code);
    this.join = { url: proto.joinUrl(this.code, location.hostname.endsWith('github.io') ? proto.PUBLIC_BASE : new URL('.', location.href).href), code: this.code };
    this.room = this.load();
    this.keys = await seal.keypair(HOST_KEYS);
    this.publicKey = await seal.publicJwk(this.keys);
    this.creditKey = await credit.creditKey(this.secret);
    await S.loadFonts();
    if (this.room.kind) this.rules = await rulesFor(this.room.kind);

    this.relay = new Relay('hack.build games host');
    this.badge = new Badge(this.relay);
    let claimed = false;
    this.relay.onUp = () => {
      this.dirty.view = this.dirty.board = this.dirty.stage = true;
      this.relay.set(this.p.hostKey, JSON.stringify(this.publicKey));
      if (!claimed) { claimed = true; this.claim(); }
      this.changed();
    };
    this.relay.onDown = () => this.changed();
    // A badge whose uptime went backwards rebooted, and lost whatever it was showing.
    let lastUp = 0;
    this.badge.onState = () => {
      const up = this.badge.state && this.badge.state.up;
      if (up < lastUp) this.badgeBack();
      lastUp = up || 0;
      this.changed();
    };
    this.badge.onOnline = () => this.badgeBack();
    this.badge.onPress = b => this.press(b);
    this.relay.on(this.p.owner, v => this.onOwner(v));
    this.relay.on(this.p.inputs, (v, a) => this.onInput(v, a));
    this.relay.on(this.p.whos, (v, a) => this.onWho(v, a));
    this.relay.on(this.p.uploads, (v, a) => this.onUpload(v, a));
    this.relay.on(this.p.beat, v => this.onBeat(v));
    this.relay.on(this.p.hb, () => {});
    this.relay.start();
    await this.badge.open(this.secret);

    // A browser throttles timers on a page it thinks nobody is looking at, which stalls every
    // round. A worker's timers keep running, so the game clock lives there.
    try {
      const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250)'], { type: 'text/javascript' })));
      ticker.onmessage = () => this.loop();
    } catch (e) {
      setInterval(() => this.loop(), 250);
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') this.save(); });
    addEventListener('pagehide', () => this.save());
    this.tell(this.room.kind ? 'picked up the saved game.' : 'pick a game to start.');
  }

  load() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* a broken save starts fresh */ }
    if (!r || r.v !== proto.PROTOCOL) {
      r = { v: proto.PROTOCOL, kind: null, epoch: proto.code(6), names: {}, keys: {}, scores: {}, banned: {}, seq: {},
        credits: {}, cfg: {}, games: {} };
    }
    r.cfg.credits = { on: true, max: 20, ...(r.cfg.credits || {}) };
    for (const g of GAMES) {
      const defaults = Object.fromEntries((g.settings || []).map(s => [s.key, s.def]));
      r.cfg[g.id] = { ...defaults, ...(r.cfg[g.id] || {}) };
    }
    return r;
  }

  save() {
    this.dirty.save = false;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.room)); } catch (e) { this.tell('this browser would not save the room. it keeps running, but a reload starts over.', true); }
  }

  tell(text, bad = false) { this.say = text; this.sayBad = bad; this.changed(); }
  changed() { this.dirty.ui = true; }

  // ---- ownership ----

  claim() {
    this.owner = true;
    this.claimedAt = Date.now();
    this.relay.set(this.p.owner, this.token);
    this.dirty.view = this.dirty.board = this.dirty.stage = true;
    this.last.view = 0;
    this.tell(this.room.kind ? 'hosting from this device.' : 'pick a game to start.');
  }

  onOwner(value) {
    const mine = String(value) === this.token;
    // The relay's stored copy from before this page claimed the room can land just after the claim.
    if (!mine && Date.now() - this.claimedAt < 3000) return;
    if (mine === this.owner) return;
    this.owner = mine;
    if (!mine) this.tell('another device is hosting this room now. this page has stopped.', true);
    this.changed();
  }

  // ---- the game context handed to rules ----

  ctx(now) {
    const room = this.room, kind = room.kind;
    return {
      now, room, epoch: room.epoch,
      state: room.games[kind],
      cfg: room.cfg[kind],
      active: this.active(now),
      join: this.join,
      name: pid => room.names[pid] || 'someone',
      award: (pid, n) => { if (pid && n && !room.banned[pid]) { room.scores[pid] = (room.scores[pid] || 0) + n; this.dirty.board = true; } },
      win: (pid, why) => this.win(pid, why),
      you: pid => this.youQueue.add(pid),
      stream: data => this.liveQueue.push(data),
      media: (id, data) => this.relay.set(this.p.media(id), data || ''),
      clearUpload: pid => this.relay.set(this.p.upload(pid), ''),
      opened: pid => this.pending.get(pid),
      // Slow work a game needs, like decoding a GIF. The view updates when it finishes.
      job: fn => {
        this.jobs++;
        this.changed();
        Promise.resolve().then(() => fn(this.ctx(Date.now()))).catch(e => this.tell(`${e.message}`, true))
          .finally(() => { this.jobs--; this.dirty.view = this.dirty.stage = this.dirty.save = true; this.changed(); });
      },
    };
  }

  active(now) {
    const out = [];
    for (const [pid, t] of this.seen) {
      if (now - t < ACTIVE_MS) { if (!this.room.banned[pid]) out.push(pid); } else if (now - t > 900_000) this.seen.delete(pid);
    }
    return out;
  }

  // ---- phones ----

  onInput(value, address) {
    const pid = proto.pidOf(address);
    if (!proto.PID.test(pid)) return;
    let msg;
    try { msg = JSON.parse(value); } catch (e) { return; }
    const now = Date.now();
    this.seen.set(pid, now);
    if (!this.owner || !this.rules) return;
    if (this.room.banned[pid]) { this.sendYou(pid, { removed: true }); return; }
    if (msg.e !== this.room.epoch || !(msg.s > (this.room.seq[pid] || 0))) return;
    this.room.seq[pid] = msg.s;
    const fn = this.rules.input && this.rules.input[msg.t];
    if (!fn) return;
    const r = fn(this.ctx(now), pid, msg) || {};
    this.dirty.save = true;
    if (r.changed) this.dirty.view = this.dirty.stage = true;
    this.youQueue.add(pid);
    if (r.note) this.sendYou(pid, { note: r.note });
  }

  onWho(value, address) {
    const pid = proto.pidOf(address);
    if (!proto.PID.test(pid)) return;
    let who;
    try { who = JSON.parse(value); } catch (e) { who = { name: value }; }
    const name = cleanName(who.name, pid);
    if (this.room.names[pid] !== name) { this.room.names[pid] = name; this.dirty.save = this.dirty.board = true; }
    if (who.key && who.key.x) this.room.keys[pid] = who.key;
  }

  onBeat(value) {
    const pid = String(value);
    if (!proto.PID.test(pid)) return;
    this.seen.set(pid, Date.now());
    this.youQueue.add(pid);
  }

  async onUpload(value, address) {
    const pid = proto.pidOf(address);
    if (!value || !proto.PID.test(pid) || !this.room.keys[pid] || this.room.banned[pid] || !this.rules || !this.rules.upload) return;
    try {
      const bytes = await seal.open(this.keys, this.room.keys[pid], value);
      const r = this.rules.upload(this.ctx(Date.now()), pid, seal.td.decode(bytes)) || {};
      if (r.changed) this.dirty.view = this.dirty.stage = this.dirty.save = true;
      this.youQueue.add(pid);
      this.changed();
    } catch (e) { /* an upload sealed for another host key, or damaged, is dropped */ }
  }

  // ---- private state for one phone ----

  youOf(pid, ctx) {
    const base = { e: this.room.epoch };
    const c = this.room.credits[pid];
    if (c && c.sealed) base.credit = { sealed: c.sealed, why: c.why, code: credit.shortCode(c.token) };
    if (this.room.banned[pid]) return { ...base, removed: true };
    return { ...base, ...(this.rules && this.rules.you ? this.rules.you(ctx, pid) || {} : {}) };
  }

  sendYou(pid, obj) {
    return this.relay.set(this.p.you(pid), JSON.stringify({ e: this.room.epoch, ...obj }));
  }

  flushYou(ctx) {
    let n = 0;
    const keyOf = pid => {
      const c = this.room.credits[pid];
      return `${this.room.epoch}.${c ? 1 : 0}.${this.room.banned[pid] ? 1 : 0}.${this.rules && this.rules.youKey ? this.rules.youKey(ctx, pid) : ''}`;
    };
    // Phones whose part changed with the phase get it without asking, a few dozen per tick.
    for (const pid of ctx.active) if (this.lastYou.get(pid) !== keyOf(pid)) this.youQueue.add(pid);
    for (const pid of this.youQueue) {
      if (n++ >= YOU_PER_TICK) break;
      this.youQueue.delete(pid);
      const k = keyOf(pid);
      if (this.relay.set(this.p.you(pid), JSON.stringify(this.youOf(pid, ctx)))) this.lastYou.set(pid, k);
    }
  }

  // ---- credits ----

  async win(pid, why) {
    const c = this.room.cfg.credits;
    const given = Object.keys(this.room.credits).length;
    if (!c.on || given >= c.max || this.room.credits[pid] || this.room.banned[pid]) return false;
    const key = this.room.keys[pid];
    const token = await credit.makeToken(this.creditKey);
    // Sealed to the winner's phone, so nobody watching the relay can copy it onto their own coin first.
    const sealed = key ? await seal.seal(this.keys, key, seal.te.encode(token)) : '';
    this.room.credits[pid] = { token, sealed, why, at: Date.now(), given: false };
    this.dirty.save = true;
    this.youQueue.add(pid);
    this.tell(`${this.room.names[pid] || 'someone'} won a capsule credit, code ${credit.shortCode(token)}.`);
    return true;
  }

  // ---- the loop ----

  loop() {
    if (!this.owner || !this.room) return;
    const now = Date.now();
    const ctx = this.room.kind && this.rules ? this.ctx(now) : null;
    if (ctx && this.rules.tick && this.rules.tick(ctx)) { this.dirty.view = this.dirty.stage = this.dirty.save = true; this.dirty.board = true; }
    this.publish(now, ctx);
    if (ctx) this.flushYou(ctx);
    this.flushLive(now);
    this.pipeline(now, ctx);
    if (this.dirty.save) this.save();
    if (this.dirty.ui && now - this.last.ui > 300) { this.dirty.ui = false; this.last.ui = now; this.onChange(); }
  }

  publish(now, ctx) {
    const players = this.active(now).length;
    const gap = players > 60 ? VIEW_GAP_BIG_MS : VIEW_GAP_MS;
    if ((this.dirty.view || now - this.last.view > REPUBLISH_MS) && now - this.last.view >= gap) {
      const view = { v: proto.PROTOCOL, kind: this.room.kind, epoch: this.room.epoch, players, top: this.top(5),
        ...(ctx && this.rules.view ? this.rules.view(ctx) : {}) };
      if (this.relay.set(this.p.view, JSON.stringify(view))) { this.dirty.view = false; this.last.view = now; }
    }
    if ((this.dirty.stage || now - this.last.stage > REPUBLISH_MS) && now - this.last.stage >= 400) {
      const model = ctx && this.rules.badge ? this.rules.badge.model(ctx) : null;
      const stage = { v: proto.PROTOCOL, kind: this.room.kind, model, players, top: this.top(8), join: this.join };
      if (this.relay.set(this.p.stage, JSON.stringify(stage))) { this.dirty.stage = false; this.last.stage = now; }
    }
    if ((this.dirty.board && now - this.last.board > 3000) || now - this.last.board > 60_000) {
      const s = {};
      for (const [pid, n] of Object.entries(this.room.scores)) if (!this.room.banned[pid]) s[pid] = n;
      if (this.relay.set(this.p.board, JSON.stringify({ s }))) { this.dirty.board = false; this.last.board = now; }
    }
    if (now - this.last.beat > 5000 && this.relay.emit(this.p.hb, this.room.epoch)) this.last.beat = now;
  }

  flushLive(now) {
    if (!this.liveQueue.length || now - this.last.live < LIVE_FLUSH_MS) return;
    const batch = this.liveQueue.splice(0).join(';');
    this.last.live = now;
    this.relay.emit(this.p.live, `${this.room.epoch}|${batch}`);
    if (this.pipe.inkMode && this.badge.online && this.output) this.badge.ink(batch).catch(() => {});
  }

  get output() { return this.room.cfg.output !== false; }
  set output(on) { this.room.cfg.output = !!on; this.dirty.save = true; this.pipe.key = ''; this.changed(); }

  // Sends the badge a new screen whenever the game's screen key changed and the last one is drawn.
  async pipeline(now, ctx) {
    const pipe = this.pipe;
    if (!ctx || !this.rules.badge || !this.output || pipe.busy || !this.badge.online || now < pipe.retryAt) return;
    const b = this.rules.badge;
    if (b.mode === 'ink') {
      // The page key changes on a new page. Entering live ink sends the drawing so far as the page,
      // so a badge that rebooted or was taken over from its menu comes back with every stroke.
      const key = b.key(ctx);
      if (pipe.inkMode && pipe.key === key && this.badge.app === 'play') return;
      return this.run(async live => {
        const c = this.frame.getContext('2d');
        S.clear(c, S.palette(false));
        b.snapshot(ctx, c);
        await this.badge.sendScreen(await zlib(S.toPlanes(c)), { to: 'play', then: 'ink' });
        if (!live()) return;
        pipe.inkMode = true;
        pipe.key = key;
        this.tell('the badge is in live ink. strokes show in about a second.');
      });
    }
    pipe.inkMode = false;
    this.lights(ctx);
    // An endless reel reads busy forever, and a reel left from the last game is stale: both may be
    // interrupted. Anything else the badge is drawing is waited for.
    const st = this.badge.state || {};
    const stale = st.play === 'reel' && pipe.reelOf !== pipe.gen;
    if (this.badge.busy && !st.loop && !stale) return;
    // While a game runs the badge belongs to it; a badge moved off Play from its menu gets the game back.
    if (this.badge.app && this.badge.app !== 'play') pipe.key = '';
    const reel = b.reel && b.reel(ctx);
    if (reel && reel.key !== pipe.reelKey) {
      return this.run(async live => {
        const frames = [];
        for (const model of reel.frames) frames.push(await zlib(this.render(model)));
        this.tell(`sending a ${frames.length} frame reel to the badge.`);
        await this.badge.sendReel(reelBlob(frames), { loops: reel.loops ?? 2 });
        if (!live()) return;
        pipe.reelKey = reel.key;
        pipe.reelOf = pipe.gen;
        pipe.key = reel.key;
        pipe.at = Date.now();
        if (reel.loops !== 0) await this.badge.waitDrawn(90_000);
        if (live()) this.tell(reel.loops === 0 ? 'the badge is looping it.' : 'the reel played on the badge.');
      });
    }
    const key = b.key(ctx);
    const gap = b.gapMs ? b.gapMs(ctx) : 0;
    if (key === pipe.key || now - pipe.at < gap) return;
    return this.run(async live => {
      const model = b.model(ctx);
      const z = await zlib(this.render(model));
      this.tell(`sending ${(z.length / 1024).toFixed(1)} kb to the badge.`);
      await this.badge.sendScreen(z, { to: 'play' });
      await this.badge.waitDrawn();
      if (!live()) return;
      pipe.key = key;
      pipe.at = Date.now();
      if (b.shown) b.shown(this.ctx(Date.now()), key);
      this.dirty.view = this.dirty.stage = true;
      const s = this.badge.state;
      this.tell(`the badge shows ${this.rules.name}${s && s.fast_ms ? `, ${(s.fast_ms / 1000).toFixed(1)} s to draw` : ''}.`);
    });
  }

  // One badge send at a time. A send belongs to the game that started it: switching games drops
  // it, so a long reel from the last game never holds up the first screen of the next.
  async run(job) {
    const gen = this.pipe.gen;
    const live = () => gen === this.pipe.gen;
    this.pipe.busy = true;
    try { await job(live); } catch (e) {
      if (live()) {
        this.pipe.retryAt = Date.now() + 5000;
        this.tell(`badge send failed. ${e.message} trying again in 5 s.`, true);
      }
    }
    if (live()) this.pipe.busy = false;
    this.changed();
  }

  resetPipe() {
    this.pipe.gen++;
    this.pipe.busy = false;
    this.pipe.key = this.pipe.reelKey = this.pipe.lightKey = '';
    this.pipe.inkMode = false;
    this.pipe.retryAt = 0;
  }

  render(model) {
    const c = this.frame.getContext('2d');
    S.clear(c, S.palette(false));
    this.rules.screen.draw(c, model, { color: false, join: this.join });
    return S.toPlanes(c);
  }

  // The LED bar drains over the current phase, sent once per phase.
  lights(ctx) {
    const b = this.rules.badge, cd = b.countdown && b.countdown(ctx);
    if (!cd || cd.key === this.pipe.lightKey) return;
    this.pipe.lightKey = cd.key;
    this.badge.lights(Math.max(0, Math.round(cd.ms)));
  }

  // User A and user B on the badge run the game's first and second controls.
  press(button) {
    if (!this.owner || !this.rules || !this.rules.controls) return;
    const ctx = this.ctx(Date.now());
    const list = this.rules.controls(ctx), c = list[button === 'a' ? 0 : 1];
    if (!c) return;
    c.run(ctx);
    this.dirty.view = this.dirty.stage = this.dirty.save = true;
    this.tell(`badge button ${button}: ${c.label}.`);
  }

  // A badge that was offline missed screens and strokes, so it gets the current state again.
  badgeBack() {
    this.pipe.key = '';
    this.pipe.reelKey = '';
    this.pipe.lightKey = '';
    this.pipe.inkMode = false;
    this.changed();
  }

  // ---- what the host page drives ----

  async startGame(kind) {
    // A second tap on the running game must not restart it in front of a room.
    if (!this.owner || (this.room.kind === kind && this.rules)) return;
    const rules = await rulesFor(kind);
    if (this.rules && this.rules.stop && this.room.kind) this.rules.stop(this.ctx(Date.now()));
    this.rules = rules;
    this.room.kind = kind;
    this.room.epoch = proto.code(6);
    this.room.seq = {};
    const now = Date.now();
    const ctx0 = { ...this.ctx(now), state: this.room.games[kind] };
    this.room.games[kind] = rules.init(ctx0);
    this.lastYou.clear();
    this.resetPipe();
    this.dirty.view = this.dirty.stage = this.dirty.save = true;
    if (this.badge.online && this.badge.state && this.badge.state.quality === 'color') this.badge.command('quality', 'fast').catch(() => {});
    this.tell(`starting ${rules.name}.`);
  }

  async stopGames() {
    if (!this.owner) return;
    if (this.rules && this.rules.stop && this.room.kind) this.rules.stop(this.ctx(Date.now()));
    this.room.kind = null;
    this.rules = null;
    this.room.epoch = proto.code(6);
    this.dirty.view = this.dirty.stage = this.dirty.save = true;
    this.resetPipe();
    this.badge.lights(0);
    this.tell('games stopped. the badge shows the join screen.');
    try { await this.badge.play('join'); } catch (e) { this.tell(`could not reach the badge. ${e.message}`, true); }
  }

  control(i) {
    if (!this.owner || !this.rules || !this.rules.controls) return;
    const ctx = this.ctx(Date.now());
    const c = this.rules.controls(ctx)[i];
    if (c) { c.run(ctx); this.dirty.view = this.dirty.stage = this.dirty.save = true; this.changed(); }
  }

  setting(game, key, value) {
    this.room.cfg[game][key] = value;
    this.dirty.save = this.dirty.view = true;
  }

  remove(pid) { this.room.banned[pid] = 1; this.dirty.save = this.dirty.board = this.dirty.view = true; this.youQueue.add(pid); this.changed(); }
  letBack(pid) { delete this.room.banned[pid]; this.dirty.save = this.dirty.board = this.dirty.view = true; this.lastYou.delete(pid); this.youQueue.add(pid); this.changed(); }
  markGiven(pid) { const c = this.room.credits[pid]; if (c) { c.given = !c.given; this.dirty.save = true; this.changed(); } }

  top(n) {
    return Object.entries(this.room.scores).filter(([pid]) => !this.room.banned[pid])
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([pid, s]) => [this.room.names[pid] || 'someone', s]);
  }

  players() { return this.active(Date.now()).length; }

  hostState() {
    const ctx = this.room.kind && this.rules ? this.ctx(Date.now()) : null;
    return {
      ctx,
      stats: ctx && this.rules.stats ? this.rules.stats(ctx) : [],
      controls: ctx && this.rules.controls ? this.rules.controls(ctx).map(c => c.label) : [],
      panel: ctx && this.rules.panel ? this.rules.panel(ctx) : null,
      headline: ctx && this.rules.headline ? this.rules.headline(ctx) : null,
    };
  }
}
