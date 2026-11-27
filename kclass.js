'use strict';

/* =========================================================
 * 한국어학급 1~3 주간 시간표 (1~3교시)
 *  - 한 학급 = 담임교사 1명 + 강사 1명. 같은 시간에 서로 다른 학생을 맡음
 *  - rosterYears/{year}/kclassTimetables: 교직원용 시간표와 원학급
 *  - rosterYears/{year}/kclassParticipation: 권한이 제한된 학생 ID와 지도 기록
 *    (예전 "요일-교시" 키는 담임교사 수업으로 읽음)
 *  - 칸을 눌러 대화상자에서 수업명과 학생의 원학급(몇 학년 몇 반)을 고름
 * ========================================================= */
(() => {
  const classes = [1, 2, 3];
  const days = [1, 2, 3, 4, 5];
  const periods = [1, 2, 3];
  const ROLES = [['t', '담임교사'], ['i', '강사']];
  const records = new Map(), operatingRecords = new Map();
  let subscriptions = [];
  let generation = 0, selectedYear = '', unsubCandidates = null;
  let candidates = [];
  const yearRef = (name, n) => Cloud.fb.F.doc(Cloud.fb.db, 'rosterYears', selectedYear, name, String(n));
  let dlgCtx = null;   // { n, day, period, picks: { t:Set, i:Set } }

  // 지정된 담임 또는 관리자가 편집 (보안 규칙도 같음)
  function canEdit(record) {
    if (!record || !Cloud.ready) return false;
    if (Cloud.isAdmin()) return true;
    return Boolean(record.owner && record.owner === String(Cloud.email || '').toLowerCase());
  }

  /** 칸 하나의 담임/강사 수업 (예전 키는 담임으로) */
  function cellOf(slots, day, period, role) {
    const s = slots || {};
    return s[`${day}-${period}-${role}`] || (role === 't' ? s[`${day}-${period}`] : null) || null;
  }
  const splitTargets = text => String(text || '').split(/[,\s]+/).filter(t => /^[1-6]-\d{1,2}$/.test(t));
  /** "3-1, 4-2" → "3학년 1반, 4학년 2반" */
  const targetText = text => splitTargets(text).map(t => { const [g, c] = t.split('-'); return `${g}학년 ${c}반`; }).join(', ');
  /** 이주배경학생 현황에 등록한 학생 (이름을 볼 권한이 있을 때만 채워짐) */
  const MS = () => candidates;
  const byStudent = id => candidates.find(student => student.id === id);
  const stuName = id => { const s = byStudent(id); return s ? `${s.name}(${s.grade}-${s.cls})` : null; };
  /** 칸에 보일 학생: 이름을 볼 수 있으면 이름, 아니면 학급과 인원 */
  function whoText(c) {
    const ids = c.students || [];
    const names = ids.map(stuName).filter(Boolean);
    if (names.length) return esc(names.join(', ')) + (names.length < ids.length ? ` 외 ${ids.length - names.length}명` : '');
    const who = targetText(c.targets);
    return who ? esc(who) + (ids.length ? ` · 학생 ${ids.length}명` : ' 학생') : '학생 미지정';
  }

  function render(number) {
    const record = records.get(number);
    const editing = canEdit(record) && record.slots !== null && !record.error;
    const ownerForm = $('kclassOwner' + number);
    ownerForm.hidden = !(Cloud.ready && Cloud.isAdmin() && record?.owner !== null);
    if (!ownerForm.contains(document.activeElement)) ownerForm.querySelector('input').value = record?.owner || '';
    $('kclassMode' + number).textContent = !Cloud.ready ? '승인된 교직원 계정으로 로그인해 주세요.'
      : record?.error ? '시간표 또는 담임 권한을 불러오지 못했습니다.'
      : !record || record.owner === null || record.slots === null ? '시간표를 불러오는 중입니다.'
      : editing ? (Cloud.isAdmin() && record.owner !== String(Cloud.email || '').toLowerCase() ? '관리자 편집 가능 · ' : '편집 가능 · ') + '시간표 칸을 누르면 담임교사·강사 수업과 학생의 학년·반을 정할 수 있습니다.'
      : record.owner ? '조회 전용 · 이 학급 담임이 시간표를 편집합니다.'
      : '조회 전용 · 관리자가 담임을 지정하면 편집할 수 있습니다.';
    if (canEdit(record) && record.slots !== null) {
      const count = new Set(Object.values(record.participation || {}).flat()).size;
      $('kclassMode' + number).textContent += ' · 참여 학생 ' + count + '명';
    }
    renderStaff(number, record, editing);
    const table = $('kclassGrid' + number);
    table.classList.toggle('editable', editing);
    if (!record || record.slots === null) { table.innerHTML = ''; return; }
    table.innerHTML = '<thead><tr><th scope="col">교시</th>' +
      days.map(day => '<th scope="col">' + WD[day] + '</th>').join('') + '</tr></thead><tbody>' +
      periods.map(period => '<tr><th scope="row">' + periodHead(period, '교시') + '</th>' + days.map(day => {
        const items = ROLES.map(([role, label]) => {
          const c = slotWithStudents(record, day, period, role);
          if (!c || !(c.title || c.targets)) return '';
          return `<div class="kc-item ${role}"><span class="kc-who">${label}</span>` +
            (c.title && c.title !== '한국어' ? `<b>${esc(c.title)}</b>` : '') +
            `<span class="kc-stu">${whoText(c)}</span></div>`;
        }).join('');
        const label = `${WD[day]}요일 ${period}교시`;
        return editing
          ? `<td><button type="button" class="kc-cell" data-day="${day}" data-period="${period}" aria-label="${label} 설정">${items || '<span class="kc-add">+ 설정</span>'}</button></td>`
          : `<td>${items || '<span class="hint">—</span>'}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
  }

  function renderStaff(n, record, editing) {
    const box = $('kclassStaff' + n);
    if (!record || record.slots === null || record.error) { box.innerHTML = ''; return; }
    if (box.contains(document.activeElement)) return;
    const tn = record.teacherName || '', inn = record.instructorName || '';
    box.innerHTML = editing
      ? `<label><span class="kc-who t">담임교사</span> <input data-staff="teacherName" maxlength="30" placeholder="담임교사 이름" value="${esc(tn)}"></label>
         <label><span class="kc-who i">강사</span> <input data-staff="instructorName" maxlength="30" placeholder="강사 이름" value="${esc(inn)}"></label>
         <button type="button" class="btn small" data-staff-save>이름 저장</button>`
      : `<span><span class="kc-who t">담임교사</span> ${esc(tn || '미정')}</span>
         <span><span class="kc-who i">강사</span> ${esc(inn || '미정')}</span>`;
  }

  function slotWithStudents(record, day, period, role) {
    const slot = cellOf(record.slots, day, period, role);
    return slot ? { ...slot, students: record.participation?.[day + '-' + period + '-' + role] || [] } : null;
  }

  async function writeDoc(n, mutate, changeParticipation = false) {
    const { F, db } = Cloud.fb;
    const ref = yearRef('kclassTimetables', n);
    const privateRef = yearRef('kclassParticipation', n);
    await F.runTransaction(db, async tx => {
      const cur = (await tx.get(ref)).data() || {};
      const next = { slots: { ...(cur.slots || {}) }, teacherName: cur.teacherName || '', instructorName: cur.instructorName || '' };
      const participation = changeParticipation ? { ...(await tx.get(privateRef)).data()?.slots } : null;
      mutate(next, participation);
      tx.set(ref, next);
      if (participation) tx.set(privateRef, { slots: participation });
    });
  }

  function subscribe(next = state.school.year) {
    const run = ++generation;
    subscriptions.forEach(unsubscribe => unsubscribe());
    subscriptions = [];
    unsubCandidates?.(); unsubCandidates = null;
    candidates = [];
    records.clear();
    operatingRecords.clear();
    dlgCtx = null;
    if ($('kclassDlg').open) $('kclassDlg').close();
    selectedYear = String(next || '');
    const yearInput = $('kcYear');
    yearInput.value = selectedYear;
    yearInput.disabled = !Cloud.isAdmin();
    classes.forEach(n => { $('kclassStatus' + n).textContent = ''; render(n); });
    if (!Cloud.ready || !/^20[0-9]{2}$/.test(selectedYear)) return;
    const { F, db } = Cloud.fb;
    const watchCandidates = () => {
      if (unsubCandidates || (!Cloud.isAdmin() && ![...records.values()].some(canEdit))) return;
      unsubCandidates = F.onSnapshot(F.collection(db, 'rosterYears', selectedYear, 'migrantRoster'), snap => {
        if (run !== generation) return;
        candidates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        classes.forEach(render);
        if (dlgCtx) renderPicks();
      }, () => { if (run === generation) candidates = []; });
    };
    classes.forEach(n => {
      const record = { owner: null, slots: null, participation: {}, teacherName: '', instructorName: '', error: false };
      records.set(n, record);
      const report = () => { if (run !== generation) return; record.error = true; render(n); };
      let unsubPrivate = null;
      const watchPrivate = () => {
        if (unsubPrivate || !canEdit(record)) return;
        unsubPrivate = F.onSnapshot(yearRef('kclassParticipation', n), snapshot => {
          if (run !== generation) return;
          record.participation = snapshot.data()?.slots || {};
          render(n);
        }, () => { record.participation = {}; render(n); });
        subscriptions.push(unsubPrivate);
      };
      subscriptions.push(F.onSnapshot(yearRef('kclassOwners', n), snapshot => {
        if (run !== generation) return;
        record.owner = snapshot.data()?.email || '';
        if (!canEdit(record) && unsubPrivate) {
          unsubPrivate();
          unsubPrivate = null;
          record.participation = {};
          if (dlgCtx?.n === n) { dlgCtx = null; $('kclassDlg').close(); }
        }
        if (!Cloud.isAdmin() && ![...records.values()].some(canEdit)) {
          unsubCandidates?.(); unsubCandidates = null; candidates = [];
        }
        watchPrivate();
        watchCandidates();
        render(n);
        document.dispatchEvent(new Event('kclass-change'));
      }, report));
      subscriptions.push(F.onSnapshot(yearRef('kclassTimetables', n), snapshot => {
        if (run !== generation) return;
        const d = snapshot.data() || {};
        record.slots = d.slots || {};
        record.teacherName = d.teacherName || '';
        record.instructorName = d.instructorName || '';
        if (selectedYear === String(state.school.year)) operatingRecords.set(n, record);
        render(n);
        document.dispatchEvent(new Event('kclass-change'));
      }, report));
    });
    if (selectedYear !== String(state.school.year)) {
      for (const n of classes) {
        const ref = F.doc(db, 'rosterYears', String(state.school.year), 'kclassTimetables', String(n));
        subscriptions.push(F.onSnapshot(ref, snap => {
          if (run !== generation) return;
          operatingRecords.set(n, snap.data() || {});
          document.dispatchEvent(new Event('kclass-change'));
        }));
      }
    }

    watchCandidates();
  }
  /* ---------- 칸 설정 대화상자 ---------- */
  function openCell(n, day, period) {
    const record = records.get(n);
    if (!canEdit(record)) return;
    dlgCtx = { n, day, period, picks: {}, stu: {} };
    $('kcDlgTitle').textContent = `한국어학급 ${n} · ${WD[day]}요일 ${period}교시`;
    ROLES.forEach(([role]) => {
      const c = slotWithStudents(record, day, period, role) || {};
      dlgCtx.stu[role] = new Set(c.students || []);
      // 학생을 고른 반은 학생 칩으로 보여 주므로, 반 칩은 학생 없이 고른 반만
      const stuCls = new Set([...dlgCtx.stu[role]].map(id => byStudent(id)).filter(Boolean).map(s => `${s.grade}-${s.cls}`));
      dlgCtx.picks[role] = new Set(splitTargets(c.targets).filter(k => !stuCls.has(k)));
      $('kcTitle_' + role).value = c.title || '';
      const name = role === 't' ? record.teacherName : record.instructorName;
      $('kcName_' + role).textContent = name ? `(${name})` : '';
    });
    const participating = new Set(Object.values(record.participation || {}).flat());
    $('kcRecordStudent').replaceChildren(new Option('학생 선택', ''),
      ...[...participating].map(id => new Option(stuName(id) || '기존 참여 학생', id)));
    $('kcRecordNote').value = '';
    $('kcRecordNote').disabled = true;
    $('kcRecordSave').disabled = true;
    $('kcRecordStatus').textContent = '';

    renderPicks();
    $('kcDlgStatus').textContent = '';
    $('kclassDlg').showModal();
  }

  function renderPicks() {
    ROLES.forEach(([role]) => {
      const picks = dlgCtx.picks[role], stu = dlgCtx.stu[role];
      const oRole = role === 't' ? 'i' : 't', other = dlgCtx.picks[oRole], oStu = dlgCtx.stu[oRole];
      const oLabel = role === 't' ? '강사' : '담임교사';
      const studs = MS();
      $('kcPick_' + role).innerHTML = GRADES.map(g => {
        const settings = Number(selectedYear) === state.school.year ? state.school.classes
          : state.yearPlans?.[selectedYear]?.school?.classes || state.yearArchive?.[selectedYear]?.classes;
        const cnt = Math.max(Number(settings?.[g]) || 0, ...studs.filter(student => student.grade === g).map(student => student.cls));
        if (!cnt) return '';
        let row = `<div class="kc-prow"><span class="kc-g">${g}학년</span>`;
        for (let c = 1; c <= cnt; c++) {
          const k = `${g}-${c}`;
          row += `<button type="button" class="chip-btn${picks.has(k) ? ' on' : ''}${other.has(k) ? ' taken' : ''}" data-role="${role}" data-k="${k}" title="${other.has(k) ? oLabel + '도 이 반 학생을 맡고 있습니다' : '이 반 학생 (이름 없이)'}">${c}반</button>`;
        }
        row += '</div>';
        const gs = studs.filter(s => s.grade === g).sort((a, b) => a.cls - b.cls || (a.no || 99) - (b.no || 99));
        if (gs.length) row += `<div class="kc-stus">${gs.map(s => `<button type="button" class="kc-stu-chip ${s.type}${stu.has(s.id) ? ' on' : ''}${oStu.has(s.id) ? ' taken' : ''}" data-role="${role}" data-sid="${esc(s.id)}" title="${s.grade}학년 ${s.cls}반 ${s.no || ''}번 · ${esc(s.country || '')}${oStu.has(s.id) ? ' · ' + oLabel + '도 고름' : ''}"><small>${s.cls}반</small>${esc(s.name)}</button>`).join('')}</div>`;
        return row;
      }).join('') + (studs.length ? '' : '<p class="hint kc-nostu">이주배경학생 현황에 학생을 등록하면 여기서 이름으로 고를 수 있습니다.</p>');
      const names = [...stu].map(stuName).filter(Boolean);
      const cls = [...picks].sort(sortK);
      $('kcSel_' + role).textContent = names.length || cls.length
        ? [names.length ? names.join(', ') : '', cls.length ? targetText(cls.join(',')) + ' 학생' : ''].filter(Boolean).join(' / ')
        : '선택한 학생 없음';
    });
  }
  function studentRecordRef(id) {
    const { F, db } = Cloud.fb;
    return F.doc(db, 'rosterYears', selectedYear, 'kclassParticipation', String(dlgCtx.n), 'studentRecords', id);
  }

  $('kcRecordStudent').addEventListener('change', async e => {
    const id = e.target.value, context = dlgCtx;
    $('kcRecordNote').value = '';
    $('kcRecordNote').disabled = $('kcRecordSave').disabled = true;
    $('kcRecordStatus').textContent = '';
    if (!id || !context) return;
    try {
      const snap = await Cloud.fb.F.getDoc(studentRecordRef(id));
      if (context !== dlgCtx || id !== $('kcRecordStudent').value) return;
      $('kcRecordNote').value = snap.data()?.note || '';
      $('kcRecordNote').disabled = $('kcRecordSave').disabled = false;
    } catch {
      if (context === dlgCtx) $('kcRecordStatus').textContent = '학생 기록을 불러오지 못했습니다.';
    }
  });

  $('kcRecordSave').addEventListener('click', async () => {
    const id = $('kcRecordStudent').value, context = dlgCtx;
    if (!id || !context || !canEdit(records.get(context.n))) return;
    const { F, db } = Cloud.fb;
    const ref = studentRecordRef(id), button = $('kcRecordSave');
    const year = selectedYear, student = byStudent(id), note = $('kcRecordNote').value.trim();
    button.disabled = true;
    try {
      await F.runTransaction(db, async tx => {
        const old = await tx.get(ref);
        if (old.exists()) { tx.update(ref, { note }); return; }
        if (!student) throw new Error('현재 명단에서 학생을 확인할 수 없습니다.');
        tx.set(ref, { year, studentId: id, grade: student.grade, cls: student.cls, no: student.no, note });
      });
      if (context === dlgCtx) $('kcRecordStatus').textContent = '학생 기록을 저장했습니다.';
    } catch (error) {
      if (context === dlgCtx) $('kcRecordStatus').textContent = '저장 실패: ' + error.message;
    } finally {
      if (context === dlgCtx && id === $('kcRecordStudent').value) button.disabled = false;
    }
  });

  const sortK = (a, b) => { const [ag, ac] = a.split('-').map(Number), [bg, bc] = b.split('-').map(Number); return ag - bg || ac - bc; };

  async function saveCell(clear) {
    if (!dlgCtx) return;
    const { n, day, period, picks, stu } = dlgCtx;
    if (!canEdit(records.get(n))) return;
    const cells = {};
    ROLES.forEach(([role]) => {
      // 원학급(targets) = 고른 반 + 고른 학생의 반 → 교육활동 일정의 한국어학급 알림에 쓰임
      const students = clear ? [] : [...stu[role]];
      const set = new Set(clear ? [] : [...picks[role]]);
      students.forEach(id => { const s = byStudent(id); if (s) set.add(`${s.grade}-${s.cls}`); });
      // 이름을 못 불러온 학생의 반은 예전 값에서 유지
      const prev = slotWithStudents(records.get(n), day, period, role);
      if (!clear && prev && students.some(id => !byStudent(id))) splitTargets(prev.targets).forEach(k => set.add(k));
      const targets = [...set].sort(sortK).join(', ');
      const title = clear ? '' : ($('kcTitle_' + role).value.trim() || (targets ? '한국어' : '')).slice(0, 60);
      cells[role] = title || targets ? (students.length ? { title, targets, students } : { title, targets }) : null;
    });
    $('kcSave').disabled = true;
    try {
      await writeDoc(n, (doc, participation) => {
        delete doc.slots[`${day}-${period}`];
        ROLES.forEach(([role]) => {
          const key = `${day}-${period}-${role}`;
          if (cells[role]) {
            const { students = [], ...slot } = cells[role];
            doc.slots[key] = slot;
            if (students.length) participation[key] = students;
            else delete participation[key];
          } else {
            delete doc.slots[key];
            delete participation[key];
          }
        });
      }, true);
      $('kclassDlg').close();
      $('kclassStatus' + n).textContent = `${WD[day]}요일 ${period}교시를 ${clear ? '비웠습니다' : '저장했습니다'}.`;
    } catch (e) {
      $('kcDlgStatus').textContent = '저장 실패: ' + e.message;
    } finally { $('kcSave').disabled = false; }
  }

  $('kclassDlg').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (b && dlgCtx) {
      const set = dlgCtx.picks[b.dataset.role];
      set.has(b.dataset.k) ? set.delete(b.dataset.k) : set.add(b.dataset.k);
      renderPicks();
      return;
    }
    const s = e.target.closest('[data-sid]');
    if (s && dlgCtx) {
      const set = dlgCtx.stu[s.dataset.role];
      set.has(s.dataset.sid) ? set.delete(s.dataset.sid) : set.add(s.dataset.sid);
      renderPicks();
    }
  });
  // 등록 학생 목록이 늦게 오면 시간표 칸의 이름도 다시 그림

  $('kcSave').addEventListener('click', () => saveCell(false));
  $('kcClear').addEventListener('click', () => { if (confirm('이 시간의 담임교사·강사 수업을 모두 비울까요?')) saveCell(true); });
  $('kcClose').addEventListener('click', () => $('kclassDlg').close());

  classes.forEach(n => {
    RENDER['kclass' + n] = () => render(n);
    const status = $('kclassStatus' + n);
    $('kclassOwner' + n).addEventListener('submit', async event => {
      event.preventDefault();
      if (!Cloud.ready || !Cloud.isAdmin()) return;
      const { F, db } = Cloud.fb;
      const run = generation;
      const email = event.currentTarget.querySelector('input').value.trim().toLowerCase();
      try {
        await F.setDoc(yearRef('kclassOwners', n), { email });
        if (run === generation) status.textContent = email ? '담임 계정을 지정했습니다.' : '담임 지정을 해제했습니다.';
      } catch (error) {
        if (run === generation) status.textContent = '담임 지정 실패: ' + error.message;
      }
    });
    $('kclassGrid' + n).addEventListener('click', e => {
      const b = e.target.closest('.kc-cell');
      if (b) openCell(n, Number(b.dataset.day), Number(b.dataset.period));
    });
    $('kclassStaff' + n).addEventListener('click', async e => {
      if (!e.target.closest('[data-staff-save]') || !canEdit(records.get(n))) return;
      const box = $('kclassStaff' + n);
      const val = k => box.querySelector(`[data-staff="${k}"]`).value.trim().slice(0, 30);
      const tn = val('teacherName'), inn = val('instructorName');
      try {
        await writeDoc(n, doc => { doc.teacherName = tn; doc.instructorName = inn; });
        e.target.blur();
        status.textContent = '담임교사·강사 이름을 저장했습니다.';
      } catch (error) { status.textContent = '이름 저장 실패: ' + error.message; }
    });
  });

  // 한 탭 안에서 1·2·3반 고르기
  let kcCur = Number(sessionStorage.getItem('kcCur')) || 1;
  function showPanel(n) {
    kcCur = n; sessionStorage.setItem('kcCur', String(n));
    document.querySelectorAll('#kcSwitch [data-kc]').forEach(b => { const on = Number(b.dataset.kc) === n; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('[data-kc-panel]').forEach(p => { p.hidden = Number(p.dataset.kcPanel) !== n; });
    render(n);
  }
  // 학교 정보의 한국어학급 수만큼만 반 단추를 보임 (0이면 안내)
  RENDER.kclass = () => {
    const n = Math.max(0, Math.min(3, Number(state.school.kclass ?? 3)));
    document.querySelectorAll('#kcSwitch [data-kc]').forEach(b => { b.hidden = Number(b.dataset.kc) > n; });
    if (!n) {
      document.querySelectorAll('[data-kc-panel]').forEach(p => { p.hidden = true; });
      $('kcSwitch').insertAdjacentHTML('beforeend', $('kcNone') ? '' : '<span id="kcNone" class="hint"><a href="#school">학교 정보 › 기본 정보</a>에서 한국어학급 수를 입력하세요.</span>');
      return;
    }
    $('kcNone')?.remove();
    showPanel(window.tabFresh || kcCur > n ? 1 : kcCur);   // 메뉴로 새로 들어오면 1반부터
  };
  $('kcSwitch').addEventListener('click', e => { const b = e.target.closest('[data-kc]'); if (b) showPanel(Number(b.dataset.kc)); });

  window.KoreanClasses = {
    isOwner: email => [...records.values()].some(record => record.owner === email),
    hasOwners: () => [...records.values()].some(record => record.owner),
    /** key = "요일-교시" → 그 시간 한국어학급에 가는 학생의 원학급 목록 */
    slotsAt: key => {
      const [day, period] = key.split('-').map(Number);
      return classes.flatMap(n => {
        const r = operatingRecords.get(n);
        return ROLES.flatMap(([role, label]) => {
          const slot = cellOf(r?.slots, day, period, role);
          const name = role === 't' ? r?.teacherName : r?.instructorName;
          return slot?.targets ? [{
            group: `한국어학급 ${n} ${label}${name ? ' ' + name : ''}` + (slot.title && slot.title !== '한국어' ? ' · ' + slot.title : ''),
            targets: Activities.parseTargets(slot.targets),
          }] : [];
        });
      });
    },
  };
  $('kcYear').addEventListener('change', e => { if (Cloud.isAdmin()) subscribe(e.target.value); });
  document.addEventListener('cloud-change', () => subscribe());
  document.addEventListener('year-change', () => subscribe());
  if (Cloud.ready) subscribe();
})();
