'use strict';

window.StaffSubjectSync = (() => {
  const M = StaffSyncModel;
  const selector = '[data-staff-sync]';
  const previews = new WeakMap();
  const canEdit = () => window.Cloud?.ready && Cloud.isAdmin() && !isTeacherView() && !App.locked?.();
  const catalog = () => Object.fromEntries(GRADES.map(g => [g, subjectsOf(g)]));
  const label = row => row.staffName || state.env?.teachers?.find(t => t.name === row.teacher)?.teacher || row.teacher || '미지정';
  const snapshot = year => JSON.stringify([
    year, state.school.classes, state.jundam, state.schedule, state.staffAssignmentLinks || {}
  ]);
  function panel() {
    if (!canEdit()) return '';
    return `<details class="card staff-sync-panel" data-staff-sync>
      <summary>교직원 전담 배정 가져오기·비교</summary>
      <p class="hint">선택한 항목만 편성과 시간표의 교사 표시에 반영됩니다. 편성의 반당 시수는 저장 전에 확인할 수 있습니다.</p>
      <button type="button" class="btn small" data-staff-preview>교직원 배정 비교</button>
      <p class="hint" role="status" data-sync-message></p>
      <div data-sync-result></div>
    </details>`;
  }

  async function readInputs(year) {
    const { F, db } = Cloud.fb;
    const [source, profiles] = await Promise.all([
      F.getDocFromServer(F.doc(db, 'staffSchedule', String(year))),
      F.getDocsFromServer(F.collection(db, 'staffNames'))
    ]);
    if (!source.exists()) throw new Error('해당 학년도에 교직원 관리에서 저장한 배정이 없습니다.');
    const assignments = source.data().subjects || [];
    const names = Object.fromEntries(profiles.docs.map(doc => [doc.id, doc.data().name]));
    const signature = JSON.stringify([assignments, Object.entries(names).sort(([a], [b]) => a.localeCompare(b))]);
    return { assignments, names, signature };
  }

  function renderPreview(host, plan, output) {
    const { changes, issues } = output;
    previews.set(host, { ...plan, changes });
    host.querySelector('[data-sync-result]').innerHTML = (issues.length ? `<details open><summary>확인 항목 ${issues.length}건</summary><ul>
      ${issues.map(item => '<li>' + esc(item) + '</li>').join('')}</ul></details>` : '') +
      (changes.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>반영</th><th>학급·교과</th><th>현재 편성</th><th>교직원 관리</th><th>반당 시수</th><th>시간표 교사 표시</th></tr></thead>
      <tbody>${changes.map((change, index) => {
        const current = change.existing.map(row => label(row) + ' · ' + row.hrs + '시간').join(' / ');
        const selected = change.target;
        const affects = change.lessons.length ? change.lessons.map(entry =>
          ['월', '화', '수', '목', '금'][entry.weekday] + ' ' + entry.start + (entry.end === entry.start ? '' : '~' + entry.end) + '교시').join(' · ') : '배치 없음';
        const display = change.saved?.name || '미연결';
        return `<tr data-change="${index}"><td><input type="checkbox" aria-label="${esc(change.label)} 반영"></td>
          <td>${esc(change.label)}</td><td>${esc(current || '배정 없음')}</td>
          <td>${selected ? esc(selected.name + ' · ' + selected.managerClasses + '학급 주 ' + selected.managerHours + '차시') : '승인된 연결 해제'}</td>
          <td>${selected ? `<input type="number" min="1" max="20" step="1" value="${change.hours ?? ''}" aria-label="${esc(change.label)} 반당 시수">` : '—'}</td>
          <td>${esc(affects)}${change.lessons.length ? '<br>' + esc(display + ' → ' + (selected?.name || '미연결')) : ''}</td></tr>`;
      }).join('')}</tbody></table></div><button type="button" class="btn primary small" data-staff-approve>선택한 배정 반영</button>`
        : '<p class="hint">반영할 차이가 없습니다.</p>');
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-staff-preview], [data-staff-approve]');
    if (!button || !canEdit()) return;
    const host = button.closest(selector);
    const message = host.querySelector('[data-sync-message]');
    const year = state.school.year;
    button.disabled = true;
    try {
      if (button.hasAttribute('data-staff-preview')) {
        previews.delete(host);
        host.querySelector('[data-sync-result]').replaceChildren();
        const version = snapshot(year);
        message.textContent = '교직원 배정을 확인하는 중입니다.';
        const data = await readInputs(year);
        if (!canEdit() || !host.isConnected || snapshot(state.school.year) !== version) return;
        renderPreview(host, { year, snapshot: version, signature: data.signature }, M.compare({
          source: data.assignments, names: data.names, counts: state.school.classes, catalog: catalog(),
          rows: state.jundam, approved: state.staffAssignmentLinks, schedule: state.schedule, year
        }));
        message.textContent = year + '학년도 비교 결과입니다. 반영할 항목을 선택해 주세요.';
      } else {
        const plan = previews.get(host);
        if (!plan || plan.snapshot !== snapshot(year)) throw new Error('편성 자료가 바뀌었습니다. 다시 비교해 주세요.');
        const choices = new Map();
        for (const row of host.querySelectorAll('[data-change]')) {
          if (!row.querySelector('input[type=checkbox]').checked) continue;
          const change = plan.changes[Number(row.dataset.change)];
          choices.set(change.id, row.querySelector('input[type=number]')?.value);
        }
        if (!choices.size) throw new Error('반영할 항목을 선택해 주세요.');
        const fresh = await readInputs(year);
        if (!canEdit() || !host.isConnected || plan.signature !== fresh.signature ||
            snapshot(state.school.year) !== plan.snapshot) throw new Error('자료가 바뀌었습니다. 다시 비교해 주세요.');
        const result = M.apply({ rows: state.jundam, approved: state.staffAssignmentLinks,
          counts: state.school.classes, changes: plan.changes, choices });
        const teacherList = [...(state.env?.teachers || [])];
        for (const row of result.rows.filter(row => row.staffId && row.teacher === M.teacherKey(row.staffId))) {
          const index = teacherList.findIndex(item => item.name === row.teacher);
          if (index < 0) teacherList.push({ name: row.teacher, teacher: row.staffName, staffId: row.staffId });
          else teacherList[index] = { ...teacherList[index], teacher: row.staffName, staffId: row.staffId };
        }
        if (!confirm(year + '학년도 배정 ' + choices.size + '건을 반영할까요? 수업 요일·교시와 학급 배치는 유지됩니다.')) return;
        state.jundam = result.rows;
        state.staffAssignmentLinks = result.approved;
        state.env ||= {};
        state.env.teachers = teacherList;
        save();
        previews.delete(host);
        host.querySelector('[data-sync-result]').replaceChildren();
        if (curTab === 'jd') RENDER.jd?.();
        if (curTab === 'env') RENDER.env?.();
        const updated = document.getElementById('tab-' + curTab)?.querySelector(selector);
        if (updated) {
          updated.open = true;
          updated.querySelector('[data-sync-message]').textContent = choices.size + '건을 반영했습니다.';
        }
        document.dispatchEvent(new Event('staff-schedule-change'));
      }
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });

  function forEntry(entry) {
    return M.displayForEntry(entry, state.school.year, state.staffAssignmentLinks || {}, state.school.classes, catalog())
      .map(row => row.name);
  }
  return { panel, forEntry, label };
})();
