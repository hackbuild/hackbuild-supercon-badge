// Snake by committee: the room votes a direction every turn and the majority moves the snake.
// A turn ends early when one direction has 80 percent of at least three votes.

export const COLS = 15, ROWS = 12;
const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };

function reset(s) {
  s.snake = [[5, 6], [4, 6], [3, 6]];
  s.dir = 'R';
  s.score = 0;
  s.over = false;
  s.overTurns = 0;
  s.tally = { U: 0, D: 0, L: 0, R: 0 };
  s.voted = {};
  s.split = null;
  s.food = food(s);
}

function food(s) {
  const free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!s.snake.some(([a, b]) => a === x && b === y)) free.push([x, y]);
  return free[Math.floor(Math.random() * free.length)] || [0, 0];
}

function step(ctx, s) {
  const order = Object.entries(s.tally).sort((a, b) => b[1] - a[1]);
  let pick = s.dir;
  if (order[0][1] > 0) {
    const top = order.filter(([d, n]) => n === order[0][1] && d !== OPP[s.dir]);
    if (top.length) pick = top.find(([d]) => d === s.dir) ? s.dir : top[0][0];
  }
  s.split = { ...s.tally, pick };
  s.dir = pick;
  const [hx, hy] = s.snake[0], [dx, dy] = DIRS[pick], nx = hx + dx, ny = hy + dy;
  const winners = Object.keys(s.voted).filter(p => s.voted[p] === pick);
  if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || s.snake.slice(0, -1).some(([a, b]) => a === nx && b === ny)) {
    s.over = true;
    s.overTurns = 0;
  } else {
    s.snake.unshift([nx, ny]);
    if (nx === s.food[0] && ny === s.food[1]) {
      s.score++;
      s.best = Math.max(s.best, s.score);
      s.food = food(s);
      winners.forEach(p => ctx.award(p, 5));
    } else s.snake.pop();
    winners.forEach(p => ctx.award(p, 1));
  }
  s.turn++;
  s.tally = { U: 0, D: 0, L: 0, R: 0 };
  s.voted = {};
}

export default {
  init(ctx) {
    const s = { best: ctx.state ? ctx.state.best : 0, turn: 0, until: ctx.now + ctx.cfg.turnS * 1000 };
    reset(s);
    return s;
  },

  input: {
    dir(ctx, pid, msg) {
      const s = ctx.state;
      if (s.over || msg.turn !== s.turn || !DIRS[msg.d]) return null;
      const old = s.voted[pid];
      if (old === msg.d) return null;
      if (old) s.tally[old]--;
      s.voted[pid] = msg.d;
      s.tally[msg.d]++;
      return { changed: true };
    },
  },

  tick(ctx) {
    const s = ctx.state, t = s.tally, n = t.U + t.D + t.L + t.R;
    if (n >= 3 && Math.max(t.U, t.D, t.L, t.R) / n >= 0.8 && s.until - ctx.now > 1250) s.until = ctx.now;
    if (ctx.now < s.until) return false;
    if (s.over) { if (++s.overTurns >= 2) reset(s); } else step(ctx, s);
    s.until = ctx.now + ctx.cfg.turnS * 1000;
    return true;
  },

  view(ctx) {
    const s = ctx.state;
    return { snake: s.snake, food: s.food, dir: s.dir, score: s.score, best: s.best, turn: s.turn, left: Math.max(0, s.until - ctx.now), tally: s.tally, split: s.split, over: s.over };
  },

  you(ctx, pid) { const s = ctx.state; return { turn: s.turn, d: s.voted[pid] || '' }; },
  youKey(ctx, pid) { const s = ctx.state; return `${s.turn}.${s.voted[pid] || ''}`; },

  badge: {
    mode: 'still',
    key: ctx => { const s = ctx.state; return `${s.turn}.${s.over}`; },
    model: ctx => { const s = ctx.state; return { snake: s.snake, food: s.food, score: s.score, best: s.best, turn: s.turn, split: s.split, over: s.over }; },
  },

  controls: () => [
    { label: 'restart the snake', run: ctx => { const s = ctx.state; s.over = true; s.overTurns = 1; s.until = 0; } },
  ],

  stats(ctx) {
    const s = ctx.state, left = Math.max(0, Math.ceil((s.until - ctx.now) / 1000));
    return [['turn', `${s.turn}, ${left} s left`], ['score', `${s.score}, best ${s.best}`], ['votes', Object.values(s.tally).reduce((a, b) => a + b, 0)]];
  },
};
