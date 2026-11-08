// Capsule machine credits won in the games.
//
// A credit is a token: 6 random bytes, then the first 6 bytes of HMAC-SHA256 over "cred:" and the
// id in hex, keyed by a credit key the host derives from the badge key. The capsule machine holds
// the same credit key (tools/credit_key.py prints it), checks the token and keeps a ledger of spent
// ids, so a copied token vends once.
//
// On a phone with Web NFC (Chrome on Android) the winner writes the token onto a blank coin as a
// link record. Anywhere else the phone shows the code, and the wearer hands over a coin.

import { PUBLIC_BASE } from './protocol.js';

export const COIN_PAGE = `${PUBLIC_BASE}coin`;
const te = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function creditKey(badgeSecret) {
  const base = await crypto.subtle.importKey('raw', te.encode(badgeSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const raw = await crypto.subtle.sign('HMAC', base, te.encode('hackbuild capsule credit'));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function makeToken(key) {
  const id = hex(crypto.getRandomValues(new Uint8Array(6)));
  const mac = hex(await crypto.subtle.sign('HMAC', key, te.encode(`cred:${id}`))).slice(0, 12);
  return id + mac;
}

export const coinUrl = token => `${COIN_PAGE}#${token}`;
export const shortCode = token => token.slice(0, 6).toUpperCase();

export const canWriteCoin = () => typeof window !== 'undefined' && 'NDEFReader' in window;

// Resolves once the coin is written. The phone must be held to the coin while this runs.
export async function writeCoin(token, signal) {
  const writer = new NDEFReader();
  await writer.write({ records: [{ recordType: 'url', data: coinUrl(token) }] }, { overwrite: true, signal });
}
