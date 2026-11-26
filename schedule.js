'use strict';

function scheduleFacility(entry) {
  if (entry.kind === '체육관' || entry.kind === '컴퓨터실') return entry.kind;
  if (entry.kind === '외부강의' && entry.title.replace(/\s+/g, '') === '디지털튜터') return '컴퓨터실';
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
    science: ['과학', '전담과목', '과학'], gym: ['체육관 사용', '체육관', '체육관'],
    computer: ['컴퓨터실 사용', '컴퓨터실', '컴퓨터실'],
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

  function areaOf(entry) {
    if (entry.kind === '체육관') return 'gym';
    if (entry.kind === '컴퓨터실') return 'computer';
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
    form.elements.namedItem('kind').value = views[view][1];
    form.elements.namedItem('title').value = views[view][2];
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
    if (area === 'gym') return '체육관';
    if (area === 'computer') return '컴퓨터실';
    const t = entry.title.trim();
    return t.length > 5 ? t.slice(0, 5) : t;
  }

  function render() {
    if (currentState !== state || currentYear !== state.school.year) {
      currentState = state;
      currentYear = state.school.year;
      reset();
    }
    $('scheduleTitle').textContent = views[view][0];
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
    const fixedTitle = Boolean(views[view][2]);
    title.readOnly = fixedTitle;
    title.closest('label').hidden = fixedTitle;
    $('scheduleCancel').hidden = !selected;
    for (const key of ['other', 'external']) {
      $('scheduleViews').querySelector('[data-view="' + key + '"]').hidden =
        !state.schedule.some(entry => entry.year === state.school.year && areaOf(entry) === key);
    }
    $('scheduleViews').querySelectorAll('[data-view]').forEach(button => {
      button.classList.add('area-' + button.dataset.view);
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    const grade = Number($('scheduleGrade').value);
    const placements = state.schedule.map((entry, index) => ({ ...entry, index }))
      .filter(entry => entry.year === state.school.year && (!grade || entry.grade === grade) && (view === 'all' || (entry.grade >= minGrade && (areaOf(entry) === view || (view === 'computer' && scheduleFacility(entry) === '컴퓨터실')))));
    grid.innerHTML = '<tr><th>교시</th>' + days.map(day => `<th>${day}</th>`).join('') + '</tr>';
    for (let period = 1; period <= 8; period++) {
      grid.insertAdjacentHTML('beforeend', `<tr><th>${period}</th>${days.map((_, weekday) => {
        const cells = placements.filter(entry => entry.weekday === weekday &&
          entry.start <= period && period <= entry.end);
        const conflicts = entry => scheduleConflict(state.schedule, { ...entry, start: period, end: period }, entry.index);
        const rejectedHere = rejected && rejected.weekday === weekday &&
          rejected.start <= period && period <= rejected.end && conflicts({ ...rejected, index: editing });
        const marked = rejectedHere || cells.some(conflicts);
        return `<td class="${marked ? 'schedule-conflict' : ''}${selected?.weekday === weekday && selected.period === period ? ' schedule-selected' : ''}" ${view !== 'all' ? `data-slot="${weekday}:${period}"` : ''}><div class="schedule-square">
          ${marked ? '<span class="pill err">중복</span>' : ''}
          ${cells.map(entry => `<button class="btn schedule-item area-${areaOf(entry)}" data-entry="${entry.index}"
          title="${esc(entry.title)} · ${classLabel(entry)} · ${entry.start}~${entry.end}교시"><span class="sbadge">${esc(shortTitle(entry))}</span> - <span class="nowrap">${classLabel(entry)}</span></button>`).join('')}
          ${view !== 'all' ? `<button class="schedule-slot" type="button" aria-label="${days[weekday]}요일 ${period}교시 배치">+</button>` : ''}
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
    if (Boolean(views[view][2])) candidate.title = views[view][2];
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
