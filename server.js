'use strict';
/**
 * Huquq Oktagoni — Telegram Mini App serveri.
 * Bog'liqliksiz Node.js (>=18): HTTP + SSE (real vaqt) + Telegram bot (long polling).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- .env ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) {}

const PORT = +process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = (process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const DEV = !BOT_TOKEN; // BOT_TOKEN bo'lmasa — faqat sinov rejimi
let BOT_USERNAME = process.env.BOT_USERNAME || '';

// ---------- Sozlamalar ----------
const CFG = {
  QUESTION_MS: 15000,
  REVEAL_MS: 3500,
  START_DELAY_MS: 2200,
  DUEL_Q: 7,
  TOUR_Q: 5,
  ROOM_Q: [5, 10, 15],
  MATCH_WAIT_MS: 7000,
  TOUR_SIZE: 8,
  TOUR_LOBBY_MS: 30000,
  ROOM_MAX: 30,
};
const TEST = process.env.FAST_TEST === '1';
if (TEST) Object.assign(CFG, { QUESTION_MS: 3000, REVEAL_MS: 400, START_DELAY_MS: 300, MATCH_WAIT_MS: 1500, TOUR_LOBBY_MS: 2500 });

// ---------- Savollar ----------
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'))
  .filter((q) => q && q.q && Array.isArray(q.o) && q.o.length === 4 && q.a >= 0 && q.a < 4);
if (QUESTIONS.length < 5) throw new Error('questions.json da kamida 5 ta savol bo\'lishi kerak');

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function pickQuestions(n) {
  let pool = shuffle(QUESTIONS);
  while (pool.length < n) pool = pool.concat(shuffle(QUESTIONS));
  return pool.slice(0, n).map((q) => {
    const order = shuffle([0, 1, 2, 3]);
    return { q: q.q, o: order.map((i) => q.o[i]), a: order.indexOf(q.a), e: q.e || '', c: q.c || '' };
  });
}

// ---------- Foydalanuvchilar (JSON bilan saqlanadi) ----------
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const users = new Map();
try {
  for (const u of JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))) users.set(u.id, u);
} catch (_) {}
let saveTimer = null;
function saveUsers() {
  if (TEST) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(USERS_FILE + '.tmp', JSON.stringify([...users.values()]));
      fs.renameSync(USERS_FILE + '.tmp', USERS_FILE);
    } catch (e) { console.error('saqlashda xato', e.message); }
  }, 1500);
}
function touchUser(tg) {
  const id = String(tg.id);
  let u = users.get(id);
  const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 24) || tg.username || 'Jangchi';
  if (!u) {
    u = { id, name, username: tg.username || '', rating: 1000, xp: 0, wins: 0, losses: 0, draws: 0, games: 0, tourWins: 0, best: 0 };
    users.set(id, u);
  } else { u.name = name; u.username = tg.username || u.username; }
  saveUsers();
  return u;
}
const rankOf = (u) => 1 + [...users.values()].filter((x) => x.rating > u.rating).length;
const pub = (u) => ({ id: u.id, name: u.name, rating: u.rating, xp: u.xp, wins: u.wins, losses: u.losses, draws: u.draws, games: u.games, tourWins: u.tourWins, best: u.best });
const titleFor = (r) => (r >= 1500 ? 'Chempion' : r >= 1300 ? 'Ustoz' : r >= 1150 ? 'Jangchi' : r >= 1000 ? 'Yangi jangchi' : 'Boshlovchi');

// ---------- Telegram initData tekshiruvi ----------
function verifyInitData(raw) {
  if (!raw) return null;
  if (DEV && raw.startsWith('dev:')) {
    const name = raw.slice(4).replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 24) || 'Sinov';
    return { id: 'dev_' + name.toLowerCase().replace(/\s+/g, '_'), first_name: name };
  }
  if (DEV) return null;
  try {
    const p = new URLSearchParams(raw);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400 * 2) return null;
    const user = JSON.parse(p.get('user') || 'null');
    return user && user.id ? user : null;
  } catch (_) { return null; }
}

// ---------- SSE ----------
const conns = new Map(); // userId -> Set(res)
function send(userId, event, data) {
  const set = conns.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

// ---------- Botlar ----------
const BOT_NAMES = ['Sardor', 'Madina', 'Jasur', 'Nilufar', 'Bekzod', 'Zarina', 'Otabek', 'Malika', 'Shahzod', 'Kamola', 'Dilshod', 'Aziza', 'Rustam', 'Sevara', 'Anvar', 'Feruza'];
let botSeq = 0;
function makeBot(nearRating) {
  const skill = 0.5 + Math.random() * 0.4; // aniqlik 50–90%
  return {
    id: 'bot' + ++botSeq + '_' + crypto.randomBytes(2).toString('hex'),
    name: '🤖 ' + BOT_NAMES[crypto.randomInt(BOT_NAMES.length)],
    bot: true, skill,
    rating: Math.round((nearRating || 1000) + (skill - 0.7) * 300),
  };
}

// ---------- O'yin mexanikasi ----------
const games = new Map();
const userGame = new Map(); // userId -> Game
const rid = (n = 6) => crypto.randomBytes(n).toString('hex');

class Game {
  constructor({ mode, players, total, onEnd, meta }) {
    this.id = rid(5);
    this.mode = mode; // duel | room | tour
    this.total = total;
    this.meta = meta || {};
    this.onEnd = onEnd;
    this.players = players.map((p) => ({
      id: p.id, name: p.name, bot: !!p.bot, skill: p.skill, rating: p.rating || 1000,
      score: 0, correct: 0, streak: 0, time: 0, choice: null, answerMs: null,
    }));
    this.questions = pickQuestions(total);
    this.idx = -1;
    this.phase = 'init';
    this.timer = null;
    this.botTimers = [];
    this.last = null;
    games.set(this.id, this);
    for (const p of this.players) if (!p.bot) userGame.set(p.id, this);
  }
  humans() { return this.players.filter((p) => !p.bot); }
  emit(event, data) { for (const p of this.humans()) send(p.id, event, data); }
  roster() { return this.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, rating: p.rating })); }
  startInfo() { return { gameId: this.id, mode: this.mode, total: this.total, players: this.roster(), questionMs: CFG.QUESTION_MS, meta: this.meta }; }
  start() {
    this.phase = 'countdown';
    this.emit('game:start', this.startInfo());
    this.timer = setTimeout(() => this.next(), CFG.START_DELAY_MS);
  }
  qPayload() {
    const q = this.questions[this.idx];
    return { gameId: this.id, idx: this.idx, total: this.total, category: q.c, text: q.q, options: q.o, endsAt: this.endsAt, now: Date.now() };
  }
  next() {
    this.idx++;
    if (this.idx >= this.total) return this.finish();
    this.phase = 'question';
    this.qStart = Date.now();
    this.endsAt = this.qStart + CFG.QUESTION_MS;
    for (const p of this.players) { p.choice = null; p.answerMs = null; }
    this.emit('game:question', this.qPayload());
    // botlar javobi
    for (const p of this.players.filter((x) => x.bot)) {
      const delay = 2200 + Math.random() * (CFG.QUESTION_MS - 5000) * (1.05 - p.skill * 0.6);
      this.botTimers.push(setTimeout(() => {
        const q = this.questions[this.idx];
        const right = Math.random() < p.skill;
        let c = q.a;
        if (!right) { do { c = crypto.randomInt(4); } while (c === q.a); }
        this.answer(p.id, this.idx, c);
      }, TEST ? 200 + Math.random() * 600 : delay));
    }
    this.timer = setTimeout(() => this.reveal(), CFG.QUESTION_MS + 250);
  }
  answer(userId, idx, choice) {
    if (this.phase !== 'question' || idx !== this.idx) return false;
    const p = this.players.find((x) => x.id === userId);
    if (!p || p.choice !== null || !(choice >= 0 && choice < 4)) return false;
    p.choice = choice;
    p.answerMs = Math.min(CFG.QUESTION_MS, Date.now() - this.qStart);
    this.emit('game:answered', { gameId: this.id, idx, playerId: p.id });
    if (this.players.every((x) => x.choice !== null)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), 350);
    }
    return true;
  }
  reveal() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    clearTimeout(this.timer);
    this.botTimers.forEach(clearTimeout); this.botTimers = [];
    const q = this.questions[this.idx];
    const results = {};
    for (const p of this.players) {
      const ok = p.choice === q.a;
      let pts = 0;
      if (ok) {
        p.streak++;
        const speed = Math.round(100 * (1 - p.answerMs / CFG.QUESTION_MS));
        pts = 100 + Math.max(0, speed) + Math.min(p.streak - 1, 5) * 10;
        p.score += pts; p.correct++; p.time += p.answerMs;
      } else p.streak = 0;
      results[p.id] = { choice: p.choice, ok, pts, ms: p.answerMs, streak: p.streak };
    }
    this.last = {
      gameId: this.id, idx: this.idx, correct: q.a, explanation: q.e, results,
      scores: this.players.map((p) => ({ id: p.id, score: p.score, correct: p.correct })),
    };
    this.emit('game:reveal', this.last);
    this.timer = setTimeout(() => this.next(), CFG.REVEAL_MS);
  }
  ranking() {
    return this.players.slice().sort((a, b) => b.score - a.score || (b.correct - a.correct) || a.time - b.time)
      .map((p, i) => ({ id: p.id, name: p.name, bot: p.bot, score: p.score, correct: p.correct, place: i + 1 }));
  }
  finish() {
    this.phase = 'done';
    clearTimeout(this.timer);
    const ranking = this.ranking();
    const extra = (this.onEnd && this.onEnd(this, ranking)) || {};
    this.emit('game:end', { gameId: this.id, mode: this.mode, total: this.total, ranking, ...extra });
    for (const p of this.humans()) if (userGame.get(p.id) === this) userGame.delete(p.id);
    games.delete(this.id);
  }
  // qayta ulanish uchun holat
  replay(userId) {
    send(userId, 'game:start', this.startInfo());
    if (this.phase === 'question') {
      const me = this.players.find((p) => p.id === userId);
      send(userId, 'game:question', { ...this.qPayload(), myChoice: me ? me.choice : null });
    } else if (this.phase === 'reveal' && this.last) {
      send(userId, 'game:reveal', this.last);
    }
  }
}

// Bot-bot o'yini tezkor simulyatsiya
function simulate(a, b) {
  const sa = (a.skill || 0.7) + Math.random() * 0.25, sb = (b.skill || 0.7) + Math.random() * 0.25;
  return sa >= sb ? a : b;
}

// ---------- ELO ----------
function applyElo(u, oppRating, score, k) {
  const exp = 1 / (1 + Math.pow(10, (oppRating - u.rating) / 400));
  const d = Math.round(k * (score - exp));
  u.rating = Math.max(100, u.rating + d);
  return d;
}
function recordResult(u, outcome, xp, ratingDelta) {
  u.games++; u.xp += xp;
  if (outcome === 'win') u.wins++; else if (outcome === 'loss') u.losses++; else u.draws++;
  u.best = Math.max(u.best || 0, xp);
  saveUsers();
}

// ---------- Duel navbati ----------
const queue = []; // {id, since}
const inQueue = (id) => queue.some((x) => x.id === id);
function leaveQueue(id) { const i = queue.findIndex((x) => x.id === id); if (i >= 0) queue.splice(i, 1); }

function startDuel(pA, pB) {
  const g = new Game({
    mode: 'duel', total: CFG.DUEL_Q, players: [pA, pB],
    onEnd: (game, ranking) => {
      const [a, b] = game.players;
      const sa = a.score === b.score ? 0.5 : a.score > b.score ? 1 : 0;
      const out = {};
      const deltas = {};
      for (const [me, opp, s] of [[a, b, sa], [b, a, 1 - sa]]) {
        if (me.bot) continue;
        const u = users.get(me.id);
        const k = opp.bot ? 16 : 32;
        const d = applyElo(u, opp.rating, s, k);
        recordResult(u, s === 1 ? 'win' : s === 0 ? 'loss' : 'draw', me.score, d);
        deltas[me.id] = { delta: d, rating: u.rating, title: titleFor(u.rating) };
      }
      out.deltas = deltas;
      out.result = sa === 0.5 ? 'draw' : sa === 1 ? a.id : b.id;
      return out;
    },
  });
  g.start();
}
setInterval(() => {
  const now = Date.now();
  queue.sort((x, y) => (users.get(x.id)?.rating || 0) - (users.get(y.id)?.rating || 0));
  for (let i = 0; i < queue.length - 1;) {
    const a = queue[i], b = queue[i + 1];
    const ra = users.get(a.id), rb = users.get(b.id);
    const gap = Math.abs(ra.rating - rb.rating);
    const waited = Math.max(now - a.since, now - b.since);
    if (gap <= 150 + waited / 40 || waited > 3000) {
      queue.splice(i, 2);
      startDuel({ id: ra.id, name: ra.name, rating: ra.rating }, { id: rb.id, name: rb.name, rating: rb.rating });
    } else i++;
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (now - q.since >= CFG.MATCH_WAIT_MS) {
      queue.splice(i, 1);
      const u = users.get(q.id);
      startDuel({ id: u.id, name: u.name, rating: u.rating }, makeBot(u.rating));
    }
  }
}, 500);

// ---------- Xonalar (Kahoot uslubi) ----------
const rooms = new Map();
const userRoom = new Map();
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => CODE_CH[crypto.randomInt(CODE_CH.length)]).join(''); } while (rooms.has(c)); return c; };
const roomView = (r) => ({ code: r.code, host: r.host, state: r.state, total: r.total, max: CFG.ROOM_MAX, players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name })) });
const roomBroadcast = (r) => { const v = roomView(r); for (const id of r.players.keys()) send(id, 'room:update', v); };
function leaveRoom(userId) {
  const code = userRoom.get(userId);
  const r = code && rooms.get(code);
  userRoom.delete(userId);
  if (!r) return;
  r.players.delete(userId);
  if (!r.players.size) { rooms.delete(code); return; }
  if (r.host === userId) r.host = r.players.keys().next().value;
  roomBroadcast(r);
}

// ---------- Turnir ----------
let currentTour = null; // lobbydagi turnir
const tours = new Map();
const userTour = new Map();
const ROUND_NAMES = { 8: 'Chorak final', 4: 'Yarim final', 2: 'Final' };
function tourView(t) {
  return {
    id: t.id, state: t.state, startsAt: t.startsAt, now: Date.now(), size: CFG.TOUR_SIZE,
    players: t.players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })),
    rounds: t.rounds.map((r) => r.map((m) => ({ a: m.a && m.a.id, b: m.b && m.b.id, winner: m.winner ? m.winner.id : null, live: !!m.live }))),
    round: t.round, roundName: t.state === 'running' ? ROUND_NAMES[t.rounds[t.round] ? t.rounds[t.round].length * 2 : 2] || '' : '',
    champion: t.champion ? { id: t.champion.id, name: t.champion.name } : null,
  };
}
const tourBroadcast = (t) => { const v = tourView(t); for (const p of t.players) if (!p.bot) send(p.id, 'tour:update', v); };
function joinTour(user) {
  if (!currentTour || currentTour.state !== 'lobby') {
    currentTour = { id: rid(3), state: 'lobby', players: [], rounds: [], round: 0, startsAt: Date.now() + CFG.TOUR_LOBBY_MS, champion: null, timer: null };
    tours.set(currentTour.id, currentTour);
    const t = currentTour;
    t.timer = setTimeout(() => startTour(t), CFG.TOUR_LOBBY_MS);
  }
  const t = currentTour;
  if (!t.players.some((p) => p.id === user.id)) t.players.push({ id: user.id, name: user.name, rating: user.rating });
  userTour.set(user.id, t);
  tourBroadcast(t);
  if (t.players.length >= CFG.TOUR_SIZE) { clearTimeout(t.timer); startTour(t); }
}
function leaveTour(userId, explicit = true) {
  const t = userTour.get(userId);
  if (!t) return;
  if (t.state !== 'lobby' && !explicit) return; // uzilgan ulanishda turnir davom etadi
  userTour.delete(userId);
  if (t.state === 'lobby') {
    t.players = t.players.filter((p) => p.id !== userId);
    if (!t.players.length) { clearTimeout(t.timer); tours.delete(t.id); if (currentTour === t) currentTour = null; }
    else tourBroadcast(t);
  }
}
function startTour(t) {
  if (t.state !== 'lobby') return;
  if (currentTour === t) currentTour = null;
  const avg = t.players.reduce((s, p) => s + p.rating, 0) / t.players.length;
  while (t.players.length < CFG.TOUR_SIZE) t.players.push(makeBot(avg));
  t.state = 'running';
  const seeded = shuffle(t.players);
  t.rounds = [];
  t.round = 0;
  t.rounds.push(pairUp(seeded));
  tourBroadcast(t);
  setTimeout(() => playRound(t), TEST ? 300 : 4000);
}
const pairUp = (list) => { const out = []; for (let i = 0; i < list.length; i += 2) out.push({ a: list[i], b: list[i + 1], winner: null, live: false }); return out; };
function playRound(t) {
  const matches = t.rounds[t.round];
  let pending = matches.length;
  const done = () => {
    if (--pending > 0) return;
    tourBroadcast(t);
    if (matches.length === 1) return finishTour(t, matches[0]);
    const winners = matches.map((m) => m.winner);
    t.round++;
    t.rounds.push(pairUp(winners));
    tourBroadcast(t);
    setTimeout(() => playRound(t), TEST ? 300 : 5000);
  };
  for (const m of matches) {
    if (m.a.bot && m.b.bot) { m.winner = simulate(m.a, m.b); done(); continue; }
    m.live = true;
    const g = new Game({
      mode: 'tour', total: CFG.TOUR_Q, players: [m.a, m.b],
      meta: { tourId: t.id, roundName: ROUND_NAMES[matches.length * 2] },
      onEnd: (game) => {
        const [a, b] = game.players;
        let w = a;
        if (a.score !== b.score) w = a.score > b.score ? a : b;
        else if (a.time !== b.time) w = a.time < b.time ? a : b;
        else w = Math.random() < 0.5 ? a : b;
        m.winner = m.a.id === w.id ? m.a : m.b;
        m.live = false;
        setImmediate(done);
        return { result: w.id, advances: w.id };
      },
    });
    g.start();
  }
  tourBroadcast(t);
}
function finishTour(t, finalMatch) {
  t.state = 'done';
  t.champion = finalMatch.winner;
  const placeXp = new Map();
  t.rounds.forEach((r, ri) => r.forEach((m) => {
    const loser = m.winner && (m.winner.id === m.a.id ? m.b : m.a);
    if (loser) placeXp.set(loser.id, [30, 75, 150][ri] || 30);
  }));
  placeXp.set(t.champion.id, 300);
  for (const p of t.players) {
    if (p.bot) continue;
    const u = users.get(p.id);
    if (!u) continue;
    const xp = placeXp.get(p.id) || 0;
    u.xp += xp;
    if (p.id === t.champion.id) u.tourWins++;
    send(p.id, 'tour:done', { champion: { id: t.champion.id, name: t.champion.name }, xp, youWon: p.id === t.champion.id });
    userTour.delete(p.id);
  }
  saveUsers();
  tourBroadcast(t);
  setTimeout(() => tours.delete(t.id), 60000);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUB = path.join(__dirname, 'public');

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

// oddiy tezlik cheklovi
const hits = new Map();
setInterval(() => hits.clear(), 10000);
const limited = (id) => { const n = (hits.get(id) || 0) + 1; hits.set(id, n); return n > 80; };

function snapshotCtx(u) {
  const r = rooms.get(userRoom.get(u.id));
  const t = userTour.get(u.id);
  return {
    me: { ...pub(u), rank: rankOf(u), title: titleFor(u.rating) },
    bot: BOT_USERNAME,
    cfg: { questionMs: CFG.QUESTION_MS, tourSize: CFG.TOUR_SIZE },
    queue: inQueue(u.id),
    inGame: userGame.has(u.id),
    room: r ? roomView(r) : null,
    tour: t ? tourView(t) : null,
  };
}

async function handleApi(req, res, url) {
  const raw = req.headers['x-init-data'] || url.searchParams.get('auth') || '';
  const tgUser = verifyInitData(raw);
  if (!tgUser) return json(res, 401, { error: 'auth' });
  const user = touchUser(tgUser);
  if (limited(user.id)) return json(res, 429, { error: 'Juda tez-tez so\'rov' });
  const p = url.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    if (!conns.has(user.id)) conns.set(user.id, new Set());
    conns.get(user.id).add(res);
    const hb = setInterval(() => res.write(': hb\n\n'), 15000);
    req.on('close', () => {
      clearInterval(hb);
      const set = conns.get(user.id);
      if (set) { set.delete(res); if (!set.size) conns.delete(user.id); }
      // ulanish uzilsa navbat va xonadan chiqariladi, o'yin esa davom etadi
      setTimeout(() => {
        if (!conns.has(user.id)) { leaveQueue(user.id); leaveTour(user.id, false); if (!userGame.has(user.id)) leaveRoom(user.id); }
      }, 8000);
    });
    send(user.id, 'sync', snapshotCtx(user));
    const g = userGame.get(user.id);
    if (g) g.replay(user.id);
    return;
  }

  if (p === '/api/me') return json(res, 200, snapshotCtx(user));
  if (p === '/api/leaderboard') {
    const top = [...users.values()].sort((a, b) => b.rating - a.rating || b.xp - a.xp).slice(0, 50).map((u, i) => ({ place: i + 1, id: u.id, name: u.name, rating: u.rating, xp: u.xp, wins: u.wins, title: titleFor(u.rating) }));
    return json(res, 200, { top, me: { ...pub(user), rank: rankOf(user) } });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const body = await readBody(req);
  const busy = () => userGame.has(user.id);

  switch (p) {
    case '/api/duel/find':
      if (busy()) return json(res, 409, { error: 'Siz allaqachon o\'yindasiz' });
      if (!inQueue(user.id)) queue.push({ id: user.id, since: Date.now() });
      return json(res, 200, { ok: true });
    case '/api/duel/cancel':
      leaveQueue(user.id);
      return json(res, 200, { ok: true });
    case '/api/answer': {
      const g = userGame.get(user.id);
      if (!g || g.id !== body.gameId) return json(res, 200, { ok: false });
      return json(res, 200, { ok: g.answer(user.id, +body.idx, +body.choice) });
    }
    case '/api/room/create': {
      if (busy()) return json(res, 409, { error: 'Siz allaqachon o\'yindasiz' });
      leaveRoom(user.id);
      const total = CFG.ROOM_Q.includes(+body.total) ? +body.total : 10;
      const r = { code: newCode(), host: user.id, state: 'lobby', total, players: new Map([[user.id, { id: user.id, name: user.name }]]) };
      rooms.set(r.code, r);
      userRoom.set(user.id, r.code);
      roomBroadcast(r);
      return json(res, 200, { ok: true, code: r.code });
    }
    case '/api/room/join': {
      if (busy()) return json(res, 409, { error: 'Siz allaqachon o\'yindasiz' });
      const code = String(body.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return json(res, 404, { error: 'Bunday xona topilmadi' });
      if (r.state !== 'lobby') return json(res, 409, { error: 'O\'yin allaqachon boshlangan' });
      if (r.players.size >= CFG.ROOM_MAX && !r.players.has(user.id)) return json(res, 409, { error: 'Xona to\'lgan' });
      if (userRoom.get(user.id) !== code) leaveRoom(user.id);
      r.players.set(user.id, { id: user.id, name: user.name });
      userRoom.set(user.id, code);
      roomBroadcast(r);
      return json(res, 200, { ok: true, code });
    }
    case '/api/room/leave':
      leaveRoom(user.id);
      return json(res, 200, { ok: true });
    case '/api/room/start': {
      const r = rooms.get(userRoom.get(user.id));
      if (!r || r.host !== user.id) return json(res, 403, { error: 'Faqat xona egasi boshlay oladi' });
      if (r.state !== 'lobby') return json(res, 409, { error: 'Allaqachon boshlangan' });
      if (r.players.size < 2) return json(res, 409, { error: 'Kamida 2 ta ishtirokchi kerak' });
      r.state = 'playing';
      const list = [...r.players.values()].map((x) => ({ id: x.id, name: x.name, rating: users.get(x.id)?.rating || 1000 }));
      roomBroadcast(r);
      new Game({
        mode: 'room', total: r.total, players: list, meta: { code: r.code },
        onEnd: (game, ranking) => {
          r.state = 'lobby';
          const n = ranking.length;
          for (const rk of ranking) {
            const u = users.get(rk.id);
            if (!u) continue;
            const outcome = rk.place === 1 ? 'win' : rk.place <= Math.ceil(n / 2) ? 'draw' : 'loss';
            recordResult(u, outcome, rk.score, 0);
          }
          setImmediate(() => roomBroadcast(r));
          return { code: r.code };
        },
      }).start();
      return json(res, 200, { ok: true });
    }
    case '/api/tour/join':
      if (busy()) return json(res, 409, { error: 'Siz allaqachon o\'yindasiz' });
      if (userTour.has(user.id) && userTour.get(user.id).state === 'running') return json(res, 200, { ok: true });
      joinTour(user);
      return json(res, 200, { ok: true });
    case '/api/tour/leave':
      leaveTour(user.id);
      return json(res, 200, { ok: true });
    default:
      return json(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/health') return json(res, 200, { ok: true, users: users.size, dev: DEV });
    let f = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!f || f.endsWith('/')) f += 'index.html';
    const full = path.join(PUB, f);
    if (!full.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Topilmadi'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server' });
  }
});

// ---------- Telegram bot (long polling) ----------
async function tgApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
const webKb = (label, query = '') => ({ inline_keyboard: [[{ text: label, web_app: { url: WEBAPP_URL + (query ? '?' + query : '') } }]] });
async function handleUpdate(u) {
  const m = u.message;
  if (!m || !m.text) return;
  const chat = m.chat.id;
  const [cmd, arg] = m.text.trim().split(/\s+/);
  const c = cmd.split('@')[0].toLowerCase();
  if (c === '/start') {
    const room = /^room_([A-Z0-9]{4})$/i.test(arg || '') ? arg.slice(5).toUpperCase() : '';
    await tgApi('sendMessage', {
      chat_id: chat,
      text: '⚔️ <b>Huquq Oktagoni</b>\n\nO\'zbekiston huquqi bo\'yicha real vaqtdagi bellashuv. Raqibingiz bilan bir xil savollarga javob bering, tezroq va aniqroq bo\'ling, reytingda yuqoriga chiqing.\n\n🥊 Duel 1×1\n🏆 8 kishilik turnir\n🎯 Do\'stlar bilan xona\n\n<i>Savollar o\'quv va ko\'ngilochar maqsadda tuzilgan, bu huquqiy maslahat emas.</i>',
      parse_mode: 'HTML',
      reply_markup: webKb(room ? '🎯 Xonaga kirish' : '⚔️ Jangga kirish', room ? 'room=' + room : ''),
    });
  } else if (c === '/top') {
    const top = [...users.values()].sort((a, b) => b.rating - a.rating).slice(0, 10);
    const esc = (s) => s.replace(/[<>&]/g, '');
    await tgApi('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '🏆 <b>Eng kuchli 10 jangchi</b>\n\n' + (top.map((x, i) => `${i + 1}. ${esc(x.name)}: ${x.rating}`).join('\n') || 'Hali hech kim o\'ynamagan.'), reply_markup: webKb('⚔️ O\'ynash') });
  } else if (c === '/help') {
    await tgApi('sendMessage', { chat_id: chat, text: '/start: o\'yinni ochish\n/top: reyting jadvali', reply_markup: webKb('⚔️ O\'ynash') });
  }
}
async function startBot() {
  if (!BOT_TOKEN) return console.log('BOT_TOKEN yo\'q: bot o\'chiq, sinov rejimi (brauzerda /?dev=Ism).');
  if (!WEBAPP_URL.startsWith('https://')) console.warn('Diqqat: WEBAPP_URL https:// bilan boshlanishi kerak, aks holda Telegram Mini App ochmaydi.');
  try {
    const me = await tgApi('getMe');
    if (me.ok) { BOT_USERNAME = BOT_USERNAME || me.result.username; console.log('Bot: @' + BOT_USERNAME); } else { console.error('BOT_TOKEN noto\'g\'ri:', me.description); return; }
    await tgApi('deleteWebhook');
    await tgApi('setMyCommands', { commands: [{ command: 'start', description: 'O\'yinni ochish' }, { command: 'top', description: 'Reyting jadvali' }] });
    if (WEBAPP_URL) await tgApi('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Jang', web_app: { url: WEBAPP_URL } } });
  } catch (e) { console.error('Bot ishga tushmadi:', e.message); return; }
  let offset = 0;
  for (;;) {
    try {
      const r = await tgApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (r.ok) for (const upd of r.result) { offset = upd.update_id + 1; handleUpdate(upd).catch((e) => console.error('update', e.message)); }
      else await new Promise((s) => setTimeout(s, 3000));
    } catch (e) { await new Promise((s) => setTimeout(s, 3000)); }
  }
}

process.on('SIGINT', () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); if (!TEST) fs.writeFileSync(USERS_FILE, JSON.stringify([...users.values()])); } catch (_) {} process.exit(0); });
process.on('SIGTERM', () => process.emit('SIGINT'));

server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}  (${DEV ? 'SINOV rejimi' : 'ishlab chiqarish'})  Savollar: ${QUESTIONS.length}`);
  startBot();
});
