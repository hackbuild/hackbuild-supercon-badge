// Which frames of a GIF the badge keeps. A GIF with no more frames than wanted keeps them all. A
// longer one is sampled at even steps of its own clock, so a held frame survives and a burst of quick
// ones is thinned. delays are the frames' own delays; a missing one counts as 100 ms.
export function pickFrames(delays, want) {
  const gap = d => d || 100;
  if (delays.length <= want) return new Set(delays.keys());
  const total = delays.reduce((n, d) => n + gap(d), 0);
  const picks = new Set();
  let i = 0, start = 0;
  for (let k = 0; k < want; k++) {
    const at = (k * total) / want;
    while (i < delays.length - 1 && start + gap(delays[i]) <= at) start += gap(delays[i++]);
    picks.add(i);
  }
  return picks;
}
