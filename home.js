/* =========================================================
 * HOME: 학교운영일지 보기(조회 전용) + 이번 달 학사일정 넘기기
 *  - Firestore: dailyLogs/{YYYY-MM-DD} { text, by, byName, updatedAt }
 *  - 작성은 '학교 일지' 메뉴(log.js)에서 관리자·교무부장이 함
 * ========================================================= */
(function () {
  'use strict';
  let logDate = OperatingCalendar.activeDate();
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
    const watchedDate = logDate;
    unsub = Cloud.fb.F.onSnapshot(ref(logDate), d => { if (subDate !== watchedDate) return; current = d.exists() ? d.data() : null; render(); },
      err => { console.warn('운영일지 불러오기 실패', err); current = null; render(); });
    loadRecent();
  }
  function stop() { if (unsub) unsub(); unsub = null; subDate = null; current = undefined; recent = []; }

  /** 최근 60일 일지 중 마지막 7개 (내림차순 정렬은 색인이 필요해 오름차순으로 받아 뒤집음) */
  async function recentDays(n = 7) {
    const F = Cloud.fb.F;
    const term = OperatingCalendar.range();
    const threshold = logDate < term.start || logDate >= term.end ? term.start
      : fmt(addDays(parse(logDate), -60));
    const start = threshold < term.start ? term.start : threshold;
    const q = F.query(F.collection(Cloud.fb.db, 'dailyLogs'), F.where(F.documentId(), '>=', start),
      F.where(F.documentId(), '<', term.end), F.orderBy(F.documentId(), 'desc'), F.limit(n));
    return (await F.getDocs(q)).docs.filter(d => !d.data().year || Number(d.data().year) === state.school.year).map(d => d.id);
  }
  async function loadRecent() {
    const year = state.school.year;
    try { const dates = await recentDays(); if (year !== state.school.year) return; recent = dates; renderRecent(); } catch (e) { console.warn('최근 운영일지 목록 실패', e); }
  }

  function renderRecent() {
    $('logRecent').innerHTML = recent.length
      ? '<span class="hint">최근 일지</span>' + recent.map(ds => `<button class="chip-btn${ds === logDate ? ' on' : ''}" data-day="${ds}">${parse(ds).getMonth() + 1}.${parse(ds).getDate()}(${WD[parse(ds).getDay()]})</button>`).join('')
      : '';
  }

  function render() {
    if (!$('logView')) return;
    $('logDate').value = logDate;
    $('logDay').dateTime = logDate;
    const date = parse(logDate);
    $('logDay').innerHTML = date.getFullYear() + '. ' + (date.getMonth() + 1) + '. ' +
      date.getDate() + '. <span>' + WD[date.getDay()] + '요일</span>';
    const download = $('logHwp');
    download.disabled = true;
    if (!window.Cloud || !Cloud.ready) {
      $('logView').innerHTML = '<p class="hint">로그인하면 학교운영일지를 볼 수 있습니다.</p>';
      renderRecent();
      return;
    }
    watch();
    const has = c => c && (['text', 'notice', 'events', 'guidance', 'cover', 'preview']
      .some(key => String(c[key] || '').trim()) || c.covers?.length ||
      Object.values(c.duty || {}).some(d => d && ['today', 'plan', 'status', 'from', 'to', 'note'].some(key => d[key])));
    if (current === undefined) $('logView').innerHTML = '<p class="hint">불러오는 중…</p>';
    else if (!has(current)) $('logView').innerHTML = '<p class="log-empty">이 날 등록된 운영일지가 없습니다.</p>';
    else {
      $('logView').innerHTML = logBody(current);
      download.disabled = !window.LogExport;
    }
    renderRecent();
  }

  const freeText = value => (value || '').trim()
    ? `<div class="hl-copy">${esc(value)}</div>`
    : '<p class="hl-none">등록된 내용이 없습니다.</p>';

  // 예전 통합 텍스트에는 제목이 포함될 수 있습니다. 그중 외부강의 섹션만 건너뜁니다.
  const visibleLegacy = value => (value || '').replace(/^\s*\[외부강의 확인\][ \t]*\r?\n[\s\S]*?(?=^\[[^\]\r\n]+\][ \t]*\r?$|(?![\s\S]))/gm, '');

  // 명시된 날짜·교시와 부가 설명만 구분하고 나머지 문구는 그대로 표시합니다.
  function logLines(value, mode) {
    if (!(value || '').trim()) return freeText(value);
    const datePrefix = /^([ \t]*(?:\d{4}[.\/-]\s*)?\d{1,2}[.\/-]\s*\d{1,2}\.?(?:\s*\([월화수목금토일]\))?)(?=[ \t:：-]|$)/;
    const periodPrefix = /^([ \t]*(?:\d{1,2}(?:\s*[-~·]\s*\d{1,2})*교시|\d{1,2}:\d{2})(?:[ \t]+\d{1,2}:\d{2})?)(?=[ \t:：-]|$)/;
    const lines = value.split(/\r?\n/);
    const section = mode === 'guidance';
    const heading = /^\s*(?:\[[^\]]+\]|(?:중점 생활지도|생활지도|안전지도)\s*[:：]?)\s*$/;
    const items = [];
    for (const source of lines) {
      const bullet = /^\s*\*+[ \t]*/.test(source);
      const entry = source.replace(/^\s*\*+[ \t]*/, '');
      if (!entry.trim()) { if (items.length) items.at(-1).break = true; continue; }
      const time = (entry.match(datePrefix) || (mode === 'events' ? entry.match(periodPrefix) : null))?.[0];
      const secondary = /^(?:[ \t]{2,}|\s*(?:대상(?:자| 학년| 학급)?|장소|비고|세부 안내|참고)\s*[:：]|\s*\([^)]*\)\s*$)/.test(entry);
      const deadline = mode === 'notice' && /^\s*(?:마감(?:일)?|제출 기한|기한)\s*[:：]/.test(entry);
      const part = deadline ? `<div class="hl-deadline">${esc(entry)}</div>` : section && heading.test(entry) ? `<div class="hl-copy-heading">${esc(entry)}</div>`
        : time ? `<div class="hl-timed"><b>${esc(time)}</b><span>${esc(entry.slice(time.length))}</span></div>`
        : `<div class="${secondary ? 'hl-secondary' : 'hl-line'}">${esc(entry)}</div>`;
      const previous = items.at(-1);
      if (secondary && previous && !previous.break && !bullet && !time) previous.parts.push(part);
      else items.push({ parts: [part], break: false });
    }
    return `<div class="hl-copy hl-lines">${items.map(item => `<div class="hl-item">${item.parts.join('')}</div>`).join('')}</div>`;
  }

  function logBody(c) {
    const box = (cls, title, body) => `<section class="hl-card ${cls}"><h3>${title}</h3><div class="hl-card-body">${body}</div></section>`;
    const extra = (title, value) => (value || '').trim()
      ? `<div class="hl-extra"><h4>${title}</h4>${logLines(value, 'events')}</div>` : '';
    const structuredText = ['notice', 'events', 'guidance', 'cover', 'preview', 'lecture'].some(key => (c[key] || '').trim());
    const duty = [['p', '교장'], ['v', '교감'], ['a', '행정실장']].map(([key, role]) => {
      const entry = (c.duty || {})[key] || {};
      const hours = entry.from || entry.to ? (entry.from || '') + ' ~ ' + (entry.to || '') : '';
      const body = [entry.status, entry.note].filter(Boolean).join(' · ');
      return `<li><strong>${role}</strong><div>${hours ? `<div class="hl-duty-time">${esc(hours)}</div>` : ''}
        ${body ? freeText(body) : ''}
        ${!(hours || body) && entry.today ? freeText(entry.today) : ''}
        ${entry.plan ? `<div class="hl-secondary">예정 · ${esc(entry.plan)}</div>` : ''}
        ${!(hours || body || entry.today || entry.plan) ? '<span class="hl-none">—</span>' : ''}</div></li>`;
    }).join('');
    const covers = Array.isArray(c.covers) ? c.covers : [];
    const coverList = covers.length ? `<table class="hl-cover-table" aria-label="보결 배정">
      <thead><tr><th scope="col">학급</th><th scope="col">교시</th><th scope="col">담당 교사</th></tr></thead>
      <tbody>${covers.map(row => {
      const periods = Array.isArray(row.periods) ? [...row.periods].sort((a, b) => a - b).join('·') : '';
      return `<tr><td>${esc(row.cls || '학급 미지정')}</td>
        <td><b class="hl-period">${esc(periods ? periods + '교시' : '교시 미지정')}</b></td>
        <td>${esc(row.teacher || '담당 미정')}</td></tr>`;
    }).join('')}</tbody></table>` : '';
    const coverNote = c.cover && (!covers.length || c.cover.trim() !== window.CoverText?.(covers)?.trim()) ? freeText(c.cover) : '';
    return `<div class="hl-grid">
      ${box('hl-notice', '전달사항', logLines(c.notice || (!structuredText && visibleLegacy(c.text)) || '', 'notice'))}
      ${box('hl-cover', '보결', (coverList + coverNote) || '<p class="hl-none">보결 없음</p>')}
      ${box('hl-events', '주요행사 및 교육활동', (c.events || !c.preview ? logLines(c.events, 'events') : '') + extra('교육활동 예고', c.preview))}
      ${box('hl-duty', '관리자 복무', `<ul class="hl-duty-list">${duty}</ul>`)}
      ${box('hl-guide', '생활지도 및 안전지도', logLines(c.guidance, 'guidance'))}
    </div>`;
  }

  function go(ds) { logDate = ds; render(); }
  $('logHwp').addEventListener('click', async () => {
    if (!current || !window.LogExport) return;
    try { await LogExport.exportHwp(LogExport.fieldsOf(current), logDate, current.byName || ''); }
    catch (err) { alert('한글 파일 만들기 실패: ' + err.message); }
  });

  $('logPrev').addEventListener('click', () => go(stepDay(logDate, -1)));
  $('logToday').addEventListener('click', () => go(OperatingCalendar.activeDate()));
  $('logNext').addEventListener('click', () => go(stepDay(logDate, 1)));
  $('logDate').addEventListener('click', e => {
    try { e.currentTarget.showPicker?.(); } catch { /* Native date control fallback. */ }
  });
  $('logDate').addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  $('logRecent').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) go(b.dataset.day); });

  // 이번 달 학사일정 넘기기
  const moveMonth = n => { homeMonth = n === 0 ? null : new Date(homeMonth.getFullYear(), homeMonth.getMonth() + n, 1); renderHomeMonth(); };
  $('monthPrev').addEventListener('click', () => moveMonth(-1));
  $('monthNext').addEventListener('click', () => moveMonth(1));
  $('monthNow').addEventListener('click', () => moveMonth(0));

  function resetOperatingDate() { stop(); logDate = OperatingCalendar.activeDate(); if (curTab === 'home') render(); }
  document.addEventListener('year-change', resetOperatingDate);
  document.addEventListener('year-period-change', resetOperatingDate);
  document.addEventListener('cloud-change', () => { stop(); if (curTab === 'home') render(); });
  window.HomeLog = { render, stepDay, longDate, fmtTs, recentDays, refreshRecent: () => { if (Cloud.ready) loadRecent(); } };
})();
