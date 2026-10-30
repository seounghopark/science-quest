// 사이언스 퀘스트 3D — 로그인 · 반 선택 · 랭킹
// index.html에서 mp.js 다음에 불러온다.
(() => {
  const BASE = (window.MP_SERVER || '').replace(/\/$/, '');
  const g = id => document.getElementById(id);
  const TKEY = 'sq-token';
  let token = null, user = null, rankData = null;
  try { token = localStorage.getItem(TKEY); } catch (e) {}
  window.SQ_TOKEN = token;

  /* ---------- 스타일 · 화면 ---------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
    .au-inp{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--fg);font:600 16px var(--body)}
    .au-inp:focus{outline:2px solid var(--c);outline-offset:1px}
    .au-f{display:flex;flex-direction:column;gap:6px}
    .au-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .au-tab{padding:10px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--muted);font:800 14px var(--body);cursor:pointer}
    .au-tab.on{background:rgba(255,255,255,.1);color:var(--fg);border-color:var(--c)}
    .au-cls{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .au-cls button{padding:14px 0;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--fg);font:400 22px var(--display);cursor:pointer}
    .au-cls button small{display:block;font:600 11px var(--body);color:var(--muted)}
    .au-cls button.on{border-color:var(--c);background:rgba(255,255,255,.12);box-shadow:0 0 0 1px var(--c)}
    .au-msg{margin:0;font-size:13px;color:var(--bad);min-height:1.2em}
    .au-prof{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:13px}
    .au-prof b{font-size:15px}
    .au-prof .r{color:var(--c);font-weight:800;font-variant-numeric:tabular-nums}
    .au-prof .sp{margin-left:auto;display:flex;gap:6px}
    .au-prof button{padding:6px 10px;font-size:12px}
    .rk-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:640px){.rk-grid{grid-template-columns:1fr}}
    .rk-col{display:flex;flex-direction:column;gap:6px;min-width:0}
    .rk-col h3{margin:0;font-size:14px;display:flex;justify-content:space-between;gap:8px}
    .rk-col h3 span{color:var(--c);font-variant-numeric:tabular-nums}
    .rk-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);font-size:14px;min-width:0}
    .rk-row .n{width:2.2em;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums}
    .rk-row.top1 .n{color:#ffd166}.rk-row.top2 .n{color:#cfd6e6}.rk-row.top3 .n{color:#e0a46a}
    .rk-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .rk-row .c{font-size:11px;color:var(--muted)}
    .rk-row b{margin-left:auto;font-variant-numeric:tabular-nums}
    .rk-row.me{outline:1px solid var(--c);background:rgba(255,255,255,.1)}
    .rk-gap{text-align:center;color:var(--muted);font-size:12px}
    .rk-empty{color:var(--muted);font-size:13px;padding:8px 0}
  </style>`);

  document.querySelector('.stage').insertAdjacentHTML('beforeend', `
  <section class="panel" id="auLogin" hidden>
    <p class="eyebrow">3학년 과학 · 시험 범위</p>
    <h1>사이언스<br><span>퀘스트</span></h1>
    <div class="au-tabs"><button class="au-tab on" id="auTabIn">로그인</button><button class="au-tab" id="auTabUp">처음이에요 (회원가입)</button></div>
    <div class="au-f"><label class="lab" for="auId">아이디</label><input id="auId" class="au-inp" maxlength="12" autocomplete="username" placeholder="2~12자 한글·영문·숫자"></div>
    <div class="au-f"><label class="lab" for="auPw">비밀번호</label><input id="auPw" class="au-inp" type="password" maxlength="64" autocomplete="current-password" placeholder="4자 이상"></div>
    <div class="au-f" id="auClsBox" hidden><span class="lab">우리 반 고르기</span>
      <div class="au-cls"><button data-c="1"><small>3학년</small>1반</button><button data-c="2"><small>3학년</small>2반</button><button data-c="3"><small>3학년</small>3반</button></div>
    </div>
    <button class="primary" id="auGo">로그인</button>
    <p class="au-msg" id="auMsg"></p>
  </section>
  <section class="panel" id="auRank" hidden>
    <div class="qhead"><h2>랭킹</h2><button class="ghost" id="auRankBack">닫기</button></div>
    <p class="sub" id="auRankSub">누적 점수 순위예요. 혼자 하기와 온라인 대전 점수가 모두 더해져요.</p>
    <div class="rk-grid"><div class="rk-col" id="rkCls"></div><div class="rk-col" id="rkAll"></div></div>
  </section>`);

  g('menu').insertAdjacentHTML('afterbegin', `<div class="au-prof" id="auProf" hidden>
    <b id="apName"></b><span id="apTotal"></span><span>반 <span class="r" id="apCls">-</span></span><span>학년 <span class="r" id="apAll">-</span></span>
    <span class="sp"><button class="ghost" id="apRank">랭킹 보기</button><button class="ghost" id="apOut">로그아웃</button></span>
  </div>`);

  const PANELS = ['menu', 'game', 'result', 'dex', 'mpLobby', 'mpRoom', 'mpGame', 'mpEnd', 'auLogin', 'auRank'];
  function showP(id) {
    PANELS.forEach(p => { const el = g(p); if (!el) return; el.hidden = p !== id; if (p === id) { el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } });
  }
  const fmt = n => Number(n || 0).toLocaleString('ko-KR');
  const msg = t => { g('auMsg').textContent = t; };

  /* ---------- 서버 통신 ---------- */
  async function call(path, body) {
    const opt = { method: body ? 'POST' : 'GET', headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(BASE + path, opt); } catch (e) { throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인하고, 서버가 깨어나는 데 30초쯤 걸릴 수 있으니 잠시 후 다시 해 주세요.'); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/login') { logout(true); }
    if (!r.ok) throw new Error(d.msg || '요청에 실패했어요.');
    return d;
  }

  function setSession(t, u) {
    token = t; user = u; window.SQ_TOKEN = t; window.SQ_USER = u;
    try { localStorage.setItem(TKEY, t); } catch (e) {}
  }
  function logout(expired) {
    token = null; user = null; window.SQ_TOKEN = null; window.SQ_USER = null;
    try { localStorage.removeItem(TKEY); } catch (e) {}
    if (expired) { showLogin(); msg('로그인이 만료됐어요. 다시 로그인해 주세요.'); }
    else location.reload(); // 대전 연결까지 깔끔하게 초기화
  }

  /* ---------- 로그인 화면 ---------- */
  let signup = false, pickCls = 0;
  function setTab(up) {
    signup = up;
    g('auTabIn').classList.toggle('on', !up); g('auTabUp').classList.toggle('on', up);
    g('auClsBox').hidden = !up; g('auGo').textContent = up ? '가입하고 시작하기' : '로그인';
    g('auPw').autocomplete = up ? 'new-password' : 'current-password';
    msg('');
  }
  g('auTabIn').onclick = () => setTab(false);
  g('auTabUp').onclick = () => setTab(true);
  document.querySelectorAll('.au-cls button').forEach(b => b.onclick = () => {
    pickCls = +b.dataset.c;
    document.querySelectorAll('.au-cls button').forEach(x => x.classList.toggle('on', x === b));
  });
  async function go() {
    const id = g('auId').value.trim(), pw = g('auPw').value;
    if (!id || !pw) return msg('아이디와 비밀번호를 입력해 주세요.');
    if (signup && !pickCls) return msg('우리 반을 골라 주세요.');
    g('auGo').disabled = true; msg(signup ? '가입하는 중…' : '로그인하는 중…');
    try {
      const d = await call(signup ? '/api/signup' : '/api/login', signup ? { id, pw, cls: pickCls } : { id, pw });
      setSession(d.token, d.user); g('auPw').value = ''; msg('');
      enterMenu();
    } catch (e) { msg(e.message); }
    g('auGo').disabled = false;
  }
  g('auGo').onclick = go;
  ['auId', 'auPw'].forEach(id => g(id).addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));

  function showLogin() { g('hud').hidden = true; showP('auLogin'); }

  /* ---------- 메뉴 프로필 · 랭킹 ---------- */
  function renderProfile() {
    if (!user) return;
    g('auProf').hidden = false;
    g('apName').textContent = `3학년 ${user.cls}반 ${user.id}`;
    g('apTotal').textContent = `누적 ${fmt(user.total)}점`;
    if (rankData) {
      g('apCls').textContent = `${rankData.me.clsRank}위`;
      g('apAll').textContent = `${rankData.me.allRank}위`;
    }
    // 대전 닉네임은 계정 이름으로 고정
    const nm = g('mpName'); if (nm) { nm.value = user.id; nm.disabled = true; }
  }
  async function loadRank() {
    try { rankData = await call('/api/rank'); user = Object.assign(user || {}, rankData.me); renderProfile(); }
    catch (e) { /* 메뉴는 계속 쓸 수 있게 둔다 */ }
    return rankData;
  }
  function enterMenu() { renderProfile(); showP('menu'); loadRank(); }

  function rankList(box, title, list, me, myRank, count, showCls) {
    box.innerHTML = '';
    const h = document.createElement('h3'); h.append(title); const s = document.createElement('span');
    s.textContent = `내 순위 ${myRank}위 / ${count}명`; h.append(s); box.append(h);
    if (!list.length) { const e = document.createElement('div'); e.className = 'rk-empty'; e.textContent = '아직 기록이 없어요. 첫 1등이 되어 보세요!'; box.append(e); return; }
    const row = (p, n) => {
      const d = document.createElement('div');
      d.className = 'rk-row' + (n <= 3 ? ' top' + n : '') + (p.id === me.id ? ' me' : '');
      const a = document.createElement('span'); a.className = 'n'; a.textContent = n;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.id;
      d.append(a, nm);
      if (showCls) { const c = document.createElement('span'); c.className = 'c'; c.textContent = `${p.cls}반`; d.append(c); }
      const b = document.createElement('b'); b.textContent = fmt(p.total); d.append(b);
      return d;
    };
    // 같은 점수는 같은 순위
    let prev = null, rank = 0;
    list.forEach((p, i) => { if (p.total !== prev) { rank = i + 1; prev = p.total; } box.append(row(p, rank)); });
    if (!list.some(p => p.id === me.id)) {
      const gap = document.createElement('div'); gap.className = 'rk-gap'; gap.textContent = '···'; box.append(gap);
      box.append(row({ id: me.id, cls: me.cls, total: me.total }, myRank));
    }
  }
  async function openRank() {
    showP('auRank');
    g('rkCls').textContent = '불러오는 중…'; g('rkAll').textContent = '';
    const d = await loadRank();
    if (!d) { g('rkCls').textContent = '랭킹을 불러오지 못했어요. 잠시 후 다시 열어 주세요.'; return; }
    rankList(g('rkCls'), `3학년 ${d.me.cls}반 랭킹`, d.cls, d.me, d.me.clsRank, d.me.clsCount, false);
    rankList(g('rkAll'), '3학년 전체 랭킹', d.all, d.me, d.me.allRank, d.me.allCount, true);
  }
  g('apRank').onclick = openRank;
  g('auRankBack').onclick = () => showP('menu');
  g('apOut').onclick = () => logout(false);

  /* ---------- 혼자 하기 결과를 랭킹에 기록 ---------- */
  const origEnd = window.end;
  if (typeof origEnd === 'function') {
    window.end = function () {
      origEnd.apply(this, arguments);
      if (!user || !G || !(G.score > 0)) return;
      const line = g('rXp');
      call('/api/score', { score: G.score })
        .then(d => { user = Object.assign(user, d.user); return loadRank(); })
        .then(r => { if (r && line) line.textContent += ` · 랭킹 반 ${r.me.clsRank}위, 학년 ${r.me.allRank}위`; })
        .catch(e => { if (line) line.textContent += ` · 랭킹 기록 실패: ${e.message}`; });
    };
  }
  // 메뉴로 돌아올 때마다 순위 새로고침
  ['home', 'again'].forEach(id => { const b = g(id); if (b) b.addEventListener('click', () => { if (user) loadRank(); }); });
  const mpHome = g('mpHome'); if (mpHome) mpHome.addEventListener('click', () => { if (user) loadRank(); });

  /* ---------- 시작 ---------- */
  showLogin();
  if (token) {
    msg('로그인 확인 중…');
    call('/api/me').then(d => { setSession(token, d.user); msg(''); enterMenu(); }).catch(e => { if (token) msg(e.message); });
  }
})();
