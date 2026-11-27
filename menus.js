/* =========================================================
 * 화면 구성
 *  - 학사일정 보기(hview): 모든 선생님용 조회 화면
 *  - 교육과정 편성 ① 학사일정(cal): 학교 정보 + 학기·방학 + 휴업일 + 수업일수·주차
 *  - 교육과정 편성 ② 교내행사(event)
 *  - 교육과정 편성 ③ 시수 배정(hours): 시수 + 교시·수업 가능 시수 + 편제표·검토
 * ========================================================= */
(function () {
  'use strict';
  const e2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const acts = () => (window.Activities ? Activities.items : {});

  /* ---------- 화면 묶기 ---------- */
  const daysAndWeeks = RENDER.days;          // 수업일수(월별·요일별)
  const hoursOnly = RENDER.hours;
  RENDER.cal = () => { renderInfo(); renderCal(); daysAndWeeks(); syncHolidays(); };
  RENDER.hours = () => { renderInfo(); hoursOnly(); daysAndWeeks(); };
  RENDER.review = renderTable;
  RENDER.hview = renderHview;
  RENDER.school = renderInfo;
  RENDER.purchase = () => window.PurchaseSites?.renderLinks();
  RENDER.schoolstructure = () => {
    $('schoolStructure').innerHTML = GRADES.map(grade => {
      const count = Number(state.school.classes[grade]) || 0;
      const classes = Array.from({ length: count }, (_, i) => `<span>${i + 1}반</span>`).join('');
      return `<section><h3>${grade}학년 <small>${count}학급</small></h3><div>${classes || '편성 학급 없음'}</div></section>`;
    }).join('');
  };
  RENDER.event = renderEvent;

  /* =========================================================
   * 학사일정 보기 (조회 전용)
   * ========================================================= */
  function renderHview(target = 'hvGrid') {
    const days = computeYear(), today = fmt(new Date()), A = acts();
    if (target === 'hvGrid') $('hviewTitle').textContent = `${state.school.year}학년도 학사일정`;
    let html = '';
    for (let i = 0; i < 12; i++) {
      const y = state.school.year + (i >= 10 ? 1 : 0), m = (2 + i) % 12;
      const list = days.filter(x => x.year === y && x.month === m);
      html += `<div class="month"><div class="month-head">${y}년 ${m + 1}월<span>수업일 ${list.filter(x => x.isSchool).length}일</span></div><div class="mgrid">`;
      html += WD.map(w => `<div class="dow">${w}</div>`).join('');
      for (let k = 0; k < list[0].dow; k++) html += '<div class="day empty"></div>';
      list.forEach(x => {
        const al = (A[x.ds] || []).filter(t => t.status !== 'canceled');
        const eventDate = target === 'evCalendar';
        const selected = eventDate && evPick.has(x.ds);
        const tip = `${x.ds} ${TYPE_LABEL[x.type]}${x.name ? ' · ' + x.name : ''}` + al.map(t => `\n· ${t.kind} ${t.title} (${t.status === 'confirmed' ? '확정' : '신청'})`).join('');
        const number = `<span class="d">${x.d.getDate()}</span>`;
        const labels = [...new Set([x.name, ...al.map(t => t.title)].filter(Boolean))];
        const content = eventDate
          ? `${number}${al.length ? `<span class="acts ${al.some(t => t.status === 'confirmed') ? 'c' : ''}">${al.length}</span>` : ''}<span class="n">${calendarLabel(x.name || (al[0] ? al[0].title : ''))}</span>`
          : number + calendarActivityDot(al) + labels.map(label => `<span class="calendar-day-label">${e2(label)}</span>`).join('');
        html += `<${eventDate ? 'button type="button" data-event-date="' + x.ds + '" aria-pressed="' + Boolean(selected) + '"' : 'div'} class="day ${x.type}${selected ? ' sel' : ''}${x.ds === today ? ' today' : ''}" title="${e2(tip)}">${content}</${eventDate ? 'button' : 'div'}>`;
      });
      html += '</div></div>';
    }
    $(target).innerHTML = html;
  }

  /* =========================================================
   * 교내행사 (관리자)
   * ========================================================= */

  const evPick = new Set();
  let anchor = null;
  let editing = null;
  let adjusting = false;
  let undo = null;
  let redo = null;
  let busy = false;
  const selectedGrades = () => [...$('evGrades').querySelectorAll('input:checked')].map(i => Number(i.value));
  const targetLabel = p => p.classNumber ? p.grades[0] + '학년 ' + p.classNumber + '반' : p.grades.length ? p.grades.join('·') + '학년' : '전교';
  const datesLabel = dates => dates.map(fmtK).join(', ');
  const yearStart = y => y + '-03-01';
  const yearEnd = y => (y + 1) + '-03-01';
  const inYear = (ds, y) => ds >= yearStart(y) && ds < yearEnd(y);

  function entries(days, plans, year) {
    const rows = Object.entries(plans).filter(([, p]) => p.dates?.some(ds => inYear(ds, year)));
    for (const [ds, day] of Object.entries(days)) {
      const id = 'legacy-' + ds;
      if (!inYear(ds, year) || day.type !== 'event' || Object.hasOwn(plans, id)) continue;
      const [legacy] = calendarEvents(ds, day, {});
      rows.push([id, { ...legacy, dates: [ds] }]);
    }
    return rows.sort((a, b) => a[1].dates[0].localeCompare(b[1].dates[0]));
  }

  function draft() {
    const grades = selectedGrades();
    const classNumber = Number($('evClass').value);
    const dates = [...evPick].sort();
    if (adjusting) return { kind: 'adjust', dates, grades, classNumber, periods: [...$('evHours').querySelectorAll('input:checked')].map(i => Number(i.value)) };
    const subjects = Object.fromEntries([...$('evHours').querySelectorAll('select')].filter(s => s.value).map(s => [s.dataset.period, s.value]));
    return { kind: 'event', dates, name: $('evName').value.trim(), grades, classNumber, allDay: $('evAllDay').checked, subjects };
  }

  function renderControls(p = {}) {
    if (!$('evGrades').children.length) {
      $('evGrades').innerHTML = GRADES.map(g => '<label class="tg"><input type="checkbox" value="' + g + '">' + g + '학년</label>').join('');
    }
    $('evGrades').querySelectorAll('input').forEach(i => { i.checked = p.grades?.includes(Number(i.value)) || false; });
    $('evName').value = p.name || '';
    $('evAllDay').checked = Boolean(p.allDay);
    $('evName').closest('label').hidden = adjusting;
    $('evDayLabel').hidden = adjusting;
    $('evPeriodsLabel').textContent = adjusting ? '수업하는 교시' : '교시별 적용 과목';
    renderPeriods(p);
  }

  function renderPeriods(p) {
    const grades = selectedGrades();
    const count = grades.length === 1 ? Number(state.school.classes[grades[0]]) : 0;
    $('evClass').innerHTML = '<option value="0">전체 학급</option>' + Array.from({ length: count }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '반</option>').join('');
    $('evClass').value = count >= p.classNumber ? String(p.classNumber || 0) : '0';
    const targets = grades.length ? grades : GRADES;
    const subjects = subjectsOf(targets[0]).filter(s => targets.every(g => subjectsOf(g).some(t => t.key === s.key)));
    $('evHours').innerHTML = Array.from({ length: MAX_PERIODS }, (_, i) => {
      const n = i + 1;
      if (adjusting) return '<label class="tg"><input type="checkbox" value="' + n + '"' + (p.periods?.includes(n) ? ' checked' : '') + '>' + n + '교시</label>';
      const options = subjects.map(s => '<option value="' + e2(s.key) + '"' + (p.subjects?.[n] === s.key ? ' selected' : '') + '>' + e2(s.name) + '</option>').join('');
      return '<label>' + n + '교시<select data-period="' + n + '"><option value="">기초 시간표 유지</option>' + options + '</select></label>';
    }).join('');
  }

  function errors(p) {
    if (!p.dates.length) return ['날짜를 선택하세요.'];
    if (adjusting && !p.periods.length) return ['수업할 교시를 하나 이상 선택하세요.'];
    if (!adjusting && !p.name) return ['행사명을 입력하세요.'];
    const days = computeYear().filter(d => p.dates.includes(d.ds));
    if (days.length !== p.dates.length || days.some(d => !d.isSchool)) return ['수업일만 등록할 수 있습니다.'];
    const targets = p.grades.length ? p.grades : GRADES;
    const peers = entries(calDays(), calendarPlans(), state.school.year).filter(([id, other]) =>
      id !== editing && other.kind === p.kind && other.dates.some(ds => p.dates.includes(ds))
      && targets.some(g => !other.grades.length || other.grades.includes(g))
      && (!p.classNumber || !other.classNumber || p.classNumber === other.classNumber));
    if (peers.some(([, other]) => adjusting || p.allDay || other.allDay || Object.keys(p.subjects).some(n => other.subjects[n]))) {
      return ['선택한 날짜와 대상에 겹치는 교내행사 또는 수업일 설정이 있습니다.'];
    }
    return [];
  }

  function renderCheck() {
    const p = draft(), problems = errors(p);
    $('evSel').textContent = p.dates.length ? datesLabel(p.dates) : '선택한 날짜 없음';
    const clashes = adjusting || problems.length ? [] : Object.values(acts()).flat().filter(item =>
      item.status !== 'canceled' && p.dates.includes(item.date)
      && item.targets.some(target => eventTargets(p, ...target.split('-').map(Number)))
      && item.periods.some(period => p.allDay || p.subjects[period]));
    $('evCheck').textContent = problems[0] || (clashes.length
      ? '교육활동과 겹칩니다. ' + clashes.map(item => item.title).join(', ')
      : targetLabel(p) + ' · ' + p.dates.length + '일');
    $('evSave').disabled = busy || !!problems.length || !canEditCal();
    $('evFormTitle').textContent = adjusting ? '단축·연장 수업 설정' : editing ? '교내행사 수정' : '교내행사 등록';
    $('evSave').textContent = editing || adjusting ? '저장' : '교내행사 등록';
  }

  function renderReport() {
    const sem = semFull(calSem());
    $('evSemInfo').textContent = '1학기 ' + fmtK(sem.s1Start) + ' · 2학기 ' + fmtK(sem.s2Start)
      + ' · 여름방학 ' + datesLabel(sem.summer) + ' · 겨울방학 ' + datesLabel(sem.winter);
    $('evReport').innerHTML = '<table class="tbl compact"><tr><th>대상</th><th>1학기 전일 행사</th><th>2학기 전일 행사</th><th>연간 전일 행사</th><th>1학기 확보−계획</th><th>2학기 확보−계획</th><th>연간 확보−계획</th></tr>'
      + GRADES.flatMap(g => {
        const days = computeYear().filter(d => d.isSchool);
        const classSpecific = days.some(d => [...d.events, ...d.adjustments].some(p => p.classNumber && p.grades.includes(g)));
        const classes = classSpecific ? Array.from({length: Number(state.school.classes[g])}, (_, i) => i + 1) : [undefined];
        return classes.map(c => {
          const full = s => days.filter(d => d.sem === s && d.events.some(p => p.allDay && eventTargets(p, g, c))).length;
          const diff = s => days.filter(d => d.sem === s).reduce((n, d) => n + calendarPeriods(d, g, c).length, 0) - gradeSem(g, 's' + s);
          const signed = n => n > 0 ? '+' + n : n;
          const firstDays = full(1), secondDays = full(2), firstDiff = diff(1), secondDiff = diff(2);
          return '<tr><td>' + g + '학년' + (c ? ' ' + c + '반' : '') + '</td><td>' + firstDays + '</td><td>' + secondDays + '</td><td>' + (firstDays + secondDays) + '</td><td>' + signed(firstDiff) + '</td><td>' + signed(secondDiff) + '</td><td>' + signed(firstDiff + secondDiff) + '</td></tr>';
        });
      }).join('') + '</table><p class="hint">확보 시수는 수업하는 교시 수입니다. 적용 과목별 운영 시수는 시간표 편성에서 확인할 수 있습니다.</p>';
    const rows = [];
    for (const g of GRADES) {
      const classes = Number(state.school.classes[g]) || 0;
      for (let c = 1; c <= classes; c++) {
        const totals = { 1: {}, 2: {} };
        for (const day of computeYear()) {
          if (!day.sem) continue;
          for (const key of Object.values(calendarSubjects(day, g, c))) {
            totals[day.sem][key] = (totals[day.sem][key] || 0) + 1;
          }
        }
        for (const { key, name } of subjectsOf(g)) {
          const first = totals[1][key] || 0, second = totals[2][key] || 0;
          if (first || second) rows.push('<tr><td>' + g + '학년 ' + c + '반</td><td>' + e2(name) + '</td><td>' + first + '</td><td>' + second + '</td><td>' + (first + second) + '</td></tr>');
        }
      }
    }
    $('evApplied').innerHTML = rows.length ? '<table class="tbl compact"><tr><th>학급</th><th>적용 과목</th><th>1학기</th><th>2학기</th><th>연간</th></tr>' + rows.join('') + '</table>' : '<p class="hint">적용된 행사 시수가 없습니다.</p>';
  }

  function renderEvent() {
    if (!$('evGrades').children.length) renderControls();
    renderHview('evCalendar');
    const rows = entries(calDays(), calendarPlans(), state.school.year);
    const actions = id => '<button class="btn small" data-ev="edit" data-id="' + e2(id) + '">수정</button> <button class="btn small danger" data-ev="delete" data-id="' + e2(id) + '">삭제</button>';
    $('evList').innerHTML = '<tr><th>선택</th><th>날짜</th><th>행사명</th><th>대상</th><th>적용 교시·과목</th><th></th></tr>' + rows.filter(([, p]) => p.kind !== 'adjust').map(([id, p]) =>
      '<tr><td><input type="checkbox" data-group-event="' + e2(id) + '" aria-label="' + e2(p.name) + ' 선택"></td><td>' + datesLabel(p.dates) + '</td><td>' + e2(p.name) + '</td><td>' + targetLabel(p) + '</td><td>'
      + (p.allDay ? '전일 · ' : '') + (Object.entries(p.subjects).map(([n, key]) => n + '교시 ' + e2(SHORT[key] || key)).join(', ') || '일정 표시') + '</td><td>' + actions(id) + '</td></tr>').join('');
    $('evAdjustList').innerHTML = '<tr><th>날짜</th><th>대상</th><th>수업 교시</th><th></th></tr>' + rows.filter(([, p]) => p.kind === 'adjust').map(([id, p]) =>
      '<tr><td>' + datesLabel(p.dates) + '</td><td>' + targetLabel(p) + '</td><td>' + p.periods.join('·') + '</td><td>' + actions(id) + '</td></tr>').join('');
    $('evActList').innerHTML = '<tr><th>날짜</th><th>교육활동명</th><th>상태</th></tr>' + Object.values(acts()).flat()
      .filter(p => p.kind === '교내행사' && p.status !== 'canceled' && inYear(p.date, state.school.year))
      .map(p => '<tr><td>' + fmtK(p.date) + '</td><td>' + e2(p.title) + '</td><td>' + (p.status === 'confirmed' ? '확정' : '신청') + '</td></tr>').join('');
    $('evUndo').disabled = busy || undo?.year !== state.school.year;
    $('evRedo').disabled = busy || redo?.year !== state.school.year;
    renderReport();
    renderCheck();
  }

  function selectRow(id, p) {
    editing = id;
    adjusting = p?.kind === 'adjust';
    evPick.clear();
    anchor = null;
    (p?.dates || []).forEach(ds => evPick.add(ds));
    renderControls(p);
    renderEvent();
  }

  async function storePlans(next, expected) {
    if (!canEditCal() || isTeacherView()) throw new Error('편집 권한이 없습니다.');
    const year = state.school.year;
    if (haksaShared()) {
      const { F, db } = Cloud.fb;
      const ref = F.doc(db, 'calendar', String(year));
      await F.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists() || !samePlans(snap.data().eventPlans || {}, expected)) throw new Error('다른 변경 사항을 불러온 뒤 다시 시도해 주세요.');
        tx.update(ref, { eventPlans: next });
      });
      if (state.school.year === year && haksaShared()) Haksa.eventPlans = next;
    } else {
      state.eventPlans ||= {};
      state.eventPlans[year] = next;
      save();
    }
    _yearCache = null;
  }
  function samePlans(a, b) {
    const ordered = value => {
      if (Array.isArray(value)) return value.map(ordered);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    };
    return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
  }

  async function change(next, history) {
    if (busy) return;
    const year = state.school.year;
    const before = calendarPlans();
    busy = true;
    try {
      await storePlans(next, history ? history.expected : before);
      if (history?.redo) { undo = history.entry; redo = null; }
      else if (history) { redo = history.entry; undo = null; }
      else { undo = { year, before, next }; redo = null; }
      selectRow(null);
    } catch (error) { alert(error.message); }
    finally { busy = false; renderEvent(); }
  }

  $('evSave').onclick = () => {
    const p = draft();
    if (errors(p).length) return;
    change({ ...calendarPlans(), [editing || crypto.randomUUID()]: p });
  };
  $('evReset').onclick = () => selectRow(null);
  $('evAdjust').onclick = () => selectRow(null, { kind: 'adjust', dates: [...evPick] });
  $('evBasis').onclick = () => { showTab('hours'); $('tblPeriods')?.scrollIntoView({ block: 'center' }); };
  $('evUndo').onclick = () => { if (undo?.year === state.school.year) change(undo.before, { expected: undo.next, entry: undo }); };
  $('evRedo').onclick = () => { if (redo?.year === state.school.year) change(redo.next, { expected: redo.before, entry: redo, redo: true }); };
  function remove(next, id) {
    if (id.startsWith('legacy-')) next[id] = { removed: true };
    else delete next[id];
  }
  $('evGroup').onclick = () => {
    const ids = [...$('evList').querySelectorAll('[data-group-event]:checked')].map(i => i.dataset.groupEvent);
    const rows = entries(calDays(), calendarPlans(), state.school.year).filter(([id]) => ids.includes(id));
    if (rows.length < 2) { alert('묶을 행사 두 건 이상을 선택하세요.'); return; }
    const details = p => ({ name: p.name, grades: p.grades, classNumber: p.classNumber || 0, allDay: !!p.allDay, subjects: p.subjects });
    const first = details(rows[0][1]);
    if (rows.some(([, p]) => !samePlans(details(p), first))) { alert('행사명, 대상, 적용 교시·과목이 같은 행사끼리 묶을 수 있습니다.'); return; }
    const next = { ...calendarPlans() };
    rows.forEach(([id]) => remove(next, id));
    next[crypto.randomUUID()] = { ...first, kind: 'event', dates: [...new Set(rows.flatMap(([, p]) => p.dates))].sort() };
    change(next);
  };
  $('evDeleteAll').onclick = () => {
    const rows = entries(calDays(), calendarPlans(), state.school.year).filter(([, p]) => p.kind !== 'adjust');
    if (!rows.length || !confirm('올해 교내행사 ' + rows.length + '건을 모두 삭제할까요?')) return;
    const next = { ...calendarPlans() };
    rows.forEach(([id]) => remove(next, id));
    change(next);
  };
  $('evPrevious').onclick = async () => {
    if (busy || !canEditCal()) return;
    const year = state.school.year;
    let prior = { days: state.days, eventPlans: state.eventPlans?.[year - 1] };
    try {
      if (window.Cloud?.ready) {
        const { F, db } = Cloud.fb;
        const snap = await F.getDoc(F.doc(db, 'calendar', String(year - 1)));
        if (snap.exists()) prior = snap.data();
      }
      if (state.school.year !== year || curTab !== 'event') return;
      const schoolDays = new Set(computeYear().filter(d => d.isSchool).map(d => d.ds));
      const rows = entries(prior.days || {}, prior.eventPlans || {}, year - 1).filter(([, p]) => p.kind !== 'adjust');
      const occupied = new Set(entries(calDays(), calendarPlans(), year).filter(([, p]) => p.kind !== 'adjust').flatMap(([, p]) => p.dates));
      const importing = [];
      rows.forEach(([, p]) => {
        const dates = p.dates.map(ds => (Number(ds.slice(0, 4)) + 1) + ds.slice(4)).filter(ds => schoolDays.has(ds) && !occupied.has(ds));
        if (dates.length && (!p.classNumber || p.classNumber <= state.school.classes[p.grades[0]])) importing.push({ ...p, dates });
      });
      if (!importing.length) { alert('가져올 수 있는 작년 행사가 없습니다.'); return; }
      if (!confirm('작년 행사 ' + importing.length + '건을 올해 같은 월·일로 가져올까요? 휴업일과 이미 행사가 있는 날짜는 제외됩니다.')) return;
      const next = { ...calendarPlans() };
      importing.forEach(p => { next[crypto.randomUUID()] = p; });
      await change(next);
    } catch (error) { alert(error.message); }
  };

  $('tab-event').addEventListener('click', e => {
    const b = e.target.closest('[data-ev]');
    if (b && !busy) {
      const id = b.dataset.id;
      const row = entries(calDays(), calendarPlans(), state.school.year).find(([key]) => key === id);
      if (!row) return;
      if (b.dataset.ev === 'edit') { selectRow(id, row[1]); return; }
      if (confirm((row[1].name || '수업일 설정') + '을 삭제할까요?')) {
        const next = { ...calendarPlans() };
        remove(next, id);
        change(next);
      }
    }
    const ds = e.target.closest('[data-event-date]')?.dataset.eventDate;
    if (!ds || !canEditCal() || busy) return;
    if (e.shiftKey && anchor) {
      const [from, to] = [anchor, ds].sort();
      for (let d = parse(from); fmt(d) <= to; d = addDays(d, 1)) evPick.add(fmt(d));
    } else if (evPick.has(ds)) evPick.delete(ds);
    else evPick.add(ds);
    anchor = ds;
    renderCheck();
    renderHview('evCalendar');
    $('evCalendar').querySelector('[data-event-date="' + ds + '"]')?.focus({ preventScroll: true });
  });
  $('evGrades').onchange = () => { renderPeriods(draft()); renderCheck(); };
  ['evName', 'evClass', 'evAllDay', 'evHours'].forEach(id => $(id).addEventListener('input', renderCheck));
  document.addEventListener('year-change', () => {
    undo = redo = null;
    evPick.clear();
    anchor = editing = null;
    adjusting = false;
    if (curTab === 'event') { renderControls(); renderEvent(); }
  });
})();
