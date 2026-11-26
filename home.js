/* =========================================================
 * HOME: 학교운영일지 보기(조회 전용) + 이번 달 학사일정 넘기기
 *  - Firestore: dailyLogs/{YYYY-MM-DD} { text, by, byName, updatedAt }
 *  - 작성은 '학교 일지' 메뉴(log.js)에서 관리자·교무부장이 함
 * ========================================================= */
(function () {
  'use strict';
  let logDate = fmt(new Date());
  let unsub = null, subDate = null, current, recent = [];

  const ref = ds => Cloud.fb.F.doc(Cloud.fb.db, 'dailyLogs', ds);
  const fmtTs = ts => { try { return ts ? ts.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  const longDate = ds => { const d = parse(ds); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };

  /** 주말을 건너뛰며 하루씩 이동 */
  function stepDay(ds, dir) {
    let d = addDays(parse(ds), dir);
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, dir);
    return fmt(d);
  }

  function watch() {
    if (!window.Cloud || !Cloud.ready) { stop(); return; }
    if (unsub && subDate === logDate) return;
    if (unsub) unsub();
    subDate = logDate; current = undefined;
    unsub = Cloud.fb.F.onSnapshot(ref(logDate), d => { current = d.exists() ? d.data() : null; render(); },
      err => { console.warn('운영일지 불러오기 실패', err); current = null; render(); });
    loadRecent();
  }
  function stop() { if (unsub) unsub(); unsub = null; subDate = null; current = undefined; recent = []; }

  /** 최근 60일 일지 중 마지막 7개 (내림차순 정렬은 색인이 필요해 오름차순으로 받아 뒤집음) */
  async function recentDays(n = 7) {
    const F = Cloud.fb.F;
    const q = F.query(F.collection(Cloud.fb.db, 'dailyLogs'), F.where(F.documentId(), '>=', fmt(addDays(new Date(), -60))), F.orderBy(F.documentId()));
    return (await F.getDocs(q)).docs.map(d => d.id).slice(-n).reverse();
  }
  async function loadRecent() {
    try { recent = await recentDays(); renderRecent(); } catch (e) { console.warn('최근 운영일지 목록 실패', e); }
  }

  function renderRecent() {
    $('logRecent').innerHTML = recent.length
      ? '<span class="hint">최근 일지</span>' + recent.map(ds => `<button class="chip-btn${ds === logDate ? ' on' : ''}" data-day="${ds}">${parse(ds).getMonth() + 1}.${parse(ds).getDate()}(${WD[parse(ds).getDay()]})</button>`).join('')
      : '';
  }

  function render() {
    if (!$('logView')) return;
    $('logDate').value = logDate;
    if (!window.Cloud || !Cloud.ready) { $('logView').innerHTML = '<p class="hint">로그인하면 학교운영일지를 볼 수 있습니다.</p>'; return; }
    watch();
    const head = `<div class="log-date">${longDate(logDate)}${logDate === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : ''}</div>`;
    if (current === undefined) $('logView').innerHTML = head + '<p class="hint">불러오는 중…</p>';
    else if (!current || !current.text) $('logView').innerHTML = head + '<p class="log-empty">이 날 등록된 운영일지가 없습니다.</p>';
    else $('logView').innerHTML = head + `<div class="log-text">${esc(current.text)}</div>
      <div class="hint">작성: ${esc(current.byName || '')}${current.updatedAt ? ' · ' + fmtTs(current.updatedAt) : ''}</div>`;
    renderRecent();
  }

  function go(ds) { logDate = ds; render(); }

  $('logPrev').addEventListener('click', () => go(stepDay(logDate, -1)));
  $('logNext').addEventListener('click', () => go(stepDay(logDate, 1)));
  $('logDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('logRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });

  // 이번 달 학사일정 넘기기
  const moveMonth = n => { homeMonth = n === 0 ? null : new Date(homeMonth.getFullYear(), homeMonth.getMonth() + n, 1); renderHomeMonth(); };
  $('monthPrev').addEventListener('click', () => moveMonth(-1));
  $('monthNext').addEventListener('click', () => moveMonth(1));
  $('monthNow').addEventListener('click', () => moveMonth(0));

  document.addEventListener('cloud-change', () => { stop(); if (curTab === 'home') render(); });
  window.HomeLog = { render, stepDay, longDate, fmtTs, recentDays, refreshRecent: () => { if (Cloud.ready) loadRecent(); } };
})();
