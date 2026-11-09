// Every relay address the crowd games use, in one place. A room is /hb/play/<CODE>.
//
//   who writes   address              kind     what
//   host         view                 set      what every phone needs to draw the game
//   host         stage                set      the screen model the badge and the projector draw
//   host         board                set      every score, for ranks
//   host         owner                set      which host page owns the room
//   host         hostkey              set      the host's public key, for sealed uploads and credits
//   host         hb                   emit     liveness, every 5 s
//   host         live                 emit     live ink stroke batches
//   host         you/<pid>            set      one phone's private state
//   host         media/<id>           set      large public payloads: snapshots, approved photos
//   phone        in/<pid>             set      the phone's latest input, numbered
//   phone        who/<pid>            set      name and public key
//   phone        up/<pid>             set      a sealed upload, readable only by the host
//   phone        beat                 emit     liveness, payload is the pid

export const PROTOCOL = 2;
export const PUBLIC_BASE = 'https://supercon.hack.build/';
// The wearer's room. Its code comes from the badge key and is printed on the badge's join screen,
// so it is public; a link without a room lands here.
export const HOME_ROOM = '695S';

// Links a phone can follow from anywhere. A local copy of the site links to itself instead.
export function shareBase() {
  const h = location.hostname;
  return h === 'supercon.hack.build' || h.endsWith('github.io') ? PUBLIC_BASE : new URL('.', location.href).href;
}

export function paths(code) {
  const P = `/hb/play/${code}`;
  return {
    root: P,
    view: `${P}/view`,
    stage: `${P}/stage`,
    board: `${P}/board`,
    owner: `${P}/owner`,
    hostKey: `${P}/hostkey`,
    hb: `${P}/hb`,
    live: `${P}/live`,
    beat: `${P}/beat`,
    you: pid => `${P}/you/${pid}`,
    media: id => `${P}/media/${id}`,
    input: pid => `${P}/in/${pid}`,
    who: pid => `${P}/who/${pid}`,
    upload: pid => `${P}/up/${pid}`,
    inputs: `${P}/in/*`,
    whos: `${P}/who/*`,
    uploads: `${P}/up/*`,
  };
}

export const PID = /^[A-Z0-9]{6,16}$/;
export const pidOf = address => address.slice(address.lastIndexOf('/') + 1);

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The room code comes from the badge key, so a printed QR keeps working. tools/join_screen.py
// works it out the same way for the screen the badge shows on its own.
export async function roomCode(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}.room`));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < hex.length; i++) { h ^= hex.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return [0, 5, 10, 15].map(s => ALPHA[(h >>> s) & 31]).join('');
}

export function joinUrl(code, base = PUBLIC_BASE) {
  return `${base}play#${code}`;
}

export function code(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => ALPHA[x % ALPHA.length]).join('');
}

export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

export function shuffle(list, seed) {
  const out = [...list];
  let s = hash32(String(seed)) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
