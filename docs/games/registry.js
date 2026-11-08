// The games. Each lives in its own folder with three modules:
//   rules.js   runs on the host page: state, inputs, timers, what phones and the badge see
//   screen.js  draws a screen model at 960 by 672, for the badge and the projector
//   phone.js   the controller a player sees
//   host.js    optional, a panel on the host page
// Adding a game is a folder and an entry here.

export const GAMES = [
  { id: 'hill', name: 'the hill', howto: 'write the funniest answer you can. then pick the funnier of each pair. the winner goes on the badge.',  verb: 'write and vote', blurb: 'everyone answers a prompt, the room votes, the funniest goes on the badge.',
    settings: [
      { key: 'answerS', label: 'seconds to answer', def: 40, min: 15, max: 300 },
      { key: 'voteS', label: 'seconds to vote', def: 30, min: 15, max: 300 },
      { key: 'showS', label: 'seconds the winner shows', def: 12, min: 5, max: 120 },
      { key: 'credits', label: 'round winners earn capsule credits', def: false, kind: 'bool' },
    ] },
  { id: 'parts', host: true, name: 'name that package', howto: 'a footprint shows on the badge and here. type its name. first right answer scores most.',  verb: 'race to name it', blurb: 'a footprint shows up. first to name it scores most, and wins a capsule credit.',
    settings: [
      { key: 'askS', label: 'seconds per part', def: 30, min: 10, max: 120 },
      { key: 'hintS', label: 'seconds before choices appear', def: 12, min: 0, max: 60 },
      { key: 'revealS', label: 'seconds on the pinout', def: 10, min: 4, max: 60 },
      { key: 'credits', label: 'first to name it earns a capsule credit', def: true, kind: 'bool' },
    ] },
  { id: 'ink', name: 'live ink', howto: 'drag on the page to draw. everyone draws on the same page, and the badge shows it about a second later.',  verb: 'draw together, live', blurb: 'everyone draws on one page. the badge shows it about once a second.',
    settings: [
      { key: 'inkMax', label: 'ink per phone, in pixels of fine line', def: 4000, min: 200, max: 20000 },
      { key: 'inkPerS', label: 'ink refill per second', def: 400, min: 10, max: 5000 },
      { key: 'fullAt', label: 'new page when this percent is covered', def: 35, min: 5, max: 90 },
    ] },
  { id: 'pixel', name: 'pixel commons', howto: 'drag to paint pixels on the shared canvas. your ink refills over time.',  verb: 'make together', blurb: 'a shared pixel canvas with a prompt. ink refills over time.',
    settings: [
      { key: 'batchS', label: 'extra seconds between badge prints', def: 0, min: 0, max: 600 },
      { key: 'promptMin', label: 'minutes per prompt', def: 20, min: 1, max: 240 },
      { key: 'inkMax', label: 'ink per phone', def: 48, min: 4, max: 500 },
      { key: 'inkEveryS', label: 'seconds per ink refill', def: 1.5, min: 0.2, max: 60, step: 0.1 },
    ] },
  { id: 'cinema', name: '2 fps cinema', howto: 'grab a frame and draw it. the faint lines are the frame before yours, so move things a little.',  verb: 'draw one frame', blurb: 'each phone draws one frame of a 12 frame loop. finished reels play on the badge.',
    settings: [
      { key: 'claimS', label: 'seconds to draw a frame', def: 90, min: 20, max: 600 },
    ] },
  { id: 'booth', host: true, name: 'dither booth', howto: 'take a selfie if you want to. the wearer approves it, then the room votes one onto the badge.',  verb: 'take a portrait', blurb: 'opt in selfies, dithered for e-paper. the room votes one onto the badge.',
    settings: [
      { key: 'reignS', label: 'seconds a portrait stays on the badge', def: 120, min: 20, max: 1800 },
      { key: 'autoApprove', label: 'show photos without approving each one', def: false, kind: 'bool' },
    ] },
  { id: 'snipe', name: 'flash snipe', howto: 'when the badge flashes a new code, scan it or type it. first claims score most.',  verb: 'race', blurb: 'every redraw shows a new code. first to claim it scores most.',
    settings: [
      { key: 'holdS', label: 'seconds a code stays live', def: 30, min: 10, max: 300 },
    ] },
  { id: 'gifs', host: true, name: 'meme gifs', verb: 'put gifs on', howto: 'the wearer puts gifs on the badge. ask for one from the list.', blurb: 'loop meme gifs on the badge. phones can ask for the next one.',
    settings: [
      { key: 'holdS', label: 'seconds before the next queued gif', def: 40, min: 5, max: 600 },
      { key: 'frames', label: 'frames per gif, more is smoother and slower', def: 10, min: 2, max: 24 },
      { key: 'halftone', label: 'halftone dots, off for sharper text', def: true, kind: 'bool' },
      { key: 'requests', label: 'phones can ask for gifs', def: true, kind: 'bool' },
    ] },
  { id: 'snake', name: 'snake by committee', howto: 'vote a direction every turn. the majority moves the snake.',  verb: 'steer together', blurb: 'the room votes every move.',
    settings: [
      { key: 'turnS', label: 'seconds per turn', def: 3, min: 2, max: 60 },
    ] },
];

export const gameMeta = id => GAMES.find(g => g.id === id);

const cache = new Map();
function load(id, part) {
  if (!GAMES.some(g => g.id === id)) return Promise.reject(new Error(`no game ${id}`));
  const k = `${id}/${part}`;
  if (!cache.has(k)) cache.set(k, import(`./${id}/${part}.js`));
  return cache.get(k);
}

export async function rulesFor(id) {
  const [rules, screen] = await Promise.all([load(id, 'rules'), load(id, 'screen')]);
  // A phone names the handler it wants, so the table must not answer to "constructor" or "__proto__".
  const input = Object.assign(Object.create(null), rules.default.input);
  return { ...gameMeta(id), ...rules.default, input, screen: screen };
}
export const screenFor = id => load(id, 'screen');
export const phoneFor = id => load(id, 'phone');
// A game with a panel of its own on the host page, like the booth's approval queue.
export const hostFor = id => (gameMeta(id) && gameMeta(id).host ? load(id, 'host') : Promise.resolve(null));
