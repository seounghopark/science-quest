// 사이언스 퀘스트 3D — 멀티플레이 클라이언트
// 게임 본체(index.html의 메인 스크립트) 다음에 불러온다.
// 본체의 전역 함수(spawnMon, fireLaser, doBurst, pop, beep 등)를 그대로 써서 3D 연출을 재사용한다.
(() => {
  const SERVER = window.MP_SERVER || undefined; // 비워 두면 이 페이지를 준 서버에 접속
  const g = id => document.getElementById(id);
  const PANELS = ['menu', 'game', 'result', 'dex', 'mpLobby', 'mpRoom', 'mpGame', 'mpEnd'];
  let sock = null, room = null, cur = null, myChoice = -1, timerId = null, endAt = 0, showingEnd = false;

  /* ---------- UI ---------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
    .inp{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--fg);font:600 15px var(--body)}
    .inp:focus{outline:2px solid var(--c);outline-offset:1px}
    .mpf{display:flex;flex-direction:column;gap:6px}
    .mplist{display:flex;flex-direction:column;gap:6px}
    .mprow{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.05);font-size:14px}
    .mprow.me{outline:1px solid var(--c)}
    .mprow b{margin-left:auto;font-variant-numeric:tabular-nums}
    .mprow .tag{font-size:11px;color:var(--c);font-weight:800}
    .mprow .st{font-size:12px;color:var(--muted)}
    .mprow .st.ok{color:var(--ok)} .mprow .st.bad{color:var(--bad)}
    .opt.sel{border-color:var(--c);background:rgba(255,255,255,.12)}
  </style>`);

  document.querySelector('.tiles').insertAdjacentHTML('beforeend',
    `<button class="tile" id="mpTile" style="--tc:#ff6b8b"><span class="no">VS</span><span class="sy">대전</span><span class="nm">친구와 온라인 대전</span></button>`);

  document.querySelector('.stage').insertAdjacentHTML('beforeend', `
  <section class="panel" id="mpLobby" hidden>
    <div class="qhead"><h2>온라인 대전</h2><button class="ghost" id="mpBack">닫기</button></div>
    <p class="sub">친구와 같은 문제를 동시에 풀어요. 빨리 맞힐수록 점수가 높고, 마지막 2문제는 점수 3배 보스 문제예요.</p>
    <div class="mpf"><label class="lab" for="mpName">닉네임</label><input id="mpName" class="inp" maxlength="10" placeholder="10자 이내"></div>
    <div class="mpf"><label class="lab" for="mpMode">단원 (방을 만들 때)</label><select id="mpMode" class="inp"></select></div>
    <button class="primary" id="mpCreate">방 만들기</button>
    <div class="row"><input id="mpCode" class="inp" maxlength="4" placeholder="방 코드 4자리" style="flex:1;width:auto;text-transform:uppercase"><button class="ghost" id="mpJoin">입장</button></div>
    <p class="best" id="mpMsg"></p>
  </section>
  <section class="panel" id="mpRoom" hidden>
    <div class="qhead"><h2>대기실</h2><span class="chip">방 코드 <b id="mpCodeShow"></b></span></div>
    <p class="sub" id="mpRoomInfo"></p>
    <div class="mplist" id="mpPlayers"></div>
    <div class="row"><button class="primary" id="mpStart">게임 시작</button><button class="ghost" id="mpLeave">나가기</button></div>
  </section>
  <section class="panel" id="mpGame" hidden>
    <div class="qhead"><span class="chip" id="mpCat"></span><span class="best" id="mpProg"></span><span class="timer" id="mpTimer">15.0</span></div>
    <h2 id="mpQ"></h2>
    <div class="opts" id="mpOpts"></div>
    <div class="exp" id="mpExp" hidden><p id="mpExpT"></p></div>
    <div class="mplist" id="mpBoard"></div>
  </section>
  <section class="panel" id="mpEnd" hidden>
    <p class="eyebrow">대전 결과</p>
    <div class="rank" id="mpWinner"></div>
    <div class="mplist" id="mpRank"></div>
    <div class="row"><button class="primary" id="mpAgain">대기실로</button><button class="ghost" id="mpHome">메뉴로</button></div>
  </section>`);

  const modeSel = g('mpMode');
  [...KEYS, 'mix'].forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k === 'mix' ? '시험 범위 전체 섞기' : Q[k].name; modeSel.append(o); });
  try { g('mpName').value = localStorage.getItem('sq-name') || ''; } catch (e) {}

  function mpShow(id) {
    PANELS.forEach(p => { const el = g(p); if (!el) return; el.hidden = p !== id; if (p === id) { el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } });
    g('hud').hidden = true;
  }
  const msg = t => { g('mpMsg').textContent = t; };
  const isHost = () => room && sock && room.host === sock.id;
  const modeName = m => m === 'mix' ? '시험 범위 전체' : (Q[m] ? Q[m].name : m);

  function row(p, extra) {
    const d = document.createElement('div'); d.className = 'mprow' + (sock && p.id === sock.id ? ' me' : '');
    const n = document.createElement('span'); n.textContent = p.name; d.append(n);
    if (extra) d.append(extra);
    const b = document.createElement('b'); b.textContent = (p.score || 0) + '점'; d.append(b);
    return d;
  }
  function tag(t, cls = 'tag') { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; }

  function renderRoom() {
    if (!room) return;
    g('mpCodeShow').textContent = room.code;
    g('mpRoomInfo').textContent = `단원: ${modeName(room.mode)} · ${room.players.length}/6명 · ` + (isHost() ? '친구에게 방 코드를 알려주고 시작을 누르세요.' : '방장이 시작하기를 기다리는 중이에요.');
    const box = g('mpPlayers'); box.innerHTML = '';
    room.players.forEach(p => box.append(row(p, p.id === room.host ? tag('방장') : null)));
    g('mpStart').hidden = !isHost();
  }
  function renderBoard(results) {
    const box = g('mpBoard'); box.innerHTML = '';
    [...room.players].sort((a, b) => b.score - a.score).forEach(p => {
      let st = null;
      if (results) { const r = results.find(x => x.id === p.id); if (r) st = tag(r.ok ? `+${r.gain}` : (r.choice < 0 ? '무응답' : '오답'), 'st ' + (r.ok ? 'ok' : 'bad')); }
      box.append(row(p, st));
    });
  }

  /* ---------- 서버 연결 ---------- */
  function connect() {
    if (sock) return true;
    if (!window.io) { msg('Socket.io 클라이언트를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); return false; }
    sock = window.io(SERVER, { transports: ['websocket', 'polling'], auth: { token: window.SQ_TOKEN || '' } }); // 로그인 상태면 대전 점수가 랭킹에 반영됨
    sock.on('connect_error', () => msg('서버에 연결할 수 없어요. 서버가 켜져 있는지, 주소가 맞는지 확인해 주세요.'));
    sock.on('connect', () => msg(''));
    sock.on('disconnect', () => { if (room) { room = null; stopTimer(); goMenu(); msg('서버와 연결이 끊어졌어요.'); mpShow('mpLobby'); } });

    sock.on('room', r => { room = r; renderRoom(); if (r.phase === 'lobby' && !showingEnd) { cleanup3D(); mpShow('mpRoom'); } });

    sock.on('question', d => {
      cur = d; myChoice = -1; showingEnd = false;
      state = 'play'; G = null;
      const c = Q[d.k];
      document.documentElement.style.setProperty('--c', d.boss ? '#ff5d6c' : c.css);
      if (d.boss) { killMon(); setObj(c.obj); tint.color.setHex(0xff3040); if (d.i === d.total - 2) { pop('WARNING\nBOSS 등장', false); beep(330, .3, 'sawtooth', .05); beep(440, .3, 'sawtooth', .05, .3); } }
      else { setObj(''); tint.color.setHex(c.color); spawnMon(d.k); }
      g('mpCat').textContent = (d.boss ? 'BOSS ×3 · ' : '') + c.name;
      g('mpProg').textContent = `${d.i + 1}/${d.total}`;
      g('mpQ').textContent = d.text;
      const box = g('mpOpts'); box.innerHTML = '';
      d.opts.forEach((t, n) => {
        const b = document.createElement('button'); b.className = 'opt';
        b.innerHTML = '<span class="k"></span><span></span>'; b.firstChild.textContent = n + 1; b.lastChild.textContent = t;
        b.onclick = () => choose(n); box.append(b);
      });
      g('mpExp').hidden = true;
      renderBoard();
      endAt = performance.now() + d.duration; stopTimer();
      timerId = setInterval(() => { const left = Math.max(0, (endAt - performance.now()) / 1000); const t = g('mpTimer'); t.textContent = left.toFixed(1); t.classList.toggle('low', left < 5); }, 100);
      mpShow('mpGame');
    });

    sock.on('answered', d => { if (cur) g('mpProg').textContent = `${cur.i + 1}/${cur.total} · 응답 ${d.count}/${d.total}`; });

    sock.on('reveal', d => {
      stopTimer(); room = d.room;
      [...g('mpOpts').children].forEach((b, j) => { b.disabled = true; b.classList.add(j === d.answer ? 'ok' : j === myChoice ? 'bad' : 'dim'); });
      const mine = d.results.find(r => r.id === sock.id), k = cur.k;
      if (mine && mine.ok) {
        fireLaser(Q[k].color); beep(660, .12); beep(990, .2, 'sine', .07, .09);
        if (cur.boss) { knock = 1; flashS.material.opacity = 1; doBurst(0xff6060); spin = 1.2; }
        else setTimeout(() => { if (mon) { mon.ph = 'die'; mon.t = 0; mon.flash = 1; } doBurst(Q[k].color); }, 160);
        pop(`정답! +${mine.gain}`, true);
      } else {
        if (cur.boss) lunge = 1; else if (mon) { mon.ph = 'atk'; mon.t = 0; }
        setTimeout(() => { shake = reduce ? 0 : .7; redFlash(); beep(180, .32, 'sawtooth', .05); }, 280);
        pop(myChoice < 0 ? '시간 초과!' : '오답!', false);
      }
      const winners = d.results.filter(r => r.ok).map(r => r.name);
      const p = g('mpExpT'); p.innerHTML = '';
      const b = document.createElement('b'); b.textContent = `정답 "${d.correctText}" `;
      p.append(b, d.exp, document.createElement('br'), winners.length ? `맞힌 사람: ${winners.join(', ')}` : '아무도 못 맞혔어요!');
      g('mpExp').hidden = false;
      renderBoard(d.results);
    });

    sock.on('end', d => {
      stopTimer(); showingEnd = true; cleanup3D();
      const top = d.rank[0];
      g('mpWinner').textContent = top ? `1등 ${top.name}` : '결과';
      const box = g('mpRank'); box.innerHTML = '';
      d.rank.forEach((p, i) => box.append(row(p, tag(`${i + 1}위`))));
      if (top && top.id === sock.id) { setObj('atom'); spin = 2; doBurst(0xffffff); pop('우승!', true); beep(880, .4, 'triangle', .05); }
      mpShow('mpEnd');
    });
    return true;
  }

  function choose(n) {
    if (!cur || myChoice >= 0) return;
    myChoice = n; sock.emit('answer', n);
    [...g('mpOpts').children].forEach((b, j) => { b.disabled = true; if (j === n) b.classList.add('sel'); });
    beep(520, .08, 'triangle', .04);
  }
  function stopTimer() { clearInterval(timerId); timerId = null; }
  function cleanup3D() { killMon(); setObj(''); }
  function goMenu() { stopTimer(); cleanup3D(); cur = null; state = 'menu'; menuT = 0; }
  function saveName() { const n = g('mpName').value.trim(); try { localStorage.setItem('sq-name', n); } catch (e) {} return n; }

  /* ---------- 버튼 ---------- */
  g('mpTile').onclick = () => { msg(''); mpShow('mpLobby'); connect(); };
  g('mpBack').onclick = () => { goMenu(); mpShow('menu'); };
  g('mpCreate').onclick = () => {
    const name = saveName(); if (!name) return msg('닉네임을 입력해 주세요.');
    if (!connect()) return;
    sock.emit('create', { name, mode: modeSel.value }, r => { if (!r.ok) msg(r.msg); });
  };
  g('mpJoin').onclick = () => {
    const name = saveName(), code = g('mpCode').value.trim().toUpperCase();
    if (!name) return msg('닉네임을 입력해 주세요.');
    if (code.length !== 4) return msg('방 코드 4자리를 입력해 주세요.');
    if (!connect()) return;
    sock.emit('join', { name, code }, r => { if (!r.ok) msg(r.msg); });
  };
  g('mpStart').onclick = () => sock && sock.emit('start');
  const leave = () => { if (sock) sock.emit('leave'); room = null; showingEnd = false; goMenu(); mpShow('mpLobby'); };
  g('mpLeave').onclick = leave;
  g('mpAgain').onclick = () => { showingEnd = false; cleanup3D(); renderRoom(); mpShow('mpRoom'); };
  g('mpHome').onclick = () => { if (sock) sock.emit('leave'); room = null; showingEnd = false; goMenu(); mpShow('menu'); };
  addEventListener('keydown', e => { if (!g('mpGame').hidden && cur && e.key >= '1' && e.key <= '4') choose(+e.key - 1); });
})();
