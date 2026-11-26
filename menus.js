/* =========================================================
 * 화면 구성
 *  - 학사일정 보기(hview): 모든 선생님용 조회 화면
 *  - 교육과정 편성 ① 학사일정(cal): 학교 정보 + 학기·방학 + 휴업일 + 수업일수·주차
 *  - 교육과정 편성 ② 교내행사(event)
 *  - 교육과정 편성 ③ 시수 배정(hours): 시수 + 교시·수업 가능 시수 + 편제표·검토
 * ========================================================= */
(function () {
  'use strict';
  const e2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const acts = () => (window.Activities ? Activities.items : {});
  const AREA = { cha_auto: '자율·자치', cha_club: '동아리', cha_career: '진로' };

  /* ---------- 화면 묶기 ---------- */
  const daysAndWeeks = RENDER.days;          // 수업일수(월별·요일별)
  const hoursOnly = RENDER.hours;
  RENDER.cal = () => { renderInfo(); renderCal(); daysAndWeeks(); syncHolidays(); };
  RENDER.hours = () => { renderInfo(); hoursOnly(); daysAndWeeks(); };
  RENDER.review = renderTable;
  RENDER.hview = renderHview;
  RENDER.school = renderInfo;
  RENDER.event = renderEvent;

  /** 연속된 같은 일정(예: 여름방학 30일)을 하나의 기간으로 묶음 */
  function ranges(filter) {
    const out = [];
    computeYear().forEach(x => {
      if (!filter(x)) return;
      const last = out[out.length - 1];
      const key = x.type + '|' + x.name;
      if (last && last.key === key && fmt(addDays(parse(last.end), 1)) === x.ds) last.end = x.ds;
      else if (last && last.key === key && x.type === 'vacation' && parse(x.ds) - parse(last.end) <= 3 * 86400000) last.end = x.ds;   // 주말 끼어도 이어서
      else out.push({ key, type: x.type, name: x.name, start: x.ds, end: x.ds, ev: x.ev });
    });
    return out;
  }
  const rangeLabel = r => r.start === r.end ? fmtK(r.start) : `${fmtK(r.start)} ~ ${fmtK(r.end)}`;
  const typeLabel = t => t === 'event' ? '교내행사' : t === 'school' ? '수업일 지정' : TYPE_LABEL[t];

  /* =========================================================
   * 학사일정 보기 (조회 전용)
   * ========================================================= */
  function renderHview() {
    const days = computeYear(), today = fmt(new Date()), A = acts();
    let html = '';
    for (let i = 0; i < 12; i++) {
      const y = state.school.year + (i >= 10 ? 1 : 0), m = (2 + i) % 12;
      const list = days.filter(x => x.year === y && x.month === m);
      html += `<div class="month"><div class="month-head">${y}년 ${m + 1}월<span>수업일 ${list.filter(x => x.isSchool).length}일</span></div><div class="mgrid">`;
      html += WD.map(w => `<div class="dow">${w}</div>`).join('');
      for (let k = 0; k < list[0].dow; k++) html += '<div class="day empty"></div>';
      list.forEach(x => {
        const al = (A[x.ds] || []).filter(t => t.status !== 'canceled');
        const tip = `${x.ds} ${TYPE_LABEL[x.type]}${x.name ? ' · ' + x.name : ''}` + al.map(t => `\n· ${t.kind} ${t.title} (${t.status === 'confirmed' ? '확정' : '신청'})`).join('');
        html += `<div class="day ${x.type}${x.ds === today ? ' today' : ''}" title="${e2(tip)}"><span class="d">${x.d.getDate()}</span>${al.length ? `<span class="acts ${al.some(t => t.status === 'confirmed') ? 'c' : ''}">${al.length}</span>` : ''}<span class="n">${e2(x.name || (al[0] ? al[0].title : ''))}</span></div>`;
      });
      html += '</div></div>';
    }
    $('hvGrid').innerHTML = html;
  }

  /* =========================================================
   * 교내행사 (관리자)
   * ========================================================= */
  let evEditing = null;   // { start, end } 수정 중인 행사 기간

  function eventRanges() {
    const cd = calDays();
    const keys = Object.keys(cd).filter(ds => cd[ds].type === 'event').sort();
    const out = [];
    keys.forEach(ds => {
      const v = cd[ds], sig = JSON.stringify([v.name, v.hrs || 0, v.grades || [], v.area || '']);
      const last = out[out.length - 1];
      if (last && last.sig === sig && (parse(ds) - parse(last.end)) <= 3 * 86400000) last.end = ds;
      else out.push({ sig, start: ds, end: ds, name: v.name, hrs: v.hrs || 0, grades: v.grades || [], area: v.area || 'cha_auto' });
    });
    return out;
  }

  function renderEventForm() {
    const hrs = Number((document.querySelector('input[name="evHours"]:checked') || {}).value || 0);
    $('evHours').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(h => `<label class="tg"><input type="radio" name="evHours" value="${h}" ${h === hrs ? 'checked' : ''}>${h ? `${h}교시까지` : '표시만'}</label>`).join('');
    const gs = [...document.querySelectorAll('#evGrades input[value]:checked')].map(i => Number(i.value));
    const all = !gs.length || gs.length === 6;
    $('evGrades').innerHTML = `<label class="tg"><input type="checkbox" id="evAllGrades" ${all ? 'checked' : ''}>전교</label>` +
      GRADES.map(g => `<label class="tg"><input type="checkbox" value="${g}" ${!all && gs.includes(g) ? 'checked' : ''}>${g}학년</label>`).join('');
  }

  function evForm() {
    const start = $('evStart').value, end = $('evEnd').value && $('evEnd').value >= start ? $('evEnd').value : start;
    const gs = [...document.querySelectorAll('#evGrades input[value]:checked')].map(i => Number(i.value));
    return {
      start, end, name: $('evName').value.trim(),
      hrs: Number((document.querySelector('input[name="evHours"]:checked') || {}).value || 0),
      grades: $('evAllGrades') && $('evAllGrades').checked ? [] : gs,
      area: (document.querySelector('input[name="evArea"]:checked') || {}).value || 'cha_auto',
    };
  }

  function renderEvCheck() {
    const f = evForm(), box = $('evCheck'), msgs = [];
    if (!f.start) { box.innerHTML = '<div class="hint">날짜를 고르세요.</div>'; $('evSave').disabled = true; return; }
    const days = computeYear().filter(x => x.ds >= f.start && x.ds <= f.end);
    const off = days.filter(x => !x.isSchool && x.type !== 'weekend');
    if (off.length) msgs.push(`<div class="ck warn">⚠ 수업일이 아닌 날이 있습니다: ${off.map(x => `${fmtK(x.ds)} ${TYPE_LABEL[x.type]}`).join(', ')} (그날은 행사로 계산되지 않음)</div>`);
    // 이미 신청된 교육활동과 겹침(관리자는 등록 가능, 알림)
    if (f.hrs) {
      const ps = Array.from({ length: f.hrs }, (_, i) => i + 1), gs = f.grades.length ? f.grades : GRADES;
      const hit = Object.values(acts()).flat().filter(t => t.status !== 'canceled' && t.date >= f.start && t.date <= f.end
        && t.periods.some(p => ps.includes(p)) && t.targets.some(c => gs.includes(Number(c.split('-')[0]))));
      if (hit.length) msgs.push(`<div class="ck warn"><b>⚠ 이미 신청된 교육활동과 시간이 겹칩니다.</b>${hit.map(t => `<div>· ${fmtK(t.date)} ${t.periods.join('·')}교시 ${e2(t.title)} (${e2(t.ownerName || '')})</div>`).join('')}<div class="hint">등록은 되지만, 해당 선생님과 일정을 조정하세요.</div></div>`);
    }
    if (!f.name) msgs.push('<div class="hint">행사명을 입력하세요.</div>');
    if (f.name && !msgs.some(m => m.includes('ck warn'))) msgs.unshift(`<div class="ck ok">✅ ${f.start === f.end ? fmtK(f.start) : `${fmtK(f.start)} ~ ${fmtK(f.end)}`} · ${f.hrs ? `1~${f.hrs}교시` : '표시만'} · ${f.grades.length ? f.grades.join('·') + '학년' : '전교'}</div>`);
    box.innerHTML = msgs.join('');
    $('evSave').disabled = !f.name || !canEditCal();
    $('evSave').textContent = evEditing ? '수정 저장' : '교내행사 등록';
    $('evFormTitle').textContent = evEditing ? '교내행사 수정' : '교내행사 등록';
  }

  function renderEvent() {
    renderEventForm();
    const list = eventRanges();
    $('evListTitle').textContent = `교내행사 (${list.length}건)`;
    $('evList').innerHTML = `<tr><th>날짜</th><th class="l">행사명</th><th>시간</th><th>대상</th><th>창체</th><th></th></tr>` +
      (list.length ? list.map(r => `<tr><td class="num">${rangeLabel(r)}</td><td class="l"><b>${e2(r.name)}</b></td>
        <td>${r.hrs ? `1~${r.hrs}교시` : '<span class="hint">표시만</span>'}</td><td>${r.grades.length ? r.grades.join('·') + '학년' : '전교'}</td>
        <td class="hint">${r.hrs ? AREA[r.area] || '' : ''}</td>
        <td class="nowrap"><button class="btn small" data-ev="edit" data-s="${r.start}" data-e="${r.end}">수정</button>
        <button class="btn small danger" data-ev="del" data-s="${r.start}" data-e="${r.end}">삭제</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="hint">등록된 교내행사가 없습니다. 오른쪽에서 등록하세요.</td></tr>');
    const al = Object.values(acts()).flat().filter(t => t.kind === '교내행사' && t.status !== 'canceled').sort((a, b) => a.date.localeCompare(b.date));
    $('evActList').innerHTML = `<tr><th>날짜</th><th class="l">교육활동명</th><th>교시</th><th>상태</th><th>기록자</th></tr>` +
      (al.length ? al.map(t => `<tr><td class="num">${fmtK(t.date)}</td><td class="l">${e2(t.title)}</td><td>${t.periods.join('·')}</td>
        <td><span class="st ${t.status}">${t.status === 'confirmed' ? '확정' : '신청'}</span></td><td class="hint">${e2(t.ownerName || '')}</td></tr>`).join('')
        : '<tr><td colspan="5" class="hint">없음</td></tr>');
    renderEvCheck();
  }

  function datesBetween(a, b) { const out = []; for (let d = parse(a); fmt(d) <= b; d = addDays(d, 1)) out.push(fmt(d)); return out; }

  async function saveEvent() {
    if (!canEditCal()) { alert('관리자만 수정할 수 있습니다.'); return; }
    const f = evForm();
    if (!f.start || !f.name) return;
    const patch = {};
    if (evEditing) datesBetween(evEditing.start, evEditing.end).forEach(ds => { if ((calDays()[ds] || {}).type === 'event') patch[ds] = null; });
    datesBetween(f.start, f.end).forEach(ds => {
      patch[ds] = f.hrs ? { type: 'event', name: f.name, hrs: f.hrs, area: f.area, grades: f.grades } : { type: 'event', name: f.name };
    });
    try { await writeDays(patch); resetEventForm(); _yearCache = null; renderEvent(); }
    catch (err) { alert('저장 실패: ' + err.message); }
  }

  function resetEventForm() {
    evEditing = null;
    $('evStart').value = ''; $('evEnd').value = ''; $('evName').value = '';
    document.querySelectorAll('input[name="evHours"]').forEach(i => { i.checked = i.value === '0'; });
    document.querySelectorAll('#evGrades input').forEach(i => { i.checked = i.id === 'evAllGrades'; });
    renderEventForm(); renderEvCheck();
  }

  function loadEvent(start, end) {
    const v = calDays()[start]; if (!v) return;
    evEditing = { start, end };
    $('evStart').value = start; $('evEnd').value = end === start ? '' : end; $('evName').value = v.name || '';
    document.querySelectorAll('input[name="evHours"]').forEach(i => { i.checked = Number(i.value) === (v.hrs || 0); });
    const gs = v.grades || [];
    document.querySelectorAll('#evGrades input[value]').forEach(i => { i.checked = gs.includes(Number(i.value)); });
    $('evAllGrades').checked = !gs.length;
    document.querySelectorAll('input[name="evArea"]').forEach(i => { i.checked = i.value === (v.area || 'cha_auto'); });
    renderEventForm(); renderEvCheck();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('evList').addEventListener('click', async e => {
    const b = e.target.closest('[data-ev]'); if (!b) return;
    if (b.dataset.ev === 'edit') { loadEvent(b.dataset.s, b.dataset.e); return; }
    if (!canEditCal()) return;
    const name = (calDays()[b.dataset.s] || {}).name || '';
    if (!confirm(`교내행사 "${name}"을(를) 학사일정에서 삭제할까요?`)) return;
    const patch = {}; datesBetween(b.dataset.s, b.dataset.e).forEach(ds => { if ((calDays()[ds] || {}).type === 'event') patch[ds] = null; });
    try { await writeDays(patch); if (evEditing && evEditing.start === b.dataset.s) resetEventForm(); _yearCache = null; renderEvent(); }
    catch (err) { alert('삭제 실패: ' + err.message); }
  });
  $('evSave').addEventListener('click', saveEvent);
  $('evReset').addEventListener('click', resetEventForm);
  ['evStart', 'evEnd', 'evName'].forEach(id => $(id).addEventListener('input', renderEvCheck));
  $('evHours').addEventListener('change', renderEvCheck);
  $('evArea').addEventListener('change', renderEvCheck);
  $('evGrades').addEventListener('change', e => {
    if (e.target.id === 'evAllGrades') { if (e.target.checked) document.querySelectorAll('#evGrades input[value]').forEach(i => { i.checked = false; }); }
    else $('evAllGrades').checked = ![...document.querySelectorAll('#evGrades input[value]:checked')].length;
    renderEvCheck();
  });
})();
