// The host's arcade panel: load a rom, run it with EmulatorJS (GPL-3.0, loaded from its CDN at
// run time and never copied here), press what the phones hold, and hand the badge snapshots.
import { h } from '../../lib/phone-kit.js';
import { dither, packBits } from '../../lib/screen.js';
import { CONSOLES, STICK, FULL, consoleFor, inputs } from './consoles.js';
import { onPads, held, sticks } from './rules.js';

const EJS_DATA = 'https://cdn.emulatorjs.org/stable/data/';
const PRESETS = [{ name: 'smash', url: 'https://doot.sfo3.cdn.digitaloceanspaces.com/roms/smash.z64' }];
const FW = 240, FH = 168;
// The badge keeps only the newest frame, so sending faster than it draws costs nothing but
// relay traffic, and what it draws is never more than this old.
const SNAP_MS = 400;

// EmulatorJS keeps one game per page, so it lives as long as the page does.
let running = null;

export function mount(el, engine) {
  const url = h('input', { id: 'romUrl', placeholder: 'https://.../game.nes', autocomplete: 'off', inputmode: 'url' });
  const file = h('input', { type: 'file', id: 'romFile' });
  const msg = h('p.prose');
  const start = h('button.btn.go', { type: 'button', hidden: true, onclick: () => boot() }, 'start the game');
  const screen = h('div', { id: 'arcadeGame', style: { width: '100%', aspectRatio: '4 / 3', background: '#000' } });
  el.append(
    h('h3', {}, 'load a game'),
    h('div.pair2', {}, ...PRESETS.map(p => h('button.btn', { type: 'button', onclick: () => choose(p.name, p.url) }, p.name))),
    h('div', {}, h('label', { htmlFor: 'romUrl' }, 'rom link'), url),
    h('button.btn', { type: 'button', onclick: () => { const u = url.value.trim(); if (/^https:\/\/\S+$/.test(u)) choose(u.split('/').pop(), u); else say('paste a link that starts with https.'); } }, 'load the link'),
    h('div', {}, h('label', { htmlFor: 'romFile' }, 'a rom file from this device'), file),
    start, msg, screen,
    h('p.small', {}, 'nes, snes, n64, game boy, gba, genesis and master system. play only games you own or homebrew. the sound plays from this device.'));

  function say(t) { msg.textContent = t; }
  const ctx = () => engine.ctx(Date.now());
  const state = () => (engine.room.kind === 'arcade' && engine.rules ? ctx().state : null);

  function choose(name, src, blob) {
    const core = consoleFor(name.includes('.') ? name : src);
    if (!core) { say('that file type is not a console here. use .nes .sfc .z64 .gb .gbc .gba .md or .sms.'); return; }
    if (!state()) return;
    if (running) {
      // A second game needs a fresh page; the room keeps the choice across the reload.
      engine.rules.load(ctx(), { name: name.replace(/\.[^.]+$/, ''), core, url: blob ? '' : src });
      engine.dirty.view = engine.dirty.save = true;
      say('reloading the page to switch games.');
      setTimeout(() => location.reload(), 600);
      return;
    }
    engine.rules.load(ctx(), { name: name.replace(/\.[^.]+$/, ''), core, url: blob ? '' : src });
    engine.dirty.view = engine.dirty.save = engine.dirty.stage = true;
    boot(blob);
  }

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (f) choose(f.name, URL.createObjectURL(f), true);
  });

  function boot(blob) {
    const s = state();
    if (!s || !s.rom || running) return;
    const src = blob ? URL.createObjectURL(file.files[0]) : s.rom.url;
    if (!src) { say('pick the rom file again: a file does not survive a reload.'); return; }
    start.hidden = true;
    say(`loading ${s.rom.name}. the first load downloads the emulator, so give it a moment.`);
    Object.assign(window, {
      EJS_player: '#arcadeGame', EJS_core: s.rom.core, EJS_gameUrl: src, EJS_gameName: s.rom.name,
      EJS_pathtodata: EJS_DATA, EJS_startOnLoaded: true, EJS_color: '#FE0386',
      EJS_onGameStart: () => say(`${s.rom.name} is running. phones are the controllers.`),
    });
    document.body.append(h('script', { src: `${EJS_DATA}loader.js` }));
    running = { core: s.rom.core, pads: [], sticks: [] };
  }

  // Phones' buttons, pressed on the emulator as soon as they change.
  function press(s) {
    const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!running || !gm || !gm.simulateInput || !s.rom) return;
    const seats = Math.max(1, Math.min(engine.room.cfg.arcade.seats, CONSOLES[running.core].max));
    const now = held(s, seats, ctx().active), map = inputs(running.core);
    now.forEach((m, seat) => {
      const was = running.pads[seat] || 0;
      if (m === was) return;
      map.forEach(([idx, val], bit) => { const on = m & (1 << bit); if (on !== (was & (1 << bit))) gm.simulateInput(seat, idx, on ? val : 0); });
      running.pads[seat] = m;
    });
    for (let seat = now.length; seat < running.pads.length; seat++) running.pads[seat] = 0;
    if (!CONSOLES[running.core].stick) return;
    sticks(s, seats, ctx().active).forEach(([x, y], seat) => {
      const was = running.sticks[seat] || [0, 0];
      if (x === was[0] && y === was[1]) return;
      const v = n => Math.round((FULL * Math.max(0, n)) / 100);
      gm.simulateInput(seat, STICK.right, v(x));
      gm.simulateInput(seat, STICK.left, v(-x));
      gm.simulateInput(seat, STICK.down, v(y));
      gm.simulateInput(seat, STICK.up, v(-y));
      running.sticks[seat] = [x, y];
    });
  }
  const off = onPads(press);

  // Snapshots for the badge and projector, read through a video of the game canvas because a
  // WebGL canvas reads back blank once it has been shown.
  const small = Object.assign(document.createElement('canvas'), { width: FW, height: FH });
  const sc = small.getContext('2d', { willReadFrequently: true });
  let video = null;
  const snap = setInterval(() => {
    const s = state();
    if (!s || !running) return;
    const canvas = screen.querySelector('canvas');
    if (!canvas) return;
    if (!video) {
      try { video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: canvas.captureStream(15) }); video.play().catch(() => {}); } catch (e) { return; }
    }
    if (video.readyState < 2) return;
    sc.fillStyle = '#fff';
    sc.fillRect(0, 0, FW, FH);
    const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(FW / vw, FH / vh);
    sc.drawImage(video, (FW - vw * k) / 2, (FH - vh * k) / 2, vw * k, vh * k);
    const d = sc.getImageData(0, 0, FW, FH).data, gray = new Float32Array(FW * FH);
    for (let i = 0; i < FW * FH; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const bits = packBits(dither(gray, FW, FH, 0.2), FW, FH);
    engine.rules.snapshot(ctx(), { bits, w: FW, h: FH });
    engine.dirty.stage = true;
    if (engine.output && engine.badge.online) engine.badge.frame(bits).catch(() => {});
  }, SNAP_MS);

  return {
    update() {
      const s = state();
      start.hidden = !(s && s.rom && !running);
      if (s && s.rom && !running && !msg.textContent) say(`${s.rom.name} is ready. press start the game.`);
      if (!s) { clearInterval(snap); off(); }
    },
  };
}
