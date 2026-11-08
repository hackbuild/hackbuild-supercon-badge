// Listens, read only, to the room and the badge's path for a while and prints what moves.
import { readFileSync } from 'node:fs';
import { Clasp } from '@clasp-to/core';
globalThis.window = globalThis;
globalThis.CLASP = { Clasp };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
const { Relay } = await import('../../docs/lib/relay.js');
const { Badge } = await import('../../docs/lib/badge.js');
const proto = await import('../../docs/lib/protocol.js');
const key = JSON.parse(readFileSync(new URL('../../badge/secret.local.json', import.meta.url))).key;
const secs = Number(process.argv[2] || 40);
const relay = new Relay('relay-watch');
relay.start();
const badge = new Badge(relay);
badge.command = () => Promise.resolve();
await badge.open(key);
const code = await proto.roomCode(key);
const P = proto.paths(code);
const t0 = Date.now(), at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const counts = {};
relay.on(`${badge.base}/**`, (v, a) => {
  const k = a.slice(badge.base.length);
  counts[k] = (counts[k] || 0) + 1;
  if (k === '/cmd') console.log(at(), 'cmd', String(v).split(':').slice(1).join(':').slice(0, 140));
  if (k === '/state') { try { const s = JSON.parse(v); console.log(at(), 'badge', s.app, s.play, 'busy', s.busy, 'frame', s.frame, 'err', s.err || ''); } catch (e) {} }
});
relay.on(P.stage, v => { try { const s = JSON.parse(v); const m = s.model || {}; console.log(at(), 'stage', s.kind, m.now ? m.now.title : '', m.queue ?? ''); } catch (e) {} });
relay.on(P.owner, v => console.log(at(), 'owner', String(v).slice(0, 12)));
setTimeout(() => { console.log('counts', JSON.stringify(counts)); process.exit(0); }, secs * 1000);
