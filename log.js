/* =========================================================
 * 학교 일지 작성 (교무부장만)
 *  - dailyLogs/{YYYY-MM-DD} { notice, events, guidance, duty:{p,v,a:{today,plan}}, text, by, byName, updatedAt }
 *    text 는 항목을 이어 붙인 글(예전 화면·검색용)
 *  - 작성: 직위가 '교무부장'인 선생님 (개발자는 관리용으로 함께 허용) → HOME에서 선생님들이 조회
 *  - 한글 파일로 저장(.hwpx) · 한글 파일(.hwp/.hwpx) 불러와 항목별로 채우기 (hwpx.js)
 * ========================================================= */
(function () {
  'use strict';
  let day = fmt(new Date());
  let unsubDay = null, subDay = null, current;
  let dirty = false;

  const PEOPLE = [['p', '교장'], ['v', '교감'], ['a', '행정실장']];
  const SECS = [['notice', '전달사항'], ['events', '주요행사 및 교육활동'], ['guidance', '생활지도 및 안전지도']];
  // 일지 작성: 직위가 교무부장인 선생님 (개발자는 '개발자' 권한으로 볼 때만)
  const isWriter = () => !!(window.Cloud && Cloud.ready && (
    (Cloud.position && Cloud.position.head === '교무부장') || (Cloud.developer && !Cloud.viewRole)));
  TAB_GUARDS.log = () => isWriter();
  window.LogRoles = { isWriter };
  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);

  /** 저장된 문서 → 항목 (예전처럼 text 만 있으면 전달사항으로) */
  function fieldsOf(doc) {
    const d = doc || {}, duty = d.duty || {};
    const f = { notice: d.notice || '', events: d.events || '', guidance: d.guidance || '', duty: {} };
    PEOPLE.forEach(([k]) => { f.duty[k] = { today: (duty[k] && duty[k].today) || '', plan: (duty[k] && duty[k].plan) || '' }; });
    if (!d.notice && !d.events && !d.guidance && !d.duty && d.text) f.notice = d.text;
    return f;
  }
  /** 항목 → 이어 붙인 글 */
  function textOf(f) {
    const parts = SECS.filter(([k]) => f[k].trim()).map(([k, n]) => `[${n}]\n${f[k].trim()}`);
    const duty = PEOPLE.filter(([k]) => f.duty[k].today || f.duty[k].plan)
      .map(([k, n]) => `${n}: ${f.duty[k].today || '-'}${f.duty[k].plan ? ` (예정: ${f.duty[k].plan})` : ''}`);
    if (duty.length) parts.push('[근무상황]\n' + duty.join('\n'));
    return parts.join('\n\n');
  }
  const isEmpty = f => !textOf(f).trim();

  function readForm() {
    const f = { duty: {} };
    document.querySelectorAll('#lgForm [data-lg]').forEach(t => { f[t.dataset.lg] = t.value.replace(/\s+$/, ''); });
    PEOPLE.forEach(([k]) => { f.duty[k] = { today: '', plan: '' }; });
    document.querySelectorAll('#lgForm [data-duty]').forEach(t => { const [k, s] = t.dataset.duty.split('.'); f.duty[k][s] = t.value.trim(); });
    return f;
  }
  function fillForm(f) {
    document.querySelectorAll('#lgForm [data-lg]').forEach(t => { t.value = f[t.dataset.lg] || ''; });
    document.querySelectorAll('#lgForm [data-duty]').forEach(t => { const [k, s] = t.dataset.duty.split('.'); t.value = (f.duty[k] && f.duty[k][s]) || ''; });
  }

  function refreshNav() {
    $('navLog').hidden = !isWriter();
    if (curTab === 'log' && !isWriter()) showTab('home');
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
    if (current === undefined) { fillForm(fieldsOf(null)); $('lgStatus').textContent = '불러오는 중…'; return; }
    if (!dirty) fillForm(fieldsOf(current));
    $('lgDelete').hidden = !current;
    if (!dirty) $('lgStatus').textContent = current
      ? `마지막 저장: ${current.byName || ''}${current.updatedAt ? ' · ' + HomeLog.fmtTs(current.updatedAt) : ''}` : '아직 작성하지 않은 날입니다.';
  }

  async function renderRecent() {
    try {
      const days = await HomeLog.recentDays(14);
      $('lgRecent').innerHTML = days.length ? days.map(ds => { const d = parse(ds); return `<button class="chip-btn${ds === day ? ' on' : ''}" data-day="${ds}">${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})</button>`; }).join('')
        : '<span class="hint">최근 60일 동안 작성한 일지가 없습니다.</span>';
    } catch (e) { $('lgRecent').textContent = '목록을 불러오지 못했습니다.'; }
  }

  function render() {
    if (!isWriter()) return;
    watchDay(); renderEditor(); renderRecent();
  }

  function go(ds) {
    if (dirty && !confirm('저장하지 않은 일지 내용이 있습니다. 다른 날짜로 이동할까요?')) { $('lgDate').value = day; return; }
    day = ds; dirty = false; render();
  }

  async function save() {
    if (!isWriter()) return;
    const f = readForm();
    if (isEmpty(f)) { $('lgStatus').textContent = '내용을 입력하세요.'; return; }
    const F = Cloud.fb.F;
    $('lgSave').disabled = true;
    try {
      await F.setDoc(ref(day), { notice: f.notice, events: f.events, guidance: f.guidance, duty: f.duty, text: textOf(f).slice(0, 20000),
        by: Cloud.email, byName: Cloud.profileName || '', updatedAt: F.serverTimestamp() });
      dirty = false; renderEditor(); $('lgStatus').textContent = '저장했습니다. 선생님들이 HOME에서 볼 수 있습니다.';
      renderRecent(); HomeLog.refreshRecent();
    } catch (e) { $('lgStatus').textContent = '저장 실패: ' + e.message; }
    finally { $('lgSave').disabled = false; }
  }
  async function remove() {
    if (!isWriter() || !confirm(`${HomeLog.longDate(day)} 일지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await Cloud.fb.F.deleteDoc(ref(day)); dirty = false; fillForm(fieldsOf(null)); $('lgStatus').textContent = '삭제했습니다.'; renderRecent(); HomeLog.refreshRecent(); }
    catch (e) { $('lgStatus').textContent = '삭제 실패: ' + e.message; }
  }

  /** 한글 파일로 저장 — 화면에 적힌 내용(저장 전이어도) 그대로 */
  async function exportHwp(f, ds, writer) {
    const blob = await Hwp.logHwpx(f, HomeLog.longDate(ds), writer, (state.school && state.school.name) || '');
    Hwp.download(blob, `학교일지_${ds}.hwpx`);
  }
  window.LogExport = { fieldsOf, exportHwp };

  async function importHwp(file) {
    if (!file) return;
    $('lgStatus').textContent = '한글 파일을 읽는 중…';
    try {
      const f = Hwp.parseLog(await Hwp.readBlocks(file));
      if (isEmpty(f)) { $('lgStatus').textContent = '이 파일에서 일지 항목(전달사항·주요행사·생활지도·근무상황)을 찾지 못했습니다.'; return; }
      const cur = readForm();
      if (!isEmpty(cur) && !confirm('지금 적힌 내용을 불러온 한글 파일 내용으로 바꿀까요?')) { $('lgStatus').textContent = '불러오기를 취소했습니다.'; return; }
      fillForm(f); dirty = true;
      const got = [...SECS.filter(([k]) => f[k]).map(([, n]) => n), ...PEOPLE.filter(([k]) => f.duty[k].today || f.duty[k].plan).map(([, n]) => n)];
      $('lgStatus').textContent = `'${file.name}'에서 ${got.join(', ')}을(를) 채웠습니다. 확인한 뒤 저장하세요.`;
    } catch (e) { $('lgStatus').textContent = '읽기 실패: ' + e.message; }
  }

  $('lgPrev').addEventListener('click', () => go(HomeLog.stepDay(day, -1)));
  $('lgNext').addEventListener('click', () => go(HomeLog.stepDay(day, 1)));
  $('lgToday').addEventListener('click', () => go(fmt(new Date())));
  $('lgDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('lgRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });
  $('lgForm').addEventListener('input', () => { dirty = true; $('lgStatus').textContent = '저장하지 않은 변경이 있습니다.'; });
  $('lgSave').addEventListener('click', save);
  $('lgDelete').addEventListener('click', remove);
  $('lgHwp').addEventListener('click', async () => {
    const f = readForm();
    if (isEmpty(f)) { $('lgStatus').textContent = '내용이 없어 한글 파일을 만들 수 없습니다.'; return; }
    try { await exportHwp(f, day, Cloud.profileName || ''); } catch (e) { $('lgStatus').textContent = '한글 파일 만들기 실패: ' + e.message; }
  });
  $('lgImport').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; importHwp(file); });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  RENDER.log = render;
  document.addEventListener('cloud-change', () => { stopDay(); refreshNav(); document.dispatchEvent(new Event('roles-change')); });
  if (window.Cloud && Cloud.ready) refreshNav();
})();
