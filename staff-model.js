'use strict';

(() => {
  const roles = ['homeroom', 'gradeTeam', 'department', 'duty', 'subject', 'other'];
  const statuses = ['active', 'leave', 'transferred', 'retired'];
  const empty = () => ({ employment: {}, groups: {}, assignments: {} });
  const copy = data => structuredClone(data || empty());
  const text = (value, limit) => String(value || '').trim().slice(0, limit);
  const fail = message => { throw new Error(message); };
  const roomKey = (grade, cls) => Number(grade) + '-' + Number(cls);
  const validRoom = value => /^[1-6]-([1-9]|1[0-9]|20)$/.test(value);

  function apply(data, action) {
    const result = copy(data);
    const { type, id } = action;
    if (type === 'employment') {
      if (!statuses.includes(action.status)) fail('재직 상태를 확인해 주세요.');
      if (action.status !== 'active' && Object.values(result.assignments).some(row => row.kind === 'homeroom' && row.primary === id)) {
        fail('담임을 해제하거나 다른 교직원에게 배정한 뒤 재직 상태를 변경해 주세요.');
      }
      result.employment[id] = { status: action.status, position: text(action.position, 60), note: text(action.note, 250) };
      return result;
    }
    if (type === 'placement') {
      const prior = result.employment[id] || { status: 'active', note: '' };
      const existing = Object.entries(result.assignments).find(([, row]) => row.kind === 'homeroom' && row.primary === id);
      result.employment[id] = { ...prior, position: text(action.position, 60) };
      if (!action.room) {
        if (existing) delete result.assignments[existing[0]];
        return result;
      }
      return apply(result, { ...existing?.[1], type: 'assignment', kind: 'homeroom',
        id: existing?.[0] || action.assignmentId, primary: id, room: action.room });
    }
    if (type === 'group') {
      const name = text(action.name, 60);
      if (!name || !['gradeTeam', 'department'].includes(action.kind)) fail('학년부 또는 부서 이름을 확인해 주세요.');
      if (result.groups[id] && result.groups[id].kind !== action.kind) fail('기존 조직의 구분은 변경할 수 없습니다.');
      result.groups[id] = { kind: action.kind, name };
      return result;
    }
    if (type === 'remove') {
      delete result.assignments[id];
      return result;
    }
    if (type !== 'assignment' || !roles.includes(action.kind)) fail('배정 구분을 확인해 주세요.');
    const primary = action.primary, people = [...new Set(action.people || [])].filter(person => person !== primary);
    if (!primary || [primary, ...people].some(person => result.employment[person]?.status !== 'active')) {
      fail('해당 학년도에 재직 중인 교직원만 배정할 수 있습니다.');
    }
    const row = { kind: action.kind, primary, people, name: text(action.name, 80), note: text(action.note, 500) };
    if (row.kind === 'homeroom') {
      if (!validRoom(action.room)) fail('담임 학급을 확인해 주세요.');
      if (Object.entries(result.assignments).some(([key, item]) => key !== id && item.kind === 'homeroom'
          && (item.room === action.room || item.primary === primary))) fail('학급 또는 교직원에 이미 담임 배정이 있습니다.');
      row.room = action.room;
      row.people = [];
    }
    if (['gradeTeam', 'department', 'duty'].includes(row.kind)) {
      const group = result.groups[action.group];
      if (!group || group.kind !== (row.kind === 'gradeTeam' ? 'gradeTeam' : 'department')) fail('소속 조직을 먼저 등록해 주세요.');
      if (row.kind !== 'duty' && Object.entries(result.assignments).some(([key, item]) => key !== id && item.kind === row.kind && item.group === action.group)) {
        fail('조직의 구성원을 변경하려면 기존 배정을 수정해 주세요.');
      }
      row.group = action.group;
    }
    if (row.kind === 'subject') {
      row.rooms = [...new Set(action.rooms || [])];
      row.hours = Number(action.hours);
      if (!row.name || !row.rooms.length || row.rooms.some(room => !validRoom(room)) || !Number.isInteger(row.hours)
          || row.hours < 1 || row.hours > 40) fail('교과, 담당 학급, 주당 시수를 확인해 주세요.');
      if (Object.entries(result.assignments).some(([key, item]) => key !== id && item.kind === 'subject' &&
          item.name === row.name && item.rooms.some(room => row.rooms.includes(room)))) fail('같은 학급·교과에 이미 전담 배정이 있습니다.');
      row.people = [];
    }
    if (['duty', 'other'].includes(row.kind) && !row.name) fail('업무명을 입력해 주세요.');
    result.assignments[id] = row;
    return result;
  }

  const homerooms = data => Object.fromEntries(Object.values(data.assignments)
    .filter(row => row.kind === 'homeroom').map(row => [row.primary, row.room]));
  const subjects = data => Object.values(data.assignments).filter(row => row.kind === 'subject')
    .map(({ primary, name, rooms, hours }) => ({ staffId: primary, subject: name, rooms, hours }));
  const api = { empty, apply, homerooms, subjects, roles, statuses, roomKey };
  if (typeof module !== 'undefined') module.exports = api;
  else window.StaffModel = api;
})();
