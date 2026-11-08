// Controller layouts for the EmulatorJS cores, after the doot emulator pad. `i` is the
// simulateInput index, `c` the button's color, `p` its place in a diamond (n, s, e, w).
// A phone's bitmask: bits 0 to 3 are up, down, left, right, then one bit per button in the order
// buttons() lists them. The stick travels separately as x and y.
export const DIRS = ['up', 'down', 'left', 'right'];
export const DPAD = [4, 5, 6, 7];
// Left stick: right, left, down, up, each a separate analog input.
export const STICK = { right: 16, left: 17, down: 18, up: 19 };
export const FULL = 0x7fff;

export const CONSOLES = {
  nes: { label: 'nes', ext: ['nes'], max: 2, face: [{ l: 'b', i: 0, c: 'red' }, { l: 'a', i: 8, c: 'red' }], sys: [{ l: 'select', i: 2 }, { l: 'start', i: 3 }] },
  snes: { label: 'snes', ext: ['sfc', 'smc'], max: 2, sh: [{ l: 'l', i: 10 }, { l: 'r', i: 11 }],
    face4: [{ l: 'x', i: 9, p: 'n', c: 'blue' }, { l: 'y', i: 1, p: 'w', c: 'green' }, { l: 'a', i: 8, p: 'e', c: 'red' }, { l: 'b', i: 0, p: 's', c: 'yellow' }], sys: [{ l: 'select', i: 2 }, { l: 'start', i: 3 }] },
  n64: { label: 'n64', ext: ['z64', 'n64', 'v64'], max: 4, stick: true, sh: [{ l: 'l', i: 10 }, { l: 'z', i: 12 }, { l: 'r', i: 11 }],
    abdiag: [{ l: 'b', i: 1, c: 'green' }, { l: 'a', i: 0, c: 'blue' }],
    cb: [{ l: 'c↑', i: 23, p: 'n', c: 'yellow' }, { l: 'c↓', i: 22, p: 's', c: 'yellow' }, { l: 'c←', i: 21, p: 'w', c: 'yellow' }, { l: 'c→', i: 20, p: 'e', c: 'yellow' }],
    sys: [{ l: 'start', i: 3, c: 'red' }] },
  gb: { label: 'game boy', ext: ['gb'], max: 1, face: [{ l: 'b', i: 0, c: 'purple' }, { l: 'a', i: 8, c: 'purple' }], sys: [{ l: 'select', i: 2 }, { l: 'start', i: 3 }] },
  gbc: { label: 'game boy color', ext: ['gbc'], max: 1, face: [{ l: 'b', i: 0, c: 'purple' }, { l: 'a', i: 8, c: 'purple' }], sys: [{ l: 'select', i: 2 }, { l: 'start', i: 3 }] },
  gba: { label: 'game boy advance', ext: ['gba'], max: 1, sh: [{ l: 'l', i: 10 }, { l: 'r', i: 11 }], face: [{ l: 'b', i: 0, c: 'dark' }, { l: 'a', i: 8, c: 'dark' }], sys: [{ l: 'select', i: 2 }, { l: 'start', i: 3 }] },
  segaMD: { label: 'genesis', ext: ['md', 'gen', 'smd'], max: 2,
    face6: [{ l: 'x', i: 10, c: 'dark' }, { l: 'y', i: 9, c: 'dark' }, { l: 'z', i: 11, c: 'dark' }, { l: 'a', i: 1, c: 'dark' }, { l: 'b', i: 0, c: 'dark' }, { l: 'c', i: 8, c: 'dark' }], sys: [{ l: 'mode', i: 2 }, { l: 'start', i: 3 }] },
  segaMS: { label: 'master system', ext: ['sms'], max: 2, face: [{ l: '1', i: 0, c: 'dark' }, { l: '2', i: 8, c: 'dark' }], sys: [] },
};

const GROUPS = ['sh', 'face', 'face4', 'face6', 'abdiag', 'cb', 'sys'];

// Every button of a console in bit order.
export function buttons(core) {
  const c = CONSOLES[core];
  return GROUPS.flatMap(g => c[g] || []);
}

export function consoleFor(url) {
  const ext = String(url).split(/[?#]/)[0].split('.').pop().toLowerCase();
  return Object.keys(CONSOLES).find(k => CONSOLES[k].ext.includes(ext)) || '';
}

// Every input the mask can hold, as [simulateInput index, value when held], in bit order.
export function inputs(core) {
  return [...DPAD.map(i => [i, 1]), ...buttons(core).map(b => [b.i, b.i >= 16 ? FULL : 1])];
}
