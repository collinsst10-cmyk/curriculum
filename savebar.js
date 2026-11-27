/* =========================================================
 * '저장' 단추 + '저장되었습니다' 알림
 *  - 자료를 입력하는 화면마다 오른쪽 아래에 저장 단추가 떠 있음
 *  - 입력은 지금처럼 자동 저장되지만, 단추를 누르면 기다리던 저장을 바로 끝내고 결과를 알려 줌
 *  - 단추 아래 작은 글씨로 자동 저장 상태(저장 중… / 저장됨 시각)를 보여 줌
 * ========================================================= */
(function () {
  'use strict';
  // 입력이 있는 화면 (관리자용 / 선생님도 쓰는 화면)
  const ADMIN_TABS = ['school', 'env', 'cal', 'event', 'hours', 'schedule', 'review', 'tt', 'run', 'jd', 'stats1', 'stats2', 'site'];
  const SHARED_TABS = ['act', 'roster', 'kclass', 'log', 'cover', 'stats3', 'stats4'];
  const hhmm = () => new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  const bar = document.createElement('div');
  bar.id = 'saveFab'; bar.className = 'save-fab'; bar.hidden = true;
  bar.innerHTML = '<button type="button" class="save-btn" id="saveBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></svg><span>저장</span></button><small id="saveHint">입력하면 자동으로 저장됩니다</small>';
  document.body.appendChild(bar);
  const toastEl = document.createElement('div');
  toastEl.id = 'toast'; toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastEl);

  let tTimer = null;
  /** 화면 아래 알림 (ok: 초록, err: 빨강) */
  function toast(msg, kind = 'ok') {
    toastEl.textContent = msg; toastEl.className = 'toast show ' + kind;
    clearTimeout(tTimer); tTimer = setTimeout(() => { toastEl.className = 'toast ' + kind; }, 2600);
  }
  window.toast = toast;

  function editable() {
    const admin = !!(window.App && App.isAdmin && App.isAdmin()) && !isTeacherView();
    if (ADMIN_TABS.includes(curTab)) return admin;
    return SHARED_TABS.includes(curTab);
  }
  function refresh() { bar.hidden = !editable() || (window.App && App.locked && App.locked()); }

  async function doSave() {
    const btn = $('saveBtn');
    btn.disabled = true; btn.classList.add('busy');
    try {
      // 입력 중인 칸의 내용을 먼저 확정(바뀜 이벤트가 저장을 부름)
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      await new Promise(r => setTimeout(r, 250));
      // 학교 일지 화면에서는 일지를 저장
      if ((curTab === 'log' && window.LogSave) || (curTab === 'cover' && window.CoverSave)) { const m = await (curTab === 'log' ? LogSave() : CoverSave()); if (m) { toast(m, 'err'); return; } $('saveHint').textContent = `모두 저장됨 · ${hhmm()}`; toast(`저장되었습니다 (${hhmm()})`); return; }
      if (typeof saveNow === 'function' && !isTeacherView()) saveNow();
      const r = window.Cloud && Cloud.flush ? await Cloud.flush() : { cloud: false };
      if (r.error) { toast('저장에 실패했습니다: ' + r.error, 'err'); return; }
      $('saveHint').textContent = `모두 저장됨 · ${hhmm()}`;
      toast(`저장되었습니다 (${hhmm()})`);
    } catch (e) { toast('저장에 실패했습니다: ' + e.message, 'err'); }
    finally { btn.disabled = false; btn.classList.remove('busy'); }
  }
  $('saveBtn').addEventListener('click', doSave);
  // Ctrl+S 로도 저장
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !bar.hidden) { e.preventDefault(); doSave(); }
  });
  document.addEventListener('save-pending', () => { $('saveHint').textContent = '저장 중…'; });
  document.addEventListener('save-done', () => { $('saveHint').textContent = `자동 저장됨 · ${hhmm()}`; });

  // 화면이 바뀔 때마다 단추 보이기/숨기기
  const base = showTab;
  showTab = function (t) { base(t); refresh(); };
  document.addEventListener('cloud-change', refresh);
  refresh();
})();
