/* =========================================================
 * 클라우드 저장 + 로그인·관리자 승인 (Firebase Auth + Cloud Firestore)
 *
 *  컬렉션
 *   admins/{email}    관리자 (Firebase 콘솔에서만 추가)
 *   allowed/{email}   승인된 사용자 (관리자가 추가·해제)
 *   requests/{email}  사용 승인 요청 (본인이 생성, 관리자가 처리)
 *   plans/{id}        교육과정 문서 (소유자 + 공동 편집자)
 * ========================================================= */
(function () {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const LAST_PLAN_KEY = 'school-curriculum-planner-lastplan';
  const SID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REQUIRE = !!window.FIREBASE_CONFIG && window.REQUIRE_LOGIN !== false;

  let fb = null;            // { auth, db, A, F }
  let fbFailed = false;
  let user = null;
  let access = 'unknown';   // unknown | signedout | none | pending | approved
  let admin = false;
  let profileName = '';     // 가입 때 등록한 이름
  let cur = null;           // { id, meta, unsub }
  let pushTimer = null, lastPushed = null;

  const dlg = $('cloudDlg');
  $('cloudClose').addEventListener('click', () => dlg.close());
  $('btnCloud').addEventListener('click', () => { dlg.showModal(); renderPanel($('cloudBody')); });

  /* ---------- app.js 와의 연결 ---------- */
  Object.assign(window.App, {
    /** 로그인·승인 전이면 메뉴 잠금 (연결 실패 시에는 이 PC 모드로 허용) */
    locked: () => REQUIRE && !fbFailed && access !== 'approved',
    isAdmin: () => admin,
    /** 'admin' 편성·편집 / 'teacher' 조회 전용 / 'none' 로그인·승인 전. 클라우드를 안 쓰면 이 PC 도구로 'admin' */
    role: () => (!window.FIREBASE_CONFIG || fbFailed) ? 'admin' : (user && access === 'approved') ? (admin ? 'admin' : 'teacher') : 'none',
    renderGate,
  });
  RENDER.data = () => renderPanel($('dataCloud'));
  RENDER.admin = renderAdmin;

  /** 다른 모듈(activities.js)이 쓰는 클라우드 접근점. 상태가 바뀌면 'cloud-change' 이벤트 */
  window.Cloud = {
    get ready() { return !!fb && !!user && access === 'approved'; },
    get fb() { return fb; },
    get user() { return user; },
    get configured() { return !!window.FIREBASE_CONFIG && !fbFailed; },
    get profileName() { return profileName; },
    get email() { return myEmail(); },
    isAdmin: () => admin,
  };

  function setStatus(msg) { $('cloudState').textContent = msg; $('btnCloud').title = msg + ' · ' + $('saveState').textContent; }
  function hhmm() { return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
  function fmtTime(ts) { try { return ts ? ts.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } }
  const myEmail = () => (user && user.email ? user.email.toLowerCase() : '');
  const D = (...p) => fb.F.doc(fb.db, ...p);

  function refreshUi() {
    $('btnCloud').textContent = user ? '👤 ' + (profileName || user.displayName || myEmail()).split(' ')[0] : '👤 로그인';
    $('navAdmin').hidden = !admin;
    $('homeAdmin').hidden = !admin;
    document.dispatchEvent(new Event('cloud-change'));
    applyRoleView();
    const pending = window.App.pendingTab;
    if (window.App.locked() && curTab !== 'home') showTab('home');
    else if (!window.App.locked() && pending) { window.App.pendingTab = null; showTab(pending); }
    else RENDER[curTab]();
    if (dlg.open) renderPanel($('cloudBody'));
  }

  /* ---------- 초기화 ---------- */
  async function init() {
    if (!window.FIREBASE_CONFIG) { refreshUi(); return; }
    setStatus('☁ 연결 중…');
    try {
      const [app, auth, fs] = await Promise.all([
        import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
      ]);
      const a = app.initializeApp(window.FIREBASE_CONFIG);
      fb = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
      auth.onAuthStateChanged(fb.auth, onAuth);
    } catch (e) {
      console.warn(e);
      fbFailed = true; setStatus('☁ 연결 실패 (이 PC 모드)');
      refreshUi();
    }
  }

  async function onAuth(u) {
    user = u; admin = false;
    if (!u) { closePlan(); access = 'signedout'; setStatus('☁ 로그인 필요'); refreshUi(); return; }
    await checkAccess();
    if (access === 'approved') {
      setStatus('☁ 로그인됨');
      if (admin) {
        const last = localStorage.getItem(LAST_PLAN_KEY);
        if (last && !cur) { try { await openPlan(last); } catch (e) { localStorage.removeItem(LAST_PLAN_KEY); } }
      }
    } else setStatus(access === 'pending' ? '☁ 승인 대기 중' : '☁ 승인 필요');
    refreshUi();
  }

  async function checkAccess() {
    const F = fb.F, e = myEmail();
    const safe = p => p.catch(() => null);
    const [a, al, rq] = await Promise.all([
      safe(F.getDoc(D('admins', e))), safe(F.getDoc(D('allowed', e))), safe(F.getDoc(D('requests', e))),
    ]);
    const isAdm = !!(a && a.exists()), isAllowed = !!(al && al.exists()), isReq = !!(rq && rq.exists());
    admin = isAdm;
    // 가입(승인 요청) 때 등록한 이름. 기록자 이름으로 쓰임
    profileName = isAllowed ? (al.data().name || '') : isReq ? (rq.data().name || '') : '';
    access = isAdm || isAllowed ? 'approved' : isReq ? 'pending' : 'none';
  }

  /** 내 표시 이름 저장 (본인은 이름만 고칠 수 있음, 관리자는 허용 문서가 없으면 새로 만듦) */
  async function saveMyName(name) {
    name = String(name || '').trim().slice(0, 30);
    if (!name) { alert('이름을 입력하세요.'); return false; }
    const F = fb.F;
    await F.setDoc(D('allowed', myEmail()), admin ? { email: myEmail(), name, addedBy: myEmail(), addedAt: F.serverTimestamp() } : { name }, { merge: true });
    profileName = name;
    refreshUi();
    return true;
  }

  /* ---------- 저장 ---------- */
  window.App.onSave = () => {
    if (!cur || !fb) return;
    setStatus('☁ 저장 대기…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1200);
  };

  async function push() {
    pushTimer = null;
    if (!cur) return;
    const s = window.App.getState();
    const json = JSON.stringify(s);
    if (json === lastPushed) { setStatus(`☁ 저장됨 ${hhmm()}`); return; }
    try {
      setStatus('☁ 저장 중…');
      await fb.F.updateDoc(D('plans', cur.id), {
        stateJson: json, title: s.school.name || '이름 없는 교육과정', year: s.school.year,
        updatedAt: fb.F.serverTimestamp(), updatedBy: myEmail(), session: SID,
      });
      lastPushed = json;
      setStatus(`☁ 저장됨 ${hhmm()}`);
    } catch (e) {
      console.warn(e);
      setStatus('☁ 저장 실패(권한·네트워크 확인)');
    }
  }

  /* ---------- 문서 열기/닫기 ---------- */
  async function openPlan(id) {
    const F = fb.F;
    closePlan();
    const ref = D('plans', id);
    const snap = await F.getDoc(ref);
    if (!snap.exists()) throw new Error('문서가 없습니다.');
    cur = { id, meta: snap.data(), unsub: null };
    lastPushed = snap.data().stateJson;
    window.App.setState(JSON.parse(snap.data().stateJson));
    localStorage.setItem(LAST_PLAN_KEY, id);
    setStatus(`☁ ${snap.data().title}`);
    cur.unsub = F.onSnapshot(ref, d => {
      if (!d.exists()) { alert('이 교육과정 문서가 삭제되었습니다. 이 PC 저장 모드로 전환합니다.'); closePlan(); localStorage.removeItem(LAST_PLAN_KEY); return; }
      if (d.metadata.hasPendingWrites) return;
      const data = d.data();
      cur.meta = data;
      if (data.stateJson === lastPushed || pushTimer) return; // 내 변경이 저장 대기 중이면 내 내용 우선
      lastPushed = data.stateJson;
      window.App.setState(JSON.parse(data.stateJson));
      setStatus(`☁ ${data.updatedBy || '다른 사용자'} 수정 반영 ${hhmm()}`);
    }, err => { console.warn(err); setStatus('☁ 동기화 끊김'); });
  }

  function closePlan() {
    if (cur && cur.unsub) cur.unsub();
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    cur = null; lastPushed = null;
  }

  /* ---------- 문서 목록·생성·공유·삭제 ---------- */
  async function listPlans() {
    const F = fb.F, col = F.collection(fb.db, 'plans');
    const [own, shared] = await Promise.all([
      F.getDocs(F.query(col, F.where('ownerUid', '==', user.uid))),
      F.getDocs(F.query(col, F.where('editors', 'array-contains', user.email))).catch(e => { console.warn('공유 문서 조회 실패', e); return { docs: [] }; }),
    ]);
    const map = new Map();
    [...own.docs, ...shared.docs].forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    return [...map.values()].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  }

  async function createPlan() {
    const F = fb.F, s = window.App.getState();
    const ref = await F.addDoc(F.collection(fb.db, 'plans'), {
      ownerUid: user.uid, ownerEmail: myEmail(), editors: [],
      title: s.school.name || '이름 없는 교육과정', year: s.school.year,
      stateJson: JSON.stringify(s), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(),
      updatedBy: myEmail(), session: SID,
    });
    await openPlan(ref.id);
  }

  async function sharePlan(p) {
    const v = prompt('함께 편집할 사람의 구글 이메일을 쉼표로 구분해 입력하세요.\n(관리자 승인을 받은 사람만 실제로 열 수 있습니다. 빈칸이면 공유 해제)', (p.editors || []).join(', '));
    if (v === null) return;
    const list = [...new Set(v.split(/[,\s;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    await fb.F.updateDoc(D('plans', p.id), { editors: list });
  }

  async function deletePlan(p) {
    if (!confirm(`"${p.title}" (${p.year}학년도) 문서를 클라우드에서 영구 삭제합니다. 공동 편집자도 더 이상 열 수 없고 되돌릴 수 없습니다. 삭제할까요?`)) return false;
    if (cur && cur.id === p.id) { closePlan(); localStorage.removeItem(LAST_PLAN_KEY); }
    await fb.F.deleteDoc(D('plans', p.id));
    return true;
  }

  async function login() {
    const A = fb.A, provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try { await A.signInWithPopup(fb.auth, provider); }
    catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await A.signInWithRedirect(fb.auth, provider);
      else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert('로그인 실패: ' + (e.code === 'auth/unauthorized-domain' ? '이 주소가 Firebase 승인 도메인에 등록되지 않았습니다.' : e.message));
    }
  }
  async function logout() {
    closePlan(); localStorage.removeItem(LAST_PLAN_KEY);
    await fb.A.signOut(fb.auth);
  }

  async function requestAccess(name, role) {
    name = String(name || '').trim().slice(0, 30);
    role = String(role || '').trim().slice(0, 40);
    if (!name) { alert('이름(실명)을 입력하세요. 이 사이트에서 계속 쓰이는 이름입니다.'); return; }
    await fb.F.setDoc(D('requests', myEmail()), { email: myEmail(), name, role, requestedAt: fb.F.serverTimestamp() });
    profileName = name;
    access = 'pending'; setStatus('☁ 승인 대기 중'); refreshUi();
  }

  /* =========================================================
   * HOME 의 로그인·승인 안내
   * ========================================================= */
  function renderGate(el) {
    if (!window.FIREBASE_CONFIG) { el.innerHTML = ''; return; }
    if (fbFailed) { el.innerHTML = `<div class="gate warn">클라우드에 연결하지 못해 <b>이 PC 저장 모드</b>로 동작합니다.</div>`; return; }
    if (!fb || access === 'unknown') { el.innerHTML = `<div class="gate">연결 중…</div>`; return; }
    if (access === 'signedout') {
      el.innerHTML = `<div class="gate"><b>로그인이 필요합니다.</b><p>관리자의 승인을 받은 구글 계정으로 로그인하세요.</p>
        <button class="btn primary" data-act="login">Google 계정으로 로그인</button></div>`;
    } else if (access === 'none') {
      el.innerHTML = `<div class="gate warn signup"><b>선생님 등록 신청</b>
        <p>${esc(myEmail())} 계정으로 처음 오셨습니다. 아래 내용을 입력해 등록을 신청하면, 관리자가 승인한 뒤부터 사용할 수 있습니다.</p>
        <label>이름(실명) <span class="neg">*</span><input id="gateName" type="text" maxlength="30" placeholder="예: 홍길동"></label>
        <label>담당 <span class="hint">(선택)</span><input id="gateRole" type="text" maxlength="40" placeholder="예: 3학년 1반 담임, 한국어학급"></label>
        <p class="hint">입력한 이름은 이 사이트에서 계속 사용됩니다(일정 기록자 등). 바꿔야 하면 관리자에게 요청하세요.</p>
        <div class="row"><button class="btn primary" data-act="request">등록 신청</button><button class="btn small" data-act="logout">다른 계정으로 로그인</button></div></div>`;
    } else if (access === 'pending') {
      el.innerHTML = `<div class="gate warn"><b>등록 승인 대기 중입니다.</b><p>${esc(profileName)} 선생님 (${esc(myEmail())}) — 관리자가 승인하면 그때부터 사용할 수 있습니다.</p>
        <div class="row"><button class="btn small" data-act="recheck">승인 여부 다시 확인</button><button class="btn small" data-act="logout">로그아웃</button></div></div>`;
    } else {
      el.innerHTML = `<div class="gate ok">✅ <b>${esc(profileName || myEmail())}</b> 선생님 ${admin ? '(관리자)' : ''}
        ${!profileName ? `<p class="neg">등록된 이름이 없습니다. ${admin ? '관리자 메뉴에서 내 이름을 등록하세요.' : '관리자에게 이름 등록을 요청하세요.'}</p>` : ''}
        <p>${cur ? `열린 문서: <b>${esc(cur.meta.title)}</b>` : '열린 클라우드 문서가 없습니다. <a href="#data">자료 관리</a>에서 문서를 만들거나 여세요.'}</p></div>`;
    }
    el.onclick = gateAction;
  }

  async function gateAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    try {
      if (b.dataset.act === 'login') await login();
      else if (b.dataset.act === 'logout') await logout();
      else if (b.dataset.act === 'request') await requestAccess($('gateName').value, $('gateRole').value);
      else if (b.dataset.act === 'recheck') { await checkAccess(); if (access === 'approved') await onAuth(user); else { alert('아직 승인되지 않았습니다.'); refreshUi(); } }
    } catch (err) { alert('실패: ' + err.message); }
  }

  /* =========================================================
   * 클라우드 문서 패널 (자료 관리 화면 + ☁ 대화상자)
   * ========================================================= */
  async function renderPanel(body) {
    if (!body) return;
    if (!window.FIREBASE_CONFIG) {
      body.innerHTML = `<p>클라우드가 설정되지 않았습니다. 지금은 <b>이 PC(브라우저)</b>에만 저장됩니다.</p>
        <p class="hint"><code>cloud-config.js</code>에 Firebase 설정을 넣으면 구글 로그인으로 어디서나 같은 자료를 쓸 수 있습니다. (클라우드_설정_안내.md 참고)</p>`;
      return;
    }
    if (fbFailed) { body.innerHTML = `<p>클라우드 서버에 연결하지 못했습니다. 인터넷 연결 또는 학교 방화벽을 확인하세요.</p>`; return; }
    if (access !== 'approved') { renderGate(body); return; }
    if (!admin) {   // 선생님: 계정 정보만
      body.innerHTML = `<p><b>${esc(profileName || myEmail())}</b> 선생님 (${esc(myEmail())})</p>
        <p class="hint">학사일정은 관리자가 정한 학교 공용 학사일정을 조회하고, 교육활동 일정은 직접 신청할 수 있습니다.</p>
        <button class="btn small" data-c="logout">로그아웃</button>`;
      body.onclick = async e => { const b = e.target.closest('[data-c="logout"]'); if (b) { await logout(); if (dlg.open) dlg.close(); } };
      return;
    }

    body.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px">
        <span>${esc(myEmail())} ${admin ? '<span class="pill ok">관리자</span>' : ''} · ${cur ? `열린 문서: <b>${esc(cur.meta.title)}</b>` : '열린 문서 없음 (이 PC 저장 모드)'}</span>
        <span class="row">${cur ? '<button class="btn small" data-c="local">문서 닫기</button>' : ''}<button class="btn small" data-c="logout">로그아웃</button></span>
      </div>
      <button class="btn primary small" data-c="new">+ 지금 화면의 내용으로 새 문서 만들기</button>
      <h3>내 교육과정 문서</h3><div class="plist hint">불러오는 중…</div>`;
    let plans = [];
    const listEl = body.querySelector('.plist');
    try {
      plans = await listPlans();
      listEl.classList.remove('hint');
      listEl.innerHTML = plans.length ? `<table class="tbl compact"><tr><th class="l">제목</th><th>학년도</th><th>소유자</th><th>공동 편집</th><th>최근 수정</th><th></th></tr>` +
        plans.map(p => {
          const mine = p.ownerUid === user.uid;
          return `<tr${cur && cur.id === p.id ? ' class="sub"' : ''}><td class="l">${esc(p.title)}${cur && cur.id === p.id ? ' <span class="pill ok">열림</span>' : ''}</td><td>${esc(p.year)}</td>
            <td>${mine ? '나' : esc(p.ownerEmail)}</td><td>${(p.editors || []).length}명</td>
            <td class="num">${fmtTime(p.updatedAt)}<br><span class="hint">${esc(p.updatedBy || '')}</span></td>
            <td><button class="btn small" data-c="open" data-id="${p.id}">열기</button>
              ${mine ? `<button class="btn small" data-c="share" data-id="${p.id}">공유</button><button class="btn small danger" data-c="del" data-id="${p.id}">삭제</button>` : ''}</td></tr>`;
        }).join('') + '</table>'
        : '아직 클라우드에 저장된 문서가 없습니다. 위 버튼으로 새 문서를 만드세요.';
    } catch (e) { listEl.textContent = '목록을 불러오지 못했습니다: ' + e.message; }

    body.onclick = async e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      const p = plans.find(x => x.id === b.dataset.id);
      try {
        switch (b.dataset.c) {
          case 'logout': await logout(); return;
          case 'local': closePlan(); localStorage.removeItem(LAST_PLAN_KEY); setStatus('☁ 로그인됨'); break;
          case 'new': await createPlan(); break;
          case 'open':
            if (!cur && !confirm('클라우드 문서를 열면 지금 화면의 내용이 그 문서 내용으로 바뀝니다. (필요하면 먼저 백업 저장) 계속할까요?')) return;
            await openPlan(p.id); if (dlg.open) dlg.close(); break;
          case 'share': await sharePlan(p); break;
          case 'del': if (!(await deletePlan(p))) return; break;
        }
        renderPanel(body);
      } catch (err) { alert('실패: ' + err.message); }
    };
  }

  /* =========================================================
   * 관리자: 승인 요청 처리, 허용 사용자 관리
   * ========================================================= */
  async function renderAdmin() {
    const el = $('adminBody');
    if (!admin) { el.innerHTML = '<div class="card">관리자만 볼 수 있습니다.</div>'; return; }
    el.innerHTML = `
      <div class="card"><h2>관리자 내 이름</h2>
        <div class="row"><input id="admMyName" type="text" maxlength="30" value="${esc(profileName)}" placeholder="이름(실명)" style="width:160px">
        <button class="btn small primary" data-a="myname">저장</button>
        <span class="hint">관리자 계정의 사이트 표시 이름(일정 기록자 등)입니다.</span></div></div>
      <div class="card"><h2>등록 신청 (승인 대기)</h2><div id="admReq" class="hint">불러오는 중…</div></div>
      <div class="card"><div class="card-head"><h2>허용된 사용자</h2></div>
        <div class="row" style="margin-bottom:10px">
          <input id="admEmail" type="email" placeholder="추가할 구글 이메일" style="width:260px">
          <input id="admMemo" type="text" placeholder="이름(실명)" style="width:160px">
          <button class="btn primary small" data-a="add">직접 추가</button>
        </div>
        <div id="admAllowed" class="hint">불러오는 중…</div>
        <p class="hint">관리자 계정 추가·변경은 Firebase 콘솔의 <code>admins</code> 컬렉션에서 합니다.</p></div>`;
    const F = fb.F;
    try {
      const [rq, al] = await Promise.all([F.getDocs(F.collection(fb.db, 'requests')), F.getDocs(F.collection(fb.db, 'allowed'))]);
      const reqs = rq.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.requestedAt?.seconds || 0) - (b.requestedAt?.seconds || 0));
      const allowed = al.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
      $('admReq').classList.remove('hint');
      $('admReq').innerHTML = reqs.length ? `<table class="tbl compact"><tr><th class="l">이메일</th><th>이름</th><th>담당</th><th>신청 시각</th><th></th></tr>` +
        reqs.map(r => `<tr><td class="l">${esc(r.id)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.role || '')}</td><td class="num">${fmtTime(r.requestedAt)}</td>
          <td><button class="btn small primary" data-a="approve" data-e="${esc(r.id)}" data-n="${esc(r.name)}" data-r="${esc(r.role || '')}">승인</button>
          <button class="btn small danger" data-a="reject" data-e="${esc(r.id)}">거절</button></td></tr>`).join('') + '</table>'
        : '대기 중인 요청이 없습니다.';
      $('admAllowed').classList.remove('hint');
      $('admAllowed').innerHTML = allowed.length ? `<table class="tbl compact"><tr><th class="l">이메일</th><th>이름 (사이트 표시)</th><th>담당</th><th>승인자</th><th>승인 시각</th><th></th></tr>` +
        allowed.map(a => `<tr><td class="l">${esc(a.id)}</td>
          <td><input class="adm-name" data-e="${esc(a.id)}" value="${esc(a.name || '')}" style="width:110px"><button class="btn small" data-a="rename" data-e="${esc(a.id)}">저장</button></td>
          <td>${esc(a.role || '')}</td>
          <td>${esc(a.addedBy || '')}</td><td class="num">${fmtTime(a.addedAt)}</td>
          <td><button class="btn small danger" data-a="revoke" data-e="${esc(a.id)}">승인 해제</button></td></tr>`).join('') + '</table>'
        : '아직 허용된 사용자가 없습니다. (관리자는 별도로 항상 허용)';
    } catch (e) { el.insertAdjacentHTML('afterbegin', `<div class="notice">불러오기 실패: ${esc(e.message)}</div>`); }

    el.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const email = (b.dataset.e || '').toLowerCase();
      try {
        if (b.dataset.a === 'approve') {
          await F.setDoc(D('allowed', email), { email, name: b.dataset.n || '', role: b.dataset.r || '', addedBy: myEmail(), addedAt: F.serverTimestamp() });
          await F.deleteDoc(D('requests', email));
        } else if (b.dataset.a === 'reject') {
          if (!confirm(`${email} 의 요청을 거절(삭제)할까요?`)) return;
          await F.deleteDoc(D('requests', email));
        } else if (b.dataset.a === 'revoke') {
          if (!confirm(`${email} 의 사용 승인을 해제합니다. 이 사람은 더 이상 클라우드 문서를 열 수 없습니다. 계속할까요?`)) return;
          await F.deleteDoc(D('allowed', email));
        } else if (b.dataset.a === 'myname') {
          if (!(await saveMyName($('admMyName').value))) return;
        } else if (b.dataset.a === 'rename') {
          const v = el.querySelector(`.adm-name[data-e="${CSS.escape(email)}"]`).value.trim();
          await F.setDoc(D('allowed', email), { name: v }, { merge: true });
          if (email === myEmail()) { profileName = v; refreshUi(); }
        } else if (b.dataset.a === 'add') {
          const v = $('admEmail').value.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { alert('이메일 형식을 확인하세요.'); return; }
          await F.setDoc(D('allowed', v), { email: v, name: $('admMemo').value.trim(), addedBy: myEmail(), addedAt: F.serverTimestamp() });
          await F.deleteDoc(D('requests', v)).catch(() => {});
        }
        renderAdmin();
      } catch (err) { alert('실패: ' + err.message); }
    };
  }

  window.addEventListener('beforeunload', e => { if (pushTimer) { push(); e.preventDefault(); e.returnValue = ''; } });
  init();
})();
