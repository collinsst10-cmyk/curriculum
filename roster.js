/* 학급 관리의 명단과 생활기록부는 현재 학년도의 담임 배정을 공유한다. */
(function () {
  'use strict';
  const MIG = [['', '해당 없음'], ['foreign', '외국인'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const MIG_L = Object.fromEntries(MIG);
  const STATES = { enrolled: '재학', transferred: '전출', graduated: '졸업', deferred: '유예' };
  const root = $('tab-roster');
  const detail = $('studentDetailDialog');
  const importDialog = $('neisImportDialog');
  let list = [], sel, myRoom, year = '', lead = false, loadingAccess = true;
  let generation = 0, viewGeneration = 0, roomChecked = false, leadChecked = false;
  let unsub, unsubRoom, unsubSchool, unsubLead;
  let rosterStatus = '', search = '', detailStudent, importData;
  let saving = false;
  const F = () => Cloud.fb.F, db = () => Cloud.fb.db;
  const ready = () => !!(window.Cloud?.ready && !Cloud.isGeneral && !App.locked());
  const classCnt = g => Math.min(20, Number(state.school.classes?.[g]) || 0);
  const collection = () => F().collection(db(), 'rosterYears', year, 'memberships');
  const roomId = room => room ? room.g + '-' + room.c : '';
  const isAdmin = () => ready() && Cloud.isAdmin();
  const mayEdit = row => isAdmin() || (!!myRoom && row.classId === roomId(myRoom));
  const canWrite = () => ready() && !!sel?.c && (isAdmin() || (!!myRoom && roomId(sel) === roomId(myRoom)));
  const canView = () => ready() && (isAdmin() || loadingAccess || lead || !!myRoom);
  TAB_GUARDS.roster = ready;
  TAB_GUARDS['learning-support'] = TAB_GUARDS['student-records'] = canView;
  const say = (message, ok) => {
    const status = $('rsStatus');
    if (status) { status.textContent = message; status.classList.toggle('ok', !!ok); }
  };

  function closeEditors() {
    detail.close();
    importDialog.close();
  }

  function clearYear() {
    generation++;
    viewGeneration++;
    unsub?.(); unsubRoom?.(); unsubLead?.();
    unsub = unsubRoom = unsubLead = undefined;
    list = []; sel = myRoom = undefined; lead = false; roomChecked = leadChecked = false;
    rosterStatus = ''; search = '';
    loadingAccess = ready();
    closeEditors();
    window.BehaviorUI?.sync([]);
  }

  function accessChanged() {
    loadingAccess = !roomChecked || !leadChecked;
    if (loadingAccess) { refresh(); return; }
    if (!lead) sel = myRoom;
    else if (!sel) {
      const g = GRADES.find(classCnt);
      sel = myRoom || (g ? { g, c: 1 } : null);
    }
    watch();
  }

  function useYear(next) {
    clearYear();
    year = /^20[0-9]{2}$/.test(String(next)) ? String(next) : '';
    if (!year) { loadingAccess = false; refresh(); return; }
    if (isAdmin()) {
      lead = true;
      roomChecked = leadChecked = true;
      accessChanged();
      return;
    }
    const token = generation;
    const email = Cloud.email.toLowerCase();
    const setLead = allowed => {
      if (token !== generation || !ready()) return;
      if (leadChecked && lead === allowed) return;
      leadChecked = true;
      lead = allowed;
      accessChanged();
    };
    const checkLead = () => {
      const request = ++leadRequest;
      F().getDocFromServer(F().doc(db(), 'rosterYears', year, 'leadAccess', email))
        .then(() => { if (request === leadRequest) setLead(true); })
        .catch(() => { if (request === leadRequest) setLead(false); });
    };
    let leadRequest = 0;
    unsubRoom = StaffLinks.watchRoom(F(), db(), email, year, snapshot => {
      if (token !== generation) return;
      const [g, c] = String(snapshot.data()?.classId || '').split('-').map(Number);
      myRoom = g && c ? { g, c } : null;
      roomChecked = true;
      accessChanged();
      checkLead();
    }, () => {
      if (token !== generation) return;
      myRoom = null;
      roomChecked = true;
      accessChanged();
      checkLead();
    });
    unsubLead = F().onSnapshot(F().doc(db(), 'staffSchedule', year),
      { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.metadata.fromCache && token === generation) checkLead();
      }, () => { if (token === generation) setLead(false); });
    refresh();
  }

  function subscribe() {
    unsubSchool?.(); unsubSchool = undefined;
    clearYear();
    year = '';
    if (!ready()) { refresh(); return; }
    const token = Cloud.user?.uid;
    unsubSchool = F().onSnapshot(F().doc(db(), 'config', 'school'), snapshot => {
      if (!ready() || token !== Cloud.user?.uid) return;
      const next = snapshot.data()?.year;
      if (String(next) !== year) useYear(next);
    }, () => { if (ready() && token === Cloud.user?.uid) useYear(null); });
  }

  function watch() {
    const token = ++viewGeneration;
    unsub?.(); unsub = undefined;
    list = [];
    rosterStatus = '';
    closeEditors();
    window.BehaviorUI?.sync([]);
    const room = roomId(sel);
    if (!sel?.c || !year || !canView()) { refresh(); return; }
    rosterStatus = '명단을 불러오는 중…';
    const query = lead && search ? collection() : F().query(collection(), F().where('classId', '==', room));
    unsub = F().onSnapshot(query, { includeMetadataChanges: true }, snapshot => {
      if (token !== viewGeneration || !ready() || snapshot.metadata.fromCache) return;
      list = snapshot.docs.map(doc => doc.data()).map(row => ({ ...row, id: row.studentId, name: row.displayName }));
      rosterStatus = '';
      refresh();
    }, () => {
      if (token !== viewGeneration) return;
      list = [];
      rosterStatus = '학생 명단을 불러오지 못했습니다.';
      refresh();
    });
    refresh();
  }

  const sorted = rows => rows.slice().sort((a, b) =>
    (lead && search ? a.grade - b.grade || a.cls - b.cls : 0) || a.no - b.no || String(a.name).localeCompare(b.name));
  function classPicker() {
    return lead ? `<span class="rs-pick"><select data-rs-grade aria-label="학년">${GRADES.map(g =>
      `<option value="${g}" ${sel?.g === g ? 'selected' : ''}>${g}학년</option>`).join('')}</select>
      ${Array.from({ length: classCnt(sel?.g || 1) }, (_, i) => `<button type="button" class="km-pill${sel?.c === i + 1 ? ' on' : ''}" data-rsc="${i + 1}">${i + 1}반</button>`).join('')}</span>`
      : '';
  }

  function renderRecords() {
    $('recordClassPicker').innerHTML = lead ? classPicker() : '';
    const canWriteRecords = canWrite() || (lead && Cloud.isAdmin());
    const rows = canWriteRecords ? sorted(list.filter(row => row.status === 'enrolled' && row.classId === roomId(sel))) : [];
    window.BehaviorUI?.sync(rows);
    const status = $('recordRosterStatus');
    status.hidden = !!rows.length;
    status.textContent = loadingAccess ? '불러오는 중…' : !canWriteRecords ? '담당 학급의 기록을 작성할 수 있습니다.'
      : rosterStatus || '등록된 학생이 없습니다.';
  }

  function renderRows() {
    const box = $('rsRows');
    if (!box) return;
    const rows = sorted(list.filter(row => !search || row.name.toLowerCase().includes(search)));
    box.innerHTML = rows.map(row => {
      const editable = mayEdit(row) && row.status === 'enrolled';
      const detail = `data-student-detail="${esc(row.id)}"`;
      return `<tr><td>${lead && search ? row.grade + '-' + row.cls + ' · ' : ''}${row.no}</td>
        <td><button type="button" class="btn small rs-student-name" ${detail}>${esc(row.name)}</button></td>
        <td>${row.sex === 'm' ? '남' : row.sex === 'f' ? '여' : '—'}</td><td>${esc(row.birthDate || '—')}</td>
        <td>${esc(MIG_L[row.mig] || '—')}</td><td>${row.learningSupport === true ? '지원 대상' : '—'}</td><td>${editable
          ? `<button type="button" class="btn small" ${detail} data-edit-student>수정</button>` : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="km-empty">${rosterStatus || (search ? '검색 결과가 없습니다.' : '등록된 학생이 없습니다.')}</td></tr>`;
  }

  const searchAcrossClasses = () => lead && !!search;

  function render() {
    const box = $('rsMain');
    if (!ready() || loadingAccess || !sel?.c) {
      const message = !ready() ? '학생 명단에 접근할 수 없습니다.' : loadingAccess ? '불러오는 중…'
        : !year ? '현재 운영 학년도를 확인하지 못했습니다.'
        : lead ? '설정된 학급이 없습니다.'
        : '현재 운영 학년도에 등록된 담임 배정이나 연구부장·교무부장 보직이 없습니다. 교직원 관리의 학년도별 배정을 확인해 주세요.';
      box.innerHTML = `<div class="rs-top"><h2 class="km-title">학생 관리</h2></div><p class="hint">${message}</p>`;
      return;
    }
    const focus = document.activeElement?.id === 'rsSearch';
    const enrolled = list.filter(row => row.status === 'enrolled');
    const m = enrolled.filter(row => row.sex === 'm').length, f = enrolled.filter(row => row.sex === 'f').length;
    const canImport = canWrite() && !searchAcrossClasses();
    box.innerHTML = `<div class="rs-top"><h2 class="km-title">${year}학년도 ${searchAcrossClasses() ? '전체 학생 검색' : sel.g + '학년 ' + sel.c + '반 학생'}</h2>${classPicker()}</div>
      <div class="sx-kpis rs-kpis rs-summary">${[['전체', enrolled.length], ['남학생', m], ['여학생', f]].map(([label, count]) =>
        `<div class="sx-kpi"><b>${count}<small>명</small></b><span>${label}</span></div>`).join('')}</div>
      <div class="rs-search"><label>학생 이름 <input id="rsSearch" type="search" value="${esc(search)}" placeholder="${lead ? '전체 학생 검색' : '이름 검색'}"></label></div>
      <p id="rsStatus" class="km-status" role="status"></p>
      <div class="card rs-card"><table class="rs-tbl"><thead><tr><th>번호</th><th>이름</th><th>성별</th><th>생년월일</th><th>이주배경</th><th>기초학력</th><th>수정</th></tr></thead><tbody id="rsRows"></tbody></table></div>
      ${canImport ? `<section class="rs-pdf-drop" id="rsPdfDrop">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/></svg>
        <div><h3>NEIS 학생 명단 가져오기</h3><p>PDF 파일을 끌어다 놓으세요.</p></div>
        <label class="btn small">파일 선택<input id="rsPdfFile" type="file" accept="application/pdf,.pdf" hidden></label>
      </section><button type="button" class="btn small rs-manual" data-student-add>학생 한 명 등록</button>` : ''}`;
    renderRows();
    if (focus) $('rsSearch').focus();
  }

  function refresh() {
    if (curTab === 'student-records') renderRecords();
    else if (curTab === 'roster') render();
    else if (curTab === 'learning-support') renderLearningSupport();
    const nav = $('tabs');
    if (nav && ['roster', 'student-records', 'learning-support'].includes(curTab)) {
      for (const tab of nav.querySelectorAll('[data-group="cls"]')) {
        tab.hidden = tab.dataset.tab === 'roster' ? !ready() : !canView();
      }
    }
  }

  function renderLearningSupport() {
    const rows = canView() && sel?.c ? sorted(list.filter(row => row.classId === roomId(sel)
      && row.status === 'enrolled' && row.learningSupport === true)) : [];
    $('learningSupportRoster').innerHTML = `<div class="rs-top"><h2 class="km-title">기초학력 지원</h2>${classPicker()}</div>
      ${sel?.c ? `<p class="hint">${year}학년도 ${sel.g}학년 ${sel.c}반</p>` : ''}
      <div class="card rs-card"><table class="rs-tbl"><thead><tr><th>번호</th><th>이름</th><th>학급</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${row.no}</td><td>${esc(row.name)}</td><td>${row.grade}학년 ${row.cls}반</td></tr>`).join('')
        || `<tr><td colspan="3" class="km-empty">${rosterStatus || (loadingAccess ? '불러오는 중…' : '등록된 지원 대상 학생이 없습니다.')}</td></tr>`}
      </tbody></table></div>`;
  }
  const supportKeys = ['mig', 'fatherCountry', 'motherCountry', 'learningSupport', 'country', 'note'];
  const clean = s => ({ grade: sel.g, cls: sel.c, no: Math.max(0, Math.min(99, Number(s.no) || 0)), name: String(s.name || '').trim().slice(0, 20),
    birthDate: validDate(s.birthDate) ? (s.birthDate || '') : '',
    sex: ['m', 'f'].includes(s.sex) ? s.sex : '', mig: MIG_L[s.mig] !== undefined ? s.mig : '', country: s.mig ? String(s.country || '').trim().slice(0, 30) : '',
    fatherCountry: s.mig ? String(s.fatherCountry || '').trim().slice(0, 30) : '',
    motherCountry: s.mig ? String(s.motherCountry || '').trim().slice(0, 30) : '',
    learningSupport: s.learningSupport === true || s.learningSupport === 'yes',
    note: String(s.note || '').trim().slice(0, 60), updatedBy: Cloud.email, updatedAt: F().serverTimestamp() });

  async function writeRows(records) {
    const f = F(), currentYear = year, room = sel;
    if (!room?.c || !currentYear || !canWrite()) throw new Error('학급을 선택해 주세요.');
    const group = room.g + '-' + room.c;
    const roomRef = f.doc(db(), 'rosterYears', currentYear, 'classes', group);
    const entries = records.map(({ id, data, leaving, importFields }) => {
      const profile = id ? f.doc(db(), 'studentProfiles', id) : f.doc(f.collection(db(), 'studentProfiles'));
      return { id, profile, data, leaving, importFields, member: f.doc(db(), 'rosterYears', currentYear, 'memberships', profile.id) };
    });
    await f.runTransaction(db(), async tx => {
      const roomData = (await tx.get(roomRef)).data() || {};
      const slots = { ...roomData.slots };
      const current = await Promise.all(entries.map(entry => entry.id ? tx.get(entry.member) : null));
      for (const [i, entry] of entries.entries()) {
        const old = current[i]?.data(), { profile } = entry;
        let data = entry.data;
        if (old && entry.importFields) {
          data = { ...data, ...Object.fromEntries(supportKeys.filter(key => !entry.importFields.includes(key))
            .map(key => [key, old[key] ?? (key === 'learningSupport' ? false : '')])) };
        }
        if (entry.id && (!old || old.classId !== group || old.status !== 'enrolled')) throw new Error('학생의 소속이 변경되었습니다.');
        if (!entry.leaving && (!data.name || !Number.isInteger(data.no) || data.no < 1 || data.no > 99)) throw new Error('이름과 1~99번 사이의 학생 번호를 확인해 주세요.');
        if (old && slots[old.no] === profile.id) delete slots[old.no];
        if (entry.leaving) {
          if (old.mig) YearStudentViews.stage(tx, Cloud.fb, { ...old, status: 'transferred' });
          tx.update(entry.member, { status: 'transferred', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email });
          continue;
        }
        if (slots[data.no]) throw new Error(data.no + '번 학생이 이미 등록되어 있습니다.');
        slots[data.no] = profile.id;
        if (!entry.id) tx.set(profile, { name: data.name, sex: data.sex, createdAt: f.serverTimestamp() });
        else if (data.name !== old.displayName || data.sex !== (old.sex || '')) tx.update(profile, { name: data.name, sex: data.sex });
        const member = { ...old, year: currentYear, studentId: profile.id, classId: group, grade: room.g, cls: room.c,
          no: data.no, displayName: data.name, sex: data.sex, birthDate: data.birthDate, mig: data.mig, country: data.mig ? data.country : '',
          fatherCountry: data.mig ? data.fatherCountry : '', motherCountry: data.mig ? data.motherCountry : '',
          learningSupport: data.learningSupport, note: data.note,
          status: 'enrolled', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
        tx.set(entry.member, member);
        if (member.mig || old?.mig) YearStudentViews.stage(tx, Cloud.fb, member);
      }
      tx.set(roomRef, { ...roomData, year: currentYear, grade: room.g, cls: room.c, slots });
    });
  }

  function showDetail(student) {
    const editable = canWrite() && !searchAcrossClasses() && (!student || student.status === 'enrolled');
    if (!student && !editable) return;
    detailStudent = student || null;
    const form = $('studentDetailForm');
    form.reset();
    const fields = form.elements;
    const row = student || { no: Math.max(0, ...list.map(item => item.no)) + 1 };
    for (const key of ['no', 'name', 'sex', 'birthDate', 'mig', 'fatherCountry', 'motherCountry', 'learningSupport', 'note']) {
      fields[key].value = key === 'learningSupport' ? (row[key] === true ? 'yes' : '') : row[key] ?? '';
      fields[key].disabled = !editable;
    }
    $('studentDetailTitle').textContent = student ? '학생 상세정보' : '학생 등록';
    $('studentDetailState').textContent = student ? STATES[student.status] || '—' : '';
    $('studentDetailSave').hidden = !editable;
    $('studentDetailRemove').hidden = !editable || !student;
    $('studentDetailStatus').textContent = '';
    renderParentCountries();
    detail.showModal();
  }

  async function withDetailSave(action, message) {
    if (saving || !canWrite() || searchAcrossClasses()) return;
    saving = true;
    const token = viewGeneration;
    try {
      await action();
      if (token !== viewGeneration) return;
      detail.close();
      say(message, true);
    } catch {
      if (detail.open && token === viewGeneration) $('studentDetailStatus').textContent = '저장하지 못했습니다. 학생 번호와 담당 학급을 확인해 주세요.';
    } finally { saving = false; }
  }

  const parentForm = $('studentDetailForm');
  function renderParentCountries() {
    $('rosterParentCountries').hidden = !parentForm.elements.mig.value;
    const legacy = $('rosterLegacyCountry');
    const country = detailStudent?.country;
    legacy.hidden = !country || !!(detailStudent?.fatherCountry || detailStudent?.motherCountry);
    legacy.textContent = country ? '기존 부모 출신국 · ' + country : '';
  }
  parentForm.elements.mig.addEventListener('change', renderParentCountries);
  for (const name of ['fatherCountry', 'motherCountry']) {
    const input = parentForm.elements[name], options = $(name + 'Options');
    let choices = [], selected = -1;
    function close() {
      choices = []; selected = -1; options.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function show() {
      const query = input.value.trim().toLocaleLowerCase();
      if (!query) { close(); return; }
      const countries = window.SchoolStatus?.countries || [];
      const rank = country => country.toLocaleLowerCase() === query ? 0 : country.toLocaleLowerCase().startsWith(query) ? 1 : 2;
      choices = countries.filter(country => country.toLocaleLowerCase().includes(query))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'));
      if (!choices.length) { close(); return; }
      selected = -1;
      input.removeAttribute('aria-activedescendant');
      options.replaceChildren(...choices.map((country, index) => {
        const item = document.createElement('span');
        item.id = name + '-country-' + index;
        item.dataset.index = index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = country;
        return item;
      }));
      options.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function pick(index) {
      if (!choices[index]) return;
      input.value = choices[index];
      close();
    }
    input.addEventListener('input', show);
    input.addEventListener('focus', show);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !options.hidden) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (options.hidden) show();
        if (!choices.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        selected = selected < 0 ? (step > 0 ? 0 : choices.length - 1) : (selected + step + choices.length) % choices.length;
        [...options.children].forEach((option, index) => option.setAttribute('aria-selected', index === selected));
        const active = options.children[selected];
        input.setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && selected >= 0) {
        event.preventDefault();
        pick(selected);
      }
    });
    options.addEventListener('mousedown', event => event.preventDefault());
    options.addEventListener('click', event => {
      const choice = event.target.closest('[data-index]');
      if (choice) pick(Number(choice.dataset.index));
    });
  }

  function validDate(value) {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function importDraft(extracted, existing, context) {
    if (String(extracted.year) !== context.year || Number(extracted.grade) !== context.grade ||
        Number(extracted.cls) !== context.cls || !Array.isArray(extracted.rows) || !extracted.rows.length ||
        extracted.rows.length > 99) throw new Error('PDF의 학년도, 학년·반, 학생 명단을 확인해 주세요.');
    const numbers = new Set(), ids = new Set();
    return extracted.rows.map((row, index) => {
      const no = Number(row.no), name = String(row.name || '').trim();
      if (!Number.isInteger(no) || no < 1 || no > 99 || !name || name.length > 20 ||
          !validDate(row.birthDate) || numbers.has(no)) throw new Error((index + 1) + '번째 행의 번호, 이름 또는 생년월일을 확인해 주세요.');
      if (row.sex && !['m', 'f'].includes(row.sex)) throw new Error((index + 1) + '번째 행의 성별을 확인해 주세요.');
      if (row.status && row.status !== 'enrolled') throw new Error((index + 1) + '번째 행의 재학 상태를 확인해 주세요.');
      numbers.add(no);
      const occupied = existing.find(student => student.no === no && student.status === 'enrolled');
      const match = row.id ? existing.find(student => student.id === row.id) : occupied;
      if ((row.id && !match) || (match && (match.status !== 'enrolled' || match.name !== name || ids.has(match.id)
          || (match.birthDate && row.birthDate && match.birthDate !== row.birthDate)))
          || (occupied && occupied.id !== match?.id)
          || (!match && existing.some(student => student.name === name))) {
        throw new Error((index + 1) + '번째 행은 기존 학생과의 연결을 확인해야 합니다. 명단에서 확인한 뒤 다시 시도해 주세요.');
      }
      if (match) ids.add(match.id);
      const support = {};
      if (row.mig && Object.hasOwn(MIG_L, row.mig)) support.mig = row.mig;
      for (const key of ['fatherCountry', 'motherCountry']) {
        if (typeof row[key] === 'string' && row[key].trim()) support[key] = row[key].trim();
      }
      if (typeof row.learningSupport === 'boolean') support.learningSupport = row.learningSupport;
      if (support.fatherCountry || support.motherCountry) support.country = '';
      return { id: match?.id, importFields: Object.keys(support), data: { ...match, ...support, no, name,
        sex: row.sex || match?.sex || '', birthDate: row.birthDate || match?.birthDate || '' } };
    });
  }

  function previewImport(extracted) {
    const context = { year, grade: sel.g, cls: sel.c };
    const draft = importDraft(extracted, list, context);
    importData = { context, source: extracted, token: viewGeneration };
    $('neisImportSave').disabled = false;
    $('neisImportRows').innerHTML = draft.map(({ id, data }) =>
      `<tr><td><input type="number" aria-label="번호" value="${data.no}" min="1" max="99" required></td>
      <td><input aria-label="이름" value="${esc(data.name)}" maxlength="20" required></td>
      <td><select aria-label="성별"><option value="">미확인</option><option value="m" ${data.sex === 'm' ? 'selected' : ''}>남</option>
      <option value="f" ${data.sex === 'f' ? 'selected' : ''}>여</option></select></td>
      <td><input type="date" aria-label="생년월일" value="${esc(data.birthDate)}"></td><td>${id ? '기존 학생 수정' : '신규 등록'}</td></tr>`).join('');
    $('neisImportStatus').textContent = '신규 ' + draft.filter(row => !row.id).length + '명 · 기존 ' + draft.filter(row => row.id).length + '명';
    importDialog.showModal();
  }

  async function readPdf(file) {
    if (!file || !canWrite() || searchAcrossClasses()) return;
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) { say('PDF 파일을 선택해 주세요.'); return; }
    const token = viewGeneration;
    try {
      const header = await file.slice(0, 5).text();
      if (token !== viewGeneration || !canWrite()) return;
      if (header !== '%PDF-') { say('정상적인 PDF 파일을 선택해 주세요.'); return; }
      if (!window.NeisRosterPdf?.extract) { say('NEIS 샘플 양식 확인 전입니다. PDF 자동 추출과 등록은 아직 사용할 수 없습니다.'); return; }
      const extracted = await window.NeisRosterPdf.extract(file);
      if (token === viewGeneration && canWrite()) previewImport(extracted);
    } catch { if (token === viewGeneration) say('PDF 명단을 확인하지 못했습니다. 파일과 학년도·학급을 확인해 주세요.'); }
  }

  $('neisImportForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !canWrite() || importData?.token !== viewGeneration) return;
    const { source, context, token } = importData;
    const rows = [...$('neisImportRows').rows].map((tr, i) => {
      const [no, name, sex, birthDate] = tr.querySelectorAll('input, select');
      return { ...source.rows[i], no: no.value, name: name.value, sex: sex.value, birthDate: birthDate.value };
    });
    let draft;
    try { draft = importDraft({ ...source, rows }, list, context); }
    catch (error) { $('neisImportStatus').textContent = error.message; return; }
    saving = true;
    let count = 0;
    try {
      for (const row of draft) {
        if (token !== viewGeneration || !canWrite()) throw new Error();
        await writeRows([{ id: row.id, data: clean(row.data), importFields: row.importFields }]);
        count++;
      }
      importDialog.close();
      say(count + '명의 명단을 반영했습니다.', true);
    } catch {
      $('neisImportStatus').textContent = count + '명 반영했습니다. 중단된 항목은 현재 명단을 확인한 후 다시 불러와 주세요.';
      $('neisImportSave').disabled = true;
    } finally { saving = false; }
  });

  $('studentDetailForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!canWrite() || !event.target.reportValidity()) return;
    const values = Object.fromEntries(new FormData(event.target));
    if (!values.fatherCountry && !values.motherCountry) values.country = detailStudent?.country || '';
    const data = clean(values), id = detailStudent?.id;
    withDetailSave(() => writeRows([{ id, data }]), id ? '학생 정보를 수정했습니다.' : '학생을 등록했습니다.');
  });
  $('studentDetailRemove').addEventListener('click', () => {
    if (detailStudent && canWrite() && confirm('학생을 현재 학급 명단에서 제외할까요? 누적 기록은 유지됩니다.')) {
      const id = detailStudent.id;
      withDetailSave(() => writeRows([{ id, leaving: true }]), '학급 명단에서 제외했습니다.');
    }
  });

  root.addEventListener('click', event => {
    const student = event.target.closest('[data-student-detail]');
    if (student) {
      const row = list.find(item => item.id === student.dataset.studentDetail);
      if (row && student.hasAttribute('data-edit-student') && mayEdit(row) && searchAcrossClasses()) {
        sel = { g: row.grade, c: row.cls };
        search = '';
        watch();
      }
      if (row) showDetail(row);
    } else if (event.target.closest('[data-student-add]')) showDetail(null);
    else if (event.target.closest('[data-close-student-dialog]')) event.target.closest('dialog')?.close();
    else if (event.target.closest('[data-rsc]')) chooseClass(event);
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-rs-grade]')) chooseClass(event);
    if (event.target.id === 'rsPdfFile') {
      readPdf(event.target.files[0]);
      event.target.value = '';
    }
  });
  root.addEventListener('input', event => {
    if (event.target.id !== 'rsSearch') return;
    const previous = searchAcrossClasses();
    search = event.target.value.trim().toLowerCase();
    if (previous !== searchAcrossClasses()) watch();
    else renderRows();
  });
  for (const type of ['dragover', 'dragleave', 'drop']) root.addEventListener(type, event => {
    const drop = event.target.closest('#rsPdfDrop');
    if (!drop) return;
    event.preventDefault();
    drop.classList.toggle('is-over', type === 'dragover');
    if (type === 'drop') {
      if (event.dataTransfer.files.length !== 1) { say('PDF 파일을 한 번에 하나만 선택해 주세요.'); return; }
      readPdf(event.dataTransfer.files[0]);
    }
  });

  function chooseClass(event) {
    if (!lead) return;
    const grade = event.target.closest('[data-rs-grade]');
    const button = event.target.closest('[data-rsc]');
    if (!grade && !button) return;
    const g = Number((grade || button.closest('.rs-pick').querySelector('[data-rs-grade]')).value);
    sel = { g, c: button ? Number(button.dataset.rsc) : classCnt(g) ? 1 : 0 };
    search = '';
    watch();
  }
  const picker = $('recordClassPicker');
  picker.addEventListener('change', chooseClass);
  picker.addEventListener('click', chooseClass);

  RENDER.roster = render;
  $('learningSupportRoster').addEventListener('change', chooseClass);
  $('learningSupportRoster').addEventListener('click', chooseClass);
  RENDER['learning-support'] = () => {
    if (searchAcrossClasses()) { search = ''; watch(); }
    else renderLearningSupport();
  };
  RENDER['student-records'] = () => {
    if (searchAcrossClasses()) { search = ''; watch(); }
    else renderRecords();
  };
  document.addEventListener('cloud-change', subscribe);
  if (ready()) subscribe();
})();
