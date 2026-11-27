/* 학년도별 이주배경학생 조회. 학생 수정은 학급관리 메뉴에서 한다. */
(function () {
  'use strict';
  const TYPES = [['foreign', '외국인가정'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const TYPE_L = Object.fromEntries(TYPES);
  let list = [], unsubList = null, unsubHome = null, unsubRooms = null, unsubSchool = null;
  let year = '', schoolYear = '', requestVersion = 0;
  let myRoom = undefined, rooms = [], sums = [], loaded = false;
  let sel = null;            // 보고 있는 학급 { g, c } (null = 전체 현황)

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const isStaff = () => !!(window.Cloud && Cloud.ready && (window.KoreanClasses?.isOwner(Cloud.email) ||
    (window.Activities?.ksl?.teachers || []).includes(Cloud.email)));
  const isWide = () => isAdm() || isStaff();     // 모든 학급을 보는 사람
  const ready = () => !!(window.Cloud && Cloud.ready);
  TAB_GUARDS.kmig = () => ready();
  const classCnt = g => {
    const settings = Number(year) === state.school.year ? state.school.classes
      : state.yearPlans?.[year]?.school?.classes || state.yearArchive?.[year]?.classes;
    return Math.min(20, Math.max(Number(settings?.[g]) || 0, ...list.filter(row => row.grade === g).map(row => row.cls)));
  };
  const F = () => Cloud.fb.F, db = () => Cloud.fb.db;
  const col = () => F().collection(db(), 'rosterYears', year, 'migrantRoster');
  const inClass = (g, c) => list.filter(s => s.grade === g && s.cls === c).sort((a, b) => (a.no || 99) - (b.no || 99) || a.name.localeCompare(b.name));

  /* ---------- 불러오기 ---------- */
  function stopList() { if (unsubList) unsubList(); unsubList = null; list = []; loaded = false; }
  function selectYear(next) {
    const version = ++requestVersion;
    unsubHome?.(); unsubRooms?.(); unsubHome = unsubRooms = null;
    stopList(); myRoom = undefined; rooms = []; sums = []; sel = null;
    year = /^20[0-9]{2}$/.test(String(next)) ? String(next) : '';
    if (!year) { myRoom = null; render(); return; }
    if (isWide()) { myRoom = null; watchList(); }
    else {
      unsubHome = StaffLinks.watchRoom(F(), db(), Cloud.email.toLowerCase(), year, snap => {
        if (version !== requestVersion) return;
        const [g, c] = String(snap.data()?.classId || '').split('-').map(Number);
        myRoom = g && c ? { g, c } : null;
        sel = myRoom;
        watchList(); if (curTab === 'kmig') render();
      }, () => { if (version === requestVersion) { myRoom = null; render(); } });
    }
    if (isAdm()) {
      unsubRooms = F().onSnapshot(F().collection(db(), 'rosterYears', year, 'homerooms'), snap => {
        if (version !== requestVersion) return;
        rooms = snap.docs.map(d => {
          const [grade, cls] = String(d.data().classId || '').split('-').map(Number);
          return { grade, cls };
        });
        if (curTab === 'kmig') render();
      });
    }
    if (curTab === 'kmig') render();
  }

  function subscribe() {
    unsubSchool?.(); unsubSchool = null;
    schoolYear = '';
    selectYear(null);
    if (!ready()) return;
    if (isAdm()) { selectYear(state.school.year); return; }
    unsubSchool = F().onSnapshot(F().doc(db(), 'config', 'school'), snap => {
      const next = String(snap.data()?.year || '');
      if (next === schoolYear) return;
      schoolYear = next;
      selectYear(next);
    });
  }

  function watchList() {
    stopList();
    const version = requestVersion;
    const query = isWide() ? col() : myRoom && F().query(col(), F().where('classId', '==', myRoom.g + '-' + myRoom.c));
    if (!query) { loaded = true; return; }
    unsubList = F().onSnapshot(query, snap => {
      if (version !== requestVersion) return;
      list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const grouped = new Map();
      for (const row of list) {
        const item = grouped.get(row.classId) || { grade: row.grade, cls: row.cls, foreign: 0, mid: 0, domestic: 0 };
        item[row.type]++;
        grouped.set(row.classId, item);
      }
      sums = [...grouped.values()];
      loaded = true;
      if (curTab === 'kmig') render();
      document.dispatchEvent(new Event('migrant-change'));
    }, error => { if (version === requestVersion) console.warn('이주배경 학생 조회 실패', error); });
  }
  /* ---------- 화면 ---------- */
  function render() {
    if (!ready()) { $('kmMain').innerHTML = '<p class="hint">승인된 계정으로 로그인해 주세요.</p>'; $('kmPicker').innerHTML = ''; return; }
    if (myRoom === undefined) { $('kmMain').innerHTML = '<p class="hint">불러오는 중…</p>'; return; }
    renderPicker();
    if (!isWide() && !myRoom) { $('kmLead').textContent = ''; $('kmMain').innerHTML = '<div class="card km-setup"><h3>이 학년도에 배정된 학급이 없습니다</h3><p class="hint">관리자에게 이 학년도의 담임 배정을 요청하세요.</p><button type="button" class="btn primary" data-act="go-roster">학급관리로 가기</button></div>'; return; }
    if (!sel) { $('kmLead').textContent = '학년·반별 이주배경학생 수입니다. 반을 누르면 명단을 볼 수 있습니다. 등록·수정은 학급관리에서 합니다.'; $('kmMain').innerHTML = overview(); return; }
    $('kmLead').textContent = isWide() ? '' : '우리 반 이주배경학생 명단입니다(조회). 등록·수정은 학급관리 › 우리 반 학생에서 합니다.';
    $('kmMain').innerHTML = classView(sel.g, sel.c);
  }

  function renderPicker() {
    const box = $('kmPicker');
    if (!isWide()) {
      box.innerHTML = myRoom ? `<span class="km-my">내 학급 <b>${myRoom.g}학년 ${myRoom.c}반</b></span>` : '';
      return;
    }
    const g = sel ? sel.g : 0;
    box.innerHTML = `${isAdm() ? `<label>학년도 <input id="kmYear" type="number" min="2000" max="2099" value="${year}"></label>` : `<span>${year}학년도</span>`}<button type="button" class="km-pill${sel ? '' : ' on'}" data-act="all">전체 현황</button>
      <select id="kmGrade" aria-label="학년">${GRADES.map(x => `<option value="${x}" ${x === g ? 'selected' : ''}>${x}학년</option>`).join('')}</select>
      <span class="km-cls">${Array.from({ length: classCnt(g || 1) }, (_, i) => i + 1).map(c => `<button type="button" class="km-pill${sel && sel.c === c ? ' on' : ''}" data-cls="${c}">${c}반</button>`).join('')}</span>`;
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

  /** 학급 명단 보기(조회 전용). 등록·수정은 학급관리 › 우리 반 학생에서 */
  function classView(g, c) {
    if (!loaded) return '<p class="hint">불러오는 중…</p>';
    const ss = inClass(g, c);
    const counts = TYPES.map(([k, l]) => { const n = ss.filter(s => s.type === k).length; return n ? `<span class="km-badge ${k}">${l} ${n}</span>` : ''; }).join('');
    const canEdit = isAdm() || (myRoom && myRoom.g === g && myRoom.c === c);
    const row = s => `<li class="km-row" data-id="${s.id}">
        <span class="km-no">${s.no || '-'}</span>
        <span class="km-name">${esc(s.name)}</span>
        <span class="km-country">${flag(s.country)}${esc(s.country || '출신국 미입력')}</span>
        <span class="km-badge ${s.type}">${TYPE_L[s.type] || ''}</span><span></span></li>`;
    return `<div class="card km-classcard">
        <div class="km-class-h"><h3>${g}학년 ${c}반 <span>${ss.length}명</span></h3><div class="km-counts">${counts}</div></div>
        ${ss.length ? `<ul class="km-rows">${ss.map(row).join('')}</ul>` : '<p class="km-empty">이 반에 등록된 이주배경학생이 없습니다.</p>'}
        <div class="km-ro-note"><span>학생 등록·수정은 <b>학급관리 › 우리 반 학생</b>에서 합니다. 거기서 '이주배경'을 고르면 여기에 자동으로 나옵니다.</span>
          ${canEdit ? '<button type="button" class="btn small primary" data-act="go-roster">학급관리로 가기</button>' : ''}</div>
      </div>`;
  }

  const root = $('tab-kmig');
  root.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    const action = button.dataset.act;
    if (action === 'go-roster') { showTab('roster'); return; }
    if (action === 'all') sel = null;
    else if (button.dataset.cls) sel = { g: Number($('kmGrade').value), c: Number(button.dataset.cls) };
    else if (button.dataset.open) {
      const [g, c] = button.dataset.open.split('-').map(Number);
      sel = { g, c };
    } else return;
    render();
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'kmYear' && isAdm()) selectYear(e.target.value);
    if (e.target.id === 'kmGrade') { sel = { g: Number(e.target.value), c: 1 }; render(); }
  });
  // 한국어학급 운영 시간표에서 등록 학생을 고를 수 있게 (이름을 볼 권한이 있는 사람에게만 목록이 채워짐)
  window.MigrantStudents = { list: () => list.slice(), byId: id => list.find(s => s.id === id) || null };
  RENDER.kmig = () => { if (!sel && myRoom && !isWide()) sel = { ...myRoom }; render(); };
  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('year-change', () => { if (isAdm()) selectYear(state.school.year); });
  document.addEventListener('kclass-change', () => {
    if (year && ready() && !isAdm() && isWide() && myRoom !== null) selectYear(schoolYear || year);
  });
  if (ready()) subscribe();
})();