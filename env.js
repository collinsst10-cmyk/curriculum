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
  // 초등 검정 교과서를 내는 출판사 (중·고 전용 출판사 제외)
  const PUBLISHERS = ['천재교육', '천재교과서', '비상교육', '미래엔', '동아출판', '아이스크림미디어', '지학사', '김영사', '와이비엠', '대교', '금성출판사', '좋은책신사고'];
  const THEMES = ['안전·건강 교육', '인성 교육', '진로 교육', '민주시민 교육', '인권 교육', '다문화 교육', '통일 교육', '독도 교육', '경제·금융 교육', '환경·지속가능발전 교육'];
  const ROOMS = ['과학실', '컴퓨터실', '음악실', '미술실', '영어실', '체육관', '도서실', '실과실'];

  /** state.env 기본값 채우기 (예전 문서에도 안전) */
  function env() {
    const e = state.env = state.env || {};
    e.classInfo = e.classInfo || {};          // "학년-반": { name, teacher }
    e.special = Array.isArray(e.special) ? e.special : [];   // [{ name, teacher, students }]
    e.rooms = Array.isArray(e.rooms) ? e.rooms : ROOMS.slice(0, 6).map(name => ({ name, note: '' }));
    // 전담 교사 목록 (처음엔 배정표에 적힌 이름으로 채움)
    e.teachers = Array.isArray(e.teachers) ? e.teachers
      : [...new Set((state.jundam || []).map(r => (r.teacher || '').trim()).filter(Boolean))].map(name => ({ name }));
    // 학교의 전담 교과(예: 영어·과학) — 배정표 교과 칸과 특별실 연결에 이 범위만 나옴
    if (!Array.isArray(e.jdSubjects)) e.jdSubjects = [...new Set((state.jundam || []).map(r => r.subj).filter(k => allSubj().some(s => s.key === k)))];
    e.books = e.books || {};                  // { 학년: { 과목키: 출판사 } }
    e.bookSubjects = e.bookSubjects || JSON.parse(JSON.stringify(BOOK_DEFAULT));
    e.themes = Array.isArray(e.themes) && e.themes.length ? e.themes : THEMES.map(name => ({ name, keywords: '', subjects: '', hours: {} }));
    e.bell = e.bell || { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunchLen: 50, morning: '08:40', count: 6, rows: null };
    if (!e.bell.rows) e.bell.rows = makeBell(e.bell);
    return e;
  }
  /** 전담으로 둘 수 있는 교과 전체(1~6학년 교과, 창체·학교자율시간 제외) */
  function allSubj() {
    const seen = new Map();
    GRADES.forEach(g => bandOf(g).groups.forEach(gr => gr.subs.forEach(s => { if (!seen.has(s.key)) seen.set(s.key, s.name); })));
    return [...seen].map(([key, name]) => ({ key, name }));
  }
  const subjName = k => (allSubj().find(s => s.key === k) || {}).name || k;
  const ROOM_GUESS = [['과학', 'sci'], ['영어', 'eng'], ['음악', 'mus'], ['미술', 'art'], ['체육', 'pe'], ['실과', 'prac'], ['컴퓨터', 'prac']];
  function guessSubj(name) { const hit = ROOM_GUESS.find(([w]) => String(name || '').includes(w)); return hit ? hit[1] : ''; }
  /** 특별실의 연결 교과: 직접 정한 값, 없으면 이름으로 짐작(과학실 → 과학) — 단 전담 교과일 때만 */
  function roomSubj(r) {
    if (r.subj !== undefined) return r.subj;
    const g = guessSubj(r.name), jd = env().jdSubjects;
    return g && jd.includes(g) ? g : '';
  }
  /** 이 학년에서 고를 수 있는 전담 교과 (전담 교과를 아직 안 골랐으면 전체) */
  function jdSubjOf(g) {
    const list = subjectsOf(g), pick = env().jdSubjects;
    return pick.length ? list.filter(s => pick.includes(s.key)) : list;
  }
  /** 교과에 연결된 특별실 (연결된 곳이 없으면 아무 교과에도 안 묶인 특별실) */
  function roomsFor(subj) {
    const rs = env().rooms.filter(r => r.name);
    const linked = rs.filter(r => roomSubj(r) === subj);
    return linked.length ? linked : rs.filter(r => !roomSubj(r));
  }
  /** 전담 교사 한 명이 맡은 학년·반 요약: "3학년 전체 · 4학년 1·2반" */
  function coverOf(name) {
    const by = {};
    state.jundam.filter(r => r.teacher === name).forEach(r => {
      const n = Number(state.school.classes[r.grade]) || 0, cls = r.classes && r.classes.length ? r.classes : Array.from({ length: n }, (_, i) => i + 1);
      (by[r.grade] = by[r.grade] || new Set()); cls.forEach(c => by[r.grade].add(c));
    });
    return Object.keys(by).sort().map(g => { const n = Number(state.school.classes[g]) || 0, s = [...by[g]].sort((a, b) => a - b);
      return s.length >= n ? `${g}학년 전체` : `${g}학년 ${s.join('·')}반`; }).join(' · ');
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
  // 저장할 때마다 이 학년도의 설정 사본을 남겨 둠 → 다음 해에 '작년자료 불러오기'로 씀
  const changed = () => {
    const { envArchive, ...rest } = state.env || {};
    state.envArchive = state.envArchive || {};
    state.envArchive[state.school.year] = JSON.parse(JSON.stringify(rest));
    save();
  };
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
    const kc = Math.max(0, Math.min(3, Number(state.school.kclass ?? 3)));
    return `<div class="env-head"><h2>학급 현황 설정</h2><span class="hint">일반 학급 ${total}개 · 교과전담 ${e.teachers.length}명 · 한국어학급 ${kc}개 · 특수학급 ${e.special.length}개</span></div>
      <p class="hint">학급 수는 <a href="#school">학교 정보 › 기본 정보</a>에서 정합니다. 여기서는 담임·전담 교사 이름을 적습니다.</p>
      <div class="env-grades">${GRADES.map(g => { const n = Number(state.school.classes[g]) || 0; return `<section class="env-grade">
        <div class="env-grade-h"><b>${g}학년</b><span class="hint">${n}학급</span></div>
        <table class="tbl env-tbl"><thead><tr><th>학급</th><th>담임</th></tr></thead><tbody>
        ${Array.from({ length: n }, (_, i) => { const k = `${g}-${i + 1}`, ci = e.classInfo[k] || {}; return `<tr><th class="env-cls-name">${i + 1}반</th>
          <td><input data-ci="${k}" data-f="teacher" maxlength="20" placeholder="담임 이름" value="${esc(ci.teacher || '')}"></td></tr>`; }).join('') || '<tr><td colspan="2" class="hint">① 학교 정보에서 학급 수를 입력하세요</td></tr>'}
        </tbody></table></section>`; }).join('')}</div>
      <section class="env-sub"><div class="env-sub-h"><h3>교과전담</h3><span class="hint">${e.teachers.length}명 · <a href="#" data-goroom>특별실-전담 배정</a>과 연동</span></div>
        <table class="tbl env-tbl fit"><thead><tr><th>전담</th><th>교사 이름</th><th>교과</th><th>담당 학급</th><th>주당 시수</th></tr></thead><tbody>
        ${e.teachers.map((t, i) => { const rows = state.jundam.filter(r => r.teacher === t.name);
          const subs = [...new Set(rows.map(r => subjName(r.subj)))];
          return `<tr><th class="env-cls-name">${esc(t.name || '(이름 없음)')}</th>
          <td><input data-tc="${i}" maxlength="20" placeholder="교사 이름" value="${esc(t.teacher || '')}"></td>
          <td class="l">${subs.map(s => `<span class="env-jd">${esc(s)}</span>`).join(' ') || '<span class="hint">-</span>'}</td>
          <td class="l">${esc(coverOf(t.name)) || '<span class="hint">배정 없음</span>'}</td>
          <td class="num">${teacherHours(t.name)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="hint">특별실-전담 배정 › 전담 설정에서 전담을 추가하세요.</td></tr>'}
        </tbody></table></section>
      <section class="env-sub"><div class="env-sub-h"><h3>한국어학급</h3><span class="hint">${kc}학급 · 학교 정보의 한국어학급 수</span></div>
        <table class="tbl env-tbl env-kc fit"><thead><tr><th>학급</th><th>담임</th></tr></thead><tbody>
        ${Array.from({ length: kc }, (_, i) => { const k = `k-${i + 1}`, ci = e.classInfo[k] || {}; return `<tr><th class="env-cls-name">한국어학급 ${i + 1}</th>
          <td><input data-ci="${k}" data-f="teacher" maxlength="20" placeholder="담임 이름" value="${esc(ci.teacher || '')}"></td></tr>`; }).join('') || '<tr><td colspan="2" class="hint"><a href="#school">학교 정보 › 기본 정보</a>에서 한국어학급 수를 입력하세요.</td></tr>'}
        </tbody></table></section>
      <section class="env-sub"><div class="env-sub-h"><h3>특수학급</h3><button type="button" class="btn small" data-add="special">+ 특수학급 추가</button></div>
        <table class="tbl env-tbl fit"><thead><tr><th>학급 이름</th><th>담임</th><th>학생 수</th><th></th></tr></thead><tbody>
        ${e.special.map((s, i) => `<tr><td><input data-sp="${i}" data-f="name" maxlength="20" placeholder="예: 희망반" value="${esc(s.name || '')}"></td>
          <td><input data-sp="${i}" data-f="teacher" maxlength="20" value="${esc(s.teacher || '')}"></td>
          <td>${nIn(`data-sp="${i}" data-f="students" max="99"`, s.students)}</td>
          <td><button type="button" class="btn small" data-del="special" data-i="${i}">삭제</button></td></tr>`).join('') || '<tr><td colspan="4" class="hint">특수학급이 없으면 비워 두세요</td></tr>'}
        </tbody></table></section>`;
  }

  /* 특별실-전담: 왼쪽 두 목록(스쿨마스터와 같은 구성) + 아래 배정표 */
  let selRoom = -1, selT = -1, modeRoom = '', modeT = '';
  /** 배정 한 줄의 주당 시수 = 시수 × 담당 반 수(비면 그 학년 전체 반) */
  const rowHours = r => (Number(r.hrs) || 0) * ((r.classes && r.classes.length) || Number(state.school.classes[r.grade]) || 0);
  const roomHours = name => state.jundam.filter(r => r.room === name).reduce((t, r) => t + rowHours(r), 0);
  const teacherHours = name => state.jundam.filter(r => r.teacher === name).reduce((t, r) => t + rowHours(r), 0);

  function listCard(kind) {
    const isRoom = kind === 'room', e = env();
    const items = isRoom ? e.rooms.map(r => r.name) : e.teachers.map(t => t.name);
    const sel = isRoom ? selRoom : selT, mode = isRoom ? modeRoom : modeT;
    const hrs = isRoom ? roomHours : teacherHours;
    const L = isRoom ? { set: '특별실 설정', ren: '이름 변경', col: '특별실', ph: '예: 과학실', none: '특별실이 없습니다' }
                     : { set: '전담 설정', ren: '전담명 변경', col: '전담명', ph: '예: 영어전담', none: '전담 교사가 없습니다' };
    return `<section class="sm-card">
      <div class="sm-btns"><button type="button" class="btn${mode === 'set' ? ' on' : ''}" data-mode="${kind}:set">${L.set}</button>
        <button type="button" class="btn${mode === 'rename' ? ' on' : ''}" data-mode="${kind}:rename">${L.ren}</button></div>
      <table class="sm-list"><thead><tr><th>${L.col}</th>${isRoom ? '<th class="s">연결 교과</th>' : ''}<th class="h">시수</th><th class="d"></th></tr></thead><tbody>
      ${items.map((n, i) => `<tr class="${i === sel ? 'sel' : ''}" data-pick="${kind}:${i}">
        <td>${mode === 'rename' && i === sel ? `<input class="sm-in" data-rename="${kind}:${i}" maxlength="20" value="${esc(n)}">` : esc(n || '(이름 없음)')}</td>
        ${isRoom ? `<td class="s">${roomSubjSel(i)}</td>` : ''}
        <td class="h">${hrs(n)}</td><td class="d"><button type="button" class="sm-del" data-smrow="${kind}:${i}" title="${esc(n)} 삭제" aria-label="${esc(n)} 삭제">삭제</button></td></tr>`).join('') || `<tr><td colspan="${isRoom ? 4 : 3}" class="hint">${L.none}</td></tr>`}
      </tbody></table>
      ${mode === 'set' ? `<div class="sm-tool"><input class="sm-in" data-newname="${kind}" maxlength="20" placeholder="${L.ph}">
          <button type="button" class="btn small primary" data-smadd="${kind}">추가</button>
          <button type="button" class="btn small" data-smdel="${kind}" ${sel < 0 ? 'disabled' : ''}>선택 삭제</button></div>
          <p class="hint">추가할 이름을 적고 '추가'(또는 Enter)를 누르세요. 지우려면 목록에서 고른 뒤 '선택 삭제'를 누릅니다.</p>` : ''}
      ${mode === 'rename' ? `<p class="hint">${sel < 0 ? '목록에서 이름을 바꿀 줄을 고르세요.' : '새 이름을 적고 Enter를 누르세요. 배정표와 시간표 배치에도 함께 바뀝니다.'}</p>` : ''}
    </section>`;
  }

  /** 특별실 줄의 '연결 교과' 고르기 (전담 교과 범위) */
  function roomSubjSel(i) {
    const e = env(), cur = roomSubj(e.rooms[i]), opts = e.jdSubjects.length ? e.jdSubjects.map(k => ({ key: k, name: subjName(k) })) : allSubj();
    const list = cur && !opts.some(o => o.key === cur) ? [...opts, { key: cur, name: subjName(cur) }] : opts;
    return `<select class="sm-sel" data-rsubj="${i}" ${ro() ? 'disabled' : ''}><option value="">공용</option>${list.map(o => `<option value="${o.key}" ${o.key === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  }
  /** 교과가 바뀌면 특별실을 그 교과의 특별실로 맞춤 (하나뿐이면 자동 선택) */
  function fitRoom(r) {
    const ok = roomsFor(r.subj);
    if (r.room && ok.some(x => x.name === r.room)) return;
    const linked = env().rooms.filter(x => x.name && roomSubj(x) === r.subj);
    r.room = linked.length === 1 ? linked[0].name : '';
  }
  function paneRoom() {
    const e = env(), rows = state.jundam;
    const roomOpts = r => { const ok = roomsFor(r.subj), list = r.room && !ok.some(x => x.name === r.room) ? [...ok, { name: r.room }] : ok;
      return `<option value="">(교실)</option>` + list.map(x => `<option ${x.name === r.room ? 'selected' : ''}>${esc(x.name)}</option>`).join(''); };
    const tOpts = cur => `<option value="">(미정)</option>` + e.teachers.map(t => `<option value="${esc(t.name)}" ${t.name === cur ? 'selected' : ''}>${esc(t.name)}${t.teacher ? ` (${esc(t.teacher)})` : ''}</option>`).join('') +
      (cur && !e.teachers.some(t => t.name === cur) ? `<option selected>${esc(cur)}</option>` : '');
    const subOpts = r => { const ok = jdSubjOf(r.grade), list = r.subj && !ok.some(s => s.key === r.subj) ? [...ok, { key: r.subj, name: subjName(r.subj) }] : ok;
      return list.map(s => `<option value="${s.key}" ${s.key === r.subj ? 'selected' : ''}>${esc(s.name)}</option>`).join(''); };
    const gradeOk = g => jdSubjOf(g).length > 0;
    return `<div class="env-head"><h2>특별실-전담 배정</h2><span class="hint">전담 교과 ${e.jdSubjects.length}개 · 특별실 ${e.rooms.length}곳 · 전담 ${e.teachers.length}명</span></div>
      <section class="jd-subj${e.jdSubjects.length ? '' : ' empty'}"><div class="jd-subj-h"><b>① 우리 학교 전담 교과</b>
        <span class="hint">${e.jdSubjects.length ? '아래 배정표의 교과와 특별실 연결에는 고른 교과만 나옵니다.' : '먼저 전담 교과를 고르세요. 고르기 전에는 모든 교과가 나옵니다.'}</span></div>
        <div class="jd-chips">${allSubj().map(s => `<label class="tg${e.jdSubjects.includes(s.key) ? ' on' : ''}"><input type="checkbox" data-jdsub="${s.key}" ${e.jdSubjects.includes(s.key) ? 'checked' : ''} ${ro() ? 'disabled' : ''}>${esc(s.name)}</label>`).join('')}</div></section>
      <div class="sm-two">${listCard('room')}${listCard('teacher')}</div>
      <p class="hint">특별실의 '연결 교과'를 정하면 배정표에서 그 교과에는 연결된 특별실만 나옵니다. '공용'은 연결된 특별실이 없는 교과에 나옵니다.</p>
      <section class="env-sub"><div class="env-sub-h"><h3>전담 과목 배정</h3><button type="button" class="btn small" data-add="jd">+ 배정 추가</button></div>
        <p class="hint">전담·학년·교과·담당 반·사용 특별실을 정합니다. 위 목록의 시수와 학급 현황 설정 › 교과전담에 자동으로 반영됩니다.</p>
        <table class="tbl env-tbl fit"><thead><tr><th>전담</th><th>학년</th><th>교과</th><th>반당 시수</th><th>담당 반</th><th>특별실</th><th>주당</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => { const n = Number(state.school.classes[r.grade]) || 0, cls = r.classes || []; return `<tr>
          <td><select data-jdr="${i}" data-f="teacher">${tOpts(r.teacher)}</select></td>
          <td><select data-jdr="${i}" data-f="grade">${GRADES.filter(g => gradeOk(g) || g === Number(r.grade)).map(g => `<option value="${g}" ${g === Number(r.grade) ? 'selected' : ''}>${g}학년</option>`).join('')}</select></td>
          <td><select data-jdr="${i}" data-f="subj">${subOpts(r)}</select></td>
          <td>${nIn(`data-jdr="${i}" data-f="hrs" max="20"`, r.hrs, 56)}</td>
          <td class="env-cls">${Array.from({ length: n }, (_, c) => `<label class="tg"><input type="checkbox" data-jdc="${i}" value="${c + 1}" ${!cls.length || cls.includes(c + 1) ? 'checked' : ''}>${c + 1}반</label>`).join('')}</td>
          <td><select data-jdr="${i}" data-f="room">${roomOpts(r)}</select></td>
          <td class="num"><b>${rowHours(r)}</b></td>
          <td><button type="button" class="btn small" data-del="jd" data-i="${i}">삭제</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="hint">배정을 추가하세요</td></tr>'}
        </tbody></table></section>`;
  }

  /** 특별실·전담 목록 고치기 (이름이 바뀌면 배정표·시간표 배치에도 반영) */
  function smAdd(kind) {
    const inp = $('tab-env').querySelector(`[data-newname="${kind}"]`), name = (inp && inp.value || '').trim(), E = env();
    if (!name) { if (inp) inp.focus(); return; }
    const list = kind === 'room' ? E.rooms : E.teachers;
    if (list.some(x => x.name === name)) { alert('같은 이름이 이미 있습니다.'); return; }
    list.push(kind === 'room' ? { name, note: '' } : { name });
    if (kind === 'room') selRoom = list.length - 1; else selT = list.length - 1;
    changed(); render();
    const again = $('tab-env').querySelector(`[data-newname="${kind}"]`); if (again) again.focus();
  }
  function smDel(kind) {
    const E = env(), i = kind === 'room' ? selRoom : selT, list = kind === 'room' ? E.rooms : E.teachers;
    if (i < 0 || !list[i]) return;
    const name = list[i].name, used = state.jundam.filter(r => (kind === 'room' ? r.room : r.teacher) === name).length;
    if (!confirm(`'${name}'을(를) 삭제할까요?${used ? `\n배정표 ${used}줄에서 ${kind === 'room' ? '특별실' : '전담'}이 비워집니다.` : ''}`)) return;
    list.splice(i, 1);
    state.jundam.forEach(r => { if (kind === 'room' && r.room === name) r.room = ''; if (kind === 'teacher' && r.teacher === name) r.teacher = ''; });
    if (kind === 'room') selRoom = -1; else selT = -1;
    changed(); render();
  }
  function smRename(kind, i, value) {
    const E = env(), list = kind === 'room' ? E.rooms : E.teachers, name = value.trim(), old = list[i] && list[i].name;
    if (!list[i] || !name || name === old) { if (kind === 'room') modeRoom = ''; else modeT = ''; render(); return; }
    if (list.some((x, k) => k !== i && x.name === name)) { alert('같은 이름이 이미 있습니다.'); return; }
    list[i].name = name;
    state.jundam.forEach(r => { if (kind === 'room' && r.room === old) r.room = name; if (kind === 'teacher' && r.teacher === old) r.teacher = name; });
    if (kind === 'room') state.schedule.forEach(s => { if (s.kind === old) s.kind = name; });
    if (kind === 'room') modeRoom = ''; else modeT = '';
    changed(); render();
  }

  /* 검정교과: 국정 교과는 고정(선택 불가)으로 따로 보여 주고, 검정 교과는 학년 × 교과 표(가로)로 출판사만 고름 */
  const NATIONAL = { 1: '전 교과', 2: '전 교과', 3: ['kor', 'mor'], 4: ['kor', 'mor'], 5: ['kor', 'mor'], 6: ['kor', 'mor'] };
  const BOOK_COLS = [['math', '수학'], ['soc', '사회'], ['sci', '과학'], ['prac', '실과'], ['mus', '음악'], ['art', '미술'], ['pe', '체육'], ['eng', '영어']];
  function paneBook() {
    const e = env();
    const subName = (g, k) => (subjectsOf(g).find(s => s.key === k) || {}).name || k;
    const has = (g, k) => subjectsOf(g).some(s => s.key === k);
    const done = GRADES.filter(g => g >= 3).reduce((t, g) => t + BOOK_COLS.filter(([k]) => has(g, k) && (e.books[g] || {})[k]).length, 0);
    const all = GRADES.filter(g => g >= 3).reduce((t, g) => t + BOOK_COLS.filter(([k]) => has(g, k)).length, 0);
    const pubSel = (g, k) => {
      const cur = (e.books[g] || {})[k] || '';
      const opts = PUBLISHERS.includes(cur) || !cur ? PUBLISHERS : [cur, ...PUBLISHERS];
      return `<select class="bk-sel${cur ? ' set' : ''}" data-pub="${g}" data-s="${k}" aria-label="${g}학년 ${subName(g, k)} 출판사">
        <option value="">선택</option>${opts.map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__etc">직접 입력…</option></select>`;
    };
    return `<div class="env-head"><h2>검정교과 설정</h2><span class="hint">출판사 ${done} / ${all}개 선택</span></div>
      <section class="bk-nat">
        <div class="bk-nat-h"><b>국정 교과</b><span>국가가 정한 교과서를 쓰는 교과라 선택할 것이 없습니다.</span></div>
        <div class="bk-nat-list">${GRADES.map(g => { const n = NATIONAL[g]; return `<span class="bk-nat-g"><em>${g}학년</em>${Array.isArray(n) ? n.map(k => `<i>${esc(subName(g, k))}</i>`).join('') : `<i>${n}</i>`}</span>`; }).join('')}</div>
      </section>
      <section class="env-sub">
        <div class="env-sub-h"><h3>검정 교과 출판사</h3><span class="hint">3~6학년 · 학교에서 고른 검정 교과서의 출판사를 정합니다</span></div>
        <div class="tbl-scroll"><table class="bk-grid"><thead><tr><th>학년</th>${BOOK_COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
        ${GRADES.filter(g => g >= 3).map(g => `<tr><th>${g}학년</th>${BOOK_COLS.map(([k]) => has(g, k) ? `<td>${pubSel(g, k)}</td>` : '<td class="na">해당 없음</td>').join('')}</tr>`).join('')}
        </tbody></table></div>
        <p class="hint">출판사 목록은 초등 검정 교과서를 내는 출판사입니다. 목록에 없으면 '직접 입력…'을 고르세요. 교과별 실제 발행사는 교육청 선정 목록으로 확인해 주세요.</p>
      </section>`;
  }

  /* ---------- 범교과-주제어 (스쿨마스터 '주제어(범교과, 7대 안전) 등록 및 편집'과 같은 구성) ---------- */
  const DEF_TOPICS = [['안전·건강교육', '(7대 안전)', 51], ['안전·건강교육', '양성평등교육', 15], ['안전·건강교육', '보건교육', 0],
    ['안전·건강교육', '건강한 식생활 및 영양교육', 7], ['안전·건강교육', '생명존중 및 자살예방 교육', 6], ['안전·건강교육', '학교폭력 예방교육', 11],
    ['인성교육', '인성교육', 11], ['진로교육', '진로교육', 8], ['민주시민교육', '민주시민교육', 2], ['인권교육', '장애인식 개선교육', 2],
    ['다문화교육', '다문화교육', 10], ['통일교육', '통일교육', 5], ['독도교육', '독도교육', 10], ['경제·금융교육', '경제·금융교육', ''],
    ['환경·지속가능발전교육', '환경·지속가능발전교육', 10]].map(([topic, sub, hours]) => ({ topic, sub, hours }));
  const DEF_SAFETY = [['생활안전', '시설 및 제품이용 안전, 신체활동 안전, 유괴 및 미아사고 예방', 12],
    ['교통안전', '보행자안전, 자전거안전, 오토바이안전, 자동차안전, 대중교통안전', 11],
    ['폭력 및 신변안전', '학교폭력, 성폭력, 자살, 가정폭력, 아동학대', 8], ['약물 및 사이버중독', '약물중독, 사이버중독', 10],
    ['재난안전', '화재, 사회재난, 자연재난', 6], ['직업안전', '직업안전의식, 직업병, 직업안전의 예방 및 관리, 산업재해의 이해와 예방', 2],
    ['응급처치', '응급처치의 이해와 필요성, 심폐소생술, 상황별 응급처치', 2]].map(([name, mid, hours]) => ({ name, mid, hours }));
  const clone = o => JSON.parse(JSON.stringify(o));
  let themeGrade = 1, selT1 = -1, selT2 = -1;

  function themeCfg() {
    const e = env();
    if (!e.themeCfg) e.themeCfg = { mode: 'same', same: { topics: clone(DEF_TOPICS), safety: clone(DEF_SAFETY) }, byGrade: {} };
    return e.themeCfg;
  }
  /** 지금 고치는 묶음: 전학년 동일 → same, 학년별 → byGrade[학년] (처음엔 전학년 값을 복사) */
  function themeSet() {
    const c = themeCfg();
    if (c.mode !== 'grade') return c.same;
    if (!c.byGrade[themeGrade]) c.byGrade[themeGrade] = clone(c.same);
    return c.byGrade[themeGrade];
  }
  const safetySum = set => set.safety.reduce((t, s) => t + (Number(s.hours) || 0), 0);
  const isSafetyRow = t => String(t.sub || '').replace(/\s+/g, '') === '(7대안전)';

  function paneTheme() {
    const c = themeCfg(), set = themeSet(), sSum = safetySum(set);
    const hrsOf = t => isSafetyRow(t) ? sSum : t.hours;
    const total = set.topics.reduce((t, x) => t + (Number(hrsOf(x)) || 0), 0);
    const left = [...set.topics, { topic: '', sub: '', hours: '' }].map((t, i) => {
      const blank = i === set.topics.length, auto = !blank && isSafetyRow(t);
      return `<tr class="${i === selT1 ? 'sel' : ''}${blank ? ' blank' : ''}" data-row="t1:${i}">
        <td><input data-t1="${i}" data-f="topic" maxlength="30" value="${esc(t.topic)}" ${blank ? 'placeholder="새 주제"' : ''}></td>
        <td><input data-t1="${i}" data-f="sub" maxlength="40" value="${esc(t.sub)}"></td>
        <td class="h">${auto ? `<span class="auto" title="오른쪽 7대 안전 시수의 합계">${sSum}</span>` : `<input data-t1="${i}" data-f="hours" type="number" min="0" max="999" value="${t.hours ?? ''}">`}</td></tr>`;
    }).join('');
    const right = [...set.safety, { name: '', mid: '', hours: '' }].map((s, i) => {
      const blank = i === set.safety.length;
      return `<tr class="${i === selT2 ? 'sel' : ''}${blank ? ' blank' : ''}" data-row="t2:${i}">
        <td><input data-t2="${i}" data-f="name" maxlength="20" value="${esc(s.name)}" ${blank ? 'placeholder="새 영역"' : ''}></td>
        <td><textarea data-t2="${i}" data-f="mid" maxlength="200" rows="2">${esc(s.mid)}</textarea></td>
        <td class="h"><input data-t2="${i}" data-f="hours" type="number" min="0" max="999" value="${s.hours ?? ''}"></td></tr>`;
    }).join('');
    return `<div class="env-head"><h2>범교과-주제어 설정</h2><span class="hint">주제어(범교과, 7대 안전) 등록 및 편집</span></div>
      <div class="th-top">
        <div class="th-mode" role="radiogroup">
          <label><input type="radio" name="thMode" value="same" ${c.mode !== 'grade' ? 'checked' : ''}> 전학년 동일하게</label>
          <label><input type="radio" name="thMode" value="grade" ${c.mode === 'grade' ? 'checked' : ''}> 학년별로 다르게</label>
        </div>
        ${c.mode === 'grade' ? `<div class="th-grades">${GRADES.map(g => `<button type="button" class="${g === themeGrade ? 'on' : ''}" data-thg="${g}">${g}학년</button>`).join('')}</div>` : ''}
        <button type="button" class="btn th-prev" data-act="th-prev">작년자료 불러오기</button>
      </div>
      <div class="th-two">
        <section class="th-box">
          <table class="th-tbl"><thead><tr><th>범교과 학습 주제</th><th>세부 주제</th><th class="h">기준시수</th></tr></thead><tbody>${left}</tbody>
            <tfoot><tr><th colspan="2">합계${c.mode === 'grade' ? ` (${themeGrade}학년)` : ''}</th><td class="h"><b>${total}</b></td></tr></tfoot></table>
          <div class="th-foot"><span class="th-mv"><button type="button" class="btn small" data-mv="t1:-1" title="위로">▲</button><button type="button" class="btn small" data-mv="t1:1" title="아래로">▼</button></span>
            <span class="hint">새로 추가하려면 맨 아래 빈칸에 입력하면 됩니다.<br>삭제는 내용을 비워 두면 됩니다.</span>
            <button type="button" class="btn small" data-reset="t1">기본값 복원</button></div>
        </section>
        <section class="th-box">
          <table class="th-tbl"><thead><tr><th>7대 안전</th><th>중분류 <small>(쉼표로 연결 가능)</small></th><th class="h">기준시수</th></tr></thead><tbody>${right}</tbody>
            <tfoot><tr><th colspan="2">합계 (왼쪽 '(7대 안전)' 시수로 자동 반영)</th><td class="h"><b>${sSum}</b></td></tr></tfoot></table>
          <div class="th-foot"><span class="th-mv"><button type="button" class="btn small" data-mv="t2:-1" title="위로">▲</button><button type="button" class="btn small" data-mv="t2:1" title="아래로">▼</button></span>
            <span class="hint">중분류는 쉼표로 구분해서 입력하면 됩니다.<br>새로 추가하려면 맨 아래 빈칸에 입력하면 됩니다.</span>
            <button type="button" class="btn small" data-reset="t2">기본값 복원</button></div>
        </section>
      </div>
      <p class="hint">※ 학교 실정에 맞게 고칠 수 있습니다. 줄을 누른 뒤 ▲▼로 순서를 바꿉니다.</p>`;
  }

  /** 작년(학년도 − 1) 범교과 설정 찾기: ① 이 문서에 남겨 둔 학년도별 사본 ② 클라우드의 작년 교육과정 문서 */
  async function prevYearEnv() {
    const y = Number(state.school.year) - 1;
    const arch = state.envArchive && state.envArchive[y];
    if (arch) return { env: arch, from: `이 문서의 ${y}학년도 기록` };
    if (window.Cloud && Cloud.ready && Cloud.listPlans) {
      const plans = (await Cloud.listPlans()).filter(p => Number(p.year) === y);
      for (const p of plans) {
        try { const s = JSON.parse(p.stateJson || '{}'); if (s.env) return { env: s.env, from: `'${p.title || '교육과정'}' (${y}학년도)` }; } catch (e) { /* 다음 문서 */ }
      }
    }
    return null;
  }
  async function loadPrevThemes() {
    const y = Number(state.school.year) - 1;
    let found;
    try { found = await prevYearEnv(); } catch (e) { alert('작년 자료를 찾지 못했습니다: ' + e.message); return; }
    if (!found || !found.env.themeCfg) { alert(`${y}학년도 범교과-주제어 자료가 없습니다.\n(${y}학년도에 이 사이트에서 설정한 자료가 있으면 불러올 수 있습니다.)`); return; }
    if (!confirm(`${found.from}의 범교과-주제어 설정을 불러올까요?\n지금 화면의 내용은 바뀝니다.`)) return;
    env().themeCfg = clone(found.env.themeCfg); selT1 = selT2 = -1;
    changed(); render();
  }

  /* ---------- 일과시간 (스쿨마스터 '일과시간 설정' + 빠른 설정·하루 흐름 막대) ----------
   *  env.bellCfg = { mode:'same'|'grade', same:{ periods:[{start,end}×10] }, byGrade:{학년:{periods}}, gen:{start,len,brk,lunchAfter,lunchLen,count}, push:true }
   *  env.bell.rows 는 전학년(또는 1학년) 시각을 교시 줄로 옮겨 둔 것 → 시간표 화면·선생님 공유에 씀 */
  const MAXP = 10;
  const emptyPeriods = () => Array.from({ length: MAXP }, () => ({ start: '', end: '' }));
  function genPeriods(g) {
    const out = emptyPeriods(); let t = t2m(g.start);
    for (let p = 1; p <= Math.min(MAXP, Number(g.count) || 6); p++) {
      out[p - 1] = { start: m2t(t), end: m2t(t + Number(g.len)) };
      t += Number(g.len) + (p === Number(g.lunchAfter) ? Number(g.lunchLen) : Number(g.brk));
    }
    return out;
  }
  function bellCfg() {
    const e = env();
    if (!e.bellCfg) {
      const gen = { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunchLen: 50, count: 6 };
      // 예전 설정(교시 줄)이 있으면 옮겨 옴
      const old = ((e.bell && e.bell.rows) || []).filter(r => r.kind === 'class');
      const periods = emptyPeriods();
      if (old.length) old.slice(0, MAXP).forEach((r, i) => { periods[i] = { start: r.start, end: r.end }; });
      e.bellCfg = { mode: 'same', same: { periods: old.length ? periods : genPeriods(gen) }, byGrade: {}, gen, push: true };
    }
    return e.bellCfg;
  }
  let bellGrade = 1, bellDirty = false;
  function bellSet() {
    const c = bellCfg();
    if (c.mode !== 'grade') return c.same;
    if (!c.byGrade[bellGrade]) c.byGrade[bellGrade] = clone(c.same);
    return c.byGrade[bellGrade];
  }
  /** 시간표 화면과 선생님 공유용 교시 줄 갱신 */
  function syncBellRows() {
    const c = bellCfg(), set = c.mode === 'grade' ? (c.byGrade[1] || c.same) : c.same, e = env();
    e.bell = e.bell || {};
    e.bell.rows = set.periods.map((p, i) => ({ label: `${i + 1}교시`, start: p.start, end: p.end, kind: 'class' })).filter(r => r.start && r.end);
  }
  function bellCheck(periods) {
    const issues = {};
    periods.forEach((p, i) => {
      if (!p.start || !p.end) return;
      if (t2m(p.end) <= t2m(p.start)) issues[i] = '끝나는 시각이 시작보다 빠릅니다';
      const prev = periods.slice(0, i).reverse().find(x => x.start && x.end);
      if (prev && t2m(p.start) < t2m(prev.end)) issues[i] = '앞 교시와 시간이 겹칩니다';
    });
    return issues;
  }

  function paneBell() {
    const c = bellCfg(), set = bellSet(), g = c.gen, ps = set.periods, issues = bellCheck(ps);
    const used = ps.map((p, i) => ({ ...p, n: i + 1 })).filter(p => p.start && p.end);
    const first = used.length ? t2m(used[0].start) : 540, last = used.length ? t2m(used[used.length - 1].end) : 900;
    const span = Math.max(60, last - first);
    const pct = m => ((m - first) / span * 100).toFixed(2);
    const hours = []; for (let h = Math.ceil(first / 60); h * 60 <= last; h++) hours.push(h);
    const teach = used.reduce((t, p) => t + Math.max(0, t2m(p.end) - t2m(p.start)), 0);
    const gapAfter = i => { const p = ps[i], nx = ps.slice(i + 1).find(x => x.start && x.end); if (!p.end || !nx) return null; return t2m(nx.start) - t2m(p.end); };
    const row = i => {
      const p = ps[i], dur = p.start && p.end ? t2m(p.end) - t2m(p.start) : null, gap = gapAfter(i);
      return `<div class="bl-row${issues[i] ? ' bad' : ''}${p.start ? '' : ' off'}">
          <span class="bl-n">${i + 1}<small>교시</small></span>
          <input type="time" step="300" data-bp="${i}" data-f="start" value="${p.start}" aria-label="${i + 1}교시 시작">
          <span class="bl-tilde">~</span>
          <input type="time" step="300" data-bp="${i}" data-f="end" value="${p.end}" aria-label="${i + 1}교시 끝">
          <span class="bl-dur">${dur !== null && dur > 0 ? dur + '분' : ''}</span>
          ${p.start || p.end ? `<button type="button" class="x" data-bclear="${i}" title="${i + 1}교시 비우기">✕</button>` : '<span></span>'}
          ${issues[i] ? `<em class="bl-warn">${issues[i]}</em>` : ''}
        </div>${gap !== null && gap > 0 ? `<div class="bl-gap${gap >= 30 ? ' lunch' : ''}">${gap >= 30 ? '점심' : '쉬는 시간'} ${gap}분</div>` : ''}`;
    };
    return `<div class="env-head"><h2>일과시간 설정</h2><span class="hint">정한 시각은 시간표 편성·시간표 배치·한국어학급 운영 시간표의 교시 칸에 나옵니다</span></div>
      <div class="th-top">
        <div class="th-mode" role="radiogroup">
          <label><input type="radio" name="blMode" value="same" ${c.mode !== 'grade' ? 'checked' : ''}> 전학년 동일하게</label>
          <label><input type="radio" name="blMode" value="grade" ${c.mode === 'grade' ? 'checked' : ''}> 학년별로 다르게</label>
        </div>
        ${c.mode === 'grade' ? `<div class="th-grades">${GRADES.map(x => `<button type="button" class="${x === bellGrade ? 'on' : ''}" data-blg="${x}">${x}학년</button>`).join('')}</div>` : ''}
        <button type="button" class="btn th-prev" data-act="bl-prev">작년자료 불러오기</button>
      </div>

      <section class="bl-quick">
        <h3>빠른 설정 <small>숫자만 넣고 '적용'을 누르면 ${c.mode === 'grade' ? `${bellGrade}학년` : '전학년'} 교시 시각이 한 번에 채워집니다</small></h3>
        <div class="bl-quick-row">
          <label>1교시 시작<input type="time" step="300" data-bg="start" value="${g.start}"></label>
          <label>수업<span class="bl-num"><input type="number" min="20" max="90" step="5" data-bg="len" value="${g.len}">분</span></label>
          <label>쉬는 시간<span class="bl-num"><input type="number" min="0" max="60" step="5" data-bg="brk" value="${g.brk}">분</span></label>
          <label>점심<span class="bl-num"><input type="number" min="1" max="${MAXP}" data-bg="lunchAfter" value="${g.lunchAfter}">교시 뒤</span></label>
          <label>점심 시간<span class="bl-num"><input type="number" min="0" max="120" step="5" data-bg="lunchLen" value="${g.lunchLen}">분</span></label>
          <label>교시 수<span class="bl-num"><input type="number" min="1" max="${MAXP}" data-bg="count" value="${g.count}">교시</span></label>
          <button type="button" class="btn primary" data-act="bl-gen">적용</button>
        </div>
      </section>

      <section class="bl-day">
        <div class="bl-day-h"><b>하루 흐름</b>
          <span class="bl-sum"><em>${used.length}개 교시</em><em>수업 ${Math.floor(teach / 60)}시간${teach % 60 ? ' ' + (teach % 60) + '분' : ''}</em><em>등교 ${used.length ? used[0].start : '-'}</em><em>하교 ${used.length ? used[used.length - 1].end : '-'}</em></span></div>
        <div class="bl-track-wrap">
          <div class="bl-track">
            ${used.map((p, k) => { const nx = used[k + 1]; const gap = nx ? t2m(nx.start) - t2m(p.end) : 0;
              return `<span class="bl-blk" style="left:${pct(t2m(p.start))}%;width:${((t2m(p.end) - t2m(p.start)) / span * 100).toFixed(2)}%" title="${p.n}교시 ${p.start}~${p.end}">${p.n}<small>교시</small></span>` +
                (gap >= 30 ? `<span class="bl-lunch" style="left:${pct(t2m(p.end))}%;width:${(gap / span * 100).toFixed(2)}%" title="점심 ${gap}분">점심</span>` : ''); }).join('')}
          </div>
          <div class="bl-axis">${hours.map(h => `<span style="left:${pct(h * 60)}%">${h}시</span>`).join('')}</div>
        </div>
      </section>
      <section class="bl-list">
        <div class="bl-list-h"><b>교시별 시각</b>
          <label class="bl-push"><input type="checkbox" data-bpush ${c.push !== false ? 'checked' : ''}> 시각을 바꾸면 뒤 교시도 함께 밀기</label></div>
        <div class="bl-cols">${[0, 1, 2, 3, 4].map(row).join('')}</div>
        <div class="bl-cols">${[5, 6, 7, 8, 9].map(row).join('')}</div>
      </section>`;
  }

  async function loadPrevBell() {
    const y = Number(state.school.year) - 1;
    let found;
    try { found = await prevYearEnv(); } catch (e) { alert('작년 자료를 찾지 못했습니다: ' + e.message); return; }
    if (!found || !found.env.bellCfg) { alert(`${y}학년도 일과시간 자료가 없습니다.\n(${y}학년도에 이 사이트에서 설정한 자료가 있으면 불러올 수 있습니다.)`); return; }
    if (!confirm(`${found.from}의 일과시간을 불러올까요?\n지금 화면의 시각은 바뀝니다.`)) return;
    env().bellCfg = clone(found.env.bellCfg);
    syncBellRows(); changed(); render();
  }

  /* ---------- 고치기 ---------- */
  const root = $('tab-env');
  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-pane]');
    if (nav) { pane = nav.dataset.pane; sessionStorage.setItem('envPane', pane); render(); return; }
    if (e.target.closest('[data-goroom]')) { e.preventDefault(); pane = 'room'; sessionStorage.setItem('envPane', pane); render(); return; }
    if (ro()) return;
    const E = env();
    // 특별실·전담 목록: 줄 고르기 / 설정·이름 변경 모드 / 추가·삭제
    const pick = e.target.closest('[data-pick]');
    if (pick && !e.target.closest('input, select') && !e.target.closest('[data-smrow]')) {
      const [k, i] = pick.dataset.pick.split(':');
      if (k === 'room') selRoom = Number(i); else selT = Number(i);
      render();
      const r = root.querySelector(`[data-rename="${k}:${i}"]`); if (r) { r.focus(); r.select(); }
      return;
    }
    const md = e.target.closest('[data-mode]');
    if (md) {
      const [k, m] = md.dataset.mode.split(':');
      if (k === 'room') modeRoom = modeRoom === m ? '' : m; else modeT = modeT === m ? '' : m;
      render();
      const f = root.querySelector(m === 'set' ? `[data-newname="${k}"]` : `[data-rename^="${k}:"]`); if (f) { f.focus(); if (f.select) f.select(); }
      return;
    }
    // 범교과-주제어: 학년 고르기 · ▲▼ · 기본값 복원 · 작년자료
    const tg = e.target.closest('[data-thg]'); if (tg) { themeGrade = Number(tg.dataset.thg); selT1 = selT2 = -1; render(); return; }
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const [k, d] = mv.dataset.mv.split(':'), set = themeSet(), arr = k === 't1' ? set.topics : set.safety;
      const i = k === 't1' ? selT1 : selT2, j = i + Number(d);
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      if (k === 't1') selT1 = j; else selT2 = j;
      changed(); render(); return;
    }
    const rs = e.target.closest('[data-reset]');
    if (rs) {
      if (!confirm('기본값으로 되돌릴까요? 고친 내용은 사라집니다.')) return;
      const set = themeSet();
      if (rs.dataset.reset === 't1') { set.topics = clone(DEF_TOPICS); selT1 = -1; } else { set.safety = clone(DEF_SAFETY); selT2 = -1; }
      changed(); render(); return;
    }
    if (e.target.closest('[data-act="th-prev"]')) { loadPrevThemes(); return; }
    // 일과시간
    const bg = e.target.closest('[data-blg]'); if (bg) { bellGrade = Number(bg.dataset.blg); render(); return; }
    if (e.target.closest('[data-act="bl-prev"]')) { loadPrevBell(); return; }
    if (e.target.closest('[data-act="bl-gen"]')) {
      const set = bellSet();
      if (set.periods.some(p => p.start) && !confirm('빠른 설정 값으로 교시 시각을 모두 다시 채울까요?')) return;
      set.periods = genPeriods(bellCfg().gen); syncBellRows(); changed(); render(); return;
    }
    const bc = e.target.closest('[data-bclear]');
    if (bc) { bellSet().periods[Number(bc.dataset.bclear)] = { start: '', end: '' }; syncBellRows(); changed(); render(); return; }
    const sa = e.target.closest('[data-smadd]'); if (sa) { smAdd(sa.dataset.smadd); return; }
    const sd = e.target.closest('[data-smdel]'); if (sd) { smDel(sd.dataset.smdel); return; }
    const sr = e.target.closest('[data-smrow]'); if (sr) { const [k, i] = sr.dataset.smrow.split(':'); if (k === 'room') selRoom = Number(i); else selT = Number(i); smDel(k); return; }
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add) {
      if (add === 'special') E.special.push({ name: '', teacher: '', students: 0 });
      if (add === 'room') E.rooms.push({ name: '', note: '' });
      if (add === 'theme') E.themes.push({ name: '', keywords: '', subjects: '', hours: {} });
      if (add === 'bell') { const last = E.bell.rows[E.bell.rows.length - 1]; const s = last ? t2m(last.end) : t2m(E.bell.start); E.bell.rows.push({ label: '', start: m2t(s), end: m2t(s + 40), kind: 'etc' }); }
      if (add === 'jd') {
        const last = state.jundam[state.jundam.length - 1];
        const g = [last && Number(last.grade), 3, 4, 5, 6, 1, 2].find(x => x && jdSubjOf(x).length) || 3;
        const subj = (last && Number(last.grade) === g && jdSubjOf(g).some(s => s.key === last.subj) ? last.subj : (jdSubjOf(g)[0] || subjectsOf(g)[0]).key);
        const row = { teacher: last ? last.teacher : '', grade: g, subj, hrs: 2, room: '' }; fitRoom(row); state.jundam.push(row);
      }
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
    if (d.tc !== undefined) { E.teachers[d.tc].teacher = v.trim(); changed(); return; }
    if (d.jdsub) {
      const on = t.checked, k = d.jdsub;
      if (!on) { const used = state.jundam.filter(r => r.subj === k).length;
        if (used && !confirm(`'${subjName(k)}'을(를) 전담 교과에서 뺄까요?\n이미 배정된 ${used}줄은 그대로 남습니다.`)) { t.checked = true; return; } }
      E.jdSubjects = on ? [...new Set([...E.jdSubjects, k])] : E.jdSubjects.filter(x => x !== k);
      E.jdSubjects.sort((a, b) => allSubj().findIndex(s => s.key === a) - allSubj().findIndex(s => s.key === b));
      changed(); render(); return;
    }
    if (d.rsubj !== undefined) { E.rooms[d.rsubj].subj = v; state.jundam.forEach(fitRoom); changed(); render(); return; }
    if (d.sp) { E.special[d.sp][d.f] = d.f === 'students' ? Number(v) || 0 : v.trim(); changed(); render(); return; }
    if (d.room) { const old = E.rooms[d.room].name; E.rooms[d.room][d.f] = v.trim(); if (d.f === 'name') state.jundam.forEach(r => { if (r.room === old) r.room = v.trim(); }); changed(); return; }
    if (d.jdr) {
      const r = state.jundam[d.jdr];
      if (d.f === 'grade') {
        r.grade = Number(v); r.classes = [];
        const ok = jdSubjOf(r.grade); if (!ok.some(s => s.key === r.subj)) r.subj = (ok[0] || subjectsOf(r.grade)[0]).key;
        fitRoom(r);
      }
      else if (d.f === 'hrs') r.hrs = Number(v) || 0;
      else { r[d.f] = v; if (d.f === 'subj') fitRoom(r); }
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
    if (d.pub) {
      let val = v;
      if (val === '__etc') { val = (prompt('출판사 이름을 입력하세요') || '').trim(); if (!val) { render(); return; } }
      (E.books[d.pub] = E.books[d.pub] || {})[d.s] = val; changed(); render(); return;
    }
    if (t.name === 'blMode') { const c = bellCfg(); c.mode = v; if (v === 'grade') bellSet(); syncBellRows(); changed(); render(); return; }
    if (d.bg) { const gg = bellCfg().gen; gg[d.bg] = t.type === 'number' ? Math.max(0, Number(v) || 0) : v; changed(); return; }
    if (d.bpush !== undefined) { bellCfg().push = t.checked; changed(); return; }
    if (d.bp !== undefined) {
      // 시각 고치기: '뒤 교시도 함께 밀기'면 바뀐 만큼 뒤 교시를 모두 옮김. 시작만 넣으면 끝은 수업 시간만큼 자동
      const c = bellCfg(), ps = bellSet().periods, i = Number(d.bp), p = ps[i], old = p[d.f];
      p[d.f] = v;
      if (d.f === 'start' && v && !p.end) p.end = m2t(t2m(v) + Number(c.gen.len || 40));
      if (old && v && c.push !== false) {
        const delta = t2m(v) - t2m(old);
        if (delta) {
          if (d.f === 'start' && p.end) p.end = m2t(t2m(p.end) + delta);
          ps.slice(i + 1).forEach(x => { if (x.start) x.start = m2t(t2m(x.start) + delta); if (x.end) x.end = m2t(t2m(x.end) + delta); });
        }
      }
      syncBellRows(); changed(); bellDirty = true;   // 칸을 벗어날 때 다시 그림(입력 중 끊김 방지)
      return;
    }
    if (t.name === 'thMode') { const c = themeCfg(); c.mode = v; if (v === 'grade') themeSet(); selT1 = selT2 = -1; changed(); render(); return; }
    if (d.t1 !== undefined || d.t2 !== undefined) {
      // 맨 아래 빈 줄에 쓰면 추가, 한 줄을 모두 비우면 삭제
      const k = d.t1 !== undefined ? 't1' : 't2', i = Number(d[k]), set = themeSet();
      const arr = k === 't1' ? set.topics : set.safety;
      const val = d.f === 'hours' ? (v === '' ? '' : Number(v) || 0) : v.trim();
      if (i >= arr.length) { if (val === '') return; arr.push(k === 't1' ? { topic: '', sub: '', hours: '' } : { name: '', mid: '', hours: '' }); }
      arr[i][d.f] = val;
      const row = arr[i], empty = k === 't1' ? !row.topic && !row.sub && row.hours === '' : !row.name && !row.mid && row.hours === '';
      if (empty) { arr.splice(i, 1); if (k === 't1') selT1 = -1; else selT2 = -1; }
      changed(); renderKeepFocus(); return;
    }
    if (d.bell) { E.bell[d.bell] = t.type === 'number' ? Number(v) || 0 : v; changed(); return; }
    if (d.br) { E.bell.rows[d.br][d.f] = v; changed(); render(); return; }
  });

  // 칸을 고친 뒤 Tab·클릭으로 옮겨 간 칸에 커서를 그대로 둔 채 다시 그림(합계 갱신)
  function renderKeepFocus() {
    setTimeout(() => {
      const a = document.activeElement, ds = a && a.dataset;
      const sel = ds && ds.f && (ds.t1 !== undefined ? `[data-t1="${ds.t1}"][data-f="${ds.f}"]` : ds.t2 !== undefined ? `[data-t2="${ds.t2}"][data-f="${ds.f}"]` : null);
      render();
      const n = sel && root.querySelector(sel); if (n) n.focus();
    }, 0);
  }
  // 범교과 표: 줄의 칸을 누르면 그 줄을 고름(▲▼ 대상) — 다시 그리지 않고 표시만 바꿈
  root.addEventListener('focusin', e => {
    const tr = e.target.closest('[data-row]'); if (!tr || tr.classList.contains('blank')) return;
    const [k, i] = tr.dataset.row.split(':');
    if (k === 't1') selT1 = Number(i); else selT2 = Number(i);
    tr.parentElement.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); tr.classList.add('sel');
  });
  // 일과시간: 시각 칸을 벗어나면 다시 그리고, 옮겨 간 칸에 커서를 둠
  root.addEventListener('focusout', e => {
    if (e.target.dataset.bp === undefined || !bellDirty) return;
    setTimeout(() => {
      if (!bellDirty) return; bellDirty = false;
      const a = document.activeElement, ds = a && a.dataset;
      const sel = ds && ds.bp !== undefined ? `[data-bp="${ds.bp}"][data-f="${ds.f}"]` : null;
      render();
      const n = sel && root.querySelector(sel); if (n) n.focus();
    }, 0);
  });
  // Enter: 새 이름 추가 / 이름 변경 확정, Esc: 이름 변경 취소
  root.addEventListener('keydown', e => {
    const d = e.target.dataset;
    if (e.key === 'Enter' && d.newname) { e.preventDefault(); smAdd(d.newname); }
    if (e.key === 'Enter' && d.rename) { e.preventDefault(); const [k, i] = d.rename.split(':'); smRename(k, Number(i), e.target.value); }
    if (e.key === 'Escape' && d.rename) { if (d.rename.startsWith('room')) modeRoom = ''; else modeT = ''; render(); }
  });
  root.addEventListener('focusout', e => {
    const d = e.target.dataset;
    if (d.rename && e.target.isConnected) { const [k, i] = d.rename.split(':'); smRename(k, Number(i), e.target.value); }
  });

  RENDER.env = render;
})();
