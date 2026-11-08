// Sealed messages over a public relay: ECDH on P-256, then AES-GCM with the shared key.
// The host publishes its public key. A phone seals a photo so only the host can open it before it
// is approved, and the host seals a capsule credit so only the winning phone can read it.

const EC = { name: 'ECDH', namedCurve: 'P-256' };

export async function keypair(storeKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey));
    if (saved) {
      return {
        privateKey: await crypto.subtle.importKey('jwk', saved.priv, EC, true, ['deriveKey']),
        publicKey: await crypto.subtle.importKey('jwk', saved.pub, EC, true, []),
      };
    }
  } catch (e) { /* a broken saved key is replaced */ }
  const pair = await crypto.subtle.generateKey(EC, true, ['deriveKey']);
  try {
    localStorage.setItem(storeKey, JSON.stringify({
      priv: await crypto.subtle.exportKey('jwk', pair.privateKey),
      pub: await crypto.subtle.exportKey('jwk', pair.publicKey),
    }));
  } catch (e) { /* private mode: the key lives for this page only */ }
  return pair;
}

export async function publicJwk(pair) {
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kty, crv, x, y };
}

const shared = new Map();

async function aesKey(privateKey, peerJwk) {
  const id = `${peerJwk.x}.${peerJwk.y}`;
  if (!shared.has(id)) {
    const peer = await crypto.subtle.importKey('jwk', peerJwk, EC, false, []);
    shared.set(id, await crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }
  return shared.get(id);
}

export async function seal(pair, peerJwk, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(pair.privateKey, peerJwk), bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

export async function open(pair, peerJwk, b64) {
  const all = fromB64(b64);
  const key = await aesKey(pair.privateKey, peerJwk);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12)));
}

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(s);
}

export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const te = new TextEncoder();
export const td = new TextDecoder();
