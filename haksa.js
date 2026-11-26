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
  async function writeSem(sem) {
    guard();
    const { s1Start, s1End, s2Start, s2End } = sem;
    await Cloud.fb.F.setDoc(ref(), { sem: { s1Start, s1End, s2Start, s2End }, ...stamp() }, { merge: true });
  }
  /** 이 PC의 학사일정(현재 화면)으로 학교 공용 학사일정을 처음 만듦 */
  async function createFromLocal() {
    guard();
    const { s1Start, s1End, s2Start, s2End } = state.sem;
    await Cloud.fb.F.setDoc(ref(), { year: state.school.year, sem: { s1Start, s1End, s2Start, s2End }, days: JSON.parse(JSON.stringify(state.days)), ...stamp() });
  }

  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('year-change', subscribe);
})();
