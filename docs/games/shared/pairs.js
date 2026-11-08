// Head to head voting for a crowd. Nobody reads a hundred entries: each voter judges a few pairs,
// and an entry's score is its share of wins with one win and one loss added, so an entry that won
// 1 of 1 does not beat one that won 9 of 10.

import { hash32 } from '../../lib/protocol.js';

export const score = e => (e.w + 1) / (e.n + 2);

// A pair of entry indices for one voter's k-th vote, never including their own entry. One other
// entry gives a single, judged yes or skip. The less judged entries come up first.
export function pairFor(entries, voter, round, k, ownerOf = e => e.pid) {
  const pool = [];
  entries.forEach((e, i) => { if (ownerOf(e) !== voter && !e.out) pool.push(i); });
  if (!pool.length) return [];
  if (pool.length === 1) return k === 0 ? [pool[0]] : [];
  const sample = [];
  for (let t = 0; t < Math.min(6, pool.length); t++) {
    const i = pool[hash32(`${voter}.${round}.${k}.${t}`) % pool.length];
    if (!sample.includes(i)) sample.push(i);
  }
  while (sample.length < 2) sample.push(pool.find(i => !sample.includes(i)));
  sample.sort((a, b) => entries[a].n - entries[b].n);
  return hash32(`${voter}.${round}.${k}`) & 1 ? [sample[0], sample[1]] : [sample[1], sample[0]];
}

// Records one judgement. pick is an index in the pair, or -1 to skip.
export function judge(entries, pair, pick) {
  for (const i of pair) entries[i].n++;
  if (pair.includes(pick)) { entries[pick].w++; return entries[pick]; }
  return null;
}

export function best(entries) {
  let top = null;
  entries.forEach((e, i) => {
    if (e.out) return;
    if (!top || score(e) > score(top.e) || (score(e) === score(top.e) && e.w > top.e.w)) top = { e, i };
  });
  return top;
}
