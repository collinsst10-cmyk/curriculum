'use strict';
/* =========================================================
 * 추가 기능: 기초 시간표, 시수 운영 확인, 교과전담
 * (app.js 의 전역 함수·상태를 사용)
 * ========================================================= */
const SHORT = {
  kor: '국어', math: '수학', bar: '바생', sul: '슬생', jul: '즐생', soc: '사회', mor: '도덕', sci: '과학', prac: '실과',
  pe: '체육', mus: '음악', art: '미술', eng: '영어', cha_auto: '자율', cha_club: '동아리', cha_career: '진로', sat: '자율시간',
};
const COLORS = {
  kor: '#fde68a', math: '#bfdbfe', bar: '#fecaca', sul: '#bbf7d0', jul: '#fbcfe8', soc: '#fed7aa', mor: '#e9d5ff', sci: '#a7f3d0',
  prac: '#d9f99d', pe: '#fca5a5', mus: '#c7d2fe', art: '#f5d0fe', eng: '#99f6e4', cha_auto: '#e5e7eb', cha_club: '#d6d3d1', cha_career: '#cbd5e1', sat: '#fef08a',
};
let ttGrade = 1, ttSem = 1, runGrade = 1;

function subjectsOf(g) {
  const list = [];
  bandOf(g).groups.forEach(gr => gr.subs.forEach(s => list.push({ key: s.key, name: s.name })));
  CHA_PARTS.forEach(p => list.push({ key: p.key, name: p.name }));
  if (g >= 3) list.push({ key: 'sat', name: state.satName[g] || '학교자율시간' });
  return list;
}
const periodsOf = (g, dowIdx) => Math.min(MAX_PERIODS, Number(state.school.periods[g][dowIdx]) || 0);
const gradeSwitch = (cur, attr) => GRADES.map(g => `<button class="btn ${g === cur ? 'on' : ''}" ${attr}="${g}">${g}학년</button>`).join('');

/** 시간표 주당 과목별 시간 수 */
function weeklyCount(g, s) {
  const c = {}; const grid = state.timetable[g][s];
  for (let d = 0; d < 5; d++) for (let p = 0; p < periodsOf(g, d); p++) { const k = grid[d][p]; if (k) c[k] = (c[k] || 0) + 1; }
  return c;
}
const ttFilled = g => [1, 2].some(s => Object.keys(weeklyCount(g, s)).length > 0);

/* ---------- 시수 운영 계산: 기초 시간표 × 학사일정 ---------- */
function runCalc(g, classNumber) {
  const res = { sem: { 1: {}, 2: {} }, weeks: {}, blank: { 1: 0, 2: 0 } };
  computeYear().forEach(x => {
    if (!x.isSchool || !x.sem) return;
    const di = x.dow >= 1 && x.dow <= 5 ? x.dow - 1 : 4; // 주말 수업일은 금요일 시간표로
    const timetable = state.timetable[g][x.sem][di];
    const subjects = calendarSubjects(x, g, classNumber);
    const slots = calendarPeriods(x, g, classNumber).map(p => subjects[p] || timetable[p - 1] || '');
    const wk = weekKey(x.d);
    res.weeks[wk] = res.weeks[wk] || {};
    slots.forEach(k => {
      if (!k) { res.blank[x.sem]++; return; }
      res.sem[x.sem][k] = (res.sem[x.sem][k] || 0) + 1;
      res.weeks[wk][k] = (res.weeks[wk][k] || 0) + 1;
    });
  });
  return res;
}

/* =========================================================
 * ⑤ 기초 시간표
 * ========================================================= */
function renderTt() {
  $('ttGradeSwitch').innerHTML = gradeSwitch(ttGrade, 'data-ttgrade');
  $('ttSem').value = ttSem;
  const g = ttGrade, s = ttSem, subs = subjectsOf(g), grid = state.timetable[g][s];
  $('ttTitle').textContent = `${g}학년 ${s}학기 기초 시간표`;
  const maxP = Math.max(...[0, 1, 2, 3, 4].map(d => periodsOf(g, d)));
  let html = `<tr><th>교시</th>${['월', '화', '수', '목', '금'].map(d => `<th>${d}</th>`).join('')}</tr>`;
  for (let p = 0; p < maxP; p++) {
    html += `<tr><th>${typeof periodHead === 'function' ? periodHead(p + 1, '', g) : p + 1}</th>`;
    for (let d = 0; d < 5; d++) {
      if (p >= periodsOf(g, d)) { html += '<td class="off">—</td>'; continue; }
      const k = grid[d][p];
      html += `<td style="background:${COLORS[k] || '#fff'}"><select data-ttd="${d}" data-ttp="${p}"><option value=""></option>${subs.map(x =>
        `<option value="${x.key}" ${x.key === k ? 'selected' : ''}>${SHORT[x.key] || x.name}</option>`).join('')}</select></td>`;
    }
    html += '</tr>';
  }
  $('tblTt').innerHTML = html;

  const st = dayStats(), wc = weeklyCount(g, s), run = runCalc(g), effW = st.sem[s].days / 5;
  let tw = 0, ta = 0, tr = 0;
  $('tblTtCount').innerHTML = `<tr><th>과목</th><th>주당<br>(시간표)</th><th>권장 주당<br><span class="hint">배정÷${effW.toFixed(1)}주</span></th><th>학기 배정</th><th>예상 운영</th><th>차이</th></tr>` +
    subs.map(x => {
      const asg = hv(g, x.key, 's' + s), r = run.sem[s][x.key] || 0, d = r - asg;
      tw += wc[x.key] || 0; ta += asg; tr += r;
      return `<tr><td class="l"><span class="sw" style="background:${COLORS[x.key]}"></span>${x.name}</td><td class="num">${wc[x.key] || ''}</td>
        <td class="num">${asg ? (asg / effW).toFixed(1) : ''}</td><td class="num">${asg || ''}</td><td class="num">${r || ''}</td>
        <td class="num ${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${asg || r ? (d > 0 ? '+' : '') + d : ''}</td></tr>`;
    }).join('') +
    `<tr class="total"><td>계</td><td class="num">${tw}</td><td></td><td class="num">${ta}</td><td class="num">${tr}</td><td class="num">${tr - ta > 0 ? '+' : ''}${tr - ta}</td></tr>` +
    (run.blank[s] ? `<tr><td colspan="6" class="hint">빈 칸으로 운영되지 않는 시간: ${run.blank[s]}시간</td></tr>` : '');
}

/** 배정 시수에 맞춰 시간표 자동 편성 (같은 날 같은 과목은 가능한 피함) */
function autoTimetable(g, s) {
  const st = dayStats(), effW = st.sem[s].days / 5 || 1;
  const subs = subjectsOf(g);
  const raw = subs.map(x => ({ key: x.key, exact: hv(g, x.key, 's' + s) / effW }));
  const rem = {}; raw.forEach(r => { rem[r.key] = Math.floor(r.exact); });
  const slots = [];
  const maxP = Math.max(...[0, 1, 2, 3, 4].map(d => periodsOf(g, d)));
  for (let p = 0; p < maxP; p++) for (let d = 0; d < 5; d++) if (p < periodsOf(g, d)) slots.push([d, p]);
  // 남는 칸은 소수점이 큰 과목부터 1시간씩 추가
  let left = slots.length - Object.values(rem).reduce((a, b) => a + b, 0);
  raw.slice().sort((a, b) => (b.exact % 1) - (a.exact % 1)).forEach(r => { if (left > 0 && r.exact % 1 > 0.2) { rem[r.key]++; left--; } });
  const grid = emptyGrid();
  const used = [0, 1, 2, 3, 4].map(() => new Set());
  slots.forEach(([d, p]) => {
    const cands = Object.keys(rem).filter(k => rem[k] > 0);
    if (!cands.length) return;
    cands.sort((a, b) => (used[d].has(a) - used[d].has(b)) || (rem[b] - rem[a]));
    const k = cands[0];
    grid[d][p] = k; rem[k]--; used[d].add(k);
  });
  state.timetable[g][s] = grid;
}

/* =========================================================
 * ⑥ 시수 운영 확인
 * ========================================================= */
function runRows(g) {
  const run = runCalc(g);
  return subjectsOf(g).map(x => {
    const a1 = hv(g, x.key, 's1'), a2 = hv(g, x.key, 's2'), r1 = run.sem[1][x.key] || 0, r2 = run.sem[2][x.key] || 0;
    return { ...x, a1, a2, r1, r2, d: r1 + r2 - a1 - a2 };
  });
}

function renderRun() {
  $('runGradeSwitch').innerHTML = gradeSwitch(runGrade, 'data-rungrade');
  const g = runGrade, rows = runRows(g), run = runCalc(g);
  $('runTitle').textContent = `${g}학년 시수 운영 확인`;
  const sgn = n => `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
  const tot = k => rows.reduce((t, r) => t + r[k], 0);
  $('tblRunSum').innerHTML = (ttFilled(g) ? '' : `<tr><td colspan="11"><div class="notice">${g}학년 기초 시간표가 비어 있습니다. ⑤ 기초 시간표에서 먼저 편성하세요.</div></td></tr>`) +
    `<tr><th rowspan="2">과목</th><th colspan="3">1학기</th><th colspan="3">2학기</th><th colspan="3">연간</th><th rowspan="2">판정</th></tr>
     <tr><th>배정</th><th>운영</th><th>차이</th><th>배정</th><th>운영</th><th>차이</th><th>배정</th><th>운영</th><th>차이</th></tr>` +
    rows.map(r => `<tr><td class="l"><span class="sw" style="background:${COLORS[r.key]}"></span>${r.name}</td>
      <td class="num">${r.a1}</td><td class="num">${r.r1}</td><td class="num">${sgn(r.r1 - r.a1)}</td>
      <td class="num">${r.a2}</td><td class="num">${r.r2}</td><td class="num">${sgn(r.r2 - r.a2)}</td>
      <td class="num">${r.a1 + r.a2}</td><td class="num"><b>${r.r1 + r.r2}</b></td><td class="num">${sgn(r.d)}</td>
      <td>${r.d === 0 ? '<span class="pill ok">일치</span>' : r.d < 0 ? '<span class="pill err">부족</span>' : '<span class="pill warn">초과</span>'}</td></tr>`).join('') +
    `<tr class="total"><td>계</td><td class="num">${tot('a1')}</td><td class="num">${tot('r1')}</td><td class="num">${sgn(tot('r1') - tot('a1'))}</td>
      <td class="num">${tot('a2')}</td><td class="num">${tot('r2')}</td><td class="num">${sgn(tot('r2') - tot('a2'))}</td>
      <td class="num">${tot('a1') + tot('a2')}</td><td class="num">${tot('r1') + tot('r2')}</td><td class="num">${sgn(tot('d'))}</td><td></td></tr>` +
    (run.blank[1] + run.blank[2] ? `<tr><td colspan="11" class="hint l">시간표 빈 칸으로 운영되지 않는 시간: 1학기 ${run.blank[1]}, 2학기 ${run.blank[2]}</td></tr>` : '');
  $('tblRunWeeks').innerHTML = runWeeksHtml(g, false);
}

function runWeeksHtml(g, forExport) {
  const st = dayStats(), run = runCalc(g), subs = subjectsOf(g);
  const cum = {};
  let html = `<tr><th>주차</th><th>기간</th><th>학기</th><th>수업일</th>${subs.map(x => `<th>${SHORT[x.key] || x.name}</th>`).join('')}<th>계</th></tr>`;
  st.weeks.forEach(w => {
    if (!w.school.length) return;
    const c = run.weeks[w.key] || {};
    let t = 0;
    html += `<tr><td>${w.no}</td><td class="num">${w.label}</td><td>${w.sem}</td><td class="num">${w.school.length}</td>` +
      subs.map(x => { const v = c[x.key] || 0; t += v; cum[x.key] = (cum[x.key] || 0) + v; return `<td class="num">${v || ''}</td>`; }).join('') +
      `<td class="num"><b>${t}</b></td></tr>`;
  });
  const asg = subs.map(x => ann(g, x.key));
  html += `<tr class="total"><td colspan="4">운영 계</td>${subs.map(x => `<td class="num">${cum[x.key] || 0}</td>`).join('')}<td class="num">${Object.values(cum).reduce((a, b) => a + b, 0)}</td></tr>
    <tr class="total"><td colspan="4">배정 시수</td>${asg.map(v => `<td class="num">${v}</td>`).join('')}<td class="num">${asg.reduce((a, b) => a + b, 0)}</td></tr>`;
  return forExport ? `<table border="1">${html}</table>` : html;
}

/* =========================================================
 * ⑦ 교과전담
 * ========================================================= */
function renderJd() {
  const rows = state.jundam;
  $('tblJd').innerHTML = `<tr><th>전담교사</th><th>학년</th><th>과목</th><th>주당 시수<br>(학급당)</th><th>학급 수</th><th>주당 계</th><th>연간(×${STD_WEEKS}주)</th><th>학년 배정 대비</th><th></th></tr>` +
    (rows.length ? '' : '<tr><td colspan="9" class="hint">“+ 배정 추가”를 눌러 전담 과목을 입력하세요.</td></tr>') +
    rows.map((r, i) => {
      const cls = Number(state.school.classes[r.grade]) || 0, wk = (Number(r.hrs) || 0) * cls;
      const perWeekAsg = ann(r.grade, r.subj) / STD_WEEKS;
      const ok = (Number(r.hrs) || 0) <= Math.ceil(perWeekAsg);
      return `<tr><td><input class="wide" data-jd="${i}" data-f="teacher" value="${esc(r.teacher)}" placeholder="예: 영어전담"></td>
        <td><select data-jd="${i}" data-f="grade">${GRADES.map(g => `<option value="${g}" ${g === r.grade ? 'selected' : ''}>${g}학년</option>`).join('')}</select></td>
        <td><select data-jd="${i}" data-f="subj">${subjectsOf(r.grade).map(x => `<option value="${x.key}" ${x.key === r.subj ? 'selected' : ''}>${x.name}</option>`).join('')}</select></td>
        <td><input data-jd="${i}" data-f="hrs" inputmode="numeric" value="${r.hrs}"></td>
        <td class="num">${cls}</td><td class="num"><b>${wk}</b></td><td class="num">${wk * STD_WEEKS}</td>
        <td>${ok ? `<span class="hint">배정 주당 ${perWeekAsg.toFixed(1)}</span>` : `<span class="pill err">배정(${perWeekAsg.toFixed(1)}) 초과</span>`}</td>
        <td><button class="x" data-jddel="${i}">✕</button></td></tr>`;
    }).join('');

  const by = {};
  rows.forEach(r => {
    const t = r.teacher || '(미지정)';
    by[t] = by[t] || { list: [], sum: 0 };
    const wk = (Number(r.hrs) || 0) * (Number(state.school.classes[r.grade]) || 0);
    by[t].list.push(`${r.grade}학년 ${(subjectsOf(r.grade).find(x => x.key === r.subj) || {}).name || ''} ${r.hrs}×${state.school.classes[r.grade]}`);
    by[t].sum += wk;
  });
  $('tblJdTeacher').innerHTML = `<tr><th>전담교사</th><th class="l">담당</th><th>주당 시수</th></tr>` +
    (Object.keys(by).length ? Object.entries(by).map(([t, v]) => `<tr><td>${esc(t)}</td><td class="l">${esc(v.list.join(', '))}</td><td class="num"><b>${v.sum}</b></td></tr>`).join('')
      : '<tr><td colspan="3" class="hint">입력된 전담 배정이 없습니다.</td></tr>');

  $('tblJdGrade').innerHTML = `<tr><th>학년</th><th>주당 총 시수</th><th>전담</th><th>담임</th><th class="l">기준</th></tr>` +
    GRADES.map(g => {
      const useTt = ttFilled(g);
      const total = useTt ? Object.values(weeklyCount(g, 1)).reduce((a, b) => a + b, 0) : Math.round(gradeTotal(g) / STD_WEEKS);
      const jd = rows.filter(r => r.grade === g).reduce((t, r) => t + (Number(r.hrs) || 0), 0);
      return `<tr><td>${g}학년</td><td class="num">${total}</td><td class="num">${jd}</td><td class="num"><b>${total - jd}</b></td>
        <td class="l hint">${useTt ? '1학기 기초 시간표' : '연간 배정 ÷ 34주'}</td></tr>`;
    }).join('');
}

/* =========================================================
 * 검토 항목 추가
 * ========================================================= */
const _collectIssues = collectIssues;
// '시간표 편성' 메뉴를 없애서 기초 시간표 기반 점검은 하지 않음 (기초 시간표를 쓰지 않으므로 늘 '미편성' 경고가 남음)
collectIssues = function () {
  return _collectIssues();
};

/* =========================================================
 * 등록
 * ========================================================= */
RENDER.tt = renderTt;
RENDER.run = renderRun;
RENDER.jd = renderJd;

$('ttGradeSwitch').addEventListener('click', e => { const b = e.target.closest('[data-ttgrade]'); if (b) { ttGrade = Number(b.dataset.ttgrade); renderTt(); } });
$('ttSem').addEventListener('change', e => { ttSem = Number(e.target.value); renderTt(); });
$('tblTt').addEventListener('change', e => {
  const t = e.target; if (!t.dataset.ttd) return;
  state.timetable[ttGrade][ttSem][t.dataset.ttd][t.dataset.ttp] = t.value; save(); renderTt();
});
$('btnTtAuto').addEventListener('click', () => {
  if (ttFilled(ttGrade) && Object.keys(weeklyCount(ttGrade, ttSem)).length && !confirm(`${ttGrade}학년 ${ttSem}학기 시간표를 다시 편성합니다. 계속할까요?`)) return;
  autoTimetable(ttGrade, ttSem); save(); renderTt();
});
$('btnTtCopy').addEventListener('click', () => {
  const o = ttSem === 1 ? 2 : 1;
  if (!confirm(`${ttGrade}학년 ${ttSem}학기 시간표를 ${o}학기에 복사합니다. 계속할까요?`)) return;
  state.timetable[ttGrade][o] = state.timetable[ttGrade][ttSem].map(r => r.slice()); save(); renderTt();
});
$('btnTtClear').addEventListener('click', () => {
  if (!confirm(`${ttGrade}학년 ${ttSem}학기 시간표를 비웁니다. 계속할까요?`)) return;
  state.timetable[ttGrade][ttSem] = emptyGrid(); save(); renderTt();
});

$('runGradeSwitch').addEventListener('click', e => { const b = e.target.closest('[data-rungrade]'); if (b) { runGrade = Number(b.dataset.rungrade); renderRun(); } });
$('btnRunApply').addEventListener('click', () => {
  const g = runGrade;
  if (!ttFilled(g)) { alert('기초 시간표를 먼저 편성하세요.'); return; }
  if (!confirm(`${g}학년 ⑤ 시수 편제 값을 시간표로 계산한 운영 시수로 바꿉니다. 이후 ⑧ 편제표·검토에서 기준 충족 여부를 확인하세요. 계속할까요?`)) return;
  const run = runCalc(g);
  subjectsOf(g).forEach(x => { state.hours[g][x.key] = { s1: run.sem[1][x.key] || 0, s2: run.sem[2][x.key] || 0 }; });
  save(); renderRun();
});
$('btnExportRun').addEventListener('click', () => {
  const html = GRADES.map(g => `<h3>${g}학년 주차별 시수</h3>${runWeeksHtml(g, true)}<br>`).join('');
  downloadXls(`${fileBase()}_연간시수표.xls`, `<h2>${esc(state.school.name)} ${state.school.year}학년도 연간 시수표</h2>${html}`);
});

$('btnJdAdd').addEventListener('click', () => {
  const g = state.jundam.length ? state.jundam[state.jundam.length - 1].grade : 3;
  state.jundam.push({ teacher: '', grade: g, subj: subjectsOf(g)[0].key, hrs: 2 }); save(); renderJd();
});
$('tblJd').addEventListener('input', e => {
  const t = e.target; if (t.dataset.jd === undefined) return;
  const r = state.jundam[t.dataset.jd];
  if (t.dataset.f === 'hrs') r.hrs = toNum(t.value);
  else if (t.dataset.f === 'teacher') r.teacher = t.value;
  else if (t.dataset.f === 'grade') { r.grade = Number(t.value); if (!subjectsOf(r.grade).some(x => x.key === r.subj)) r.subj = subjectsOf(r.grade)[0].key; }
  else if (t.dataset.f === 'subj') r.subj = t.value;
  save(); rerenderKeepFocus(renderJd);
});
$('tblJd').addEventListener('click', e => {
  const b = e.target.closest('[data-jddel]'); if (!b) return;
  state.jundam.splice(Number(b.dataset.jddel), 1); save(); renderJd();
});
