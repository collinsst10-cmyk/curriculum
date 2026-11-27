(function () {
  'use strict';

  const form = $('schoolHistoryForm');
  const timeline = $('schoolHistoryTimeline');
  const adminList = $('schoolHistoryManageList');
  const status = $('schoolHistoryStatus');
  const saveButton = $('schoolHistorySave');
  const cancel = $('schoolHistoryCancel');
  const fields = form.elements;
  let entries = [], editing = '', unsubscribe, generation = 0;
  let busy = false, loaded = false;

  const canEdit = () => !!window.Cloud?.ready && Cloud.isAdmin() && !App.locked();
  const collection = () => Cloud.fb.F.collection(Cloud.fb.db, 'schoolHistory');

  function render() {
    const sorted = [...entries].sort((a, b) =>
      b.date.localeCompare(a.date) || a.order - b.order || a.id.localeCompare(b.id));
    timeline.replaceChildren(...sorted.map(item => {
      const row = document.createElement('li');
      const date = document.createElement('time');
      date.dateTime = item.date;
      date.textContent = item.date.replaceAll('-', '. ');
      const title = document.createElement('strong');
      title.textContent = item.title;
      row.append(date, title);
      if (item.description) {
        const note = document.createElement('p');
        note.textContent = item.description;
        row.append(note);
      }
      return row;
    }));
    timeline.hidden = !sorted.length;
    $('schoolHistoryEmpty').hidden = !!sorted.length;
    $('schoolHistoryEmpty').textContent = loaded || !Cloud.ready ? '등록된 학교 연혁이 없습니다.' : '학교 연혁을 불러오는 중입니다.';
    adminList.replaceChildren(...(canEdit() ? sorted.map(item => {
      const row = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = item.date + ' · ' + item.title;
      row.append(title);
      for (const [action, label] of [['edit', '수정'], ['delete', '삭제']]) {
        const button = document.createElement('button');
        button.className = 'btn small' + (action === 'delete' ? ' danger' : '');
        button.textContent = label;
        button.dataset.historyAction = action;
        button.dataset.id = item.id;
        row.append(button);
      }
      return row;
    }) : []));
    saveButton.disabled = !loaded || !canEdit() || busy;
  }

  function reset() {
    editing = '';
    saveButton.textContent = '연혁 추가';
    cancel.hidden = true;
    fields.date.setCustomValidity('');
  }

  function subscribe() {
    const current = ++generation;
    unsubscribe?.();
    unsubscribe = undefined;
    entries = [];
    loaded = false;
    form.reset();
    status.textContent = '';
    render();
    if (!Cloud.ready || App.locked()) return;
    const { F } = Cloud.fb;
    unsubscribe = F.onSnapshot(collection(), { includeMetadataChanges: true }, snapshot => {
      if (generation !== current || snapshot.metadata.fromCache) return;
      entries = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      loaded = true;
      render();
    }, () => {
      if (generation !== current) return;
      entries = [];
      loaded = false;
      render();
      $('schoolHistoryEmpty').textContent = '학교 연혁을 불러오지 못했습니다.';
      status.textContent = '학교 연혁을 불러오지 못했습니다.';
    });
  }

  function validDate(value) {
    if (/^[1-9]\d{3}$/.test(value)) return true;
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  async function mutate(action, message) {
    if (!canEdit() || busy || !loaded) return;
    busy = true;
    saveButton.disabled = true;
    const current = generation;
    try {
      await action(Cloud.fb.F);
      if (generation !== current) return;
      status.textContent = message;
      form.reset();
    } catch {
      if (generation === current) status.textContent = '변경을 저장하지 못했습니다. 다시 시도해 주세요.';
    } finally {
      busy = false;
      render();
    }
  }

  fields.date.addEventListener('input', () => fields.date.setCustomValidity(''));
  form.addEventListener('reset', reset);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const date = fields.date.value.trim();
    fields.date.setCustomValidity(validDate(date) ? '' : '연도 또는 실제 날짜를 연도-월-일 형식으로 입력해 주세요.');
    if (!form.reportValidity()) return;
    const item = { date, title: fields.title.value.trim(), description: fields.description.value.trim(), order: fields.order.valueAsNumber };
    if (!item.title) { status.textContent = '연혁 제목을 입력해 주세요.'; return; }
    const id = editing;
    mutate(F => id ? F.updateDoc(F.doc(collection(), id), item) : F.addDoc(collection(), item),
      id ? '연혁을 수정했습니다.' : '연혁을 추가했습니다.');
  });
  adminList.addEventListener('click', event => {
    const button = event.target.closest('[data-history-action]');
    if (!button || !canEdit() || busy) return;
    const item = entries.find(entry => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.historyAction === 'edit') {
      editing = item.id;
      for (const key of ['date', 'title', 'description', 'order']) fields[key].value = item[key];
      fields.date.setCustomValidity('');
      saveButton.textContent = '수정 저장';
      cancel.hidden = false;
      fields.date.focus();
    } else if (confirm(item.title + ' 연혁을 삭제할까요?')) {
      mutate(F => F.deleteDoc(F.doc(collection(), item.id)), '연혁을 삭제했습니다.');
    }
  });
  document.addEventListener('cloud-change', subscribe);
  subscribe();
})();
