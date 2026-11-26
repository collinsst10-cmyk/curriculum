/* =========================================================
 * HOME: 학교운영일지 + 이번 달 학사일정 넘기기
 *  - Firestore: dailyLogs/{YYYY-MM-DD} { text, by, byName, updatedAt }
 *  - 승인된 선생님은 읽기, 관리자만 작성·수정·삭제 (보안 규칙)
 * ========================================================= */
(function () {
  'use strict';
  let logDate = fmt(new Date());
  let unsub = null, subDate = null, current = null, recent = [];
  let dirty = false;

  const isAdminView = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);
  const fmtTs = ts => { try { return ts ? ts.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const longDate = ds => { const d = parse(ds); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };

  /** 주말을 건너뛰며 하루씩 이동 */
  function stepDay(ds, dir) {
    let d = addDays(parse(ds), dir);
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, dir);
    return fmt(d);
  }

  function watch() {
    if (!window.Cloud || !Cloud.ready) { stop(); return; }
    if (unsub && subDate === logDate) return;
    if (unsub) unsub();
    subDate = logDate; current = undefined; dirty = false;
    unsub = Cloud.fb.F.onSnapshot(ref(logDate), d => {
      current = d.exists() ? d.data() : null;
      if (!dirty) render();
    }, err => { console.warn('운영일지 불러오기 실패', err); current = null; render(); });
    loadRecent();
  }
  function stop() { if (unsub) unsub(); unsub = null; subDate = null; current = undefined; recent = []; }

  async function loadRecent() {
    try {
      const F = Cloud.fb.F;
      // 내림차순은 색인이 필요하므로 최근 60일을 오름차순으로 받아 뒤에서 7개
      const from = fmt(addDays(new Date(), -60));
      const q = F.query(F.collection(Cloud.fb.db, 'dailyLogs'), F.where(F.documentId(), '>=', from), F.orderBy(F.documentId()));
      recent = (await F.getDocs(q)).docs.map(d => d.id).slice(-7).reverse();
      renderRecent();
    } catch (e) { console.warn('최근 운영일지 목록 실패', e); }
  }

  function renderRecent() {
    $('logRecent').innerHTML = recent.length
      ? '<span class="hint">최근 일지</span>' + recent.map(ds => `<button class="chip-btn${ds === logDate ? ' on' : ''}" data-day="${ds}">${parse(ds).getMonth() + 1}.${parse(ds).getDate()}(${WD[parse(ds).getDay()]})</button>`).join('')
      : '';
  }

  function render() {
    if (!$('logView')) return;
    $('logDate').value = logDate;
    if (!window.Cloud || !Cloud.ready) {
      $('logView').innerHTML = '<p class="hint">로그인하면 학교운영일지를 볼 수 있습니다.</p>';
      $('logEditBox').hidden = true; return;
    }
    watch();
    const head = `<div class="log-date">${longDate(logDate)}${logDate === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : ''}</div>`;
    if (current === undefined) $('logView').innerHTML = head + '<p class="hint">불러오는 중…</p>';
    else if (!current || !current.text) $('logView').innerHTML = head + `<p class="log-empty">이 날 등록된 운영일지가 없습니다.</p>`;
    else $('logView').innerHTML = head + `<div class="log-text">${esc(current.text)}</div>
      <div class="hint">작성: ${esc(current.byName || current.by || '')}${current.updatedAt ? ' · ' + fmtTs(current.updatedAt) : ''}</div>`;
    // 관리자: 바로 아래에서 작성·수정
    const admin = isAdminView();
    $('logEditBox').hidden = !admin;
    if (admin && !dirty) $('logText').value = (current && current.text) || '';
    $('logDelete').hidden = !(current && current.text);
    renderRecent();
  }

  async function save() {
    if (!isAdminView()) return;
    const text = $('logText').value.trim();
    if (!text) { $('logStatus').textContent = '내용을 입력하세요.'; return; }
    const F = Cloud.fb.F;
    try {
      await F.setDoc(ref(logDate), { text: text.slice(0, 20000), by: Cloud.email, byName: Cloud.profileName || '', updatedAt: F.serverTimestamp() });
      dirty = false; $('logStatus').textContent = '저장했습니다.';
      loadRecent();
    } catch (e) { $('logStatus').textContent = '저장 실패: ' + e.message; }
  }
  async function remove() {
    if (!isAdminView() || !confirm(`${longDate(logDate)} 운영일지를 삭제할까요?`)) return;
    try { await Cloud.fb.F.deleteDoc(ref(logDate)); dirty = false; $('logStatus').textContent = '삭제했습니다.'; loadRecent(); }
    catch (e) { $('logStatus').textContent = '삭제 실패: ' + e.message; }
  }

  function go(ds) {
    if (dirty && !confirm('저장하지 않은 운영일지 내용이 있습니다. 다른 날짜로 이동할까요?')) { $('logDate').value = logDate; return; }
    logDate = ds; dirty = false; $('logStatus').textContent = ''; render();
  }

  $('logPrev').addEventListener('click', () => go(stepDay(logDate, -1)));
  $('logNext').addEventListener('click', () => go(stepDay(logDate, 1)));
  $('logDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('logRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });
  $('logText').addEventListener('input', () => { dirty = true; $('logStatus').textContent = '저장하지 않은 변경이 있습니다.'; });
  $('logSave').addEventListener('click', save);
  $('logDelete').addEventListener('click', remove);

  // 이번 달 학사일정 넘기기
  const moveMonth = n => { homeMonth = n === 0 ? null : new Date(homeMonth.getFullYear(), homeMonth.getMonth() + n, 1); renderHomeMonth(); };
  $('monthPrev').addEventListener('click', () => moveMonth(-1));
  $('monthNext').addEventListener('click', () => moveMonth(1));
  $('monthNow').addEventListener('click', () => moveMonth(0));

  document.addEventListener('cloud-change', () => { stop(); if (curTab === 'home') render(); });
  window.HomeLog = { render };
})();
