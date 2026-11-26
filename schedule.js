'use strict';

/* ---------- 학교사용환경설정 연결 ---------- */
/** 일과시간 설정의 p교시 시각 "08:50~09:30" (없으면 '') */
function periodTime(p) {
  const rows = (state.env && state.env.bell && state.env.bell.rows) || [];
  const cls = rows.filter(r => r.kind === 'class');
  const r = cls.find(x => x.label.replace(/\s+/g, '') === `${p}교시`) || cls[p - 1];
  return r && r.start && r.end ? `${r.start}~${r.end}` : '';
}
/** 시간표 왼쪽 교시 칸: "1교시" + 시각 */
function periodHead(p, suffix = '') {
  const t = periodTime(p);
  return `${p}${suffix}${t ? `<small class="ptime">${t}</small>` : ''}`;
}
/** 특별실(시설) 이름 목록: 학교사용환경설정의 특별실 */
function roomNames() {
  return ((state.env && state.env.rooms) || []).map(r => (r.name || '').trim()).filter(Boolean);
}
const isRoomKind = k => !!k && k !== '전담과목' && k !== '외부강의';

/** 이 배치가 쓰는 특별실: 시설 배치는 그 이름, 디지털튜터는 컴퓨터실,
 *  전담과목은 특별실-전담 배정에서 그 학년·교과·반에 정한 특별실 */
function scheduleFacility(entry) {
  if (isRoomKind(entry.kind)) return entry.kind;
  if (entry.kind === '외부강의' && entry.title.replace(/\s+/g, '') === '디지털튜터') return '컴퓨터실';
  if (entry.kind === '전담과목' && Array.isArray(state.jundam) && typeof subjectsOf === 'function') {
    const key = (subjectsOf(entry.grade).find(s => s.name === entry.title.trim()) || {}).key;
    const r = key && state.jundam.find(j => j.room && Number(j.grade) === Number(entry.grade) && j.subj === key &&
      (!j.classes || !j.classes.length || j.classes.includes(Number(entry.classNo))));
    return r ? r.room : '';
  }
  return '';
}

function scheduleConflict(entries, candidate, editing) {
  const facility = scheduleFacility(candidate);
  return entries.find((entry, index) => index !== editing && entry.year === candidate.year &&
    entry.weekday === candidate.weekday &&
    entry.start <= candidate.end && candidate.start <= entry.end &&
    ((entry.grade === candidate.grade &&
      (!entry.classNo || !candidate.classNo || entry.classNo === candidate.classNo)) ||
      (facility && scheduleFacility(entry) === facility)));
}

(() => {
  const form = $('scheduleForm');
  const grid = $('scheduleGrid');
  const status = $('scheduleStatus');
  const days = ['월', '화', '수', '목', '금'];
  const views = {
    all: ['통합 시간표', '', ''], english: ['영어', '전담과목', '영어'],
    science: ['과학', '전담과목', '과학'],
    pungmul: ['풍물', '외부강의', '풍물'],
    gugak: ['국악', '외부강의', '국악'],
    tutor: ['디지털튜터', '외부강의', '디지털튜터'],
    external: ['기타 외부강의', '외부강의', ''], other: ['기타 전담', '전담과목', ''],
  };
  let view = 'all';
  let rejected = null;
  let editing = -1;
  let selected = null;
  const minimumGrade = area => ['english', 'science', 'pungmul'].includes(area) ? 3 : 1;
  // 특별실 보기: 'room:과학실' 처럼 이름으로 (예전 gym·computer 보기도 이 방식으로)
  const viewInfo = v => views[v] || (v.startsWith('room:') ? [v.slice(5) + ' 사용', v.slice(5), v.slice(5)] : views.all);
  const colorOf = area => !area.startsWith('room:') ? area : area === 'room:체육관' ? 'gym' : area === 'room:컴퓨터실' ? 'computer' : 'room';
  function ensureKind(kind) {
    const sel = form.elements.namedItem('kind');
    if (kind && ![...sel.options].some(o => o.value === kind)) sel.add(new Option(kind, kind));
  }
  function renderRoomViews() {
    const used = state.schedule.filter(e => e.year === state.school.year && isRoomKind(e.kind)).map(e => e.kind);
    const names = [...new Set([...roomNames(), ...used])];
    $('scheduleRooms').innerHTML = names.map(n => `<button class="btn" data-view="room:${esc(n)}">${esc(n)} 사용</button>`).join('') ||
      '<span class="hint">② 학교사용환경설정 › 특별실에 등록하면 여기 나옵니다</span>';
  }

  function areaOf(entry) {
    if (isRoomKind(entry.kind)) return 'room:' + entry.kind;
    if (entry.kind === '외부강의') {
      const title = entry.title.replace(/\s+/g, '');
      if (title === '풍물') return 'pungmul';
      if (title === '국악') return 'gugak';
      if (title === '디지털튜터') return 'tutor';
      return 'external';
    }
    if (entry.title.trim() === '영어') return 'english';
    if (entry.title.trim() === '과학') return 'science';
    return 'other';
  }
  let currentState;
  let currentYear;

  function reset() {
    editing = -1;
    selected = null;
    form.reset();
    rejected = null;
    ensureKind(viewInfo(view)[1]);
    form.elements.namedItem('kind').value = viewInfo(view)[1];
    form.elements.namedItem('title').value = viewInfo(view)[2];
    $('scheduleCancel').hidden = true;
    $('scheduleDelete').hidden = true;
    status.textContent = '';
  }


  function renderClassOptions(preferred = form.elements.namedItem('classNo').value) {
    const list = form.elements.namedItem('classNo');
    const grade = form.elements.namedItem('grade').value;
    const count = Number(state.school.classes[grade]) || 0;
    list.innerHTML = '<option value="">반 선택</option>';
    for (let n = 1; n <= count; n++) list.add(new Option(n + '반', n));
    list.value = Number(preferred) >= 1 && Number(preferred) <= count ? String(preferred) : '';
  }

  function classLabel(entry) {
    return entry.grade + '학년' + (entry.classNo ? ' ' + entry.classNo + '반' : ' 전체');
  }
  // 통합 시간표에서 한눈에 구분되도록 짧은 이름표 (디지털튜터 → 디지털)
  function shortTitle(entry) {
    const area = areaOf(entry);
    if (area === 'tutor') return '디지털';
    if (area.startsWith('room:')) { const n = area.slice(5); return n.length > 5 ? n.slice(0, 5) : n; }
    const t = entry.title.trim();
    return t.length > 5 ? t.slice(0, 5) : t;
  }

  function render() {
    if (currentState !== state || currentYear !== state.school.year) {
      currentState = state;
      currentYear = state.school.year;
      reset();
    }
    renderRoomViews();
    $('scheduleTitle').textContent = viewInfo(view)[0];
    form.hidden = !selected;
    $('scheduleGuide').textContent = view === 'all'
      ? '모든 전담과목, 외부강의, 시설 사용 일정을 한곳에서 봅니다.'
      : '시간표에서 원하는 요일과 교시의 칸을 누르세요.';
    const minGrade = minimumGrade(view);
    const gradeFilter = $('scheduleGrade');
    const gradeInput = form.elements.namedItem('grade');
    for (const select of [gradeFilter, gradeInput]) {
      for (const option of select.options) {
        const excluded = option.value !== '' && Number(option.value) < minGrade;
        option.hidden = excluded;
        option.disabled = excluded;
      }
      if ((select === gradeInput || select.value) && Number(select.value) < minGrade) {
        select.value = select === gradeFilter ? '' : String(minGrade);
      }
    }
    renderClassOptions();
    const title = form.elements.namedItem('title');
    const fixedTitle = Boolean(viewInfo(view)[2]);
    title.readOnly = fixedTitle;
    title.closest('label').hidden = fixedTitle;
    $('scheduleCancel').hidden = !selected;
    for (const key of ['other', 'external']) {
      $('scheduleViews').querySelector('[data-view="' + key + '"]').hidden =
        !state.schedule.some(entry => entry.year === state.school.year && areaOf(entry) === key);
    }
    $('scheduleViews').querySelectorAll('[data-view]').forEach(button => {
      button.classList.add('area-' + colorOf(button.dataset.view));
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    const grade = Number($('scheduleGrade').value);
    const placements = state.schedule.map((entry, index) => ({ ...entry, index }))
      .filter(entry => entry.year === state.school.year && (!grade || entry.grade === grade) && (view === 'all' || (entry.grade >= minGrade && (areaOf(entry) === view || (view.startsWith('room:') && scheduleFacility(entry) === view.slice(5))))));
    grid.classList.toggle('area', view !== 'all');
    grid.innerHTML = '<tr><th>교시</th>' + days.map(day => `<th>${day}</th>`).join('') + '</tr>';
    for (let period = 1; period <= 8; period++) {
      grid.insertAdjacentHTML('beforeend', `<tr><th>${periodHead(period)}</th>${days.map((_, weekday) => {
        const cells = placements.filter(entry => entry.weekday === weekday &&
          entry.start <= period && period <= entry.end);
        const conflicts = entry => scheduleConflict(state.schedule, { ...entry, start: period, end: period }, entry.index);
        const rejectedHere = rejected && rejected.weekday === weekday &&
          rejected.start <= period && period <= rejected.end && conflicts({ ...rejected, index: editing });
        const marked = rejectedHere || cells.some(conflicts);
        return `<td class="${marked ? 'schedule-conflict' : ''}${selected?.weekday === weekday && selected.period === period ? ' schedule-selected' : ''}" ${view !== 'all' ? `data-slot="${weekday}:${period}"` : ''}><div class="schedule-square">
          ${marked ? '<span class="pill err">중복</span>' : ''}
          ${cells.map(entry => `<button class="btn schedule-item area-${colorOf(areaOf(entry))}" data-entry="${entry.index}"
          title="${esc(entry.title)} · ${classLabel(entry)} · ${entry.start}~${entry.end}교시${scheduleFacility(entry) ? ' · ' + esc(scheduleFacility(entry)) : ''}"><span class="sbadge">${esc(shortTitle(entry))}</span><span class="sdash"> - </span><span class="nowrap">${classLabel(entry)}</span></button>`).join('')}
          ${view !== 'all' && !cells.length ? `<button class="schedule-slot" type="button" aria-label="${days[weekday]}요일 ${period}교시 배치">+</button>` : ''}
        </div></td>`;
      }).join('')}</tr>`);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!selected || isTeacherView() || (App.locked && App.locked())) return;
    const fields = new FormData(form);
    const candidate = {
      year: state.school.year, kind: fields.get('kind'), title: fields.get('title').trim(),
      grade: Number(fields.get('grade')), classNo: Number(fields.get('classNo')),
      weekday: selected.weekday, start: selected.period,
      end: editing < 0 ? selected.period : state.schedule[editing].end,
    };
    if (Boolean(viewInfo(view)[2])) candidate.title = viewInfo(view)[2];
    if (candidate.grade < minimumGrade(areaOf(candidate))) {
      status.textContent = '이 활동은 3~6학년만 배치할 수 있습니다.';
      return;
    }
    if (!candidate.title || !Number.isInteger(candidate.classNo) || candidate.classNo < 1 ||
      candidate.classNo > (Number(state.school.classes[candidate.grade]) || 0)) {
      status.textContent = '학교 정보에 등록된 학년과 반을 선택해 주세요.';
      return;
    }
    const conflict = scheduleConflict(state.schedule, candidate, editing);
    if (conflict) {
      rejected = candidate;
      render();
      status.textContent = `${days[conflict.weekday]}요일 ${conflict.start}~${conflict.end}교시 ${classLabel(conflict)} ${conflict.title} 배치와 겹칩니다.`;
      return;
    }
    if (editing < 0) state.schedule.push(candidate);
    else state.schedule[editing] = candidate;
    save();
    reset();
    status.textContent = '배치를 저장했습니다.';
    render();
  });

  $('scheduleViews').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    view = button.dataset.view;
    reset();
    render();
  });

  grid.addEventListener('click', event => {
    if (isTeacherView() || (App.locked && App.locked())) return;
    const slot = event.target.closest('[data-slot]');
    if (slot && !event.target.closest('[data-entry]') && view !== 'all') {
      reset();
      const [weekday, period] = slot.dataset.slot.split(':');
      selected = { weekday: Number(weekday), period: Number(period) };
      const grade = $('scheduleGrade').value;
      if (grade) form.elements.namedItem('grade').value = grade;
      render();
      form.elements.namedItem('grade').focus();
      return;
    }
    const button = event.target.closest('[data-entry]');
    if (!button || isTeacherView() || (App.locked && App.locked())) return;
    editing = Number(button.dataset.entry);
    const entry = state.schedule[editing];
    view = areaOf(entry);
    selected = { weekday: entry.weekday, period: entry.start };
    rejected = null;
    render();
    ensureKind(entry.kind);
    for (const key of ['kind', 'title', 'grade']) {
      form.elements.namedItem(key).value = entry[key];
    }
    if (entry.grade < minimumGrade(view)) form.elements.namedItem('grade').value = String(minimumGrade(view));
    renderClassOptions(entry.classNo);
    $('scheduleCancel').hidden = false;
    $('scheduleDelete').hidden = false;
    status.textContent = '선택한 배치를 수정하고 있습니다.';
    form.elements.namedItem('grade').focus();
  });

  $('scheduleCancel').addEventListener('click', () => { reset(); render(); });
  $('scheduleDelete').addEventListener('click', () => {
    if (editing < 0 || isTeacherView() || (App.locked && App.locked())) return;
    if (!confirm('선택한 시간표 배치를 삭제할까요?')) return;
    state.schedule.splice(editing, 1);
    save();
    reset();
    render();
  });
  form.elements.namedItem('grade').addEventListener('change', () => renderClassOptions(''));
  $('scheduleGrade').addEventListener('change', render);
  RENDER.schedule = () => { view = 'all'; reset(); render(); };
})();
