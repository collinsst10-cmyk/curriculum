'use strict';

function scheduleConflict(entries, candidate, editing) {
  const facilities = ['체육관', '컴퓨터실'];
  return entries.find((entry, index) => index !== editing && entry.year === candidate.year &&
    entry.weekday === candidate.weekday &&
    entry.start <= candidate.end && candidate.start <= entry.end &&
    (entry.grade === candidate.grade ||
      (entry.kind === candidate.kind && facilities.includes(entry.kind))));
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
    external: ['외부강의', '외부강의', ''], other: ['기타 전담', '전담과목', ''],
  };
  let view = 'all';
  let rejected = null;
  let editing = -1;

  function areaOf(entry) {
    if (entry.kind === '체육관') return 'gym';
    if (entry.kind === '컴퓨터실') return 'computer';
    if (entry.kind === '외부강의') return 'external';
    if (entry.title.trim() === '영어') return 'english';
    if (entry.title.trim() === '과학') return 'science';
    return 'other';
  }
  let currentState;
  let currentYear;

  function reset() {
    editing = -1;
    form.reset();
    rejected = null;
    form.elements.namedItem('kind').value = views[view][1];
    form.elements.namedItem('title').value = views[view][2];
    $('scheduleCancel').hidden = true;
    $('scheduleDelete').hidden = true;
    status.textContent = '';
  }


  function render() {
    if (currentState !== state || currentYear !== state.school.year) {
      currentState = state;
      currentYear = state.school.year;
      reset();
    }
    $('scheduleTitle').textContent = views[view][0];
    form.hidden = view === 'all';
    $('scheduleViews').querySelectorAll('[data-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    const grade = Number($('scheduleGrade').value);
    const placements = state.schedule.map((entry, index) => ({ ...entry, index }))
      .filter(entry => entry.year === state.school.year && (!grade || entry.grade === grade) && (view === 'all' || areaOf(entry) === view));
    grid.innerHTML = '<tr><th>교시</th>' + days.map(day => `<th>${day}</th>`).join('') + '</tr>';
    for (let period = 1; period <= 8; period++) {
      grid.insertAdjacentHTML('beforeend', `<tr><th>${period}</th>${days.map((_, weekday) => {
        const cells = placements.filter(entry => entry.weekday === weekday &&
          entry.start <= period && period <= entry.end);
        const conflicts = entry => scheduleConflict(state.schedule, { ...entry, start: period, end: period }, entry.index);
        const rejectedHere = rejected && rejected.weekday === weekday &&
          rejected.start <= period && period <= rejected.end && conflicts({ ...rejected, index: editing });
        const marked = rejectedHere || cells.some(conflicts);
        return `<td class="${marked ? 'schedule-conflict' : ''}"><div class="schedule-square">
          ${marked ? '<span class="pill err">중복</span>' : ''}
          ${cells.map(entry => `<button class="btn schedule-item" data-entry="${entry.index}"
          title="${esc(entry.kind)} · ${entry.start}~${entry.end}교시">${entry.grade}학년 · ${esc(entry.title)}</button>`).join('')}
          ${view !== 'all' ? `<button class="btn small" data-slot="${weekday}:${period}" aria-label="${days[weekday]}요일 ${period}교시 배치">+</button>` : ''}
        </div></td>`;
      }).join('')}</tr>`);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (isTeacherView() || (App.locked && App.locked())) return;
    const fields = new FormData(form);
    const candidate = {
      year: state.school.year, kind: fields.get('kind'), title: fields.get('title').trim(),
      grade: Number(fields.get('grade')), weekday: Number(fields.get('weekday')),
      start: Number(fields.get('start')), end: Number(fields.get('end')),
    };
    if (view === 'english' || view === 'science') candidate.title = views[view][2];
    if (!candidate.title || candidate.start > candidate.end) {
      status.textContent = '활동명과 시작·끝 교시를 확인해 주세요.';
      return;
    }
    const conflict = scheduleConflict(state.schedule, candidate, editing);
    if (conflict) {
      rejected = candidate;
      render();
      status.textContent = `${days[conflict.weekday]}요일 ${conflict.start}~${conflict.end}교시 ${conflict.grade}학년 ${conflict.title} 배치와 겹칩니다.`;
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
    if (slot && view !== 'all') {
      reset();
      const [weekday, period] = slot.dataset.slot.split(':');
      form.elements.namedItem('weekday').value = weekday;
      form.elements.namedItem('start').value = period;
      form.elements.namedItem('end').value = period;
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
    rejected = null;
    render();
    for (const key of ['kind', 'title', 'grade', 'weekday', 'start', 'end']) {
      form.elements.namedItem(key).value = entry[key];
    }
    $('scheduleCancel').hidden = false;
    $('scheduleDelete').hidden = false;
    status.textContent = '선택한 배치를 수정하고 있습니다.';
    form.elements.namedItem('title').focus();
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
  $('scheduleGrade').addEventListener('change', render);
  RENDER.schedule = () => { view = 'all'; reset(); render(); };
})();
