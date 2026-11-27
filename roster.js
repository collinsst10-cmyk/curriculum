/* 학급관리: 학년도별 학생 소속과 담임 배정을 사용한다. */
(function () {
  'use strict';
  const MIG = [['', '해당 없음'], ['foreign', '외국인가정'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const MIG_L = Object.fromEntries(MIG);
  let list = [], unsub = null, sel = null, myRoom, unsubRoom = null, unsubSchool = null;
  let year = '', generation = 0;
  const F = () => Cloud.fb.F, db = () => Cloud.fb.db;
  const ready = () => !!(window.Cloud && Cloud.ready);
  const isAdm = () => ready() && Cloud.isAdmin();
  const classCnt = g => Math.min(20, Number(state.school.classes?.[g]) || 0);
  const collection = () => F().collection(db(), 'rosterYears', year, 'memberships');
  const say = (t, ok) => { const el = $('rsStatus'); if (el) { el.textContent = t; el.classList.toggle('ok', !!ok); } };
  TAB_GUARDS.roster = () => ready();

  function reset() {
    generation++;
    unsub?.(); unsub = null;
    unsubRoom?.(); unsubRoom = null;
    list = []; sel = null; myRoom = undefined;
    window.BehaviorUI?.sync([]);
  }

  function useYear(next) {
    reset();
    year = /^20[0-9]{2}$/.test(String(next)) ? String(next) : '';
    if (!year) { myRoom = null; render(); return; }
    if (isAdm()) {
      myRoom = null;
      const grade = GRADES.find(g => classCnt(g));
      if (grade) sel = { g: grade, c: 1 };
      watch(); render(); return;
    }
    const token = generation;
    unsubRoom = StaffLinks.watchRoom(F(), db(), Cloud.email.toLowerCase(), year, snap => {
      if (token !== generation) return;
      const [g, c] = String(snap.data()?.classId || '').split('-').map(Number);
      myRoom = g && c ? { g, c } : null;
      sel = myRoom;
      watch(); render();
    }, () => { if (token === generation) { myRoom = null; sel = null; watch(); render(); } });
    render();
  }

  function subscribe() {
    unsubSchool?.(); unsubSchool = null;
    reset();
    if (!ready()) { render(); return; }
    if (isAdm()) { useYear(state.school.year); return; }
    unsubSchool = F().onSnapshot(F().doc(db(), 'config', 'school'), snap => {
      const next = snap.data()?.year;
      if (String(next) !== year || myRoom === undefined) useYear(next);
    }, () => useYear(null));
  }

  function watch() {
    unsub?.(); unsub = null; list = [];
    window.BehaviorUI?.sync([]);
    if (!sel?.c || !year) return;
    const room = sel, watchedYear = year;
    const q = F().query(collection(), F().where('classId', '==', room.g + '-' + room.c));
    unsub = F().onSnapshot(q, snap => {
      if (sel !== room || year !== watchedYear) return;
      list = snap.docs.map(d => d.data()).filter(row => row.status === 'enrolled')
        .map(row => ({ ...row, id: row.studentId, name: row.displayName }));
      if (curTab === 'roster') render();
    }, error => { if (sel === room && year === watchedYear) say('명단 조회 실패: ' + error.message); });
  }
  /* ---------- 화면 ---------- */
  const sorted = () => list.slice().sort((a, b) => (a.no || 99) - (b.no || 99) || String(a.name).localeCompare(b.name));
  const seg = (attr, cur, opts) => `<span class="rs-seg">${opts.map(([v, l]) => `<button type="button" class="${v === cur ? 'on' : ''} ${v || 'none'}" ${attr}="${v}">${l}</button>`).join('')}</span>`;
  function render() {
    const box = $('rsMain'); if (!box) return;
    window.BehaviorUI?.sync(ready() && sel ? sorted() : []);
    if (!ready()) { box.innerHTML = '<p class="hint">승인된 계정으로 로그인해 주세요.</p>'; return; }
    if (myRoom === undefined) { box.innerHTML = '<p class="hint">불러오는 중…</p>'; return; }
    const picker = isAdm()
      ? `<span class="rs-pick"><select id="rsG">${GRADES.map(g => `<option value="${g}" ${sel && sel.g === g ? 'selected' : ''}>${g}학년</option>`).join('')}</select>
          ${Array.from({ length: classCnt(sel ? sel.g : 1) }, (_, i) => `<button type="button" class="km-pill${sel && sel.c === i + 1 ? ' on' : ''}" data-rsc="${i + 1}">${i + 1}반</button>`).join('')}</span>`
      : myRoom ? `<span class="km-my">내 학급 <b>${myRoom.g}학년 ${myRoom.c}반</b></span>` : '';
    if (!sel?.c) {
      if (isAdm() && picker) { box.innerHTML = '<div class="rs-top"><h2 class="km-title">우리 반 학생</h2>' + picker + '</div><p class="hint">이 학년에는 설정된 학급이 없습니다.</p>'; return; }
      box.innerHTML = '<div class="rs-top"><h2 class="km-title">우리 반 학생</h2></div><p class="hint">이 학년도에 배정된 학급이 없습니다.</p>';
      return;
    }
    const ss = sorted(), m = ss.filter(s => s.sex === 'm').length, f = ss.filter(s => s.sex === 'f').length, mg = ss.filter(s => s.mig).length;
    const next = ss.reduce((t, s) => Math.max(t, s.no || 0), 0) + 1;
    box.innerHTML = `<div class="rs-top"><div><h2 class="km-title">${year}학년도 ${sel.g}학년 ${sel.c}반 학생</h2>
        <p class="hint">우리 반 학생을 등록·관리합니다. 학생 정보는 선택된 학년도 명단에 반영됩니다.</p></div>${picker}</div>
      <div class="sx-kpis rs-kpis"><div class="sx-kpi main"><b>${ss.length}<small>명</small></b><span>전체</span></div>
        <div class="sx-kpi"><b>${m}<small>명</small></b><span>남</span></div><div class="sx-kpi"><b>${f}<small>명</small></b><span>여</span></div>
        <div class="sx-kpi"><b>${mg}<small>명</small></b><span>이주배경</span></div></div>
      <p id="rsStatus" class="km-status"></p>
      <div class="card rs-card"><table class="rs-tbl"><thead><tr><th class="no">번호</th><th>이름</th><th>성별</th><th>이주배경</th><th>부모 출신국</th><th>메모</th><th></th></tr></thead><tbody>
        ${ss.map(s => `<tr data-id="${s.id}" class="${s.mig ? 'mig' : ''}">
          <td class="no"><input type="number" min="0" max="99" data-f="no" value="${s.no || ''}"></td>
          <td><input data-f="name" maxlength="20" value="${esc(s.name)}"></td>
          <td>${seg('data-sex', s.sex || '', [['m', '남'], ['f', '여']])}</td>
          <td>${seg('data-mig', s.mig || '', MIG)}</td>
          <td><span class="km-ac-wrap"><input data-f="country" maxlength="30" autocomplete="off" value="${esc(s.country || '')}" ${s.mig ? '' : 'disabled placeholder="-"'}></span></td>
          <td><input data-f="note" maxlength="60" value="${esc(s.note || '')}" placeholder=""></td>
          <td><button type="button" class="sm-del" data-rsdel="${s.id}">삭제</button></td></tr>`).join('') || '<tr><td colspan="7" class="km-empty">아직 등록한 학생이 없습니다. 아래에서 한 명씩 넣거나 여러 명을 한 번에 붙여 넣으세요.</td></tr>'}
        <tr class="rs-new"><td class="no"><input type="number" min="0" max="99" id="rsNo" value="${next}"></td>
          <td><input id="rsName" maxlength="20" placeholder="이름"></td>
          <td>${seg('data-nsex', 'm', [['m', '남'], ['f', '여']])}</td>
          <td>${seg('data-nmig', '', MIG)}</td>
          <td><span class="km-ac-wrap"><input id="rsCountry" maxlength="30" autocomplete="off" placeholder="이주배경이면 입력" disabled></span></td>
          <td><input id="rsNote" maxlength="60"></td>
          <td><button type="button" class="btn small primary" data-rsact="add">추가</button></td></tr>
      </tbody></table>
      <details class="rs-bulk"><summary>여러 명 한 번에 붙여 넣기</summary>
        <p class="hint">한 줄에 한 명씩 '번호 이름 성별' 순서로 적으세요. 예) <code>1 김민수 남</code> · 엑셀에서 복사해도 됩니다.</p>
        <textarea id="rsBulk" rows="5" placeholder="1 김민수 남&#10;2 이서연 여"></textarea>
        <button type="button" class="btn small primary" data-rsact="bulk">명단에 추가</button></details>
      <p class="hint">학생 이름은 이 반 담임과 관리자만 볼 수 있습니다. 이주배경학생 현황·HOME에는 인원과 비율만 나옵니다.</p></div>`;
  }

  /* ---------- 저장 ---------- */
  const clean = s => ({ grade: sel.g, cls: sel.c, no: Math.max(0, Math.min(99, Number(s.no) || 0)), name: String(s.name || '').trim().slice(0, 20),
    sex: ['m', 'f'].includes(s.sex) ? s.sex : '', mig: MIG_L[s.mig] !== undefined ? s.mig : '', country: s.mig ? String(s.country || '').trim().slice(0, 30) : '',
    note: String(s.note || '').trim().slice(0, 60), updatedBy: Cloud.email, updatedAt: F().serverTimestamp() });

  async function writeRows(records) {
    const f = F(), currentYear = year, room = sel;
    if (!room?.c || !currentYear) throw new Error('학급을 선택해 주세요.');
    const group = room.g + '-' + room.c;
    const roomRef = f.doc(db(), 'rosterYears', currentYear, 'classes', group);
    const entries = records.map(({ id, data, leaving }) => {
      const profile = id ? f.doc(db(), 'studentProfiles', id) : f.doc(f.collection(db(), 'studentProfiles'));
      return { id, profile, data, leaving, member: f.doc(db(), 'rosterYears', currentYear, 'memberships', profile.id) };
    });
    await f.runTransaction(db(), async tx => {
      const roomData = (await tx.get(roomRef)).data() || {};
      const slots = { ...roomData.slots };
      const current = await Promise.all(entries.map(entry => entry.id ? tx.get(entry.member) : null));
      for (const [i, entry] of entries.entries()) {
        const old = current[i]?.data(), { data, profile } = entry;
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
          no: data.no, displayName: data.name, sex: data.sex, mig: data.mig, country: data.country, note: data.note,
          status: 'enrolled', updatedAt: f.serverTimestamp(), updatedBy: Cloud.email };
        tx.set(entry.member, member);
        if (member.mig || old?.mig) YearStudentViews.stage(tx, Cloud.fb, member);
      }
      tx.set(roomRef, { ...roomData, year: currentYear, grade: room.g, cls: room.c, slots });
    });
  }

  async function updateField(id, patch) {
    const row = list.find(x => x.id === id);
    if (!row) return;
    try { await writeRows([{ id, data: clean({ ...row, ...patch }) }]); say('저장했습니다.', true); }
    catch (error) { render(); say('저장 실패: ' + error.message); }
  }

  async function add(rows) {
    let next = list.reduce((max, row) => Math.max(max, row.no), 0) + 1;
    try {
      const entries = rows.map(row => ({ data: clean({ ...row, no: row.no || next++ }) }));
      const numbers = new Set(list.map(row => row.no));
      for (const { data } of entries) {
        if (!data.name || !Number.isInteger(data.no) || data.no < 1 || data.no > 99 || numbers.has(data.no)) {
          throw new Error('학생 이름과 번호를 확인해 주세요. 이미 사용 중인 번호는 등록할 수 없습니다.');
        }
        numbers.add(data.no);
      }
      if (isAdm()) await writeRows(entries);
      else {
        const initialYear = year, initialRoom = sel;
        let saved = 0;
        try {
          for (const entry of entries) {
            if (year !== initialYear || sel !== initialRoom) throw new Error('조회 학급이 바뀌었습니다.');
            await writeRows([entry]);
            saved++;
          }
        } catch (error) {
          throw new Error(saved + '명 저장 · ' + error.message);
        }
      }
      say(rows.length + '명을 등록했습니다.', true);
    } catch (error) { say('등록 실패: ' + error.message); }
  }

  async function remove(id) {
    const row = list.find(x => x.id === id);
    if (!row || !confirm(row.name + ' 학생을 현재 학급 명단에서 제외할까요? 소속과 기록은 유지됩니다.')) return;
    try { await writeRows([{ id, leaving: true }]); say('학급 명단에서 제외했습니다.', true); }
    catch (error) { say('처리 실패: ' + error.message); }
  }
  /* ---------- 이벤트 ---------- */
  const root = $('tab-roster');
  let newSex = 'm', newMig = '';
  root.addEventListener('click', async e => {
    const t = e.target, tr = t.closest('tr[data-id]');
    const sx = t.closest('[data-sex]'); if (sx && tr) { updateField(tr.dataset.id, { sex: sx.dataset.sex }); return; }
    const mg = t.closest('[data-mig]'); if (mg && tr) { updateField(tr.dataset.id, { mig: mg.dataset.mig }); return; }
    const ns = t.closest('[data-nsex]'); if (ns) { newSex = ns.dataset.nsex; ns.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === ns)); return; }
    const nm = t.closest('[data-nmig]'); if (nm) { newMig = nm.dataset.nmig; nm.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === nm)); $('rsCountry').disabled = !newMig; if (newMig) $('rsCountry').focus(); return; }
    const del = t.closest('[data-rsdel]'); if (del) { remove(del.dataset.rsdel); return; }
    const c = t.closest('[data-rsc]'); if (c) { sel = { g: Number($('rsG').value), c: Number(c.dataset.rsc) }; watch(); render(); return; }
    const a = t.closest('[data-rsact]')?.dataset.rsact;
    if (a === 'add') {
      const name = $('rsName').value.trim(); if (!name) { say('이름을 입력하세요.'); $('rsName').focus(); return; }
      await add([{ no: $('rsNo').value, name, sex: newSex, mig: newMig, country: $('rsCountry').value, note: $('rsNote').value }]);
      newMig = ''; render(); setTimeout(() => $('rsName')?.focus(), 30);
    } else if (a === 'bulk') {
      const rows = $('rsBulk').value.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
        const p = l.split(/[\s,\t]+/); const no = /^\d+$/.test(p[0]) ? p.shift() : '';
        const sexW = p.find(x => /^(남|여|남자|여자|m|f)$/i.test(x)); const name = p.filter(x => x !== sexW).join(' ');
        return { no, name, sex: sexW ? (/^(남|남자|m)$/i.test(sexW) ? 'm' : 'f') : '' };
      }).filter(r => r.name);
      if (!rows.length) { say('붙여 넣은 내용에서 이름을 찾지 못했습니다.'); return; }
      if (!confirm(`${rows.length}명을 명단에 추가할까요?`)) return;
      await add(rows); render();
    }
  });
  root.addEventListener('change', e => {
    const t = e.target, tr = t.closest('tr[data-id]');
    if (t.id === 'rsG') { sel = { g: Number(t.value), c: classCnt(Number(t.value)) ? 1 : 0 }; watch(); render(); return; }
    if (tr && t.dataset.f) updateField(tr.dataset.id, { [t.dataset.f]: t.value });
  });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.rs-new')) { e.preventDefault(); root.querySelector('[data-rsact="add"]').click(); } });
  // 부모 출신국: 글자를 치면 나라 목록
  root.addEventListener('input', e => {
    const inp = e.target; if (inp.id !== 'rsCountry' && inp.dataset.f !== 'country') return;
    root.querySelectorAll('.km-ac').forEach(x => x.remove());
    const q = inp.value.trim(); if (!q) return;
    const hits = (window.SchoolStatus?.countries || []).filter(n => n.includes(q) && n !== q).sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || a.length - b.length).slice(0, 6);
    if (!hits.length) return;
    const ul = document.createElement('ul'); ul.className = 'km-ac';
    ul.innerHTML = hits.map(n => { const u = window.SchoolStatus?.flagUrl(n); return `<li data-ac="${esc(n)}">${u ? `<img src="${u}" alt="" width="22" height="16">` : ''}<span>${esc(n)}</span></li>`; }).join('');
    ul.addEventListener('mousedown', ev => { const li = ev.target.closest('[data-ac]'); if (!li) return; ev.preventDefault(); inp.value = li.dataset.ac; ul.remove(); inp.dispatchEvent(new Event('change', { bubbles: true })); });
    inp.closest('.km-ac-wrap').appendChild(ul);
  });
  root.addEventListener('focusout', e => { if (e.target.closest('.km-ac-wrap')) setTimeout(() => root.querySelectorAll('.km-ac').forEach(x => x.remove()), 150); });

  RENDER.roster = render;
  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('year-change', () => { if (isAdm()) useYear(state.school.year); });
  if (ready()) subscribe();
})();
