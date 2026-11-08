// Controller layouts for the EmulatorJS cores, with each button's simulateInput index. A phone
// holds a bitmask: bits 0 to 3 are the directions, then one bit per entry in buttons.
export const DIRS = ['up', 'down', 'left', 'right'];

// Directions go to the d-pad, or to the left stick for a console whose games read the stick.
const DPAD = [4, 5, 6, 7];
const STICK = [19, 18, 17, 16];

export const CONSOLES = {
  nes: { label: 'nes', ext: ['nes'], max: 2, dirs: DPAD, buttons: [['b', 0], ['a', 8], ['select', 2], ['start', 3]] },
  snes: { label: 'snes', ext: ['sfc', 'smc'], max: 2, dirs: DPAD, buttons: [['y', 1], ['b', 0], ['x', 9], ['a', 8], ['l', 10], ['r', 11], ['select', 2], ['start', 3]] },
  n64: { label: 'n64', ext: ['z64', 'n64', 'v64'], max: 4, dirs: STICK, buttons: [['b', 1], ['a', 0], ['z', 12], ['l', 10], ['r', 11], ['c up', 23], ['c down', 22], ['start', 3]] },
  gb: { label: 'game boy', ext: ['gb'], max: 1, dirs: DPAD, buttons: [['b', 0], ['a', 8], ['select', 2], ['start', 3]] },
  gbc: { label: 'game boy color', ext: ['gbc'], max: 1, dirs: DPAD, buttons: [['b', 0], ['a', 8], ['select', 2], ['start', 3]] },
  gba: { label: 'game boy advance', ext: ['gba'], max: 1, dirs: DPAD, buttons: [['b', 0], ['a', 8], ['l', 10], ['r', 11], ['select', 2], ['start', 3]] },
  segaMD: { label: 'genesis', ext: ['md', 'gen', 'smd'], max: 2, dirs: DPAD, buttons: [['a', 1], ['b', 0], ['c', 8], ['start', 3]] },
  segaMS: { label: 'master system', ext: ['sms'], max: 2, dirs: DPAD, buttons: [['1', 0], ['2', 8]] },
};

export function consoleFor(url) {
  const ext = String(url).split(/[?#]/)[0].split('.').pop().toLowerCase();
  return Object.keys(CONSOLES).find(k => CONSOLES[k].ext.includes(ext)) || '';
}

// Every input the mask can hold, as [simulateInput index, value when held].
export function inputs(core) {
  const c = CONSOLES[core];
  return [...c.dirs.map(i => [i, i >= 16 ? 0x7fff : 1]), ...c.buttons.map(([, i]) => [i, 1])];
}
