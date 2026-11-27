'use strict';

window.BehaviorUI = (() => {
  const { groups, statuses } = BehaviorData;
  const root = $('behaviorPanel');
  const drafts = new Map();
  const items = new Map();
  const versions = new Map();
  let rows = [], active = '', ownerKey = '', room = '', epoch = 0;

  // Use only the administrator-assigned classroom for this additional student record.
  function permitted(student) {
    const position = Cloud.position || {};
    return Cloud.ready && (Cloud.isAdmin() || (position.posType === 'homeroom' &&
      position.posCls === student.grade + '-' + student.cls));
  }

  function reference(student) {
    return Cloud.fb.F.doc(Cloud.fb.db, 'students', student.id, 'privateRecords', 'behavior');
  }

  function switchRoom(students) {
    const account = Cloud.ready ? Cloud.email : '';
    const nextRoom = students[0] ? students[0].grade + '-' + students[0].cls : '';
    if (account !== ownerKey || nextRoom !== room) {
      ++epoch;
      drafts.clear(); items.clear(); versions.clear(); active = '';
      ownerKey = account; room = nextRoom;
    }
  }

  function sync(students) {
    switchRoom(students);
    rows = students.filter(permitted);
    root.hidden = !rows.length;
    if (!rows.length) { root.innerHTML = ''; return; }
    if (!rows.some(student => student.id === active)) active = rows[0].id;
    const current = epoch;
    for (const student of rows) {
      if (items.has(student.id)) continue;
      items.set(student.id, { loading: true });
      Cloud.fb.F.getDoc(reference(student)).then(snapshot => {
        if (current !== epoch) return;
        const data = snapshot.data() || {};
        items.set(student.id, { traits: data.traits || {}, opinion: data.opinion || '', target: data.target || 300 });
        if (active === student.id) render();
        else paintList();
      }).catch(() => {
        if (current !== epoch) return;
        items.set(student.id, { error: true });
        if (active === student.id) render();
        else paintList();
      });
    }
    if (!root.querySelector('#behaviorEditor') || root.dataset.student !== active) render();
    else paintList();
  }

  function paintList() {
    const list = $('behaviorList');
    if (!list) return;
    list.innerHTML = rows.map(student => {
      const data = items.get(student.id);
      const count = Object.keys(data?.traits || {}).length;
      return '<button type="button" class="btn" data-student="' + esc(student.id) + '" aria-pressed="' +
        (active === student.id) + '"><span>' + esc((student.no || '') + ' ' + student.name) + '</span><small>' +
        (data?.loading ? '불러오는 중' : data?.error ? '확인 실패' : count ? '특성 ' + count + '개' : '미설정') + '</small></button>';
    }).join('');
  }

  function draftFor(data) {
    if (!drafts.has(active)) drafts.set(active, { text: data.opinion, dirty: false, variation: 0, status: '' });
    return drafts.get(active);
  }

  function render() {
    root.dataset.student = active;
    root.innerHTML = '<h2>행동특성 및 종합의견</h2><div class="behavior-layout"><nav id="behaviorList" aria-label="학생 목록"></nav><div id="behaviorEditor"></div></div>';
    paintList();
    const data = items.get(active), editor = $('behaviorEditor');
    if (!data || data.loading) { editor.textContent = '학생 설정을 불러오는 중입니다.'; return; }
    if (data.error) { editor.textContent = '설정을 읽지 못했습니다. 권한과 연결 상태를 확인한 뒤 새로고침해 주세요.'; return; }
    const draft = draftFor(data);
    editor.innerHTML = '<div class="behavior-heading"><b id="behaviorCount"></b><button class="btn small" data-action="clear">선택 초기화</button></div>' +
      '<div class="behavior-groups">' + groups.map((group, index) => '<details ' + (index < 2 ? 'open' : '') +
        ' class="behavior-group" data-tone="' + index + '"><summary>' + group.name + '<span data-count="' + index + '"></span></summary><div class="behavior-chips">' +
        group.traits.map(trait => '<div class="behavior-trait"><button type="button" class="behavior-chip" data-trait="' + trait.id +
          '">' + trait.label + '</button><select data-state="' + trait.id + '" aria-label="' + trait.label + ' 발달 상태" hidden>' +
          '<option value="">상태 선택</option>' + Object.entries(statuses).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('') +
          '</select></div>').join('') + '</div></details>').join('') + '</div>' +
      '<div class="behavior-result"><h3>생성 결과</h3><div class="row"><label>목표 글자 수 <input id="behaviorTarget" type="number" min="1" max="2000" value="' + data.target + '"></label>' +
      [100, 200, 300, 400, 500].map(n => '<button class="btn small" data-goal="' + n + '">' + n + '자</button>').join('') +
      '</div><div class="row"><button class="btn primary" data-action="generate">행발특성 생성</button><button class="btn" data-action="again">다른 문장으로 다시 생성</button></div>' +
      '<label for="behaviorText">행동특성 및 종합의견</label><textarea id="behaviorText" rows="6" maxlength="4000"></textarea><div id="behaviorLength" class="hint"></div>' +
      '<div class="row"><button class="btn small" data-action="copy">복사</button><button class="btn small primary" data-action="save">학생별 저장</button>' +
      '<button class="btn small" data-action="restore">저장 내용 불러오기</button></div><p id="behaviorStatus" role="status"></p></div>';
    $('behaviorText').value = draft.text;
    $('behaviorStatus').textContent = draft.status;
    paintTraits(); paintLength();
  }

  function paintTraits() {
    const data = items.get(active);
    if (!$('behaviorCount')) return;
    $('behaviorCount').textContent = '선택한 특성 ' + Object.keys(data.traits).length + '개';
    groups.forEach((group, index) => {
      let count = 0;
      for (const trait of group.traits) {
        const selected = Object.hasOwn(data.traits, trait.id);
        count += Number(selected);
        const button = root.querySelector('[data-trait="' + trait.id + '"]');
        button.setAttribute('aria-pressed', String(selected));
        const select = root.querySelector('[data-state="' + trait.id + '"]');
        select.value = data.traits[trait.id] || '';
        select.hidden = !selected;
      }
      root.querySelector('[data-count="' + index + '"]').textContent = count ? ' ' + count + '개' : '';
    });
    paintList();
  }

  function paintLength() {
    const text = $('behaviorText').value;
    $('behaviorLength').textContent = BehaviorEngine.length(text) + '자 (공백 포함) · UTF-8 ' + BehaviorEngine.bytes(text) + '바이트';
  }

  function message(id, text) {
    const draft = drafts.get(id);
    if (draft) draft.status = text;
    if (id === active && $('behaviorStatus')) $('behaviorStatus').textContent = text;
  }

  async function persist(student, patch) {
    if (!permitted(student)) return false;
    const id = student.id, current = epoch;
    const version = (versions.get(id) || 0) + 1;
    versions.set(id, version);
    try {
      await Cloud.fb.F.setDoc(reference(student), patch, { mergeFields: Object.keys(patch) });
      if (current !== epoch) return false;
      if (version === versions.get(id)) message(id, '저장했습니다.');
      return true;
    } catch {
      if (current === epoch) message(id, '저장하지 못했습니다. 연결과 권한을 확인한 뒤 다시 시도해 주세요.');
      return false;
    }
  }

  function updateTraits(student, data, traits) {
    data.traits = traits;
    paintTraits();
    message(student.id, '선택 저장 중…');
    persist(student, { traits });
  }

  root.addEventListener('change', event => {
    const student = rows.find(row => row.id === active);
    if (!student || !permitted(student)) return;
    const data = items.get(active), node = event.target;
    if (node.dataset.state && Object.hasOwn(data.traits, node.dataset.state)) {
      updateTraits(student, data, { ...data.traits, [node.dataset.state]: node.value });
    } else if (node.id === 'behaviorTarget' && node.checkValidity() && node.value) {
      data.target = Number(node.value);
      persist(student, { target: data.target });
    }
  });

  root.addEventListener('input', event => {
    if (event.target.id !== 'behaviorText') return;
    const draft = drafts.get(active);
    draft.text = event.target.value;
    draft.dirty = true;
    paintLength();
  });

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.student) { active = button.dataset.student; render(); return; }
    const student = rows.find(row => row.id === active), data = items.get(active);
    if (!student || !permitted(student) || data?.loading || data?.error) return;
    const id = active, draft = draftFor(data);
    if (button.dataset.trait) {
      const traits = { ...data.traits }, key = button.dataset.trait;
      if (Object.hasOwn(traits, key)) delete traits[key]; else traits[key] = '';
      updateTraits(student, data, traits);
      return;
    }
    if (button.dataset.goal) {
      data.target = Number(button.dataset.goal);
      $('behaviorTarget').value = data.target;
      persist(student, { target: data.target });
      return;
    }
    switch (button.dataset.action) {
      case 'clear':
        if (Object.keys(data.traits).length && confirm('이 학생의 특성 선택을 초기화할까요?')) updateTraits(student, data, {});
        break;
      case 'generate':
      case 'again': {
        const target = $('behaviorTarget');
        if (!target.value || !target.reportValidity()) { target.focus(); return; }
        if (!Object.keys(data.traits).length) { message(id, '행동발달 특성을 먼저 선택해 주세요.'); return; }
        if (draft.dirty && !confirm('현재 수정한 문장을 새 생성 결과로 바꿀까요?')) return;
        if (button.dataset.action === 'again') draft.variation++;
        const peers = rows.filter(row => row.id !== id).flatMap(row => [items.get(row.id)?.opinion, drafts.get(row.id)?.text].filter(Boolean));
        const generated = BehaviorEngine.generate({ selected: data.traits, grade: student.grade, goal: Number(target.value),
          peers, previous: draft.text, variation: draft.variation });
        if (!generated) { message(id, '선택한 특성으로 문장을 조합하지 못했습니다.'); return; }
        draft.text = generated;
        draft.dirty = true;
        $('behaviorText').value = generated;
        paintLength();
        message(id, Math.abs(BehaviorEngine.length(generated) - Number(target.value)) > 30
          ? '선택한 특성으로 만들 수 있는 분량만 작성했습니다.' : '초안을 생성했습니다. 관찰 내용과 일치하는지 확인해 주세요.');
        break;
      }
      case 'save': {
        const value = draft.text;
        button.disabled = true;
        const saved = await persist(student, { opinion: value, traits: data.traits });
        if (saved && items.get(id) === data) {
          data.opinion = value;
          if (draft.text === value) draft.dirty = false;
        }
        button.disabled = false;
        break;
      }
      case 'restore':
        if (draft.dirty && !confirm('현재 초안을 저장된 내용으로 바꿀까요?')) return;
        draft.text = data.opinion;
        draft.dirty = false;
        $('behaviorText').value = draft.text;
        paintLength();
        message(id, '저장된 내용을 불러왔습니다.');
        break;
      case 'copy':
        try { await navigator.clipboard.writeText(draft.text); message(id, '복사했습니다.'); }
        catch { message(id, '자동 복사가 안 됩니다. 결과를 선택해 직접 복사해 주세요.'); }
        break;
    }
  });

  return { sync };
})();
