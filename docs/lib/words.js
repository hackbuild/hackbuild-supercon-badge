// Text from strangers goes on a badge someone is wearing, so it passes a word filter first.
// The wearer can still remove anything from the host page.

const BLOCK = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink',
  'tranny', 'whore', 'slut', 'cock', 'dick', 'pussy', 'bitch', 'porn', 'kys', 'molest', 'pedo'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

export function clean(text, max) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function blocked(text) {
  const flat = String(text).toLowerCase().replace(/[01345@$!7]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
  return BLOCK.some(w => flat.includes(w));
}

export function cleanName(text, pid) {
  const name = clean(text, 16).toLowerCase();
  return name.length >= 2 && !blocked(name) ? name : `player ${pid.slice(0, 3).toLowerCase()}`;
}
