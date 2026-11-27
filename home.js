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
    $('logDay').innerHTML = longDate(logDate) + (logDate === fmt(new Date()) ? ' <span class="pill ok">오늘</span>' : '');
    if (!window.Cloud || !Cloud.ready) { $('logView').innerHTML = '<p class="hint">로그인하면 학교운영일지를 볼 수 있습니다.</p>'; return; }
    watch();
    const has = c => c && (c.text || ['notice', 'events', 'guidance', 'cover'].some(k => c[k]) || (c.covers || []).length);
    if (current === undefined) $('logView').innerHTML = '<p class="hint">불러오는 중…</p>';
    else if (!has(current)) $('logView').innerHTML = '<p class="log-empty">이 날 등록된 운영일지가 없습니다.</p>';
    else $('logView').innerHTML = logBody(current) + `<div class="log-foot"><span class="hint">${esc(current.byName || '')}${current.updatedAt ? ' · ' + fmtTs(current.updatedAt) : ''}</span>
      <button type="button" class="btn small" id="logHwp">한글 파일로 저장</button></div>`;
    renderRecent();
  }

  /** 일지 본문: 전달사항 · 주요행사 및 교육활동 · 생활지도 및 안전지도 · 관리자 복무 (+ 보결이 있으면) */
  function logBody(c) {
    const f = window.LogExport ? LogExport.fieldsOf(c) : c;
    if (!['notice', 'events', 'guidance', 'cover'].some(k => f[k]) && !c.duty && c.text) return `<div class="log-text">${esc(c.text)}</div>`;
    const box = (cls, title, body) => `<section class="hl-card ${cls}"><h3>${title}</h3>${body}</section>`;
    const txt = t => (t || '').trim() ? `<p>${esc(t)}</p>` : '<p class="hl-none">-</p>';
    const D = window.Duty;
    const duty = [['p', '교장'], ['v', '교감'], ['a', '행정실장']].map(([k, n]) => {
      const d = D ? D.of((c.duty || {})[k]) : { status: '', today: '' };
      return `<li><b>${n}</b><span class="hl-tm">${d.from || d.to ? `${esc(d.from)} ~ ${esc(d.to)}` : '<span class="hl-none">-</span>'}</span>
        ${d.plan ? `<small class="hl-plan">예정 · ${esc(d.plan)}</small>` : ''}</li>`;
    }).join('');
    return `<div class="hl-grid">
      ${box('hl-notice', '전달사항', txt(f.notice))}
      ${box('hl-events', '주요행사 및 교육활동', txt(f.events))}
      ${box('hl-guide', '생활지도 및 안전지도', txt(f.guidance))}
      ${box('hl-duty', '관리자 복무', `<ul class="hl-duty-list">${duty}</ul>`)}
      ${(f.cover || '').trim() ? box('hl-cover', '보결', txt(f.cover)) : ''}
    </div>`;
  }

  function go(ds) { logDate = ds; render(); }
  $('logView').addEventListener('click', async e => {
    if (!e.target.closest('#logHwp') || !current || !window.LogExport) return;
    try { await LogExport.exportHwp(LogExport.fieldsOf(current), logDate, current.byName || ''); }
    catch (err) { alert('한글 파일 만들기 실패: ' + err.message); }
  });

  $('logPrev').addEventListener('click', () => go(stepDay(logDate, -1)));
  $('logToday').addEventListener('click', () => go(fmt(new Date())));
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
