'use strict';

(() => {
  const root = document.getElementById('yearRoster');
  const $ = id => document.getElementById(id);
  const admin = () => window.Cloud?.ready && Cloud.isAdmin();
  const F = () => Cloud.fb.F;
  const db = () => Cloud.fb.db;
  const doc = (...path) => F().doc(db(), ...path);
  let epoch = 0;
  let rows = [];
  let preview = null;
  const staff = () => window.Cloud?.ready && (Cloud.isAdmin() || Cloud.position?.posType === 'homeroom');

  const classId = (grade, cls) => grade + '-' + cls;
  const membership = (year, id) => doc('rosterYears', year, 'memberships', id);
  const identity = id => doc('studentProfiles', id);
  const classroom = (year, grade, cls) => doc('rosterYears', year, 'classes', classId(grade, cls));
  const status = message => { $('yrStatus').textContent = message; };
  const option = (value, label) => new Option(label, value);

  function context() {
    return { year: $('yrYear').value, grade: Number($('yrGrade').value), cls: Number($('yrClass').value) };
  }

  function refresh() {
    root.hidden = !staff();
    document.getElementById("yrAdminFields").hidden = !admin();
    document.getElementById("yrPicker").hidden = !admin();
    if (!staff()) { epoch++; clearWorkbook(); rows = []; preview = null; $('yrRows').replaceChildren(); return; }
    $('yrYear').value = state.school.year;
    fillClasses();
    if (root.open) load();
  }

  function fillClasses() {
    const grade = Number($('yrGrade').value);
    const year = Number($('yrYear').value);
    const classes = year === state.school.year ? state.school.classes
      : state.yearPlans?.[year]?.school?.classes || state.yearArchive?.[year]?.classes;
    const count = Math.min(20, Math.max(0, Number(classes?.[grade]) || 0));
    const selected = $('yrClass').value;
    $('yrClass').replaceChildren(...Array.from({ length: (classes ? count : 20) }, (_, i) => option(i + 1, (i + 1) + '반')));
    if (Number(selected) <= ((classes ? count : 20)) && Number(selected) > 0) $('yrClass').value = selected;
  }

  async function load() {
    if (!staff()) return;
    const token = ++epoch;
    clearWorkbook();
    preview = null;
    rows = [];
    $('yrRows').replaceChildren();
    $('yrPreview').replaceChildren();
    $('yrApply').disabled = true;
    const { year, grade, cls } = context();
    if (!/^20[0-9]{2}$/.test(year)) { status('학년도를 네 자리로 입력해 주세요.'); return; }
    status('명단을 불러오는 중입니다.');
    try {
      const f = F();
      let targetClass = classId(grade, cls);
      if (!admin()) {
        const assignment = await f.getDoc(doc('rosterYears', year, 'homerooms', Cloud.email.toLowerCase()));
        if (token !== epoch) return;
        if (!assignment.exists()) { status('이 학년도에 배정된 담임 학급이 없습니다.'); return; }
        targetClass = assignment.data().classId;
      }
      const col = f.collection(db(), 'rosterYears', year, 'memberships');
      const result = await f.getDocs(f.query(col, f.where('classId', '==', targetClass)));
      const nextRows = await Promise.all(result.docs.map(async snap => {
        const member = snap.data();
        if (!admin()) return { ...member, id: snap.id, name: member.displayName || '(이름 미등록)' };
        const [profile, record] = await Promise.all([
          f.getDoc(identity(snap.id)),
          member.legacyId ? f.getDoc(doc('rosterYears', year, 'records', snap.id)) : null
        ]);
        return { ...member, id: snap.id, name: member.displayName || profile.data()?.name || '(기본정보 누락)',
          legacyRecord: record?.data() || member.legacyRecord };
      }));
      if (token !== epoch || !staff()) return;
      rows = nextRows.sort((a, b) => a.no - b.no || a.name.localeCompare(b.name));
      for (const row of rows) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn small';
        button.textContent = '선택';
        button.onclick = () => { $('yrId').value = row.id; $('yrName').value = row.name; $('yrNo').value = row.no; $('yrState').value = row.status; };
        li.append(row.no + '번 ' + row.name + ' · ' + $('yrState').querySelector('option[value="' + row.status + '"]').textContent + ' ');
        if (admin()) li.append(button);
        if (row.legacyRecord) {
          const detail = document.createElement('details');
          const heading = document.createElement('summary');
          const record = document.createElement('p');
          const original = row.legacyRecord;
          heading.textContent = row.year + '학년도 ' + original.grade + '학년 ' + original.cls + '반 ' + original.no + '번 행동 기록';
          record.textContent = original.opinion || '등록된 종합의견이 없습니다.';
          detail.append(heading, record);
          li.append(detail);
        }
        $('yrRows').append(li);
      }
      status(rows.length ? rows.length + '명' : '등록된 학년도별 명단이 없습니다.');
    } catch (error) { if (token === epoch) status('명단 조회 실패: ' + error.message); }
  }

  async function save() {
    if (!admin()) return;
    const { year, grade, cls } = context();
    const name = $('yrName').value.trim();
    const enteredId = $('yrId').value.trim();
    const no = Number($('yrNo').value);
    const enrollmentStatus = $('yrState').value;
    if (!/^20[0-9]{2}$/.test(year) || !cls || !Number.isInteger(no) || no < 1 || no > 99 ||
        (enteredId ? !/^[A-Za-z0-9_-]{1,128}$/.test(enteredId) : !name || name.length > 20)) {
      status('학년도와 학생 ID 또는 이름, 반과 번호를 확인해 주세요.'); return;
    }
    const f = F();
    const profile = enteredId ? identity(enteredId) : f.doc(f.collection(db(), 'studentProfiles'));
    const member = membership(year, profile.id);
    const target = classroom(year, grade, cls);
    await f.runTransaction(db(), async tx => {
      const [person, current, targetClass] = await Promise.all([tx.get(profile), tx.get(member), tx.get(target)]);
      if (enteredId && !person.exists()) throw new Error('일치하는 학생 ID가 없습니다.');
      const old = current.data();
      const destination = targetClass.data() || {};
      const previous = old && old.classId !== target.id ? doc('rosterYears', year, 'classes', old.classId) : null;
      const previousClass = previous ? await tx.get(previous) : null;
      const slots = { ...destination.slots };
      if (old?.classId === target.id && slots[old.no] === profile.id) delete slots[old.no];
      if (enrollmentStatus === 'enrolled' && slots[no] && slots[no] !== profile.id) throw new Error('해당 반에 이미 같은 번호가 있습니다.');
      if (enrollmentStatus === 'enrolled') slots[no] = profile.id;
      if (!person.exists()) tx.set(profile, { name, createdAt: f.serverTimestamp() });
      if (previousClass?.exists()) {
        const oldSlots = { ...previousClass.data().slots };
        if (oldSlots[old.no] === profile.id) delete oldSlots[old.no];
        tx.update(previous, { slots: oldSlots });
      }
      tx.set(target, { ...destination, year, grade, cls, slots });
      const next = { year, studentId: profile.id, grade, cls, classId: target.id, no, status: enrollmentStatus,
        displayName: old?.displayName || person.data()?.name || name,
        sex: old?.sex || person.data()?.sex || '', mig: old?.mig || '', country: old?.country || '', note: old?.note || '',
        ...(old?.legacyId ? { legacyId: old.legacyId } : {}), updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
      tx.set(member, next);
      if (next.mig) YearStudentViews.stage(tx, Cloud.fb, next);
    });
    $('yrId').value = profile.id;
    await load();
    status('학년도별 소속을 저장했습니다.');
  }

  async function inspectLegacy() {
    if (!admin()) return;
    const token = ++epoch;
    preview = null;
    $('yrPreview').replaceChildren();
    $('yrApply').disabled = true;
    const { year, grade, cls } = context();
    if (!/^20[0-9]{2}$/.test(year)) throw new Error('이전할 원본 학년도를 먼저 지정해 주세요.');
    const f = F();
    const sourceYear = $('yrSource').value;
    if (!/^20[0-9]{2}$/.test(sourceYear)) throw new Error('원본 학년도를 지정해 주세요.');
    if (sourceYear !== year) {
      const sourceCol = f.collection(db(), 'rosterYears', sourceYear, 'memberships');
      const result = await f.getDocs(f.query(sourceCol, f.where('classId', '==', classId(grade, cls))));
      if (token !== epoch || !admin()) return;
      const entries = result.docs.map(snap => ({ id: snap.id, data: snap.data() })).filter(row => row.data.status === 'enrolled');
      $('yrPreview').textContent = sourceYear + ' → ' + year + '학년도 · ' + entries.map(row => row.data.no + '번 ' + row.data.displayName).join(', ');
      if (entries.length) { preview = { year, sourceYear, grade, cls, entries }; $('yrApply').disabled = false; }
      return;
    }
    const source = await f.getDocs(f.query(f.collection(db(), 'students'), f.where('grade', '==', grade), f.where('cls', '==', cls)));
    const entries = await Promise.all(source.docs.map(async student => {
      const record = await f.getDoc(doc('students', student.id, 'privateRecords', 'behavior'));
      return { id: student.id, data: student.data(), hasBehavior: record.exists(), behavior: record.data() || null };
    }));
    if (token !== epoch || !admin()) return;
    const numbers = new Set();
    const errors = entries.filter(({ data }) => {
      const invalid = !data.name?.trim() || !Number.isInteger(data.no) || data.no < 1 || data.no > 99 || numbers.has(data.no);
      numbers.add(data.no);
      return invalid;
    });
    $('yrPreview').textContent = year + '학년도 ' + grade + '학년 ' + cls + '반 · 원본 ' + entries.length +
      '명 · 기존 행동 기록 ' + entries.filter(entry => entry.hasBehavior).length + '건 · 번호 중복 또는 필수정보 누락 ' + errors.length + '명';
    if (entries.length && !errors.length) {
      preview = { year, grade, cls, entries };
      $('yrApply').disabled = false;
    }
  }

  async function migrate() {
    if (!admin() || !preview || !$('yrBackup').checked) throw new Error('백업 완료를 표시하고 이전할 학급을 미리 확인해 주세요.');
    const { year, sourceYear, grade, cls, entries } = preview;
    if (!confirm(year + '학년도가 원본 명단의 실제 학년도임을 확인하고 ' + entries.length + '명을 이전할까요?')) return;
    const f = F();
    const target = classroom(year, grade, cls);
    await f.runTransaction(db(), async tx => {
      const classSnap = await tx.get(target);
      const classData = classSnap.data() || {};
      const slots = { ...classData.slots };
      if (sourceYear) {
        const incoming = await Promise.all(entries.map(async entry => {
          const [source, person, destination] = await Promise.all([
            tx.get(membership(sourceYear, entry.id)), tx.get(identity(entry.id)), tx.get(membership(year, entry.id))
          ]);
          if (!person.exists() || destination.exists() || !source.exists() ||
              JSON.stringify(source.data()) !== JSON.stringify(entry.data) || slots[entry.data.no]) {
            throw new Error('학생 기본정보 또는 반 번호가 변경되었거나 대상 학년도에 이미 등록되어 있습니다.');
          }
          return { entry, name: person.data().name };
        }));
        for (const { entry, name } of incoming) {
          const no = entry.data.no;
          if (slots[no]) throw new Error('중복된 학생 번호가 있습니다.');
          slots[no] = entry.id;
          const member = { year, grade, cls, classId: target.id, studentId: entry.id, no,
            displayName: name, sex: entry.data.sex || '', mig: entry.data.mig || '', country: entry.data.country || '', note: entry.data.note || '', status: 'enrolled', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
          tx.set(membership(year, entry.id), member);
          if (member.mig) YearStudentViews.stage(tx, Cloud.fb, member);
        }
        tx.set(target, { ...classData, year, grade, cls, slots });
        return;
      }
      const records = await Promise.all(entries.map(async entry => {
        const [original, person, member, behavior] = await Promise.all([
          tx.get(doc('students', entry.id)), tx.get(identity(entry.id)), tx.get(membership(year, entry.id)), tx.get(doc('students', entry.id, 'privateRecords', 'behavior'))
        ]);
        if (!original.exists() || JSON.stringify(original.data()) !== JSON.stringify(entry.data)) throw new Error('원본 명단이 바뀌었습니다. 미리보기를 다시 실행해 주세요.');
        if (JSON.stringify(behavior.data() || null) !== JSON.stringify(entry.behavior)) throw new Error('기존 행동 기록이 바뀌었습니다. 미리보기를 다시 실행해 주세요.');
        if (member.exists()) throw new Error('이미 같은 학생 ID의 학년도별 소속이 있습니다.');
        if (person.exists() && person.data().legacyId !== entry.id) throw new Error('학생 ID가 다른 기본정보와 충돌합니다.');
        if (slots[entry.data.no]) throw new Error('대상 학급에 이미 같은 번호가 있습니다.');
        return { entry, person };
      }));
      for (const { entry, person } of records) {
        const { id, data } = entry;
        slots[data.no] = id;
        if (!person.exists()) tx.set(identity(id), { name: data.name, sex: data.sex || '', mig: data.mig || '',
          country: data.country || '', note: data.note || '', legacyId: id, createdAt: f.serverTimestamp() });
        if (entry.behavior) tx.set(doc('rosterYears', year, 'records', id), { ...entry.behavior, grade, cls, no: data.no });
        const member = { year, studentId: id, legacyId: id, grade, cls, classId: target.id,
          no: data.no, status: 'enrolled', displayName: data.name, sex: data.sex || '', mig: data.mig || '', country: data.country || '', note: data.note || '', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
        tx.set(membership(year, id), member);
        if (member.mig) YearStudentViews.stage(tx, Cloud.fb, member);
      }
      tx.set(target, { ...classData, year, grade, cls, slots });
    });
    await load();
    status('원본을 보존하고 ' + entries.length + '명의 소속을 이전했습니다.');
  }

  $('yrGrade').replaceChildren(...Array.from({ length: 6 }, (_, i) => option(i + 1, (i + 1) + '학년')));
  async function stageTransfer(tx, eventRef, transfer, requested) {
    if (!admin()) throw new Error('학생을 연결하는 전입·전출은 관리자만 등록할 수 있습니다.');
    const f = F();
    const year = String(transfer.year ?? OperatingCalendar.yearOf(transfer.date));
    const { grade, cls } = transfer;
    const { id, name, no } = requested;
    const outgoing = transfer.type === 'out';
    if ((id && !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || (outgoing && !id) ||
        (!id && (!name || name.length > 20)) || (!outgoing && (!Number.isInteger(no) || no < 1 || no > 99))) {
      throw new Error('전입·전출 학생 ID 또는 신규 학생 이름과 번호를 확인해 주세요.');
    }
    const profile = id ? identity(id) : f.doc(f.collection(db(), 'studentProfiles'));
    const member = membership(year, profile.id);
    const target = classroom(year, grade, cls);
    const [person, enrolled, classSnap] = await Promise.all([tx.get(profile), tx.get(member), tx.get(target)]);
    const previous = enrolled.data() || null;
    const clsData = classSnap.data() || {};
    const slots = { ...clsData.slots };
    if (id && !person.exists()) throw new Error('일치하는 학생 ID가 없습니다.');
    const number = outgoing ? previous?.no : no;
    if (outgoing) {
      if (previous?.status !== 'enrolled' || previous.classId !== target.id || slots[number] !== profile.id) {
        throw new Error('해당 학년도 학급에 재학 중인 학생 ID를 입력해 주세요.');
      }
      delete slots[number];
    } else {
      if (previous && (previous.status !== 'transferred' || previous.classId !== target.id)) {
        throw new Error('이 학년도에 다른 소속이 있습니다. 먼저 학년도별 명단에서 확인해 주세요.');
      }
      if (slots[number]) throw new Error('해당 반에 이미 같은 번호가 있습니다.');
      slots[number] = profile.id;
    }
    if (!person.exists()) tx.set(profile, { name, sex: transfer.sex, createdAt: f.serverTimestamp() });
    const next = { ...previous, year, grade, cls, studentId: profile.id, classId: target.id, no: number,
      status: outgoing ? 'transferred' : 'enrolled', displayName: person.data()?.name || name,
      transferId: eventRef.id, updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
    tx.set(member, next);
    if (next.mig) YearStudentViews.stage(tx, Cloud.fb, next);
    tx.set(target, { ...clsData, year, grade, cls, slots });
    tx.set(doc('rosterTransferLinks', eventRef.id), { year, studentId: profile.id, grade, cls, no: number, previous });
  }

  async function reverseTransfer(tx, id) {
    const link = doc('rosterTransferLinks', id);
    const linkSnap = await tx.get(link);
    if (!linkSnap.exists()) return;
    const { year, studentId, grade, cls, no, previous } = linkSnap.data();
    const member = membership(year, studentId);
    const target = classroom(year, grade, cls);
    const [memberSnap, classSnap] = await Promise.all([tx.get(member), tx.get(target)]);
    const current = memberSnap.data();
    const slots = { ...classSnap.data()?.slots };
    if (current?.transferId !== id || current.classId !== target.id || current.no !== no ||
        (current.status === 'enrolled' ? slots[no] !== studentId : !!slots[no])) {
      throw new Error('전입·전출 후 소속이 바뀌었습니다. 학년도별 명단을 먼저 확인해 주세요.');
    }
    delete slots[no];
    if (previous?.status === 'enrolled') slots[no] = studentId;
    if (previous) tx.set(member, previous);
    else tx.delete(member);
    if (current.mig || previous?.mig) YearStudentViews.stage(tx, Cloud.fb, previous || { ...current, status: 'transferred' });
    tx.update(target, { slots });
    tx.delete(link);
  }

  window.YearRoster = { stageTransfer, reverseTransfer };
  let workbookPreview, workbookVersion = 0;
  function clearWorkbook() {
    workbookVersion++;
    workbookPreview = null;
    $('yrImport').disabled = true;
    $('yrImportPreview').replaceChildren();
  }

  async function inspectWorkbook() {
    clearWorkbook();
    if (!admin() || !$('yrWorkbook').files.length) return;
    const target = context();
    const token = workbookVersion;
    const workbook = await RosterWorkbook.read($('yrWorkbook').files[0]);
    if (!workbook.length || workbook.length > 99) throw new Error('한 학급의 명단을 1~99명 입력해 주세요.');
    const numbers = new Set(), students = new Set();
    const entries = workbook.map(([year, grade, cls, number, id, name], i) => {
      const no = Number(number);
      if (year !== target.year || Number(grade) !== target.grade || Number(cls) !== target.cls ||
          !Number.isInteger(no) || no < 1 || no > 99 || numbers.has(no) ||
          !name || name.length > 20 || (id && (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || students.has(id)))) {
        throw new Error('엑셀 ' + (i + 2) + '행의 학년도·학급·번호·이름 또는 학생 ID를 확인해 주세요.');
      }
      numbers.add(no);
      if (id) students.add(id);
      return { no, id, name };
    });
    const f = F();
    const targetClass = await f.getDoc(classroom(target.year, target.grade, target.cls));
    await Promise.all(entries.map(async entry => {
      if (targetClass.data()?.slots?.[entry.no]) throw new Error(entry.no + '번은 이미 배정되어 있습니다.');
      if (!entry.id) return;
      const [person, current] = await Promise.all([f.getDoc(identity(entry.id)), f.getDoc(membership(target.year, entry.id))]);
      if (!person.exists() || person.data().name !== entry.name) throw new Error(entry.no + '번 학생의 ID와 이름을 확인해 주세요.');
      if (current.exists()) throw new Error(entry.no + '번 학생은 대상 학년도에 이미 등록되어 있습니다.');
    }));
    if (token !== workbookVersion || !admin()) return;
    workbookPreview = { ...target, entries };
    const list = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li');
      li.textContent = entry.no + '번 ' + entry.name + (entry.id ? ' · 기존 ID 연결' : ' · 신규 학생');
      list.append(li);
    }
    $('yrImportPreview').append(list);
    $('yrImport').disabled = false;
  }

  async function importWorkbook() {
    if (!admin() || !workbookPreview) return;
    const { year, grade, cls, entries } = workbookPreview;
    if (!confirm(year + '학년도 ' + grade + '학년 ' + cls + '반에 미리 본 ' + entries.length + '명을 등록할까요?')) return;
    const f = F();
    const target = classroom(year, grade, cls);
    const incoming = entries.map(entry => ({ ...entry, profile: entry.id ? identity(entry.id) : f.doc(f.collection(db(), 'studentProfiles')) }));
    await f.runTransaction(db(), async tx => {
      const classData = (await tx.get(target)).data() || {};
      const slots = { ...classData.slots };
      await Promise.all(incoming.map(async entry => {
        const [person, member] = await Promise.all([tx.get(entry.profile), tx.get(membership(year, entry.profile.id))]);
        if (slots[entry.no] || member.exists() || (entry.id ? person.data()?.name !== entry.name : person.exists())) {
          throw new Error('대상 명단이 바뀌었습니다. 파일을 다시 확인해 주세요.');
        }
      }));
      for (const entry of incoming) {
        const studentId = entry.profile.id;
        if (!entry.id) tx.set(entry.profile, { name: entry.name, createdAt: f.serverTimestamp() });
        slots[entry.no] = studentId;
        tx.set(membership(year, studentId), { year, grade, cls, classId: target.id, studentId, no: entry.no,
          displayName: entry.name, status: 'enrolled', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email });
      }
      tx.set(target, { ...classData, year, grade, cls, slots });
    });
    await load();
    status(entries.length + '명을 등록했습니다.');
  }

  async function exportWorkbook(byClass = false) {
    if (!admin()) return;
    const { year, grade, cls } = context();
    if (!/^20[0-9]{2}$/.test(year) || (byClass && !cls)) throw new Error('학년도와 학급을 확인해 주세요.');
    const f = F();
    const col = f.collection(db(), 'rosterYears', year, 'memberships');
    const result = await f.getDocs(byClass ? f.query(col, f.where('classId', '==', classId(grade, cls))) : col);
    const data = result.docs.map(snap => snap.data()).sort((a, b) => a.grade - b.grade || a.cls - b.cls || a.no - b.no);
    Hwp.download(RosterWorkbook.write(data.map(row => [year, row.grade, row.cls, row.no, row.studentId, row.displayName])),
      year + '학년도_' + (byClass ? grade + '학년_' + cls + '반_' : '') + '학생명단.xlsx');
  }
  const run = action => async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); } catch (error) { status(error.message); }
    finally { button.disabled = (button.id === 'yrApply' && !preview) || (button.id === 'yrImport' && !workbookPreview); }
  };
  root.addEventListener('toggle', () => { if (root.open) load(); });
  ['yrYear', 'yrGrade', 'yrClass'].forEach(id => $(id).addEventListener('change', () => {
    if (id !== 'yrClass') fillClasses();
    $('yrId').value = '';
    $('yrName').value = '';
    load();
  }));
  $('yrSave').onclick = run(save);
  $('yrInspect').onclick = run(inspectLegacy);
  $('yrApply').onclick = run(migrate);
  $('yrSource').onchange = () => {
    epoch++;
    preview = null;
    $('yrPreview').replaceChildren();
    $('yrApply').disabled = true;
  };
  $('yrWorkbook').onchange = () => inspectWorkbook().catch(error => status(error.message));
  $('yrImport').onclick = run(importWorkbook);
  $('yrExport').onclick = run(() => exportWorkbook());
  $('yrExportClass').onclick = run(() => exportWorkbook(true));
  document.addEventListener('cloud-change', refresh);
  document.addEventListener('year-change', refresh);
  refresh();
})();
