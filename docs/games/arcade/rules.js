// Retro arcade: a game console runs in the host page and the phones are its controllers.
// Each phone sends the buttons it is holding as one bitmask. The host splits the room into as
// many controllers as the setting asks, and a controller is held while anyone on it holds it.
// The host streams dithered snapshots to the badge, which draws the newest one in a quick pass
// each time the panel is free.

import { CONSOLES } from './consoles.js';

const listeners = new Set();
// The host panel drives the emulator from here; rules stay free of the page.
export function onPads(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = s => listeners.forEach(fn => fn(s));

// A controller per player: the room is dealt out in the order people first pressed something.
export function seatOf(s, pid, seats) { const i = s.order.indexOf(pid); return i < 0 ? 0 : i % seats; }

export function held(s, seats, active) {
  const pads = new Array(seats).fill(0);
  for (const pid of active) if (s.masks[pid]) pads[seatOf(s, pid, seats)] |= s.masks[pid];
  return pads;
}

// Each controller's stick is everyone's sticks on it added up, so a crowd pushing one way wins.
export function sticks(s, seats, active) {
  const out = Array.from({ length: seats }, () => [0, 0]);
  for (const pid of active) {
    const v = s.sticks[pid];
    if (!v) continue;
    const o = out[seatOf(s, pid, seats)];
    o[0] += v[0];
    o[1] += v[1];
  }
  return out.map(([x, y]) => [Math.max(-100, Math.min(100, x)), Math.max(-100, Math.min(100, y))]);
}

export default {
  init(ctx) {
    const old = ctx.state;
    return { rom: old ? old.rom : null, masks: {}, sticks: {}, order: [], frame: null, frameId: 0 };
  },

  input: {
    pad(ctx, pid, msg) {
      const s = ctx.state;
      if (!s.rom || !Number.isInteger(msg.m) || msg.m < 0 || msg.m >= 1 << 16) return null;
      const x = Number.isInteger(msg.x) ? Math.max(-100, Math.min(100, msg.x)) : 0;
      const y = Number.isInteger(msg.y) ? Math.max(-100, Math.min(100, msg.y)) : 0;
      if (!s.order.includes(pid)) s.order.push(pid);
      s.masks[pid] = msg.m;
      if (x || y) s.sticks[pid] = [x, y]; else delete s.sticks[pid];
      changed(s);
      return null;
    },
  },

  tick(ctx) {
    // A phone that went quiet must not hold a button down.
    const s = ctx.state, live = new Set(ctx.active);
    let dropped = false;
    for (const pid of Object.keys(s.masks)) if (!live.has(pid)) { delete s.masks[pid]; delete s.sticks[pid]; dropped = true; }
    if (dropped) changed(s);
    return false;
  },

  view(ctx) {
    const s = ctx.state, seats = Math.min(ctx.cfg.seats, s.rom ? CONSOLES[s.rom.core].max : 1);
    return { rom: s.rom ? { name: s.rom.name, core: s.rom.core } : null, seats };
  },

  you(ctx, pid) {
    const s = ctx.state, seats = Math.min(ctx.cfg.seats, s.rom ? CONSOLES[s.rom.core].max : 1);
    return { seat: seats > 1 && s.order.includes(pid) ? seatOf(s, pid, seats) + 1 : 0 };
  },
  youKey(ctx, pid) { return String(this.you(ctx, pid).seat); },

  badge: {
    mode: 'still',
    live: true,
    // Frames stream to the badge from the host panel; this screen goes once, before they start.
    key: ctx => `arcade.${ctx.state.rom ? ctx.state.rom.name : ''}`,
    model: ctx => {
      const s = ctx.state;
      return s.frame ? { kind: 'frame', ...s.frame } : { kind: 'idle', rom: s.rom ? s.rom.name : '' };
    },
  },

  controls: () => [
    { label: 'let go of every button', run: ctx => { ctx.state.masks = {}; ctx.state.sticks = {}; changed(ctx.state); } },
    { label: 'deal controllers again', run: ctx => { ctx.state.order = []; } },
  ],

  headline(ctx) {
    const s = ctx.state;
    return { big: s.rom ? s.rom.name : 'load a game below', small: s.rom ? `${Object.keys(s.masks).length} holding buttons` : 'paste a rom link' };
  },

  stats(ctx) {
    const s = ctx.state;
    return [['game', s.rom ? `${s.rom.name}, ${CONSOLES[s.rom.core].label}` : 'none'], ['players who pressed', s.order.length]];
  },

  // The host panel.
  load(ctx, rom) { const s = ctx.state; s.rom = rom; s.masks = {}; s.sticks = {}; s.frame = null; changed(s); },
  snapshot(ctx, frame) { const s = ctx.state; s.frame = frame; s.frameId++; },
};
