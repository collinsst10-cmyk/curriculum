/* =========================================================
 * 시수 편제 › 학년 편제 창 (스쿨마스터 '교육과정 편제 - N학년' 창)
 *  - 학년군(2개 학년) 기준시수 · 편성시수 · 증감시수 · 증감비율, 학년별 1·2학기 시수 입력
 *  - 창의적 체험활동(영역별/합계), 학교자율시간 A·B(과목명), 학년군 총 수업시간 수, 학년당 수업시수, 학기당 과목 수
 *  - 작년 편제 불러오기 · 초기화(이 학년군) · 학기별 수업일수에 비례해서 나누기
 *  - 오른쪽: 시수 편성 방법 / 시수 확보 현황(확보 − 편제)
 *  배경이 빨간 칸 = 기준을 벗어남(반드시 고칠 것), 글자색 빨강·파랑 = 기본값보다 많음·적음(괜찮음)
 * ========================================================= */
(function () {
  'use strict';
  let curG = 1, sideTab = 'how';
  const dlg = () => $('pjDlg');
  const ro = () => isTeacherView() || (App.locked && App.locked());
  const sgn = n => (n > 0 ? '+' : '') + n;
  const pct = r => (r > 0 ? '+' : '') + Math.round(r * 100) + '%';

  /** 학년 g 과목 k 의 기본(학기) 값 — 글자색 비교용 */
  function defOf(g, k, s) { const d = defaultHours(g)[k]; return d ? d[s] : 0; }
  function cellIn(g, k, s) {
    const v = hv(g, k, s), d = defOf(g, k, s), cls = v > d ? 'up' : v < d ? 'down' : '';
    return `<td class="pg-in ${cls}"><input inputmode="numeric" data-pg="${g}" data-k="${k}" data-s="${s}" value="${v}" ${ro() ? 'disabled' : ''}></td>`;
  }
  const subjCount = (g, s) => bandOf(g).groups.reduce((t, gr) => t + gr.subs.filter(x => hv(g, x.key, s) > 0).length, 0);

  function render() {
    const g = curG, b = bandOf(g), [ga, gb] = b.grades, chk = bandCheck(b), y = state.school.year;
    const total = state.chaMode === 'total';
    const four = k => [ga, gb].map(x => ['s1', 's2'].map(s => cellIn(x, k, s)).join('')).join('');
    const stat = (base, sum, diff, rate, level) => `<td class="pg-base">${base}</td><td class="pg-sum">${sum}</td>
      <td class="pg-d ${level}">${sgn(diff)}</td><td class="pg-d ${level}">${pct(rate)}</td>`;
    let rows = '';
    // 교과(군)
    b.groups.forEach((gr, gi) => {
      const c = chk.groups[gi], n = gr.subs.length;
      gr.subs.forEach((s, si) => {
        rows += `<tr>${gi === 0 && si === 0 ? `<th class="pg-cat" rowspan="${b.groups.reduce((t, x) => t + x.subs.length, 0)}">교과<br>(군)</th>` : ''}
          <th class="pg-name">${s.name}${n > 1 && si === 0 ? `<small>${gr.name}</small>` : ''}</th>
          ${si === 0 ? `<td class="pg-base" rowspan="${n}">${gr.base}</td><td class="pg-sum" rowspan="${n}">${c.sum}</td>
            <td class="pg-d ${c.level}" rowspan="${n}" title="${c.msg}">${sgn(c.diff)}</td><td class="pg-d ${c.level}" rowspan="${n}" title="${c.msg}">${pct(c.rate)}</td>` : ''}
          ${four(s.key)}</tr>`;
      });
    });
    // 창체
    const chaRate = (chk.cha.sum - b.cha) / b.cha;
    const chaSum = x => ['s1', 's2'].map(s => `<td class="pg-ro">${CHA_PARTS.reduce((t, p) => t + hv(x, p.key, s), 0)}</td>`).join('');
    rows += `<tr class="pg-gap"><td colspan="10"></td></tr>
      <tr><th class="pg-cat" rowspan="${total ? 1 : 4}">창의적<br>체험활동</th><th class="pg-name">${total ? '창체 (영역 구분 없음)' : '창체 합계'}</th>
        ${stat(b.cha, chk.cha.sum, chk.cha.diff, chaRate, chk.cha.level === 'ok' ? 'ok' : 'err')}
        ${total ? four('cha_auto') : [ga, gb].map(chaSum).join('')}</tr>
      ${total ? '' : CHA_PARTS.map(p => `<tr><th class="pg-name pg-sub" colspan="5">${p.name}</th>${four(p.key)}</tr>`).join('')}`;
    // 학교자율시간 A·B (3~6학년)
    const satRow = (key, label, nameKey) => {
      const can = ga >= 3;
      const sum = ann(ga, key) + ann(gb, key);
      return `<tr><th class="pg-name pg-sat" colspan="2">${label}
          ${can ? `<input class="pg-satname" data-satk="${nameKey}" maxlength="30" placeholder="과목·활동명" value="${esc((state[nameKey] || {})[ga] || '')}" ${ro() ? 'disabled' : ''}>` : '<small>3~6학년</small>'}</th>
        <td class="pg-base">-</td><td class="pg-sum">${sum}</td><td></td><td></td>
        ${can ? four(key) : '<td colspan="4" class="pg-na">해당 없음</td>'}</tr>`;
    };
    rows += `<tr class="pg-gap"><td colspan="10"></td></tr>${satRow('sat', '학교자율시간 A', 'satName')}${satRow('satB', '학교자율시간 B', 'satNameB')}`;
    // 합계
    const totRate = (chk.total.sum - b.total) / b.total;
    rows += `<tr class="pg-gap"><td colspan="10"></td></tr>
      <tr class="pg-total"><th class="pg-name" colspan="2">학년군별 총<br>수업시간 수</th>${stat(b.total, chk.total.sum, chk.total.diff, totRate, chk.total.level)}
        ${[ga, gb].map(x => ['s1', 's2'].map(s => `<td class="pg-tot">${gradeSem(x, s)}</td>`).join('')).join('')}</tr>
      <tr><th class="pg-name" colspan="6">학년당 수업시수</th>${[ga, gb].map(x => `<td class="pg-tot" colspan="2">${gradeTotal(x)}</td>`).join('')}</tr>
      <tr><th class="pg-name" colspan="6">학기당 과목 수</th>${[ga, gb].map(x => ['s1', 's2'].map(s => `<td class="pg-cnt">${subjCount(x, s)}</td>`).join('')).join('')}</tr>`;

    const cap = (x, s) => capacity(x, Number(s.slice(1)));
    const secure = [ga, gb].map(x => `<div class="pg-sec"><b>《 ${x}학년 》</b><table><thead><tr><th></th><th>확보</th><th>편제</th><th>편차</th></tr></thead><tbody>
      ${['s1', 's2'].map(s => { const c = cap(x, s), p = gradeSem(x, s), d = c - p; return `<tr><th>${s === 's1' ? 1 : 2}학기</th><td>${c}</td><td>${p}</td><td class="${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${sgn(d)}</td></tr>`; }).join('')}
      </tbody></table></div>`).join('');

    dlg().innerHTML = `<div class="pg-head">
        <h2>${y}학년도 ${esc(state.school.name || '')} 교육과정 편제 - ${ga}·${gb}학년 <small>(${b.label})</small></h2>
        <div class="pg-tools">
          <button type="button" class="btn small" data-pgact="prev">작년 편제 불러오기</button>
          <button type="button" class="btn small" data-pgact="reset">초기화</button>
          <button type="button" class="btn small" data-pgact="ratio">학기별 수업일수에 비례해서 나누기</button>
          <button type="button" class="x" data-pgact="close" title="닫기">✕</button>
        </div></div>
      <div class="pg-grades">${GRADES.map(x => `<button type="button" class="${bandOf(x) === b ? 'on' : ''}" data-pgg="${x}">${x}학년</button>`).join('')}<span class="hint">자동 저장됩니다</span></div>
      <div class="pg-body">
        <div class="pg-left"><div class="tbl-scroll"><table class="pg-tbl">
          <thead><tr><th colspan="2" rowspan="2">구 분</th><th rowspan="2">기준<br>시수</th><th rowspan="2">편성<br>시수</th><th rowspan="2">증감<br>시수</th><th rowspan="2">증감<br>비율</th>
            <th colspan="2" class="pg-yr">${ga}학년</th><th colspan="2" class="pg-yr">${gb}학년</th></tr>
            <tr><th>1학기</th><th>2학기</th><th>1학기</th><th>2학기</th></tr></thead>
          <tbody>${rows}</tbody></table></div></div>
        <div class="pg-right">
          <div class="pg-tabs"><button type="button" class="${sideTab === 'how' ? 'on' : ''}" data-pgtab="how">시수 편성 방법</button><button type="button" class="${sideTab === 'sec' ? 'on' : ''}" data-pgtab="sec">시수 확보 현황</button></div>
          ${sideTab === 'how' ? `<div class="pg-help">
            <h4>교육과정 시수 편제 방법</h4>
            <p>◆ 학교 실정에 맞게 흰색 칸의 시수를 고치면 됩니다.</p>
            <p class="red">◆ 입력한 시수가 교육부 기준에서 벗어나면 증감시수·증감비율 칸의 <b>배경색이 빨갛게</b> 바뀝니다.</p>
            <p>◆ 글자색이 <span class="up">빨강</span>·<span class="down">파랑</span>인 것은 기본값보다 많거나 적다는 뜻이라 괜찮지만, <b>배경색이 빨간 칸은 반드시 고쳐야 합니다.</b></p>
            <h4>교육과정 편성 유의사항</h4>
            <p>◆ 교과(군)별 및 창체는 20% 범위에서 시수 증감이 가능하지만, 체육·예술은 줄일 수 없고, 학년군별 총 수업시간 수는 기준보다 적으면 안 됩니다.</p>
            <h4>학교자율시간 편성 방법</h4>
            <p>◆ 학교자율 과목의 배당 시수를 흰 칸에 입력합니다. 과목(활동)명을 함께 적어 주세요. (3~6학년)</p>
            <p class="hint">'학기별 수업일수에 비례해서 나누기'는 과목마다 연간 시수를 그대로 두고 1·2학기 수업일수 비율로 다시 나눕니다.</p></div>`
            : `<div class="pg-secs">${secure}<p class="hint">확보: 학사일정·요일별 기준시수로 수업할 수 있는 시수<br>편제: 학교가 정한 시수 · 편차가 −이면 시간이 모자랍니다.</p></div>`}
        </div>
      </div>`;
  }

  function open(g) { curG = g; render(); if (!dlg().open) dlg().showModal(); }
  window.PjGrade = { open };

  /** 학기별 수업일수에 비례해서 나누기 (과목마다 연간 시수 유지) */
  function splitByDays() {
    const b = bandOf(curG), st = dayStats();
    b.grades.forEach(g => {
      const d1 = st.sem[1].days, d2 = st.sem[2].days;
      const r = d1 + d2 ? d1 / (d1 + d2) : 0.5;
      gradeKeys(g).forEach(k => {
        const a = ann(g, k), s1 = Math.round(a * r);
        state.hours[g][k] = { s1, s2: a - s1 };
      });
    });
  }

  document.addEventListener('click', async e => {
    if (!dlg() || !dlg().contains(e.target)) return;
    const gb = e.target.closest('[data-pgg]'); if (gb) { curG = Number(gb.dataset.pgg); render(); return; }
    const tb = e.target.closest('[data-pgtab]'); if (tb) { sideTab = tb.dataset.pgtab; render(); return; }
    const a = e.target.closest('[data-pgact]')?.dataset.pgact; if (!a) return;
    if (a === 'close') { dlg().close(); return; }
    if (ro()) return;
    const b = bandOf(curG);
    if (a === 'reset') {
      if (!confirm(`${b.label} 시수를 교육과정 기준 시수로 되돌릴까요?`)) return;
      b.grades.forEach(g => { state.hours[g] = defaultHours(g); });
      if (state.chaMode === 'total') b.grades.forEach(g => { ['s1', 's2'].forEach(s => { state.hours[g].cha_auto[s] = CHA_PARTS.reduce((t, p) => t + state.hours[g][p.key][s], 0); }); state.hours[g].cha_club = { s1: 0, s2: 0 }; state.hours[g].cha_career = { s1: 0, s2: 0 }; });
    } else if (a === 'ratio') {
      if (!confirm('과목마다 연간 시수는 그대로 두고, 1·2학기 수업일수 비율로 다시 나눌까요?')) return;
      splitByDays();
    } else if (a === 'prev') {
      // 시수 편제의 '작년편제 불러오기'와 같은 동작(전 학년)
      document.querySelector('#pjPanel [data-pj="load"]')?.click();
      setTimeout(render, 1500); return;
    }
    save(); renderHours(); render();
  });
  document.addEventListener('change', e => {
    if (!dlg() || !dlg().contains(e.target) || ro()) return;
    const t = e.target;
    if (t.dataset.pg) {
      const v = Math.max(0, Math.round(Number(t.value) || 0));
      state.hours[t.dataset.pg][t.dataset.k] = { ...(state.hours[t.dataset.pg][t.dataset.k] || {}), [t.dataset.s]: v };
      save(); renderHours();
      // 다시 그린 뒤, Tab·Enter로 옮겨 간 칸에 커서 유지
      setTimeout(() => {
        const a = document.activeElement, ds = a && a.dataset;
        const sel = ds && ds.pg ? `[data-pg="${ds.pg}"][data-k="${ds.k}"][data-s="${ds.s}"]` : null;
        render(); if (sel) { const n = dlg().querySelector(sel); if (n) { n.focus(); n.select(); } }
      }, 0);
      return;
    }
    if (t.dataset.satk) { const b = bandOf(curG); b.grades.forEach(g => { state[t.dataset.satk] = state[t.dataset.satk] || {}; state[t.dataset.satk][g] = t.value.trim(); }); save(); renderHours(); }
  });
  document.addEventListener('focusin', e => { if (dlg() && dlg().contains(e.target) && e.target.dataset.pg) e.target.select(); });
  document.addEventListener('keydown', e => {
    if (!dlg() || !dlg().open || e.key !== 'Enter' || !e.target.dataset.pg) return;
    e.preventDefault(); e.target.blur();
  });
})();
