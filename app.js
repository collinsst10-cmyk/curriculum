'use strict';
/* =========================================================
 * 초등 학교교육과정 편성 도우미 - 메인 로직
 * ========================================================= */
const STORE_KEY = 'school-curriculum-planner-v1';
const DEFAULT_SCHOOL = '용원초등학교';
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const GRADES = [1, 2, 3, 4, 5, 6];
const TYPE_LABEL = { school: '수업일', event: '행사', holiday: '공휴일', closure: '재량휴업일', vacation: '방학', weekend: '주말' };

/* ---------- 날짜 유틸 ---------- */
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtK = s => { const d = parse(s); return `${d.getMonth() + 1}.${d.getDate()}.(${WD[d.getDay()]})`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const bandOf = g => BANDS[g <= 2 ? 0 : g <= 4 ? 1 : 2];

/* ---------- 상태 ---------- */
let state;
let calSel = { start: null, end: null };
let curGrade = 1;
let _yearCache = null;

function holidayList(y) { return PRESET_HOLIDAYS[y] || fixedHolidays(y); }
function holidayMap(y) {
  const m = {};
  holidayList(y).forEach(([ds, name, check]) => { m[ds] = { name, check: !!check }; });
  return m;
}

function defaultSemesters(y) {
  const hm = holidayMap(y);
  const isOff = d => d.getDay() === 0 || d.getDay() === 6 || hm[fmt(d)];
  let s1s = new Date(y, 2, 2); while (isOff(s1s)) s1s = addDays(s1s, 1);
  let s1e = new Date(y, 6, 24); while (s1e.getDay() !== 5) s1e = addDays(s1e, -1);
  let s2s = new Date(y, 7, 16); while (s2s.getDay() !== 1) s2s = addDays(s2s, 1);
  while (isOff(s2s)) s2s = addDays(s2s, 1);
  let s2e = new Date(y + 1, 0, 5); while (s2e.getDay() !== 5) s2e = addDays(s2e, 1);
  return { s1Start: fmt(s1s), s1End: fmt(s1e), s2Start: fmt(s2s), s2End: fmt(s2e) };
}

function defaultPeriods(g) {
  return g <= 2 ? [5, 4, 5, 4, 5] : g <= 4 ? [6, 5, 5, 5, 5] : [6, 6, 6, 5, 6];
}

function split(v) { return { s1: Math.ceil(v / 2), s2: Math.floor(v / 2) }; }

function defaultHours(g) {
  const b = bandOf(g); const h = {};
  b.groups.forEach(gr => gr.subs.forEach(s => { h[s.key] = split(s.def); }));
  CHA_PARTS.forEach(p => { h[p.key] = split(b.chaDef[p.key]); });
  h.sat = { s1: 0, s2: 0 };
  return h;
}

function defaultState() {
  const now = new Date();
  // 11월 이후라면 다음 학년도를 기본으로
  const y = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  const s = {
    version: 1,
    school: { name: DEFAULT_SCHOOL, year: y, classes: {}, periods: {} },
    sem: defaultSemesters(y),
    days: {},
    hours: {},
    satName: {},
    timetable: {},
    jundam: [],
  };
  GRADES.forEach(g => {
    s.school.classes[g] = 2;
    s.school.periods[g] = defaultPeriods(g);
    s.hours[g] = defaultHours(g);
    s.satName[g] = '';
    s.timetable[g] = { 1: emptyGrid(), 2: emptyGrid() };
  });
  return s;
}
const MAX_PERIODS = 8;
function emptyGrid() { return Array.from({ length: 5 }, () => Array(MAX_PERIODS).fill('')); }

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { state = normalize(JSON.parse(raw)); return; }
  } catch (e) { console.warn(e); }
  state = defaultState();
}

/** 불러온 데이터에 빠진 항목을 기본값으로 보충 */
function normalize(s) {
  const d = defaultState();
  s.school = Object.assign(d.school, s.school || {});
  if (!s.school.name) s.school.name = DEFAULT_SCHOOL;
  s.sem = Object.assign(defaultSemesters(s.school.year), s.sem || {});
  s.days = s.days || {};
  s.hours = s.hours || {};
  s.satName = s.satName || {};
  s.timetable = s.timetable || {};
  s.jundam = Array.isArray(s.jundam) ? s.jundam : [];
  GRADES.forEach(g => {
    s.timetable[g] = s.timetable[g] || {};
    [1, 2].forEach(k => { if (!Array.isArray(s.timetable[g][k])) s.timetable[g][k] = emptyGrid(); });
    s.school.classes[g] ??= 2;
    s.school.periods[g] ??= defaultPeriods(g);
    s.hours[g] = Object.assign(defaultHours(g), s.hours[g] || {});
    s.satName[g] ??= '';
  });
  return s;
}

/* =========================================================
 * 역할별 화면: 관리자(편성·편집) / 선생님(게시된 교육과정·학사일정 조회 + 교육활동 신청)
 * ========================================================= */
const isTeacherView = () => !!(window.App && App.role && App.role() === 'teacher');
// 선생님에게는 조회만 되는 화면
const RO_SECTIONS = ['tab-cal', 'tab-days', 'tab-info', 'tab-hours', 'tab-table', 'tab-tt', 'tab-run', 'tab-jd'];
function applyRoleView() {
  const t = isTeacherView();
  document.body.classList.toggle('role-teacher', t);
  document.querySelectorAll('[data-tlabel]').forEach(b => {
    if (!b.dataset.alabel) b.dataset.alabel = b.textContent;
    b.textContent = t ? b.dataset.tlabel : b.dataset.alabel;
  });
  RO_SECTIONS.forEach(id => {
    const sec = $(id); if (!sec) return;
    sec.querySelectorAll('input, select, textarea, button').forEach(el => {
      if (el.closest('.ro-ok')) return;
      if (t) { if (!el.disabled) { el.disabled = true; el.dataset.ro = '1'; } }
      else if (el.dataset.ro) { el.disabled = false; delete el.dataset.ro; }
    });
  });
}
// 화면이 다시 그려질 때마다(학년 전환 등) 조회 전용 상태를 유지
new MutationObserver(() => { if (isTeacherView()) requestAnimationFrame(applyRoleView); })
  .observe(document.querySelector('main'), { childList: true, subtree: true });

let saveTimer;
function save() {
  if (isTeacherView()) { updateTitles(); return; }   // 선생님 화면은 조회 전용: 저장하지 않음
  _yearCache = null;
  $('saveState').textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    $('saveState').textContent = '이 PC에 저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    if (window.App && App.onSave) App.onSave();   // 클라우드 동기화(cloud.js)
  }, 300);
  updateTitles();
}

function updateTitles() {
  const t = `${state.school.name || '학교명 미입력'} · ${state.school.year}학년도`;
  $('hdrSchool').textContent = t;
  $('printTitle').textContent = `${state.school.year}학년도 교육과정`;
  document.title = `${state.school.name || '초등학교'} 교육과정 편성 도우미`;
}
/** 상단 머리글 높이에 맞춰 하위 메뉴 고정 위치 조정 */
function fitStickyTabs() { document.documentElement.style.setProperty('--hdr', document.querySelector('.topbar').offsetHeight + 'px'); }
window.addEventListener('resize', fitStickyTabs);
document.addEventListener('DOMContentLoaded', fitStickyTabs);

/** 다른 모듈(cloud.js)이 쓰는 상태 접근 API */
window.App = {
  onSave: null,
  getState: () => state,
  /** 외부(클라우드)에서 받은 데이터로 교체. onSave 를 호출하지 않음 */
  setState(data) {
    state = normalize(data);
    _yearCache = null;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    updateTitles();
    rerenderKeepFocus(() => RENDER[curTab]());
  },
};

/* =========================================================
 * 학사일정 저장 위치
 *  - 승인된 계정으로 로그인 + 학교 공용 학사일정이 있으면: 클라우드(haksa.js, 관리자만 수정)
 *  - 그 외: 이 PC(state.days / state.sem)
 * ========================================================= */
const haksaShared = () => !!(window.Haksa && Haksa.active);
const calDays = () => haksaShared() ? Haksa.days : state.days;
const calSem = () => haksaShared() && Haksa.sem ? Haksa.sem : state.sem;
const canEditCal = () => !haksaShared() || Haksa.canEdit();
/** 날짜별 일정 쓰기. patch = { 'YYYY-MM-DD': 항목 | null(삭제) } */
async function writeDays(patch) {
  if (haksaShared()) return Haksa.writeDays(patch);
  Object.entries(patch).forEach(([ds, e]) => { if (e) state.days[ds] = e; else delete state.days[ds]; });
  save();
}
async function writeSem(sem) {
  if (haksaShared()) return Haksa.writeSem(sem);
  state.sem = sem; save();
}

/* =========================================================
 * 학사일정 계산
 * ========================================================= */
function semOf(ds) {
  const { s1Start, s1End, s2Start, s2End } = calSem();
  if (ds >= s1Start && ds <= s1End) return 1;
  if (ds >= s2Start && ds <= s2End) return 2;
  return 0;
}

/** 학년도 전체 날짜 정보 (3/1 ~ 다음해 2월 말) */
function computeYear() {
  if (_yearCache) return _yearCache;
  const y = state.school.year;
  const hm = holidayMap(y);
  const out = [];
  for (let d = new Date(y, 2, 1); d < new Date(y + 1, 2, 1); d = addDays(d, 1)) {
    const ds = fmt(d), dow = d.getDay();
    const ov = calDays()[ds];
    const hol = hm[ds];
    let sem = semOf(ds), type, name = ov?.name || '';
    if (ov?.type === 'school') {
      type = 'school';
      if (!sem) sem = ds < calSem().s2Start ? 1 : 2;
    } else if (ov && ['holiday', 'closure', 'vacation'].includes(ov.type)) {
      type = ov.type;
    } else if (hol) {
      type = 'holiday'; name = name || hol.name;
    } else if (dow === 0 || dow === 6) {
      type = 'weekend';
    } else if (!sem) {
      type = 'vacation';
    } else {
      type = ov?.type === 'event' ? 'event' : 'school';
    }
    const isSchool = type === 'school' || type === 'event';
    if (!name && hol && type !== 'holiday') name = hol.name;
    const ev = isSchool && ov && Number(ov.hrs) > 0 ? { hrs: Number(ov.hrs), area: ov.area || 'cha_auto', grades: ov.grades || [] } : null;
    out.push({ ds, d: new Date(d), dow, month: d.getMonth(), year: d.getFullYear(), type, name, isSchool, sem: isSchool ? sem : 0, ev });
  }
  _yearCache = out;
  return out;
}

function weekKey(d) { const m = addDays(d, -((d.getDay() + 6) % 7)); return fmt(m); }

function dayStats() {
  const days = computeYear();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const y = state.school.year + (i >= 10 ? 1 : 0), m = (2 + i) % 12;
    const list = days.filter(x => x.year === y && x.month === m);
    months.push({
      y, m, total: list.length,
      school: list.filter(x => x.isSchool).length,
      s1: list.filter(x => x.sem === 1).length,
      s2: list.filter(x => x.sem === 2).length,
      events: list.filter(x => x.type === 'event').length,
      closure: list.filter(x => x.type === 'closure').length,
      holiday: list.filter(x => x.type === 'holiday' && x.dow > 0 && x.dow < 6).length,
    });
  }
  const sem = { 1: null, 2: null };
  [1, 2].forEach(s => {
    const list = days.filter(x => x.sem === s);
    const wd = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(x => wd[x.dow]++);
    sem[s] = { days: list.length, wd, weeks: new Set(list.map(x => weekKey(x.d))).size };
  });
  // 주차 (월요일 시작, 3월 첫 주부터)
  const weeks = []; const wmap = {};
  days.forEach(x => {
    const k = weekKey(x.d);
    if (!wmap[k]) { wmap[k] = { key: k, days: [], no: weeks.length + 1 }; weeks.push(wmap[k]); }
    wmap[k].days.push(x);
  });
  weeks.forEach(w => {
    w.school = w.days.filter(x => x.isSchool);
    w.sem = w.school.length ? w.school[0].sem : 0;
    w.label = `${fmtK(w.days[0].ds).replace(/\(.\)/, '')}~${fmtK(w.days[w.days.length - 1].ds).replace(/\(.\)/, '')}`;
  });
  return { months, sem, weeks, total: sem[1].days + sem[2].days };
}

/** 행사일이 학년 g 에 해당하는지 */
const evFor = (x, g) => x.ev && (!x.ev.grades.length || x.ev.grades.includes(g));
/** 학년 g 의 행사 활용 창체 시수 {cha_auto, cha_club, cha_career} */
function eventHours(g) {
  const r = { cha_auto: 0, cha_club: 0, cha_career: 0 };
  computeYear().forEach(x => { if (evFor(x, g)) r[x.ev.area] += x.ev.hrs; });
  return r;
}

/** 학년 g, 학기 s 의 수업 가능 시수 */
function capacity(g, s, st = dayStats()) {
  const p = state.school.periods[g];
  return [1, 2, 3, 4, 5].reduce((t, dow) => t + st.sem[s].wd[dow] * (Number(p[dow - 1]) || 0), 0)
    + (st.sem[s].wd[6] + st.sem[s].wd[0]) * (Number(p[4]) || 0); // 주말 수업일 지정 시 금요일 교시로 추정
}

/* =========================================================
 * 시수 계산·검토
 * ========================================================= */
const hv = (g, k, s) => Number(state.hours[g]?.[k]?.[s]) || 0;
const ann = (g, k) => hv(g, k, 's1') + hv(g, k, 's2');

function gradeKeys(g) {
  const b = bandOf(g); const keys = [];
  b.groups.forEach(gr => gr.subs.forEach(s => keys.push(s.key)));
  CHA_PARTS.forEach(p => keys.push(p.key));
  if (g >= 3) keys.push('sat');
  return keys;
}
const gradeSem = (g, s) => gradeKeys(g).reduce((t, k) => t + hv(g, k, s), 0);
const gradeTotal = g => gradeSem(g, 's1') + gradeSem(g, 's2');
const chaTotal = g => CHA_PARTS.reduce((t, p) => t + ann(g, p.key), 0);

function bandCheck(b) {
  const [ga, gb] = b.grades;
  const groups = b.groups.map(gr => {
    const sum = gr.subs.reduce((t, s) => t + ann(ga, s.key) + ann(gb, s.key), 0);
    const diff = sum - gr.base, rate = diff / gr.base;
    let level = 'ok', msg = diff === 0 ? '기준' : diff > 0 ? '증배' : '감축';
    if (gr.noReduce && diff < 0) { level = 'err'; msg = '감축 불가'; }
    else if (Math.abs(rate) > 0.2 + 1e-9) { level = 'err'; msg = '20% 초과'; }
    return { gr, sum, diff, rate, level, msg };
  });
  const cha = chaTotal(ga) + chaTotal(gb);
  const sat = ann(ga, 'sat') + ann(gb, 'sat');
  const total = gradeTotal(ga) + gradeTotal(gb);
  return {
    groups,
    cha: { sum: cha, diff: cha - b.cha, level: cha < b.cha ? 'warn' : 'ok' },
    sat,
    total: { sum: total, diff: total - b.total, level: total < b.total ? 'err' : 'ok' },
  };
}

function collectIssues() {
  const issues = [];
  const st = dayStats();
  const y = state.school.year;
  const { s1Start, s1End, s2Start, s2End } = calSem();
  if (!(s1Start <= s1End && s1End < s2Start && s2Start <= s2End)) issues.push(['err', '학기 기간이 올바르지 않습니다. (1학기 종료일 < 2학기 시작일 순서 확인)']);
  if (!PRESET_HOLIDAYS[y]) issues.push(['warn', `${y}학년도는 음력 공휴일(설·추석·부처님오신날)과 대체공휴일이 자동 입력되지 않습니다. 학사일정에서 직접 추가하세요.`]);
  holidayList(y).filter(h => h[2]).forEach(h => issues.push(['warn', `${fmtK(h[0])} ${h[1]}: 공휴일 지정 여부를 확인하세요. (공휴일이 아니면 학사일정에서 '수업일로 지정')`]));
  if (st.total < MIN_SCHOOL_DAYS) issues.push(['err', `연간 수업일수 ${st.total}일 — 법정 기준 ${MIN_SCHOOL_DAYS}일 이상에 ${MIN_SCHOOL_DAYS - st.total}일 부족합니다.`]);
  else issues.push(['ok', `연간 수업일수 ${st.total}일 (1학기 ${st.sem[1].days}일, 2학기 ${st.sem[2].days}일) — 법정 기준 ${MIN_SCHOOL_DAYS}일 충족`]);

  BANDS.forEach(b => {
    const c = bandCheck(b);
    c.groups.filter(x => x.level !== 'ok').forEach(x => {
      issues.push(['err', `${b.label} ${x.gr.name}: ${x.sum}시간 (기준 ${x.gr.base}, ${x.diff > 0 ? '+' : ''}${x.diff}, ${(x.rate * 100).toFixed(1)}%) — ${x.msg === '감축 불가' ? '체육·예술은 감축할 수 없습니다.' : '증감 허용 범위(±20%)를 벗어났습니다.'}`]);
    });
    if (c.cha.level !== 'ok') issues.push(['warn', `${b.label} 창의적 체험활동 ${c.cha.sum}시간 — 기준 ${b.cha}시간보다 ${-c.cha.diff}시간 적습니다. 학교자율시간 편성 근거를 확인하세요.`]);
    if (c.total.level !== 'ok') issues.push(['err', `${b.label} 총 수업시간 ${c.total.sum}시간 — 최소 기준 ${b.total}시간에 ${-c.total.diff}시간 부족합니다.`]);
    else issues.push(['ok', `${b.label} 총 수업시간 ${c.total.sum}시간 (기준 ${b.total}, +${c.total.diff})`]);
  });

  GRADES.forEach(g => {
    [1, 2].forEach(s => {
      const cap = capacity(g, s, st), asg = gradeSem(g, 's' + s);
      if (asg > cap) issues.push(['err', `${g}학년 ${s}학기 배정 ${asg}시간이 수업 가능 시수 ${cap}시간을 ${asg - cap}시간 초과합니다. (요일별 교시 또는 시수 조정)`]);
    });
    if (g >= 3 && ann(g, 'sat') > 0 && !state.satName[g]) issues.push(['warn', `${g}학년 학교자율시간 과목(활동)명이 입력되지 않았습니다.`]);
  });
  return issues;
}

/* =========================================================
 * 렌더링: ① 기본 정보
 * ========================================================= */
function renderInfo() {
  $('inSchool').value = state.school.name;
  const ys = $('inYear'); const y0 = new Date().getFullYear();
  ys.innerHTML = '';
  for (let y = y0 - 1; y <= y0 + 3; y++) ys.add(new Option(`${y}학년도${PRESET_HOLIDAYS[y] ? '' : ' (공휴일 직접 입력)'}`, y));
  ys.value = state.school.year;

  $('tblClasses').innerHTML = `<tr>${GRADES.map(g => `<th>${g}학년</th>`).join('')}<th>계</th></tr>
    <tr>${GRADES.map(g => `<td><input data-cls="${g}" inputmode="numeric" value="${state.school.classes[g]}"></td>`).join('')}
    <td class="num"><b>${GRADES.reduce((t, g) => t + (Number(state.school.classes[g]) || 0), 0)}</b></td></tr>`;

  const st = dayStats();
  $('tblPeriods').innerHTML = `<tr><th>학년</th>${['월', '화', '수', '목', '금'].map(d => `<th>${d}</th>`).join('')}<th>주당 교시</th><th>1학기 가능 시수</th><th>2학기 가능 시수</th><th>연간 가능 시수</th><th>연간 배정 시수</th></tr>` +
    GRADES.map(g => {
      const p = state.school.periods[g];
      const c1 = capacity(g, 1, st), c2 = capacity(g, 2, st), asg = gradeTotal(g);
      return `<tr><td>${g}학년</td>${p.map((v, i) => `<td><input data-per="${g}" data-i="${i}" inputmode="numeric" value="${v}"></td>`).join('')}
        <td class="num">${p.reduce((t, v) => t + (Number(v) || 0), 0)}</td><td class="num">${c1}</td><td class="num">${c2}</td>
        <td class="num"><b>${c1 + c2}</b></td><td class="num ${asg > c1 + c2 ? 'neg' : ''}">${asg}</td></tr>`;
    }).join('');
}

/* =========================================================
 * 렌더링: ② 학사일정
 * ========================================================= */
function renderCal() {
  const days = computeYear();
  const today = fmt(new Date());
  const [a, b] = selRange();
  // 학기 기간
  const sem = calSem();
  ['s1Start', 's1End', 's2Start', 's2End'].forEach(k => { if (document.activeElement !== $(k)) $(k).value = sem[k]; $(k).disabled = !canEditCal(); });
  $('btnDefaultSem').disabled = !canEditCal();
  // 저장 위치·권한 안내
  const shared = haksaShared();
  $('calWhere').innerHTML = shared
    ? `<span class="pill ok">학교 공용 학사일정</span> 모든 선생님이 같은 학사일정을 봅니다.${canEditCal() ? ' (관리자: 수정 가능)' : ' 수정은 관리자만 할 수 있습니다.'}`
    : (window.Haksa && Haksa.canCreate && Haksa.canCreate()
      ? `<span class="pill warn">이 PC 학사일정</span> 아직 학교 공용 학사일정이 없습니다. <button class="btn small primary" id="btnHaksaCreate">지금 내용으로 학교 공용 학사일정 만들기</button>`
      : `<span class="pill warn">이 PC 학사일정</span> 로그인하면 학교 공용 학사일정을 봅니다.`);
  $('calEditor').classList.toggle('readonly', !canEditCal());
  // 날짜별 교육활동 수 (교육활동 일정 연계)
  const acts = window.Activities ? Activities.items : {};
  let html = '';
  for (let i = 0; i < 12; i++) {
    const y = state.school.year + (i >= 10 ? 1 : 0), m = (2 + i) % 12;
    const list = days.filter(x => x.year === y && x.month === m);
    const sc = list.filter(x => x.isSchool).length;
    html += `<div class="month"><div class="month-head">${y}년 ${m + 1}월<span>수업일 ${sc}일</span></div><div class="mgrid">`;
    html += WD.map(w => `<div class="dow">${w}</div>`).join('');
    for (let k = 0; k < list[0].dow; k++) html += '<div class="day empty"></div>';
    list.forEach(x => {
      const sel = a && x.ds >= a && x.ds <= b ? ' sel' : '';
      const al = (acts[x.ds] || []).filter(t => t.status !== 'canceled');
      const tip = x.ds + ' ' + TYPE_LABEL[x.type] + (x.name ? ' · ' + x.name : '') + al.map(t => `\n· ${t.kind} ${t.title} (${t.status === 'confirmed' ? '확정' : '신청'})`).join('');
      html += `<div class="day ${x.type}${sel}${x.ds === today ? ' today' : ''}" data-ds="${x.ds}" title="${esc(tip)}">
        <span class="d">${x.d.getDate()}</span>${al.length ? `<span class="acts ${al.some(t => t.status === 'confirmed') ? 'c' : ''}">${al.length}</span>` : ''}<span class="n">${esc(x.name || (al[0] ? al[0].title : ''))}</span></div>`;
    });
    html += '</div></div>';
  }
  $('calGrid').innerHTML = html;
  renderCalSide();
}

function selRange() {
  if (!calSel.start) return [null, null];
  const e = calSel.end || calSel.start;
  return calSel.start <= e ? [calSel.start, e] : [e, calSel.start];
}

function renderCalSide() {
  const [a, b] = selRange();
  $('edStart').value = a || '';
  $('edEnd').value = b || '';
  if (a) {
    const n = computeYear().filter(x => x.ds >= a && x.ds <= b).length;
    $('edInfo').textContent = `${n}일 선택됨`;
    const ov = calDays()[a];
    if (ov) {
      $('edType').value = ov.type; $('edName').value = ov.name || '';
      $('edHrs').value = ov.hrs || 0; $('edArea').value = ov.area || 'cha_auto';
    }
    const gs = ov?.grades?.length ? ov.grades : GRADES;
    $('edGrades').innerHTML = '<span class="hint">대상</span>' + GRADES.map(g =>
      `<label class="chk"><input type="checkbox" value="${g}" ${gs.includes(g) ? 'checked' : ''}>${g}학년</label>`).join('');
  } else $('edInfo').textContent = '달력에서 날짜를 선택하세요';
  if (!$('edGrades').innerHTML) $('edGrades').innerHTML = '<span class="hint">대상</span>' + GRADES.map(g =>
    `<label class="chk"><input type="checkbox" value="${g}" checked>${g}학년</label>`).join('');
  $('evHrsBox').style.display = $('edType').value === 'event' ? '' : 'none';

  const st = dayStats();
  $('calSummary').innerHTML = `<div>1학기<b>${st.sem[1].days}</b></div><div>2학기<b>${st.sem[2].days}</b></div>
    <div>연간<b class="${st.total < MIN_SCHOOL_DAYS ? 'neg' : ''}">${st.total}</b></div>`;

  const y = state.school.year;
  $('holidayWarn').innerHTML = PRESET_HOLIDAYS[y] ? '' :
    `<div class="notice">${y}학년도는 음력 공휴일·대체공휴일 정보가 없습니다. 직접 '공휴일 추가'로 입력하세요.</div>`;

  const hm = holidayMap(y), cd = calDays(), edit = canEditCal();
  const rows = [];
  Object.entries(hm).forEach(([ds, h]) => { if (!cd[ds]) rows.push({ ds, type: 'holiday', name: h.name + (h.check ? ' (지정 여부 확인)' : ''), preset: true }); });
  Object.entries(cd).forEach(([ds, o]) => rows.push({ ds, type: o.type, name: o.name || '', preset: false,
    hrs: o.hrs ? `1~${o.hrs}교시·${o.grades?.length ? o.grades.join(',') + '학년' : '전교'}` : '' }));
  // 교육활동 일정(외부강의 등)도 함께 표시
  const acts = window.Activities ? Activities.items : {};
  Object.values(acts).flat().filter(t => t.status !== 'canceled').forEach(t => rows.push({ ds: t.date, type: 'act', name: `${t.kind} · ${t.title}`, act: t }));
  rows.sort((p, q) => p.ds.localeCompare(q.ds));
  $('tblEvents').innerHTML = `<tr><th>날짜</th><th>구분</th><th class="l">내용</th><th>시간</th><th></th></tr>` + rows.map(r =>
    r.act
      ? `<tr class="act-row"><td class="num">${fmtK(r.ds)}</td><td><span class="st ${r.act.status}">${r.act.status === 'confirmed' ? '확정' : '신청'}</span></td>
         <td class="l">${esc(r.name)}<br><span class="hint">${esc(r.act.ownerName || '')}</span></td><td class="hint">${r.act.periods.length >= 6 ? '종일' : r.act.periods.join('·') + '교시'}</td><td><a class="hint" href="#act">보기</a></td></tr>`
      : `<tr><td class="num">${fmtK(r.ds)}</td><td>${r.type === 'school' ? '수업일 지정' : r.type === 'event' ? '교내행사' : TYPE_LABEL[r.type]}</td><td class="l">${esc(r.name)}</td><td class="hint">${r.hrs || ''}</td>
         <td>${r.preset ? '<span class="hint">기본</span>' : edit ? `<button class="x" data-del="${r.ds}" title="삭제">✕</button>` : ''}</td></tr>`).join('');
}

async function applyRange() {
  if (!canEditCal()) { alert('학교 공용 학사일정은 관리자만 수정할 수 있습니다.'); return; }
  let a = $('edStart').value, b = $('edEnd').value || a;
  if (!a) { alert('시작일을 선택하세요.'); return; }
  if (b < a) [a, b] = [b, a];
  const type = $('edType').value, name = $('edName').value.trim();
  const hrs = Math.min(8, toNum($('edHrs').value));
  const grades = [...document.querySelectorAll('#edGrades input:checked')].map(i => Number(i.value));
  const area = $('edArea').value;
  const patch = {};
  for (let d = parse(a); fmt(d) <= b; d = addDays(d, 1)) {
    const ds = fmt(d);
    if (type === 'clear') patch[ds] = null;
    else if (type === 'event' && hrs > 0) patch[ds] = { type, name, hrs, area, grades: grades.length === 6 ? [] : grades };
    else patch[ds] = { type, name };
  }
  try { await writeDays(patch); } catch (e) { alert('저장 실패: ' + e.message); }
  renderCal();
}

/* =========================================================
 * 렌더링: ③ 수업일수
 * ========================================================= */
function renderDays() {
  const st = dayStats();
  const ok = st.total >= MIN_SCHOOL_DAYS;
  $('daysKpi').innerHTML = `
    <div class="kpi"><div class="t">연간 수업일수</div><div class="v">${st.total}일</div>
      <div class="s"><span class="pill ${ok ? 'ok' : 'err'}">${ok ? `기준 충족 (+${st.total - MIN_SCHOOL_DAYS})` : `${MIN_SCHOOL_DAYS - st.total}일 부족`}</span> 법정 ${MIN_SCHOOL_DAYS}일 이상</div></div>
    <div class="kpi"><div class="t">1학기</div><div class="v">${st.sem[1].days}일</div><div class="s">${fmtK(calSem().s1Start)} ~ ${fmtK(calSem().s1End)} · ${st.sem[1].weeks}주</div></div>
    <div class="kpi"><div class="t">2학기</div><div class="v">${st.sem[2].days}일</div><div class="s">${fmtK(calSem().s2Start)} ~ ${fmtK(calSem().s2End)} · ${st.sem[2].weeks}주</div></div>
    <div class="kpi"><div class="t">재량휴업일 / 행사일</div><div class="v">${st.months.reduce((t, m) => t + m.closure, 0)}일 / ${st.months.reduce((t, m) => t + m.events, 0)}일</div><div class="s">학사일정 입력 기준</div></div>`;

  $('tblMonths').innerHTML = `<tr><th>월</th><th>총 일수</th><th>수업일수</th><th>휴업일수</th><th>평일 공휴일</th><th>재량휴업일</th><th>행사일</th></tr>` +
    st.months.map(m => `<tr><td>${m.m + 1}월</td><td class="num">${m.total}</td><td class="num"><b>${m.school}</b></td><td class="num">${m.total - m.school}</td>
      <td class="num">${m.holiday || ''}</td><td class="num">${m.closure || ''}</td><td class="num">${m.events || ''}</td></tr>`).join('') +
    `<tr class="total"><td>계</td><td class="num">${st.months.reduce((t, m) => t + m.total, 0)}</td><td class="num">${st.total}</td>
      <td class="num">${st.months.reduce((t, m) => t + m.total - m.school, 0)}</td><td class="num">${st.months.reduce((t, m) => t + m.holiday, 0)}</td>
      <td class="num">${st.months.reduce((t, m) => t + m.closure, 0)}</td><td class="num">${st.months.reduce((t, m) => t + m.events, 0)}</td></tr>`;

  const wdRow = s => [1, 2, 3, 4, 5].map(d => `<td class="num">${st.sem[s].wd[d]}</td>`).join('');
  $('tblWeekdays').innerHTML = `<tr><th>학기</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>계</th><th>수업 주수</th></tr>
    <tr><td>1학기</td>${wdRow(1)}<td class="num"><b>${st.sem[1].days}</b></td><td class="num">${st.sem[1].weeks}</td></tr>
    <tr><td>2학기</td>${wdRow(2)}<td class="num"><b>${st.sem[2].days}</b></td><td class="num">${st.sem[2].weeks}</td></tr>
    <tr class="total"><td>계</td>${[1, 2, 3, 4, 5].map(d => `<td class="num">${st.sem[1].wd[d] + st.sem[2].wd[d]}</td>`).join('')}<td class="num">${st.total}</td><td class="num">${st.sem[1].weeks + st.sem[2].weeks}</td></tr>`;

  $('tblCapacity').innerHTML = `<tr><th>학년</th><th>1학기 가능</th><th>1학기 배정</th><th>2학기 가능</th><th>2학기 배정</th><th>연간 여유</th></tr>` +
    GRADES.map(g => {
      const c1 = capacity(g, 1, st), c2 = capacity(g, 2, st), a1 = gradeSem(g, 's1'), a2 = gradeSem(g, 's2');
      const r = c1 + c2 - a1 - a2;
      return `<tr><td>${g}학년</td><td class="num">${c1}</td><td class="num ${a1 > c1 ? 'neg' : ''}">${a1}</td><td class="num">${c2}</td>
        <td class="num ${a2 > c2 ? 'neg' : ''}">${a2}</td><td class="num ${r < 0 ? 'neg' : 'pos'}">${r > 0 ? '+' : ''}${r}</td></tr>`;
    }).join('');
}

/* =========================================================
 * 렌더링: ④ 시수 배정
 * ========================================================= */
const pill = (level, msg) => `<span class="pill ${level}">${msg}</span>`;
const sign = n => (n > 0 ? '+' : '') + n;
const inp = (g, k, s) => `<input data-g="${g}" data-k="${k}" data-s="${s}" inputmode="numeric" value="${hv(g, k, s)}">`;

function renderHours() {
  $('gradeSwitch').innerHTML = GRADES.map(g => `<button class="btn ${g === curGrade ? 'on' : ''}" data-grade="${g}">${g}학년</button>`).join('');
  const g = curGrade, b = bandOf(g), chk = bandCheck(b);
  const other = b.grades.find(x => x !== g);
  $('hoursTitle').textContent = `${g}학년 시수 배정 (${b.label}, 학급 수 ${state.school.classes[g]})`;

  let html = `<tr><th>교과(군)</th><th>과목</th><th>학년 기준<br><span class="hint">(참고)</span></th><th>1학기</th><th>2학기</th><th>연간</th><th>주당<br><span class="hint">(÷${STD_WEEKS})</span></th>
    <th>학년군 합계<br><span class="hint">(${b.grades.join('+')}학년)</span></th><th>학년군 기준</th><th>증감</th><th>판정</th></tr>`;
  b.groups.forEach((gr, gi) => {
    const c = chk.groups[gi], n = gr.subs.length;
    gr.subs.forEach((s, si) => {
      html += `<tr>${si === 0 ? `<td class="grp" rowspan="${n}">${gr.name}${gr.noReduce ? '<br><span class="hint">감축 불가</span>' : ''}</td>` : ''}
        <td>${s.name}</td><td class="num">${s.def}</td><td>${inp(g, s.key, 's1')}</td><td>${inp(g, s.key, 's2')}</td>
        <td class="num"><b>${ann(g, s.key)}</b></td><td class="num">${(ann(g, s.key) / STD_WEEKS).toFixed(1)}</td>
        ${si === 0 ? `<td class="num" rowspan="${n}">${c.sum}<br><span class="hint">${other}학년 ${gr.subs.reduce((t, x) => t + ann(other, x.key), 0)}</span></td>
          <td class="num" rowspan="${n}">${gr.base}</td>
          <td class="num ${c.diff < 0 ? 'neg' : c.diff > 0 ? 'pos' : ''}" rowspan="${n}">${sign(c.diff)}<br><span class="hint">${(c.rate * 100).toFixed(1)}%</span></td>
          <td rowspan="${n}">${pill(c.level, c.msg)}</td>` : ''}</tr>`;
    });
  });
  const subj1 = b.groups.reduce((t, gr) => t + gr.subs.reduce((u, s) => u + hv(g, s.key, 's1'), 0), 0);
  const subj2 = b.groups.reduce((t, gr) => t + gr.subs.reduce((u, s) => u + hv(g, s.key, 's2'), 0), 0);
  const subjBand = chk.groups.reduce((t, c) => t + c.sum, 0), subjBase = b.groups.reduce((t, gr) => t + gr.base, 0);
  html += `<tr class="sub"><td colspan="2"><b>교과 소계</b></td><td class="num">${b.groups.reduce((t, gr) => t + gr.subs.reduce((u, s) => u + s.def, 0), 0)}</td>
    <td class="num">${subj1}</td><td class="num">${subj2}</td><td class="num"><b>${subj1 + subj2}</b></td><td class="num">${((subj1 + subj2) / STD_WEEKS).toFixed(1)}</td>
    <td class="num">${subjBand}</td><td class="num">${subjBase}</td><td class="num">${sign(subjBand - subjBase)}</td><td></td></tr>`;

  const eh = eventHours(g);
  CHA_PARTS.forEach((p, i) => {
    html += `<tr>${i === 0 ? `<td class="grp" rowspan="3">창의적<br>체험활동</td>` : ''}<td>${p.name}${eh[p.key] ? `<br><span class="hint">행사 ${eh[p.key]}시간 포함</span>` : ''}</td><td class="num">${b.chaDef[p.key]}</td>
      <td>${inp(g, p.key, 's1')}</td><td>${inp(g, p.key, 's2')}</td><td class="num"><b>${ann(g, p.key)}</b></td><td class="num">${(ann(g, p.key) / STD_WEEKS).toFixed(1)}</td>
      ${i === 0 ? `<td class="num" rowspan="3">${chk.cha.sum}<br><span class="hint">${g}학년 ${chaTotal(g)}</span></td><td class="num" rowspan="3">${b.cha}</td>
        <td class="num ${chk.cha.diff < 0 ? 'neg' : ''}" rowspan="3">${sign(chk.cha.diff)}</td><td rowspan="3">${pill(chk.cha.level, chk.cha.level === 'ok' ? '적정' : '기준 미달')}</td>` : ''}</tr>`;
  });

  if (g >= 3) {
    html += `<tr><td class="grp">학교자율시간</td><td><input class="wide" data-satname="${g}" placeholder="과목·활동명" value="${esc(state.satName[g])}"></td><td class="num">-</td>
      <td>${inp(g, 'sat', 's1')}</td><td>${inp(g, 'sat', 's2')}</td><td class="num"><b>${ann(g, 'sat')}</b></td><td class="num">${(ann(g, 'sat') / STD_WEEKS).toFixed(1)}</td>
      <td class="num">${chk.sat}</td><td class="num">-</td><td></td><td><span class="hint">교과·창체 증감으로 확보</span></td></tr>`;
  }
  html += `<tr class="total"><td colspan="2">총 수업시간</td><td class="num">${b.total / 2}</td><td class="num">${gradeSem(g, 's1')}</td><td class="num">${gradeSem(g, 's2')}</td>
    <td class="num">${gradeTotal(g)}</td><td class="num">${(gradeTotal(g) / STD_WEEKS).toFixed(1)}</td><td class="num">${chk.total.sum}</td><td class="num">${b.total}</td>
    <td class="num ${chk.total.diff < 0 ? 'neg' : ''}">${sign(chk.total.diff)}</td><td>${pill(chk.total.level, chk.total.level === 'ok' ? '최소 기준 충족' : '최소 기준 미달')}</td></tr>`;
  $('tblHours').innerHTML = html;

  const st = dayStats();
  $('tblHoursCap').innerHTML = `<tr><th>학기</th><th>수업일수</th><th>요일별 교시(월~금)</th><th>수업 가능 시수</th><th>배정 시수</th><th>차이</th><th>판정</th></tr>` +
    [1, 2].map(s => {
      const cap = capacity(g, s, st), asg = gradeSem(g, 's' + s), d = cap - asg;
      return `<tr><td>${s}학기</td><td class="num">${st.sem[s].days}</td><td>${state.school.periods[g].join(' · ')}</td><td class="num">${cap}</td><td class="num">${asg}</td>
        <td class="num ${d < 0 ? 'neg' : 'pos'}">${sign(d)}</td><td>${pill(d < 0 ? 'err' : 'ok', d < 0 ? '시간 부족' : '여유 ' + d + '시간')}</td></tr>`;
    }).join('');
}

/* =========================================================
 * 렌더링: ⑤ 편제표·검토
 * ========================================================= */
function pyeonjeHtml(forExport = false) {
  const st = dayStats();
  let html = '';
  if (forExport) html += `<h2>${esc(state.school.name)} ${state.school.year}학년도 교육과정 편제 및 시간 배당</h2>`;
  BANDS.forEach(b => {
    const [ga, gb] = b.grades, chk = bandCheck(b);
    const cell = (g, k) => `<td class="num">${hv(g, k, 's1')}</td><td class="num">${hv(g, k, 's2')}</td><td class="num"><b>${ann(g, k)}</b></td>`;
    html += `<div class="card"><h2>${b.label} 편제 및 시간 배당 <span class="hint">(학급 수: ${ga}학년 ${state.school.classes[ga]}, ${gb}학년 ${state.school.classes[gb]})</span></h2>
      <div class="tbl-scroll"><table class="tbl" border="1"><tr><th rowspan="2" colspan="2">구분</th><th rowspan="2">기준 시수</th>
      <th colspan="3">${ga}학년</th><th colspan="3">${gb}학년</th><th rowspan="2">학년군 계</th><th rowspan="2">증감</th><th rowspan="2">판정</th></tr>
      <tr><th>1학기</th><th>2학기</th><th>계</th><th>1학기</th><th>2학기</th><th>계</th></tr>`;
    b.groups.forEach((gr, gi) => {
      const c = chk.groups[gi], n = gr.subs.length;
      gr.subs.forEach((s, si) => {
        html += `<tr>${si === 0 ? `<td rowspan="${n}" ${n === 1 ? 'colspan="2"' : ''}>${gr.name}</td>` : ''}${n > 1 ? `<td>${s.name}</td>` : ''}
          ${si === 0 ? `<td class="num" rowspan="${n}">${gr.base}</td>` : ''}${cell(ga, s.key)}${cell(gb, s.key)}
          ${si === 0 ? `<td class="num" rowspan="${n}"><b>${c.sum}</b></td><td class="num" rowspan="${n}">${sign(c.diff)}</td><td rowspan="${n}">${forExport ? c.msg : pill(c.level, c.msg)}</td>` : ''}</tr>`;
      });
    });
    CHA_PARTS.forEach((p, i) => {
      html += `<tr>${i === 0 ? `<td rowspan="3">창의적<br>체험활동</td>` : ''}<td>${p.name}</td>${i === 0 ? `<td class="num" rowspan="3">${b.cha}</td>` : ''}
        ${cell(ga, p.key)}${cell(gb, p.key)}${i === 0 ? `<td class="num" rowspan="3"><b>${chk.cha.sum}</b></td><td class="num" rowspan="3">${sign(chk.cha.diff)}</td>
        <td rowspan="3">${forExport ? (chk.cha.level === 'ok' ? '적정' : '기준 미달') : pill(chk.cha.level, chk.cha.level === 'ok' ? '적정' : '기준 미달')}</td>` : ''}</tr>`;
    });
    if (ga >= 3) {
      html += `<tr><td>학교자율시간</td><td>${esc([state.satName[ga], state.satName[gb]].filter(Boolean).join(' / ') || '-')}</td><td>-</td>
        ${cell(ga, 'sat')}${cell(gb, 'sat')}<td class="num"><b>${chk.sat}</b></td><td></td><td></td></tr>`;
    }
    html += `<tr class="total"><td colspan="2">총 수업시간</td><td class="num">${b.total}</td>
      <td class="num">${gradeSem(ga, 's1')}</td><td class="num">${gradeSem(ga, 's2')}</td><td class="num">${gradeTotal(ga)}</td>
      <td class="num">${gradeSem(gb, 's1')}</td><td class="num">${gradeSem(gb, 's2')}</td><td class="num">${gradeTotal(gb)}</td>
      <td class="num">${chk.total.sum}</td><td class="num">${sign(chk.total.diff)}</td><td>${chk.total.level === 'ok' ? '충족' : '미달'}</td></tr>
      <tr><td colspan="2">수업일수</td><td class="num">-</td><td colspan="3">1학기 ${st.sem[1].days}일 / 2학기 ${st.sem[2].days}일</td>
      <td colspan="3">연간 ${st.total}일</td><td colspan="3"></td></tr></table></div></div>`;
  });
  return html;
}

function renderTable() {
  $('issues').innerHTML = collectIssues().map(([lv, msg]) => `<li class="${lv}">${lv === 'err' ? '⛔' : lv === 'warn' ? '⚠️' : '✅'} ${esc(msg)}</li>`).join('');
  $('pyeonje').innerHTML = pyeonjeHtml();
}

/* =========================================================
 * 내보내기
 * ========================================================= */
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadXls(name, bodyHtml) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
    <style>td,th{border:1px solid #999;padding:4px;text-align:center;mso-number-format:"\\@";} th{background:#eef2f7;}</style></head><body>${bodyHtml}</body></html>`;
  download(name, '﻿' + html, 'application/vnd.ms-excel');
}
const fileBase = () => `${state.school.name || '학교'}_${state.school.year}학년도`;

function exportCal() {
  const days = computeYear(), st = dayStats();
  let html = `<h2>${esc(state.school.name)} ${state.school.year}학년도 학사일정</h2>
    <table border="1"><tr><th>월</th><th>수업일수</th><th>휴업일수</th></tr>` +
    st.months.map(m => `<tr><td>${m.m + 1}월</td><td>${m.school}</td><td>${m.total - m.school}</td></tr>`).join('') +
    `<tr><th>계</th><th>${st.total}</th><th>${days.length - st.total}</th></tr></table><br>
    <table border="1"><tr><th>날짜</th><th>요일</th><th>학기</th><th>구분</th><th>내용</th></tr>` +
    days.filter(x => x.name || ['holiday', 'closure'].includes(x.type)).map(x =>
      `<tr><td>${x.ds}</td><td>${WD[x.dow]}</td><td>${x.sem || ''}</td><td>${TYPE_LABEL[x.type]}</td><td>${esc(x.name)}</td></tr>`).join('') + '</table>';
  downloadXls(`${fileBase()}_학사일정.xls`, html);
}

/* =========================================================
 * 이벤트
 * ========================================================= */
const RENDER = { home: renderHome, data: () => {}, admin: () => {}, info: renderInfo, cal: renderCal, days: renderDays, hours: renderHours, table: renderTable };
const GROUP_FIRST = { home: 'home', haksa: 'cal', curr: 'info', tt: 'tt', act: 'act', data: 'data', admin: 'admin' };
const lastInGroup = {};
let curTab = 'home';

function groupOf(t) { const b = document.querySelector(`#tabs [data-tab="${t}"]`); return b ? b.dataset.group : 'home'; }

/** 화면 전환. 로그인·승인이 필요한데 안 된 경우(App.locked) HOME 으로 */
function showTab(t) {
  if (!RENDER[t] || !$('tab-' + t)) t = 'home';
  if (t !== 'home' && window.App.locked && window.App.locked()) { window.App.pendingTab = t; t = 'home'; }
  if (t === 'admin' && !(window.App.isAdmin && window.App.isAdmin())) t = 'home';
  if (t === 'data' && isTeacherView()) t = 'home';
  curTab = t;
  const g = groupOf(t);
  lastInGroup[g] = t;
  document.querySelectorAll('#mainNav [data-go]').forEach(b => b.classList.toggle('active', b.dataset.go === g));
  const tabs = $('tabs');
  tabs.hidden = g === 'home' || document.querySelectorAll(`#tabs [data-group="${g}"]`).length < 2;
  tabs.querySelectorAll('button').forEach(b => { b.hidden = b.dataset.group !== g; b.classList.toggle('active', b.dataset.tab === t); });
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  if (location.hash.slice(1) !== t) history.pushState(null, '', '#' + t);
  RENDER[t]();
  applyRoleView();
  window.scrollTo(0, 0);
}
function goGroup(g) { showTab(lastInGroup[g] || GROUP_FIRST[g] || 'home'); }

/* ---------- HOME ---------- */
function renderHome() {
  const s = state.school, st = dayStats(), issues = collectIssues();
  const nErr = issues.filter(x => x[0] === 'err').length, nWarn = issues.filter(x => x[0] === 'warn').length;
  const teacher = isTeacherView();
  $('homeTitle').textContent = teacher ? `${s.year}학년도 학교 교육과정` : `${s.year}학년도 교육과정 편성 도우미`;
  $('homeSub').textContent = teacher
    ? '학사일정과 학교 교육과정(시수·시간표·편제표)을 조회하고, 외부강의·교내행사를 신청합니다.'
    : '학사일정부터 시수 배정, 시간표, 편제표까지 한 곳에서 계획합니다.';
  const locked = window.App.locked && window.App.locked();
  const pub = window.App.publishedInfo ? App.publishedInfo() : null;
  $('homeKpi').innerHTML = locked ? '' : `
    <div class="kpi"><div class="t">연간 수업일수</div><div class="v">${st.total}일</div><div class="s">1학기 ${st.sem[1].days} · 2학기 ${st.sem[2].days}</div></div>
    <div class="kpi"><div class="t">학급 수</div><div class="v">${GRADES.reduce((t, g) => t + (Number(s.classes[g]) || 0), 0)}학급</div><div class="s">${GRADES.map(g => s.classes[g]).join(' · ')}</div></div>
    ${teacher
      ? `<div class="kpi"><div class="t">학교 교육과정</div><div class="v" style="font-size:18px">${pub ? '게시됨' : '<span class="neg">게시 전</span>'}</div><div class="s">${pub ? esc(pub) : '관리자가 게시하면 표시됩니다'}</div></div>
         <div class="kpi"><div class="t">교육활동 일정</div><div class="v" style="font-size:18px">신청·조회</div><div class="s"><a href="#act">일정 신청하기</a></div></div>`
      : `<div class="kpi"><div class="t">검토 결과</div><div class="v">${nErr ? `<span class="neg">오류 ${nErr}</span>` : '<span class="pos">오류 없음</span>'}</div><div class="s">경고 ${nWarn}건 · <a href="#table">자세히 보기</a></div></div>
         <div class="kpi"><div class="t">저장 위치</div><div class="v" style="font-size:18px">${esc($('cloudState').textContent || '이 PC')}</div><div class="s"><a href="#data">자료 관리</a>${pub ? ` · 선생님께 게시: ${esc(pub)}` : ''}</div></div>`}`;
  $('homeMenu').classList.toggle('locked', !!locked);
  if (window.App.renderGate) window.App.renderGate($('homeGate')); else $('homeGate').innerHTML = '';
}

/** 다시 그린 뒤에도 입력 중이던 칸에 커서를 유지 */
function rerenderKeepFocus(fn) {
  const a = document.activeElement;
  const attrs = a && a.tagName === 'INPUT' ? [...a.attributes].filter(x => x.name.startsWith('data-')).map(x => `[${x.name}="${x.value}"]`).join('') : '';
  const pos = attrs ? a.selectionStart : null;
  fn();
  if (attrs) {
    const n = document.querySelector('input' + attrs);
    if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }
}
const toNum = v => Math.max(0, parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0);

function bind() {
  $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); goGroup(g.dataset.go); return; }
    const p = e.target.closest('[data-proxy]');
    if (p) $(p.dataset.proxy).click();
  });
  window.addEventListener('popstate', () => showTab(location.hash.slice(1) || 'home'));
  window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== curTab) showTab(location.hash.slice(1) || 'home'); });

  // ① 기본 정보
  $('inSchool').addEventListener('input', e => { state.school.name = e.target.value; save(); });
  $('inYear').addEventListener('change', e => {
    const y = Number(e.target.value);
    if (!haksaShared() && Object.keys(state.days).length && !confirm('학년도를 바꾸면 학기 기간이 기본값으로 바뀝니다. 입력한 일정은 유지됩니다(날짜가 달라 표시되지 않을 수 있음). 계속할까요?')) { e.target.value = state.school.year; return; }
    state.school.year = y; state.sem = defaultSemesters(y); _yearCache = null; save(); renderInfo();
    document.dispatchEvent(new Event('year-change'));   // 학교 공용 학사일정·교육활동을 해당 학년도로 다시 불러옴
  });
  ['s1Start', 's1End', 's2Start', 's2End'].forEach(k => $(k).addEventListener('change', async e => {
    if (!canEditCal()) return;
    try { await writeSem({ ...calSem(), [k]: e.target.value }); } catch (err) { alert('저장 실패: ' + err.message); }
    _yearCache = null; renderCal();
  }));
  $('btnDefaultSem').addEventListener('click', async () => {
    if (!canEditCal()) return;
    await writeSem(defaultSemesters(state.school.year)); _yearCache = null; renderCal();
  });
  $('tab-info').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.cls) { state.school.classes[t.dataset.cls] = toNum(t.value); }
    else if (t.dataset.per) { state.school.periods[t.dataset.per][t.dataset.i] = Math.min(8, toNum(t.value)); }
    else return;
    save(); rerenderKeepFocus(renderInfo);
  });
  $('btnReset').addEventListener('click', () => {
    if (!confirm('모든 입력(학사일정, 시수 배정 등)을 지우고 처음 상태로 되돌립니다. 되돌릴 수 없습니다. 먼저 백업 저장을 권장합니다. 계속할까요?')) return;
    state = defaultState(); save(); showTab('info');
  });

  // ② 학사일정
  $('calGrid').addEventListener('click', e => {
    const c = e.target.closest('.day[data-ds]'); if (!c) return;
    if (e.shiftKey && calSel.start) calSel.end = c.dataset.ds;
    else { calSel = { start: c.dataset.ds, end: null }; const ov = calDays()[c.dataset.ds]; if (!ov) $('edName').value = ''; }
    renderCal();
  });
  ['edStart', 'edEnd'].forEach(id => $(id).addEventListener('change', () => {
    calSel = { start: $('edStart').value || null, end: $('edEnd').value || null }; renderCal();
  }));
  $('btnApply').addEventListener('click', applyRange);
  $('edType').addEventListener('change', () => { $('evHrsBox').style.display = $('edType').value === 'event' ? '' : 'none'; });
  $('edName').addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(); });
  $('tblEvents').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!canEditCal()) return;
    writeDays({ [b.dataset.del]: null }).then(renderCal).catch(err => alert('삭제 실패: ' + err.message));
  });
  document.addEventListener('click', e => {
    if (e.target.id !== 'btnHaksaCreate') return;
    if (!confirm('지금 화면의 학사일정(학기 기간·행사·휴업일 등)을 학교 공용 학사일정으로 등록합니다. 이후 모든 선생님이 이 학사일정을 보게 됩니다. 계속할까요?')) return;
    Haksa.createFromLocal().catch(err => alert('만들기 실패: ' + err.message));
  });
  $('btnExportCal').addEventListener('click', exportCal);

  // ④ 시수 배정
  $('gradeSwitch').addEventListener('click', e => { const b = e.target.closest('[data-grade]'); if (b) { curGrade = Number(b.dataset.grade); renderHours(); } });
  $('tblHours').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.satname) { state.satName[t.dataset.satname] = t.value; save(); return; }
    if (!t.dataset.g) return;
    state.hours[t.dataset.g][t.dataset.k][t.dataset.s] = toNum(t.value);
    save(); rerenderKeepFocus(renderHours);
  });
  $('tblHours').addEventListener('focusin', e => { if (e.target.dataset.g) e.target.select(); });
  $('btnFillGrade').addEventListener('click', () => {
    if (!confirm(`${curGrade}학년 시수를 기준값으로 덮어씁니다. 계속할까요?`)) return;
    state.hours[curGrade] = defaultHours(curGrade); save(); renderHours();
  });
  $('btnFillAll').addEventListener('click', () => {
    if (!confirm('전 학년 시수를 기준값으로 덮어씁니다. 계속할까요?')) return;
    GRADES.forEach(g => { state.hours[g] = defaultHours(g); }); save(); renderHours();
  });

  // ⑤ 편제표
  $('btnExportTable').addEventListener('click', () => downloadXls(`${fileBase()}_편제표.xls`, pyeonjeHtml(true)));

  // 상단
  $('btnExportJson').addEventListener('click', () => download(`${fileBase()}_교육과정_백업.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('fileImport').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.school || !data.hours) throw new Error('형식 오류');
        if (!confirm('현재 입력을 불러온 백업으로 교체합니다. 계속할까요?')) return;
        state = normalize(data); save(); showTab(curTab);
      } catch (err) { alert('백업 파일을 읽을 수 없습니다: ' + err.message); }
      e.target.value = '';
    };
    r.readAsText(f, 'utf-8');
  });
  $('btnPrint').addEventListener('click', () => window.print());
}

/* ---------- 시작 ---------- */
load();
bind();
save();
// 모든 스크립트(features.js, cloud.js)가 등록된 뒤 첫 화면 표시
document.addEventListener('DOMContentLoaded', () => showTab(location.hash.slice(1) || 'home'));
