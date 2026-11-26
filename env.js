/* =========================================================
 * 교육과정 편성 › ② 학교사용환경설정 (스쿨마스터의 같은 메뉴를 참고)
 *  - 학급 현황 설정   : 학년별 학급 수(학교 정보와 같은 값)·반 이름·담임, 특수학급
 *  - 특별실-전담 배정 : 특별실 목록, 교과전담(state.jundam, 시간표 편성 › 교과전담과 같은 자료)에 사용 특별실·담당 반
 *  - 검정교과 설정    : 학년별 검정 교과서 출판사
 *  - 범교과-주제어    : 2022 개정 범교과 학습 주제 10개 + 주제어·학년별 시수
 *  - 일과시간 설정    : 교시 시각표(자동 만들기 + 직접 고치기)
 *  모두 교육과정 문서(state.env)에 저장 → 자동 저장·클라우드 동기화
 * ========================================================= */
(function () {
  'use strict';
  const PANES = [['class', '학급 현황 설정'], ['room', '특별실-전담 배정'], ['book', '검정교과 설정'], ['theme', '범교과-주제어 설정'], ['bell', '일과시간 설정']];
  let pane = sessionStorage.getItem('envPane') || 'class';

  // 2022 개정: 3~6학년 검정 교과(5~6학년 실과 포함). 학교에서 바꿀 수 있음
  const BOOK_DEFAULT = { 3: ['math', 'soc', 'sci', 'mus', 'art', 'pe', 'eng'], 4: ['math', 'soc', 'sci', 'mus', 'art', 'pe', 'eng'],
    5: ['math', 'soc', 'sci', 'prac', 'mus', 'art', 'pe', 'eng'], 6: ['math', 'soc', 'sci', 'prac', 'mus', 'art', 'pe', 'eng'] };
  const PUBLISHERS = ['천재교육', '천재교과서', '비상교육', '미래엔', '동아출판', '아이스크림미디어', '지학사', '김영사', '와이비엠', '대교', '금성출판사', '교학사', '동아', '지담', '좋은책신사고'];
  const THEMES = ['안전·건강 교육', '인성 교육', '진로 교육', '민주시민 교육', '인권 교육', '다문화 교육', '통일 교육', '독도 교육', '경제·금융 교육', '환경·지속가능발전 교육'];
  const ROOMS = ['과학실', '컴퓨터실', '음악실', '미술실', '영어실', '체육관', '도서실', '실과실'];

  /** state.env 기본값 채우기 (예전 문서에도 안전) */
  function env() {
    const e = state.env = state.env || {};
    e.classInfo = e.classInfo || {};          // "학년-반": { name, teacher }
    e.special = Array.isArray(e.special) ? e.special : [];   // [{ name, teacher, students }]
    e.rooms = Array.isArray(e.rooms) ? e.rooms : ROOMS.slice(0, 6).map(name => ({ name, note: '' }));
    e.books = e.books || {};                  // { 학년: { 과목키: 출판사 } }
    e.bookSubjects = e.bookSubjects || JSON.parse(JSON.stringify(BOOK_DEFAULT));
    e.themes = Array.isArray(e.themes) && e.themes.length ? e.themes : THEMES.map(name => ({ name, keywords: '', subjects: '', hours: {} }));
    e.bell = e.bell || { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunchLen: 50, morning: '08:40', count: 6, rows: null };
    if (!e.bell.rows) e.bell.rows = makeBell(e.bell);
    return e;
  }
  const t2m = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const m2t = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  /** 시작 시각·수업·쉬는 시간·점심으로 교시표 만들기 */
  function makeBell(b) {
    const rows = [];
    if (b.morning && t2m(b.morning) < t2m(b.start)) rows.push({ label: '아침 활동', start: b.morning, end: b.start, kind: 'etc' });
    let t = t2m(b.start);
    for (let p = 1; p <= Math.min(8, Number(b.count) || 6); p++) {
      rows.push({ label: `${p}교시`, start: m2t(t), end: m2t(t + Number(b.len)), kind: 'class' });
      t += Number(b.len);
      if (p === Number(b.lunchAfter)) { rows.push({ label: '점심시간', start: m2t(t), end: m2t(t + Number(b.lunchLen)), kind: 'lunch' }); t += Number(b.lunchLen); }
      else if (p < Number(b.count)) t += Number(b.brk);
    }
    return rows;
  }
  const changed = () => save();
  const ro = () => isTeacherView() || (App.locked && App.locked());
  const nIn = (attrs, v, w = 64) => `<input type="number" min="0" ${attrs} value="${v ?? ''}" style="width:${w}px">`;

  /* ---------- 화면 ---------- */
  function render() {
    env();
    $('envNav').innerHTML = PANES.map(([k, l]) => `<button type="button" class="env-nav-btn${k === pane ? ' on' : ''}" data-pane="${k}">${l}</button>`).join('');
    $('envBody').innerHTML = ({ class: paneClass, room: paneRoom, book: paneBook, theme: paneTheme, bell: paneBell })[pane]();
  }

  function paneClass() {
    const e = env();
    const total = GRADES.reduce((t, g) => t + (Number(state.school.classes[g]) || 0), 0);
    return `<div class="env-head"><h2>학급 현황 설정</h2><span class="hint">일반 학급 ${total}개 · 특수학급 ${e.special.length}개</span></div>
      <p class="hint">학급 수는 ① 학교 정보와 같은 값입니다. 반 이름을 비우면 'N반'으로 씁니다. 담임 이름은 학급 시간표·명단에 쓰입니다.</p>
      <div class="env-grades">${GRADES.map(g => { const n = Number(state.school.classes[g]) || 0; return `<section class="env-grade">
        <div class="env-grade-h"><b>${g}학년</b><label>학급 수 ${nIn(`data-cnt="${g}" max="20"`, n, 58)}</label></div>
        <table class="tbl env-tbl"><thead><tr><th>반</th><th>반 이름</th><th>담임</th></tr></thead><tbody>
        ${Array.from({ length: n }, (_, i) => { const k = `${g}-${i + 1}`, ci = e.classInfo[k] || {}; return `<tr><th>${i + 1}</th>
          <td><input data-ci="${k}" data-f="name" maxlength="12" placeholder="${i + 1}반" value="${esc(ci.name || '')}"></td>
          <td><input data-ci="${k}" data-f="teacher" maxlength="20" placeholder="담임 이름" value="${esc(ci.teacher || '')}"></td></tr>`; }).join('') || '<tr><td colspan="3" class="hint">학급 수를 입력하세요</td></tr>'}
        </tbody></table></section>`; }).join('')}</div>
      <section class="env-sub"><div class="env-sub-h"><h3>특수학급</h3><button type="button" class="btn small" data-add="special">+ 특수학급 추가</button></div>
        <table class="tbl env-tbl"><thead><tr><th>학급 이름</th><th>담임</th><th>학생 수</th><th></th></tr></thead><tbody>
        ${e.special.map((s, i) => `<tr><td><input data-sp="${i}" data-f="name" maxlength="20" placeholder="예: 희망반" value="${esc(s.name || '')}"></td>
          <td><input data-sp="${i}" data-f="teacher" maxlength="20" value="${esc(s.teacher || '')}"></td>
          <td>${nIn(`data-sp="${i}" data-f="students" max="99"`, s.students)}</td>
          <td><button type="button" class="btn small" data-del="special" data-i="${i}">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="hint">특수학급이 없으면 비워 두세요</td></tr>'}
        </tbody></table></section>`;
  }

  function paneRoom() {
    const e = env(), rows = state.jundam;
    const roomOpts = cur => `<option value="">(교실)</option>` + e.rooms.map(r => `<option ${r.name === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    return `<div class="env-head"><h2>특별실-전담 배정</h2><span class="hint">특별실 ${e.rooms.length}곳 · 전담 ${rows.length}건</span></div>
      <section class="env-sub"><div class="env-sub-h"><h3>특별실</h3><button type="button" class="btn small" data-add="room">+ 특별실 추가</button></div>
        <div class="env-rooms">${e.rooms.map((r, i) => `<div class="env-room"><input data-room="${i}" data-f="name" maxlength="20" value="${esc(r.name)}" placeholder="특별실 이름">
          <input data-room="${i}" data-f="note" maxlength="30" value="${esc(r.note || '')}" placeholder="위치·메모"><button type="button" class="x" data-del="room" data-i="${i}" title="삭제">✕</button></div>`).join('')}</div></section>
      <section class="env-sub"><div class="env-sub-h"><h3>교과전담 배정</h3><button type="button" class="btn small" data-add="jd">+ 전담 추가</button></div>
        <p class="hint">시간표 편성 › 교과전담과 같은 자료입니다. 여기서 고치면 그쪽에도 바로 반영됩니다.</p>
        <table class="tbl env-tbl"><thead><tr><th>전담 교사</th><th>학년</th><th>교과</th><th>주당 시수</th><th>담당 반</th><th>사용 특별실</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => { const n = Number(state.school.classes[r.grade]) || 0, cls = r.classes || []; return `<tr>
          <td><input data-jdr="${i}" data-f="teacher" maxlength="20" value="${esc(r.teacher || '')}" placeholder="교사 이름"></td>
          <td><select data-jdr="${i}" data-f="grade">${GRADES.map(g => `<option value="${g}" ${g === r.grade ? 'selected' : ''}>${g}학년</option>`).join('')}</select></td>
          <td><select data-jdr="${i}" data-f="subj">${subjectsOf(r.grade).map(s => `<option value="${s.key}" ${s.key === r.subj ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td>
          <td>${nIn(`data-jdr="${i}" data-f="hrs" max="20"`, r.hrs, 56)}</td>
          <td class="env-cls">${Array.from({ length: n }, (_, c) => `<label class="tg"><input type="checkbox" data-jdc="${i}" value="${c + 1}" ${!cls.length || cls.includes(c + 1) ? 'checked' : ''}>${c + 1}반</label>`).join('')}</td>
          <td><select data-jdr="${i}" data-f="room">${roomOpts(r.room)}</select></td>
          <td><button type="button" class="btn small" data-del="jd" data-i="${i}">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="hint">전담 교과를 추가하세요</td></tr>'}
        </tbody></table></section>`;
  }

  function paneBook() {
    const e = env();
    return `<div class="env-head"><h2>검정교과 설정</h2><span class="hint">학년별 검정 교과서 출판사</span></div>
      <p class="hint">2022 개정 교육과정 기준 3~6학년 수학·사회·과학·음악·미술·체육·영어(5~6학년 실과)가 검정 교과입니다. 학교 상황에 맞게 '검정' 표시를 바꿀 수 있습니다. 출판사는 글자를 입력하면 목록이 나옵니다.</p>
      <datalist id="envPub">${PUBLISHERS.map(p => `<option value="${p}">`).join('')}</datalist>
      <div class="env-books">${GRADES.filter(g => g >= 3).map(g => { const subs = subjectsOf(g).filter(s => !s.key.startsWith('cha') && s.key !== 'sat'); const on = e.bookSubjects[g] || []; const pub = e.books[g] || {};
        return `<section class="env-grade"><div class="env-grade-h"><b>${g}학년</b><span class="hint">${on.length}과목</span></div>
          <table class="tbl env-tbl"><thead><tr><th>교과</th><th>검정</th><th>출판사</th></tr></thead><tbody>
          ${subs.map(s => { const is = on.includes(s.key); return `<tr class="${is ? '' : 'off'}"><th>${esc(s.name)}</th>
            <td><label class="tg"><input type="checkbox" data-bk="${g}" value="${s.key}" ${is ? 'checked' : ''}>검정</label></td>
            <td>${is ? `<input list="envPub" data-pub="${g}" data-s="${s.key}" maxlength="20" placeholder="출판사" value="${esc(pub[s.key] || '')}">` : '<span class="hint">국정</span>'}</td></tr>`; }).join('')}
          </tbody></table></section>`; }).join('')}</div>`;
  }

  function paneTheme() {
    const e = env();
    const sumG = g => e.themes.reduce((t, th) => t + (Number(th.hours?.[g]) || 0), 0);
    return `<div class="env-head"><h2>범교과-주제어 설정</h2><button type="button" class="btn small" data-add="theme">+ 주제 추가</button></div>
      <p class="hint">2022 개정 교육과정의 범교과 학습 주제 10개입니다. 주제어(쉼표로 구분)와 관련 교과, 학년별 연간 계획 시수를 적어 두면 시간표·평가 계획에 참고할 수 있습니다.</p>
      <div class="tbl-scroll"><table class="tbl env-tbl env-theme"><thead><tr><th>범교과 학습 주제</th><th>주제어</th><th>관련 교과</th>${GRADES.map(g => `<th>${g}학년</th>`).join('')}<th></th></tr></thead><tbody>
      ${e.themes.map((th, i) => `<tr><td><input data-th="${i}" data-f="name" maxlength="20" value="${esc(th.name)}"></td>
        <td><input data-th="${i}" data-f="keywords" maxlength="100" placeholder="예: 생활안전, 교통안전, 재난안전" value="${esc(th.keywords || '')}"></td>
        <td><input data-th="${i}" data-f="subjects" maxlength="40" placeholder="예: 안전한 생활, 체육" value="${esc(th.subjects || '')}"></td>
        ${GRADES.map(g => `<td>${nIn(`data-thh="${i}" data-g="${g}" max="200"`, th.hours?.[g], 52)}</td>`).join('')}
        <td><button type="button" class="x" data-del="theme" data-i="${i}" title="삭제">✕</button></td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="3">학년별 합계(시간)</th>${GRADES.map(g => `<td class="num"><b>${sumG(g)}</b></td>`).join('')}<td></td></tr></tfoot></table></div>`;
  }

  function paneBell() {
    const b = env().bell;
    const kindL = { class: '수업', lunch: '점심', etc: '기타' };
    return `<div class="env-head"><h2>일과시간 설정</h2><span class="hint">교시 시각표</span></div>
      <section class="env-sub env-bellgen">
        <label>아침 활동 <input type="time" data-bell="morning" value="${b.morning || ''}"></label>
        <label>1교시 시작 <input type="time" data-bell="start" value="${b.start}"></label>
        <label>수업 ${nIn('data-bell="len" max="90"', b.len, 56)}분</label>
        <label>쉬는 시간 ${nIn('data-bell="brk" max="60"', b.brk, 56)}분</label>
        <label>교시 수 ${nIn('data-bell="count" min="1" max="8"', b.count, 52)}</label>
        <label>점심: ${nIn('data-bell="lunchAfter" min="1" max="8"', b.lunchAfter, 52)}교시 뒤 ${nIn('data-bell="lunchLen" max="120"', b.lunchLen, 56)}분</label>
        <button type="button" class="btn primary" data-act="bell-make">이 값으로 시각표 만들기</button>
      </section>
      <div class="env-bell">
        <table class="tbl env-tbl"><thead><tr><th>구분</th><th>이름</th><th>시작</th><th>끝</th><th>시간</th><th></th></tr></thead><tbody>
        ${b.rows.map((r, i) => `<tr class="k-${r.kind}"><td><span class="env-kind ${r.kind}">${kindL[r.kind] || ''}</span></td>
          <td><input data-br="${i}" data-f="label" maxlength="12" value="${esc(r.label)}"></td>
          <td><input type="time" data-br="${i}" data-f="start" value="${r.start}"></td>
          <td><input type="time" data-br="${i}" data-f="end" value="${r.end}"></td>
          <td class="num">${Math.max(0, t2m(r.end) - t2m(r.start))}분</td>
          <td><button type="button" class="x" data-del="bell" data-i="${i}" title="삭제">✕</button></td></tr>`).join('')}
        </tbody></table>
        <div class="row"><button type="button" class="btn small" data-add="bell">+ 줄 추가</button>
          <span class="hint">하교: ${b.rows.length ? b.rows[b.rows.length - 1].end : '-'}</span></div>
      </div>`;
  }

  /* ---------- 고치기 ---------- */
  const root = $('tab-env');
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-pane]');
    if (nav) { pane = nav.dataset.pane; sessionStorage.setItem('envPane', pane); render(); return; }
    if (ro()) return;
    const E = env();
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add) {
      if (add === 'special') E.special.push({ name: '', teacher: '', students: 0 });
      if (add === 'room') E.rooms.push({ name: '', note: '' });
      if (add === 'theme') E.themes.push({ name: '', keywords: '', subjects: '', hours: {} });
      if (add === 'bell') { const last = E.bell.rows[E.bell.rows.length - 1]; const s = last ? t2m(last.end) : t2m(E.bell.start); E.bell.rows.push({ label: '', start: m2t(s), end: m2t(s + 40), kind: 'etc' }); }
      if (add === 'jd') { const g = state.jundam.length ? state.jundam[state.jundam.length - 1].grade : 3; state.jundam.push({ teacher: '', grade: g, subj: subjectsOf(g)[0].key, hrs: 2 }); }
      changed(); render(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const i = Number(del.dataset.i), k = del.dataset.del;
      const arr = { special: E.special, room: E.rooms, theme: E.themes, bell: E.bell.rows, jd: state.jundam }[k];
      if (k === 'jd' && !confirm('이 전담 배정을 삭제할까요? (시간표 편성 › 교과전담에서도 지워집니다)')) return;
      arr.splice(i, 1); changed(); render(); return;
    }
    if (e.target.closest('[data-act="bell-make"]')) {
      if (E.bell.rows.length && !confirm('지금 시각표를 새로 만들까요? 직접 고친 내용은 사라집니다.')) return;
      E.bell.rows = makeBell(E.bell); changed(); render();
    }
  });
  root.addEventListener('change', e => {
    if (ro()) return;
    const t = e.target, d = t.dataset, E = env(), v = t.value;
    if (d.cnt) { state.school.classes[d.cnt] = Math.max(0, Math.min(20, Number(v) || 0)); changed(); render(); return; }
    if (d.ci) { (E.classInfo[d.ci] = E.classInfo[d.ci] || {})[d.f] = v.trim(); changed(); return; }
    if (d.sp) { E.special[d.sp][d.f] = d.f === 'students' ? Number(v) || 0 : v.trim(); changed(); render(); return; }
    if (d.room) { const old = E.rooms[d.room].name; E.rooms[d.room][d.f] = v.trim(); if (d.f === 'name') state.jundam.forEach(r => { if (r.room === old) r.room = v.trim(); }); changed(); return; }
    if (d.jdr) {
      const r = state.jundam[d.jdr];
      if (d.f === 'grade') { r.grade = Number(v); r.subj = subjectsOf(r.grade)[0].key; r.classes = []; }
      else if (d.f === 'hrs') r.hrs = Number(v) || 0;
      else r[d.f] = v;
      changed(); render(); return;
    }
    if (d.jdc) {
      const r = state.jundam[d.jdc];
      r.classes = [...root.querySelectorAll(`[data-jdc="${d.jdc}"]:checked`)].map(x => Number(x.value));
      if (r.classes.length === (Number(state.school.classes[r.grade]) || 0)) r.classes = [];   // 전체 = 빈 값
      changed(); return;
    }
    if (d.bk) {
      const g = d.bk; E.bookSubjects[g] = [...root.querySelectorAll(`[data-bk="${g}"]:checked`)].map(x => x.value);
      changed(); render(); return;
    }
    if (d.pub) { (E.books[d.pub] = E.books[d.pub] || {})[d.s] = v.trim(); changed(); return; }
    if (d.th) { E.themes[d.th][d.f] = v.trim(); changed(); return; }
    if (d.thh) { const th = E.themes[d.thh]; th.hours = th.hours || {}; th.hours[d.g] = Number(v) || 0; changed(); render(); return; }
    if (d.bell) { E.bell[d.bell] = t.type === 'number' ? Number(v) || 0 : v; changed(); return; }
    if (d.br) { E.bell.rows[d.br][d.f] = v; changed(); render(); return; }
  });

  RENDER.env = render;
})();
