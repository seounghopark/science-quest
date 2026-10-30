// 사이언스 퀘스트 3D — 실시간 멀티플레이 서버 (Socket.io)
// 정답 판정과 점수 계산은 모두 서버에서 한다. 클라이언트에는 정답을 미리 보내지 않는다.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { Q, KEYS } = require('./questions');
const makeStore = require('./store');
let store = null;

const PORT = process.env.PORT || 3000;
const fs = require('fs');
// client 폴더가 있으면 거기서, 없으면(파일을 한 폴더에 다 올린 경우) 이 폴더에서 화면 파일을 찾는다
const CLIENT_DIR = process.env.CLIENT_DIR ||
  (fs.existsSync(path.join(__dirname, '../client/index.html')) ? path.join(__dirname, '../client') : __dirname);
const MAX_PLAYERS = 6;
const NORMAL_QS = 8;            // 일반 문제 수
const BOSS_QS = 2;              // 마지막 보스 문제 수 (점수 3배)
const T_NORMAL = 15000;         // 일반 문제 제한 시간(ms)
const T_BOSS = 20000;           // 보스 문제 제한 시간(ms)
const REVEAL_MS = +process.env.REVEAL_MS || 4500; // 정답 공개 후 다음 문제까지

const app = express();
// 화면 파일 2개만 공개한다 (questions.js 같은 서버 파일은 공개하지 않음 → 정답 유출 방지)
app.get('/', (_, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
app.get('/mp.js', (_, res) => res.sendFile(path.join(CLIENT_DIR, 'mp.js')));
app.get('/auth.js', (_, res) => res.sendFile(path.join(CLIENT_DIR, 'auth.js')));

/* ---------- 로그인 · 랭킹 API ---------- */
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
const CLASSES = [1, 2, 3];                 // 3학년 1·2·3반
const MAX_SOLO_SCORE = 20000;              // 혼자 하기 한 판 점수 상한 (조작 방지)
const SOLO_GAP_MS = 20000;                 // 혼자 하기 점수 기록 최소 간격
const ID_RE = /^[가-힣a-zA-Z0-9_]{2,12}$/;
const SECRET = process.env.SESSION_SECRET ||
  (process.env.MONGODB_URI ? crypto.createHash('sha256').update('sq:' + process.env.MONGODB_URI).digest('hex')
                           : crypto.randomBytes(32).toString('hex'));
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sameHex = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
function signToken(id) {
  const p = Buffer.from(JSON.stringify({ id, exp: Date.now() + 60 * 864e5 })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
}
function verifyToken(t) {
  try {
    const [p, s] = String(t || '').split('.');
    const e = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
    if (!s || s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() ? d.id : null;
  } catch (e) { return null; }
}
const pubUser = u => ({ id: u.id, cls: u.cls, total: u.total, best: u.best, games: u.games });
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 600000);
  h.push(now); hits.set(ip, h); return h.length > 30;
}
async function authUser(req) {
  const id = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/, ''));
  return id ? store.get(id) : null;
}
const api = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ msg: '서버 오류가 났어요. 잠시 후 다시 시도해 주세요.' }); });
const fail = (res, code, msg) => res.status(code).json({ msg });

app.post('/api/signup', api(async (req, res) => {
  if (tooMany(req.ip)) return fail(res, 429, '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.');
  const { id, pw, cls } = req.body || {};
  if (!ID_RE.test(id || '')) return fail(res, 400, '아이디는 2~12자 한글·영문·숫자로 만들어 주세요.');
  if (typeof pw !== 'string' || pw.length < 4 || pw.length > 64) return fail(res, 400, '비밀번호는 4자 이상으로 해 주세요.');
  const c = Number(cls);
  if (!CLASSES.includes(c)) return fail(res, 400, '반을 골라 주세요.');
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id, cls: c, salt, pw: hashPw(pw, salt), total: 0, best: 0, games: 0, created: Date.now(), lastSolo: 0, lastVs: 0 };
  if (!await store.create(u)) return fail(res, 409, '이미 있는 아이디예요. 다른 아이디를 써 주세요.');
  res.json({ token: signToken(id), user: pubUser(u) });
}));

app.post('/api/login', api(async (req, res) => {
  if (tooMany(req.ip)) return fail(res, 429, '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.');
  const { id, pw } = req.body || {};
  const u = typeof id === 'string' && typeof pw === 'string' ? await store.get(id) : null;
  if (!u || !sameHex(hashPw(pw, u.salt), u.pw)) return fail(res, 401, '아이디 또는 비밀번호가 맞지 않아요.');
  res.json({ token: signToken(u.id), user: pubUser(u) });
}));

app.get('/api/me', api(async (req, res) => {
  const u = await authUser(req);
  if (!u) return fail(res, 401, '다시 로그인해 주세요.');
  res.json({ user: pubUser(u) });
}));

app.post('/api/score', api(async (req, res) => {
  const u = await authUser(req);
  if (!u) return fail(res, 401, '다시 로그인해 주세요.');
  const s = Math.floor(Number((req.body || {}).score));
  if (!(s >= 0 && s <= MAX_SOLO_SCORE)) return fail(res, 400, '점수가 올바르지 않아요.');
  if (Date.now() - (u.lastSolo || 0) < SOLO_GAP_MS) return fail(res, 429, '점수 기록은 20초에 한 번만 할 수 있어요.');
  res.json({ user: pubUser(await store.addScore(u.id, s, true)) });
}));

app.get('/api/rank', api(async (req, res) => {
  const u = await authUser(req);
  if (!u) return fail(res, 401, '다시 로그인해 주세요.');
  const [cls, all, clsRank, allRank, clsCount, allCount] = await Promise.all([
    store.top(u.cls, 10), store.top(null, 10), store.rank(u, u.cls), store.rank(u, null), store.count(u.cls), store.count(null)
  ]);
  const m = list => list.map(v => ({ id: v.id, cls: v.cls, total: v.total }));
  res.json({ me: { ...pubUser(u), clsRank, allRank, clsCount, allCount }, cls: m(cls), all: m(all) });
}));
app.get('/health', (_, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });

const rooms = new Map();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const validMode = m => (m === 'mix' || KEYS.includes(m)) ? m : 'mix';

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.random() * A.length | 0]).join(''); } while (rooms.has(c));
  return c;
}

function pub(r) {
  return {
    code: r.code, host: r.host, mode: r.mode, phase: r.phase,
    players: [...r.players].map(([id, p]) => ({ id, name: p.name, score: p.score, combo: p.combo }))
  };
}

function buildQuestions(mode) {
  const keys = mode === 'mix' ? KEYS : [mode];
  const normal = [], boss = [];
  keys.forEach(k => {
    Q[k].list.forEach(q => normal.push({ k, q }));
    (Q[k].boss || []).forEach(q => boss.push({ k, q, boss: true }));
  });
  return [...shuffle(normal).slice(0, NORMAL_QS), ...shuffle(boss).slice(0, BOSS_QS)];
}

function nextQuestion(r) {
  clearTimeout(r.timer);
  r.i++;
  if (r.i >= r.qs.length) return endGame(r);
  const it = r.qs[r.i];
  const order = shuffle([0, 1, 2, 3]);
  r.answer = order.indexOf(0);
  r.phase = 'question';
  const duration = it.boss ? T_BOSS : T_NORMAL;
  r.deadline = Date.now() + duration;
  r.players.forEach(p => { p.ans = null; });
  io.to(r.code).emit('question', {
    i: r.i, total: r.qs.length, k: it.k, boss: !!it.boss,
    text: it.q[0], opts: order.map(o => it.q[1][o]), duration
  });
  r.timer = setTimeout(() => reveal(r), duration + 300);
}

function reveal(r) {
  if (r.phase !== 'question') return;
  clearTimeout(r.timer);
  r.phase = 'reveal';
  const it = r.qs[r.i];
  const results = [];
  r.players.forEach((p, id) => {
    const ok = !!p.ans && p.ans.idx === r.answer;
    let gain = 0;
    if (ok) {
      p.combo++;
      gain = Math.round((100 + p.ans.left / 100) * (1 + Math.min(p.combo - 1, 4) * 0.25) * (it.boss ? 3 : 1));
      p.score += gain;
    } else p.combo = 0;
    results.push({ id, name: p.name, choice: p.ans ? p.ans.idx : -1, ok, gain });
  });
  io.to(r.code).emit('reveal', { answer: r.answer, correctText: it.q[1][0], exp: it.q[2], results, room: pub(r) });
  r.timer = setTimeout(() => nextQuestion(r), REVEAL_MS);
}

function endGame(r) {
  clearTimeout(r.timer);
  const rank = [...r.players].map(([id, p]) => ({ id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
  // 로그인한 참가자의 대전 점수를 누적 랭킹에 반영 (서버가 계산한 점수라 그대로 저장)
  r.players.forEach(p => { if (p.uid && p.score > 0) store.addScore(p.uid, p.score, false).catch(e => console.error('대전 점수 저장 실패:', e.message)); });
  io.to(r.code).emit('end', { rank });
  r.phase = 'lobby';
  io.to(r.code).emit('room', pub(r));
}

io.on('connection', sock => {
  let cur = null;
  const hs = sock.handshake || {};
  const uid = verifyToken(hs.auth && hs.auth.token);
  let me = null;
  const ready = uid ? store.get(uid).then(u => { me = u; }).catch(() => {}) : Promise.resolve();
  const fn = f => typeof f === 'function' ? f : () => {};

  function enter(r, name) {
    cur = r;
    sock.join(r.code);
    const shown = me ? `${me.cls}반 ${me.id}` : (clean(name, 10) || '플레이어');
    r.players.set(sock.id, { name: shown, uid: me ? me.id : null, score: 0, combo: 0, ans: null });
    io.to(r.code).emit('room', pub(r));
  }

  sock.on('create', async (data = {}, ack) => {
    ack = fn(ack); await ready;
    if (cur) return ack({ ok: false, msg: '이미 방에 들어가 있어요.' });
    const r = { code: newCode(), host: sock.id, mode: validMode(data.mode), phase: 'lobby', players: new Map(), qs: [], i: -1, timer: null };
    rooms.set(r.code, r);
    enter(r, data.name);
    ack({ ok: true, code: r.code });
  });

  sock.on('join', async (data = {}, ack) => {
    ack = fn(ack); await ready;
    if (cur) return ack({ ok: false, msg: '이미 방에 들어가 있어요.' });
    const r = rooms.get(clean(data.code, 4).toUpperCase());
    if (!r) return ack({ ok: false, msg: '방을 찾을 수 없어요. 코드를 확인해 주세요.' });
    if (r.phase !== 'lobby') return ack({ ok: false, msg: '이미 게임이 진행 중인 방이에요.' });
    if (r.players.size >= MAX_PLAYERS) return ack({ ok: false, msg: `방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명).` });
    enter(r, data.name);
    ack({ ok: true, code: r.code });
  });

  sock.on('mode', mode => {
    const r = cur;
    if (!r || r.host !== sock.id || r.phase !== 'lobby') return;
    r.mode = validMode(mode);
    io.to(r.code).emit('room', pub(r));
  });

  sock.on('start', () => {
    const r = cur;
    if (!r || r.host !== sock.id || r.phase !== 'lobby') return;
    r.qs = buildQuestions(r.mode);
    r.i = -1;
    r.players.forEach(p => { p.score = 0; p.combo = 0; });
    nextQuestion(r);
  });

  sock.on('answer', idx => {
    const r = cur;
    if (!r || r.phase !== 'question') return;
    const p = r.players.get(sock.id);
    idx = Number(idx);
    if (!p || p.ans || !(idx >= 0 && idx < 4)) return;
    p.ans = { idx, left: Math.max(0, r.deadline - Date.now()) };
    const all = [...r.players.values()];
    io.to(r.code).emit('answered', { count: all.filter(x => x.ans).length, total: all.length });
    if (all.every(x => x.ans)) reveal(r);
  });

  function leave() {
    const r = cur;
    if (!r) return;
    cur = null;
    sock.leave(r.code);
    r.players.delete(sock.id);
    if (!r.players.size) { clearTimeout(r.timer); rooms.delete(r.code); return; }
    if (r.host === sock.id) r.host = r.players.keys().next().value;
    io.to(r.code).emit('room', pub(r));
    if (r.phase === 'question' && [...r.players.values()].every(x => x.ans)) reveal(r);
  }
  sock.on('leave', leave);
  sock.on('disconnect', leave);
});

makeStore().then(s => {
  store = s;
  server.listen(PORT, () => console.log(`Science Quest 멀티 서버 실행 중: http://localhost:${PORT} (저장소: ${store.kind})`));
}).catch(e => { console.error('데이터베이스 연결 실패:', e.message); process.exit(1); });
