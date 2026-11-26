/* =========================================================
 * 학생 전입·전출
 *  - transfers/{id} { date, type:'in'|'out', grade, cls, sex:'m'|'f', note, applied, by, byName, createdAt }
 *  - 관리자·교무부장이 등록·삭제. 등록하면 학생 현황(config/stats)의 반 인원을 ±1 (삭제하면 되돌림)
 *  - HOME '학생 전입·전출' 알림에서 최근 30일을 선생님 모두 봄
 *  - 개인정보 보호: 학생 이름은 저장하지 않음
 * ========================================================= */
(function () {
  'use strict';
  const RECENT_DAYS = 30, NEW_DAYS = 3;
  const TYPE = { in: '전입', out: '전출' }, SEX = { m: '남', f: '여' };
  let recent = [], all = [], unsubRecent = null, unsubAll = null;

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const canEdit = () => isAdm() || !!(window.LogRoles && LogRoles.isWriter());
  TAB_GUARDS.stats4 = () => canEdit();
  const col = () => Cloud.fb.F.collection(Cloud.fb.db, 'transfers');
  const md = ds => { const d = parse(ds); return `${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})`; };
  const isNew = ds => ds >= fmt(addDays(new Date(), -NEW_DAYS));
  // 오늘이 속한 학년도의 시작(3월 1일). 계획 중인 학년도(state.school.year)와 다를 수 있음
  const schoolYearStart = () => { const d = new Date(); return `${d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1}-03-01`; };

  function subscribe() {
    [unsubRecent, unsubAll].forEach(u => u && u()); unsubRecent = unsubAll = null; recent = []; all = [];
    renderHome();
    if (!window.Cloud || !Cloud.ready) return;
    const F = Cloud.fb.F;
    unsubRecent = F.onSnapshot(F.query(col(), F.where('date', '>=', fmt(addDays(new Date(), -RECENT_DAYS))), F.orderBy('date', 'desc')),
      snap => { recent = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderHome(); },
      e => console.warn('전입·전출 불러오기 실패', e));
  }
  function watchAll() {
    if (unsubAll || !Cloud.ready) return;
    const F = Cloud.fb.F;
    unsubAll = F.onSnapshot(F.query(col(), F.where('date', '>=', schoolYearStart()), F.orderBy('date', 'desc')),
      snap => { all = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderList(); },
      e => { $('trList').innerHTML = `<p class="hint">불러오기 실패: ${esc(e.message)}</p>`; });
  }

  /* ---------- HOME 알림 ---------- */
  function renderHome() {
    const box = $('homeMoves');
    const locked = window.App && App.locked && App.locked();
    box.hidden = !(window.Cloud && Cloud.ready) || locked || !recent.length;
    if (box.hidden) return;
    const nIn = recent.filter(t => t.type === 'in').length, nOut = recent.length - nIn;
    $('homeMovesSum').textContent = `최근 ${RECENT_DAYS}일 · 전입 ${nIn}명 · 전출 ${nOut}명`;
    $('homeMovesList').innerHTML = recent.slice(0, 8).map(t => `<li class="${t.type}">
        <span class="mv-date">${md(t.date)}</span><span class="mv-type ${t.type}">${TYPE[t.type]}</span>
        <span class="mv-who">${t.grade}학년 ${t.cls}반 <small>${SEX[t.sex] || ''}</small></span>
        ${t.note ? `<span class="mv-note">${esc(t.note)}</span>` : ''}${isNew(t.date) ? '<span class="mv-new">NEW</span>' : ''}</li>`).join('');
  }

  /* ---------- 등록 화면 (학교 현황 › ④) ---------- */
  function fillClassOptions() {
    const g = Number($('trGrade').value), n = Math.min(20, Number(state.school.classes?.[g]) || 0);
    const cur = $('trClass').value;
    $('trClass').innerHTML = Array.from({ length: n }, (_, c) => `<option value="${c + 1}">${c + 1}반</option>`).join('') || '<option value="">학급 없음</option>';
    if (cur && Number(cur) <= n) $('trClass').value = cur;
  }
  function render() {
    if (!canEdit()) return;
    if (!$('trDate').value) $('trDate').value = fmt(new Date());
    fillClassOptions();
    watchAll(); renderList();
  }
  function renderList() {
    if (!$('trList')) return;
    $('trList').innerHTML = all.length ? `<table class="tbl tr-table"><thead><tr><th>날짜</th><th>구분</th><th>학급</th><th>성별</th><th>메모</th><th>인원 반영</th><th></th></tr></thead><tbody>
      ${all.map(t => `<tr><td>${md(t.date)}</td><td><span class="mv-type ${t.type}">${TYPE[t.type]}</span></td><td>${t.grade}학년 ${t.cls}반</td><td>${SEX[t.sex] || ''}</td>
        <td>${esc(t.note || '')}</td><td>${t.applied ? '반영' : '-'}</td><td><button class="btn small" data-del="${t.id}">삭제</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">이번 학년도에 등록한 전입·전출이 없습니다.</p>';
  }

  /** 학생 현황 반 인원을 ±1 (반별 자료가 없으면 학년 합계만) */
  function adjust(doc, t, dir) {
    const st = doc.students || { classes: [], male: [0, 0, 0, 0, 0, 0], female: [0, 0, 0, 0, 0, 0] };
    const i = t.grade - 1, key = `${t.grade}-${t.cls}`;
    st.male = (st.male || [0, 0, 0, 0, 0, 0]).slice(); st.female = (st.female || [0, 0, 0, 0, 0, 0]).slice();
    if (st.byClass && Object.keys(st.byClass).length) {
      st.byClass = { ...st.byClass, [key]: { m: 0, f: 0, ...(st.byClass[key] || {}) } };
      st.byClass[key][t.sex] = Math.max(0, (Number(st.byClass[key][t.sex]) || 0) + dir);
    }
    const arr = t.sex === 'm' ? st.male : st.female;
    arr[i] = Math.max(0, (Number(arr[i]) || 0) + dir);
    return { ...doc, students: st };
  }

  async function add(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const t = { date: $('trDate').value, type: $('trType').value, grade: Number($('trGrade').value), cls: Number($('trClass').value),
      sex: $('trSex').value, note: $('trNote').value.trim().slice(0, 100), applied: $('trApply').checked };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !t.cls) { $('trStatus').textContent = '날짜와 학급을 확인하세요.'; return; }
    const { F, db } = Cloud.fb;
    $('trAdd').disabled = true;
    try {
      await F.runTransaction(db, async tx => {
        const sref = F.doc(db, 'config', 'stats');
        const cur = t.applied ? (await tx.get(sref)).data() : null;
        tx.set(F.doc(col()), { ...t, by: Cloud.email, byName: Cloud.profileName || '', createdAt: F.serverTimestamp() });
        if (t.applied) {
          const next = adjust(cur || {}, t, t.type === 'in' ? 1 : -1);
          tx.set(sref, { ...next, updatedBy: Cloud.email, updatedAt: F.serverTimestamp() });
        }
      });
      $('trNote').value = '';
      $('trStatus').textContent = `${t.grade}학년 ${t.cls}반 ${TYPE[t.type]}을 등록했습니다.${t.applied ? ' 학생 현황 인원에 반영했습니다.' : ''}`;
    } catch (err) { $('trStatus').textContent = '등록 실패: ' + err.message; }
    finally { $('trAdd').disabled = false; }
  }

  async function remove(id) {
    const t = all.find(x => x.id === id);
    if (!t || !canEdit()) return;
    if (!confirm(`${md(t.date)} ${t.grade}학년 ${t.cls}반 ${TYPE[t.type]} 기록을 삭제할까요?${t.applied ? '\n학생 현황 인원도 되돌립니다.' : ''}`)) return;
    const { F, db } = Cloud.fb;
    try {
      await F.runTransaction(db, async tx => {
        const sref = F.doc(db, 'config', 'stats');
        const cur = t.applied ? (await tx.get(sref)).data() : null;
        tx.delete(F.doc(col(), id));
        if (t.applied && cur) tx.set(sref, { ...adjust(cur, t, t.type === 'in' ? -1 : 1), updatedBy: Cloud.email, updatedAt: F.serverTimestamp() });
      });
      $('trStatus').textContent = '삭제했습니다.';
    } catch (err) { $('trStatus').textContent = '삭제 실패: ' + err.message; }
  }

  $('trForm').addEventListener('submit', add);
  $('trGrade').addEventListener('change', fillClassOptions);
  $('trList').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) remove(b.dataset.del); });

  RENDER.stats4 = render;
  document.addEventListener('cloud-change', subscribe);
  if (window.Cloud && Cloud.ready) subscribe();
  window.Transfers = { renderHome };
})();
