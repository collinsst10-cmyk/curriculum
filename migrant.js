/* =========================================================
 * 한국어 학급 › 이주배경 학생 (학생 명부)
 *  - migrantStudents/{id} { grade, cls, no, name, country, type:'foreign'|'mid'|'domestic', updatedBy, updatedAt }
 *  - 학생 이름이 있는 개인정보 → 관리자와 한국어학급 담당만 읽고 씀 (보안 규칙도 같음)
 *  - 반 수는 교육과정 편성 › 학교 정보의 학급 수
 *  - 바꿀 때마다 '이주배경학생 현황'(config/migrant) 숫자·부모 출신국을 다시 계산해 HOME에 반영
 *  - 첫 화면은 전체 현황, 오른쪽에서 학년을 고르면 반별 명단 (시간표 배치와 같은 구성)
 * ========================================================= */
(function () {
  'use strict';
  const TYPES = [['foreign', '외국인가정'], ['mid', '중도입국'], ['domestic', '국내출생']];
  const TYPE_L = Object.fromEntries(TYPES);
  let list = [], unsub = null, view = 'all', loaded = false;

  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const isStaff = () => !!(window.Cloud && Cloud.ready && (window.KoreanClasses?.isOwner(Cloud.email) ||
    (window.Activities?.ksl?.teachers || []).includes(Cloud.email)));
  const canUse = () => isAdm() || isStaff();
  TAB_GUARDS.kmig = () => canUse();
  const classCnt = g => Math.min(20, Number(state.school.classes?.[g]) || 0);
  const col = () => Cloud.fb.F.collection(Cloud.fb.db, 'migrantStudents');
  const byClass = (g, c) => list.filter(s => s.grade === g && s.cls === c).sort((a, b) => (a.no || 99) - (b.no || 99) || a.name.localeCompare(b.name));

  function refreshNav() {
    const b = document.querySelector('#tabs [data-tab="kmig"]');
    if (b && curTab && document.querySelector(`#tabs [data-tab="${curTab}"]`)?.dataset.group === 'kclass') b.hidden = !canUse();
    if (curTab === 'kmig' && !canUse()) showTab('kclass1');
  }

  function subscribe() {
    if (unsub) unsub(); unsub = null; list = []; loaded = false;
    refreshNav();
    if (!canUse()) { if (curTab === 'kmig') render(); return; }
    unsub = Cloud.fb.F.onSnapshot(col(), snap => {
      list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      loaded = true;
      if (curTab === 'kmig') render();
    }, e => { console.warn('이주배경 학생 불러오기 실패', e); loaded = true; if (curTab === 'kmig') render(); });
  }

  /* ---------- 화면 ---------- */
  function render() {
    const main = $('kmMain');
    $('kmViews').innerHTML = `<button class="btn km-all" data-view="all" aria-pressed="${view === 'all'}">전체 현황</button>
      <div class="km-grades">${GRADES.map(g => { const n = list.filter(s => s.grade === g).length;
        return `<button class="btn" data-view="${g}" aria-pressed="${view === String(g)}">${g}학년 <small>${n}명</small></button>`; }).join('')}</div>`;
    if (!canUse()) { main.innerHTML = '<p class="hint">관리자와 한국어학급 담당 선생님만 볼 수 있습니다.</p>'; return; }
    if (!loaded) { main.innerHTML = '<p class="hint">불러오는 중…</p>'; return; }
    main.innerHTML = view === 'all' ? overview() : gradeView(Number(view));
  }

  function overview() {
    const cnt = t => list.filter(s => s.type === t).length;
    const total = list.length, maxC = Math.max(1, ...GRADES.map(classCnt));
    const countries = {};
    list.forEach(s => { const k = (s.country || '').trim() || '미입력'; countries[k] = (countries[k] || 0) + 1; });
    const cs = Object.entries(countries).sort((a, b) => b[1] - a[1]);
    const cell = (g, c) => {
      const ss = byClass(g, c);
      if (!ss.length) return '<td class="km-c zero" data-go-grade="' + g + '">0</td>';
      const t = TYPES.map(([k, l]) => { const n = ss.filter(s => s.type === k).length; return n ? `<i class="${k}" title="${l} ${n}명">${n}</i>` : ''; }).join('');
      return `<td class="km-c" data-go-grade="${g}"><b>${ss.length}</b><span class="km-t">${t}</span></td>`;
    };
    return `<div class="sx-kpis km-kpis">
        <div class="sx-kpi main"><b>${total}<small>명</small></b><span>이주배경 학생</span></div>
        ${TYPES.map(([k, l]) => `<div class="sx-kpi"><b>${cnt(k)}<small>명</small></b><span><i class="km-dot ${k}"></i>${l}</span></div>`).join('')}
      </div>
      <h3 class="km-h">학년·반별 인원 <small class="hint">칸을 누르면 그 학년 명단으로 갑니다</small></h3>
      <div class="tbl-scroll"><table class="sx-sheet km-sheet"><thead><tr><th>학년</th>${Array.from({ length: maxC }, (_, c) => `<th>${c + 1}반</th>`).join('')}<th class="tot">계</th></tr></thead>
      <tbody>${GRADES.map(g => `<tr><th>${g}학년</th>${Array.from({ length: maxC }, (_, c) => c < classCnt(g) ? cell(g, c + 1) : '<td class="na"></td>').join('')}
        <td class="tot">${list.filter(s => s.grade === g).length}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>계</th><td colspan="${maxC}"></td><td class="tot">${total}</td></tr></tfoot></table></div>
      <div class="km-legend">${TYPES.map(([k, l]) => `<span><i class="km-dot ${k}"></i>${l}</span>`).join('')}</div>
      <h3 class="km-h">부모 출신국 <small class="hint">${cs.filter(([k]) => k !== '미입력').length}개국</small></h3>
      ${cs.length ? `<ul class="km-countries">${cs.map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}</b><small>${Math.round(n / total * 100)}%</small></li>`).join('')}</ul>` : '<p class="hint">아직 등록된 학생이 없습니다. 오른쪽에서 학년을 골라 등록하세요.</p>'}
      <p class="hint km-note">여기 등록한 내용은 HOME과 학교 현황의 '이주배경학생 현황'(인원·비율·부모 출신국)에 바로 반영됩니다. 학생 이름은 관리자와 한국어학급 담당만 볼 수 있습니다.</p>`;
  }

  const typeSel = (v, attrs) => `<select ${attrs}>${TYPES.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  function gradeView(g) {
    const n = classCnt(g);
    if (!n) return `<p class="hint">${g}학년 학급 수가 학교 정보에 없습니다. 교육과정 편성 › ① 학교 정보에서 학급 수를 입력하세요.</p>`;
    return `<h3 class="km-h">${g}학년 이주배경 학생 <small class="hint">${list.filter(s => s.grade === g).length}명 · 학급 수는 학교 정보를 따릅니다</small></h3>
      <div class="km-classes">${Array.from({ length: n }, (_, i) => i + 1).map(c => { const ss = byClass(g, c); return `<section class="card km-class">
        <div class="km-class-h"><h4>${g}학년 ${c}반</h4><span>${ss.length}명</span></div>
        <table class="tbl km-table"><thead><tr><th class="no">번호</th><th>이름</th><th>부모 출신국</th><th>구분</th><th></th></tr></thead><tbody>
        ${ss.map(s => `<tr data-id="${s.id}"><td class="no"><input type="number" min="0" max="99" data-f="no" value="${s.no || ''}"></td>
          <td><input data-f="name" maxlength="20" value="${esc(s.name)}"></td>
          <td><input data-f="country" maxlength="30" list="kmCountryList" value="${esc(s.country || '')}"></td>
          <td>${typeSel(s.type, 'data-f="type"')}</td>
          <td><button type="button" class="btn small" data-del="${s.id}" title="삭제">삭제</button></td></tr>`).join('')}
        <tr class="km-new" data-g="${g}" data-c="${c}"><td class="no"><input type="number" min="0" max="99" data-n="no" placeholder="번호"></td>
          <td><input data-n="name" maxlength="20" placeholder="이름"></td>
          <td><input data-n="country" maxlength="30" list="kmCountryList" placeholder="예: 베트남"></td>
          <td>${typeSel('foreign', 'data-n="type"')}</td>
          <td><button type="button" class="btn small primary" data-add>추가</button></td></tr>
        </tbody></table></section>`; }).join('')}</div>
      <datalist id="kmCountryList">${(window.SchoolStatus?.countries || []).map(c => `<option value="${c}">`).join('')}</datalist>
      <p class="hint km-note">이름 칸 등에서 고치면 바로 저장됩니다. 저장할 때마다 이주배경학생 현황이 다시 계산됩니다.</p>`;
  }

  /* ---------- 저장 + 현황 다시 계산 ---------- */
  const clean = o => ({ grade: o.grade, cls: o.cls, no: Math.max(0, Math.min(99, Number(o.no) || 0)), name: String(o.name || '').trim().slice(0, 20),
    country: String(o.country || '').trim().slice(0, 30), type: TYPE_L[o.type] ? o.type : 'foreign', updatedBy: Cloud.email, updatedAt: Cloud.fb.F.serverTimestamp() });

  /** 명부 → config/migrant (외국인가정·국내출생·중도입국 인원, 비이주배경 = 전체 학생 − 이주배경, 부모 출신국 비율) */
  async function syncSummary(rows) {
    const { F, db } = Cloud.fb;
    const ref = F.doc(db, 'config', 'migrant');
    const cur = (await F.getDoc(ref)).data() || {};
    const n = t => rows.filter(s => s.type === t).length;
    const mig = rows.length, total = window.SchoolStatus?.totalStudents() || 0;
    const tally = {};
    rows.forEach(s => { const k = (s.country || '').trim(); if (k) tally[k] = (tally[k] || 0) + 1; });
    const countries = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / mig * 100)}`).join(', ').slice(0, 600);
    const d = new Date();
    await F.setDoc(ref, { asOf: `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`, foreign: n('foreign'), domestic: n('domestic'), midEntry: n('mid'),
      nonMigrant: Math.max(0, total - mig), countries, note: cur.note || '', updatedBy: Cloud.email, updatedAt: F.serverTimestamp() });
  }
  const say = t => { $('kmStatus').textContent = t; };
  async function afterChange(msg) {
    try { await syncSummary(list); say(msg + ' 이주배경학생 현황에 반영했습니다.'); }
    catch (e) { say(msg + ' (현황 반영 실패: ' + e.message + ')'); }
  }

  async function addRow(tr) {
    const v = k => tr.querySelector(`[data-n="${k}"]`).value;
    if (!v('name').trim()) { say('이름을 입력하세요.'); tr.querySelector('[data-n="name"]').focus(); return; }
    const row = clean({ grade: Number(tr.dataset.g), cls: Number(tr.dataset.c), no: v('no'), name: v('name'), country: v('country'), type: v('type') });
    try {
      const ref = await Cloud.fb.F.addDoc(col(), row);
      list = [...list.filter(s => s.id !== ref.id), { id: ref.id, ...row }];
      await afterChange(`${row.grade}학년 ${row.cls}반 ${row.name} 학생을 등록했습니다.`);
      setTimeout(() => document.querySelector(`.km-new[data-g="${row.grade}"][data-c="${row.cls}"] [data-n="no"]`)?.focus(), 50);
    } catch (e) { say('등록 실패: ' + e.message); }
  }
  async function updateRow(id, field, value) {
    const s = list.find(x => x.id === id); if (!s) return;
    const row = clean({ ...s, [field]: value });
    if (!row.name) { say('이름은 비울 수 없습니다.'); return; }
    try {
      await Cloud.fb.F.setDoc(Cloud.fb.F.doc(col(), id), row);
      Object.assign(s, row);
      await afterChange('저장했습니다.');
    } catch (e) { say('저장 실패: ' + e.message); }
  }
  async function removeRow(id) {
    const s = list.find(x => x.id === id); if (!s) return;
    if (!confirm(`${s.grade}학년 ${s.cls}반 ${s.name} 학생을 명단에서 삭제할까요?`)) return;
    try { await Cloud.fb.F.deleteDoc(Cloud.fb.F.doc(col(), id)); list = list.filter(x => x.id !== id); await afterChange('삭제했습니다.'); }
    catch (e) { say('삭제 실패: ' + e.message); }
  }

  $('kmViews').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { view = b.dataset.view; say(''); render(); } });
  $('kmMain').addEventListener('click', e => {
    const go = e.target.closest('[data-go-grade]'); if (go) { view = go.dataset.goGrade; render(); return; }
    if (e.target.closest('[data-add]')) { addRow(e.target.closest('tr')); return; }
    const del = e.target.closest('[data-del]'); if (del) removeRow(del.dataset.del);
  });
  $('kmMain').addEventListener('change', e => { const f = e.target.dataset.f, tr = e.target.closest('tr[data-id]'); if (f && tr) updateRow(tr.dataset.id, f, e.target.value); });
  $('kmMain').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.km-new')) { e.preventDefault(); addRow(e.target.closest('.km-new')); } });

  RENDER.kmig = () => { refreshNav(); render(); };
  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('kclass-change', () => { const was = unsub; if (!was && canUse()) subscribe(); refreshNav(); });
  if (window.Cloud && Cloud.ready) subscribe();
})();
