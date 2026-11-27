/* =========================================================
 * 학교 일지 작성 (교무부장만)
 *  - dailyLogs/{YYYY-MM-DD} { notice, events, guidance, duty:{p,v,a:{today,plan}}, text, by, byName, updatedAt }
 *    text 는 항목을 이어 붙인 글(예전 화면·검색용)
 *  - 작성: 직위가 '교무부장'인 선생님 (개발자는 관리용으로 함께 허용) → HOME에서 선생님들이 조회
 *  - 한글 파일로 저장(.hwpx) · 한글 파일(.hwp/.hwpx) 불러와 항목별로 채우기 (hwpx.js)
 * ========================================================= */
(function () {
  'use strict';
  let day = fmt(new Date());
  let unsubDay = null, subDay = null, current;
  let dirty = false;

  const PEOPLE = [['p', '교장'], ['v', '교감'], ['a', '행정실장']];
  const SECS = [['notice', '전달사항'], ['events', '주요행사 및 교육활동'], ['guidance', '생활지도 및 안전지도'], ['cover', '결보강'], ['preview', '교육활동 예고'], ['lecture', '외부강의 확인']];
  const KEYS = SECS.map(([k]) => k);
  // 일지 작성: 직위가 교무부장인 선생님 (개발자는 '개발자' 권한으로 볼 때만)
  const isWriter = () => !!(window.Cloud && Cloud.ready && (
    (Cloud.position && Cloud.position.head === '교무부장') || (Cloud.developer && !Cloud.viewRole && sessionStorage.getItem('viewRole') !== 'operator')));
  TAB_GUARDS.log = () => isWriter();
  window.LogRoles = { isWriter };
  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);

  /* ---------- 관리자 복무: 상태 + 시간 + 장소 ----------
   * duty[k] = { status, from, to, note, plan, today(이어 붙인 글 — 한글 파일·예전 화면용) } */
  const STATUS = ['정상 근무', '출장', '연가', '조퇴', '외출', '병가', '공가', '교육', '기타'];
  const Duty = {
    STATUS,
    /** "출장 14:00~16:30 (교육청)" */
    text(d) {
      if (!d) return '';
      if (!d.status && !d.from && !d.to && !d.note) return d.today || '';
      const time = d.from || d.to ? `${d.from || ''}~${d.to || ''}` : '';
      return [d.status, time, d.note ? `(${d.note})` : ''].filter(Boolean).join(' ');
    },
    /** 글(한글 파일·예전 자료) → { status, from, to, note } */
    parse(t) {
      t = String(t || '').trim(); if (!t) return { status: '', from: '', to: '', note: '' };
      const m = t.match(/(\d{1,2})[:시]\s*(\d{2})?\s*분?\s*[~\-–부터]+\s*(\d{1,2})?[:시]?\s*(\d{2})?/);
      const rest = (m ? t.replace(m[0], '') : t).replace(/[()\s]/g, '');
      const st = STATUS.find(s => t.replace(/\s/g, '').includes(s.replace(/\s/g, ''))) || (/정상|근무/.test(t) ? '정상 근무' : rest ? '기타' : '');
      const hm = (h, mm) => h ? `${String(h).padStart(2, '0')}:${mm || '00'}` : '';
      let note = t.replace(st.replace(' ', ''), '').replace(st, '');
      if (m) note = note.replace(m[0], '');
      note = note.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      return { status: st, from: m ? hm(m[1], m[2]) : '', to: m ? hm(m[3], m[4]) : '', note: st === '기타' && !m ? t : note };
    },
    /** 저장된 값 → 화면용 */
    of(d) { d = d || {}; const p = ('status' in d || 'from' in d) ? d : { ...Duty.parse(d.today), plan: d.plan }; return { status: p.status || '', from: p.from || '', to: p.to || '', note: p.note || '', plan: d.plan || '', today: Duty.text(p) }; },
  };
  window.Duty = Duty;

  /* ---------- 보결: [{ cls:'3-1', periods:[2,3], teacher:'영어전담' }] → "3-1 2·3교시 → 영어전담" ---------- */
  const coverText = list => (list || []).filter(c => c.cls).map(c => `${c.cls} ${(c.periods || []).slice().sort((a, b) => a - b).join('·')}${(c.periods || []).length ? '교시' : ''} → ${c.teacher || '미정'}`).join('\n');
  window.CoverText = coverText;

  /** 저장된 문서 → 항목 (예전처럼 text 만 있으면 전달사항으로) */
  function fieldsOf(doc) {
    const d = doc || {}, duty = d.duty || {};
    const f = { duty: {}, covers: Array.isArray(d.covers) ? d.covers : [] }; KEYS.forEach(k => { f[k] = d[k] || ''; });
    PEOPLE.forEach(([k]) => { f.duty[k] = Duty.of(duty[k]); });
    if (f.covers.length) f.cover = coverText(f.covers);   // 보결 관리에서 입력한 내용이 결보강이 됨
    if (!KEYS.some(k => d[k]) && !d.duty && d.text) f.notice = d.text;
    return f;
  }
  /** 항목 → 이어 붙인 글 */
  function textOf(f) {
    const parts = SECS.filter(([k]) => f[k].trim()).map(([k, n]) => `[${n}]\n${f[k].trim()}`);
    const duty = PEOPLE.filter(([k]) => f.duty[k].today || f.duty[k].plan)
      .map(([k, n]) => `${n}: ${f.duty[k].today || '-'}${f.duty[k].plan ? ` (예정: ${f.duty[k].plan})` : ''}`);
    if (duty.length) parts.push('[근무상황]\n' + duty.join('\n'));
    return parts.join('\n\n');
  }
  const isEmpty = f => !textOf(f).trim();

  // 복무 입력 줄: 시작~끝 시각 | 예정
  $('lgDutyBody').innerHTML = PEOPLE.map(([k, n]) => `<tr><th>${n}</th>
    <td><span class="dt-time"><input type="time" data-duty="${k}.from" step="600" aria-label="${n} 시작 시각"><i>~</i><input type="time" data-duty="${k}.to" step="600" aria-label="${n} 끝 시각"></span></td>
    <td><textarea data-duty="${k}.plan" rows="2" maxlength="500"></textarea></td></tr>`).join('');

  let covers = [];   // 지금 날짜의 보결 (보결 관리에서 입력)
  function readForm() {
    const f = { duty: {}, covers };
    document.querySelectorAll('#lgForm [data-lg]').forEach(t => { f[t.dataset.lg] = t.value.replace(/\s+$/, ''); });
    PEOPLE.forEach(([k]) => { f.duty[k] = { status: '', from: '', to: '', note: '', plan: '' }; });
    document.querySelectorAll('#lgForm [data-duty]').forEach(t => { const [k, s] = t.dataset.duty.split('.'); f.duty[k][s] = t.value.trim(); });
    PEOPLE.forEach(([k]) => { f.duty[k].today = Duty.text(f.duty[k]); });
    if (covers.length) f.cover = coverText(covers);
    return f;
  }
  function fillForm(f) {
    covers = Array.isArray(f.covers) ? f.covers : covers;
    document.querySelectorAll('#lgForm [data-lg]').forEach(t => { t.value = f[t.dataset.lg] || ''; });
    document.querySelectorAll('#lgForm [data-duty]').forEach(t => { const [k, s] = t.dataset.duty.split('.'); const d = Duty.of(f.duty && f.duty[k]); t.value = d[s] || ''; });
    // 보결 관리에 입력이 있으면 결보강은 그 내용(여기서는 고치지 않음)
    const cov = document.querySelector('#lgForm [data-lg="cover"]');
    cov.readOnly = covers.length > 0; cov.classList.toggle('from-cover', covers.length > 0);
    if (covers.length) cov.value = coverText(covers);
  }

  function refreshNav() {
    $('navLog').hidden = !isWriter();
    if (curTab === 'log' && !isWriter()) showTab('home');
  }

  function stopDay() { if (unsubDay) unsubDay(); unsubDay = null; subDay = null; current = undefined; }
  function watchDay() {
    if (unsubDay && subDay === day) return;
    stopDay(); subDay = day;
    unsubDay = Cloud.fb.F.onSnapshot(ref(day), d => { current = d.exists() ? d.data() : null; if (!dirty) renderEditor(); },
      e => { $('lgStatus').textContent = '불러오기 실패: ' + e.message; });
  }

  function renderEditor() {
    $('lgDate').value = day;
    $('lgTitle').innerHTML = HomeLog.longDate(day) + (day === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : '');
    if (current === undefined) { fillForm(fieldsOf(null)); $('lgStatus').textContent = '불러오는 중…'; return; }
    if (!dirty) fillForm(fieldsOf(current));
    $('lgDelete').hidden = !current;
    if (!dirty) $('lgStatus').textContent = current
      ? '저장된 일지입니다.' : '아직 작성하지 않은 날입니다.';
  }

  async function renderRecent() {
    try {
      const days = await HomeLog.recentDays(14);
      $('lgRecent').innerHTML = days.length ? days.map(ds => { const d = parse(ds); return `<button class="chip-btn${ds === day ? ' on' : ''}" data-day="${ds}">${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})</button>`; }).join('')
        : '<span class="hint">최근 60일 동안 작성한 일지가 없습니다.</span>';
    } catch (e) { $('lgRecent').textContent = '목록을 불러오지 못했습니다.'; }
  }

  function render() {
    if (!isWriter()) return;
    watchDay(); renderEditor(); renderRecent();
  }

  function go(ds) {
    if (dirty && !confirm('저장하지 않은 일지 내용이 있습니다. 다른 날짜로 이동할까요?')) { $('lgDate').value = day; return; }
    day = ds; dirty = false; render();
  }

  async function save() {
    if (!isWriter()) return '일지는 교무부장만 저장할 수 있습니다.';
    const f = readForm();
    if (isEmpty(f)) { $('lgStatus').textContent = '내용을 입력하세요.'; return '내용을 입력하세요.'; }
    const F = Cloud.fb.F;
    $('lgSave').disabled = true;
    try {
      await F.setDoc(ref(day), { ...Object.fromEntries(KEYS.map(k => [k, f[k] || ''])), duty: f.duty, covers, text: textOf(f).slice(0, 20000),
        by: Cloud.email, byName: Cloud.profileName || '', updatedAt: F.serverTimestamp() });
      dirty = false; renderEditor(); $('lgStatus').textContent = '저장했습니다. 선생님들이 HOME에서 볼 수 있습니다.';
      renderRecent(); HomeLog.refreshRecent();
      return '';
    } catch (e) { $('lgStatus').textContent = '저장 실패: ' + e.message; return '저장에 실패했습니다: ' + e.message; }
    finally { $('lgSave').disabled = false; }
  }
  async function remove() {
    if (!isWriter() || !confirm(`${HomeLog.longDate(day)} 일지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await Cloud.fb.F.deleteDoc(ref(day)); dirty = false; fillForm(fieldsOf(null)); $('lgStatus').textContent = '삭제했습니다.'; renderRecent(); HomeLog.refreshRecent(); }
    catch (e) { $('lgStatus').textContent = '삭제 실패: ' + e.message; }
  }

  /** 한글 파일로 저장 — 화면에 적힌 내용(저장 전이어도) 그대로, 우리 학교 일지 양식에 채움. 학적현황은 학교 현황 자료로 */
  async function getStats() {
    if (window.SchoolStatus && SchoolStatus.stats) return SchoolStatus.stats;
    try { const d = await Cloud.fb.F.getDoc(Cloud.fb.F.doc(Cloud.fb.db, 'config', 'stats')); return d.exists() ? d.data() : null; } catch (e) { return null; }
  }
  async function exportHwp(f, ds) {
    const blob = await Hwp.logHwpx(f, { date: ds, stats: await getStats() });
    Hwp.download(blob, `${HomeLog.longDate(ds).replace(/ \((.)\)/, '($1)')} 학교일지.hwpx`);
  }
  window.LogExport = { fieldsOf, exportHwp };

  /** 한글 파일 넣기: 항목별로 채움. 파일의 날짜가 지금 고른 날과 다르면 그 날짜로 옮길지 물음 */
  async function importHwp(file) {
    if (!file) return;
    if (!isWriter()) return;
    if (!/\.(hwp|hwpx)$/i.test(file.name)) { $('lgStatus').textContent = '한글 파일(.hwp, .hwpx)만 넣을 수 있습니다.'; return; }
    $('lgStatus').textContent = `'${file.name}' 읽는 중…`;
    try {
      const f = Hwp.parseLog(await Hwp.readBlocks(file));
      if (isEmpty(f)) { $('lgStatus').textContent = '이 파일에서 일지 항목(전달사항·주요행사·생활지도·근무상황 등)을 찾지 못했습니다.'; return; }
      if (f.date && f.date !== day && confirm(`파일의 날짜는 ${HomeLog.longDate(f.date)}입니다. 그 날짜의 일지로 넣을까요?\n(취소하면 지금 보고 있는 ${HomeLog.longDate(day)}에 넣습니다)`)) {
        if (dirty && !confirm('지금 화면에 저장하지 않은 내용이 있습니다. 버리고 옮길까요?')) { $('lgStatus').textContent = '넣기를 취소했습니다.'; return; }
        const old = await Cloud.fb.F.getDoc(ref(f.date));
        if (old.exists() && !confirm(`${HomeLog.longDate(f.date)}에 이미 저장된 일지가 있습니다. 파일 내용으로 바꿀까요? (저장을 눌러야 바뀝니다)`)) { $('lgStatus').textContent = '넣기를 취소했습니다.'; return; }
        day = f.date; dirty = true; stopDay(); watchDay(); renderEditor(); renderRecent();
      } else {
        const cur = readForm();
        if (!isEmpty(cur) && !confirm('지금 적힌 내용을 한글 파일 내용으로 바꿀까요?')) { $('lgStatus').textContent = '넣기를 취소했습니다.'; return; }
      }
      fillForm(f); dirty = true;
      const got = [...SECS.filter(([k]) => f[k]).map(([, n]) => n), ...PEOPLE.filter(([k]) => f.duty[k].today || f.duty[k].plan).map(([, n]) => n)];
      $('lgStatus').textContent = `'${file.name}'에서 ${got.join(', ')}을(를) 넣었습니다. 확인한 뒤 저장하세요.`;
    } catch (e) { $('lgStatus').textContent = '읽기 실패: ' + e.message; }
  }
  // 끌어다 놓기: 작성 화면 어디에 놓아도 됨
  const page = $('tab-log');
  ['dragenter', 'dragover'].forEach(ev => page.addEventListener(ev, e => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('lgDrop').classList.add('over');
  }));
  page.addEventListener('dragleave', e => { if (!page.contains(e.relatedTarget)) $('lgDrop').classList.remove('over'); });
  page.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); $('lgDrop').classList.remove('over');
    importHwp(e.dataTransfer.files[0]);
  });
  $('lgDrop').addEventListener('click', () => $('lgImport').click());
  $('lgDrop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('lgImport').click(); } });

  $('lgPrev').addEventListener('click', () => go(HomeLog.stepDay(day, -1)));
  $('lgNext').addEventListener('click', () => go(HomeLog.stepDay(day, 1)));
  $('lgToday').addEventListener('click', () => go(fmt(new Date())));
  $('lgDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('lgRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });
  $('lgForm').addEventListener('input', () => { dirty = true; $('lgStatus').textContent = '저장하지 않은 변경이 있습니다.'; });
  $('lgSave').addEventListener('click', save);
  window.LogSave = () => (dirty || !current ? save() : Promise.resolve(''));
  $('lgDelete').addEventListener('click', remove);
  $('lgHwp').addEventListener('click', async () => {
    const f = readForm();
    if (isEmpty(f)) { $('lgStatus').textContent = '내용이 없어 한글 파일을 만들 수 없습니다.'; return; }
    try { await exportHwp(f, day); } catch (e) { $('lgStatus').textContent = '한글 파일 만들기 실패: ' + e.message; }
  });
  $('lgImport').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; importHwp(file); });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  RENDER.log = render;
  document.addEventListener('cloud-change', () => { stopDay(); refreshNav(); document.dispatchEvent(new Event('roles-change')); });
  if (window.Cloud && Cloud.ready) refreshNav();
})();
