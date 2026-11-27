/* =========================================================
 * 교육과정 편성 › ② 학교사용환경설정 (스쿨마스터의 같은 메뉴를 참고)
 *  - 학급 현황 설정   : 학년별 학급 수(학교 정보와 같은 값)·반 이름·담임, 특수학급
 *  - 특별실-전담 배정 : 특별실 목록, 교과전담(state.jundam, 시간표 편성 › 교과전담과 같은 자료)에 사용 특별실·담당 반
 *  - 검정교과 설정    : 학년별 검정 교과서 출판사
 *  - 범교과-주제어    : 2022 개정 범교과 학습 주제 10개 + 주제어·학년별 시수
 *  - 일과시간 설정    : 교시 시각표(자동 만들기 + 직접 고치기)
 *  모두 교육과정 문서(state.env)에 저장 → 자동 저장·클라우드 동기화
 * ========================================================= */
(function () {
  'use strict';
  const PANES = [['class', '학급 현황 설정'], ['room', '특별실-전담 배정'], ['book', '검정교과 설정'], ['theme', '범교과-주제어 설정'], ['bell', '일과시간 설정']];
  let pane = sessionStorage.getItem('envPane') || 'class';

  // 2022 개정: 3~6학년 검정 교과(5~6학년 실과 포함). 학교에서 바꿀 수 있음
  const BOOK_DEFAULT = { 3: ['math', 'soc', 'sci', 'mus', 'art', 'pe', 'eng'], 4: ['math', 'soc', 'sci', 'mus', 'art', 'pe', 'eng'],
    5: ['math', 'soc', 'sci', 'prac', 'mus', 'art', 'pe', 'eng'], 6: ['math', 'soc', 'sci', 'prac', 'mus', 'art', 'pe', 'eng'] };
  // 초등 검정 교과서를 내는 출판사 (중·고 전용 출판사 제외)
  const PUBLISHERS = ['천재교육', '천재교과서', '비상교육', '미래엔', '동아출판', '아이스크림미디어', '지학사', '김영사', '와이비엠', '대교', '금성출판사', '좋은책신사고'];
  const THEMES = ['안전·건강 교육', '인성 교육', '진로 교육', '민주시민 교육', '인권 교육', '다문화 교육', '통일 교육', '독도 교육', '경제·금융 교육', '환경·지속가능발전 교육'];
  const ROOMS = ['과학실', '컴퓨터실', '음악실', '미술실', '영어실', '체육관', '도서실', '실과실'];

  /** state.env 기본값 채우기 (예전 문서에도 안전) */
  function env() {
    const e = state.env = state.env || {};
    e.classInfo = e.classInfo || {};          // "학년-반": { name, teacher }
    e.special = Array.isArray(e.special) ? e.special : [];   // [{ name, teacher, students }]
    e.rooms = Array.isArray(e.rooms) ? e.rooms : ROOMS.slice(0, 6).map(name => ({ name, note: '' }));
    // 전담 교사 목록 (처음엔 배정표에 적힌 이름으로 채움)
    e.teachers = Array.isArray(e.teachers) ? e.teachers
      : [...new Set((state.jundam || []).map(r => (r.teacher || '').trim()).filter(Boolean))].map(name => ({ name }));
    // 학교의 전담 교과(예: 영어·과학) — 배정표 교과 칸과 특별실 연결에 이 범위만 나옴
    if (!Array.isArray(e.jdSubjects)) e.jdSubjects = [];
    // 우리 학교 전담 교과(영어·체육·과학·음악·미술·창체)를 한 번 채워 둠 — 이후엔 학교에서 고친 대로
    if (!e.jdPreset) { e.jdSubjects = [...new Set([...e.jdSubjects, 'sci', 'pe', 'mus', 'art', 'eng', 'cha'])]; e.jdPreset = 1; }
    e.jdSubjects = e.jdSubjects.filter(k => allSubj().some(s => s.key === k));
    e.books = e.books || {};                  // { 학년: { 과목키: 출판사 } }
    e.bookSubjects = e.bookSubjects || JSON.parse(JSON.stringify(BOOK_DEFAULT));
    e.themes = Array.isArray(e.themes) && e.themes.length ? e.themes : THEMES.map(name => ({ name, keywords: '', subjects: '', hours: {} }));
    e.bell = e.bell || { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunchLen: 50, morning: '08:40', count: 6, rows: null };
    if (!e.bell.rows) e.bell.rows = makeBell(e.bell);
    return e;
  }
  /** 전담으로 둘 수 있는 교과: 3~6학년 교과 + 창체(디지털튜터 등) — 1·2학년 통합교과 제외 */
  function allSubj() {
    const seen = new Map();
    [3, 4, 5, 6].forEach(g => bandOf(g).groups.forEach(gr => gr.subs.forEach(s => { if (!seen.has(s.key)) seen.set(s.key, s.name); })));
    return [...seen].map(([key, name]) => ({ key, name })).concat([{ key: 'cha', name: '창체' }]);
  }
  /** 창체 세부 영역(자율·동아리·진로)은 전담 교과 '창체' 하나로 봄 */
  const subjGroup = k => String(k || '').startsWith('cha_') ? 'cha' : k;
  const subjName = k => (allSubj().find(s => s.key === k) || CHA_PARTS.find(p => p.key === k) || {}).name || k;
  const ROOM_GUESS = [['과학', 'sci'], ['영어', 'eng'], ['음악', 'mus'], ['미술', 'art'], ['체육', 'pe'], ['실과', 'prac'], ['컴퓨터', 'prac']];
  function guessSubj(name) { const hit = ROOM_GUESS.find(([w]) => String(name || '').includes(w)); return hit ? hit[1] : ''; }
  /** 특별실의 연결 교과: 직접 정한 값, 없으면 이름으로 짐작(과학실 → 과학) — 단 전담 교과일 때만 */
  function roomSubj(r) {
    if (r.subj !== undefined) return r.subj;
    const g = guessSubj(r.name), jd = env().jdSubjects;
    return g && jd.includes(g) ? g : '';
  }
  /** 이 학년에서 고를 수 있는 전담 교과 (전담 교과를 아직 안 골랐으면 전체) */
  function jdSubjOf(g) {
    const list = subjectsOf(g), pick = env().jdSubjects;
    return pick.length ? list.filter(s => pick.includes(subjGroup(s.key))) : list.filter(s => s.key !== 'sat');
  }
  /** 교과에 연결된 특별실 (연결된 곳이 없으면 아무 교과에도 안 묶인 특별실) */
  function roomsFor(subj) {
    const rs = env().rooms.filter(r => r.name);
    const linked = rs.filter(r => roomSubj(r) === subjGroup(subj));
    return linked.length ? linked : rs.filter(r => !roomSubj(r));
  }
  const t2m = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const m2t = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  /** 시작 시각·수업·쉬는 시간·점심으로 교시표 만들기 */
  function makeBell(b) {
    const rows = [];
    if (b.morning && t2m(b.morning) < t2m(b.start)) rows.push({ label: '아침 활동', start: b.morning, end: b.start, kind: 'etc' });
    let t = t2m(b.start);
    for (let p = 1; p <= Math.min(8, Number(b.count) || 6); p++) {
      rows.push({ label: `${p}교시`, start: m2t(t), end: m2t(t + Number(b.len)), kind: 'class' });
      t += Number(b.len);
      if (p === Number(b.lunchAfter)) { rows.push({ label: '점심시간', start: m2t(t), end: m2t(t + Number(b.lunchLen)), kind: 'lunch' }); t += Number(b.lunchLen); }
      else if (p < Number(b.count)) t += Number(b.brk);
    }
    return rows;
  }
  // 저장할 때마다 이 학년도의 설정 사본을 남겨 둠 → 다음 해에 '작년자료 불러오기'로 씀
  const changed = () => {
    const { envArchive, ...rest } = state.env || {};
    state.envArchive = state.envArchive || {};
    state.envArchive[state.school.year] = JSON.parse(JSON.stringify(rest));
    save();
  };
  const ro = () => isTeacherView() || (App.locked && App.locked());
  const nIn = (attrs, v, w = 64) => `<input type="number" min="0" ${attrs} value="${v ?? ''}" style="width:${w}px">`;

  /* ---------- 화면 ---------- */
  function render() {
    env();
    // 다른 메뉴에서 들어오면 늘 첫 화면(학급 현황 설정)부터
    if (window.tabFresh) { pane = 'class'; sessionStorage.setItem('envPane', pane); selRoom = selT = -1; modeRoom = modeT = ''; }
    $('envNav').innerHTML = PANES.map(([k, l]) => `<button type="button" class="env-nav-btn${k === pane ? ' on' : ''}" data-pane="${k}">${l}</button>`).join('');
    $('envBody').innerHTML = ({ class: paneClass, room: paneRoom, book: paneBook, theme: paneTheme, bell: paneBell })[pane]();
  }

  function paneClass() {
    const e = env();
    const total = GRADES.reduce((sum, grade) => sum + (Number(state.school.classes[grade]) || 0), 0);
    const kc = Math.max(0, Math.min(3, Number(state.school.kclass ?? 3)));
    const locked = ro() ? 'disabled' : '';
    const metrics = [['일반학급', total, '학급'], ['교과전담', e.teachers.length, '명'], ['한국어학급', kc, '학급'], ['특수학급', e.special.length, '학급']];
    const classRow = (label, key, accessibleLabel = label) => `<li class="class-dash-row">
      <span>${label}</span><input data-ci="${key}" data-f="teacher" maxlength="20" aria-label="${accessibleLabel} 담임" placeholder="담임 이름" value="${esc(e.classInfo[key]?.teacher || '')}" ${locked}>
    </li>`;
    const addSpecial = `<button type="button" class="btn small" data-add="special" ${locked}>+ 특수학급 추가</button>`;

    return `<div class="class-dash">
      <header><h2>학급 현황 설정</h2>
        <dl class="class-dash-metrics">${metrics.map(([label, count, unit]) => `<div class="class-dash-card">
          <dt>${label}</dt><dd><strong>${count}</strong> ${unit}</dd></div>`).join('')}</dl>
      </header>
      <section aria-labelledby="envClassTitle">
        <div class="class-dash-heading"><h3 id="envClassTitle">일반학급</h3><a href="#school">학급 수 설정</a></div>
        <div class="class-dash-grades">${GRADES.map(grade => {
          const count = Number(state.school.classes[grade]) || 0;
          const hours = (state.school.periods[grade] || []).reduce((sum, periods) => sum + (Number(periods) || 0), 0);
          const rows = Array.from({ length: count }, (_, i) => classRow(`${i + 1}반`, `${grade}-${i + 1}`, `${grade}학년 ${i + 1}반`));
          return `<section class="class-dash-card">
            <div class="class-dash-heading"><h4>${grade}학년</h4><span>${count}학급</span></div>
            <p class="class-dash-week">주 ${hours}차시</p>
            ${rows.length ? `<ul class="class-dash-list">${rows.join('')}</ul>` : '<p class="class-dash-note">등록된 학급이 없습니다.</p>'}
          </section>`;
        }).join('')}</div>
      </section>
      <div class="class-dash-staff">
        <section class="class-dash-card">
          <div class="class-dash-heading"><h3>교과전담</h3><span>주당 시수</span></div>
          ${e.teachers.length ? `<ul class="class-dash-list">${e.teachers.map(t => {
            const rows = state.jundam.filter(r => r.teacher === t.name);
            const subjects = [...new Set(rows.map(r => subjName(r.subj)))];
            const grades = GRADES.filter(g => rows.some(r => Number(r.grade) === g));
            return `<li class="class-dash-row class-dash-teacher">
              <div class="class-dash-badges">${subjects.map(subject => `<span class="class-dash-subject area-${scheduleSubjectArea(subject)}">${esc(subject)}</span>`).join('') || '<span class="class-dash-subject area-other">미배정</span>'}</div>
              <div><strong>${esc(t.teacher || t.name || '미등록')}</strong><small>${grades.map(g => `${g}학년`).join(' · ') || '담당 학년 미정'}</small></div>
              <div class="class-dash-hours"><strong>${teacherHours(t.name)}</strong><small>차시</small></div>
            </li>`;
          }).join('')}</ul>` : '<p class="class-dash-note">등록된 전담 교사가 없습니다.</p>'}
          <footer><a href="#" data-goroom>특별실·전담 배정 →</a></footer>
        </section>
        <section class="class-dash-card">
          <div class="class-dash-heading"><h3>한국어학급</h3><span>${kc}학급</span></div>
          ${kc ? `<ul class="class-dash-list">${Array.from({ length: kc }, (_, i) => classRow(`한국어학급 ${i + 1}`, `k-${i + 1}`)).join('')}</ul>` : '<p class="class-dash-note">등록된 한국어학급이 없습니다.</p>'}
        </section>
        <section class="class-dash-card">
          <div class="class-dash-heading"><h3>특수학급</h3><span>${e.special.length}학급</span></div>
          ${e.special.length ? `<ul class="class-dash-list">${e.special.map((s, i) => `<li class="class-dash-special">
            <label>학급 이름<input data-sp="${i}" data-f="name" maxlength="20" placeholder="예: 희망반" value="${esc(s.name || '')}" ${locked}></label>
            <label>담임<input data-sp="${i}" data-f="teacher" maxlength="20" value="${esc(s.teacher || '')}" ${locked}></label>
            <label>학생 수${nIn(`data-sp="${i}" data-f="students" max="99" ${locked}`, s.students)}</label>
            <button type="button" class="sm-del" data-del="special" data-i="${i}" ${locked}>삭제</button>
          </li>`).join('')}</ul><footer>${addSpecial}</footer>` : `<div class="class-dash-empty">
            <span class="class-dash-empty-icon" aria-hidden="true"></span>
            <p>등록된 특수학급이 없습니다.</p>${addSpecial}
          </div>`}
        </section>
      </div>
    </div>`;
  }

  /* 특별실-전담: 왼쪽 두 목록(스쿨마스터와 같은 구성) + 아래 배정표 */
  let selRoom = -1, selT = -1, modeRoom = '', modeT = '';
  /** 배정 한 줄의 주당 시수 = 시수 × 담당 반 수(비면 그 학년 전체 반) */
  const classNumbers = grade => Array.from({ length: Math.max(0, Math.min(20, Number(state.school.classes[grade]) || 0)) }, (_, i) => i + 1);
  const activeClasses = r => classNumbers(r.grade).filter(n => !r.classes?.length || r.classes.includes(n) || r.classes.includes(String(n)));
  const rowHours = r => (Number(r.hrs) || 0) * activeClasses(r).length;
  const assignmentPrefs = () => (env().jdCards ||= { rooms: {}, grades: {} });
  const gradeKey = (teacher, subject, grade) => JSON.stringify([teacher, subject, grade]);
  const subjectRows = key => state.jundam.filter(row => subjGroup(row.subj) === key);
  const paintTone = { eng: ['Aa', 'blue'], sci: ['⚗', 'green'], pe: ['◉', 'amber'], mus: ['♪', 'violet'], art: ['◈', 'rose'], cha: ['✦', 'teal'] };

  function teacherSubjects(teacher) {
    if (teacher.subject) return [teacher.subject];
    const label = String(teacher.name || '');
    return [...new Set([
      ...allSubj().filter(subject => label.includes(subject.name)).map(subject => subject.key),
      ...state.jundam.filter(row => row.teacher === teacher.name).map(row => subjGroup(row.subj)),
    ])];
  }

  function roomOptions(subject, selected, inherit = false) {
    const names = [...new Set([...roomsFor(subject).map(room => room.name), selected].filter(Boolean))];
    return (inherit ? `<option value="__inherit" ${selected === '__inherit' ? 'selected' : ''}>교과 기본값</option>` : '') +
      `<option value="" ${selected === '' ? 'selected' : ''}>일반 교실</option>` +
      names.filter(name => name !== '__inherit').map(name => `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
  }

  function gradeAssignment(key, teacher, grade, subject) {
    const group = subjectRows(key).filter(row => row.teacher === teacher && Number(row.grade) === grade);
    const prefs = assignmentPrefs();
    const saved = prefs.grades[gradeKey(teacher, key, grade)] || {};
    const explicit = group.find(row => !row.useSubjectRoom && row.room);
    const override = saved.room ?? (explicit ? explicit.room : '__inherit');
    const fallback = prefs.rooms[key] ?? (roomsFor(subject).length === 1 && roomSubj(roomsFor(subject)[0]) === key ? roomsFor(subject)[0].name : '');
    return { group, saved, override, room: override === '__inherit' ? fallback : override, hours: saved.hours ?? group[0]?.hrs ?? 2 };
  }

  function assignmentCards() {
    const e = env(), prefs = assignmentPrefs(), locked = ro() ? 'disabled' : '';
    const keys = [...new Set([...e.jdSubjects, ...state.jundam.map(row => subjGroup(row.subj))])].filter(Boolean);
    if (!keys.length) return '<p class="hint">학교사용환경설정에서 전담 교과를 먼저 선택하세요.</p>';
    return `<div class="jd-card-grid">${keys.map(key => {
      const rows = subjectRows(key);
      const teachers = [...new Set([...e.teachers.filter(t => teacherSubjects(t).includes(key)).map(t => t.name), ...rows.map(r => r.teacher || '')])];
      const [icon, tone] = paintTone[key] || ['✦', 'blue'];
      const classCount = new Set(rows.flatMap(r => activeClasses(r).map(n => r.grade + '-' + n))).size;
      const defaultRoom = prefs.rooms[key] ?? (roomsFor(key).length === 1 && roomSubj(roomsFor(key)[0]) === key ? roomsFor(key)[0].name : '');
      return `<article class="jd-course" data-tone="${tone}" data-course="${esc(key)}">
        <header><div class="jd-course-title"><span aria-hidden="true">${icon}</span><div><h3>${esc(subjName(key))}</h3><p>${esc(teachers.map(name => e.teachers.find(t => t.name === name)?.teacher || name || '담당 미지정').join(' · ') || '담당 미지정')}</p></div></div>
          <div class="jd-metrics"><b>${rows.reduce((sum, row) => sum + rowHours(row), 0)}<small>시수 / 주</small></b><b>${classCount}<small>학급</small></b></div></header>
        ${teachers.length ? teachers.map(name => `<section class="jd-teacher" data-teacher="${esc(name)}">
          ${teachers.length > 1 ? `<h4>${esc(e.teachers.find(t => t.name === name)?.teacher || name || '담당 미지정')}</h4>` : ''}
          ${GRADES.map(grade => {
            const legacy = rows.find(r => Number(r.grade) === grade && r.teacher === name);
            const subject = legacy?.subj || subjectsOf(grade).find(item => subjGroup(item.key) === key)?.key;
            const numbers = classNumbers(grade);
            if (!subject || !numbers.length) return '';
            const model = gradeAssignment(key, name, grade, subject);
            const mine = new Set(model.group.flatMap(activeClasses));
            const other = new Set(rows.filter(r => Number(r.grade) === grade && r.teacher !== name).flatMap(activeClasses));
            const duplicate = [...mine].some(n => other.has(n) ||
              model.group.filter(row => activeClasses(row).includes(n)).length > 1);
            const mixedHours = new Set(model.group.map(row => Number(row.hrs))).size > 1;
            const over = model.group.some(row => Number(row.hrs) > Math.ceil(ann(grade, row.subj) / STD_WEEKS));
            return `<div class="jd-grade" data-grade="${grade}" data-subject="${esc(subject)}">
              <b>${grade}학년</b><div class="jd-class-buttons">${numbers.map(n =>
                `<button type="button" data-assign-class="${n}" aria-label="${grade}학년 ${n}반${other.has(n) ? ' (다른 교사 배정)' : ''}" aria-pressed="${mine.has(n)}" ${locked || (other.has(n) && !mine.has(n) ? 'disabled' : '')}>${n}반</button>`).join('')}</div>
              <label>반당 <input type="number" min="0" max="20" step="1" data-assignment="hours" value="${esc(model.hours)}" ${locked}>시간</label>
              <details class="jd-room-override" ${model.override !== '__inherit' ? 'open' : ''}><summary>학년별 특별실</summary><select data-assignment="grade-room" aria-label="${grade}학년 특별실" ${locked}>${roomOptions(subject, model.override, true)}</select></details>
              ${duplicate || mixedHours || over ? `<p class="hint jd-grade-note">${[duplicate && '기존 중복 배정을 확인하세요.', mixedHours && '기존 반별 시수가 다릅니다. 시수를 바꾸면 이 학년의 담당 반에 함께 적용됩니다.', over && '교과 배정 시수 초과'].filter(Boolean).join(' ')}</p>` : ''}
            </div>`;
          }).join('')}
        </section>`).join('') : '<p class="hint">위 전담 설정에서 이 교과의 담당 교사를 지정하세요.</p>'}
        <footer><label>교과 기본 특별실 <select data-assignment="default-room" ${locked}>${roomOptions(key, defaultRoom)}</select></label></footer>
      </article>`;
    }).join('')}</div>`;
  }

  function assignmentChange(event, refresh) {
    if (ro()) return;
    const target = event.target, card = target.closest('[data-course]');
    if (!card) return;
    const key = card.dataset.course, field = target.dataset.assignment, prefs = assignmentPrefs();
    if (field === 'default-room') {
      prefs.rooms[key] = target.value;
      subjectRows(key).filter(row => row.useSubjectRoom).forEach(row => { row.room = target.value; });
    } else {
      const button = target.closest('[data-assign-class]');
      if (!button && !['hours', 'grade-room'].includes(field)) return;
      const line = target.closest('.jd-grade');
      const { subject } = line.dataset, grade = Number(line.dataset.grade);
      const teacher = target.closest('[data-teacher]').dataset.teacher;
      const model = gradeAssignment(key, teacher, grade, subject);
      const tag = gradeKey(teacher, key, grade);
      const saved = prefs.grades[tag] ||= {};
      if (button) {
        const n = Number(button.dataset.assignClass);
        const mine = model.group.filter(row => activeClasses(row).includes(n));
        if (mine.length) {
          saved.hours ??= model.hours;
          saved.room ??= model.override;
          for (const row of mine) {
            row.classes = (row.classes?.length ? row.classes.map(Number) : activeClasses(row)).filter(c => c !== n);
            if (!row.classes.length) state.jundam.splice(state.jundam.indexOf(row), 1);
          }
        } else {
          if (subjectRows(key).some(row => Number(row.grade) === grade && activeClasses(row).includes(n))) return;
          state.jundam.push({ teacher, grade, subj: subject, hrs: Number(model.hours), classes: [n], room: model.room, useSubjectRoom: model.override === '__inherit' });
        }
      } else if (field === 'hours') {
        if (target.value === '' || !target.checkValidity()) { target.value = model.hours; return; }
        saved.hours = Number(target.value);
        model.group.forEach(row => { row.hrs = saved.hours; });
      } else {
        saved.room = target.value;
        const current = gradeAssignment(key, teacher, grade, subject);
        model.group.forEach(row => { row.room = current.room; row.useSubjectRoom = current.override === '__inherit'; });
      }
    }
    const focusSelector = target.dataset.assignClass ? '[data-assign-class="' + target.dataset.assignClass + '"]' :
      '[data-assignment="' + field + '"]';
    const grade = target.closest('[data-grade]')?.dataset.grade;
    const teacher = target.closest('[data-teacher]')?.dataset.teacher;
    const host = card.closest('#tab-jd, #tab-env');
    changed();
    refresh();
    let scope = [...host.querySelectorAll('[data-course]')].find(el => el.dataset.course === key);
    if (grade && scope) {
      scope = [...scope.querySelectorAll('[data-teacher]')].find(el => el.dataset.teacher === teacher);
      scope = scope?.querySelector('[data-grade="' + grade + '"]');
    }
    scope?.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  const roomHours = name => state.jundam.filter(r => r.room === name).reduce((t, r) => t + rowHours(r), 0);
  const teacherHours = name => state.jundam.filter(r => r.teacher === name).reduce((t, r) => t + rowHours(r), 0);

  function listCard(kind) {
    const isRoom = kind === 'room', e = env();
    const items = isRoom ? e.rooms.map(r => r.name) : e.teachers.map(t => t.name);
    const sel = isRoom ? selRoom : selT, mode = isRoom ? modeRoom : modeT;
    const hrs = isRoom ? roomHours : teacherHours;
    const L = isRoom ? { set: '특별실 설정', ren: '이름 변경', col: '특별실', ph: '예: 과학실', none: '특별실이 없습니다' }
                     : { set: '전담 설정', ren: '전담명 변경', col: '전담명', ph: '예: 영어전담', none: '전담 교사가 없습니다' };
    return `<section class="sm-card">
      <div class="sm-btns"><button type="button" class="btn${mode === 'set' ? ' on' : ''}" data-mode="${kind}:set">${L.set}</button>
        <button type="button" class="btn${mode === 'rename' ? ' on' : ''}" data-mode="${kind}:rename">${L.ren}</button></div>
      <table class="sm-list sm-grid"><colgroup><col>${isRoom ? '<col class="c-s">' : '<col class="c-t">'}<col class="c-h"><col class="c-d"></colgroup>
      <thead><tr><th>${L.col}</th><th class="c">${isRoom ? '연결 교과' : '담당 교과'}</th><th class="c">시수</th><th class="c">관리</th></tr></thead><tbody>
      ${items.map((n, i) => `<tr class="${i === sel ? 'sel' : ''}" data-pick="${kind}:${i}">
        <td class="nm">${mode === 'rename' && i === sel ? `<input class="sm-in" data-rename="${kind}:${i}" maxlength="20" value="${esc(n)}">` : esc(n || '(이름 없음)')}</td>
        <td class="c">${isRoom ? roomSubjSel(i) : (`<select data-teacher-subject="${i}" aria-label="${esc(n)} 담당 교과" ${ro() ? 'disabled' : ''}>
          <option value="">자동 연결</option>${allSubj().filter(subject => e.jdSubjects.includes(subject.key) || subject.key === e.teachers[i].subject).map(subject =>
            `<option value="${subject.key}" ${e.teachers[i].subject === subject.key ? 'selected' : ''}>${esc(subject.name)}</option>`).join('')}</select>`)}</td>
        <td class="c num">${hrs(n)}</td><td class="c"><button type="button" class="sm-del" data-smrow="${kind}:${i}" title="${esc(n)} 삭제" aria-label="${esc(n)} 삭제">삭제</button></td></tr>`).join('') || `<tr><td colspan="4" class="hint">${L.none}</td></tr>`}
      </tbody></table>
      ${mode === 'set' ? `<div class="sm-tool"><input class="sm-in" data-newname="${kind}" maxlength="20" placeholder="${L.ph}">
          <button type="button" class="btn small primary" data-smadd="${kind}">추가</button>
          <button type="button" class="btn small" data-smdel="${kind}" ${sel < 0 ? 'disabled' : ''}>선택 삭제</button></div>
          <p class="hint">추가할 이름을 적고 '추가'(또는 Enter)를 누르세요. 지우려면 목록에서 고른 뒤 '선택 삭제'를 누릅니다.</p>` : ''}
      ${mode === 'rename' ? `<p class="hint">${sel < 0 ? '목록에서 이름을 바꿀 줄을 고르세요.' : '새 이름을 적고 Enter를 누르세요. 배정표와 시간표 배치에도 함께 바뀝니다.'}</p>` : ''}
    </section>`;
  }

  /** 특별실 줄의 '연결 교과' 고르기 (전담 교과 범위) */
  function roomSubjSel(i) {
    const e = env(), cur = roomSubj(e.rooms[i]), opts = e.jdSubjects.length ? e.jdSubjects.map(k => ({ key: k, name: subjName(k) })) : allSubj();
    const list = cur && !opts.some(o => o.key === cur) ? [...opts, { key: cur, name: subjName(cur) }] : opts;
    return `<select class="sm-sel" data-rsubj="${i}" ${ro() ? 'disabled' : ''}><option value="">공용</option>${list.map(o => `<option value="${o.key}" ${o.key === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  }
  /** 교과가 바뀌면 특별실을 그 교과의 특별실로 맞춤 (하나뿐이면 자동 선택) */
  function fitRoom(r) {
    const ok = roomsFor(r.subj);
    if (r.useSubjectRoom !== undefined || (r.room && ok.some(x => x.name === r.room))) return;
    const linked = env().rooms.filter(x => x.name && roomSubj(x) === subjGroup(r.subj));
    r.room = linked.length === 1 ? linked[0].name : '';
  }
  function paneRoom() {
    const e = env();
    return `<div class="env-head"><h2>특별실-전담 배정</h2><span class="hint">전담 교과 ${e.jdSubjects.length}개 · 특별실 ${e.rooms.length}곳 · 전담 ${e.teachers.length}명</span></div>
      <section class="jd-subj${e.jdSubjects.length ? '' : ' empty'}"><div class="jd-subj-h"><b>① 우리 학교 전담 교과</b>
        <span class="hint">${e.jdSubjects.length ? '아래 배정표의 교과와 특별실 연결에는 고른 교과만 나옵니다.' : '먼저 전담 교과를 고르세요. 고르기 전에는 모든 교과가 나옵니다.'}</span></div>
        <div class="jd-chips">${allSubj().map(s => `<label class="tg${e.jdSubjects.includes(s.key) ? ' on' : ''}"><input type="checkbox" data-jdsub="${s.key}" ${e.jdSubjects.includes(s.key) ? 'checked' : ''} ${ro() ? 'disabled' : ''}>${esc(s.name)}</label>`).join('')}</div></section>
      <div class="sm-two">${listCard('room')}${listCard('teacher')}</div>
      <p class="hint">특별실의 연결 교과와 전담교사의 담당 교과를 설정하세요. 기존 교사명과 배정 정보도 자동 연결에 사용됩니다.</p>
      <section class="env-sub"><h3>전담 과목 배정</h3>
        <p class="hint">담당 교사 아래의 학급을 눌러 배정하거나 해제합니다.</p>
        ${assignmentCards()}
      </section>`;
  }

  /** 특별실·전담 목록 고치기 (이름이 바뀌면 배정표·시간표 배치에도 반영) */
  function smAdd(kind) {
    const inp = $('tab-env').querySelector(`[data-newname="${kind}"]`), name = (inp && inp.value || '').trim(), E = env();
    if (!name) { if (inp) inp.focus(); return; }
    const list = kind === 'room' ? E.rooms : E.teachers;
    if (list.some(x => x.name === name)) { alert('같은 이름이 이미 있습니다.'); return; }
    list.push(kind === 'room' ? { name, note: '' } : { name });
    if (kind === 'room') selRoom = list.length - 1; else selT = list.length - 1;
    changed(); render();
    const again = $('tab-env').querySelector(`[data-newname="${kind}"]`); if (again) again.focus();
  }
  function smDel(kind) {
    const E = env(), i = kind === 'room' ? selRoom : selT, list = kind === 'room' ? E.rooms : E.teachers;
    if (i < 0 || !list[i]) return;
    const name = list[i].name, used = state.jundam.filter(r => (kind === 'room' ? r.room : r.teacher) === name).length;
    if (!confirm(`'${name}'을(를) 삭제할까요?${used ? `\n배정표 ${used}줄에서 ${kind === 'room' ? '특별실' : '전담'}이 비워집니다.` : ''}`)) return;
    list.splice(i, 1);
    state.jundam.forEach(r => { if (kind === 'room' && r.room === name) r.room = ''; if (kind === 'teacher' && r.teacher === name) r.teacher = ''; });
    if (kind === 'room') { renameRoomPrefs(name, ''); selRoom = -1; } else selT = -1;
    changed(); render();
  }
  function renameRoomPrefs(old, replacement) {
    const prefs = assignmentPrefs();
    for (const key of Object.keys(prefs.rooms)) if (prefs.rooms[key] === old) prefs.rooms[key] = replacement;
    for (const grade of Object.values(prefs.grades)) if (grade.room === old) grade.room = replacement;
  }
  function smRename(kind, i, value) {
    const E = env(), list = kind === 'room' ? E.rooms : E.teachers, name = value.trim(), old = list[i] && list[i].name;
    if (!list[i] || !name || name === old) { if (kind === 'room') modeRoom = ''; else modeT = ''; render(); return; }
    if (list.some((x, k) => k !== i && x.name === name)) { alert('같은 이름이 이미 있습니다.'); return; }
    list[i].name = name;
    state.jundam.forEach(r => { if (kind === 'room' && r.room === old) r.room = name; if (kind === 'teacher' && r.teacher === old) r.teacher = name; });
    if (kind === 'room') renameRoomPrefs(old, name);
    else {
      const prefs = assignmentPrefs();
      for (const key of Object.keys(prefs.grades)) {
        const [teacher, subject, grade] = JSON.parse(key);
        if (teacher !== old) continue;
        prefs.grades[gradeKey(name, subject, grade)] = prefs.grades[key];
        delete prefs.grades[key];
      }
    }
    if (kind === 'room') state.schedule.forEach(s => { if (s.kind === old) s.kind = name; });
    if (kind === 'room') modeRoom = ''; else modeT = '';
    changed(); render();
  }

  /* 검정교과: 국정 교과는 고정(선택 불가)으로 따로 보여 주고, 검정 교과는 학년 × 교과 표(가로)로 출판사만 고름 */
  const NATIONAL = { 1: '전 교과', 2: '전 교과', 3: ['kor', 'mor'], 4: ['kor', 'mor'], 5: ['kor', 'mor'], 6: ['kor', 'mor'] };
  const BOOK_COLS = [['math', '수학'], ['soc', '사회'], ['sci', '과학'], ['prac', '실과'], ['mus', '음악'], ['art', '미술'], ['pe', '체육'], ['eng', '영어']];
  function paneBook() {
    const e = env();
    const subName = (g, k) => (subjectsOf(g).find(s => s.key === k) || {}).name || k;
    const has = (g, k) => subjectsOf(g).some(s => s.key === k);
    const done = GRADES.filter(g => g >= 3).reduce((t, g) => t + BOOK_COLS.filter(([k]) => has(g, k) && (e.books[g] || {})[k]).length, 0);
    const all = GRADES.filter(g => g >= 3).reduce((t, g) => t + BOOK_COLS.filter(([k]) => has(g, k)).length, 0);
    const pubSel = (g, k) => {
      const cur = (e.books[g] || {})[k] || '';
      const opts = PUBLISHERS.includes(cur) || !cur ? PUBLISHERS : [cur, ...PUBLISHERS];
      return `<select class="bk-sel${cur ? ' set' : ''}" data-pub="${g}" data-s="${k}" aria-label="${g}학년 ${subName(g, k)} 출판사">
        <option value="">선택</option>${opts.map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__etc">직접 입력…</option></select>`;
    };
    return `<div class="env-head"><h2>검정교과 설정</h2><span class="hint">출판사 ${done} / ${all}개 선택</span></div>
      <section class="bk-nat">
        <div class="bk-nat-h"><b>국정 교과</b><span>국가가 정한 교과서를 쓰는 교과라 선택할 것이 없습니다.</span></div>
        <div class="bk-nat-list">${GRADES.map(g => { const n = NATIONAL[g]; return `<span class="bk-nat-g"><em>${g}학년</em>${Array.isArray(n) ? n.map(k => `<i>${esc(subName(g, k))}</i>`).join('') : `<i>${n}</i>`}</span>`; }).join('')}</div>
      </section>
      <section class="env-sub">
        <div class="env-sub-h"><h3>검정 교과 출판사</h3><span class="hint">3~6학년 · 학교에서 고른 검정 교과서의 출판사를 정합니다</span></div>
        <div class="tbl-scroll"><table class="bk-grid"><thead><tr><th>학년</th>${BOOK_COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
        ${GRADES.filter(g => g >= 3).map(g => `<tr><th>${g}학년</th>${BOOK_COLS.map(([k]) => has(g, k) ? `<td>${pubSel(g, k)}</td>` : '<td class="na">해당 없음</td>').join('')}</tr>`).join('')}
        </tbody></table></div>
        <p class="hint">출판사 목록은 초등 검정 교과서를 내는 출판사입니다. 목록에 없으면 '직접 입력…'을 고르세요. 교과별 실제 발행사는 교육청 선정 목록으로 확인해 주세요.</p>
      </section>`;
  }

  /* ---------- 범교과-주제어 (스쿨마스터 '주제어(범교과, 7대 안전) 등록 및 편집'과 같은 구성) ---------- */
  const DEF_TOPICS = [['안전·건강교육', '(7대 안전)', 51], ['안전·건강교육', '양성평등교육', 15], ['안전·건강교육', '보건교육', 0],
    ['안전·건강교육', '건강한 식생활 및 영양교육', 7], ['안전·건강교육', '생명존중 및 자살예방 교육', 6], ['안전·건강교육', '학교폭력 예방교육', 11],
    ['인성교육', '인성교육', 11], ['진로교육', '진로교육', 8], ['민주시민교육', '민주시민교육', 2], ['인권교육', '장애인식 개선교육', 2],
    ['다문화교육', '다문화교육', 10], ['통일교육', '통일교육', 5], ['독도교육', '독도교육', 10], ['경제·금융교육', '경제·금융교육', ''],
    ['환경·지속가능발전교육', '환경·지속가능발전교육', 10]].map(([topic, sub, hours]) => ({ topic, sub, hours }));
  const DEF_SAFETY = [['생활안전', '시설 및 제품이용 안전, 신체활동 안전, 유괴 및 미아사고 예방', 12],
    ['교통안전', '보행자안전, 자전거안전, 오토바이안전, 자동차안전, 대중교통안전', 11],
    ['폭력 및 신변안전', '학교폭력, 성폭력, 자살, 가정폭력, 아동학대', 8], ['약물 및 사이버중독', '약물중독, 사이버중독', 10],
    ['재난안전', '화재, 사회재난, 자연재난', 6], ['직업안전', '직업안전의식, 직업병, 직업안전의 예방 및 관리, 산업재해의 이해와 예방', 2],
    ['응급처치', '응급처치의 이해와 필요성, 심폐소생술, 상황별 응급처치', 2]].map(([name, mid, hours]) => ({ name, mid, hours }));
  const clone = o => JSON.parse(JSON.stringify(o));
  let themeGrade = 1, selT1 = -1, selT2 = -1;

  function themeCfg() {
    const e = env();
    if (!e.themeCfg) e.themeCfg = { mode: 'same', same: { topics: clone(DEF_TOPICS), safety: clone(DEF_SAFETY) }, byGrade: {} };
    return e.themeCfg;
  }
  /** 지금 고치는 묶음: 전학년 동일 → same, 학년별 → byGrade[학년] (처음엔 전학년 값을 복사) */
  function themeSet() {
    const c = themeCfg();
    if (c.mode !== 'grade') return c.same;
    if (!c.byGrade[themeGrade]) c.byGrade[themeGrade] = clone(c.same);
    return c.byGrade[themeGrade];
  }
  const safetySum = set => set.safety.reduce((t, s) => t + (Number(s.hours) || 0), 0);
  const isSafetyRow = t => String(t.sub || '').replace(/\s+/g, '') === '(7대안전)';

  function paneTheme() {
    const c = themeCfg(), set = themeSet(), sSum = safetySum(set);
    const hrsOf = t => isSafetyRow(t) ? sSum : t.hours;
    const total = set.topics.reduce((t, x) => t + (Number(hrsOf(x)) || 0), 0);
    const left = [...set.topics, { topic: '', sub: '', hours: '' }].map((t, i) => {
      const blank = i === set.topics.length, auto = !blank && isSafetyRow(t);
      return `<tr class="${i === selT1 ? 'sel' : ''}${blank ? ' blank' : ''}" data-row="t1:${i}">
        <td><input data-t1="${i}" data-f="topic" maxlength="30" value="${esc(t.topic)}" ${blank ? 'placeholder="새 주제"' : ''}></td>
        <td><input data-t1="${i}" data-f="sub" maxlength="40" value="${esc(t.sub)}"></td>
        <td class="h">${auto ? `<span class="auto" title="오른쪽 7대 안전 시수의 합계">${sSum}</span>` : `<input data-t1="${i}" data-f="hours" type="number" min="0" max="999" value="${t.hours ?? ''}">`}</td></tr>`;
    }).join('');
    const right = [...set.safety, { name: '', mid: '', hours: '' }].map((s, i) => {
      const blank = i === set.safety.length;
      return `<tr class="${i === selT2 ? 'sel' : ''}${blank ? ' blank' : ''}" data-row="t2:${i}">
        <td><input data-t2="${i}" data-f="name" maxlength="20" value="${esc(s.name)}" ${blank ? 'placeholder="새 영역"' : ''}></td>
        <td><textarea data-t2="${i}" data-f="mid" maxlength="200" rows="2">${esc(s.mid)}</textarea></td>
        <td class="h"><input data-t2="${i}" data-f="hours" type="number" min="0" max="999" value="${s.hours ?? ''}"></td></tr>`;
    }).join('');
    return `<div class="env-head"><h2>범교과-주제어 설정</h2><span class="hint">주제어(범교과, 7대 안전) 등록 및 편집</span></div>
      <div class="th-top">
        <div class="th-mode" role="radiogroup">
          <label><input type="radio" name="thMode" value="same" ${c.mode !== 'grade' ? 'checked' : ''}> 전학년 동일하게</label>
          <label><input type="radio" name="thMode" value="grade" ${c.mode === 'grade' ? 'checked' : ''}> 학년별로 다르게</label>
        </div>
        ${c.mode === 'grade' ? `<div class="th-grades">${GRADES.map(g => `<button type="button" class="${g === themeGrade ? 'on' : ''}" data-thg="${g}">${g}학년</button>`).join('')}</div>` : ''}
        <button type="button" class="btn th-prev" data-act="th-prev">작년자료 불러오기</button>
      </div>
      <div class="th-two">
        <section class="th-box">
          <table class="th-tbl"><thead><tr><th>범교과 학습 주제</th><th>세부 주제</th><th class="h">기준시수</th></tr></thead><tbody>${left}</tbody>
            <tfoot><tr><th colspan="2">합계${c.mode === 'grade' ? ` (${themeGrade}학년)` : ''}</th><td class="h"><b>${total}</b></td></tr></tfoot></table>
          <div class="th-foot"><span class="th-mv"><button type="button" class="btn small" data-mv="t1:-1" title="위로">▲</button><button type="button" class="btn small" data-mv="t1:1" title="아래로">▼</button></span>
            <span class="hint">새로 추가하려면 맨 아래 빈칸에 입력하면 됩니다.<br>삭제는 내용을 비워 두면 됩니다.</span>
            <button type="button" class="btn small" data-reset="t1">기본값 복원</button></div>
        </section>
        <section class="th-box">
          <table class="th-tbl"><thead><tr><th>7대 안전</th><th>중분류 <small>(쉼표로 연결 가능)</small></th><th class="h">기준시수</th></tr></thead><tbody>${right}</tbody>
            <tfoot><tr><th colspan="2">합계 (왼쪽 '(7대 안전)' 시수로 자동 반영)</th><td class="h"><b>${sSum}</b></td></tr></tfoot></table>
          <div class="th-foot"><span class="th-mv"><button type="button" class="btn small" data-mv="t2:-1" title="위로">▲</button><button type="button" class="btn small" data-mv="t2:1" title="아래로">▼</button></span>
            <span class="hint">중분류는 쉼표로 구분해서 입력하면 됩니다.<br>새로 추가하려면 맨 아래 빈칸에 입력하면 됩니다.</span>
            <button type="button" class="btn small" data-reset="t2">기본값 복원</button></div>
        </section>
      </div>
      <p class="hint">※ 학교 실정에 맞게 고칠 수 있습니다. 줄을 누른 뒤 ▲▼로 순서를 바꿉니다.</p>`;
  }

  /** 작년(학년도 − 1) 범교과 설정 찾기: ① 이 문서에 남겨 둔 학년도별 사본 ② 클라우드의 작년 교육과정 문서 */
  async function prevYearEnv() {
    const y = Number(state.school.year) - 1;
    const arch = state.envArchive && state.envArchive[y];
    if (arch) return { env: arch, from: `이 문서의 ${y}학년도 기록` };
    if (window.Cloud && Cloud.ready && Cloud.listPlans) {
      const plans = (await Cloud.listPlans()).filter(p => Number(p.year) === y);
      for (const p of plans) {
        try { const s = JSON.parse(p.stateJson || '{}'); if (s.env) return { env: s.env, from: `'${p.title || '교육과정'}' (${y}학년도)` }; } catch (e) { /* 다음 문서 */ }
      }
    }
    return null;
  }
  async function loadPrevThemes() {
    const y = Number(state.school.year) - 1;
    let found;
    try { found = await prevYearEnv(); } catch (e) { alert('작년 자료를 찾지 못했습니다: ' + e.message); return; }
    if (!found || !found.env.themeCfg) { alert(`${y}학년도 범교과-주제어 자료가 없습니다.\n(${y}학년도에 이 사이트에서 설정한 자료가 있으면 불러올 수 있습니다.)`); return; }
    if (!confirm(`${found.from}의 범교과-주제어 설정을 불러올까요?\n지금 화면의 내용은 바뀝니다.`)) return;
    env().themeCfg = clone(found.env.themeCfg); selT1 = selT2 = -1;
    changed(); render();
  }

  /* ---------- 일과시간 (스쿨마스터 '일과시간 설정' + 빠른 설정·하루 흐름 막대) ----------
   *  env.bellCfg = { mode:'same'|'grade', same:{ periods:[{start,end}×10] }, byGrade:{학년:{periods}}, gen:{start,len,brk,lunchAfter,lunchLen,count}, push:true }
   *  env.bell.rows 는 전학년(또는 1학년) 시각을 교시 줄로 옮겨 둔 것 → 시간표 화면·선생님 공유에 씀 */
  const MAXP = 10;
  const emptyPeriods = () => Array.from({ length: MAXP }, () => ({ start: '', end: '' }));
  function genPeriods(g) {
    const out = emptyPeriods(); let t = t2m(g.start);
    for (let p = 1; p <= Math.min(MAXP, Number(g.count) || 6); p++) {
      out[p - 1] = { start: m2t(t), end: m2t(t + Number(g.len)) };
      t += Number(g.len) + (p === Number(g.lunchAfter) ? Number(g.lunchLen) : Number(g.brk));
    }
    return out;
  }
  function bellCfg() {
    const e = env();
    if (!e.bellCfg) {
      const gen = { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunchLen: 50, count: 6 };
      // 예전 설정(교시 줄)이 있으면 옮겨 옴
      const old = ((e.bell && e.bell.rows) || []).filter(r => r.kind === 'class');
      const periods = emptyPeriods();
      if (old.length) old.slice(0, MAXP).forEach((r, i) => { periods[i] = { start: r.start, end: r.end }; });
      e.bellCfg = { mode: 'same', same: { periods: old.length ? periods : genPeriods(gen) }, byGrade: {}, gen, push: true };
    }
    return e.bellCfg;
  }
  let bellGrade = 1, bellDirty = false;
  function bellSet() {
    const c = bellCfg();
    if (c.mode !== 'grade') return c.same;
    if (!c.byGrade[bellGrade]) c.byGrade[bellGrade] = clone(c.same);
    return c.byGrade[bellGrade];
  }
  /** 시간표 화면과 선생님 공유용 교시 줄 갱신 */
  function syncBellRows() {
    const c = bellCfg(), set = c.mode === 'grade' ? (c.byGrade[1] || c.same) : c.same, e = env();
    e.bell = e.bell || {};
    e.bell.rows = set.periods.map((p, i) => ({ label: `${i + 1}교시`, start: p.start, end: p.end, kind: 'class' })).filter(r => r.start && r.end);
  }
  function bellCheck(periods) {
    const issues = {};
    periods.forEach((p, i) => {
      if (!p.start || !p.end) return;
      if (t2m(p.end) <= t2m(p.start)) issues[i] = '끝나는 시각이 시작보다 빠릅니다';
      const prev = periods.slice(0, i).reverse().find(x => x.start && x.end);
      if (prev && t2m(p.start) < t2m(prev.end)) issues[i] = '앞 교시와 시간이 겹칩니다';
    });
    return issues;
  }

  function paneBell() {
    const c = bellCfg(), set = bellSet(), g = c.gen, ps = set.periods, issues = bellCheck(ps);
    const used = ps.map((p, i) => ({ ...p, n: i + 1 })).filter(p => p.start && p.end);
    const first = used.length ? t2m(used[0].start) : 540, last = used.length ? t2m(used[used.length - 1].end) : 900;
    const span = Math.max(60, last - first);
    const pct = m => ((m - first) / span * 100).toFixed(2);
    const hours = []; for (let h = Math.ceil(first / 60); h * 60 <= last; h++) hours.push(h);
    const teach = used.reduce((t, p) => t + Math.max(0, t2m(p.end) - t2m(p.start)), 0);
    const gapAfter = i => { const p = ps[i], nx = ps.slice(i + 1).find(x => x.start && x.end); if (!p.end || !nx) return null; return t2m(nx.start) - t2m(p.end); };
    const row = i => {
      const p = ps[i], dur = p.start && p.end ? t2m(p.end) - t2m(p.start) : null, gap = gapAfter(i);
      return `<div class="bl-row${issues[i] ? ' bad' : ''}${p.start ? '' : ' off'}">
          <span class="bl-n">${i + 1}<small>교시</small></span>
          <input type="time" step="300" data-bp="${i}" data-f="start" value="${p.start}" aria-label="${i + 1}교시 시작">
          <span class="bl-tilde">~</span>
          <input type="time" step="300" data-bp="${i}" data-f="end" value="${p.end}" aria-label="${i + 1}교시 끝">
          <span class="bl-dur">${dur !== null && dur > 0 ? dur + '분' : ''}</span>
          ${p.start || p.end ? `<button type="button" class="x" data-bclear="${i}" title="${i + 1}교시 비우기">✕</button>` : '<span></span>'}
          ${issues[i] ? `<em class="bl-warn">${issues[i]}</em>` : ''}
        </div>${gap !== null && gap > 0 ? `<div class="bl-gap${gap >= 30 ? ' lunch' : ''}">${gap >= 30 ? '점심' : '쉬는 시간'} ${gap}분</div>` : ''}`;
    };
    return `<div class="env-head"><h2>일과시간 설정</h2><span class="hint">정한 시각은 시간표 편성·시간표 배치·한국어학급 운영 시간표의 교시 칸에 나옵니다</span></div>
      <div class="th-top">
        <div class="th-mode" role="radiogroup">
          <label><input type="radio" name="blMode" value="same" ${c.mode !== 'grade' ? 'checked' : ''}> 전학년 동일하게</label>
          <label><input type="radio" name="blMode" value="grade" ${c.mode === 'grade' ? 'checked' : ''}> 학년별로 다르게</label>
        </div>
        ${c.mode === 'grade' ? `<div class="th-grades">${GRADES.map(x => `<button type="button" class="${x === bellGrade ? 'on' : ''}" data-blg="${x}">${x}학년</button>`).join('')}</div>` : ''}
        <button type="button" class="btn th-prev" data-act="bl-prev">작년자료 불러오기</button>
      </div>

      <section class="bl-quick">
        <h3>빠른 설정 <small>숫자만 넣고 '적용'을 누르면 ${c.mode === 'grade' ? `${bellGrade}학년` : '전학년'} 교시 시각이 한 번에 채워집니다</small></h3>
        <div class="bl-quick-row">
          <label>1교시 시작<input type="time" step="300" data-bg="start" value="${g.start}"></label>
          <label>수업<span class="bl-num"><input type="number" min="20" max="90" step="5" data-bg="len" value="${g.len}">분</span></label>
          <label>쉬는 시간<span class="bl-num"><input type="number" min="0" max="60" step="5" data-bg="brk" value="${g.brk}">분</span></label>
          <label>점심<span class="bl-num"><input type="number" min="1" max="${MAXP}" data-bg="lunchAfter" value="${g.lunchAfter}">교시 뒤</span></label>
          <label>점심 시간<span class="bl-num"><input type="number" min="0" max="120" step="5" data-bg="lunchLen" value="${g.lunchLen}">분</span></label>
          <label>교시 수<span class="bl-num"><input type="number" min="1" max="${MAXP}" data-bg="count" value="${g.count}">교시</span></label>
          <button type="button" class="btn primary" data-act="bl-gen">적용</button>
        </div>
      </section>

      <section class="bl-day">
        <div class="bl-day-h"><b>하루 흐름</b>
          <span class="bl-sum"><em>${used.length}개 교시</em><em>수업 ${Math.floor(teach / 60)}시간${teach % 60 ? ' ' + (teach % 60) + '분' : ''}</em><em>등교 ${used.length ? used[0].start : '-'}</em><em>하교 ${used.length ? used[used.length - 1].end : '-'}</em></span></div>
        <div class="bl-track-wrap">
          <div class="bl-track">
            ${used.map((p, k) => { const nx = used[k + 1]; const gap = nx ? t2m(nx.start) - t2m(p.end) : 0;
              return `<span class="bl-blk" style="left:${pct(t2m(p.start))}%;width:${((t2m(p.end) - t2m(p.start)) / span * 100).toFixed(2)}%" title="${p.n}교시 ${p.start}~${p.end}">${p.n}<small>교시</small></span>` +
                (gap >= 30 ? `<span class="bl-lunch" style="left:${pct(t2m(p.end))}%;width:${(gap / span * 100).toFixed(2)}%" title="점심 ${gap}분">점심</span>` : ''); }).join('')}
          </div>
          <div class="bl-axis">${hours.map(h => `<span style="left:${pct(h * 60)}%">${h}시</span>`).join('')}</div>
        </div>
      </section>
      <section class="bl-list">
        <div class="bl-list-h"><b>교시별 시각</b>
          <label class="bl-push"><input type="checkbox" data-bpush ${c.push !== false ? 'checked' : ''}> 시각을 바꾸면 뒤 교시도 함께 밀기</label></div>
        <div class="bl-cols">${[0, 1, 2, 3, 4].map(row).join('')}</div>
        <div class="bl-cols">${[5, 6, 7, 8, 9].map(row).join('')}</div>
      </section>`;
  }

  async function loadPrevBell() {
    const y = Number(state.school.year) - 1;
    let found;
    try { found = await prevYearEnv(); } catch (e) { alert('작년 자료를 찾지 못했습니다: ' + e.message); return; }
    if (!found || !found.env.bellCfg) { alert(`${y}학년도 일과시간 자료가 없습니다.\n(${y}학년도에 이 사이트에서 설정한 자료가 있으면 불러올 수 있습니다.)`); return; }
    if (!confirm(`${found.from}의 일과시간을 불러올까요?\n지금 화면의 시각은 바뀝니다.`)) return;
    env().bellCfg = clone(found.env.bellCfg);
    syncBellRows(); changed(); render();
  }

  /* ---------- 고치기 ---------- */
  const root = $('tab-env');
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-pane]');
    if (nav) { pane = nav.dataset.pane; sessionStorage.setItem('envPane', pane); render(); return; }
    if (e.target.closest('[data-goroom]')) { e.preventDefault(); pane = 'room'; sessionStorage.setItem('envPane', pane); render(); return; }
    if (ro()) return;
    const E = env();
    // 특별실·전담 목록: 줄 고르기 / 설정·이름 변경 모드 / 추가·삭제
    const pick = e.target.closest('[data-pick]');
    if (pick && !e.target.closest('input, select') && !e.target.closest('[data-smrow]')) {
      const [k, i] = pick.dataset.pick.split(':');
      if (k === 'room') selRoom = Number(i); else selT = Number(i);
      render();
      const r = root.querySelector(`[data-rename="${k}:${i}"]`); if (r) { r.focus(); r.select(); }
      return;
    }
    const md = e.target.closest('[data-mode]');
    if (md) {
      const [k, m] = md.dataset.mode.split(':');
      if (k === 'room') modeRoom = modeRoom === m ? '' : m; else modeT = modeT === m ? '' : m;
      render();
      const f = root.querySelector(m === 'set' ? `[data-newname="${k}"]` : `[data-rename^="${k}:"]`); if (f) { f.focus(); if (f.select) f.select(); }
      return;
    }
    // 범교과-주제어: 학년 고르기 · ▲▼ · 기본값 복원 · 작년자료
    const tg = e.target.closest('[data-thg]'); if (tg) { themeGrade = Number(tg.dataset.thg); selT1 = selT2 = -1; render(); return; }
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const [k, d] = mv.dataset.mv.split(':'), set = themeSet(), arr = k === 't1' ? set.topics : set.safety;
      const i = k === 't1' ? selT1 : selT2, j = i + Number(d);
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      if (k === 't1') selT1 = j; else selT2 = j;
      changed(); render(); return;
    }
    const rs = e.target.closest('[data-reset]');
    if (rs) {
      if (!confirm('기본값으로 되돌릴까요? 고친 내용은 사라집니다.')) return;
      const set = themeSet();
      if (rs.dataset.reset === 't1') { set.topics = clone(DEF_TOPICS); selT1 = -1; } else { set.safety = clone(DEF_SAFETY); selT2 = -1; }
      changed(); render(); return;
    }
    if (e.target.closest('[data-act="th-prev"]')) { loadPrevThemes(); return; }
    // 일과시간
    const bg = e.target.closest('[data-blg]'); if (bg) { bellGrade = Number(bg.dataset.blg); render(); return; }
    if (e.target.closest('[data-act="bl-prev"]')) { loadPrevBell(); return; }
    if (e.target.closest('[data-act="bl-gen"]')) {
      const set = bellSet();
      if (set.periods.some(p => p.start) && !confirm('빠른 설정 값으로 교시 시각을 모두 다시 채울까요?')) return;
      set.periods = genPeriods(bellCfg().gen); syncBellRows(); changed(); render(); return;
    }
    const bc = e.target.closest('[data-bclear]');
    if (bc) { bellSet().periods[Number(bc.dataset.bclear)] = { start: '', end: '' }; syncBellRows(); changed(); render(); return; }
    const sa = e.target.closest('[data-smadd]'); if (sa) { smAdd(sa.dataset.smadd); return; }
    const sd = e.target.closest('[data-smdel]'); if (sd) { smDel(sd.dataset.smdel); return; }
    const sr = e.target.closest('[data-smrow]'); if (sr) { const [k, i] = sr.dataset.smrow.split(':'); if (k === 'room') selRoom = Number(i); else selT = Number(i); smDel(k); return; }
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (e.target.closest('[data-assign-class]')) { assignmentChange(e, render); return; }
    if (add) {
      if (add === 'special') E.special.push({ name: '', teacher: '', students: 0 });
      if (add === 'room') E.rooms.push({ name: '', note: '' });
      if (add === 'theme') E.themes.push({ name: '', keywords: '', subjects: '', hours: {} });
      if (add === 'bell') { const last = E.bell.rows[E.bell.rows.length - 1]; const s = last ? t2m(last.end) : t2m(E.bell.start); E.bell.rows.push({ label: '', start: m2t(s), end: m2t(s + 40), kind: 'etc' }); }
      changed(); render(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const i = Number(del.dataset.i), k = del.dataset.del;
      const arr = { special: E.special, room: E.rooms, theme: E.themes, bell: E.bell.rows }[k];
      arr.splice(i, 1); changed(); render(); return;
    }
    if (e.target.closest('[data-act="bell-make"]')) {
      if (E.bell.rows.length && !confirm('지금 시각표를 새로 만들까요? 직접 고친 내용은 사라집니다.')) return;
      E.bell.rows = makeBell(E.bell); changed(); render();
    }
  });
  root.addEventListener('change', e => {
    if (ro()) return;
    const t = e.target, d = t.dataset, E = env(), v = t.value;
    if (d.cnt) { state.school.classes[d.cnt] = Math.max(0, Math.min(20, Number(v) || 0)); changed(); render(); return; }
    if (d.ci) { (E.classInfo[d.ci] = E.classInfo[d.ci] || {})[d.f] = v.trim(); changed(); return; }
    if (d.jdsub) {
      const on = t.checked, k = d.jdsub;
      if (!on) { const used = state.jundam.filter(r => r.subj === k).length;
        if (used && !confirm(`'${subjName(k)}'을(를) 전담 교과에서 뺄까요?\n이미 배정된 ${used}줄은 그대로 남습니다.`)) { t.checked = true; return; } }
      E.jdSubjects = on ? [...new Set([...E.jdSubjects, k])] : E.jdSubjects.filter(x => x !== k);
      E.jdSubjects.sort((a, b) => allSubj().findIndex(s => s.key === a) - allSubj().findIndex(s => s.key === b));
      changed(); render(); return;
    }
    if (d.rsubj !== undefined) { E.rooms[d.rsubj].subj = v; state.jundam.forEach(fitRoom); changed(); render(); return; }
    if (d.sp) { E.special[d.sp][d.f] = d.f === 'students' ? Number(v) || 0 : v.trim(); changed(); render(); return; }
    if (d.room) { const old = E.rooms[d.room].name; E.rooms[d.room][d.f] = v.trim(); if (d.f === 'name') { state.jundam.forEach(r => { if (r.room === old) r.room = v.trim(); }); renameRoomPrefs(old, v.trim()); } changed(); return; }
    if (d.teacherSubject !== undefined) { E.teachers[d.teacherSubject].subject = v; changed(); render(); return; }
    if (d.assignment) { assignmentChange(e, render); return; }
    if (d.bk) {
      const g = d.bk; E.bookSubjects[g] = [...root.querySelectorAll(`[data-bk="${g}"]:checked`)].map(x => x.value);
      changed(); render(); return;
    }
    if (d.pub) {
      let val = v;
      if (val === '__etc') { val = (prompt('출판사 이름을 입력하세요') || '').trim(); if (!val) { render(); return; } }
      (E.books[d.pub] = E.books[d.pub] || {})[d.s] = val; changed(); render(); return;
    }
    if (t.name === 'blMode') { const c = bellCfg(); c.mode = v; if (v === 'grade') bellSet(); syncBellRows(); changed(); render(); return; }
    if (d.bg) { const gg = bellCfg().gen; gg[d.bg] = t.type === 'number' ? Math.max(0, Number(v) || 0) : v; changed(); return; }
    if (d.bpush !== undefined) { bellCfg().push = t.checked; changed(); return; }
    if (d.bp !== undefined) {
      // 시각 고치기: '뒤 교시도 함께 밀기'면 바뀐 만큼 뒤 교시를 모두 옮김. 시작만 넣으면 끝은 수업 시간만큼 자동
      const c = bellCfg(), ps = bellSet().periods, i = Number(d.bp), p = ps[i], old = p[d.f];
      p[d.f] = v;
      if (d.f === 'start' && v && !p.end) p.end = m2t(t2m(v) + Number(c.gen.len || 40));
      if (old && v && c.push !== false) {
        const delta = t2m(v) - t2m(old);
        if (delta) {
          if (d.f === 'start' && p.end) p.end = m2t(t2m(p.end) + delta);
          ps.slice(i + 1).forEach(x => { if (x.start) x.start = m2t(t2m(x.start) + delta); if (x.end) x.end = m2t(t2m(x.end) + delta); });
        }
      }
      syncBellRows(); changed(); bellDirty = true;   // 칸을 벗어날 때 다시 그림(입력 중 끊김 방지)
      return;
    }
    if (t.name === 'thMode') { const c = themeCfg(); c.mode = v; if (v === 'grade') themeSet(); selT1 = selT2 = -1; changed(); render(); return; }
    if (d.t1 !== undefined || d.t2 !== undefined) {
      // 맨 아래 빈 줄에 쓰면 추가, 한 줄을 모두 비우면 삭제
      const k = d.t1 !== undefined ? 't1' : 't2', i = Number(d[k]), set = themeSet();
      const arr = k === 't1' ? set.topics : set.safety;
      const val = d.f === 'hours' ? (v === '' ? '' : Number(v) || 0) : v.trim();
      if (i >= arr.length) { if (val === '') return; arr.push(k === 't1' ? { topic: '', sub: '', hours: '' } : { name: '', mid: '', hours: '' }); }
      arr[i][d.f] = val;
      const row = arr[i], empty = k === 't1' ? !row.topic && !row.sub && row.hours === '' : !row.name && !row.mid && row.hours === '';
      if (empty) { arr.splice(i, 1); if (k === 't1') selT1 = -1; else selT2 = -1; }
      changed(); renderKeepFocus(); return;
    }
    if (d.bell) { E.bell[d.bell] = t.type === 'number' ? Number(v) || 0 : v; changed(); return; }
    if (d.br) { E.bell.rows[d.br][d.f] = v; changed(); render(); return; }
  });

  // 칸을 고친 뒤 Tab·클릭으로 옮겨 간 칸에 커서를 그대로 둔 채 다시 그림(합계 갱신)
  function renderKeepFocus() {
    setTimeout(() => {
      const a = document.activeElement, ds = a && a.dataset;
      const sel = ds && ds.f && (ds.t1 !== undefined ? `[data-t1="${ds.t1}"][data-f="${ds.f}"]` : ds.t2 !== undefined ? `[data-t2="${ds.t2}"][data-f="${ds.f}"]` : null);
      render();
      const n = sel && root.querySelector(sel); if (n) n.focus();
    }, 0);
  }
  // 범교과 표: 줄의 칸을 누르면 그 줄을 고름(▲▼ 대상) — 다시 그리지 않고 표시만 바꿈
  root.addEventListener('focusin', e => {
    const tr = e.target.closest('[data-row]'); if (!tr || tr.classList.contains('blank')) return;
    const [k, i] = tr.dataset.row.split(':');
    if (k === 't1') selT1 = Number(i); else selT2 = Number(i);
    tr.parentElement.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); tr.classList.add('sel');
  });
  // 일과시간: 시각 칸을 벗어나면 다시 그리고, 옮겨 간 칸에 커서를 둠
  root.addEventListener('focusout', e => {
    if (e.target.dataset.bp === undefined || !bellDirty) return;
    setTimeout(() => {
      if (!bellDirty) return; bellDirty = false;
      const a = document.activeElement, ds = a && a.dataset;
      const sel = ds && ds.bp !== undefined ? `[data-bp="${ds.bp}"][data-f="${ds.f}"]` : null;
      render();
      const n = sel && root.querySelector(sel); if (n) n.focus();
    }, 0);
  });
  // Enter: 새 이름 추가 / 이름 변경 확정, Esc: 이름 변경 취소
  root.addEventListener('keydown', e => {
    const d = e.target.dataset;
    if (e.key === 'Enter' && d.newname) { e.preventDefault(); smAdd(d.newname); }
    if (e.key === 'Enter' && d.rename) { e.preventDefault(); const [k, i] = d.rename.split(':'); smRename(k, Number(i), e.target.value); }
    if (e.key === 'Escape' && d.rename) { if (d.rename.startsWith('room')) modeRoom = ''; else modeT = ''; render(); }
  });
  root.addEventListener('focusout', e => {
    const d = e.target.dataset;
    if (d.rename && e.target.isConnected) { const [k, i] = d.rename.split(':'); smRename(k, Number(i), e.target.value); }
  });

  window.SubjectAssignments = { assignmentCards, activeClasses, rowHours };
  const assignmentRoot = $('tab-jd');
  assignmentRoot.addEventListener('click', e => {
    if (e.target.closest('[data-assign-class]')) assignmentChange(e, renderJd);
  });
  assignmentRoot.addEventListener('change', e => {
    if (e.target.dataset.assignment) assignmentChange(e, renderJd);
  });
  RENDER.env = render;
})();
