// 사이언스 퀘스트 3D — 실시간 멀티플레이 서버 (Socket.io)
// 정답 판정과 점수 계산은 모두 서버에서 한다. 클라이언트에는 정답을 미리 보내지 않는다.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Q, KEYS } = require('./questions');

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
  io.to(r.code).emit('end', { rank });
  r.phase = 'lobby';
  io.to(r.code).emit('room', pub(r));
}

io.on('connection', sock => {
  let cur = null;
  const fn = f => typeof f === 'function' ? f : () => {};

  function enter(r, name) {
    cur = r;
    sock.join(r.code);
    r.players.set(sock.id, { name: clean(name, 10) || '플레이어', score: 0, combo: 0, ans: null });
    io.to(r.code).emit('room', pub(r));
  }

  sock.on('create', (data = {}, ack) => {
    ack = fn(ack);
    if (cur) return ack({ ok: false, msg: '이미 방에 들어가 있어요.' });
    const r = { code: newCode(), host: sock.id, mode: validMode(data.mode), phase: 'lobby', players: new Map(), qs: [], i: -1, timer: null };
    rooms.set(r.code, r);
    enter(r, data.name);
    ack({ ok: true, code: r.code });
  });

  sock.on('join', (data = {}, ack) => {
    ack = fn(ack);
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

server.listen(PORT, () => console.log(`Science Quest 멀티 서버 실행 중: http://localhost:${PORT}`));
