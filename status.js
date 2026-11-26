/* =========================================================
 * 학교 현황: 학생 현황 · 교직원 현황 · 이주배경학생 현황
 *  - config/stats   { asOf, students:{classes[6],byClass:{"학년-반":{m,f}},male[6],female[6]}, staff:{m:{},f:{}} }  관리자만 수정 (다문화 내용은 이주배경학생 현황에서)
 *  - config/migrant { asOf, foreign, domestic, midEntry, nonMigrant, countries, note }  관리자·한국어학급 담당 수정
 *  - HOME '우리 학교 현황'에서 승인된 선생님 모두 조회
 * ========================================================= */
(function () {
  'use strict';
  const G6 = [0, 1, 2, 3, 4, 5];
  // 교직원 직종 (이미지 양식 순서)
  const TEACH = [['principal', '교장'], ['vice', '교감']];
  const TEACHERS = [['homeroom', '담임'], ['subject', '전담'], ['health', '보건'], ['nutrition', '영양']];
  const ADMIN_OFFICE = [['admChief', '행정실장'], ['admDeputy', '행정차장'], ['facility', '시설직'], ['admAssist', '사무행정원']];
  const KITCHEN = [['cook', '조리사'], ['cookAssist', '조리종사원']];
  const OTHERS = [['eduAdmin', '교무행정원'], ['afterSchool', '방과후학교실무원'], ['care', '돌봄전담사'], ['guard', '배움터지킴이'], ['cleaning', '환경미화'], ['night', '당직전담']];
  const EDU_KEYS = [...TEACH, ...TEACHERS].map(x => x[0]);
  const STAFF_KEYS = [...ADMIN_OFFICE, ...KITCHEN, ...OTHERS].map(x => x[0]);
  // 부모 출신국 → 국기 (flagcdn 국가 코드)
  const ISO = { 베트남: 'vn', 중국: 'cn', 러시아: 'ru', 필리핀: 'ph', 캄보디아: 'kh', 방글라데시: 'bd', 카자흐스탄: 'kz', 우즈베키스탄: 'uz', 말레이시아: 'my', 파키스탄: 'pk',
    인도네시아: 'id', 태국: 'th', 에티오피아: 'et', 스리랑카: 'lk', 일본: 'jp', 몽골: 'mn', 미국: 'us', 대만: 'tw', 네팔: 'np', 미얀마: 'mm', 키르기스스탄: 'kg', 인도: 'in',
    라오스: 'la', 우크라이나: 'ua', 타지키스탄: 'tj', 투르크메니스탄: 'tm', 아프가니스탄: 'af', 캐나다: 'ca', 호주: 'au', 영국: 'gb', 프랑스: 'fr', 독일: 'de', 브라질: 'br',
    페루: 'pe', 나이지리아: 'ng', 이란: 'ir', 튀르키예: 'tr', 터키: 'tr', 이집트: 'eg', 동티모르: 'tl', 콜롬비아: 'co', 멕시코: 'mx', 뉴질랜드: 'nz', 가나: 'gh', 케냐: 'ke',
    사우디아라비아: 'sa', 예멘: 'ye', 시리아: 'sy', 요르단: 'jo', 홍콩: 'hk', 벨라루스: 'by', 아제르바이잔: 'az', 남아프리카공화국: 'za', 칠레: 'cl', 아르헨티나: 'ar' };

  let stats = null, migrant = null, unsubs = [];
  const num = v => Math.max(0, Math.round(Number(v) || 0));
  const sum = a => a.reduce((t, v) => t + num(v), 0);
  const blank = () => ({ asOf: '', students: { classes: G6.map(() => 0), byClass: {}, male: G6.map(() => 0), female: G6.map(() => 0) }, staff: { m: {}, f: {} } });
  const blankM = () => ({ asOf: '', foreign: 0, domestic: 0, midEntry: 0, nonMigrant: 0, countries: '', note: '' });

  /* ---------- 권한 ---------- */
  const isAdm = () => !!(window.Cloud && Cloud.ready && Cloud.isAdmin());
  const isKOwner = () => !!(window.Cloud && Cloud.ready && (window.KoreanClasses?.isOwner(Cloud.email) ||
    (window.Activities?.ksl?.teachers || []).includes(Cloud.email)));
  const canMigrant = () => isAdm() || isKOwner();
  const isWriter = () => !!(window.LogRoles && LogRoles.isWriter());
  TAB_GUARDS.stats1 = TAB_GUARDS.stats2 = () => isAdm() ? true : isKOwner() ? 'stats3' : isWriter() ? 'stats4' : false;
  TAB_GUARDS.stats3 = () => canMigrant();
  function refreshNav() {
    $('navStats').hidden = !(canMigrant() || isWriter());
    if (['stats1', 'stats2', 'stats3', 'stats4'].includes(curTab) && TAB_GUARDS[curTab]() !== true) showTab(curTab);
  }

  /* ---------- 불러오기 ---------- */
  function subscribe() {
    unsubs.forEach(u => u()); unsubs = []; stats = null; migrant = null;
    refreshNav();
    if (!window.Cloud || !Cloud.ready) { renderAll(); return; }
    const { F, db } = Cloud.fb;
    unsubs.push(F.onSnapshot(F.doc(db, 'config', 'stats'), d => { stats = d.exists() ? d.data() : false; renderAll(); },
      e => { console.warn('학교 현황 불러오기 실패', e); stats = false; renderAll(); }));
    unsubs.push(F.onSnapshot(F.doc(db, 'config', 'migrant'), d => { migrant = d.exists() ? d.data() : false; renderAll(); },
      e => { console.warn('이주배경학생 현황 불러오기 실패', e); migrant = false; renderAll(); }));
  }
  function renderAll() {
    renderHome();
    if (curTab === 'stats1' && !dirty.s) renderEditStudents();
    if (curTab === 'stats2' && !dirty.f) renderEditStaff();
    if (curTab === 'stats3' && !dirty.m) renderEditMigrant();
  }

  /* ---------- 현황 그리기 (HOME·미리보기 공용) : 핵심 숫자 → 막대 → 세부 ---------- */
  const kpi = (value, unit, label, cls = '') => `<div class="sx-kpi ${cls}"><b>${value}<small>${unit}</small></b><span>${label}</span></div>`;
  const ratio = (m, f) => { const t = m + f; const pm = t ? Math.round(m / t * 100) : 0; return `<div class="sx-ratio" role="img" aria-label="남 ${m}명, 여 ${f}명">
      <div class="sx-ratio-bar"><i class="m" style="flex:${m || 0}"></i><i class="f" style="flex:${f || 0}"></i></div>
      <div class="sx-ratio-lbl"><span><i class="m"></i>남 <b>${m}</b> <small>${pm}%</small></span><span><i class="f"></i>여 <b>${f}</b> <small>${t ? 100 - pm : 0}%</small></span></div></div>`; };

  /** 학년별 학급 수: 교육과정 편성 › 학교 정보의 값을 그대로 씀 */
  const classCnt = i => Math.min(20, num(state.school?.classes?.[i + 1]));
  /** 학년 i(0~5)의 반별 {m,f} (없으면 null) */
  const classRows = (st, i) => Array.from({ length: classCnt(i) }, (_, c) => {
    const v = st.byClass?.[`${i + 1}-${c + 1}`];
    return v ? { m: num(v.m), f: num(v.f) } : null;
  });
  /** 학년 합계: 반별 자료가 있으면 그 합, 없으면 예전 학년 합계 */
  const gradeSum = (st, i) => {
    const rows = classRows(st, i);
    return rows.some(Boolean) ? rows.reduce((a, r) => ({ m: a.m + (r ? r.m : 0), f: a.f + (r ? r.f : 0) }), { m: 0, f: 0 })
      : { m: num(st.male?.[i]), f: num(st.female?.[i]) };
  };

  /** 학생 현황: 학년마다 반 칸을 나누고 남·여·계, 학년 계, 학급당 학생 수 */
  function studentsView(s) {
    const st = s.students || blank().students;
    const n = G6.map(classCnt), span = G6.map(i => Math.max(1, n[i]));
    const g = G6.map(i => gradeSum(st, i));
    const M = g.reduce((t, x) => t + x.m, 0), F = g.reduce((t, x) => t + x.f, 0), T = M + F, C = sum(n);
    const rows = G6.map(i => classRows(st, i));
    const per = (fn) => G6.map(i => n[i] ? rows[i].map(r => `<td>${r ? fn(r) : '-'}</td>`).join('') : '<td>-</td>').join('');
    const byGrade = (fn) => G6.map(i => `<td colspan="${span[i]}">${fn(i)}</td>`).join('');
    return `<div class="tbl-scroll"><table class="sx-sheet">
      <thead>
        <tr><th rowspan="2" colspan="2" class="diag"><span class="d-top">학년</span><span class="d-bot">구분</span></th>
          ${G6.map(i => `<th colspan="${span[i]}" class="gh">${i + 1}학년</th>`).join('')}<th rowspan="2" class="tot">계</th></tr>
        <tr>${G6.map(i => n[i] ? Array.from({ length: n[i] }, (_, c) => `<th class="ch">${c + 1}반</th>`).join('') : '<th class="ch">-</th>').join('')}</tr>
      </thead>
      <tbody>
        <tr><th rowspan="3" class="grp">인원</th><th>남</th>${per(r => r.m)}<td class="tot">${M}</td></tr>
        <tr><th>여</th>${per(r => r.f)}<td class="tot">${F}</td></tr>
        <tr class="sum"><th>계</th>${per(r => r.m + r.f)}<td class="tot">${T}</td></tr>
        <tr class="gsum"><th colspan="2">학년 계</th>${byGrade(i => `<b>${g[i].m + g[i].f}</b><small>남 ${g[i].m} · 여 ${g[i].f}</small>`)}<td class="tot">${T}</td></tr>
        <tr><th colspan="2">학급 수</th>${byGrade(i => n[i])}<td class="tot">${C}</td></tr>
        <tr><th colspan="2">학급당 학생 수</th>${byGrade(i => n[i] ? ((g[i].m + g[i].f) / n[i]).toFixed(1) : '-')}<td class="tot">${C ? (T / C).toFixed(1) : '-'}</td></tr>
      </tbody></table></div>`;
  }

  // 교직원: 직군별로 묶어 보여 줌
  const STAFF_GROUPS = [
    ['교원', [...TEACH, ...TEACHERS]],
    ['행정실', ADMIN_OFFICE],
    ['급식실', KITCHEN],
    ['교육 지원', OTHERS.slice(0, 3)],
    ['시설·안전', OTHERS.slice(3)],
  ];
  function staffView(s) {
    const sf = s.staff || { m: {}, f: {} };
    const n = k => num(sf.m?.[k]) + num(sf.f?.[k]);
    const sexSum = (sex, keys) => keys.reduce((t, k) => t + num(sf[sex]?.[k]), 0);
    const all = [...EDU_KEYS, ...STAFF_KEYS];
    const edu = EDU_KEYS.reduce((t, k) => t + n(k), 0), etc = STAFF_KEYS.reduce((t, k) => t + n(k), 0);
    return `<div class="sx-kpis">${kpi(edu + etc, '명', '전체 교직원', 'main')}${kpi(edu, '명', '교원')}${kpi(etc, '명', '직원')}</div>
      ${ratio(sexSum('m', all), sexSum('f', all))}
      <ul class="sx-rows">${STAFF_GROUPS.map(([g, list]) => {
        const items = list.filter(([k]) => n(k));
        const t = list.reduce((a, [k]) => a + n(k), 0);
        return t ? `<li><span class="sx-rh">${g}</span>
          <span class="sx-chips">${items.map(([k, l]) => `<span title="남 ${num(sf.m?.[k])} · 여 ${num(sf.f?.[k])}">${l} <b>${n(k)}</b></span>`).join('')}</span>
          <b class="sx-rt">${t}<small>명</small></b></li>` : '';
      }).join('')}</ul>`;
  }

  function parseCountries(text) {
    return String(text || '').split(/[,\n]+/).map(t => t.trim()).filter(Boolean).map(t => {
      const m = t.match(/^(.+?)\s*\(?\s*(\d+(?:\.\d+)?)\s*%?\s*\)?$/);
      return m ? { name: m[1].trim(), pct: m[2] } : { name: t, pct: '' };
    });
  }
  const flag = name => ISO[name] ? `<img src="https://flagcdn.com/w40/${ISO[name]}.png" alt="" loading="lazy" width="24" height="17">` : '<span class="mg-noflag"></span>';

  function migrantView(m) {
    const f = num(m.foreign), d = num(m.domestic), mi = num(m.midEntry), non = num(m.nonMigrant);
    const mig = f + d + mi, T = mig + non;
    const P = n => T ? Math.round(n / T * 100) : 0;
    const seg = (n, cls, label) => n ? `<span class="mg-seg ${cls}" style="flex:${n}" title="${label} ${n}명 (${P(n)}%)"></span>` : '';
    const line = (cls, label, sub, n) => `<li><i class="${cls}"></i><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${n}<small>명</small></b><em>${P(n)}%</em></li>`;
    const cs = parseCountries(m.countries);
    return `<div class="mg-hero"><div class="mg-pct">${P(mig)}<small>%</small></div>
        <div><b>이주배경학생 ${mig}명</b><span>전체 ${T}명 중</span></div></div>
      <div class="mg-bar" role="img" aria-label="외국인가정 ${P(f)}%, 국내출생 ${P(d)}%, 중도입국 ${P(mi)}%, 비이주배경 ${P(non)}%">
        ${seg(f, 'f', '외국인가정')}${seg(d, 'd', '국제결혼가정 국내출생')}${seg(mi, 'mi', '국제결혼가정 중도입국')}${seg(non, 'n', '비이주배경')}</div>
      <ul class="mg-list">
        ${line('f', '외국인가정', '', f)}
        ${line('d', '국제결혼가정', '국내출생', d)}
        ${line('mi', '국제결혼가정', '중도입국', mi)}
        ${line('n', '비이주배경', '', non)}
      </ul>
      ${cs.length ? `<div class="mg-countries"><h3>부모 출신국 <b>${cs.length}</b>개국</h3><ul>${cs.map(c => `<li>${flag(c.name)}<span>${esc(c.name)}${c.pct ? ` <small>${esc(c.pct)}%</small>` : ''}</span></li>`).join('')}</ul></div>` : ''}
      ${m.note ? `<p class="st-note">${esc(m.note)}</p>` : ''}`;
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    const box = $('homeStatus');
    const locked = window.App && App.locked && App.locked();
    const ok = window.Cloud && Cloud.ready && !locked;
    box.hidden = !ok || (!stats && !migrant);
    if (box.hidden) return;
    $('hsAsOf').textContent = (stats && stats.asOf) ? `(${stats.asOf} 기준)` : '';
    $('hsStudents').innerHTML = stats ? studentsView(stats) : '<p class="hint">아직 입력되지 않았습니다.</p>';
    $('hsStaff').innerHTML = stats ? staffView(stats) : '<p class="hint">아직 입력되지 않았습니다.</p>';
    $('hsMigrant').innerHTML = migrant ? (migrant.asOf ? `<p class="hint">(${esc(migrant.asOf)} 기준)</p>` : '') + migrantView(migrant) : '<p class="hint">아직 입력되지 않았습니다.</p>';
  }

  /* ---------- 편집 화면 ---------- */
  const dirty = { s: false, f: false, m: false };
  const nIn = (attrs, v) => `<input type="number" min="0" max="9999" inputmode="numeric" ${attrs} value="${num(v) || ''}" placeholder="0">`;
  const msgs = { stS: '', stF: '', stM: '' };   // 다시 그려도 저장 결과 문구 유지
  const saveBar = id => `<div class="row st-save"><button class="btn primary" type="button" id="${id}Save">저장</button><span class="hint" id="${id}Status" role="status">${esc(msgs[id])}</span></div>`;
  const say = (id, text) => { msgs[id] = text; if ($(id + 'Status')) $(id + 'Status').textContent = text; };
  const notReady = () => '<p class="hint">불러오는 중입니다… (승인된 계정으로 로그인해야 합니다)</p>';

  /** 학생 현황 입력: 반 수는 학교 정보의 학급 수, 반마다 남·여 */
  function renderEditStudents() {
    const box = $('stEditStudents');
    if (stats === null) { box.innerHTML = notReady(); return; }
    const s = stats || blank(), st = s.students || blank().students;
    const legacy = !st.byClass && G6.some(i => num(st.male?.[i]) + num(st.female?.[i]));
    box.innerHTML = `<label class="st-asof">기준 시점 <input id="stAsOf" maxlength="30" placeholder="예: 2026. 3월" value="${esc(s.asOf || '')}"></label>
      <p class="hint">반 수는 <a href="#school">교육과정 편성 › ① 학교 정보</a>의 학급 수를 따릅니다. 전입·전출을 ④에 등록하면 인원이 자동으로 바뀝니다.</p>
      ${legacy ? '<p class="hint">지금은 학년 합계만 저장되어 있습니다. 반별 남·여 인원을 입력하면 반별로 보여 줍니다.</p>' : ''}
      <div class="tbl-scroll"><table class="tbl st-edit2"><thead><tr><th>학년</th><th>반별 인원 (남 · 여)</th><th>학년 계</th></tr></thead><tbody>
      ${G6.map(i => { const n = classCnt(i), gs = gradeSum(st, i); return `<tr><th scope="row">${i + 1}학년 <small class="hint">${n}학급</small></th>
        <td><div class="cls-ins">${Array.from({ length: n }, (_, c) => { const v = st.byClass?.[`${i + 1}-${c + 1}`] || {}; return `<span class="cls-in"><em>${c + 1}반</em>
          <label>남 ${nIn(`data-g="${i + 1}" data-c="${c + 1}" data-s="m" aria-label="${i + 1}학년 ${c + 1}반 남"`, v.m)}</label>
          <label>여 ${nIn(`data-g="${i + 1}" data-c="${c + 1}" data-s="f" aria-label="${i + 1}학년 ${c + 1}반 여"`, v.f)}</label></span>`; }).join('') || '<span class="hint">학교 정보에 학급 수가 없습니다</span>'}</div></td>
        <td class="g-sum" data-gsum="${i}">${gs.m + gs.f}명 <small>(남 ${gs.m} · 여 ${gs.f})</small></td></tr>`; }).join('')}
      </tbody></table></div>
      <h3>미리보기</h3><div id="stPrevS"></div>${saveBar('stS')}`;
    $('stPrevS').innerHTML = studentsView(collectStudents());
  }
  function collectStudents() {
    const base = stats || blank(), old = base.students || blank().students;
    const byClass = {};
    const inputs = document.querySelectorAll('#stEditStudents [data-g]');
    if (inputs.length) inputs.forEach(el => { const k = `${el.dataset.g}-${el.dataset.c}`; (byClass[k] = byClass[k] || { m: 0, f: 0 })[el.dataset.s] = num(el.value); });
    else Object.assign(byClass, old.byClass || {});
    Object.keys(byClass).forEach(k => { const b = byClass[k]; if (!(num(b.m) + num(b.f))) delete byClass[k]; });
    const students = { classes: G6.map(classCnt), byClass, male: G6.map(i => num(old.male?.[i])), female: G6.map(i => num(old.female?.[i])) };
    if (!Object.keys(byClass).length) delete students.byClass;
    else G6.forEach(i => { const g = gradeSum(students, i); students.male[i] = g.m; students.female[i] = g.f; });
    return { ...base, asOf: $('stAsOf') ? $('stAsOf').value.trim() : base.asOf, students };
  }

  function renderEditStaff() {
    const box = $('stEditStaff');
    if (stats === null) { box.innerHTML = notReady(); return; }
    const s = stats || blank(), sf = s.staff || { m: {}, f: {} };
    const groups = [['교원', [...TEACH, ...TEACHERS.map(([k, l]) => [k, '교사(' + l + ')'])]], ['행정실', ADMIN_OFFICE], ['급식실', KITCHEN], ['그 밖의 직원', OTHERS]];
    box.innerHTML = `<label class="st-asof">기준 시점 <input id="sfAsOf" maxlength="30" placeholder="예: 2026. 3월" value="${esc(s.asOf || '')}"></label>
      <div class="sf-edit">${groups.map(([g, list]) => `<fieldset><legend>${g}</legend><table class="tbl"><thead><tr><th>직종</th><th>남</th><th>여</th></tr></thead><tbody>
        ${list.map(([k, l]) => `<tr><th scope="row">${l}</th><td>${nIn(`data-sex="m" data-k="${k}"`, sf.m?.[k])}</td><td>${nIn(`data-sex="f" data-k="${k}"`, sf.f?.[k])}</td></tr>`).join('')}
        </tbody></table></fieldset>`).join('')}</div>
      <h3>미리보기</h3><div id="stPrevF"></div>${saveBar('stF')}`;
    $('stPrevF').innerHTML = staffView(collectStaff());
  }
  function collectStaff() {
    const base = stats || blank();
    const staff = { m: {}, f: {} };
    document.querySelectorAll('#stEditStaff [data-sex]').forEach(el => { const n = num(el.value); if (n) staff[el.dataset.sex][el.dataset.k] = n; });
    return { ...base, asOf: $('sfAsOf') ? $('sfAsOf').value.trim() : base.asOf, staff };
  }

  function renderEditMigrant() {
    const box = $('stEditMigrant');
    if (migrant === null) { box.innerHTML = notReady(); return; }
    const m = migrant || blankM();
    const f = (k, label, hint = '') => `<label>${label} ${nIn(`data-m="${k}"`, m[k])}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
    box.innerHTML = `<label class="st-asof">기준 시점 <input id="mgAsOf" maxlength="30" placeholder="예: 2026. 3월" value="${esc(m.asOf || '')}"></label>
      <div class="mg-edit">
        <fieldset><legend>이주배경학생</legend>${f('foreign', '외국인가정')}${f('domestic', '국제결혼가정 · 국내출생')}${f('midEntry', '국제결혼가정 · 중도입국')}</fieldset>
        <fieldset><legend>비이주배경</legend>${f('nonMigrant', '비이주배경학생')}</fieldset>
      </div>
      <label class="st-wide">부모 출신국 <small class="hint">쉼표로 구분, 비율은 숫자로 (예: 베트남 47, 중국 16, 러시아)</small>
        <textarea id="mgCountries" rows="3" maxlength="600">${esc(m.countries || '')}</textarea></label>
      <label class="st-wide">메모 (선택) <input id="mgNote" maxlength="200" value="${esc(m.note || '')}"></label>
      <h3>미리보기</h3><div id="stPrevM" class="mg-prev"></div>${saveBar('stM')}`;
    $('stPrevM').innerHTML = migrantView(collectMigrant());
  }
  function collectMigrant() {
    const base = migrant || blankM(), out = { ...blankM(), ...base };
    document.querySelectorAll('#stEditMigrant [data-m]').forEach(el => { out[el.dataset.m] = num(el.value); });
    if ($('mgAsOf')) out.asOf = $('mgAsOf').value.trim();
    if ($('mgCountries')) out.countries = $('mgCountries').value.trim();
    if ($('mgNote')) out.note = $('mgNote').value.trim();
    return out;
  }

  async function save(which) {
    const { F, db } = Cloud.fb;
    const [doc, data, st, key] = which === 'm' ? ['migrant', collectMigrant(), 'stM', 'm']
      : which === 's' ? ['stats', collectStudents(), 'stS', 's'] : ['stats', collectStaff(), 'stF', 'f'];
    if (which === 'm' ? !canMigrant() : !isAdm()) return;
    const clean = which === 'm'
      ? { asOf: data.asOf, foreign: data.foreign, domestic: data.domestic, midEntry: data.midEntry, nonMigrant: data.nonMigrant, countries: data.countries, note: data.note }
      : { asOf: data.asOf || '', students: data.students || blank().students, staff: data.staff || { m: {}, f: {} } };
    try {
      await F.setDoc(F.doc(db, 'config', doc), { ...clean, updatedBy: Cloud.email, updatedAt: F.serverTimestamp() });
      dirty[key] = false;
      say(st, '저장했습니다. HOME에 바로 반영됩니다.');
    } catch (e) { say(st, '저장 실패: ' + e.message); }
  }

  // 입력하면 미리보기 갱신
  $('stEditStudents').addEventListener('input', e => {
    dirty.s = true; say('stS', '저장하지 않은 변경이 있습니다.');
    const st = collectStudents();
    $('stPrevS').innerHTML = studentsView(st);
    const g = e.target.dataset.g;
    if (g) { const gs = gradeSum(st.students, g - 1); document.querySelector(`#stEditStudents [data-gsum="${g - 1}"]`).innerHTML = `${gs.m + gs.f}명 <small>(남 ${gs.m} · 여 ${gs.f})</small>`; }
  });
  $('stEditStaff').addEventListener('input', () => { dirty.f = true; $('stPrevF').innerHTML = staffView(collectStaff()); say('stF', '저장하지 않은 변경이 있습니다.'); });
  $('stEditMigrant').addEventListener('input', () => { dirty.m = true; $('stPrevM').innerHTML = migrantView(collectMigrant()); say('stM', '저장하지 않은 변경이 있습니다.'); });
  document.addEventListener('click', e => {
    if (e.target.id === 'stSSave') save('s');
    else if (e.target.id === 'stFSave') save('f');
    else if (e.target.id === 'stMSave') save('m');
  });

  RENDER.stats1 = () => { dirty.s = false; renderEditStudents(); };
  RENDER.stats2 = () => { dirty.f = false; renderEditStaff(); };
  RENDER.stats3 = () => { dirty.m = false; renderEditMigrant(); };

  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('kclass-change', refreshNav);
  document.addEventListener('roles-change', refreshNav);
  if (window.Cloud && Cloud.ready) subscribe();
  window.SchoolStatus = {
    renderHome,
    countries: Object.keys(ISO),
    /** 학생 현황의 전체 학생 수 (반별 자료가 있으면 그 합) */
    totalStudents: () => { const st = stats && stats.students; return st ? G6.reduce((t, i) => { const g = gradeSum(st, i); return t + g.m + g.f; }, 0) : 0; },
  };
})();
