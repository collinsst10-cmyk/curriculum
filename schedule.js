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
  let editing = -1;
  let currentState;
  let currentYear;

  function reset() {
    editing = -1;
    form.reset();
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
    const grade = Number($('scheduleGrade').value);
    const placements = state.schedule.map((entry, index) => ({ ...entry, index }))
      .filter(entry => entry.year === state.school.year && (!grade || entry.grade === grade));
    grid.innerHTML = '<tr><th>교시</th>' + days.map(day => `<th>${day}</th>`).join('') + '</tr>';
    for (let period = 1; period <= 8; period++) {
      grid.insertAdjacentHTML('beforeend', `<tr><th>${period}</th>${days.map((_, weekday) => {
        const cells = placements.filter(entry => entry.weekday === weekday &&
          entry.start <= period && period <= entry.end);
        return `<td>${cells.map(entry => `<button class="btn schedule-item" data-entry="${entry.index}"
          title="${esc(entry.kind)} · ${entry.start}~${entry.end}교시">${entry.grade}학년 · ${esc(entry.title)}</button>`).join('')}</td>`;
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
    if (!candidate.title || candidate.start > candidate.end) {
      status.textContent = '활동명과 시작·끝 교시를 확인해 주세요.';
      return;
    }
    const conflict = scheduleConflict(state.schedule, candidate, editing);
    if (conflict) {
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

  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-entry]');
    if (!button || isTeacherView() || (App.locked && App.locked())) return;
    editing = Number(button.dataset.entry);
    const entry = state.schedule[editing];
    for (const key of ['kind', 'title', 'grade', 'weekday', 'start', 'end']) {
      form.elements.namedItem(key).value = entry[key];
    }
    $('scheduleCancel').hidden = false;
    $('scheduleDelete').hidden = false;
    status.textContent = '선택한 배치를 수정하고 있습니다.';
    form.elements.namedItem('title').focus();
  });

  $('scheduleCancel').addEventListener('click', reset);
  $('scheduleDelete').addEventListener('click', () => {
    if (editing < 0 || isTeacherView() || (App.locked && App.locked())) return;
    if (!confirm('선택한 시간표 배치를 삭제할까요?')) return;
    state.schedule.splice(editing, 1);
    save();
    reset();
    render();
  });
  $('scheduleGrade').addEventListener('change', render);
  RENDER.schedule = render;
})();
