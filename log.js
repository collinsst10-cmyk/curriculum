/* =========================================================
 * 학교 일지 작성 (관리자 · 교무부장)
 *  - dailyLogs/{YYYY-MM-DD} { text, by, byName, updatedAt }  → HOME에서 선생님들이 조회
 *  - config/roles { logWriters: [email] }  교무부장(일지 작성자) 지정은 관리자만
 * ========================================================= */
(function () {
  'use strict';
  let day = fmt(new Date());
  let writers = [], unsubRoles = null, unsubDay = null, subDay = null, current;
  let dirty = false;

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  // 일지 작성: 관리자 · 지정된 작성자 · 직위가 교무부장인 선생님
  const isWriter = () => !!(window.Cloud && Cloud.ready && (isAdm() || writers.includes(String(Cloud.email || '').toLowerCase()) || (Cloud.position && Cloud.position.head === '교무부장')));
  TAB_GUARDS.log = () => isWriter();
  window.LogRoles = { isWriter };
  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);

  function refreshNav() {
    $('navLog').hidden = !isWriter();
    if (curTab === 'log' && !isWriter()) showTab('home');
  }

  function subscribe() {
    if (unsubRoles) unsubRoles(); unsubRoles = null; writers = [];
    stopDay();
    refreshNav();
    if (!window.Cloud || !Cloud.ready) return;
    const { F, db } = Cloud.fb;
    unsubRoles = F.onSnapshot(F.doc(db, 'config', 'roles'), d => {
      writers = ((d.exists() && d.data().logWriters) || []).map(e => String(e).toLowerCase());
      refreshNav();
      if (curTab === 'log') renderWriters();
      document.dispatchEvent(new Event('roles-change'));
    }, e => { console.warn('일지 작성자 목록 실패', e); });
  }

  function stopDay() { if (unsubDay) unsubDay(); unsubDay = null; subDay = null; current = undefined; }
  function watchDay() {
    if (unsubDay && subDay === day) return;
    stopDay(); subDay = day;
    unsubDay = Cloud.fb.F.onSnapshot(ref(day), d => { current = d.exists() ? d.data() : null; if (!dirty) renderEditor(); },
      e => { $('lgStatus').textContent = '불러오기 실패: ' + e.message; });
  }

  function renderEditor() {
    $('lgDate').value = day;
    $('lgTitle').innerHTML = HomeLog.longDate(day) + (day === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : '');
    if (current === undefined) { $('lgText').value = ''; $('lgText').placeholder = '불러오는 중…'; return; }
    $('lgText').placeholder = '이 날의 학교 일지(학교운영일지) 내용을 입력하거나 붙여 넣으세요.';
    if (!dirty) $('lgText').value = (current && current.text) || '';
    $('lgDelete').hidden = !(current && current.text);
    if (!dirty) $('lgStatus').textContent = current && current.text
      ? `마지막 저장: ${current.byName || ''}${current.updatedAt ? ' · ' + HomeLog.fmtTs(current.updatedAt) : ''}` : '아직 작성하지 않은 날입니다.';
  }

  async function renderRecent() {
    try {
      const days = await HomeLog.recentDays(14);
      $('lgRecent').innerHTML = days.length ? days.map(ds => { const d = parse(ds); return `<button class="chip-btn${ds === day ? ' on' : ''}" data-day="${ds}">${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})</button>`; }).join('')
        : '<span class="hint">최근 60일 동안 작성한 일지가 없습니다.</span>';
    } catch (e) { $('lgRecent').textContent = '목록을 불러오지 못했습니다.'; }
  }

  function renderWriters() {
    $('lgWritersCard').hidden = !isAdm();
    if (!isAdm()) return;
    $('lgWriters').innerHTML = writers.length
      ? writers.map(e => `<li><span>${esc(e)}</span> <button class="btn small" data-rm="${esc(e)}">해제</button></li>`).join('')
      : '<li class="empty">아직 지정된 교무부장이 없습니다.</li>';
  }

  function render() {
    if (!isWriter()) return;
    watchDay(); renderEditor(); renderRecent(); renderWriters();
  }

  function go(ds) {
    if (dirty && !confirm('저장하지 않은 일지 내용이 있습니다. 다른 날짜로 이동할까요?')) { $('lgDate').value = day; return; }
    day = ds; dirty = false; render();
  }

  async function save() {
    if (!isWriter()) return;
    const text = $('lgText').value.trim();
    if (!text) { $('lgStatus').textContent = '내용을 입력하세요.'; return; }
    const F = Cloud.fb.F;
    $('lgSave').disabled = true;
    try {
      await F.setDoc(ref(day), { text: text.slice(0, 20000), by: Cloud.email, byName: Cloud.profileName || '', updatedAt: F.serverTimestamp() });
      dirty = false; renderEditor(); $('lgStatus').textContent = '저장했습니다. 선생님들이 HOME에서 볼 수 있습니다.';
      renderRecent(); HomeLog.refreshRecent();
    } catch (e) { $('lgStatus').textContent = '저장 실패: ' + e.message; }
    finally { $('lgSave').disabled = false; }
  }
  async function remove() {
    if (!isWriter() || !confirm(`${HomeLog.longDate(day)} 일지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await Cloud.fb.F.deleteDoc(ref(day)); dirty = false; $('lgText').value = ''; $('lgStatus').textContent = '삭제했습니다.'; renderRecent(); HomeLog.refreshRecent(); }
    catch (e) { $('lgStatus').textContent = '삭제 실패: ' + e.message; }
  }

  async function setWriters(list, msg) {
    const { F, db } = Cloud.fb;
    try { await F.setDoc(F.doc(db, 'config', 'roles'), { logWriters: list }, { merge: true }); $('lgWriterStatus').textContent = msg; }
    catch (e) { $('lgWriterStatus').textContent = '실패: ' + e.message; }
  }

  $('lgPrev').addEventListener('click', () => go(HomeLog.stepDay(day, -1)));
  $('lgNext').addEventListener('click', () => go(HomeLog.stepDay(day, 1)));
  $('lgToday').addEventListener('click', () => go(fmt(new Date())));
  $('lgDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('lgRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });
  $('lgText').addEventListener('input', () => { dirty = true; $('lgStatus').textContent = '저장하지 않은 변경이 있습니다.'; });
  $('lgSave').addEventListener('click', save);
  $('lgDelete').addEventListener('click', remove);
  $('lgWriterForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!isAdm()) return;
    const input = e.currentTarget.querySelector('input');
    const email = input.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('lgWriterStatus').textContent = '이메일 형식을 확인하세요.'; return; }
    if (writers.includes(email)) { $('lgWriterStatus').textContent = '이미 지정된 계정입니다.'; return; }
    input.value = '';
    setWriters([...writers, email], '교무부장(일지 작성자)으로 지정했습니다.');
  });
  $('lgWriters').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (b && isAdm() && confirm(`${b.dataset.rm} 의 일지 작성 권한을 해제할까요?`)) setWriters(writers.filter(x => x !== b.dataset.rm), '해제했습니다.');
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  RENDER.log = render;
  document.addEventListener('cloud-change', subscribe);
  if (window.Cloud && Cloud.ready) subscribe();
})();
