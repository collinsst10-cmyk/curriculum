/* =========================================================
 * 학급관리 › 우리 반 학생 (담임이 자기 반 학생을 등록·관리)
 *  - students/{id} { grade, cls, no, name, sex:'m'|'f'|'', mig:''|'foreign'|'mid'|'domestic', country, note }
 *    학생 이름 = 개인정보 → 그 반 담임과 관리자만 (보안 규칙도 같음)
 *  - 이주배경이면 같은 id로 migrantStudents 에도 맞춰 두고(한국어학급 운영에서 이름으로 고르기),
 *    반별 합계(migrantClassSum)를 다시 계산 → 이주배경학생 현황·HOME 에 반영
 *  - 담임 학급: 관리자가 정한 직위(담임 학급) 또는 본인이 고른 학급(homerooms)
 * ========================================================= */
(function () {
  'use strict';
  const MIG = [['', '해당 없음'], ['foreign', '외국인가정'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const MIG_L = Object.fromEntries(MIG);
  let list = [], unsub = null, sel = null, myRoom, unsubRoom = null, legacy = [];
  const F = () => Cloud.fb.F, db = () => Cloud.fb.db;
  const ready = () => !!(window.Cloud && Cloud.ready);
  const isAdm = () => ready() && Cloud.isAdmin();
  const classCnt = g => Math.min(20, Number(state.school.classes?.[g]) || 0);
  const col = () => F().collection(db(), 'students');
  const say = (t, ok) => { const el = $('rsStatus'); if (el) { el.textContent = t; el.classList.toggle('ok', !!ok); } };
  TAB_GUARDS.roster = () => ready();

  /* ---------- 내 학급 ---------- */
  function roomFromPosition() {
    const p = (window.Cloud && Cloud.position) || {}, [g, c] = String(p.posCls || '').split('-').map(Number);
    return p.posType === 'homeroom' && g && c ? { g, c } : null;
  }
  function subscribe() {
    if (unsubRoom) unsubRoom(); unsubRoom = null; stop(); myRoom = undefined; sel = null;
    window.BehaviorUI?.sync([]);
    if (!ready()) { if (curTab === 'roster') render(); return; }
    unsubRoom = F().onSnapshot(F().doc(db(), 'homerooms', Cloud.email), d => {
      myRoom = roomFromPosition() || (d.exists() ? { g: d.data().grade, c: d.data().cls } : null);
      if (!sel && myRoom) sel = { ...myRoom };
      if (!sel && isAdm()) sel = { g: 1, c: 1 };
      watch(); if (curTab === 'roster') render();
    }, () => { myRoom = roomFromPosition(); if (!sel) sel = myRoom || (isAdm() ? { g: 1, c: 1 } : null); watch(); if (curTab === 'roster') render(); });
  }
  function stop() { if (unsub) unsub(); unsub = null; list = []; legacy = []; }
  /** 고른 학급의 학생만 (보안 규칙이 학년·반으로 확인) */
  function watch() {
    stop();
    if (!sel) return;
    const q = F().query(col(), F().where('grade', '==', sel.g), F().where('cls', '==', sel.c));
    unsub = F().onSnapshot(q, s => { list = s.docs.map(d => ({ id: d.id, ...d.data() })); loadLegacy(); if (curTab === 'roster') render(); },
      e => { console.warn('학생 명단 불러오기 실패', e); say('명단을 불러오지 못했습니다: ' + e.message); });
  }
  /** 예전 '이주배경학생 현황'에만 등록했던 학생 (아직 명단에 없는 사람) */
  async function loadLegacy() {
    try {
      const q = F().query(F().collection(db(), 'migrantStudents'), F().where('grade', '==', sel.g), F().where('cls', '==', sel.c));
      const ids = new Set(list.map(s => s.id));
      legacy = (await F().getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() })).filter(s => !ids.has(s.id));
      if (curTab === 'roster') render();
    } catch (e) { legacy = []; }
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
      : myRoom ? `<span class="km-my">내 학급 <b>${myRoom.g}학년 ${myRoom.c}반</b></span>${roomFromPosition() ? '' : ' <button type="button" class="btn small" data-rsact="change-room">학급 바꾸기</button>'}` : '';
    if (!sel) {
      box.innerHTML = `<div class="rs-top"><h2 class="km-title">우리 반 학생</h2></div>
        <div class="card km-setup"><h3>담임하시는 학급을 골라 주세요</h3>
          <p class="hint">관리자가 직위(담임 학급)를 정해 두면 자동으로 정해집니다. 담임이 아니면 고르지 않아도 됩니다.</p>
          <div class="row"><select id="rsRoomG">${GRADES.map(g => `<option value="${g}">${g}학년</option>`).join('')}</select>
            <select id="rsRoomC">${Array.from({ length: classCnt(1) }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('')}</select>
            <button type="button" class="btn primary" data-rsact="save-room">내 학급으로 저장</button></div></div><p id="rsStatus" class="km-status"></p>`;
      return;
    }
    const ss = sorted(), m = ss.filter(s => s.sex === 'm').length, f = ss.filter(s => s.sex === 'f').length, mg = ss.filter(s => s.mig).length;
    const next = ss.reduce((t, s) => Math.max(t, s.no || 0), 0) + 1;
    box.innerHTML = `<div class="rs-top"><div><h2 class="km-title">${sel.g}학년 ${sel.c}반 학생</h2>
        <p class="hint">우리 반 학생을 등록·관리합니다. 이주배경학생은 여기서 '이주배경'을 고르면 이주배경학생 현황과 HOME에 자동으로 반영됩니다.</p></div>${picker}</div>
      <div class="sx-kpis rs-kpis"><div class="sx-kpi main"><b>${ss.length}<small>명</small></b><span>전체</span></div>
        <div class="sx-kpi"><b>${m}<small>명</small></b><span>남</span></div><div class="sx-kpi"><b>${f}<small>명</small></b><span>여</span></div>
        <div class="sx-kpi"><b>${mg}<small>명</small></b><span>이주배경</span></div></div>
      <p id="rsStatus" class="km-status"></p>
      ${legacy.length ? `<div class="rs-legacy">이주배경학생 현황에만 등록된 학생 ${legacy.length}명이 있습니다 (${legacy.map(s => esc(s.name)).join(', ')}). <button type="button" class="btn small primary" data-rsact="import">우리 반 명단으로 가져오기</button></div>` : ''}
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

  /** 이주배경 명단(migrantStudents)·반별 합계(migrantClassSum)를 우리 반 명단에 맞춤 */
  async function syncMigrant(changed) {
    const mref = id => F().doc(db(), 'migrantStudents', id);
    for (const s of changed) {
      if (s._deleted || !s.mig) { await F().deleteDoc(mref(s.id)).catch(() => {}); continue; }
      await F().setDoc(mref(s.id), { grade: s.grade, cls: s.cls, no: s.no, name: s.name, country: s.country || '', type: s.mig, updatedBy: Cloud.email, updatedAt: F().serverTimestamp() });
    }
    const migs = list.filter(s => s.mig && !s._deleted);
    const sref = F().doc(db(), 'migrantClassSum', `${sel.g}-${sel.c}`);
    if (!migs.length) { await F().deleteDoc(sref).catch(() => {}); return; }
    const countries = {}; migs.forEach(s => { const k = (s.country || '').trim(); if (k) countries[k] = (countries[k] || 0) + 1; });
    const n = t => migs.filter(s => s.mig === t).length;
    await F().setDoc(sref, { grade: sel.g, cls: sel.c, foreign: n('foreign'), mid: n('mid'), domestic: n('domestic'), countries, updatedAt: F().serverTimestamp() });
  }
  async function upsert(id, data, msg) {
    try {
      let ref;
      if (id) { ref = F().doc(col(), id); await F().setDoc(ref, data); } else { ref = await F().addDoc(col(), data); }
      const row = { id: ref.id, ...data };
      list = [...list.filter(s => s.id !== ref.id), row];
      await syncMigrant([row]);
      say(msg, true);
    } catch (e) { say('저장 실패: ' + e.message); }
  }
  async function updateField(id, patch) {
    const s = list.find(x => x.id === id); if (!s) return;
    const data = clean({ ...s, ...patch });
    if (!data.name) { say('이름은 비울 수 없습니다.'); render(); return; }
    await upsert(id, data, '저장했습니다.');
  }
  async function add(rows) {
    for (const r of rows) await upsert(null, clean(r), `${rows.length}명을 등록했습니다.`);
  }
  async function remove(id) {
    const s = list.find(x => x.id === id); if (!s || !confirm(`${s.name} 학생을 명단에서 삭제할까요?`)) return;
    try { await F().deleteDoc(F().doc(col(), id)); list = list.filter(x => x.id !== id); await syncMigrant([{ ...s, _deleted: true }]); say('삭제했습니다.', true); }
    catch (e) { say('삭제 실패: ' + e.message); }
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
    } else if (a === 'import') {
      if (!confirm(`이주배경학생 현황에 있던 ${legacy.length}명을 우리 반 명단에 가져올까요?`)) return;
      for (const s of legacy) await upsert(s.id, clean({ no: s.no, name: s.name, sex: '', mig: s.type, country: s.country, note: '' }), '가져왔습니다.');
      legacy = []; render();
    } else if (a === 'save-room') {
      try { await F().setDoc(F().doc(db(), 'homerooms', Cloud.email), { grade: Number($('rsRoomG').value), cls: Number($('rsRoomC').value), name: Cloud.profileName || '', updatedAt: F().serverTimestamp() }); }
      catch (err) { say('저장 실패: ' + err.message); }
    } else if (a === 'change-room') { sel = null; stop(); render(); }
  });
  root.addEventListener('change', e => {
    const t = e.target, tr = t.closest('tr[data-id]');
    if (t.id === 'rsG') { sel = { g: Number(t.value), c: 1 }; watch(); render(); return; }
    if (t.id === 'rsRoomG') { $('rsRoomC').innerHTML = Array.from({ length: classCnt(Number(t.value)) }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join(''); return; }
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
  if (ready()) subscribe();
})();
