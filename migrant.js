/* =========================================================
 * 이주배경학생 › 이주배경학생 현황 (학급별 명단)
 *  - 담임: 처음 한 번 '내 학급'을 고르면(homerooms/{email}) 그 반 명단을 입력·수정
 *  - 관리자·한국어학급 담당: 모든 학급 + 전체 현황
 *  - migrantStudents/{id} { grade, cls, no, name, country, type:'foreign'|'mid'|'domestic' }  (학생 이름 = 개인정보, 그 반 담임·관리자·한국어학급 담당만)
 *  - migrantClassSum/{학년-반} { grade, cls, foreign, mid, domestic, countries:{나라:명} }  (이름 없는 합계 → HOME·학교 현황 자동 계산)
 *  - 반 수는 교육과정 편성 › 학교 정보의 학급 수
 * ========================================================= */
(function () {
  'use strict';
  const TYPES = [['foreign', '외국인가정'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const TYPE_L = Object.fromEntries(TYPES);
  let list = [], unsubList = null, unsubHome = null, unsubSum = null, unsubRooms = null;
  let myRoom = undefined, rooms = [], sums = [], loaded = false;
  let sel = null;            // 보고 있는 학급 { g, c } (null = 전체 현황)
  let editId = null;         // 수정 중인 학생
  let addType = 'foreign';

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const isStaff = () => !!(window.Cloud && Cloud.ready && (window.KoreanClasses?.isOwner(Cloud.email) ||
    (window.Activities?.ksl?.teachers || []).includes(Cloud.email)));
  const isWide = () => isAdm() || isStaff();     // 모든 학급을 보는 사람
  const ready = () => !!(window.Cloud && Cloud.ready);
  TAB_GUARDS.kmig = () => ready();
  const classCnt = g => Math.min(20, Number(state.school.classes?.[g]) || 0);
  const F = () => Cloud.fb.F, db = () => Cloud.fb.db;
  const col = () => F().collection(db(), 'migrantStudents');
  const inClass = (g, c) => list.filter(s => s.grade === g && s.cls === c).sort((a, b) => (a.no || 99) - (b.no || 99) || a.name.localeCompare(b.name));
  const say = (t, ok) => { const el = $('kmStatus'); el.textContent = t; el.classList.toggle('ok', !!ok); };

  /* ---------- 불러오기 ---------- */
  function stopList() { if (unsubList) unsubList(); unsubList = null; list = []; loaded = false; }
  function subscribe() {
    [unsubHome, unsubSum, unsubRooms].forEach(u => u && u()); unsubHome = unsubSum = unsubRooms = null;
    stopList(); myRoom = undefined; rooms = []; sums = [];
    if (!ready()) { if (curTab === 'kmig') render(); return; }
    unsubHome = F().onSnapshot(F().doc(db(), 'homerooms', Cloud.email), d => {
      myRoom = d.exists() ? { g: d.data().grade, c: d.data().cls } : null;
      if (!sel && myRoom && !isWide()) sel = { ...myRoom };
      watchList(); if (curTab === 'kmig') render();
    }, () => { myRoom = null; watchList(); if (curTab === 'kmig') render(); });
    unsubSum = F().onSnapshot(F().collection(db(), 'migrantClassSum'), s => { sums = s.docs.map(d => d.data()); if (curTab === 'kmig') render(); }, () => {});
    if (isAdm()) unsubRooms = F().onSnapshot(F().collection(db(), 'homerooms'), s => { rooms = s.docs.map(d => ({ email: d.id, ...d.data() })); if (curTab === 'kmig') render(); }, () => {});
  }
  /** 관리자·한국어학급 담당은 전체, 담임은 자기 반만 (보안 규칙이 증명할 수 있게 학년·반 조건을 붙임) */
  function watchList() {
    stopList();
    let q;
    if (isWide()) q = col();
    else if (myRoom) q = F().query(col(), F().where('grade', '==', myRoom.g), F().where('cls', '==', myRoom.c));
    else { loaded = true; return; }
    unsubList = F().onSnapshot(q, s => { list = s.docs.map(d => ({ id: d.id, ...d.data() })); loaded = true; if (curTab === 'kmig') render(); document.dispatchEvent(new Event('migrant-change')); },
      e => { console.warn('이주배경 학생 불러오기 실패', e); loaded = true; if (curTab === 'kmig') render(); });
  }

  /* ---------- 화면 ---------- */
  function render() {
    if (!ready()) { $('kmMain').innerHTML = '<p class="hint">승인된 계정으로 로그인해 주세요.</p>'; $('kmPicker').innerHTML = ''; return; }
    if (myRoom === undefined) { $('kmMain').innerHTML = '<p class="hint">불러오는 중…</p>'; return; }
    renderPicker();
    if (!isWide() && !myRoom) { $('kmLead').textContent = ''; $('kmMain').innerHTML = roomSetup(); return; }
    if (!sel) { $('kmLead').textContent = '학년·반별 이주배경학생 수입니다. 반을 누르면 명단을 보고 고칠 수 있습니다.'; $('kmMain').innerHTML = overview(); return; }
    $('kmLead').textContent = isWide() ? '' : '우리 반 이주배경학생을 등록하세요. 저장하면 학교 전체 현황(HOME)에 바로 반영됩니다.';
    $('kmMain').innerHTML = classView(sel.g, sel.c);
  }

  function renderPicker() {
    const box = $('kmPicker');
    if (!isWide()) {
      box.innerHTML = myRoom ? `<span class="km-my">내 학급 <b>${myRoom.g}학년 ${myRoom.c}반</b></span> <button type="button" class="btn small" data-act="change-room">학급 바꾸기</button>` : '';
      return;
    }
    const g = sel ? sel.g : 0;
    box.innerHTML = `<button type="button" class="km-pill${sel ? '' : ' on'}" data-act="all">전체 현황</button>
      <select id="kmGrade" aria-label="학년">${GRADES.map(x => `<option value="${x}" ${x === g ? 'selected' : ''}>${x}학년</option>`).join('')}</select>
      <span class="km-cls">${Array.from({ length: classCnt(g || 1) }, (_, i) => i + 1).map(c => `<button type="button" class="km-pill${sel && sel.c === c ? ' on' : ''}" data-cls="${c}">${c}반</button>`).join('')}</span>`;
  }

  function roomSetup() {
    return `<div class="card km-setup">
      <h3>담임하시는 학급을 골라 주세요</h3>
      <p class="hint">한 번만 고르면 다음부터 이 메뉴를 열 때 우리 반 명단이 바로 나옵니다. 담임이 아니면 고르지 않아도 됩니다.</p>
      <div class="row"><select id="kmRoomG">${GRADES.map(g => `<option value="${g}">${g}학년</option>`).join('')}</select>
        <select id="kmRoomC">${Array.from({ length: classCnt(1) }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('')}</select>
        <button type="button" class="btn primary" data-act="save-room">내 학급으로 저장</button></div></div>`;
  }

  function overview() {
    const sumOf = (g, c) => sums.find(s => s.grade === g && s.cls === c) || null;
    const tot = k => sums.reduce((t, s) => t + (Number(s[k]) || 0), 0);
    const all = tot('foreign') + tot('mid') + tot('domestic');
    const maxC = Math.max(1, ...GRADES.map(classCnt));
    const roomOf = (g, c) => rooms.find(r => r.grade === g && r.cls === c);
    const cell = (g, c) => {
      const s = sumOf(g, c), n = s ? s.foreign + s.mid + s.domestic : 0, r = roomOf(g, c);
      return `<td><button type="button" class="km-cell${n ? '' : ' zero'}" data-open="${g}-${c}"><b>${n}</b>
        ${n ? `<span class="km-t">${TYPES.map(([k, l]) => s[k] ? `<i class="${k}" title="${l}">${s[k]}</i>` : '').join('')}</span>` : ''}
        ${isAdm() ? `<small class="${r ? '' : 'none'}">${r ? esc(r.name || '담임') : '담임 미등록'}</small>` : ''}</button></td>`;
    };
    return `<div class="sx-kpis km-kpis">
        <div class="sx-kpi main"><b>${all}<small>명</small></b><span>이주배경학생</span></div>
        ${TYPES.map(([k, l]) => `<div class="sx-kpi"><b>${tot(k)}<small>명</small></b><span><i class="km-dot ${k}"></i>${l}</span></div>`).join('')}
      </div>
      <div class="tbl-scroll"><table class="sx-sheet km-sheet"><thead><tr><th>학년</th>${Array.from({ length: maxC }, (_, c) => `<th>${c + 1}반</th>`).join('')}<th class="tot">계</th></tr></thead>
      <tbody>${GRADES.map(g => `<tr><th>${g}학년</th>${Array.from({ length: maxC }, (_, c) => c < classCnt(g) ? cell(g, c + 1) : '<td class="na"></td>').join('')}
        <td class="tot">${sums.filter(s => s.grade === g).reduce((t, s) => t + s.foreign + s.mid + s.domestic, 0)}</td></tr>`).join('')}</tbody></table></div>
      <div class="km-legend">${TYPES.map(([k, l]) => `<span><i class="km-dot ${k}"></i>${l}</span>`).join('')}${isAdm() ? '<span>· 칸 아래 이름 = 등록한 담임</span>' : ''}</div>`;
  }

  const typeSeg = (cur, attr) => `<div class="km-seg" role="radiogroup">${TYPES.map(([k, l]) => `<button type="button" class="${k}${k === cur ? ' on' : ''}" data-${attr}="${k}" role="radio" aria-checked="${k === cur}">${l}</button>`).join('')}</div>`;
  const flag = name => { const u = window.SchoolStatus?.flagUrl(name); return u ? `<img src="${u}" alt="" width="22" height="16">` : ''; };

  function classView(g, c) {
    if (!loaded) return '<p class="hint">불러오는 중…</p>';
    const ss = inClass(g, c);
    const next = ss.reduce((m, s) => Math.max(m, s.no || 0), 0) + 1;
    const counts = TYPES.map(([k, l]) => { const n = ss.filter(s => s.type === k).length; return n ? `<span class="km-badge ${k}">${l} ${n}</span>` : ''; }).join('');
    const row = s => editId === s.id ? `<li class="km-row editing" data-id="${s.id}">
        <div class="km-form">
          <label class="f-no">번호<input type="number" min="0" max="99" data-e="no" value="${s.no || ''}"></label>
          <label class="f-name">이름<input data-e="name" maxlength="20" value="${esc(s.name)}"></label>
          <label class="f-country">부모 출신국<span class="km-ac-wrap"><input data-e="country" maxlength="30" autocomplete="off" value="${esc(s.country || '')}" placeholder="글자를 입력하면 나라가 떠요"></span></label>
          <div class="f-type"><span>구분</span>${typeSeg(s.type, 'etype')}</div>
          <div class="f-btn"><button type="button" class="btn primary" data-act="save-edit">저장</button><button type="button" class="btn" data-act="cancel-edit">취소</button></div>
        </div></li>`
      : `<li class="km-row" data-id="${s.id}">
        <span class="km-no">${s.no || '-'}</span>
        <span class="km-name">${esc(s.name)}</span>
        <span class="km-country">${flag(s.country)}${esc(s.country || '출신국 미입력')}</span>
        <span class="km-badge ${s.type}">${TYPE_L[s.type] || ''}</span>
        <span class="km-acts"><button type="button" class="btn small" data-edit="${s.id}">수정</button><button type="button" class="btn small" data-del="${s.id}">삭제</button></span></li>`;
    return `<div class="card km-classcard">
        <div class="km-class-h"><h3>${g}학년 ${c}반 <span>${ss.length}명</span></h3><div class="km-counts">${counts}</div></div>
        ${ss.length ? `<ul class="km-rows">${ss.map(row).join('')}</ul>` : '<p class="km-empty">아직 등록한 학생이 없습니다. 우리 반에 이주배경학생이 없으면 비워 두면 됩니다.</p>'}
      </div>
      <div class="card km-addcard">
        <h3>학생 등록</h3>
        <div class="km-form" id="kmAdd">
          <label class="f-no">번호<input type="number" min="0" max="99" id="kmNo" value="${next}"></label>
          <label class="f-name">이름<input id="kmName" maxlength="20" placeholder="학생 이름"></label>
          <label class="f-country">부모 출신국<span class="km-ac-wrap"><input id="kmCountry" maxlength="30" autocomplete="off" placeholder="예: 베 → 베트남"></span></label>
          <div class="f-type"><span>구분</span>${typeSeg(addType, 'atype')}</div>
          <div class="f-btn"><button type="button" class="btn primary" data-act="add">등록</button></div>
        </div>
        <p class="hint">Enter를 눌러도 등록됩니다. 학생 이름은 이 반 담임, 관리자, 한국어학급 담당만 볼 수 있고 HOME에는 인원·비율만 나옵니다.</p>
      </div>`;
  }

  /* ---------- 부모 출신국 자동 완성 ---------- */
  let acBox = null, acInput = null, acIdx = -1;
  function acClose() { if (acBox) acBox.remove(); acBox = null; acInput = null; acIdx = -1; }
  function acOpen(input) {
    const q = input.value.trim();
    acClose();
    if (!q) return;
    const used = [...new Set(list.map(s => (s.country || '').trim()).filter(Boolean))];
    const pool = [...new Set([...used, ...(window.SchoolStatus?.countries || [])])];
    const hits = pool.filter(n => n.includes(q) && n !== q).sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || a.length - b.length).slice(0, 7);
    if (!hits.length) return;
    acInput = input;
    acBox = document.createElement('ul');
    acBox.className = 'km-ac'; acBox.setAttribute('role', 'listbox');
    acBox.innerHTML = hits.map((n, i) => `<li role="option" data-ac="${esc(n)}" class="${i === 0 ? 'on' : ''}">${flag(n)}<span>${esc(n)}</span></li>`).join('');
    acIdx = 0;
    input.closest('.km-ac-wrap').appendChild(acBox);
  }
  function acPick(name) { if (!acInput) return; acInput.value = name; const inp = acInput; acClose(); inp.dispatchEvent(new Event('change', { bubbles: true })); }
  function acMove(d) { const items = acBox ? [...acBox.children] : []; if (!items.length) return; acIdx = (acIdx + d + items.length) % items.length; items.forEach((li, i) => li.classList.toggle('on', i === acIdx)); }

  /* ---------- 저장 ---------- */
  const clean = o => ({ grade: o.grade, cls: o.cls, no: Math.max(0, Math.min(99, Number(o.no) || 0)), name: String(o.name || '').trim().slice(0, 20),
    country: String(o.country || '').trim().slice(0, 30), type: TYPE_L[o.type] ? o.type : 'foreign', updatedBy: Cloud.email, updatedAt: F().serverTimestamp() });

  /** 그 반 합계 문서 다시 쓰기 (비면 삭제) */
  async function syncClass(g, c, rows) {
    const ref = F().doc(db(), 'migrantClassSum', `${g}-${c}`);
    if (!rows.length) { await F().deleteDoc(ref); return; }
    const countries = {};
    rows.forEach(s => { const k = (s.country || '').trim(); if (k) countries[k] = (countries[k] || 0) + 1; });
    const n = t => rows.filter(s => s.type === t).length;
    await F().setDoc(ref, { grade: g, cls: c, foreign: n('foreign'), mid: n('mid'), domestic: n('domestic'), countries, updatedAt: F().serverTimestamp() });
  }
  async function afterChange(g, c, msg) {
    try { await syncClass(g, c, inClass(g, c)); say(msg + ' 학교 전체 현황에도 반영했습니다.', true); }
    catch (e) { say(msg + ' (현황 반영 실패: ' + e.message + ')'); }
  }

  async function add() {
    const name = $('kmName').value.trim();
    if (!name) { say('이름을 입력하세요.'); $('kmName').focus(); return; }
    const row = clean({ grade: sel.g, cls: sel.c, no: $('kmNo').value, name, country: $('kmCountry').value, type: addType });
    try {
      const ref = await F().addDoc(col(), row);
      if (!list.some(s => s.id === ref.id)) list.push({ id: ref.id, ...row });
      await afterChange(sel.g, sel.c, `${row.name} 학생을 등록했습니다.`);
      render(); setTimeout(() => $('kmName')?.focus(), 30);
    } catch (e) { say('등록 실패: ' + e.message); }
  }
  async function saveEdit() {
    const s = list.find(x => x.id === editId), li = document.querySelector(`.km-row[data-id="${editId}"]`);
    if (!s || !li) return;
    const v = k => li.querySelector(`[data-e="${k}"]`).value;
    const type = li.querySelector('[data-etype].on')?.dataset.etype || s.type;
    const row = clean({ ...s, no: v('no'), name: v('name'), country: v('country'), type });
    if (!row.name) { say('이름은 비울 수 없습니다.'); return; }
    try { await F().setDoc(F().doc(col(), s.id), row); Object.assign(s, row); editId = null; await afterChange(s.grade, s.cls, '저장했습니다.'); render(); }
    catch (e) { say('저장 실패: ' + e.message); }
  }
  async function remove(id) {
    const s = list.find(x => x.id === id); if (!s) return;
    if (!confirm(`${s.name} 학생을 명단에서 삭제할까요?`)) return;
    try { await F().deleteDoc(F().doc(col(), id)); list = list.filter(x => x.id !== id); await afterChange(s.grade, s.cls, '삭제했습니다.'); render(); }
    catch (e) { say('삭제 실패: ' + e.message); }
  }
  async function saveRoom(g, c) {
    try {
      await F().setDoc(F().doc(db(), 'homerooms', Cloud.email), { grade: g, cls: c, name: Cloud.profileName || '', updatedAt: F().serverTimestamp() });
      sel = { g, c }; say(`${g}학년 ${c}반을 내 학급으로 저장했습니다.`, true);
    } catch (e) { say('저장 실패: ' + e.message); }
  }

  /* ---------- 이벤트 ---------- */
  const root = $('tab-kmig');
  root.addEventListener('click', e => {
    const t = e.target;
    const ac = t.closest('[data-ac]'); if (ac) { acPick(ac.dataset.ac); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'all') { sel = null; editId = null; say(''); render(); return; }
    if (act === 'save-room') { saveRoom(Number($('kmRoomG').value), Number($('kmRoomC').value)); return; }
    if (act === 'change-room') { myRoom = null; stopList(); loaded = true; sel = null; render(); return; }
    if (act === 'add') { add(); return; }
    if (act === 'save-edit') { saveEdit(); return; }
    if (act === 'cancel-edit') { editId = null; render(); return; }
    const cls = t.closest('[data-cls]'); if (cls) { sel = { g: Number($('kmGrade').value), c: Number(cls.dataset.cls) }; editId = null; say(''); render(); return; }
    const open = t.closest('[data-open]'); if (open) { const [g, c] = open.dataset.open.split('-').map(Number); sel = { g, c }; editId = null; say(''); render(); return; }
    const at = t.closest('[data-atype]'); if (at) { addType = at.dataset.atype; at.parentElement.querySelectorAll('button').forEach(b => { const on = b === at; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); return; }
    const et = t.closest('[data-etype]'); if (et) { et.parentElement.querySelectorAll('button').forEach(b => { const on = b === et; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); return; }
    const ed = t.closest('[data-edit]'); if (ed) { editId = ed.dataset.edit; render(); return; }
    const del = t.closest('[data-del]'); if (del) { remove(del.dataset.del); return; }
    if (!t.closest('.km-ac-wrap')) acClose();
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'kmGrade') { const g = Number(e.target.value); sel = { g, c: 1 }; editId = null; render(); }
    if (e.target.id === 'kmRoomG') { const n = classCnt(Number(e.target.value)); $('kmRoomC').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join(''); }
  });
  root.addEventListener('input', e => { if (e.target.id === 'kmCountry' || e.target.dataset.e === 'country') acOpen(e.target); });
  root.addEventListener('keydown', e => {
    if (acBox && acInput === e.target) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Enter' && acIdx >= 0) { e.preventDefault(); acPick(acBox.children[acIdx].dataset.ac); return; }
      if (e.key === 'Escape') { acClose(); return; }
    }
    if (e.key === 'Enter' && e.target.closest('#kmAdd')) { e.preventDefault(); add(); }
    if (e.key === 'Enter' && e.target.closest('.km-row.editing')) { e.preventDefault(); saveEdit(); }
  });
  root.addEventListener('focusout', e => { if (e.target === acInput) setTimeout(() => { if (!acBox?.matches(':hover')) acClose(); }, 150); });

  // 한국어학급 운영 시간표에서 등록 학생을 고를 수 있게 (이름을 볼 권한이 있는 사람에게만 목록이 채워짐)
  window.MigrantStudents = { list: () => list.slice(), byId: id => list.find(s => s.id === id) || null };
  RENDER.kmig = () => { if (!sel && myRoom && !isWide()) sel = { ...myRoom }; render(); };
  document.addEventListener('cloud-change', () => { sel = null; editId = null; subscribe(); });
  // 한국어학급 담당 여부가 늦게 확인되면 전체 명단으로 다시 구독
  document.addEventListener('kclass-change', () => { if (ready() && myRoom !== undefined && isWide() && !unsubList?.wide) { watchList(); if (unsubList) unsubList.wide = true; } });
  if (ready()) subscribe();
})();
