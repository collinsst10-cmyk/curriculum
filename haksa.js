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
    days: {}, sem: null, eventPlans: {}, operatingPeriod: null,
    canEdit: () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin()),
    canCreate: () => H.loaded && !H.active && H.canEdit(),
    writeDays, writeSem, createFromLocal, setOperatingYear, writeNeis, writeWebsite,
    get neis() { return schoolNeis; },
    get operatingYear() { return operatingYear; },
  };

  const ref = () => Cloud.fb.F.doc(Cloud.fb.db, 'calendar', String(state.school.year));

  function subscribe() {
    if (!window.Cloud || !Cloud.ready) { stop(); rerender(); return; }
    const y = state.school.year;
    if (unsub && subYear === y) return;
    stop();
    subYear = y;
    unsub = Cloud.fb.F.onSnapshot(ref(), d => {
      if (subYear !== y) return;
      const data = d.exists() ? d.data() : null;
      const priorPeriod = JSON.stringify(H.operatingPeriod);
      H.operatingPeriod = data?.operatingPeriod || null;
      H.active = !!data;
      H.days = (data && data.days) || {};
      H.eventPlans = data?.eventPlans || {};
      H.sem = (data && data.sem) || null;
      H.loaded = true;
      if (priorPeriod !== JSON.stringify(H.operatingPeriod)) document.dispatchEvent(new Event('year-period-change'));
      rerender();
    }, err => { console.warn('학사일정 불러오기 실패', err); H.loaded = true; rerender(); });
  }
  function stop() {
    if (unsub) unsub();
    unsub = null; subYear = null;
    H.active = false; H.loaded = false; H.days = {}; H.sem = null; H.eventPlans = {}; H.operatingPeriod = null;
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
  const semDoc = s => { const f = semFull(s); return { s1Start: f.s1Start, s1End: f.s1End, s2Start: f.s2Start, s2End: f.s2End, summer: f.summer, winter: f.winter, entrance: f.entrance || '', graduation: f.graduation || '' }; };
  async function writeSem(sem) {
    guard();
    await Cloud.fb.F.setDoc(ref(), { sem: semDoc(sem), ...stamp() }, { mergeFields: ['sem', 'updatedAt', 'updatedBy'] });
  }
  /** 이 PC의 학사일정(현재 화면)으로 학교 공용 학사일정을 처음 만듦 */
  async function createFromLocal() {
    guard();
    await Cloud.fb.F.setDoc(ref(), { year: state.school.year, sem: semDoc(state.sem), days: JSON.parse(JSON.stringify(state.days)), eventPlans: calendarPlans(), ...stamp() });
    await writeSchool(true);
  }

  /* ---------- 학교 정보(학교명·학년도·학급 수) 공유: config/school ----------
   * 관리자가 고치면 저장되고, 선생님 화면은 이 값으로 학년도·학급 수를 맞춤(교육활동 대상 학급 등) */
  let unsubSchool = null, lastSchool = '', operatingYear = null, schoolLoaded = false;
  let schoolNeis = '', unsubNeis = null, migratingNeis = false;
  const neisRef = () => Cloud.fb.F.doc(Cloud.fb.db, 'schoolPrivate', 'neis');
  function subscribeNeis() {
    unsubNeis?.();
    schoolNeis = '';
    document.dispatchEvent(new Event('school-neis-change'));
    if (!Cloud.ready || Cloud.isGeneral) return;
    unsubNeis = Cloud.fb.F.onSnapshot(neisRef(), doc => {
      schoolNeis = doc.data()?.code || '';
      document.dispatchEvent(new Event('school-neis-change'));
    }, error => console.warn('NEIS 학교코드 읽기 실패', error));
  }
  async function writeNeis(code) {
    guard();
    const { F, db } = Cloud.fb;
    await F.runTransaction(db, async tx => {
      const shared = await tx.get(infoRef());
      tx.set(neisRef(), { code });
      if (Object.hasOwn(shared.data() || {}, 'neis')) tx.update(infoRef(), { neis: F.deleteField() });
    });
  }
  async function migrateNeis() {
    const { F, db } = Cloud.fb;
    migratingNeis = true;
    try {
      await F.runTransaction(db, async tx => {
        const shared = await tx.get(infoRef());
        const existing = await tx.get(neisRef());
        if (!Object.hasOwn(shared.data() || {}, 'neis')) return;
        if (!existing.exists()) tx.set(neisRef(), { code: shared.data().neis || '' });
        tx.update(infoRef(), { neis: F.deleteField() });
      });
    } catch (error) { console.warn('NEIS 학교코드 분리 실패', error); }
    finally { migratingNeis = false; }
  }
  const infoRef = () => Cloud.fb.F.doc(Cloud.fb.db, 'config', 'school');
  const annualRef = year => Cloud.fb.F.doc(Cloud.fb.db, 'schoolYears', String(year));
  const validYear = year => Number.isInteger(year) && year >= 2000 && year <= 2099;
  const bellRows = model => (model.env?.bell?.rows || []).map(({ label, start, end, kind }) => ({ label, start, end, kind }));
  const annual = model => ({ classes: { ...model.school.classes }, kclass: Number(model.school.kclass ?? 3), bell: bellRows(model) });
  const annualFields = data => ({ classes: data.classes || {}, kclass: Number(data.kclass ?? 3), bell: data.bell || [] });
  const schoolInfo = () => ({ name: state.school.name, year: state.school.year, ...annual(state),
    ...(state.school.details ? { details: { ...state.school.details } } : {}) });
  const encodeSchool = data => JSON.stringify({ name: data.name, year: data.year,
    ...annualFields(data), ...(data.details ? { details: data.details } : {}) });

  async function writeWebsite(website) {
    if (!H.canEdit() || !App.canEditSchool() || !schoolLoaded) throw new Error('학교 정보 편집 권한이 필요합니다.');
    const { F, db } = Cloud.fb;
    await F.runTransaction(db, async tx => {
      const ref = infoRef();
      const shared = await tx.get(ref);
      if (shared.exists()) tx.update(ref, { 'details.website': website, ...stamp() });
      else {
        const info = schoolInfo();
        tx.set(ref, { ...info, details: { ...info.details, website }, ...stamp() });
      }
    });
  }

  async function writeSchool(force) {
    if (!H.canEdit() || !schoolLoaded || (operatingYear && operatingYear !== state.school.year)) return;
    const info = schoolInfo();
    const json = encodeSchool(info);
    if (!force && json === lastSchool) return;
    const F = Cloud.fb.F;
    await F.runTransaction(Cloud.fb.db, async tx => {
      const existing = await tx.get(infoRef());
      if (existing.exists() && existing.data().year !== info.year) return;
      tx.set(infoRef(), { ...info, ...stamp() }, { merge: true });
      tx.set(annualRef(info.year), { year: info.year, ...annualFields(info), ...stamp() }, { merge: true });
    });
  }

  async function setOperatingYear(year, nextPlan) {
    guard();
    if (!schoolLoaded || !validYear(year)) throw new Error('학교 공용 학년도 정보를 먼저 불러와 주세요.');
    const F = Cloud.fb.F;
    const result = await F.runTransaction(Cloud.fb.db, async tx => {
      const shared = await tx.get(infoRef());
      const current = shared.data() || {};
      const previousYear = Number(current.year);
      if (validYear(previousYear) && previousYear !== operatingYear) throw new Error('다른 관리자가 학년도를 변경했습니다. 새 학년도를 확인해 주세요.');
      const nextRef = annualRef(year);
      const target = await tx.get(nextRef);
      const previousRef = validYear(previousYear) && previousYear !== year ? annualRef(previousYear) : null;
      const previous = previousRef ? await tx.get(previousRef) : null;
      const settings = target.exists() ? annualFields(target.data()) : annual(nextPlan);
      if (previous && !previous.exists()) tx.set(previousRef, { year: previousYear, ...annualFields(current), ...stamp() });
      if (!target.exists()) tx.set(nextRef, { year, ...settings, ...stamp() });
      tx.set(infoRef(), { ...(!shared.exists() ? schoolInfo() : {}), ...settings, year, ...stamp() }, { merge: true });
      return settings;
    });
    if (operatingYear !== year) {
      operatingYear = year;
      applyOperatingYear(year, result);
    }
  }

  H.onSaved = () => { if (H.canEdit()) writeSchool().catch(e => console.warn('학교 정보 저장 실패', e)); };
  function subscribeSchool() {
    if (unsubSchool) { unsubSchool(); unsubSchool = null; }
    schoolLoaded = false;
    if (!window.Cloud || !Cloud.ready) { operatingYear = null; return; }
    unsubSchool = Cloud.fb.F.onSnapshot(infoRef(), { includeMetadataChanges: true }, d => {
      if (d.metadata.hasPendingWrites) return;
      schoolLoaded = !d.metadata.fromCache || schoolLoaded;
      if (!d.exists()) return;
      const s = d.data();
      if (!validYear(s.year)) return;
      const changed = operatingYear !== s.year || state.school.year !== s.year;
      operatingYear = s.year;
      lastSchool = encodeSchool(s);
      if (Cloud.isAdmin() && !migratingNeis && Object.hasOwn(s, 'neis')) migrateNeis();
      Object.assign(state.school, { name: s.name || state.school.name, details: { ...s.details } });
      if (changed || !Cloud.isAdmin()) applyOperatingYear(s.year, annualFields(s));
      else if (curTab === 'school') rerenderKeepFocus(renderInfo);
    }, err => console.warn('학교 정보 불러오기 실패', err));
  }

  document.addEventListener('cloud-change', () => { subscribe(); subscribeSchool(); subscribeNeis(); });
  document.addEventListener('year-change', subscribe);
})();
