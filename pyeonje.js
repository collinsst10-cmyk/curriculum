/* =========================================================
 * 교육과정 편성 › ⑤ 시수 편제 (스쿨마스터 '교육과정 편제'와 같은 기능)
 *  - 창체 영역별 시수 편성 여부 (state.chaMode: 'part' | 'total')
 *  - 시수편성오류점검 · 전학년 시수초기화 · 학년 시수 편성하기(1~6학년)
 *  - 창체 활동별 기준시수 설정 (state.chaStd[학년군])
 *  - 학년별 수업 시수 편제 현황 표
 *  - 교육과정 편제표(올해) · 작년시수 편제표 · 작년편제 불러오기
 *    작년 자료: 이 문서의 학년도별 사본(state.yearArchive) → 없으면 클라우드의 작년 교육과정 문서
 * ========================================================= */
(function () {
  'use strict';
  const COLS = [['kor', '국어'], ['soc', '사회'], ['mor', '도덕'], ['math', '수학'], ['sci', '과학'], ['prac', '실과'], ['pe', '체육'], ['mus', '음악'],
    ['art', '미술'], ['eng', '영어'], ['bar', '바생'], ['sul', '슬생'], ['jul', '즐생']];
  let out = '';            // 아래 결과 영역: '' | 'check' | 'std' | 'table' | 'prev'
  let tableGrade = 0;      // 편제표: 0 = 전학년
  const jclone = o => JSON.parse(JSON.stringify(o));
  const ro = () => isTeacherView() || (App.locked && App.locked());
  const hasKey = (g, k) => bandOf(g).groups.some(gr => gr.subs.some(s => s.key === k));

  /* ---------- 작년 자료 ---------- */
  async function prevYearData() {
    const y = Number(state.school.year) - 1;
    const a = state.yearArchive && state.yearArchive[y];
    if (a && a.hours) return { ...a, from: `이 문서의 ${y}학년도 기록`, year: y };
    if (window.Cloud && Cloud.ready && Cloud.listPlans) {
      const plans = (await Cloud.listPlans()).filter(p => Number(p.year) === y);
      for (const p of plans) {
        try { const s = JSON.parse(p.stateJson || '{}'); if (s.hours) return { hours: s.hours, satName: s.satName || {}, chaMode: s.chaMode || 'part', classes: s.school && s.school.classes, from: `'${p.title || '교육과정'}' (${y}학년도)`, year: y }; } catch (e) { /* 다음 */ }
      }
    }
    return null;
  }
  /** 다른 해 시수로 잠깐 바꿔 그리기 (편제표 계산 함수가 state를 읽기 때문) */
  function withHours(data, fn) {
    const keep = { hours: state.hours, satName: state.satName, chaMode: state.chaMode, classes: state.school.classes };
    try {
      state.hours = data.hours; state.satName = data.satName || {}; state.chaMode = data.chaMode;
      if (data.classes) state.school.classes = data.classes;
      return fn();
    } finally { state.hours = keep.hours; state.satName = keep.satName; state.chaMode = keep.chaMode; state.school.classes = keep.classes; }
  }

  /* ---------- 화면 ---------- */
  function renderPanel() {
    const box = $('pjPanel'); if (!box) return;
    const y = Number(state.school.year), mode = state.chaMode === 'total' ? 'total' : 'part';
    const issues = collectIssues().filter(([lv]) => lv !== 'ok');
    const errN = issues.filter(([lv]) => lv === 'err').length;
    const cell = (g, k) => hasKey(g, k) ? `<td class="${ann(g, k) ? '' : 'zero'}">${ann(g, k)}</td>` : '<td class="na"></td>';
    box.innerHTML = `<div class="pj-top">
        <fieldset class="pj-box"><legend>창체 영역별 시수 편성 여부</legend>
          <label><input type="radio" name="pjCha" value="part" ${mode === 'part' ? 'checked' : ''}> 영역별 시수 편성</label>
          <label><input type="radio" name="pjCha" value="total" ${mode === 'total' ? 'checked' : ''}> 영역별 시수 편성 안함</label></fieldset>
        <button type="button" class="btn pj-check${errN ? ' bad' : ''}" data-pj="check">시수편성오류점검${issues.length ? ` <b>${issues.length}</b>` : ''}</button>
        <fieldset class="pj-box pj-print"><legend>교육과정 편제표</legend>
          <select id="pjTableGrade" aria-label="편제표 학년"><option value="0">전학년</option>${GRADES.map(g => `<option value="${g}" ${g === tableGrade ? 'selected' : ''}>${g}학년</option>`).join('')}</select>
          <button type="button" class="btn pj-red" data-pj="table">교육과정 편제표 (${y})</button>
          <button type="button" class="btn pj-red" data-pj="prev">작년시수 편제표 (${y - 1})</button></fieldset>
      </div>
      <div class="pj-mid">
        <fieldset class="pj-box pj-grades"><legend>학년 시수 편성하기</legend>
          ${GRADES.map(g => `<button type="button" class="pj-g${g === curGrade ? ' on' : ''}" data-pjg="${g}">${g}학년</button>`).join('')}</fieldset>
        <div class="pj-tools">
          <button type="button" class="btn" data-pj="reset">전학년 시수초기화</button>
          <button type="button" class="btn pj-std" data-pj="std">창체 활동별 기준시수 설정</button>
          <button type="button" class="btn pj-load" data-pj="load">작년편제 불러오기</button>
        </div>
      </div>
      <h3 class="pj-h">《 학년별 수업 시수 편제 현황 》</h3>
      <div class="tbl-scroll"><table class="pj-grid"><thead><tr><th></th>${COLS.map(([, l]) => `<th>${l}</th>`).join('')}<th>창체</th><th title="학교자율시간">자율</th><th class="tot">총계</th></tr></thead><tbody>
        ${GRADES.map(g => `<tr class="${g === curGrade ? 'cur' : ''}" data-pjg="${g}" title="눌러서 ${g}학년 시수 편성"><th>${g}학년</th>${COLS.map(([k]) => cell(g, k)).join('')}
          <td>${chaTotal(g)}</td><td class="${g < 3 ? 'na' : ''}">${g < 3 ? '' : ann(g, 'sat') + ann(g, 'satB')}</td><td class="tot">${gradeTotal(g)}</td></tr>`).join('')}
      </tbody></table></div>
      <div id="pjOut" class="pj-out">${outHtml()}</div>`;
    if (out === 'table' || out === 'prev') fillTable();   // 편제표가 열려 있으면 다시 채움
  }

  function outHtml() {
    if (out === 'check') {
      const list = collectIssues();
      const bad = list.filter(([lv]) => lv !== 'ok');
      return `<div class="pj-card"><div class="pj-card-h"><b>시수편성오류점검</b><button type="button" class="x" data-pj="close">✕</button></div>
        ${bad.length ? `<ul class="pj-issues">${bad.map(([lv, m]) => `<li class="${lv}"><span>${lv === 'err' ? '오류' : '확인'}</span>${esc(m)}</li>`).join('')}</ul>`
          : '<p class="pj-ok">오류가 없습니다. 모든 학년의 시수 편성이 기준에 맞습니다.</p>'}</div>`;
    }
    if (out === 'std') {
      return `<div class="pj-card"><div class="pj-card-h"><b>창체 활동별 기준시수 설정</b><button type="button" class="x" data-pj="close">✕</button></div>
        <p class="hint">학년군(2개 학년) 기준 시수입니다. 바꾸면 '시수초기화'와 학년 편성 화면의 기준값에 쓰입니다.</p>
        <table class="pj-std-tbl"><thead><tr><th>학년군</th>${CHA_PARTS.map(p => `<th>${p.name}</th>`).join('')}<th>합계</th><th>학년군 기준</th></tr></thead><tbody>
        ${BANDS.map(b => { const s = chaStdOf(b), sum = CHA_PARTS.reduce((t, p) => t + Number(s[p.key] || 0), 0);
          return `<tr><th>${b.label}</th>${CHA_PARTS.map(p => `<td><input type="number" min="0" max="999" data-std="${b.id}" data-k="${p.key}" value="${s[p.key]}"></td>`).join('')}
            <td class="${sum === b.cha / 2 ? '' : 'warn'}"><b>${sum}</b><small> (학년당)</small></td><td>${b.cha}<small> (2개 학년)</small></td></tr>`; }).join('')}
        </tbody></table>
        <div class="row"><button type="button" class="btn small" data-pj="std-reset">교육과정 기본값으로</button>
          <button type="button" class="btn small primary" data-pj="std-apply">이 기준을 전 학년 창체 시수에 적용</button></div></div>`;
    }
    if (out === 'table' || out === 'prev') return `<div class="pj-card"><div class="pj-card-h"><b id="pjTblTitle"></b><span class="row">
        <button type="button" class="btn small" data-pj="print">인쇄</button><button type="button" class="btn small" data-pj="xls">엑셀 저장</button>
        <button type="button" class="x" data-pj="close">✕</button></span></div><div id="pjTbl" class="pj-tbl">불러오는 중…</div></div>`;
    return '';
  }

  /** 편제표 HTML (전학년 또는 그 학년이 속한 학년군만) */
  function tableHtml(data) {
    const html = data ? withHours(data, () => pyeonjeHtml(true)) : pyeonjeHtml(true);
    if (!tableGrade) return html;
    const label = bandOf(tableGrade).label, div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('.card').forEach(c => { if (!c.querySelector('h2')?.textContent.includes(label)) c.remove(); });
    return div.innerHTML;
  }
  let lastTable = { title: '', html: '' };
  async function fillTable() {
    if (out !== 'table' && out !== 'prev') return;
    const y = Number(state.school.year), which = tableGrade ? `${tableGrade}학년` : '전학년';
    if (out === 'table') {
      lastTable = { title: `${y}학년도 교육과정 편제표 (${which})`, html: tableHtml(null) };
    } else {
      let d = null;
      try { d = await prevYearData(); } catch (e) { /* 아래에서 안내 */ }
      lastTable = d ? { title: `${d.year}학년도 시수 편제표 (${which}) · ${d.from}`, html: tableHtml(d) }
        : { title: `${y - 1}학년도 시수 편제표`, html: `<p class="hint">${y - 1}학년도 시수 편제 자료가 없습니다. 이 사이트에서 ${y - 1}학년도에 편성한 자료가 있으면 여기 나옵니다.</p>` };
    }
    if ($('pjTblTitle')) { $('pjTblTitle').textContent = lastTable.title; $('pjTbl').innerHTML = lastTable.html; }
  }

  /* ---------- 동작 ---------- */
  function setChaMode(mode) {
    const cur = state.chaMode === 'total' ? 'total' : 'part';
    if (mode === cur) return;
    GRADES.forEach(g => {
      const h = state.hours[g]; if (!h) return;
      if (mode === 'total') {
        ['s1', 's2'].forEach(s => { h.cha_auto[s] = CHA_PARTS.reduce((t, p) => t + (Number(h[p.key]?.[s]) || 0), 0); });
        ['cha_club', 'cha_career'].forEach(k => { h[k] = { s1: 0, s2: 0 }; });
      } else {
        // 다시 영역별로: 기준 시수 비율대로 나눔
        const std = chaStdOf(bandOf(g)), tot = CHA_PARTS.reduce((t, p) => t + Number(std[p.key] || 0), 0) || 1;
        ['s1', 's2'].forEach(s => {
          const all = Number(h.cha_auto[s]) || 0; let left = all;
          CHA_PARTS.forEach((p, i) => { const v = i === CHA_PARTS.length - 1 ? left : Math.round(all * std[p.key] / tot); h[p.key] = h[p.key] || {}; h[p.key][s] = v; left -= v; });
        });
      }
    });
    state.chaMode = mode; save(); renderHours();
  }

  async function loadPrev() {
    let d = null;
    try { d = await prevYearData(); } catch (e) { alert('작년 자료를 찾지 못했습니다: ' + e.message); return; }
    const y = Number(state.school.year) - 1;
    if (!d) { alert(`${y}학년도 시수 편제 자료가 없습니다.\n(이 사이트에서 ${y}학년도에 편성한 자료가 있으면 불러올 수 있습니다.)`); return; }
    if (!confirm(`${d.from}의 시수 편제를 불러올까요?\n지금 ${state.school.year}학년도 시수는 바뀝니다.`)) return;
    GRADES.forEach(g => { state.hours[g] = Object.assign(defaultHours(g), jclone(d.hours[g] || {})); state.satName[g] = (d.satName || {})[g] || ''; });
    state.chaMode = d.chaMode || 'part';
    save(); out = ''; renderHours();
  }

  function printTable() {
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 막혀 인쇄 창을 열 수 없습니다.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(lastTable.title)}</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;padding:16px} h2{font-size:16px} table{border-collapse:collapse;width:100%;margin-bottom:16px} td,th{border:1px solid #888;padding:4px 6px;text-align:center;font-size:12px} th{background:#eef2f7}</style>
      </head><body><h1 style="font-size:18px">${esc(state.school.name)} ${esc(lastTable.title)}</h1>${lastTable.html}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  document.addEventListener('click', e => {
    if (curTab !== 'hours' || !e.target.closest('#pjPanel')) return;
    const g = e.target.closest('[data-pjg]');
    if (g) { curGrade = Number(g.dataset.pjg); renderHours(); if (window.PjGrade) PjGrade.open(curGrade); return; }
    const a = e.target.closest('[data-pj]')?.dataset.pj; if (!a) return;
    if (a === 'close') { out = ''; renderPanel(); return; }
    if (a === 'check' || a === 'std') { out = out === a ? '' : a; renderPanel(); return; }
    if (a === 'table' || a === 'prev') { out = a; renderPanel(); return; }
    if (a === 'print') { printTable(); return; }
    if (a === 'xls') { downloadXls(`${fileBase()}_${lastTable.title.replace(/[\\/:*?"<>|·()]/g, '').replace(/\s+/g, '_')}.xls`, lastTable.html); return; }
    if (ro()) return;
    if (a === 'reset') {
      if (!confirm('전 학년의 시수를 교육과정 기준 시수로 되돌릴까요? 지금 입력한 시수는 사라집니다.')) return;
      GRADES.forEach(x => { state.hours[x] = defaultHours(x); });
      if (state.chaMode === 'total') { state.chaMode = 'part'; setChaMode('total'); return; }
      save(); renderHours(); return;
    }
    if (a === 'load') { loadPrev(); return; }
    if (a === 'std-reset') { delete state.chaStd; save(); renderHours(); return; }
    if (a === 'std-apply') {
      if (!confirm('이 기준 시수를 전 학년의 창체 시수(1·2학기)에 적용할까요?')) return;
      GRADES.forEach(x => { const s = chaStdOf(bandOf(x)); CHA_PARTS.forEach(p => { state.hours[x][p.key] = split(Number(s[p.key]) || 0); }); });
      if (state.chaMode === 'total') { state.chaMode = 'part'; setChaMode('total'); return; }
      save(); renderHours(); return;
    }
  });
  document.addEventListener('change', e => {
    if (curTab !== 'hours' || !e.target.closest('#pjPanel')) return;
    if (e.target.id === 'pjTableGrade') { tableGrade = Number(e.target.value); fillTable(); return; }
    if (ro()) { renderPanel(); return; }
    if (e.target.name === 'pjCha') {
      const msg = e.target.value === 'total' ? '창체를 영역 구분 없이 합계로만 편성할까요? (세 영역 시수가 하나로 합쳐집니다)' : '창체를 영역별로 나눠 편성할까요? (합계를 기준 시수 비율로 나눕니다)';
      if (!confirm(msg)) { renderPanel(); return; }
      setChaMode(e.target.value); return;
    }
    const sd = e.target.dataset;
    if (sd.std) {
      const b = BANDS.find(x => x.id === sd.std);
      state.chaStd = state.chaStd || {};
      state.chaStd[b.id] = { ...chaStdOf(b), [sd.k]: Math.max(0, Number(e.target.value) || 0) };
      save(); renderPanel();
    }
  });

  // 기존 시수 화면을 그릴 때마다 위 편제 패널도 함께
  const base = renderHours;
  renderHours = function () { base(); renderPanel(); };
  RENDER.hours = renderHours;
})();
