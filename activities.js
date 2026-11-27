/* =========================================================
 * 교육활동 일정 (외부강의·교내행사) + 한국어학급 연계
 *
 *  - 학교 전체가 함께 쓰는 공용 일정이라 클라우드(Firestore)에 저장합니다.
 *      activityDays/{YYYY-MM-DD}  { items: [활동, ...] }   ← 날짜별 1문서
 *      config/ksl                 { slots: { "1-1": {group, targets}, ... } }  (요일-교시)
 *  - 겹침 방지: 등록·수정·상태 변경은 모두 Firestore 트랜잭션으로 처리합니다.
 *    같은 날짜 문서를 두 사람이 동시에 고치면 한 쪽은 자동으로 다시 시도되며,
 *    다시 확인할 때 겹치는 일정이 있으면 등록이 거부됩니다. (동시 신청 차단)
 *  - 겹침 기준: 같은 날 + 교시가 하나라도 겹치고 + (대상 학급이 하나라도 겹치거나 같은 장소)
 *    취소된 일정은 겹침 판단에서 제외합니다.
 * ========================================================= */
(function () {
  'use strict';
  const PERIODS = [1, 2, 3, 4, 5, 6];
  const KSL_PERIODS = [1, 2, 3];
  const ST = { pending: '신청', confirmed: '확정', canceled: '취소' };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  let items = {};          // date -> [item]
  let unsubDays = null, unsubKsl = null, subYear = null;
  let ksl = { slots: {}, teachers: [] };
  let notifyPrimed = false;   // 첫 불러오기 때는 윈도우 알림을 띄우지 않음
  const SEEN_KEY = 'ksl-notified-ids';
  let month = null;        // Date (1일)
  let editing = null;      // { id, date } 수정 중인 일정
  let loaded = false;

  /* ---------- 기본 유틸 ---------- */
  const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const classCount = g => Number(state.school.classes[g]) || 0;
  const allClasses = () => GRADES.flatMap(g => Array.from({ length: classCount(g) }, (_, i) => `${g}-${i + 1}`));
  const inter = (a, b) => a.filter(x => b.includes(x));
  // 기록자 이름은 본인이 매번 쓰지 않고, 가입(승인 요청) 때 등록한 이름을 씀
  const me = () => Cloud.user ? { uid: Cloud.user.uid, email: Cloud.email, name: Cloud.profileName || '' } : null;
  const isKslTeacher = () => Cloud.ready && ((ksl.teachers || []).includes(Cloud.email) || window.KoreanClasses?.isOwner(Cloud.email));
  const canEdit = it => Cloud.isAdmin() || (me() && it.ownerUid === me().uid);

  /** "3-1, 3-2, 4" → ["3-1","3-2","4-1","4-2",...] */
  function parseTargets(text) {
    const out = new Set();
    String(text || '').split(/[,\s]+/).filter(Boolean).forEach(t => {
      const m = t.match(/^([1-6])(?:-(\d{1,2}))?$/);
      if (!m) return;
      const g = Number(m[1]);
      if (m[2]) out.add(`${g}-${Number(m[2])}`);
      else for (let c = 1; c <= classCount(g); c++) out.add(`${g}-${c}`);
    });
    return [...out];
  }
  /** ["3-1","3-2"] → "3학년 전체" 또는 "3-1, 3-2" */
  function targetLabel(list) {
    if (!list || !list.length) return '-';
    if (list.length === allClasses().length && allClasses().every(t => list.includes(t))) return '전교';
    const parts = [];
    GRADES.forEach(g => {
      const mine = list.filter(t => t.startsWith(g + '-'));
      if (!mine.length) return;
      if (mine.length === classCount(g)) parts.push(`${g}학년`);
      else parts.push(mine.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])).join(', '));
    });
    return parts.join(' · ');
  }
  const periodLabel = ps => ps.length === PERIODS.length ? '종일' : ps.join('·') + '교시';

  /** 두 일정이 겹치는지 (취소 제외) */
  function conflicts(a, b) {
    if (a.id === b.id || a.date !== b.date) return false;
    if (a.status === 'canceled' || b.status === 'canceled') return false;
    if (!inter(a.periods, b.periods).length) return false;
    const sameTarget = inter(a.targets, b.targets).length > 0;
    const samePlace = a.place && b.place && a.place.replace(/\s/g, '') === b.place.replace(/\s/g, '');
    return sameTarget || samePlace;
  }

  /** 이 일정과 겹치는 한국어학급 수업 [{p, group, targets}] */
  function kslHits(it) {
    if (it.status === 'canceled') return [];
    const dow = parse(it.date).getDay();
    const hits = [];
    it.periods.forEach(p => {
      const key = dow + '-' + p;
      const legacy = ksl.slots[key];
      const classes = window.KoreanClasses?.slotsAt(key) || [];
      if (legacy) classes.push(legacy);
      classes.forEach(slot => {
        const common = inter(slot.targets || [], it.targets);
        if (common.length) hits.push({ p, group: slot.group || '한국어학급', classes: common });
      });
    });
    return hits;
  }

  /* ---------- 학사일정 연계 ---------- */
  const yearDay = date => computeYear().find(x => x.ds === date);
  /** 학사일정 때문에 신청할 수 없는 이유 (휴업일·방학·공휴일, 시간이 정해진 교내행사와 겹침) */
  function haksaConflicts(it) {
    const d = yearDay(it.date);
    if (!d) return [];
    if (!d.isSchool) return [`학사일정상 ${d.type === 'weekend' ? '주말' : TYPE_LABEL[d.type]}${d.name ? `(${d.name})` : ''}이라 신청할 수 없습니다.`];
    if (it.status === 'canceled') return [];
    return d.events.filter(event => it.targets.some(target => {
      const [grade, classNumber] = target.split('-').map(Number);
      return eventTargets(event, grade, classNumber)
        && it.periods.some(period => (event.allDay || event.subjects[period])
          && calendarPeriods(d, grade, classNumber).includes(period));
    })).map(event => `학사일정 교내행사 "${event.name}"와 겹칩니다.`);
  }
  /** 막지는 않지만 알려 줄 내용 */
  function calendarWarnings(date) {
    const d = yearDay(date);
    if (!d) return ['현재 학년도 밖의 날짜입니다.'];
    if (d.isSchool && d.events.some(event => !Object.keys(event.subjects).length)) return [`같은 날 학사일정 교내행사가 있습니다: ${d.name}`];
    return [];
  }

  /* =========================================================
   * 클라우드 구독
   * ========================================================= */
  function subscribe() {
    const ready = Cloud.ready;
    const y = state.school.year;
    if (!ready) { stop(); return; }
    if (unsubDays && subYear === y) return;
    stop();
    const { F } = Cloud.fb, db = Cloud.fb.db;
    subYear = y;
    const { start, end } = OperatingCalendar.range();
    const q = F.query(F.collection(db, 'activityDays'), F.where(F.documentId(), '>=', start), F.where(F.documentId(), '<', end));
    unsubDays = F.onSnapshot(q, snap => {
      if (subYear !== y) return;
      items = {};
      snap.docs.forEach(d => { if (!d.data().year || d.data().year === y) items[d.id] = d.data().items || []; });
      loaded = true;
      if (curTab === 'act') $('actNotice').innerHTML = '';
      refresh();
      notifyNew();
    }, err => { console.warn(err); notice('일정을 불러오지 못했습니다: ' + err.message); });
    unsubKsl = F.onSnapshot(F.doc(db, 'config', 'ksl'), d => {
      ksl = d.exists() ? { slots: d.data().year === y ? d.data().slots || {} : {}, teachers: d.data().teachers || [] } : { slots: {}, teachers: [] };
      refresh(true);
      notifyNew();
    }, err => console.warn(err));
  }
  function stop() {
    if (unsubDays) unsubDays(); if (unsubKsl) unsubKsl();
    unsubDays = unsubKsl = null; subYear = null; items = {}; loaded = false; notifyPrimed = false;
    updateBell();
  }
  function refresh(kslChanged) {
    if (curTab === 'act') { renderGrid(); renderList(); renderCheck(); }
    if (curTab === 'ksl') { if (kslChanged) { renderKslTable(); renderKslTeachers(); } renderKslList(); }
    if (curTab === 'cal') renderCal();   // 학사일정 달력에 교육활동 표시
    if (curTab === 'hview' || curTab === 'event') RENDER[curTab]();
    if (curTab === 'home') { renderHomeMonth(); renderHomeWork(); }
    updateBell();
  }

  /* ---------- 한국어학급 담당 교사 알림 ---------- */
  /** 조정이 필요한(아직 완료 안 된, 오늘 이후) 일정 */
  function pendingKsl() {
    const today = fmt(new Date());
    return Object.values(items).flat().filter(it => it.date >= today && !(it.kslAdjust && it.kslAdjust.done) && kslHits(it).length);
  }
  function updateBell() {
    const bell = $('kslBell');
    const n = isKslTeacher() ? pendingKsl().length : 0;
    bell.hidden = !n;
    $('kslBellN').textContent = n;
  }
  /** 새로 생긴 조정 필요 일정을 윈도우 알림으로 (담당 교사 + 이 PC에서 알림 허용 시) */
  function notifyNew() {
    if (!loaded || !isKslTeacher()) return;
    const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
    const fresh = pendingKsl().filter(it => !seen.has(it.id));
    fresh.forEach(it => seen.add(it.id));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
    if (!notifyPrimed) { notifyPrimed = true; return; }
    if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted') return;
    fresh.forEach(it => {
      const hits = kslHits(it);
      const n = new Notification('한국어학급 시간표 조정 필요', {
        body: `${fmtK(it.date)} ${periodLabel(it.periods)} ${it.title} (${it.ownerName || '등록자'})\n겹침: ${hits.map(h => h.p + '교시 ' + h.group).join(', ')}`,
        icon: 'assets/emblem.png', tag: it.id,
      });
      n.onclick = () => { window.focus(); showTab('ksl'); n.close(); };
    });
  }
  function notice(msg) { const el = $(curTab === 'ksl' ? 'kslNotice' : 'actNotice'); if (el) el.innerHTML = msg ? `<div class="notice">${esc2(msg)}</div>` : ''; }

  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('kclass-change', () => refresh(false));
  document.addEventListener('year-period-change', () => { stop(); month = null; subscribe(); });
  document.addEventListener('year-change', () => { month = null; subscribe(); });

  /* =========================================================
   * 트랜잭션: 등록·수정·상태변경·삭제 (겹침 재확인)
   * ========================================================= */
  async function txDay(date, mutate) {
    if (!OperatingCalendar.canWrite(date)) throw new Error('운영 학년도의 날짜만 수정할 수 있습니다.');
    const year = state.school.year;
    const { F } = Cloud.fb, db = Cloud.fb.db;
    const ref = F.doc(db, 'activityDays', date);
    await F.runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const list = snap.exists() ? (snap.data().items || []) : [];
      const next = mutate(list.slice());
      tx.set(ref, { year, items: next, updatedAt: F.serverTimestamp() });
    });
  }
  function conflictError(list) {
    const e = new Error('겹치는 일정이 있습니다.'); e.conflicts = list; return e;
  }

  async function saveItem(item) {
    const oldDate = editing && editing.date !== item.date ? editing.date : null;
    if (![item.date, ...(oldDate ? [oldDate] : [])].every(OperatingCalendar.canWrite)) {
      throw new Error('운영 학년도의 날짜만 수정할 수 있습니다.');
    }
    const { F, db } = Cloud.fb, year = state.school.year;
    const ref = date => F.doc(db, 'activityDays', date);
    await F.runTransaction(db, async tx => {
      const target = await tx.get(ref(item.date));
      const origin = oldDate ? await tx.get(ref(oldDate)) : null;
      const rows = target.data()?.items || [];
      const rest = rows.filter(row => row.id !== item.id);
      const overlaps = rest.filter(row => conflicts(row, item));
      if (overlaps.length) throw conflictError(overlaps);
      const prior = (origin?.data()?.items || rows).find(row => row.id === item.id);
      tx.set(ref(item.date), { year, items: [...rest, { ...prior, ...item }], updatedAt: F.serverTimestamp() });
      if (origin?.exists()) tx.set(ref(oldDate), { year, items: origin.data().items.filter(row => row.id !== item.id), updatedAt: F.serverTimestamp() });
    });
  }

  async function patchItem(date, id, patch, recheck) {
    await txDay(date, list => {
      const it = list.find(x => x.id === id);
      if (!it) throw new Error('일정이 이미 삭제되었습니다.');
      const next = { ...it, ...patch, updatedAt: Date.now() };
      if (recheck) { const c = list.filter(x => conflicts(x, next)); if (c.length) throw conflictError(c); }
      return list.map(x => x.id === id ? next : x);
    });
  }

  /* =========================================================
   * 렌더링: 달력
   * ========================================================= */
  function ensureMonth() {
    if (month) return;
    const date = parse(OperatingCalendar.activeDate());
    month = new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function renderAct() {
    ensureMonth(); subscribe();
    if (!Cloud.configured || !Cloud.ready) {
      $('actNotice').innerHTML = `<div class="notice">신규 학사일정 등록은 여러 선생님이 함께 쓰는 공용 일정이라 <b>승인된 계정으로 로그인</b>해야 사용할 수 있습니다.</div>`;
    } else $('actNotice').innerHTML = loaded ? '' : '<div class="hint">일정을 불러오는 중…</div>';
    renderForm(); renderGrid(); renderList(); renderCheck();
  }

  function renderGrid() {
    if (!month) return;
    const y = month.getFullYear(), m = month.getMonth();
    $('actMonthTitle').textContent = `${y}년 ${m + 1}월`;
    const yearDays = {}; computeYear().forEach(x => { yearDays[x.ds] = x; });
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const sel = $('actDate').value, today = fmt(new Date());
    let html = DOW.map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < first.getDay(); i++) html += '<div class="aday empty"></div>';
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = fmt(new Date(y, m, d)), info = yearDays[ds];
      const cls = info ? info.type : (new Date(y, m, d).getDay() % 6 === 0 ? 'weekend' : 'school');
      const list = (items[ds] || []).slice().sort((a, b) => a.periods[0] - b.periods[0]);
      html += `<div class="aday ${cls}${ds === sel ? ' sel' : ''}${ds === today ? ' today' : ''}" data-ds="${ds}">
        <div class="aday-h"><span class="d">${d}</span></div>
        ${info && info.name && info.type !== 'weekend' ? `<div class="chip haksa ${info.isSchool ? '' : 'off'}" title="학사일정: ${esc2(TYPE_LABEL[info.type] + ' · ' + info.name)}">${calendarLabel(info.name)}</div>` : ''}
        ${list.map(it => `<div class="chip ${it.status}" data-id="${esc2(it.id)}" title="${esc2(`${ST[it.status]} · ${periodLabel(it.periods)} · ${it.title} · ${targetLabel(it.targets)}`)}">
          ${kslHits(it).length ? '⚠' : ''}<span class="cp">${esc2(periodLabel(it.periods))}</span> ${calendarLabel(it.title)}</div>`).join('')}
      </div>`;
    }
    $('actGrid').innerHTML = html;
  }

  /* ---------- 목록 ---------- */
  function monthItems() {
    if (!month) return [];
    const pre = fmt(month).slice(0, 7);
    let list = Object.entries(items).filter(([d]) => d.startsWith(pre)).flatMap(([, l]) => l);
    if ($('actMine').checked && me()) list = list.filter(x => x.ownerUid === me().uid);
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.periods[0] - b.periods[0]);
  }

  function renderList() {
    const list = monthItems();
    $('actListTitle').textContent = `${month.getMonth() + 1}월 교육활동 (${list.filter(x => x.status !== 'canceled').length}건)`;
    $('actList').innerHTML = `<tr><th>날짜</th><th>교시</th><th>구분</th><th class="l">교육활동명</th><th>대상</th><th>상태</th><th>기록자</th><th></th></tr>` +
      (list.length ? '' : '<tr><td colspan="8" class="hint">등록된 일정이 없습니다. 달력에서 날짜를 눌러 신청하세요.</td></tr>') +
      list.map(it => {
        const hits = kslHits(it), mine = canEdit(it);
        return `<tr class="${it.status === 'canceled' ? 'canceled' : ''}">
          <td class="num">${fmtK(it.date)}</td><td>${periodLabel(it.periods)}</td><td>${esc2(it.kind)}</td>
          <td class="l"><b>${esc2(it.title)}</b>
            ${hits.length ? `<br><span class="pill ${it.kslAdjust && it.kslAdjust.done ? 'ok' : 'warn'}">⚠ 한국어학급 ${hits.map(h => h.p + '교시').join('·')} ${it.kslAdjust && it.kslAdjust.done ? '조정 완료' : '조정 필요'}</span>` : ''}</td>
          <td>${esc2(targetLabel(it.targets))}</td>
          <td><span class="st ${it.status}">${ST[it.status]}</span></td>
          <td class="hint">${esc2(it.ownerName || it.ownerEmail || '')}</td>
          <td class="nowrap">${mine ? `
            ${it.status === 'pending' ? `<button class="btn small primary" data-a="confirm" data-d="${it.date}" data-id="${esc2(it.id)}">확정</button>` : ''}
            ${it.status !== 'canceled' ? `<button class="btn small" data-a="cancel" data-d="${it.date}" data-id="${esc2(it.id)}">취소</button>` : `<button class="btn small" data-a="restore" data-d="${it.date}" data-id="${esc2(it.id)}">되살리기</button>`}
            <button class="btn small" data-a="edit" data-d="${it.date}" data-id="${esc2(it.id)}">수정</button>
            <button class="btn small danger" data-a="del" data-d="${it.date}" data-id="${esc2(it.id)}">삭제</button>` : ''}</td></tr>`;
      }).join('');
  }

  /* =========================================================
   * 신청 폼
   * ========================================================= */
  function renderForm() {
    // 교시 · 대상 학급 버튼은 학급 수에 따라 매번 다시 그림(선택 상태 유지)
    const ps = getPeriods();
    $('actPeriods').innerHTML = PERIODS.map(p => `<label class="tg"><input type="checkbox" value="${p}" ${ps.includes(p) ? 'checked' : ''}>${p}교시</label>`).join('');

    // 대상 학급: 가로 = 학년, 세로 = 반 (아래로 길어지지 않는 격자)
    const ts = getTargets();
    const maxC = Math.max(1, ...GRADES.map(classCount));
    const allOn = ts.length && ts.length === allClasses().length;
    let html = `<table class="tgt"><tr><td><label class="tg mini${allOn ? '' : ''}"><input type="checkbox" id="actAllSchool" ${allOn ? 'checked' : ''}>전교</label></td>` +
      GRADES.map(g => {
        const cls = Array.from({ length: classCount(g) }, (_, i) => `${g}-${i + 1}`);
        const all = cls.length && cls.every(t => ts.includes(t));
        return `<td><label class="tg mini grade"><input type="checkbox" data-grade="${g}" ${all ? 'checked' : ''}>${g}학년</label></td>`;
      }).join('') + '</tr>';
    for (let c = 1; c <= maxC; c++) {
      html += `<tr><td class="hint">${c}반</td>` + GRADES.map(g => c <= classCount(g)
        ? `<td><label class="tg mini"><input type="checkbox" value="${g}-${c}" ${ts.includes(`${g}-${c}`) ? 'checked' : ''}>${g}-${c}</label></td>`
        : '<td></td>').join('') + '</tr>';
    }
    $('actTargets').innerHTML = html + '</table>';

    const d = $('actDate').value;
    $('actDateLabel').innerHTML = d ? `<b>${fmtK(d)}</b> <span class="hint">${d.slice(0, 4)}년</span>` : '<span class="hint">달력에서 날짜를 누르세요</span>';
    $('actDateLabel').classList.toggle('set', !!d);
    $('actFormTitle').textContent = editing ? '일정 수정' : '일정 신청';
    $('actSave').textContent = editing ? '수정 저장' : '신청 등록';
  }
  const getPeriods = () => [...document.querySelectorAll('#actPeriods input[value]:checked')].map(i => Number(i.value));
  const getTargets = () => [...document.querySelectorAll('#actTargets input[value]:checked')].map(i => i.value);
  const getRadio = name => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
  const setRadio = (name, v) => document.querySelectorAll(`input[name="${name}"]`).forEach(i => { i.checked = i.value === v; });
  function setDate(ds) { $('actDate').value = ds || ''; renderForm(); renderGrid(); renderCheck(); }

  function formItem() {
    const u = me();
    return {
      id: editing ? editing.id : uid(),
      date: $('actDate').value,
      kind: getRadio('actKind') || '외부강의',
      title: $('actTitle').value.trim(),
      org: '', place: '', memo: '',
      periods: getPeriods(),
      targets: getTargets(),
      status: getRadio('actStatus') || 'pending',
      ownerUid: u ? u.uid : '', ownerEmail: u ? u.email : '', ownerName: u ? u.name : '',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  }

  /** 입력 중인 일정을 실시간으로 검사해 겹침·경고 표시 */
  function renderCheck() {
    const it = formItem();
    const box = $('actCheck');
    const msgs = [];
    let block = false;
    if (!it.date) { box.innerHTML = '<div class="hint">왼쪽 달력에서 날짜를 누르세요.</div>'; $('actSave').disabled = true; return; }
    const same = (items[it.date] || []).filter(x => x.id !== it.id && x.status !== 'canceled');
    const c = same.filter(x => conflicts(x, it));
    if (it.periods.length && it.targets.length && c.length) {
      block = true;
      msgs.push(`<div class="ck err"><b>⛔ 겹치는 일정이 있어 신청할 수 없습니다.</b>${c.map(x =>
        `<div>· ${periodLabel(x.periods)} <b>${esc2(x.title)}</b> (${esc2(targetLabel(x.targets))}) — ${ST[x.status]}, ${esc2(x.ownerName || x.ownerEmail)}</div>`).join('')}
        <div class="hint">다른 교시·날짜를 고르거나, 신청자와 협의하세요.</div></div>`);
    } else if (same.length) {
      msgs.push(`<div class="ck info">같은 날 다른 일정 ${same.length}건 (겹치지 않음): ${same.map(x => `${periodLabel(x.periods)} ${esc2(x.title)}`).join(', ')}</div>`);
    }
    const hc = it.periods.length && it.targets.length ? haksaConflicts(it) : haksaConflicts({ ...it, periods: [], targets: [] });
    if (hc.length) { block = true; msgs.unshift(`<div class="ck err"><b>⛔ ${esc2(hc[0])}</b><div class="hint">학사일정은 상단 '학사일정' 메뉴에서 확인할 수 있습니다.</div></div>`); }
    calendarWarnings(it.date).forEach(w => msgs.push(`<div class="ck warn">⚠ ${esc2(w)}</div>`));
    const hits = it.periods.length && it.targets.length ? kslHits(it) : [];
    if (hits.length) msgs.push(`<div class="ck warn"><b>⚠ 한국어학급 시간과 겹칩니다.</b>${hits.map(h =>
      `<div>· ${h.p}교시 ${esc2(h.group)} (${esc2(h.classes.join(', '))} 학생)</div>`).join('')}
      <div class="hint">등록할 수 있지만, 해당 학생들이 활동에 참여하도록 한국어학급 시간을 조정해야 합니다. (② 한국어학급 연계에 자동 표시)</div></div>`);
    if (hits.length && ((ksl.teachers || []).length || window.KoreanClasses?.hasOwners())) msgs.push('<div class="ck info">🔔 등록하면 한국어학급 담당 선생님께 알림이 표시됩니다.</div>');
    if (!it.title) msgs.push('<div class="hint">교육활동명을 입력하세요.</div>');
    if (!it.periods.length) msgs.push('<div class="hint">교시를 하나 이상 고르세요.</div>');
    if (!it.targets.length) msgs.push('<div class="hint">대상 학급을 고르세요.</div>');
    if (!block && it.title && it.periods.length && it.targets.length && !c.length) msgs.unshift('<div class="ck ok">✅ 학사일정·다른 교육활동과 겹치지 않습니다.</div>');
    box.innerHTML = msgs.join('');
    const name = Cloud.profileName;
    $('actWho').innerHTML = editing
      ? `기록자: <b>${esc2(((items[editing.date] || []).find(x => x.id === editing.id) || {}).ownerName || '')}</b>`
      : name ? `기록자: <b>${esc2(name)}</b> <span class="hint">(가입 때 등록한 이름)</span>`
        : `<span class="neg">등록된 이름이 없어 신청할 수 없습니다. ${Cloud.isAdmin() ? '<a href="#admin">관리자 메뉴</a>에서 내 이름을 등록하세요.' : '관리자에게 이름 등록을 요청하세요.'}</span>`;
    $('actSave').disabled = block || !it.title || !it.periods.length || !it.targets.length || !Cloud.ready || (!editing && !name);
  }

  function resetForm(date) {
    editing = null;
    $('actTitle').value = '';
    setRadio('actKind', '외부강의'); setRadio('actStatus', 'pending');
    document.querySelectorAll('#actPeriods input, #actTargets input').forEach(i => { i.checked = false; });
    if (date) $('actDate').value = date;
    renderForm(); renderGrid(); renderCheck();
  }

  function loadToForm(it) {
    editing = { id: it.id, date: it.date };
    $('actDate').value = it.date; $('actTitle').value = it.title;
    setRadio('actKind', it.kind); setRadio('actStatus', it.status === 'confirmed' ? 'confirmed' : 'pending');
    renderForm();
    document.querySelectorAll('#actPeriods input[value]').forEach(i => { i.checked = it.periods.includes(Number(i.value)); });
    document.querySelectorAll('#actTargets input[value]').forEach(i => { i.checked = it.targets.includes(i.value); });
    renderForm(); renderGrid(); renderCheck();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onSave() {
    if (!Cloud.ready) { alert('로그인 후 사용할 수 있습니다.'); return; }
    const it = formItem();
    if (editing) {
      const prev = (items[editing.date] || []).find(x => x.id === editing.id);
      if (prev) { it.createdAt = prev.createdAt; it.ownerUid = prev.ownerUid; it.ownerEmail = prev.ownerEmail; it.ownerName = prev.ownerName; it.kslAdjust = prev.kslAdjust || null; }
    }
    const hc = haksaConflicts(it);
    if (hc.length) { alert(hc[0]); renderCheck(); return; }
    $('actSave').disabled = true;
    try {
      await saveItem(it);
      const msg = editing ? '수정했습니다.' : `${ST[it.status]} 일정으로 등록했습니다.`;
      resetForm(it.date);
      flash(msg);
    } catch (e) {
      if (e.conflicts) alert('방금 다른 선생님이 같은 시간에 일정을 등록해 신청할 수 없습니다.\n\n' + e.conflicts.map(x => `· ${periodLabel(x.periods)} ${x.title} (${targetLabel(x.targets)}) - ${x.ownerName || x.ownerEmail}`).join('\n'));
      else alert('저장 실패: ' + e.message);
      renderCheck();
    }
  }
  function flash(msg) { const b = $('actCheck'); b.insertAdjacentHTML('afterbegin', `<div class="ck ok">✅ ${esc2(msg)}</div>`); }

  async function onListAction(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const { a, d, id } = b.dataset;
    const it = (items[d] || []).find(x => x.id === id);
    if (!it) return;
    try {
      if (a === 'edit') { loadToForm(it); return; }
      if ((a === 'confirm' || a === 'restore') && haksaConflicts({ ...it, status: 'pending' }).length) { alert(haksaConflicts({ ...it, status: 'pending' })[0]); return; }
      if (a === 'confirm') await patchItem(d, id, { status: 'confirmed' }, true);
      if (a === 'cancel') { if (!confirm(`"${it.title}" 일정을 취소 처리할까요? (기록은 남고, 그 시간은 다른 신청이 가능해집니다)`)) return; await patchItem(d, id, { status: 'canceled' }); }
      if (a === 'restore') await patchItem(d, id, { status: 'pending' }, true);
      if (a === 'del') { if (!confirm(`"${it.title}" 일정을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return; await txDay(d, list => list.filter(x => x.id !== id)); if (editing && editing.id === id) resetForm(); }
    } catch (err) {
      if (err.conflicts) alert('그 시간에 이미 다른 일정이 있어 처리할 수 없습니다.\n\n' + err.conflicts.map(x => `· ${periodLabel(x.periods)} ${x.title} - ${x.ownerName || x.ownerEmail}`).join('\n'));
      else alert('실패: ' + err.message);
    }
  }

  /* =========================================================
   * 한국어학급 연계
   * ========================================================= */
  function renderKsl() {
    subscribe();
    $('kslNotice').innerHTML = Cloud.ready ? '' : `<div class="notice">한국어학급 연계는 <b>승인된 계정으로 로그인</b>해야 사용할 수 있습니다.</div>`;
    renderKslTable(); renderKslTeachers(); renderKslList();
  }

  function renderKslTeachers() {
    const t = ksl.teachers || [];
    $('kslTeachers').disabled = !Cloud.ready || !Cloud.isAdmin();
    $('kslTeachersSave').disabled = !Cloud.ready || !Cloud.isAdmin();
    if (document.activeElement !== $('kslTeachers')) $('kslTeachers').value = t.join(', ');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    $('kslTeacherInfo').innerHTML = (t.length ? `등록된 담당 교사 ${t.length}명.` : '아직 담당 교사가 없습니다.') +
      (isKslTeacher() ? ' <b>지금 로그인한 계정은 담당 교사입니다.</b>' : '') +
      ` · 이 PC 윈도우 알림: ${perm === 'granted' ? '<b class="pos">켜짐</b>' : perm === 'denied' ? '<b class="neg">차단됨 (브라우저 주소창 왼쪽 자물쇠에서 허용)</b>' : perm === 'unsupported' ? '지원 안 됨' : '꺼짐'}`;
  }

  async function saveKslTeachers() {
    if (!Cloud.ready || !Cloud.isAdmin()) return;
    const list = [...new Set($('kslTeachers').value.split(/[,\s;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    const { F } = Cloud.fb;
    try {
      await F.setDoc(F.doc(Cloud.fb.db, 'config', 'ksl'), { teachers: list, updatedBy: Cloud.email, updatedAt: F.serverTimestamp() }, { mergeFields: ['teachers', 'updatedBy', 'updatedAt'] });
      alert(`담당 교사 ${list.length}명을 저장했습니다.`);
    } catch (e) { alert('저장 실패: ' + e.message); }
  }

  async function enableNotify() {
    if (!('Notification' in window)) { alert('이 브라우저는 윈도우 알림을 지원하지 않습니다.'); return; }
    const p = await Notification.requestPermission();
    renderKslTeachers();
    if (p === 'granted') new Notification('알림이 켜졌습니다', { body: '한국어학급 시간과 겹치는 일정이 새로 등록되면 이렇게 알려 드립니다. (사이트가 열려 있을 때)', icon: 'assets/emblem.png' });
  }

  function renderKslTable() {
    const days = [1, 2, 3, 4, 5];
    $('kslTable').innerHTML = `<tr><th>교시</th>${days.map(d => `<th>${DOW[d]}</th>`).join('')}</tr>` +
      KSL_PERIODS.map(p => `<tr><th>${p}</th>${days.map(d => {
        const s = ksl.slots[`${d}-${p}`] || {};
        return `<td class="ksl-cell"><input readonly class="ksl-g" data-k="${d}-${p}" placeholder="반 이름" value="${esc2(s.group || '')}">
          <input readonly class="ksl-t" data-k="${d}-${p}" placeholder="학급 예: 3-1, 4" value="${esc2(s.text || '')}">
          <div class="hint ksl-prev">${esc2(s.targets && s.targets.length ? targetLabel(s.targets) : '')}</div></td>`;
      }).join('')}</tr>`).join('');
  }

  function renderKslList() {
    const showDone = $('kslShowDone').checked;
    const today = fmt(new Date());
    const rows = Object.values(items).flat()
      .map(it => ({ it, hits: kslHits(it) }))
      .filter(r => r.hits.length && (showDone || !(r.it.kslAdjust && r.it.kslAdjust.done)))
      .sort((a, b) => a.it.date.localeCompare(b.it.date));
    $('kslList').innerHTML = `<tr><th>날짜</th><th class="l">활동</th><th>활동 상태</th><th class="l">겹치는 한국어학급</th><th>조정</th><th class="l">조정 내용</th></tr>` +
      (rows.length ? '' : `<tr><td colspan="6" class="hint">${Object.keys(ksl.slots).length ? '조정이 필요한 날이 없습니다.' : '먼저 위에 한국어학급 시간표를 입력하세요.'}</td></tr>`) +
      rows.map(({ it, hits }) => {
        const adj = it.kslAdjust || {};
        return `<tr class="${it.date < today ? 'past' : ''}"><td class="num">${fmtK(it.date)}</td>
          <td class="l"><b>${esc2(it.title)}</b><br><span class="hint">${periodLabel(it.periods)} · ${esc2(targetLabel(it.targets))}</span></td>
          <td><span class="st ${it.status}">${ST[it.status]}</span></td>
          <td class="l">${hits.map(h => `${h.p}교시 ${esc2(h.group)} <span class="hint">(${esc2(h.classes.join(', '))})</span>`).join('<br>')}</td>
          <td><label class="chk"><input type="checkbox" data-kd="${it.date}" data-kid="${esc2(it.id)}" ${adj.done ? 'checked' : ''}> 완료</label></td>
          <td class="l"><input class="wide ksl-memo" data-kd="${it.date}" data-kid="${esc2(it.id)}" value="${esc2(adj.memo || '')}" placeholder="예: 1교시 → 5교시로 이동"></td></tr>`;
      }).join('');
  }

  async function onKslAdjust(e) {
    const t = e.target; if (!t.dataset.kid) return;
    const row = t.closest('tr');
    const done = row.querySelector('input[type=checkbox]').checked, memo = row.querySelector('.ksl-memo').value.trim();
    try { await patchItem(t.dataset.kd, t.dataset.kid, { kslAdjust: { done, memo, by: me().email, at: Date.now() } }); }
    catch (err) { alert('저장 실패: ' + err.message); }
  }

  /* =========================================================
   * 이벤트 등록
   * ========================================================= */
  RENDER.act = renderAct;
  RENDER.ksl = renderKsl;

  $('actPrev').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderGrid(); renderList(); };
  $('actNext').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderGrid(); renderList(); };
  $('actToday').onclick = () => { const n = new Date(); month = new Date(n.getFullYear(), n.getMonth(), 1); renderGrid(); renderList(); };
  $('actMine').onchange = renderList;
  $('actGrid').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    const day = e.target.closest('.aday[data-ds]');
    if (chip && day) { const it = (items[day.dataset.ds] || []).find(x => x.id === chip.dataset.id); if (it && canEdit(it)) { loadToForm(it); return; } }
    if (day) { if (editing) resetForm(day.dataset.ds); else setDate(day.dataset.ds); }
  });
  $('actReset').onclick = () => resetForm($('actDate').value);
  $('actSave').onclick = onSave;
  $('actList').addEventListener('click', onListAction);
  $('actTitle').addEventListener('input', renderCheck);
  $('actKind').addEventListener('change', renderCheck);
  $('actStatus').addEventListener('change', renderCheck);
  $('actPeriods').addEventListener('change', renderCheck);
  $('actTargets').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'actAllSchool') document.querySelectorAll('#actTargets input').forEach(i => { i.checked = t.checked; });
    else if (t.dataset.grade) document.querySelectorAll(`#actTargets input[value^="${t.dataset.grade}-"]`).forEach(i => { i.checked = t.checked; });
    renderForm(); renderCheck();
  });
  $('kslTeachersSave').onclick = saveKslTeachers;
  $('kslNotifyOn').onclick = enableNotify;
  $('kslBell').onclick = () => showTab('ksl');
  $('kslShowDone').onchange = renderKslList;
  $('kslTable').addEventListener('input', e => {
    if (!e.target.classList.contains('ksl-t')) return;
    e.target.parentElement.querySelector('.ksl-prev').textContent = targetLabel(parseTargets(e.target.value));
  });
  $('kslList').addEventListener('change', onKslAdjust);

  /* 테스트·점검용 */
  window.Activities = { conflicts, kslHits, parseTargets, targetLabel, saveItem, txDay, get items() { return items; }, get ksl() { return ksl; } };
})();
