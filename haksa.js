/* =========================================================
 * 학교 공용 학사일정 (Cloud Firestore: calendar/{학년도})
 *   { sem: { s1Start, s1End, s2Start, s2End },
 *     days: { 'YYYY-MM-DD': { type: event|closure|holiday|vacation|school, name, hrs?, area?, grades? } } }
 *
 *  - 승인된 선생님은 모두 읽고, 관리자만 고칩니다(보안 규칙).
 *  - 문서가 있으면 app.js 의 calDays()/calSem() 이 이 값을 씁니다 → 수업일수·시수·교육활동 일정이 모두 같은 학사일정을 봄.
 *  - 문서가 없으면 이 PC의 학사일정을 그대로 쓰고, 관리자에게 "학교 공용으로 만들기" 버튼을 보여 줍니다.
 * ========================================================= */
(function () {
  'use strict';
  let unsub = null, subYear = null;

  const H = window.Haksa = {
    active: false,          // 학교 공용 학사일정 사용 중
    loaded: false,
    days: {}, sem: null,
    canEdit: () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin()),
    canCreate: () => H.loaded && !H.active && H.canEdit(),
    writeDays, writeSem, createFromLocal,
  };

  const ref = () => Cloud.fb.F.doc(Cloud.fb.db, 'calendar', String(state.school.year));

  function subscribe() {
    if (!window.Cloud || !Cloud.ready) { stop(); rerender(); return; }
    const y = state.school.year;
    if (unsub && subYear === y) return;
    stop();
    subYear = y;
    unsub = Cloud.fb.F.onSnapshot(ref(), d => {
      const data = d.exists() ? d.data() : null;
      H.active = !!data;
      H.days = (data && data.days) || {};
      H.sem = (data && data.sem) || null;
      H.loaded = true;
      rerender();
    }, err => { console.warn('학사일정 불러오기 실패', err); H.loaded = true; rerender(); });
  }
  function stop() {
    if (unsub) unsub();
    unsub = null; subYear = null;
    H.active = false; H.loaded = false; H.days = {}; H.sem = null;
  }
  function rerender() {
    _yearCache = null;   // app.js 의 학년도 계산 캐시
    if (typeof curTab !== 'undefined' && RENDER[curTab]) rerenderKeepFocus(() => RENDER[curTab]());
  }

  function guard() { if (!H.canEdit()) throw new Error('학교 공용 학사일정은 관리자만 수정할 수 있습니다.'); }
  const stamp = () => ({ updatedAt: Cloud.fb.F.serverTimestamp(), updatedBy: Cloud.email });

  /** patch = { 'YYYY-MM-DD': 항목 | null } */
  async function writeDays(patch) {
    guard();
    const F = Cloud.fb.F, days = {};
    Object.entries(patch).forEach(([ds, e]) => { days[ds] = e ? e : F.deleteField(); });
    await F.setDoc(ref(), { days, ...stamp() }, { merge: true });
  }
  const semDoc = s => { const f = semFull(s); return { s1Start: f.s1Start, s1End: f.s1End, s2Start: f.s2Start, s2End: f.s2End, summer: f.summer, winter: f.winter }; };
  async function writeSem(sem) {
    guard();
    await Cloud.fb.F.setDoc(ref(), { sem: semDoc(sem), ...stamp() }, { mergeFields: ['sem', 'updatedAt', 'updatedBy'] });
  }
  /** 이 PC의 학사일정(현재 화면)으로 학교 공용 학사일정을 처음 만듦 */
  async function createFromLocal() {
    guard();
    await Cloud.fb.F.setDoc(ref(), { year: state.school.year, sem: semDoc(state.sem), days: JSON.parse(JSON.stringify(state.days)), ...stamp() });
    await writeSchool(true);
  }

  /* ---------- 학교 정보(학교명·학년도·학급 수) 공유: config/school ----------
   * 관리자가 고치면 저장되고, 선생님 화면은 이 값으로 학년도·학급 수를 맞춤(교육활동 대상 학급 등) */
  let unsubSchool = null, lastSchool = '';
  // 일과시간(교시 시각)도 함께 공유 → 선생님 화면의 시간표에도 시각 표시
  const bellRows = () => ((state.env && state.env.bell && state.env.bell.rows) || []).map(r => ({ label: r.label, start: r.start, end: r.end, kind: r.kind }));
  const schoolInfo = () => ({ name: state.school.name, neis: state.school.neis || '', year: state.school.year, classes: { ...state.school.classes }, bell: bellRows() });
  async function writeSchool(force) {
    if (!H.canEdit()) return;
    const json = JSON.stringify(schoolInfo());
    if (!force && json === lastSchool) return;
    lastSchool = json;
    await Cloud.fb.F.setDoc(Cloud.fb.F.doc(Cloud.fb.db, 'config', 'school'), { ...schoolInfo(), ...stamp() });
  }
  H.onSaved = () => { if (window.Cloud && Cloud.ready && Cloud.isAdmin()) writeSchool().catch(e => console.warn('학교 정보 저장 실패', e)); };
  function subscribeSchool() {
    if (unsubSchool) { unsubSchool(); unsubSchool = null; }
    if (!window.Cloud || !Cloud.ready) return;
    unsubSchool = Cloud.fb.F.onSnapshot(Cloud.fb.F.doc(Cloud.fb.db, 'config', 'school'), d => {
      if (!d.exists()) return;
      const s = d.data();
      if (Cloud.isAdmin()) { lastSchool = JSON.stringify({ name: s.name, neis: s.neis || '', year: s.year, classes: s.classes, bell: s.bell || [] }); return; }
      state.school.neis = s.neis || '';
      // 선생님: 관리자가 정한 학교 정보 사용
      const yearChanged = s.year && s.year !== state.school.year;
      state.school.name = s.name || state.school.name;
      if (s.year) state.school.year = s.year;
      if (s.classes) state.school.classes = { ...state.school.classes, ...s.classes };
      if (Array.isArray(s.bell) && s.bell.length) { state.env = state.env || {}; state.env.bell = { ...(state.env.bell || {}), rows: s.bell }; }
      updateTitles();
      if (yearChanged) document.dispatchEvent(new Event('year-change'));
      rerender();
    }, err => console.warn('학교 정보 불러오기 실패', err));
  }

  document.addEventListener('cloud-change', () => { subscribe(); subscribeSchool(); });
  document.addEventListener('year-change', subscribe);
})();
