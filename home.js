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
    $('logDay').dateTime = logDate;
    $('logDay').textContent = longDate(logDate);
    const download = $('logHwp');
    download.disabled = true;
    if (!window.Cloud || !Cloud.ready) {
      $('logView').innerHTML = '<p class="hint">로그인하면 학교운영일지를 볼 수 있습니다.</p>';
      renderRecent();
      return;
    }
    watch();
    const has = c => c && (['text', 'notice', 'events', 'guidance', 'cover', 'preview', 'lecture']
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

  // 날짜나 교시로 시작하는 줄만 분리합니다. 기존 문구와 줄바꿈은 보존합니다.
  function logLines(value, mode) {
    if (!(value || '').trim()) return freeText(value);
    const datePrefix = /^([ \t]*(?:\d{4}[.\/-]\s*)?\d{1,2}[.\/-]\s*\d{1,2}\.?(?:\s*\([월화수목금토일]\))?)(?=[ \t:：-]|$)/;
    const periodPrefix = /^([ \t]*(?:\d{1,2}(?:\s*[-~·]\s*\d{1,2})*교시|\d{1,2}:\d{2})(?:[ \t]+\d{1,2}:\d{2})?)(?=[ \t:：-]|$)/;
    return `<div class="hl-copy hl-lines">${value.split('\n').map(line => {
      if (!line.trim()) return '<div class="hl-line-space"></div>';
      const time = (line.match(datePrefix) || (mode === 'events' ? line.match(periodPrefix) : null))?.[0];
      if (!time) {
        const heading = mode === 'guidance' && /^\s*\[[^\]]+\]\s*$/.test(line);
        return `<div class="${heading ? 'hl-copy-heading' : 'hl-line'}">${esc(line)}</div>`;
      }
      return `<div class="hl-timed"><b>${esc(time)}</b><span>${esc(line.slice(time.length))}</span></div>`;
    }).join('')}</div>`;
  }

  function logBody(c) {
    const box = (cls, title, body) => `<section class="hl-card ${cls}"><h3>${title}</h3>${body}</section>`;
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
    const coverList = covers.length ? `<ul class="hl-cover-list">${covers.map(row => {
      const periods = Array.isArray(row.periods) ? [...row.periods].sort((a, b) => a - b).join('·') : '';
      return `<li><strong>${esc(row.cls || '학급 미지정')}</strong>
        <b class="hl-period">${esc(periods ? periods + '교시' : '교시 미지정')}</b>
        <span>${esc(row.teacher || '담당 미정')}</span></li>`;
    }).join('')}</ul>` : '';
    const coverNote = c.cover && (!covers.length || c.cover.trim() !== window.CoverText?.(covers).trim()) ? freeText(c.cover) : '';
    return `<div class="hl-grid">
      <div class="hl-column">
        ${box('hl-notice', '전달사항', logLines(c.notice || (!structuredText && c.text) || '', 'notice'))}
        ${box('hl-events', '주요행사 및 교육활동', logLines(c.events, 'events') + extra('교육활동 예고', c.preview) + extra('외부강의 확인', c.lecture))}
        ${box('hl-guide', '생활지도 및 안전지도', logLines(c.guidance, 'guidance'))}
      </div>
      <div class="hl-column">
        ${box('hl-cover', '보결', (coverList + coverNote) || freeText(''))}
        ${box('hl-duty', '관리자 복무', `<ul class="hl-duty-list">${duty}</ul>`)}
      </div>
    </div>`;
  }

  function go(ds) { logDate = ds; render(); }
  $('logHwp').addEventListener('click', async () => {
    if (!current || !window.LogExport) return;
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
