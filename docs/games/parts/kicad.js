// Finds and reads footprints from the KiCad library mirror on GitHub, from the host page. GitHub
// serves both the file tree and raw files with open CORS, so this needs no server. The mirror is
// frozen at 2020, which covers the classic packages this game asks about.

const TREE = 'https://api.github.com/repos/KiCad/kicad-footprints/git/trees/master?recursive=1';
const RAW = 'https://raw.githubusercontent.com/KiCad/kicad-footprints/master/';
let paths = null;

export async function search(words) {
  if (!paths) {
    const r = await fetch(TREE);
    if (!r.ok) throw new Error(r.status === 403 ? 'github limits searches to 60 an hour. try again later.' : `github answered ${r.status}.`);
    paths = (await r.json()).tree.map(t => t.path).filter(p => p.endsWith('.kicad_mod'));
  }
  const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
  return paths.filter(p => terms.every(t => p.toLowerCase().includes(t))).slice(0, 40);
}

export async function footprint(path) {
  const r = await fetch(RAW + path);
  if (!r.ok) throw new Error(`could not fetch ${path}`);
  return parse(await r.text());
}

export const nameOf = path => path.split('/').pop().replace('.kicad_mod', '');

function sexpr(text) {
  const tokens = text.match(/\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+/g) || [];
  const stack = [];
  let cur = [];
  for (const t of tokens) {
    if (t === '(') { stack.push(cur); cur = []; } else if (t === ')') { const done = cur; cur = stack.pop(); cur.push(done); } else cur.push(t.startsWith('"') ? t.slice(1, -1) : t);
  }
  return cur[0];
}

const child = (n, name) => n.find(c => Array.isArray(c) && c[0] === name);
const kids = (n, name) => n.filter(c => Array.isArray(c) && c[0] === name);
const num = v => Math.round(parseFloat(v) * 1000) / 1000;

export function parse(text) {
  const root = sexpr(text);
  const pads = [];
  for (const p of kids(root, 'pad')) {
    const at = child(p, 'at'), size = child(p, 'size');
    if (!at || !size) continue;
    let w = num(size[1]), hgt = num(size[2]);
    if (Math.round(num(at[3] || 0)) % 180 === 90) [w, hgt] = [hgt, w];
    pads.push([p[1], num(at[1]), num(at[2]), w, hgt, { circle: 'c', oval: 'o' }[p[3]] || 'r', p[2] === 'thru_hole' ? 1 : p[2] === 'np_thru_hole' ? 2 : 0]);
  }
  let lines = [];
  for (const layer of ['F.Fab', 'F.SilkS', 'F.Silkscreen']) {
    for (const n of root) {
      if (!Array.isArray(n) || !child(n, 'layer') || child(n, 'layer')[1] !== layer) continue;
      if (n[0] === 'fp_line') { const s = child(n, 'start'), e = child(n, 'end'); lines.push([num(s[1]), num(s[2]), num(e[1]), num(e[2])]); }
      if (n[0] === 'fp_circle') {
        const ce = child(n, 'center'), e = child(n, 'end');
        lines.push(['c', num(ce[1]), num(ce[2]), Math.round(Math.hypot(num(e[1]) - num(ce[1]), num(e[2]) - num(ce[2])) * 1000) / 1000]);
      }
    }
    if (lines.length) break;
  }
  return { pads, lines };
}
