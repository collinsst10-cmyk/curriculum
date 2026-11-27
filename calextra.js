/* =========================================================
 * 교육과정 편성 › ③ 학사일정 편성 — 스쿨마스터 '학사일정·휴업일·공휴일 설정'의 기능
 *  - 입학일·졸업일(6학년), 겨울방학 전에 종업식
 *  - 달력 표시: 입학일·졸업일, 종업일, 2학기 시작일, 방학 첫날·끝날 + 끌어서 날짜 옮기기
 *  - 현황판: 학사 일정 · 수업일수(학년별) · 수업시수 현황(확보−계획) · 요일별 수업일수(1~5학년/6학년)
 *           방학 일수 · 학기당 배정 주 · 재량휴업일 · 공휴일 · 행사 · 단축-연장 수업일
 *  - 요일별 기준시수(state.school.periods), 단축-연장 수업(state.shortDays)
 *  수업 가능 시수(capacity)는 졸업일·단축-연장을 반영하도록 바꿈 → 시수 편제의 '수업 가능 시수'도 같은 값
 * ========================================================= */
(function () {
  'use strict';
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let tool = '';                 // '' | 'periods' | 'short'
  const ro = () => isTeacherView() || !(typeof canEditCal === 'function' ? canEditCal() : true);
  const semNow = () => semFull(calSemRaw());
  const md = ds => { const d = parse(ds); return `${d.getMonth() + 1}.${d.getDate()}`; };
  const mdw = ds => { const d = parse(ds); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`; };
  const between = (a, b) => (a && b ? Math.round((parse(b) - parse(a)) / 86400000) + 1 : 0);
  const shortDays = () => (state.shortDays = Array.isArray(state.shortDays) ? state.shortDays : []);

  /* ---------- 학년별 수업일 · 수업 가능 시수 ---------- */
  /** 학년 g 의 학기 s 수업일 목록 (6학년은 졸업일까지) */
  function schoolDays(g, s) {
    const grad = semNow().graduation;
    return computeYear().filter(x => x.sem === s && (g !== 6 || !grad || x.ds <= grad));
  }
  const stdPeriods = (g, dow) => { const p = state.school.periods[g] || []; return Number(dow >= 1 && dow <= 5 ? p[dow - 1] : p[4]) || 0; };
  /** 단축·연장 수업으로 늘거나 준 시수 */
  function shortDelta(g, s) {
    const days = new Map(schoolDays(g, s).map(x => [x.ds, x]));
    return shortDays().reduce((t, r) => {
      const x = days.get(r.date);
      if (!x || (r.grades && r.grades.length && !r.grades.includes(g))) return t;
      return t + (Number(r.periods) || 0) - stdPeriods(g, x.dow);
    }, 0);
  }
  function capOf(g, s) {
    return schoolDays(g, s).reduce((t, x) => t + stdPeriods(g, x.dow), 0) + shortDelta(g, s);
  }
  // 시수 편제 등 다른 화면의 '수업 가능 시수'도 같은 계산을 쓰게 함
  capacity = function (g, s) { return capOf(Number(g), Number(s)); };

  /* ---------- 방학 · 주 ---------- */
  function vacations() {
    const s = semNow(), y = state.school.year, febEnd = fmt(new Date(y + 1, 2, 0));
    const summer = between(s.summer[0], s.summer[1]);
    // 겨울방학 전에 종업식: 겨울방학 = 시작 ~ 2월 말, 학년말방학 없음
    // 2월 등교: 겨울방학 = 시작 ~ 끝, 학년말방학 = 종업 다음 날 ~ 2월 말
    const cbw = s.s2End < s.winter[0];
    const winter = cbw ? between(s.winter[0], febEnd) : between(s.winter[0], s.winter[1] > febEnd ? febEnd : s.winter[1]);
    const yearEnd = cbw ? 0 : Math.max(0, between(fmt(addDays(parse(s.s2End), 1)), febEnd));
    // 단기방학: 학기 중 '방학'으로 지정한 날
    const short = n => computeYear().filter(x => x.type === 'vacation' && semOf(x.ds) === n).length;
    const s1 = short(1), s2 = short(2);
    return { summer, winter, yearEnd, s1, s2, total: summer + winter + yearEnd + s1 + s2 };
  }

  /* ---------- 달력 표시 · 끌어 옮기기 ---------- */
  function keyDates() {
    const s = semNow();
    return [
      ['s1Start', s.s1Start, 'kd-s1', '1학기 시작일'], ['entrance', s.entrance, 'kd-in', '입학일'],
      ['summerStart', s.summer[0], 'kd-vac', '여름방학 시작'], ['summerEnd', s.summer[1], 'kd-vac', '여름방학 마지막'],
      ['s2Start', s.s2Start, 'kd-s2', '2학기 시작일'], ['winterStart', s.winter[0], 'kd-vac', '겨울방학 시작'],
      ['winterEnd', s.winter[1], 'kd-vac', '겨울방학 마지막'], ['graduation', s.graduation, 'kd-in', '졸업일'], ['s2End', s.s2End, 'kd-end', '종업식'],
    ].filter(k => k[1]);
  }
  function decorate() {
    const grid = $('calGrid'); if (!grid) return;
    keyDates().forEach(([key, ds, cls, label]) => {
      const c = grid.querySelector(`.day[data-ds="${ds}"]`); if (!c) return;
      c.classList.add(cls, 'kd'); c.dataset.kd = key; c.title = `${label} · 끌어서 다른 날로 옮길 수 있습니다\n` + (c.title || '');
    });
  }
  /** 핵심 날짜 바꾸기 (2학기 시작일 = 여름방학 마지막 다음 날) */
  async function moveKey(key, ds) {
    const s = semNow(), v = { s1Start: s.s1Start, summer: [...s.summer], winter: [...s.winter], s2End: s.s2End, entrance: s.entrance || '', graduation: s.graduation || '' };
    if (key === 's1Start') v.s1Start = ds;
    else if (key === 'summerStart') v.summer[0] = ds;
    else if (key === 'summerEnd') v.summer[1] = ds;
    else if (key === 's2Start') v.summer[1] = fmt(addDays(parse(ds), -1));
    else if (key === 'winterStart') v.winter[0] = ds;
    else if (key === 'winterEnd') v.winter[1] = ds;
    else if (key === 's2End') v.s2End = ds;
    else v[key] = ds;
    if (v.summer[0] > v.summer[1] || v.winter[0] > v.winter[1] || v.s1Start >= v.summer[0]) { alert('날짜 순서가 맞지 않습니다. (예: 방학 시작이 끝보다 늦음)'); return; }
    try { await writeSem(semFromInputs(v)); _yearCache = null; RENDER.cal(); }
    catch (e) { alert('저장 실패: ' + e.message); }
  }
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest('#calGrid .day[data-kd]');
    if (!c || ro() || e.button !== 0) return;
    drag = { key: c.dataset.kd, from: c.dataset.ds, over: null };
  });
  document.addEventListener('pointerover', e => {
    if (!drag) return;
    const c = e.target.closest('#calGrid .day[data-ds]');
    document.querySelectorAll('#calGrid .drop').forEach(x => x.classList.remove('drop'));
    if (c && c.dataset.ds !== drag.from) { c.classList.add('drop'); drag.over = c.dataset.ds; } else drag.over = null;
    if (drag.over) document.body.classList.add('kd-dragging');
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null; document.body.classList.remove('kd-dragging');
    document.querySelectorAll('#calGrid .drop').forEach(x => x.classList.remove('drop'));
    if (d.over && d.over !== d.from) {
      const label = (keyDates().find(k => k[0] === d.key) || [])[3] || '날짜';
      if (confirm(`${label}을(를) ${mdw(d.from)} → ${mdw(d.over)}(으)로 옮길까요?`)) moveKey(d.key, d.over);
    }
  });

  /* ---------- 겨울방학 전에 종업식 ---------- */
  async function setClosingBeforeWinter(on) {
    const s = semNow(), y = state.school.year, v = { s1Start: s.s1Start, summer: [...s.summer], winter: [...s.winter], s2End: s.s2End };
    if (on) {
      // 종업 = 겨울방학 전 마지막 수업일, 겨울방학은 2월 말까지(2월 등교 없음)
      let d = addDays(parse(v.winter[0]), -1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, -1);
      v.s2End = fmt(d); v.winter[1] = fmt(new Date(y + 1, 2, 0));
    } else {
      // 2월 등교: 겨울방학은 1월 말까지, 종업은 2월 둘째 금요일(고칠 수 있음)
      v.winter[1] = fmt(new Date(y + 1, 0, 31));
      let d = new Date(y + 1, 1, 1); let fri = 0;
      while (true) { if (d.getDay() === 5 && ++fri === 2) break; d = addDays(d, 1); }
      v.s2End = fmt(d);
    }
    try { await writeSem(semFromInputs(v)); _yearCache = null; RENDER.cal(); } catch (e) { alert('저장 실패: ' + e.message); }
  }

  /* ---------- 현황판 ---------- */
  function board() {
    const s = semNow(), st = dayStats(), vac = vacations(), cbw = s.s2End < s.winter[0];
    const g6 = [1, 2].map(n => schoolDays(6, n));
    const daysOf = (g, n) => g === 6 ? g6[n - 1].length : st.sem[n].days;
    const wdOf = (list) => { const w = [0, 0, 0, 0, 0, 0, 0]; list.forEach(x => w[x.dow]++); return w; };
    const wd15 = [1, 2].map(n => wdOf(schoolDays(1, n))), wd6 = [1, 2].map(n => wdOf(g6[n - 1]));
    const kd = (dot, label, ds) => `<li><i class="${dot}"></i>${label}: <b>${ds ? md(ds) : '<span class="hint">미정</span>'}</b></li>`;
    const gradeRow = (label, fn, cls = '') => `<tr class="${cls}"><th>${label}</th>${GRADES.map(g => { const v = fn(g); return `<td class="${typeof v === 'number' && v < 0 ? 'neg' : typeof v === 'number' && v > 0 && cls.includes('diff') ? 'pos' : ''}">${typeof v === 'number' && cls.includes('diff') && v > 0 ? '+' + v : v}</td>`; }).join('')}</tr>`;
    const wdTable = (title, w) => `<div class="hb-card"><h4>${title}</h4><table class="hb-t"><thead><tr><th></th>${['월', '화', '수', '목', '금', '토'].map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>
      ${[0, 1].map(i => `<tr><th>${i + 1}학기</th>${[1, 2, 3, 4, 5, 6].map(d => `<td>${w[i][d]}</td>`).join('')}</tr>`).join('')}
      <tr class="sum"><th>합계</th>${[1, 2, 3, 4, 5, 6].map(d => `<td>${w[0][d] + w[1][d]}</td>`).join('')}</tr></tbody></table></div>`;
    const days = computeYear();
    const closures = days.filter(x => x.type === 'closure');
    const holidays = days.filter(x => x.type === 'holiday');
    const evs = days.filter(x => x.name && (x.type === 'event' || x.type === 'school'));
    const shorts = shortDays().slice().sort((a, b) => a.date.localeCompare(b.date));
    const list = (title, head, rows, foot = '') => `<div class="hb-card hb-list"><h4>${title}</h4><div class="hb-scroll"><table class="hb-t l"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="hint">없음</td></tr>`}</tbody></table></div>${foot}</div>`;
    return `<div class="hb-tools">
        <button type="button" class="btn hb-b1${tool === 'periods' ? ' on' : ''}" data-hb="periods">요일별 기준시수</button>
        <button type="button" class="btn hb-b2${tool === 'short' ? ' on' : ''}" data-hb="short">단축-연장수업</button>
        <label class="hb-cbw"><input type="checkbox" data-hb-cbw ${cbw ? 'checked' : ''}> 겨울방학 전에 종업식</label>
        <span class="hb-dates"><label>입학일 <input type="date" data-hb-date="entrance" value="${s.entrance || ''}"></label>
          <label>졸업일 <input type="date" data-hb-date="graduation" value="${s.graduation || ''}"></label></span>
      </div>
      ${tool === 'periods' ? periodsTool() : tool === 'short' ? shortTool() : ''}
      <div class="hb-grid">
        <div class="hb-card hb-key"><h4>학사 일정</h4><ul>
          ${kd('c-s1', '1학기 시작일', s.s1Start)}${kd('c-in', '입학일', s.entrance)}${kd('c-vac', '여름방학 시작일', s.summer[0])}${kd('c-vac', '여름방학 마지막일', s.summer[1])}
          ${kd('c-s2', '2학기 시작일', s.s2Start)}${kd('c-vac', '겨울방학 시작일', s.winter[0])}${kd('c-vac', '겨울방학 마지막일', cbw ? '' : s.winter[1])}
          ${kd('c-in', '졸업일', s.graduation)}${kd('c-end', '종업식 하는 날', s.s2End)}</ul></div>
        <div class="hb-card"><h4>수업일수</h4><table class="hb-t"><thead><tr><th>학년</th>${GRADES.map(g => `<th>${g}</th>`).join('')}</tr></thead><tbody>
          ${gradeRow('1학기', g => daysOf(g, 1))}${gradeRow('2학기', g => daysOf(g, 2))}${gradeRow('합계', g => daysOf(g, 1) + daysOf(g, 2), 'sum')}</tbody></table>
          <p class="hb-note">${s.graduation ? `6학년은 졸업일(${md(s.graduation)})까지 셉니다.` : '졸업일을 정하면 6학년은 졸업일까지 셉니다.'}</p></div>
        <div class="hb-card"><h4>수업시수 현황 <small>(확보 − 계획)</small></h4><table class="hb-t"><thead><tr><th>학년</th>${GRADES.map(g => `<th>${g}</th>`).join('')}</tr></thead><tbody>
          ${gradeRow('1학기', g => capOf(g, 1) - gradeSem(g, 's1'), 'diff')}${gradeRow('2학기', g => capOf(g, 2) - gradeSem(g, 's2'), 'diff')}
          ${gradeRow('합계', g => capOf(g, 1) + capOf(g, 2) - gradeTotal(g), 'diff sum')}</tbody></table>
          <p class="hb-note">확보 = 수업일 × 요일별 기준시수(단축·연장 반영), 계획 = 시수 편제</p></div>
        ${wdTable('요일별 수업일수 · 1~5학년', wd15)}
        ${wdTable('요일별 수업일수 · 6학년', wd6)}
        <div class="hb-card"><h4>방학 일수</h4><ul class="hb-kv">
          <li>여름 방학<b>${vac.summer}</b></li><li>겨울 방학<b>${vac.winter}</b></li><li>학년말 방학<b>${vac.yearEnd}</b></li>
          <li>1학기 단기방학<b>${vac.s1}</b></li><li>2학기 단기방학<b>${vac.s2}</b></li><li class="sum">방학일수 총 합계<b>${vac.total}</b></li></ul></div>
        <div class="hb-card"><h4>학기당 배정 주</h4><ul class="hb-kv"><li>1학기<b>${st.sem[1].weeks}주</b></li><li>2학기<b>${st.sem[2].weeks}주</b></li><li class="sum">합계<b>${st.sem[1].weeks + st.sem[2].weeks}주</b></li></ul></div>
      </div>
      <div class="hb-lists">
        ${list('재량휴업일', ['날짜', '재량휴업일', '해당 학년'], closures.map(x => `<tr><td>${md(x.ds)}</td><td>${esc(x.name || '재량휴업일')}</td><td>1,2,3,4,5,6</td></tr>`), `<p class="hb-note">재량휴업일 합계: <b>${closures.length}일</b></p>`)}
        ${list('공휴일', ['날짜', '공휴일'], holidays.map(x => `<tr><td>${md(x.ds)}</td><td>${esc(x.name || '공휴일')}</td></tr>`))}
        ${list('행사', ['날짜', '행사명'], evs.map(x => `<tr><td>${md(x.ds)}</td><td>${esc(x.name)}</td></tr>`))}
        ${list('단축-연장 수업일', ['날짜', '교시', '해당 학년'], shorts.map(r => `<tr><td>${mdw(r.date)}</td><td>${r.periods}교시</td><td>${r.grades && r.grades.length ? r.grades.join(',') : '1,2,3,4,5,6'}</td></tr>`))}
      </div>`;
  }

  function periodsTool() {
    return `<div class="hb-tool"><div class="hb-tool-h"><b>요일별 기준시수</b><span class="hint">학년별로 요일마다 몇 교시까지 하는지 정합니다. 수업 가능 시수 계산에 쓰입니다(시수 편제와 같은 값).</span><button type="button" class="x" data-hb="close">✕</button></div>
      <table class="hb-t"><thead><tr><th>학년</th>${['월', '화', '수', '목', '금'].map(d => `<th>${d}</th>`).join('')}<th>주당</th></tr></thead><tbody>
      ${GRADES.map(g => `<tr><th>${g}학년</th>${[0, 1, 2, 3, 4].map(i => `<td><input type="number" min="0" max="8" data-hbp="${g}" data-i="${i}" value="${state.school.periods[g][i]}"></td>`).join('')}
        <td><b>${state.school.periods[g].reduce((t, v) => t + (Number(v) || 0), 0)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }
  function shortTool() {
    const rows = shortDays().slice().sort((a, b) => a.date.localeCompare(b.date));
    return `<div class="hb-tool"><div class="hb-tool-h"><b>단축-연장 수업</b><span class="hint">평소와 다른 교시 수로 수업하는 날을 넣으면 수업 가능 시수에 반영됩니다.</span><button type="button" class="x" data-hb="close">✕</button></div>
      <div class="hb-short-form"><label>날짜 <input type="date" id="hbSDate"></label><label>교시 수 <input type="number" id="hbSPer" min="0" max="10" value="4"></label>
        <span class="hb-gs"><label class="tg"><input type="checkbox" id="hbSAll" checked>전학년</label>${GRADES.map(g => `<label class="tg"><input type="checkbox" class="hbSG" value="${g}">${g}학년</label>`).join('')}</span>
        <button type="button" class="btn small primary" data-hb="short-add">추가</button></div>
      <table class="hb-t l"><thead><tr><th>날짜</th><th>교시</th><th>해당 학년</th><th>평소와 차이</th><th></th></tr></thead><tbody>
      ${rows.map(r => { const dow = parse(r.date).getDay(), gs = r.grades && r.grades.length ? r.grades : GRADES;
        const diff = gs.map(g => (Number(r.periods) || 0) - stdPeriods(g, dow)); const dmin = Math.min(...diff), dmax = Math.max(...diff);
        return `<tr><td>${mdw(r.date)}</td><td>${r.periods}교시</td><td>${gs.join(',')}</td><td>${dmin === dmax ? (dmin > 0 ? '+' : '') + dmin : `${dmin}~${dmax}`}</td>
          <td><button type="button" class="btn small" data-hb-sdel="${r.id}">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="hint">아직 없습니다</td></tr>'}</tbody></table></div>`;
  }

  function renderBoard() {
    const box = $('hbBoard'); if (!box) return;
    box.innerHTML = board();
  }

  function renderKeyDates() {
    const s = semFull(calSem());
    const date = ds => ds ? md(ds) : '미정';
    const range = ([start, end]) => start && end ? date(start) + ' ~ ' + date(end) : '미정';
    const rows = [
      ['1학기 시작', date(s.s1Start)],
      ['입학일', date(s.entrance)],
      ['여름방학', range(s.summer)],
      ['2학기 시작', date(s.s2Start)],
      ['겨울방학', range(s.winter)],
      ['졸업일', date(s.graduation)],
      ['종업일', date(s.s2End)],
    ];
    $('calKeyDates').innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', async e => {
    if (curTab !== 'cal') return;
    const a = e.target.closest('[data-hb]')?.dataset.hb;
    if (a === 'periods' || a === 'short') { tool = tool === a ? '' : a; renderBoard(); return; }
    if (a === 'close') { tool = ''; renderBoard(); return; }
    if (ro()) return;
    if (a === 'short-add') {
      const date = $('hbSDate').value, per = Number($('hbSPer').value);
      if (!date) { alert('날짜를 고르세요.'); return; }
      const all = $('hbSAll').checked, gs = all ? [] : [...document.querySelectorAll('.hbSG:checked')].map(x => Number(x.value));
      if (!all && !gs.length) { alert('해당 학년을 고르세요.'); return; }
      shortDays().push({ id: Date.now().toString(36), date, periods: per, grades: gs });
      save(); renderBoard(); return;
    }
    const del = e.target.closest('[data-hb-sdel]');
    if (del) { state.shortDays = shortDays().filter(r => r.id !== del.dataset.hbSdel); save(); renderBoard(); }
  });
  document.addEventListener('change', async e => {
    if (curTab !== 'cal') return;
    const t = e.target;
    if (t.id === 'hbSAll') { document.querySelectorAll('.hbSG').forEach(x => { x.checked = false; }); return; }
    if (t.classList.contains('hbSG')) { $('hbSAll').checked = !document.querySelector('.hbSG:checked'); return; }
    if (ro()) { renderBoard(); return; }
    if (t.dataset.hbCbw !== undefined) {
      const msg = t.checked ? '종업식을 겨울방학 전에 하고, 겨울방학을 2월 말까지로 할까요? (2월 등교 없음)' : '2월에 등교하도록 바꿀까요? (겨울방학 1월 말까지, 종업은 2월 둘째 금요일 — 고칠 수 있습니다)';
      if (!confirm(msg)) { t.checked = !t.checked; return; }
      setClosingBeforeWinter(t.checked); return;
    }
    if (t.dataset.hbDate) {
      const s = semNow(), v = { s1Start: s.s1Start, summer: [...s.summer], winter: [...s.winter], s2End: s.s2End, entrance: s.entrance || '', graduation: s.graduation || '' };
      v[t.dataset.hbDate] = t.value;
      try { await writeSem(semFromInputs(v)); _yearCache = null; RENDER.cal(); } catch (err) { alert('저장 실패: ' + err.message); }
      return;
    }
    if (t.dataset.hbp) { state.school.periods[t.dataset.hbp][Number(t.dataset.i)] = Math.max(0, Math.min(8, Number(t.value) || 0)); save(); renderBoard(); }
  });

  // 학사일정 편성 화면을 그릴 때마다 표시·현황판도 함께
  const base = renderCal;
  renderCal = function () { base(); decorate(); renderKeyDates(); renderBoard(); };
  RENDER.cal = renderCal;
})();
