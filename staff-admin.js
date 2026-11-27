'use strict';

(() => {
  const root = document.getElementById('staffAdmin');
  const M = StaffModel;
  const kinds = { homeroom: '담임', gradeTeam: '학년부', department: '부서', duty: '업무분장', subject: '교과전담', other: '기타 업무' };
  const statuses = { active: '재직', leave: '휴직', transferred: '전출', retired: '퇴직' };
  const $ = name => root.querySelector('[data-staff-field="' + name + '"]');
  const isAdmin = () => !!(window.Cloud?.ready && Cloud.isAdmin());
  const fb = () => Cloud.fb;
  let profiles = new Map(), years = new Map(), selected = '', year = '', epoch = 0;

  const options = (values, blank = '') => (blank ? '<option value="">' + blank + '</option>' : '')
    + values.map(([value, label]) => '<option value="' + esc(value) + '">' + esc(label) + '</option>').join('');
  const label = id => profiles.get(id)?.name || '미지정';
  const selectedYear = () => years.get(year) || M.empty();
  const idOf = col => { const { F, db } = fb(); return F.doc(F.collection(db, col)).id; };

  root.innerHTML = `<summary>교직원 학년도별 관리</summary>
    <div class="row"><label>학년도 <input type="number" data-staff-field="year" min="2000" max="2099"></label>
    <label>교직원 <select data-staff-field="person"></select></label><button class="btn small" type="button" data-staff-action="new">신규 등록</button></div>
    <p class="hint" role="status" data-staff-field="status"></p>
    <div class="staff-admin-details">
      <section><h3>교직원 기본정보</h3><p class="hint" data-staff-field="identity"></p><form class="form" data-staff-form="profile">
        <label>이름 <input name="name" required maxlength="60"></label>
        <label>계정 이메일 <input name="email" type="email" maxlength="254"></label>
        <label>기본 직종·신분 <input name="job" maxlength="60"></label>
        <label>기본정보 비고 <input name="note" maxlength="250"></label>
        <button class="btn primary small">기본정보 저장</button></form></section>
      <section><h3>학년도별 근무정보</h3><form class="form" data-staff-form="employment">
        <label>재직 상태 <select name="state">${options(Object.entries(statuses))}</select></label>
        <label>직위·직책 <input name="position" maxlength="60"></label><label>근무 비고 <input name="note" maxlength="250"></label>
        <button class="btn small" type="button" data-staff-action="previous">전년도 근무정보 불러오기</button>
        <button class="btn primary small">근무정보 저장</button></form></section>
    </div>
    <section><h3>학년부·부서 구성</h3><form class="row" data-staff-form="group">
      <select name="id" aria-label="조직 선택" data-staff-field="groupEdit"></select>
      <label>구분 <select name="kind"><option value="gradeTeam">학년부</option><option value="department">부서</option></select></label>
      <label>조직명 <input name="name" required maxlength="60"></label><button class="btn small">조직 저장</button></form></section>
    <section><h3>학년도별 업무 배정</h3><form class="form" data-staff-form="assignment">
      <label>기존 배정 <select name="id" data-staff-field="assignmentEdit"></select></label>
      <label>구분 <select name="kind">${options(Object.entries(kinds))}</select></label>
      <label>담당자·부장·주담당 <select name="primary" required data-staff-field="primary"></select></label>
      <label data-kind="gradeTeam department duty">소속 조직 <select name="group" data-staff-field="group"></select></label>
      <label data-kind="homeroom">담임 학급 <select name="room" data-staff-field="room"></select></label>
      <label data-kind="gradeTeam department duty other">구성원·협조자 <select name="people" multiple size="4" data-staff-field="people"></select></label>
      <label data-kind="subject duty other">교과명·업무명 <input name="name" maxlength="80" list="staffSubjectNames"></label>
      <datalist id="staffSubjectNames" data-staff-field="subjectNames"></datalist>
      <label data-kind="subject">담당 학급 <select name="rooms" multiple size="4" data-staff-field="rooms"></select></label>
      <label data-kind="subject">주당 시수 <input name="hours" type="number" min="1" max="40"></label>
      <label>세부 내용 <textarea name="note" rows="2" maxlength="500"></textarea></label>
      <button class="btn primary small">배정 저장</button>
      <button class="btn small" type="button" data-staff-action="remove">선택 배정 해제</button>
    </form></section>
    <section><h3>학년도별 전체 업무분장</h3><div class="tbl-scroll" data-staff-field="table"></div></section>
    <section><h3>선택 교직원의 학년도별 이력</h3><div data-staff-field="history"></div></section>`;

  const forms = Object.fromEntries([...root.querySelectorAll('form')].map(form => [form.dataset.staffForm, form]));
  const field = (form, name) => forms[form].elements.namedItem(name);
  const set = (form, values) => Object.entries(values).forEach(([name, value]) => { field(form, name).value = value ?? ''; });
  const show = message => { $('status').textContent = message; };

  function roomOptions() {
    const config = String(state.school.year) === year ? state.school.classes
      : state.yearPlans?.[year]?.school?.classes || state.yearArchive?.[year]?.classes;
    if (!config) return [];
    return GRADES.flatMap(grade => Array.from({ length: Math.max(0, Math.min(20, Number(config[grade]) || 0)) },
      (_, i) => [M.roomKey(grade, i + 1), grade + '학년 ' + (i + 1) + '반']));
  }

  function applyVisibility() {
    const kind = field('assignment', 'kind').value;
    forms.assignment.querySelectorAll('[data-kind]').forEach(node => { node.hidden = !node.dataset.kind.split(' ').includes(kind); });
    const groupKind = kind === 'gradeTeam' ? 'gradeTeam' : 'department';
    const groupEntries = Object.entries(selectedYear().groups).filter(([, row]) => row.kind === groupKind)
      .map(([id, row]) => [id, row.name]);
    const selectedGroup = $('group').value;
    $('group').innerHTML = options(groupEntries, '조직 선택');
    if (groupEntries.some(([id]) => id === selectedGroup)) $('group').value = selectedGroup;
  }

  function render() {
    const data = selectedYear();
    $('person').innerHTML = options([...profiles].map(([id, row]) => [id, row.name + (row.job ? ' · ' + row.job : '')]), '교직원 선택');
    $('person').value = selected;
    set('profile', { name: '', email: '', job: '', note: '', ...(profiles.get(selected) || {}) });
    $('identity').textContent = selected ? '교직원 ID ' + selected : '';
    const work = data.employment[selected] || {};
    set('employment', { state: work.status || 'active', position: work.position, note: work.note });
    $('groupEdit').innerHTML = options(Object.entries(data.groups).map(([id, row]) => [id, row.name]), '신규 조직');
    set('group', { id: '', kind: 'gradeTeam', name: '' });
    const entries = Object.entries(data.assignments);
    const active = Object.keys(data.employment).filter(id => data.employment[id].status === 'active').map(id => [id, label(id)]);
    $('assignmentEdit').innerHTML = options(entries.map(([id, row]) => [id, kinds[row.kind] + ' · ' +
      (row.name || row.room || data.groups[row.group]?.name || '') + ' · ' + label(row.primary)]), '신규 배정');
    $('primary').innerHTML = options(active, '교직원 선택');
    $('people').innerHTML = options(active);
    $('room').innerHTML = options(roomOptions(), '학급 선택');
    $('rooms').innerHTML = options(roomOptions());
    $('subjectNames').innerHTML = options([...new Set(GRADES.flatMap(g => subjectsOf(g).map(s => s.name)))].map(name => [name, name]));
    set('assignment', { id: '', kind: 'homeroom', name: '', note: '', hours: '' });
    applyVisibility();
    const rowLabel = (row, data) => [row.name, data.groups[row.group]?.name, row.room, row.rooms?.join(' · '), row.hours ? '주 ' + row.hours + '차시' : ''].filter(Boolean).join(' · ');
    $('table').innerHTML = '<p class="hint">재직 ' + Object.values(data.employment).filter(row => row.status === 'active').length +
      '명 · 근무정보 ' + Object.keys(data.employment).length + '건</p>' +
      (entries.length ? '<table class="tbl"><thead><tr><th>구분</th><th>업무·조직·학급</th><th>담당자</th><th>구성원·협조자</th><th>세부 내용</th></tr></thead><tbody>' +
        entries.map(([, row]) => '<tr>' + [kinds[row.kind], rowLabel(row, data), label(row.primary), row.people.map(label).join(' · '), row.note]
          .map(value => '<td>' + esc(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p class="hint">등록된 배정이 없습니다.</p>');
    $('history').innerHTML = selected ? ([...years].sort(([a], [b]) => b.localeCompare(a)).map(([y, d]) => {
      const info = d.employment[selected];
      if (!info) return '';
      const jobs = Object.values(d.assignments).filter(row => row.primary === selected || row.people.includes(selected));
      return '<p><strong>' + esc(y) + '학년도</strong> · ' + esc(statuses[info.status]) + ' · ' + esc(info.position || '직책 미지정') +
        '</p><ul>' + jobs.map(row => '<li>' + esc(kinds[row.kind] + ' · ' + rowLabel(row, d) + (row.primary === selected ? ' · 담당' : ' · 구성원·협조')) + '</li>').join('') + '</ul>';
    }).join('') || '<p class="hint">학년도별 근무정보가 없습니다.</p>') : '<p class="hint">교직원을 선택해 주세요.</p>';
  }

  async function load() {
    if (!isAdmin() || !root.open) return;
    const token = ++epoch;
    const { F, db } = fb();
    const [p, y] = await Promise.all([F.getDocs(F.collection(db, 'staffProfiles')), F.getDocs(F.collection(db, 'staffYears'))]);
    if (token !== epoch || !isAdmin()) return;
    profiles = new Map(p.docs.map(doc => [doc.id, doc.data()]));
    years = new Map(y.docs.map(doc => [doc.id, doc.data()]));
    render();
  }

  async function storeProfile(values) {
    const { F, db } = fb();
    const person = selected || idOf('staffProfiles');
    const ref = F.doc(db, 'staffProfiles', person);
    const email = values.email.trim().toLowerCase(), name = values.name.trim();
    if (!name) throw new Error('이름을 입력해 주세요.');
    await F.runTransaction(db, async tx => {
      const previous = (await tx.get(ref)).data() || {};
      const newLink = email ? F.doc(db, 'staffAccounts', email) : null;
      const oldLink = previous.email && previous.email !== email ? F.doc(db, 'staffAccounts', previous.email) : null;
      const old = oldLink ? await tx.get(oldLink) : null;
      if (newLink) {
        const [linked, account] = await Promise.all([tx.get(newLink), tx.get(F.doc(db, 'allowed', email))]);
        if (!account.exists() || account.data().userType === 'general') throw new Error('승인된 교직원 계정만 연결할 수 있습니다.');
        if (linked.exists() && linked.data().staffId !== person) throw new Error('이미 다른 교직원에게 연결된 계정입니다.');
        tx.set(newLink, { staffId: person });
      }
      if (old?.data()?.staffId === person) tx.delete(oldLink);
      tx.set(ref, { name, email, job: values.job.trim(), note: values.note.trim() });
      tx.set(F.doc(db, 'staffNames', person), { name });
    });
    selected = person;
  }

  async function storeYear(action) {
    if (!/^20[0-9]{2}$/.test(year)) throw new Error('학년도를 확인해 주세요.');
    const targetYear = year, { F, db } = fb();
    if (action.type === 'assignment') {
      const configured = new Set(roomOptions().map(([key]) => key));
      if (action.kind === 'homeroom' && !configured.has(action.room) ||
          action.kind === 'subject' && action.rooms.some(room => !configured.has(room))) {
        throw new Error('해당 학년도 학교 정보에 설정된 학급만 배정할 수 있습니다.');
      }
    }
    const ref = F.doc(db, 'staffYears', targetYear);
    await F.runTransaction(db, async tx => {
      const old = (await tx.get(ref)).data() || M.empty();
      const next = M.apply(old, action);
      const before = M.homerooms(old), after = M.homerooms(next);
      const allocations = M.subjects(next);
      if (allocations.length > 200) throw new Error('전담 배정은 200건까지 등록할 수 있습니다.');
      const owners = Object.fromEntries(Object.entries(after).map(([staff, room]) => [room, staff]));
      for (const person of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[person] === after[person]) continue;
        const own = F.doc(db, 'staffYears', targetYear, 'ownHomerooms', person);
        // 빈 배정은 구형 이메일 배정이 다시 권한을 주지 않도록 남겨 둔다.
        tx.set(own, { classId: after[person] || '' });
      }
      for (const room of new Set([...Object.values(before), ...Object.values(after)])) {
        const prior = Object.keys(before).find(person => before[person] === room) || '';
        if ((owners[room] || '') !== prior) tx.set(F.doc(db, 'staffYears', targetYear, 'classOwners', room), { staffId: owners[room] || '' });
      }
      tx.set(ref, next);
      tx.set(F.doc(db, 'staffSchedule', targetYear), {
        subjects: allocations,
        activeCount: Object.values(next.employment).filter(row => row.status === 'active').length,
        activeStaffIds: Object.keys(next.employment).filter(id => next.employment[id].status === 'active')
      });
    });
  }

  async function perform(action) {
    if (!isAdmin()) return;
    const controls = [...root.querySelectorAll('button')];
    controls.forEach(button => { button.disabled = true; });
    try { await action(); await load(); show('저장했습니다.'); }
    catch (error) { show('처리 실패: ' + error.message); }
    finally { controls.forEach(button => { button.disabled = false; }); }
  }
  root.addEventListener('submit', event => {
    event.preventDefault();
    const type = event.target.dataset.staffForm;
    const form = new FormData(event.target), values = Object.fromEntries(form);
    perform(async () => {
      if (type === 'profile') { await storeProfile(values); return; }
      if (type === 'employment') {
        if (!selected) throw new Error('교직원 기본정보를 먼저 등록하거나 선택해 주세요.');
        await storeYear({ ...values, type, id: selected, status: values.state });
        return;
      }
      const id = values.id || idOf('staffYears');
      await storeYear({ ...values, id, type, people: form.getAll('people'), rooms: form.getAll('rooms') });
    });
  });

  root.addEventListener('change', event => {
    const target = event.target, key = target.dataset.staffField;
    if (key === 'year') { if (/^20[0-9]{2}$/.test(target.value)) { year = target.value; render(); } return; }
    if (key === 'person') { selected = target.value; render(); return; }
    if (key === 'groupEdit') {
      const row = selectedYear().groups[target.value];
      set('group', { kind: row?.kind || 'gradeTeam', name: row?.name || '' });
      return;
    }
    if (key === 'assignmentEdit') {
      const row = selectedYear().assignments[target.value];
      set('assignment', { kind: row?.kind || 'homeroom', name: row?.name, note: row?.note, room: row?.room, hours: row?.hours, primary: row?.primary });
      applyVisibility();
      $('group').value = row?.group || '';
      for (const option of $('people').options) option.selected = !!row?.people.includes(option.value);
      for (const option of $('rooms').options) option.selected = !!row?.rooms?.includes(option.value);
      return;
    }
    if (target === field('assignment', 'kind')) applyVisibility();
  });
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-staff-action]')?.dataset.staffAction;
    if (action === 'new') { selected = ''; render(); field('profile', 'name').focus(); }
    if (action === 'previous') {
      const work = years.get(String(Number(year) - 1))?.employment[selected];
      if (!work) { show('전년도 근무정보가 없습니다.'); return; }
      set('employment', { state: 'active', position: work.position, note: work.note });
      show('전년도 근무정보를 편집란에 불러왔습니다. 저장하면 선택한 학년도에만 반영됩니다.');
    }
    if (action === 'remove') {
      const id = $('assignmentEdit').value;
      if (id && confirm('선택한 학년도의 배정을 해제할까요?')) perform(() => storeYear({ type: 'remove', id }));
    }
  });
  function refresh() {
    epoch++;
    root.hidden = !isAdmin();
    if (!isAdmin()) { profiles.clear(); years.clear(); selected = ''; render(); return; }
    year = String(state.school.year);
    $('year').value = year;
    load().catch(error => show('조회 실패: ' + error.message));
  }
  root.addEventListener('toggle', () => load().catch(error => show('조회 실패: ' + error.message)));
  document.addEventListener('year-change', event => {
    if (!year || Number(year) === event.detail?.previousYear) {
      year = String(state.school.year);
      $('year').value = year;
      load().catch(error => show('조회 실패: ' + error.message));
    }
  });
  document.addEventListener('cloud-change', refresh);
  refresh();
})();
