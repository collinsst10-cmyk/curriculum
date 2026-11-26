'use strict';

(() => {
  const classes = [1, 2, 3];
  const days = [1, 2, 3, 4, 5];
  const periods = [1, 2, 3, 4, 5, 6, 7, 8];
  const records = new Map();
  let subscriptions = [];
  let generation = 0;

  // 지정된 담임 또는 관리자가 편집 (보안 규칙도 같음)
  function canEdit(record) {
    if (!record || !Cloud.ready) return false;
    if (Cloud.isAdmin()) return true;
    return Boolean(record.owner && record.owner === String(Cloud.email || '').toLowerCase());
  }

  function render(number) {
    const record = records.get(number);
    const editing = canEdit(record) && record.slots !== null && !record.error;
    const ownerForm = $('kclassOwner' + number);
    ownerForm.hidden = !(Cloud.ready && Cloud.isAdmin() && record?.owner !== null);
    if (!ownerForm.contains(document.activeElement)) {
      ownerForm.querySelector('input').value = record?.owner || '';
    }
    $('kclassSave' + number).hidden = !editing;
    $('kclassMode' + number).textContent = !Cloud.ready ? '승인된 교직원 계정으로 로그인해 주세요.'
      : record?.error ? '시간표 또는 담임 권한을 불러오지 못했습니다.'
      : !record || record.owner === null || record.slots === null ? '시간표를 불러오는 중입니다.'
      : editing ? (Cloud.isAdmin() && record.owner !== String(Cloud.email || '').toLowerCase() ? '관리자 편집 가능 · ' : '편집 가능 · ') + '수업명과 원학급을 입력하고 저장하세요. 원학급 예시 3-1, 4-2'
      : record.owner ? '조회 전용 · 이 학급 담임이 시간표를 편집합니다.'
      : '조회 전용 · 관리자가 담임을 지정하면 편집할 수 있습니다.';
    const table = $('kclassGrid' + number);
    if (!record || record.slots === null) { table.innerHTML = ''; return; }
    table.innerHTML = '<thead><tr><th scope="col">교시</th>' +
      days.map(day => '<th scope="col">' + WD[day] + '</th>').join('') + '</tr></thead><tbody>' +
      periods.map(period => '<tr><th scope="row">' + period + '</th>' + days.map(day => {
        const key = day + '-' + period;
        const slot = (record.draft || record.slots)[key] || {};
        const label = WD[day] + '요일 ' + period + '교시 ';
        return '<td>' + (editing
          ? '<input data-key="' + key + '" data-field="title" aria-label="' + label + '수업명" maxlength="60" placeholder="수업명" value="' + esc(slot.title || '') + '">' +
            '<input data-key="' + key + '" data-field="targets" aria-label="' + label + '원학급" maxlength="80" placeholder="원학급" value="' + esc(slot.targets || '') + '">'
          : '<strong>' + esc(slot.title || '—') + '</strong><div class="hint">' + esc(slot.targets || '') + '</div>') + '</td>';
      }).join('') + '</tr>').join('') + '</tbody>';
  }

  function subscribe() {
    const run = ++generation;
    subscriptions.forEach(unsubscribe => unsubscribe());
    subscriptions = [];
    records.clear();
    classes.forEach(n => {
      $('kclassStatus' + n).textContent = '';
      render(n);
    });
    if (!Cloud.ready) return;
    const { F, db } = Cloud.fb;
    classes.forEach(n => {
      const record = { owner: null, slots: null, draft: null, error: false };
      records.set(n, record);
      const report = () => {
        if (run !== generation) return;
        record.error = true;
        render(n);
      };
      subscriptions.push(F.onSnapshot(F.doc(db, 'kclassOwners', String(n)), snapshot => {
        if (run !== generation) return;
        record.owner = snapshot.data()?.email || '';
        if (!canEdit(record)) record.draft = null;
        render(n);
        document.dispatchEvent(new Event('kclass-change'));
      }, report));
      subscriptions.push(F.onSnapshot(F.doc(db, 'kclassTimetables', String(n)), snapshot => {
        if (run !== generation) return;
        record.slots = snapshot.data()?.slots || {};
        render(n);
        document.dispatchEvent(new Event('kclass-change'));
      }, report));
    });
  }

  function fingerprint(slots) {
    return JSON.stringify(Object.keys(slots).sort().map(key => [key, slots[key].title, slots[key].targets]));
  }

  classes.forEach(n => {
    RENDER['kclass' + n] = () => render(n);
    const status = $('kclassStatus' + n);
    $('kclassOwner' + n).addEventListener('submit', async event => {
      event.preventDefault();
      if (!Cloud.ready || !Cloud.isAdmin()) return;
      const { F, db } = Cloud.fb;
      const run = generation;
      const email = event.currentTarget.querySelector('input').value.trim().toLowerCase();
      try {
        await F.setDoc(F.doc(db, 'kclassOwners', String(n)), { email });
        if (run === generation) status.textContent = '담임 계정을 지정했습니다.';
      } catch (error) {
        if (run === generation) status.textContent = '담임 지정 실패: ' + error.message;
      }
    });
    $('kclassGrid' + n).addEventListener('input', event => {
      const record = records.get(n);
      const { key, field } = event.target.dataset;
      if (!key || !canEdit(record)) return;
      if (!record.draft) {
        record.draft = { ...record.slots };
        record.baseline = fingerprint(record.slots);
      }
      record.draft[key] = { ...record.draft[key], [field]: event.target.value };
    });
    $('kclassSave' + n).addEventListener('click', async event => {
      const record = records.get(n);
      if (!canEdit(record) || !record.draft || record.saving) return;
      const { F, db } = Cloud.fb;
      const ref = F.doc(db, 'kclassTimetables', String(n));
      const slots = {};
      Object.entries(record.draft).forEach(([key, slot]) => {
        const title = (slot.title || '').trim(), targets = (slot.targets || '').trim();
        if (title || targets) slots[key] = { title, targets };
      });
      const run = generation;
      const baseline = record.baseline;
      record.saving = true;
      event.currentTarget.disabled = true;
      try {
        await F.runTransaction(db, async transaction => {
          const current = await transaction.get(ref);
          if (fingerprint(current.data()?.slots || {}) !== baseline) {
            throw new Error('다른 곳에서 시간표를 수정했습니다. 새로고침한 뒤 다시 편집해 주세요.');
          }
          transaction.set(ref, { slots });
        });
        record.draft = null;
        record.slots = slots;
        if (run === generation) { render(n); status.textContent = '시간표를 저장했습니다.'; }
      } catch (error) {
        if (run === generation) status.textContent = '저장 실패: ' + error.message;
      } finally {
        record.saving = false;
        $('kclassSave' + n).disabled = false;
      }
    });
  });

  window.KoreanClasses = {
    isOwner: email => [...records.values()].some(record => record.owner === email),
    hasOwners: () => [...records.values()].some(record => record.owner),
    slotsAt: key => classes.flatMap(n => {
      const slot = records.get(n)?.slots?.[key];
      return slot?.targets ? [{
        group: '한국어학급 ' + n + (slot.title ? ' · ' + slot.title : ''),
        targets: Activities.parseTargets(slot.targets),
      }] : [];
    }),
  };
  document.addEventListener('cloud-change', subscribe);
  if (Cloud.ready) subscribe();
})();
