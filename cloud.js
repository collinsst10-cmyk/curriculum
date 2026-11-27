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
  let position = {};       // 직위 { posType:'homeroom'|'subject'|'', posCls:'1-2', posSubj:'영어', head:'교무부장'|'연구부장'|'' } (allowed 문서)
  let developer = false;   // 개발자(관리자 중 config/roles.developers 에 든 계정)
  let schoolEditUntil = 0;
  let schoolEditTimer;
  let cur = null;           // { id, meta, unsub }
  let pushTimer = null, lastPushed = null;

  const dlg = $('cloudDlg');
  $('cloudClose').addEventListener('click', () => dlg.close());
  $('btnCloud').addEventListener('click', () => { dlg.showModal(); renderPanel($('cloudBody')); });

  /* ---------- 관리자: '선생님 화면으로 보기' (이 탭에서만, 새로고침해도 유지) ---------- */
  let preview = sessionStorage.getItem('viewAsTeacher') === '1';
  /* 개발자: 어떤 권한으로 볼지 고름 (개발자·운영자 = 관리자 권한, 나머지 = 선생님 화면 + 그 직위) */
  const VIEW_ROLES = [['dev', '개발자 (모든 권한)'], ['operator', '운영자'], ['applicant', '가입 신청자 (등록 화면)'], ['교무부장', '교무부장'], ['연구부장', '연구부장'], ['homeroom', '담임교사'], ['subject', '전담교사'], ['teacher', '일반 선생님']];
  let viewRole = sessionStorage.getItem('viewRole') || 'dev';
  const effAdmin = () => admin && !preview;   // 화면에서 쓰는 관리자 여부
  /** 화면에서 쓰는 직위: 개발자가 다른 권한으로 볼 때는 그 직위로 흉내 냄 */
  function effPosition() {
    if (!(developer && preview)) return position;
    if (viewRole === '교무부장' || viewRole === '연구부장') return { ...position, head: viewRole };
    if (viewRole === 'homeroom') return { posType: 'homeroom', posCls: position.posCls || '1-1', posSubj: '', head: '' };
    if (viewRole === 'subject') return { posType: 'subject', posCls: '', posSubj: position.posSubj || '영어', head: '' };
    return { posType: '', posCls: '', posSubj: '', head: '' };
  }
  function setViewRole(r) {
    viewRole = r; sessionStorage.setItem('viewRole', r);
    if (r === 'applicant') { previewStep = 'form'; myReq = null; }   // 가입 화면 미리보기는 처음 화면부터
    setPreview(!(r === 'dev' || r === 'operator'));
  }
  function setPreview(on) {
    lockSchool();
    preview = !!on;
    sessionStorage.setItem('viewAsTeacher', preview ? '1' : '0');
    refreshUi();
    if (curTab !== 'home') showTab(curTab);   // 선생님에게 없는 메뉴면 HOME 으로
    window.scrollTo(0, 0);
  }
  $('btnPreview').addEventListener('click', () => setPreview(!preview));
  $('previewBack').addEventListener('click', () => { if (developer) { viewRole = 'dev'; sessionStorage.setItem('viewRole', 'dev'); } setPreview(false); });
  $('roleView').addEventListener('change', e => setViewRole(e.target.value));

  /** 오른쪽 위 표시: "1-2 담임 김준호", "영어전담 이소은" + 부장·운영자·개발자 배지 */
  function posLabel(p) {
    if (p.posType === 'homeroom' && p.posCls) return `${p.posCls} 담임`;
    if (p.posType === 'subject' && p.posSubj) return `${p.posSubj}전담`;
    return '';
  }
  function renderWho() {
    const btn = $('btnCloud'), badge = $('whoBadge');
    if (!user) { btn.innerHTML = '👤 로그인'; badge.hidden = true; return; }
    const name = (profileName || user.displayName || myEmail()).split(' ')[0];
    const p = position, pl = posLabel(p);
    btn.innerHTML = `${pl ? `<span class="who-pos">${esc(pl)}</span>` : ''}<span class="who-name">${esc(name)}</span>`;
    const tags = [];
    if (admin) tags.push(developer ? ['dev', '개발자'] : ['op', '운영자']);
    if (p.head) tags.push(['head', p.head]);
    badge.innerHTML = tags.map(([c, t]) => `<span class="who-tag ${c}">${esc(t)}</span>`).join('');
    badge.hidden = !tags.length;
  }

  /* ---------- app.js 와의 연결 ---------- */
  Object.assign(window.App, {
    /** 로그인·승인 전이면 메뉴 잠금 (연결 실패 시에는 이 PC 모드로 허용) */
    locked: () => REQUIRE && !fbFailed && (access !== 'approved' || isApplicantPreview()),
    isAdmin: effAdmin,
    canEditSchool: () => !window.FIREBASE_CONFIG || (effAdmin() && ((developer && viewRole !== 'operator') || Date.now() < schoolEditUntil)),
    unlockSchool,
    /** 'admin' 편성·편집 / 'teacher' 조회 전용 / 'none' 로그인·승인 전. 클라우드를 안 쓰면 이 PC 도구로 'admin' */
    role: () => (!window.FIREBASE_CONFIG || fbFailed) ? 'admin' : (user && access === 'approved') ? (effAdmin() ? 'admin' : 'teacher') : 'none',
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
    isAdmin: effAdmin,
    realAdmin: () => admin,            // 미리보기 중에도 실제 관리자인지
    listPlans: () => listPlans(),       // 작년 자료 불러오기 등에서 씀
    /** '저장' 단추: 기다리는 클라우드 저장을 바로 하고, 다른 화면의 직접 쓰기도 끝날 때까지 기다림. 결과: { cloud, error } */
    flush: async () => {
      let cloud = false, error = '';
      try {
        if (pushTimer) { clearTimeout(pushTimer); await push(); }
        cloud = !!cur;
        if (fb) await fb.F.waitForPendingWrites(fb.db);
      } catch (e) { error = e.message; }
      return { cloud, error };
    },
    get position() { return effPosition(); },          // 직위(개발자가 다른 권한으로 보면 그 직위)
    get developer() { return developer; },
    get viewRole() { return developer && preview ? viewRole : ''; },
    get previewing() { return admin && preview; },
  };

  function setStatus(msg) { $('cloudState').textContent = msg; $('btnCloud').title = msg + ' · ' + $('saveState').textContent; }
  function hhmm() { return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
  function fmtTime(ts) { try { return ts ? ts.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } }
  const myEmail = () => (user && user.email ? user.email.toLowerCase() : '');
  const D = (...p) => fb.F.doc(fb.db, ...p);

  function refreshUi() {
    renderWho();
    $('navAdmin').hidden = !effAdmin();
    $('homeAdmin').hidden = !effAdmin();
    // 운영자: '선생님 화면 보기' 단추 / 개발자: 권한 고르기
    $('btnPreview').hidden = !(admin && !developer && access === 'approved');
    $('btnPreview').textContent = preview ? '🛠 관리자 화면' : '👀 선생님 화면 보기';
    $('roleViewWrap').hidden = !(admin && developer && access === 'approved');
    $('roleView').innerHTML = VIEW_ROLES.map(([v, l]) => `<option value="${v}" ${v === (preview ? viewRole : (viewRole === 'operator' ? 'operator' : 'dev')) ? 'selected' : ''}>${l}</option>`).join('');
    const roleName = developer && preview ? (VIEW_ROLES.find(r => r[0] === viewRole) || [, '선생님'])[1] : '선생님';
    $('previewRole').textContent = roleName;
    $('previewBar').hidden = !(admin && preview);
    document.body.classList.toggle('previewing', !!(admin && preview));
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

  // 운영자: 대기 중인 등록 신청 수를 관리자 메뉴에 표시
  let unsubReq = null;
  function watchRequests() {
    if (unsubReq) { unsubReq(); unsubReq = null; }
    const set = n => { $('navAdmin').innerHTML = `관리자${n ? ` <span class="nav-count" title="승인 대기 ${n}명">${n}</span>` : ''}`; };
    set(0);
    if (!admin || access !== 'approved') return;
    unsubReq = fb.F.onSnapshot(fb.F.collection(fb.db, 'requests'), s => { set(s.size); if (curTab === 'admin' && s.docChanges().some(c => c.type === 'added') && !document.querySelector('#adminBody :focus')) renderAdmin(); }, () => set(0));
  }

  async function onAuth(u) {
    lockSchool();
    user = u; admin = false;
    if (!u && unsubReq) { unsubReq(); unsubReq = null; }
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
    watchRequests();
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
    myReq = isReq ? rq.data() : null;
    const ad = isAllowed ? al.data() : {};
    position = { posType: ad.posType || '', posCls: ad.posCls || '', posSubj: ad.posSubj || '', head: ad.head || '' };
    developer = false;
    if (isAdm) { const r = await safe(F.getDoc(D('config', 'roles'))); developer = !!(r && r.exists() && (r.data().developers || []).includes(e)); }
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
  function lockSchool() {
    clearTimeout(schoolEditTimer);
    schoolEditUntil = 0;
  }

  async function unlockSchool() {
    if (!fb || !effAdmin() || !user) throw new Error('운영자 계정으로 로그인해 주세요.');
    const currentUser = user;
    const provider = new fb.A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'login', max_age: '0', login_hint: currentUser.email });
    await fb.A.reauthenticateWithPopup(currentUser, provider);
    const token = await currentUser.getIdTokenResult(true);
    if (user?.uid !== currentUser.uid || !effAdmin()) throw new Error('로그인 상태가 바뀌었습니다.');
    schoolEditUntil = Date.parse(token.authTime) + 10 * 60 * 1000;
    if (!(schoolEditUntil > Date.now())) { lockSchool(); throw new Error('최근 계정 확인을 완료하지 못했습니다.'); }
    clearTimeout(schoolEditTimer);
    schoolEditTimer = setTimeout(() => { lockSchool(); if (curTab === 'school') renderInfo(); }, schoolEditUntil - Date.now());
  }
  async function logout() {
    closePlan(); localStorage.removeItem(LAST_PLAN_KEY);
    await fb.A.signOut(fb.auth);
  }

  /* =========================================================
   * 가입(등록 신청): 구글 로그인 → 기본 정보 입력 → 운영자 승인(학급·직위는 운영자가 정함)
   *  requests/{email} { email, name, kind, grade, subj, memo, role(요약), requestedAt }
   * ========================================================= */
  const KINDS = [['homeroom', '담임교사'], ['subject', '교과전담교사'], ['special', '비교과 교사 (보건·영양·상담·사서 등)'], ['staff', '행정·교육공무직'], ['other', '강사·기타']];
  const kindName = k => (KINDS.find(x => x[0] === k) || [, ''])[1];
  let myReq = null;               // 내 신청 내용 (승인 대기 화면에 보여 줌)
  let gateEdit = false;           // 승인 대기 중 '신청 내용 고치기'
  let previewStep = 'form';       // 개발자 미리보기: 'form' | 'pending'
  const isApplicantPreview = () => developer && preview && viewRole === 'applicant';

  function readSignup(el) {
    const v = n => (el.querySelector(`[name="${n}"]`) || {}).value || '';
    const kind = v('suKind'), grade = v('suGrade'), subj = v('suSubj').trim().slice(0, 20);
    const name = v('suName').trim().slice(0, 30), memo = v('suMemo').trim().slice(0, 100);
    const role = [kindName(kind).split(' (')[0], kind === 'homeroom' && grade ? `${grade}학년 희망` : '', kind === 'subject' && subj ? subj : ''].filter(Boolean).join(' · ');
    return { name, kind, grade: kind === 'homeroom' ? grade : '', subj: kind === 'subject' ? subj : '', memo, role: role.slice(0, 40) };
  }
  async function requestAccess(el) {
    const d = readSignup(el);
    if (!d.name) { alert('이름(실명)을 입력하세요. 이 사이트에서 계속 쓰이는 이름입니다.'); el.querySelector('[name="suName"]').focus(); return; }
    if (!d.kind) { alert('구분을 고르세요.'); return; }
    if (isApplicantPreview()) { myReq = { email: myEmail(), ...d }; previewStep = 'pending'; refreshUi(); return; }   // 미리보기: 보내지 않음
    const data = { email: myEmail(), ...d, requestedAt: fb.F.serverTimestamp() };
    if (access === 'pending') await fb.F.deleteDoc(D('requests', myEmail())).catch(() => {});   // 고쳐서 다시 신청
    await fb.F.setDoc(D('requests', myEmail()), data);
    profileName = d.name; myReq = { ...data, requestedAt: null }; gateEdit = false;
    access = 'pending'; setStatus('☁ 승인 대기 중'); refreshUi();
  }
  async function cancelRequest() {
    if (!confirm('등록 신청을 취소할까요?')) return;
    await fb.F.deleteDoc(D('requests', myEmail()));
    myReq = null; profileName = ''; access = 'none'; setStatus('☁ 승인 필요'); refreshUi();
  }

  /** 가입 양식 (신청 / 고쳐서 다시 신청 / 개발자 미리보기) */
  function signupForm(prev, demo) {
    const p = prev || {};
    const kindOpts = KINDS.map(([k, n]) => `<label class="su-kind"><input type="radio" name="suKind" value="${k}" ${p.kind === k ? 'checked' : ''}><span>${n}</span></label>`).join('');
    const nCls = g => Number(state.school.classes[g]) || 0;
    return `<div class="signup-card${demo ? ' demo' : ''}">
      ${demo ? '<div class="su-demo">개발자 미리보기 · 새로 가입하는 선생님에게 보이는 화면입니다. 신청은 실제로 보내지지 않습니다.</div>' : ''}
      <ol class="su-steps"><li class="done">구글 로그인</li><li class="on">기본 정보 입력</li><li>운영자 승인</li></ol>
      <h2>선생님 등록</h2>
      <p class="su-lead"><b>${esc(myEmail())}</b> 계정으로 처음 오셨습니다. 아래 기본 정보를 보내 주시면 운영자가 확인하고 담당 학급·직위를 정해 승인합니다.</p>
      <div class="su-form">
        <label class="su-f"><span>이름(실명) <em>*</em></span><input name="suName" type="text" maxlength="30" placeholder="예: 홍길동" value="${esc(p.name || '')}" autocomplete="name"></label>
        <div class="su-f"><span>구분 <em>*</em></span><div class="su-kinds">${kindOpts}</div></div>
        <label class="su-f su-grade" ${p.kind === 'homeroom' ? '' : 'hidden'}><span>담임 학년 <small>(알고 있으면)</small></span>
          <select name="suGrade"><option value="">아직 모름</option>${GRADES.filter(g => nCls(g)).map(g => `<option value="${g}" ${String(p.grade) === String(g) ? 'selected' : ''}>${g}학년</option>`).join('')}</select>
          <small class="hint">반은 운영자가 정합니다.</small></label>
        <label class="su-f su-subj" ${p.kind === 'subject' ? '' : 'hidden'}><span>전담 과목 <small>(알고 있으면)</small></span><input name="suSubj" type="text" maxlength="20" placeholder="예: 영어" value="${esc(p.subj || '')}"></label>
        <label class="su-f"><span>운영자에게 남길 말 <small>(선택)</small></span><input name="suMemo" type="text" maxlength="100" placeholder="예: 3월 전입, 한국어학급 강사" value="${esc(p.memo || '')}"></label>
      </div>
      <p class="hint">이름은 이 사이트에서 일정 기록자 등으로 계속 쓰입니다. 승인 후 바꿔야 하면 운영자에게 요청하세요.</p>
      <div class="row su-actions"><button class="btn primary" data-act="request">${gateEdit ? '고친 내용으로 다시 신청' : '등록 신청'}</button>
        ${gateEdit ? '<button class="btn" data-act="editCancel">취소</button>' : ''}
        ${demo ? '' : '<button class="btn small" data-act="logout">다른 계정으로 로그인</button>'}</div></div>`;
  }
  function pendingCard(r, demo) {
    r = r || {};
    return `<div class="signup-card pending${demo ? ' demo' : ''}">
      ${demo ? '<div class="su-demo">개발자 미리보기 · 신청을 보낸 뒤 선생님에게 보이는 화면입니다.</div>' : ''}
      <ol class="su-steps"><li class="done">구글 로그인</li><li class="done">기본 정보 입력</li><li class="on">운영자 승인</li></ol>
      <h2>승인을 기다리고 있습니다</h2>
      <p class="su-lead">운영자가 담당 학급·직위를 정해 승인하면 바로 사용할 수 있습니다. 승인 후에는 이 페이지를 새로고침하거나 '승인 여부 다시 확인'을 누르세요.</p>
      <dl class="su-sum"><div><dt>계정</dt><dd>${esc(myEmail())}</dd></div><div><dt>이름</dt><dd>${esc(r.name || profileName || '')}</dd></div>
        <div><dt>구분</dt><dd>${esc(r.kind ? kindName(r.kind) : (r.role || '-'))}${r.grade ? ` · ${esc(r.grade)}학년 희망` : ''}${r.subj ? ` · ${esc(r.subj)}` : ''}</dd></div>
        ${r.memo ? `<div><dt>남긴 말</dt><dd>${esc(r.memo)}</dd></div>` : ''}</dl>
      <div class="row su-actions">${demo ? '<button class="btn" data-act="demoBack">입력 화면 다시 보기</button>'
        : `<button class="btn primary" data-act="recheck">승인 여부 다시 확인</button><button class="btn" data-act="edit">신청 내용 고치기</button>
           <button class="btn small" data-act="cancelReq">신청 취소</button><button class="btn small" data-act="logout">로그아웃</button>`}</div></div>`;
  }

  /* =========================================================
   * HOME 의 로그인·가입 안내
   * ========================================================= */
  function renderGate(el) {
    if (!window.FIREBASE_CONFIG) { el.innerHTML = ''; return; }
    if (fbFailed) { el.innerHTML = `<div class="gate warn">클라우드에 연결하지 못해 <b>이 PC 저장 모드</b>로 동작합니다.</div>`; return; }
    if (!fb || access === 'unknown') { el.innerHTML = `<div class="gate">연결 중…</div>`; return; }
    if (isApplicantPreview()) {
      el.innerHTML = previewStep === 'pending' ? pendingCard(myReq || { name: profileName, kind: 'homeroom', grade: '3' }, true) : signupForm(myReq, true);
    } else if (access === 'signedout') {
      el.innerHTML = `<div class="signup-card"><ol class="su-steps"><li class="on">구글 로그인</li><li>기본 정보 입력</li><li>운영자 승인</li></ol>
        <h2>로그인이 필요합니다</h2><p class="su-lead">학교 구글 계정으로 로그인하세요. 처음이면 로그인 뒤 간단한 등록 신청을 하고, 운영자가 승인하면 사용할 수 있습니다.</p>
        <button class="btn primary" data-act="login">Google 계정으로 로그인</button></div>`;
    } else if (access === 'none' || (access === 'pending' && gateEdit)) {
      el.innerHTML = signupForm(gateEdit ? myReq : null, false);
    } else if (access === 'pending') {
      el.innerHTML = pendingCard(myReq, false);
    } else {
      el.innerHTML = `<div class="gate ok">✅ <b>${esc(profileName || myEmail())}</b> 선생님 ${admin ? '(관리자)' : ''}
        ${!profileName ? `<p class="neg">등록된 이름이 없습니다. ${admin ? '관리자 메뉴에서 내 이름을 등록하세요.' : '관리자에게 이름 등록을 요청하세요.'}</p>` : ''}
        <p>${cur ? `열린 문서: <b>${esc(cur.meta.title)}</b>` : '열린 클라우드 문서가 없습니다. <a href="#data">자료 관리</a>에서 문서를 만들거나 여세요.'}</p></div>`;
    }
    el.onclick = gateAction;
    // 구분에 따라 학년·과목 칸 보이기
    el.onchange = e => {
      if (e.target.name !== 'suKind') return;
      const card = e.target.closest('.signup-card');
      card.querySelector('.su-grade').hidden = e.target.value !== 'homeroom';
      card.querySelector('.su-subj').hidden = e.target.value !== 'subject';
    };
  }

  async function gateAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('.signup-card') || b.closest('.gate');
    try {
      switch (b.dataset.act) {
        case 'login': await login(); break;
        case 'logout': await logout(); break;
        case 'request': await requestAccess(card); break;
        case 'edit': gateEdit = true; refreshUi(); break;
        case 'editCancel': gateEdit = false; refreshUi(); break;
        case 'cancelReq': await cancelRequest(); break;
        case 'demoBack': previewStep = 'form'; refreshUi(); break;
        case 'recheck': await checkAccess(); if (access === 'approved') await onAuth(user); else { alert('아직 승인되지 않았습니다.'); refreshUi(); } break;
      }
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
        <p class="hint">학사일정은 관리자가 정한 학교 공용 학사일정을 조회하고, 학사일정 › 신규 학사일정 등록에서 일정을 직접 신청할 수 있습니다.</p>
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
        <span class="hint">관리자 계정의 사이트 표시 이름(일정 기록자 등)입니다.</span></div>
        <div class="row adm-dev"><span>이 계정의 구분: <b class="who-tag ${developer ? 'dev' : 'op'}">${developer ? '개발자' : '운영자'}</b></span>
          ${developer ? '<button class="btn small" data-a="dev">운영자로 바꾸기</button>' : ''}
          <span class="hint">운영자는 사이트 전체를 관리하고 등록 신청을 승인합니다. 개발자는 언제나 운영자 권한을 함께 가지며, 오른쪽 위 '권한 보기'로 모든 직위의 화면과 '가입 신청자(등록 화면)'을 골라 볼 수 있습니다.</span></div></div>
      <div class="card adm-req-card"><h2>등록 신청 (승인 대기)</h2><div id="admReq" class="hint">불러오는 중…</div></div>
      <div class="card"><div class="card-head"><h2>허용된 사용자</h2></div>
        <div class="row" style="margin-bottom:10px">
          <input id="admEmail" type="email" placeholder="추가할 구글 이메일" style="width:260px">
          <input id="admMemo" type="text" placeholder="이름(실명)" style="width:160px">
          <button class="btn primary small" data-a="add">직접 추가</button>
        </div>
        <div id="admAllowed" class="hint">불러오는 중…</div>
        <p class="hint">관리자 계정 추가·변경은 Firebase 콘솔의 <code>admins</code> 컬렉션에서 합니다.</p></div>`;
    const F = fb.F;
    const taken = {};   // 학급 → 지금 담임 { name, email }
    try {
      const [rq, al] = await Promise.all([F.getDocs(F.collection(fb.db, 'requests')), F.getDocs(F.collection(fb.db, 'allowed'))]);
      const reqs = rq.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.requestedAt?.seconds || 0) - (b.requestedAt?.seconds || 0));
      const allowed = al.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
      // 직위: 담임교사(학급) · 전담교사(과목) / 부장: 교무부장 · 연구부장
      allowed.forEach(a => { if (a.posType === 'homeroom' && a.posCls) taken[a.posCls] = { name: a.name || a.id, email: a.id }; });
      const clsOpts = (cur, grade) => '<option value="">학급 선택</option>' + GRADES.slice().sort((x, y) => (String(y) === String(grade)) - (String(x) === String(grade)))
        .map(g => Array.from({ length: Number(state.school.classes[g]) || 0 }, (_, i) => `${g}-${i + 1}`)
        .map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${k}반${taken[k] && k !== cur ? ` (담임: ${esc(taken[k].name)})` : ''}</option>`).join('')).join('');
      const SUBJ = ['영어', '과학', '체육', '음악', '미술', '실과', '도덕', '사회', '수학', '국어', '정보'];
      const subjOpts = cur => '<option value="">과목</option>' + SUBJ.map(s => `<option ${s === cur ? 'selected' : ''}>${s}</option>`).join('');
      const posCell = (a, grade) => `<div class="adm-pos" data-e="${esc(a.id)}">
          <select class="adm-pt"><option value="">직위 없음</option><option value="homeroom" ${a.posType === 'homeroom' ? 'selected' : ''}>담임교사</option><option value="subject" ${a.posType === 'subject' ? 'selected' : ''}>전담교사</option></select>
          <select class="adm-pc" ${a.posType === 'homeroom' ? '' : 'hidden'}>${clsOpts(a.posCls, grade)}</select>
          <select class="adm-ps" ${a.posType === 'subject' ? '' : 'hidden'}>${subjOpts(a.posSubj)}</select>
          <select class="adm-hd"><option value="">부장 아님</option><option ${a.head === '교무부장' ? 'selected' : ''}>교무부장</option><option ${a.head === '연구부장' ? 'selected' : ''}>연구부장</option></select></div>`;
      // 등록 신청: 신청 내용을 보고 운영자가 이름·학급·직위를 정해 승인
      $('admReq').classList.remove('hint');
      $('admReq').innerHTML = reqs.length ? `<div class="adm-reqs">${reqs.map(r => {
        const pre = { id: r.id, posType: r.kind === 'homeroom' || r.kind === 'subject' ? r.kind : '', posCls: '', posSubj: SUBJ.includes(r.subj) ? r.subj : '', head: '' };
        return `<div class="adm-req">
          <div class="adm-req-info"><b>${esc(r.name)}</b> <span class="hint">${esc(r.id)}</span>
            <div class="adm-req-meta"><span class="pill">${esc(r.kind ? kindName(r.kind).split(' (')[0] : (r.role || '구분 없음'))}</span>
              ${r.grade ? `<span>${esc(r.grade)}학년 희망</span>` : ''}${r.subj ? `<span>${esc(r.subj)}</span>` : ''}<span class="hint">${fmtTime(r.requestedAt)} 신청</span></div>
            ${r.memo ? `<p class="adm-req-memo">“${esc(r.memo)}”</p>` : ''}</div>
          <div class="adm-req-set"><label>이름 <input class="adm-rname" data-e="${esc(r.id)}" value="${esc(r.name || '')}" maxlength="30"></label>${posCell(pre, r.grade)}</div>
          <div class="adm-req-btns"><button class="btn small primary" data-a="approve" data-e="${esc(r.id)}" data-r="${esc(r.role || '')}">승인</button>
            <button class="btn small danger" data-a="reject" data-e="${esc(r.id)}">거절</button></div></div>`; }).join('')}</div>
          <p class="hint">담임교사는 학급을, 전담교사는 과목을 골라야 승인됩니다. 승인하면 그 선생님 화면에 직위(예: '3-1 담임')가 바로 적용됩니다.</p>`
        : '대기 중인 신청이 없습니다.';
      $('admAllowed').classList.remove('hint');
      $('admAllowed').innerHTML = allowed.length ? `<table class="tbl compact adm-users"><tr><th class="l">이메일</th><th>이름 (사이트 표시)</th><th>직위 · 부장</th><th>담당(신청 때)</th><th>승인자</th><th>승인 시각</th><th></th></tr>` +
        allowed.map(a => `<tr><td class="l">${esc(a.id)}</td>
          <td><input class="adm-name" data-e="${esc(a.id)}" value="${esc(a.name || '')}" style="width:110px"></td>
          <td>${posCell(a)}<button class="btn small primary" data-a="rename" data-e="${esc(a.id)}">저장</button></td>
          <td>${esc(a.role || '')}</td>
          <td>${esc(a.addedBy || '')}</td><td class="num">${fmtTime(a.addedAt)}</td>
          <td><button class="btn small danger" data-a="revoke" data-e="${esc(a.id)}">승인 해제</button></td></tr>`).join('') + '</table>'
        : '아직 허용된 사용자가 없습니다. (관리자는 별도로 항상 허용)';
    } catch (e) { el.insertAdjacentHTML('afterbegin', `<div class="notice">불러오기 실패: ${esc(e.message)}</div>`); }

    // 직위를 바꾸면 학급·과목 칸 보이기
    el.onchange = e => { if (!e.target.classList.contains('adm-pt')) return; const box = e.target.closest('.adm-pos'); box.querySelector('.adm-pc').hidden = e.target.value !== 'homeroom'; box.querySelector('.adm-ps').hidden = e.target.value !== 'subject'; };
    /** 직위 칸 읽기 + 확인(학급·과목 빠짐, 같은 반 담임 겹침) → 직위 또는 null */
    const readPos = email => {
      const box = el.querySelector(`.adm-pos[data-e="${CSS.escape(email)}"]`);
      const posType = box.querySelector('.adm-pt').value;
      const pos = { posType, posCls: posType === 'homeroom' ? box.querySelector('.adm-pc').value : '', posSubj: posType === 'subject' ? box.querySelector('.adm-ps').value : '', head: box.querySelector('.adm-hd').value };
      if (posType === 'homeroom' && !pos.posCls) { alert('담임 학급을 고르세요.'); return null; }
      if (posType === 'subject' && !pos.posSubj) { alert('전담 과목을 고르세요.'); return null; }
      const t = pos.posCls && taken[pos.posCls];
      if (t && t.email !== email && !confirm(`${pos.posCls}반 담임은 지금 ${t.name} 선생님입니다. 이 선생님으로 바꿀까요?\n(${t.name} 선생님의 직위는 '직위 없음'이 됩니다)`)) return null;
      return pos;
    };
    const freeClass = async (pos, email) => {   // 같은 반을 맡던 선생님의 담임 직위를 풂
      const t = pos.posCls && taken[pos.posCls];
      if (t && t.email !== email) await F.setDoc(D('allowed', t.email), { posType: '', posCls: '' }, { merge: true });
    };
    el.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const email = (b.dataset.e || '').toLowerCase();
      try {
        if (b.dataset.a === 'approve') {
          const name = el.querySelector(`.adm-rname[data-e="${CSS.escape(email)}"]`).value.trim();
          if (!name) { alert('이름을 입력하세요.'); return; }
          const pos = readPos(email); if (!pos) return;
          await freeClass(pos, email);
          await F.setDoc(D('allowed', email), { email, name, role: b.dataset.r || '', ...pos, addedBy: myEmail(), addedAt: F.serverTimestamp() });
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
          const pos = readPos(email); if (!pos) return;
          await freeClass(pos, email);
          await F.setDoc(D('allowed', email), { name: v, ...pos }, { merge: true });
          if (email === myEmail()) { profileName = v; position = pos; refreshUi(); }
        } else if (b.dataset.a === 'dev') {
          if (!developer) return;
          lockSchool();
          const on = !developer;
          await F.setDoc(D('config', 'roles'), { developers: on ? F.arrayUnion(myEmail()) : F.arrayRemove(myEmail()) }, { merge: true });
          developer = on;
          if (!on) { viewRole = 'dev'; sessionStorage.setItem('viewRole', 'dev'); preview = false; sessionStorage.setItem('viewAsTeacher', '0'); }
          refreshUi();
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
