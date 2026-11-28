/* 학급 관리의 명단과 생활기록부는 현재 학년도의 담임 배정을 공유한다. */
(function () {
  'use strict';
  const MIG = [['', '해당 없음'], ['foreign', '외국인'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const MIG_L = Object.fromEntries(MIG);
  const STATES = { enrolled: '재학', transferred: '전출', graduated: '졸업', deferred: '유예' };
  const root = $('tab-roster');
  const importDialog = $('neisImportDialog');
  let list = [], sel, myRoom, year = '', lead = false, loadingAccess = true;
  let generation = 0, viewGeneration = 0, roomChecked = false, leadChecked = false;
  let unsub, unsubRoom, unsubSchool, unsubLead;
  let rosterStatus = '', search = '', importData;
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
    drafts.clear();
    editingId = null;
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

  const drafts = new Map();
  let editingId = null;
  const parentFields = ['fatherName', 'fatherPhone', 'motherName', 'motherPhone'];
  const fields = ['no', 'name', 'englishName', 'sex', 'birthDate', 'mig', 'country', 'learningSupport', ...parentFields];
  const countryText = row => row.country || [...new Set([row.fatherCountry, row.motherCountry].filter(Boolean))].join(' / ');
  const rowValues = row => ({ ...row, birthDate: (row.birthDate || '').replaceAll('-', '.'),
    country: countryText(row), learningSupport: row.learningSupport === true ? 'yes' : '' });
  function optionList(items, selected) {
    return items.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }
  const countryFlag = name => window.SchoolStatus?.flagUrl?.(window.SchoolStatus.canonicalCountry(name) || name) || '';

  function editableRow(row, isNew = false) {
    const key = isNew ? '' : row.id;
    const draft = drafts.get(key) || rowValues(row);
    const input = (name, label, attrs) => `<input data-field="${name}" aria-label="${label}" value="${esc(draft[name] ?? '')}" ${attrs}>`;
    const select = (name, label, values) => `<select data-field="${name}" aria-label="${label}">${optionList(values, draft[name] || '')}</select>`;
    const flag = draft.mig ? countryFlag(draft.country) : '';
    const listId = isNew ? 'rsCountries-new' : 'rsCountries-' + row.id;
    return `<tr data-roster-row="${esc(key)}"${isNew ? ' class="rs-new"' : ''}>
      <td>${input('no', '번호', 'type="number" min="1" max="99" required')}</td>
      <td><div class="rs-field-stack">${input('name', '이름(한글)', 'maxlength="20" placeholder="한글 이름" required')}${input('englishName', '이름(영문)', 'maxlength="100" placeholder="영문 이름 (선택)"')}</div></td>
      <td><div class="rs-sex" role="group" aria-label="성별">${input('sex', '성별', 'type="hidden"')}
        ${[['m', '남'], ['f', '여']].map(([value, label]) => '<button type="button" data-roster-sex="' + value + '" aria-pressed="' + (draft.sex === value) + '">' + label + '</button>').join('')}</div></td>
      <td>${input('birthDate', '생년월일', 'inputmode="numeric" placeholder="YYYY.MM.DD" maxlength="10"')}</td>
      <td>${select('mig', '이주배경', MIG)}</td>
      <td><div class="rs-country-cell${flag ? ' has-flag' : ''}"><img class="rs-country-flag" alt="" ${flag ? 'src="' + esc(flag) + '"' : 'hidden'}>${input('country', '부모출신국', 'maxlength="30" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + esc(listId) + '"' + (draft.mig ? '' : ' disabled'))}
        <div id="${esc(listId)}" class="rs-country-options" role="listbox" hidden></div></div></td>
      <td>${select('learningSupport', '기초학력', [['', '—'], ['yes', '지원 대상']])}</td>
      ${[['father', '아버지'], ['mother', '어머니']].map(([parent, label]) =>
        '<td><div class="rs-field-stack">' + input(parent + 'Name', label + ' 성함', 'placeholder="성함" maxlength="60"')
        + input(parent + 'Phone', label + ' 연락처', 'type="tel" placeholder="연락처" maxlength="40"') + '</div></td>').join('')}
      <td><div class="rs-row-actions"><button type="button" class="btn small primary" data-row-save>저장</button>
        ${isNew ? '<button type="button" class="btn small danger" data-row-delete>삭제</button>'
          : '<button type="button" class="btn small" data-row-cancel>취소</button>'}</div></td></tr>`;
  }

  function displayStack(primary, secondary) {
    return `<div class="rs-field-stack">${esc(primary || (secondary ? '' : '—'))}${secondary ? '<small>' + esc(secondary) + '</small>' : ''}</div>`;
  }

  function displayCountry(row) {
    return ((row.mig && countryText(row)) || '—').split(' / ').map(country => {
      const url = countryFlag(country);
      return `<span class="rs-country-read">${url ? '<img src="' + esc(url) + '" alt="">' : ''}${esc(country)}</span>`;
    }).join(' ');
  }

  function renderRows() {
    const box = $('rsRows');
    if (!box) return;
    const canEdit = canWrite() && !searchAcrossClasses();
    const shown = sorted(list.filter(row => !search || [row.name, row.englishName || ''].some(name => name.toLowerCase().includes(search))));
    let html = shown.map(row => {
      const editable = canEdit && mayEdit(row) && row.status === 'enrolled';
      if (editable && row.id === editingId) return editableRow(row);
      const number = searchAcrossClasses() ? row.grade + '-' + row.cls + ' · ' + row.no : row.no;
      return `<tr data-roster-row="${esc(row.id)}"><td>${number}</td><td>${displayStack(row.name, row.englishName)}</td>
        <td><span class="rs-sex-value ${row.sex === 'm' || row.sex === 'f' ? row.sex : ''}">${row.sex === 'm' ? '남' : row.sex === 'f' ? '여' : '—'}</span></td>
        <td>${esc((row.birthDate || '—').replaceAll('-', '.'))}</td><td>${esc(MIG_L[row.mig] || '해당 없음')}</td><td>${displayCountry(row)}</td>
        <td>${row.learningSupport === true ? '<span class="rs-support-label">지원 대상</span>' : '해당 없음'}</td>
        <td>${displayStack(row.fatherName, row.fatherPhone)}</td><td>${displayStack(row.motherName, row.motherPhone)}</td>
        <td>${editable ? '<div class="rs-row-actions"><button type="button" class="btn small primary" data-row-edit>수정</button><button type="button" class="btn small danger" data-row-delete>삭제</button></div>' : '—'}</td></tr>`;
    }).join('');
    if (!html && (rosterStatus || search || !canEdit)) {
      html = `<tr><td colspan="10" class="km-empty">${rosterStatus || (search ? '검색 결과가 없습니다.' : '등록된 학생이 없습니다.')}</td></tr>`;
    }
    if (canEdit && !rosterStatus) {
      const used = new Set(list.filter(row => row.status === 'enrolled').map(row => row.no));
      const last = Math.max(0, ...used);
      const next = last < 99 ? last + 1 : Array.from({ length: 99 }, (_, i) => i + 1).find(no => !used.has(no)) || '';
      html += editableRow({ no: next }, true);
    }
    box.innerHTML = html;
  }

  const searchAcrossClasses = () => lead && !!search;

  function renderSummary(enrolled) {
    const total = enrolled.length;
    const male = enrolled.filter(row => row.sex === 'm').length;
    const female = enrolled.filter(row => row.sex === 'f').length;
    const support = enrolled.filter(row => row.learningSupport === true).length;
    const types = ['foreign', 'domestic', 'mid'].map(type => ({
      type, label: MIG_L[type], count: enrolled.filter(row => row.mig === type).length
    }));
    const migrantTotal = types.reduce((sum, { count }) => sum + count, 0);
    const segments = [...types, { type: 'non', label: '비이주배경', count: total - migrantTotal }];
    const percent = count => (total ? count / total * 100 : 0).toFixed(1);
    const largest = Math.max(male, female, 1);
    return `<div class="rs-summary">
      <section class="card rs-summary-card">
        <header><h3>학급 현황</h3><span>전체 <strong>${total}<small>명</small></strong></span></header>
        <dl class="rs-children">${[['boy', '남학생', male], ['girl', '여학생', female]].map(([kind, label, count]) =>
          `<div class="${kind}${count ? '' : ' is-empty'}"><img src="assets/roster-${kind}.svg" width="${Math.round(60 + 24 * count / largest)}" height="84" alt="">
            <dt>${label}</dt><dd>${count}<small>명</small></dd></div>`).join('')}</dl>
      </section>
      <section class="card rs-summary-card rs-summary-migrant">
        <header><h3>이주배경학생 현황</h3><span>이주배경학생 전체 <strong>${migrantTotal}<small>명</small></strong> (${percent(migrantTotal)}%)</span></header>
        <div class="rs-summary-bar" role="img" aria-label="${total ? segments.map(({ label, count }) => label + ' ' + percent(count) + '%').join(', ') : '등록된 학생 없음'}">
          ${segments.filter(item => item.count).map(({ type, label, count }) =>
            `<span class="rs-chart-color ${type}" style="flex-grow:${count}" title="${label} ${percent(count)}%"><span>${percent(count)}%</span></span>`).join('')}
        </div>
        <ul class="rs-summary-legend">${segments.map(({ type, label }) =>
          `<li><i class="rs-chart-color ${type}" aria-hidden="true"></i>${label}</li>`).join('')}</ul>
        <dl class="rs-summary-types">${types.map(({ label, count }) =>
          `<div><dt>${label}</dt><dd>${count}<small>명</small></dd></div>`).join('')}</dl>
      </section>
      <section class="card rs-summary-card rs-summary-support">
        <header><h3>기초학력 현황</h3></header>
        <dl class="rs-summary-metrics"><div><dt>기초학력 지원 대상</dt><dd>${support}<small>명</small></dd></div>
          <div><dt>지원 대상 비율</dt><dd>${percent(support)}<small>%</small></dd></div></dl>
      </section>
    </div>`;
  }

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
    const enrolled = list.filter(row => row.status === 'enrolled' && row.classId === roomId(sel));
    const canImport = canWrite() && !searchAcrossClasses();
    box.innerHTML = `<div class="rs-top"><h2 class="km-title">${year}학년도 ${searchAcrossClasses() ? '전체 학생 검색' : sel.g + '학년 ' + sel.c + '반 학생'}</h2>${classPicker()}</div>
      ${renderSummary(enrolled)}
      <div class="card rs-card rs-list-card"><div class="rs-list-head"><h3>학생 목록</h3><div class="rs-search"><label>학생 이름 <input id="rsSearch" type="search" value="${esc(search)}" placeholder="${lead ? '전체 학생 검색' : '이름 검색'}"></label></div></div>
      <p id="rsStatus" class="km-status" role="status"></p>
      <table class="rs-tbl rs-inline-table"><thead><tr><th>번호</th><th>이름</th><th>성별</th><th>생년월일</th><th>이주배경</th><th>부모출신국</th><th>기초학력</th><th>아버지</th><th>어머니</th><th>관리</th></tr></thead><tbody id="rsRows"></tbody></table></div>
      ${canImport ? `<section class="rs-pdf-drop" id="rsPdfDrop">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/></svg>
        <div><h3>NEIS 학생 명단 가져오기</h3><p>PDF 파일을 끌어다 놓으세요.</p></div>
        <label class="btn small">파일 선택<input id="rsPdfFile" type="file" accept="application/pdf,.pdf" hidden></label>
      </section>` : ''}`;
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
  const supportKeys = [...parentFields, 'englishName', 'mig', 'fatherCountry', 'motherCountry', 'learningSupport', 'country', 'note'];
  const clean = s => ({ grade: sel.g, cls: sel.c, no: Math.max(0, Math.min(99, Number(s.no) || 0)), name: String(s.name || '').trim().slice(0, 20),
    ...Object.fromEntries(parentFields.map(key => [key, String(s[key] || '').trim().slice(0, key.endsWith('Phone') ? 40 : 60)])),
    englishName: String(s.englishName || '').trim().slice(0, 100),
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
        const member = { ...old, ...Object.fromEntries(parentFields.map(key => [key, data[key]])), year: currentYear, studentId: profile.id, classId: group, grade: room.g, cls: room.c,
          no: data.no, displayName: data.name, englishName: data.englishName, sex: data.sex, birthDate: data.birthDate, mig: data.mig, country: data.mig ? data.country : '',
          fatherCountry: data.mig ? data.fatherCountry : '', motherCountry: data.mig ? data.motherCountry : '',
          learningSupport: data.learningSupport, note: data.note,
          status: 'enrolled', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
        tx.set(entry.member, member);
        if (member.mig || old?.mig) YearStudentViews.stage(tx, Cloud.fb, member);
      }
      tx.set(roomRef, { ...roomData, year: currentYear, grade: room.g, cls: room.c, slots });
    });
  }

  function rowDraft(row) {
    return Object.fromEntries(fields.map(key => [key, row.querySelector(`[data-field="${key}"]`).value]));
  }

  function dismissCountries(input) {
    const options = input.nextElementSibling;
    options.hidden = true;
    options.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function refreshCountryFlag(input) {
    const cell = input.parentElement;
    const flag = cell.querySelector('img');
    const url = input.disabled ? '' : countryFlag(window.SchoolStatus?.canonicalCountry(input.value.trim()));
    if (url) flag.src = url;
    else flag.removeAttribute('src');
    flag.hidden = !url;
    cell.classList.toggle('has-flag', !!url);
  }

  function suggestCountries(input) {
    dismissCountries(input);
    refreshCountryFlag(input);
    const search = input.value.trim().toLocaleLowerCase();
    if (!search || input.disabled) return;
    const countries = window.SchoolStatus?.countries || [];
    const normalize = value => value.replace(/\s+/g, '').toLocaleLowerCase();
    const query = normalize(search);
    if (countries.some(country => normalize(country) === query)) return;
    const matches = countries.filter(country => normalize(country).includes(query)).sort((a, b) =>
      Number(normalize(b).startsWith(query)) - Number(normalize(a).startsWith(query)) || a.localeCompare(b, 'ko'));
    if (!matches.length) return;
    const options = input.nextElementSibling;
    options.replaceChildren(...matches.map((country, index) => {
      const item = document.createElement('div');
      item.id = options.id + '-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      const url = countryFlag(country);
      if (url) {
        const flag = document.createElement('img');
        flag.src = url;
        flag.alt = '';
        item.append(flag);
      }
      item.append(country);
      return item;
    }));
    options.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function pickCountry(input, option) {
    input.value = option.textContent;
    refreshCountryFlag(input);
    drafts.set(input.closest('tr').dataset.rosterRow, rowDraft(input.closest('tr')));
    dismissCountries(input);
  }

  async function saveRow(row, remove = false) {
    if (saving || !canWrite() || searchAcrossClasses()) return;
    const key = row.dataset.rosterRow;
    const previous = list.find(item => item.id === key);
    if (key && !previous) return;
    if (remove && !key) {
      drafts.delete('');
      renderRows();
      return;
    }
    if (remove && !confirm('학생을 이 학급 명단에서 제외할까요? 누적 기록은 유지됩니다.')) return;
    const values = remove ? rowValues(previous) : rowDraft(row);
    values.birthDate = values.birthDate.replaceAll('.', '-');
    if (!remove) {
      if (!validDate(values.birthDate)) { say('생년월일을 YYYY.MM.DD 형식의 실제 날짜로 입력해 주세요.'); return; }
      for (const input of row.querySelectorAll('input')) if (!input.reportValidity()) return;
      if (!values.name.trim()) { say('학생 이름을 입력해 주세요.'); return; }
    }
    const sameCountry = previous && values.country.trim() === countryText(previous);
    const rawCountry = values.country.trim();
    const normalizedCountry = window.SchoolStatus?.canonicalCountry(rawCountry) || (rawCountry === '미확인' ? rawCountry : '');
    if (!remove && values.mig && rawCountry && !sameCountry && !normalizedCountry) {
      say('부모출신국은 추천 국가명을 선택하거나 미확인으로 입력해 주세요.');
      row.querySelector('[data-field="country"]').focus();
      return;
    }
    const data = clean({
      ...previous, ...values,
      country: sameCountry ? previous.country : normalizedCountry,
      fatherCountry: sameCountry ? previous.fatherCountry : '',
      motherCountry: sameCountry ? previous.motherCountry : ''
    });
    saving = true;
    const token = viewGeneration;
    row.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await writeRows([{ id: key || undefined, data, leaving: remove }]);
      if (token !== viewGeneration) return;
      drafts.delete(key);
      if (key === editingId) editingId = null;
      renderRows();
      say(remove ? '학급 명단에서 제외했습니다.' : key ? '학생 정보를 저장했습니다.' : '학생을 등록했습니다.', true);
      if (!key) $('rsRows')?.querySelector('.rs-new [data-field="name"]')?.focus();
    } catch {
      if (token === viewGeneration) say('저장하지 못했습니다. 학생 번호 중복과 학급 배정을 확인해 주세요.');
    } finally {
      saving = false;
      if (token === viewGeneration) $('rsRows')?.querySelectorAll('button[disabled]').forEach(button => { button.disabled = false; });
    }
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

  root.addEventListener('click', event => {
    const option = event.target.closest('.rs-country-options [role="option"]');
    if (option) { pickCountry(option.parentElement.previousElementSibling, option); return; }
    const row = event.target.closest('[data-roster-row]');
    const sexButton = event.target.closest('[data-roster-sex]');
    if (row && sexButton) {
      row.querySelector('[data-field="sex"]').value = sexButton.dataset.rosterSex;
      row.querySelectorAll('[data-roster-sex]').forEach(button => button.setAttribute('aria-pressed', button === sexButton));
      drafts.set(row.dataset.rosterRow, rowDraft(row));
      return;
    }
    if (row && event.target.closest('[data-row-edit], [data-row-cancel]')) {
      if (saving) return;
      if (editingId) drafts.delete(editingId);
      editingId = event.target.closest('[data-row-edit]') ? row.dataset.rosterRow : null;
      renderRows();
      if (editingId) [...$('rsRows').rows].find(item => item.dataset.rosterRow === editingId)?.querySelector('[data-field="name"]')?.focus();
      return;
    }
    if (row && event.target.closest('[data-row-save], [data-row-delete]')) {
      saveRow(row, !!event.target.closest('[data-row-delete]'));
    } else if (event.target.closest('[data-close-student-dialog]')) event.target.closest('dialog')?.close();
    else if (event.target.closest('[data-rsc]')) chooseClass(event);
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-rs-grade]')) chooseClass(event);
    const row = event.target.closest('[data-roster-row]');
    if (row && event.target.matches('[data-field]')) {
      if (event.target.dataset.field === 'mig') {
        const country = row.querySelector('[data-field="country"]');
        country.disabled = !event.target.value;
        dismissCountries(country);
        refreshCountryFlag(country);
      }
      if (event.target.dataset.field.endsWith('Phone')) {
        const input = event.target;
        const match = /^(01[016789])[- ]?(\d{3,4})[- ]?(\d{4})$/.exec(input.value.trim());
        if (match) input.value = match.slice(1).join('-');
      }
      drafts.set(row.dataset.rosterRow, rowDraft(row));
    }
    if (event.target.id === 'rsPdfFile') {
      readPdf(event.target.files[0]);
      event.target.value = '';
    }
  });
  root.addEventListener('input', event => {
    const row = event.target.closest('[data-roster-row]');
    if (row && event.target.matches('[data-field]')) {
      if (event.target.dataset.field === 'birthDate' && /^\d{8}$/.test(event.target.value)) {
        event.target.value = event.target.value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
      }
      drafts.set(row.dataset.rosterRow, rowDraft(row));
      if (event.target.dataset.field === 'country') suggestCountries(event.target);
      return;
    }
    if (event.target.id !== 'rsSearch') return;
    const previous = searchAcrossClasses();
    search = event.target.value.trim().toLowerCase();
    if (previous !== searchAcrossClasses()) watch();
    else renderRows();
  });
  root.addEventListener('mousedown', event => {
    if (event.target.closest('.rs-country-options [role="option"]')) event.preventDefault();
  });
  root.addEventListener('focusin', event => {
    if (event.target.matches('[data-field="country"]')) suggestCountries(event.target);
  });
  root.addEventListener('focusout', event => {
    if (event.target.matches('[data-field="country"]')) dismissCountries(event.target);
  });
  root.addEventListener('keydown', event => {
    const input = event.target;
    if (!input.matches('[data-field="country"]')) return;
    const options = input.nextElementSibling;
    if (options.hidden) return;
    const choices = [...options.children];
    if (event.key === 'Escape') { event.preventDefault(); dismissCountries(input); return; }
    if (event.key === 'Enter') {
      const active = options.querySelector('[aria-selected="true"]');
      if (active) { event.preventDefault(); pickCountry(input, active); }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const selected = choices.findIndex(option => option.getAttribute('aria-selected') === 'true');
      const next = selected < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1)
        : (selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices.forEach((option, index) => option.setAttribute('aria-selected', index === next));
      input.setAttribute('aria-activedescendant', choices[next].id);
      choices[next].scrollIntoView({ block: 'nearest' });
    }
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
