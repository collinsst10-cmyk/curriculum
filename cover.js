/* =========================================================
 * 학교 일지 › 보결 관리 (교무부장)
 *  - 날짜별: 학급 · 교시 · 보결 교사(전담 등)
 *  - dailyLogs/{YYYY-MM-DD}.covers 에 저장 → 학교 일지 '결보강'과 HOME 에 그대로 연동
 * ========================================================= */
(function () {
  'use strict';
  let day = OperatingCalendar.activeDate();
  let list = [], loaded = null, dirty = false, unsub = null, subDay = null;
  const PERIODS = [1, 2, 3, 4, 5, 6];
  const isWriter = () => !!(window.LogRoles && LogRoles.isWriter());
  TAB_GUARDS.cover = () => isWriter();
  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);

  const classes = () => GRADES.flatMap(g => Array.from({ length: Number(state.school.classes[g]) || 0 }, (_, i) => `${g}-${i + 1}`));
  /** 보결 교사 후보: 학교사용환경설정의 전담(이름) + 교감·교무부장 */
  function teachers() {
    const env = state.env || {}, out = (window.StaffLinks?.activeStaff() || []).map(person => person.name);
    (env.teachers || []).forEach(t => { if (t.name) out.push(t.teacher ? `${t.name}(${t.teacher})` : t.name); });
    return [...new Set([...out, '교감', '교무부장'])];
  }

  function watch() {
    if (unsub && subDay === day) return;
    if (unsub) unsub();
    subDay = day; loaded = null;
    unsub = Cloud.fb.F.onSnapshot(ref(day), d => {
      loaded = d.exists() ? d.data() : null;
      if (!dirty) { list = JSON.parse(JSON.stringify((loaded && loaded.covers) || [])); draw(); }
    }, e => { $('cvStatus').textContent = '불러오기 실패: ' + e.message; });
  }

  function draw() {
    $('cvDate').value = day;
    $('cvDay').innerHTML = HomeLog.longDate(day) + (day === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : '');
    const cls = classes();
    const staff = window.StaffLinks?.activeStaff() || [];
    $('cvRows').innerHTML = list.map((c, i) => `<tr data-i="${i}">
      <td><select data-f="cls"><option value="">학급</option>${cls.map(k => `<option ${k === c.cls ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><div class="cv-periods">${PERIODS.map(p => `<label><input type="checkbox" data-p="${p}" ${(c.periods || []).includes(p) ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div></td>
      <td><input data-f="teacher" list="cvTeachers" maxlength="60" value="${esc(c.teacher || '')}" placeholder="보결 교사">
        ${staff.length ? `<select data-f="staffId" aria-label="운영 학년도 교직원 선택"><option value="">직접 입력</option>${staff.map(person =>
          `<option value="${esc(person.id)}" ${person.id === c.staffId ? 'selected' : ''}>${esc(person.name)} · ${esc(person.id.slice(-5))}</option>`).join('')}</select>` : ''}</td>
      <td><button type="button" class="sm-del" data-del="${i}">삭제</button></td></tr>`).join('')
      || '<tr class="cv-empty"><td colspan="4">보결 없음</td></tr>';
    $('cvTeachers').innerHTML = teachers().map(t => `<option value="${esc(t)}">`).join('');
    $('cvPreview').textContent = CoverText(list) || '';
    $('cvPreviewBox').hidden = !CoverText(list);
    if (!dirty) $('cvStatus').textContent = loaded && loaded.coversAt ? `저장됨 · ${HomeLog.fmtTs(loaded.coversAt)}` : '';
  }

  function render() { if (!isWriter()) return; watch(); draw(); }
  function go(ds) {
    if (dirty && !confirm('저장하지 않은 보결 내용이 있습니다. 다른 날짜로 이동할까요?')) { $('cvDate').value = day; return; }
    day = ds; dirty = false; render();
  }
  const touch = () => { dirty = true; $('cvStatus').textContent = '저장하지 않은 변경이 있습니다.'; $('cvPreview').textContent = CoverText(list); $('cvPreviewBox').hidden = !CoverText(list); };

  async function save() {
    if (!isWriter()) return '보결은 교무부장만 저장할 수 있습니다.';
    if (!OperatingCalendar.canWrite(day)) { $('cvStatus').textContent = '보결은 운영 학년도의 날짜에만 저장할 수 있습니다.'; return '운영 학년도 날짜를 확인해 주세요.'; }
    const clean = list.filter(c => c.cls).map(c => {
      const teacher = (c.teacher || '').trim(), staffId = c.staffId;
      return { cls: c.cls, periods: (c.periods || []).slice().sort((a, b) => a - b), teacher,
        ...(staffId ? { staffId } : {}) };
    });
    if (clean.some(c => !c.periods.length)) { $('cvStatus').textContent = '교시를 고르세요.'; return '교시를 고르세요.'; }
    const F = Cloud.fb.F;
    try {
      await F.setDoc(ref(day), { year: state.school.year, covers: clean, cover: CoverText(clean), coversAt: F.serverTimestamp(), by: Cloud.email, byName: Cloud.profileName || '' }, { merge: true });
      dirty = false; list = clean; $('cvStatus').textContent = '저장했습니다. 학교 일지 결보강에 들어갑니다.'; HomeLog.refreshRecent();
      return '';
    } catch (e) { $('cvStatus').textContent = '저장 실패: ' + e.message; return '저장에 실패했습니다: ' + e.message; }
  }
  window.CoverSave = () => (dirty ? save() : Promise.resolve(''));

  const root = $('tab-cover');
  root.addEventListener('click', e => {
    if (e.target.closest('#cvAdd')) { list.push({ cls: '', periods: [], teacher: '' }); touch(); draw(); const s = root.querySelector(`tr[data-i="${list.length - 1}"] select`); if (s) s.focus(); return; }
    const del = e.target.closest('[data-del]'); if (del) { list.splice(Number(del.dataset.del), 1); touch(); draw(); return; }
    if (e.target.closest('#cvSave')) { save(); return; }
    if (e.target.closest('#cvPrev')) go(HomeLog.stepDay(day, -1));
    if (e.target.closest('#cvNext')) go(HomeLog.stepDay(day, 1));
    if (e.target.closest('#cvToday')) go(OperatingCalendar.activeDate());
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'cvDate') { if (e.target.value) go(e.target.value); return; }
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const c = list[Number(tr.dataset.i)];
    if (e.target.dataset.p) { const p = Number(e.target.dataset.p); c.periods = e.target.checked ? [...new Set([...(c.periods || []), p])] : (c.periods || []).filter(x => x !== p); }
    else if (e.target.dataset.f === 'staffId') {
      const person = (window.StaffLinks?.activeStaff() || []).find(item => item.id === e.target.value);
      if (person) { c.staffId = person.id; c.teacher = person.name; }
      else delete c.staffId;
      touch(); draw(); return;
    } else if (e.target.dataset.f) {
      c[e.target.dataset.f] = e.target.value;
      if (e.target.dataset.f === 'teacher') delete c.staffId;
    }
    touch();
  });
  root.addEventListener('input', e => { const tr = e.target.closest('tr[data-i]'); if (tr && e.target.dataset.f === 'teacher') { const row = list[Number(tr.dataset.i)]; row.teacher = e.target.value; delete row.staffId; touch(); } });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  RENDER.cover = render;
  function resetOperatingDate() {
    if (dirty) { $('cvStatus').textContent = '운영 학년도가 변경되었습니다. 저장하지 않은 변경은 화면에 유지됩니다.'; return; }
    day = OperatingCalendar.activeDate();
    unsub?.(); unsub = null; subDay = null; list = [];
    if (curTab === 'cover') render();
  }
  document.addEventListener('staff-directory-change', () => { if (curTab === 'cover' && !dirty) draw(); });
  document.addEventListener('year-change', resetOperatingDate);
  document.addEventListener('year-period-change', resetOperatingDate);
  document.addEventListener('cloud-change', () => { if (unsub) unsub(); unsub = null; subDay = null; });
})();
