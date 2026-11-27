'use strict';

(() => {
  const key = (grade, cls, subject) => JSON.stringify([Number(grade), Number(cls), subject]);
  const slug = value => String(value || '').trim();
  const teacherKey = id => 'staff:' + id;
  function classesOf(row, counts) {
    const count = Math.max(0, Math.min(20, Number(counts[row.grade]) || 0));
    return row.classes?.length ? [...new Set(row.classes.map(Number).filter(n => n >= 1 && n <= 20))]
      : Array.from({ length: count }, (_, i) => i + 1);
  }
  function sourceIndex(source, names, counts, catalog) {
    const byKey = new Map(), issues = [];
    for (const assignment of source) {
      const name = names[assignment.staffId];
      if (!name) issues.push('등록되지 않은 교직원 ID: ' + assignment.staffId);
      const rooms = assignment.rooms || [];
      for (const room of rooms) {
        const [grade, cls] = room.split('-').map(Number);
        const subject = (catalog[grade] || []).find(item => item.name === slug(assignment.subject))?.key;
        if (!subject || !(cls >= 1 && cls <= Number(counts[grade]))) {
          issues.push(room + ' · ' + assignment.subject + ' — 학급 또는 학년 교과를 확인하세요.');
          continue;
        }
        const id = key(grade, cls, subject);
        const list = byKey.get(id) || [];
        const perClass = Number(assignment.hours) / rooms.length;
        list.push({ grade, cls, subject, staffId: assignment.staffId, name,
          managerHours: assignment.hours, managerClasses: rooms.length,
          suggestedHours: Number.isInteger(perClass) && perClass >= 1 && perClass <= 20 ? perClass : null });
        byKey.set(id, list);
      }
    }
    return { byKey, issues };
  }
  function compare({ source, names, counts, catalog, rows, approved = {}, schedule = [], year }) {
    const { byKey, issues } = sourceIndex(source, names, counts, catalog);
    const local = new Map();
    for (const row of rows) {
      for (const cls of classesOf(row, counts)) {
        const id = key(row.grade, cls, row.subj);
        const list = local.get(id) || [];
        list.push(row); local.set(id, list);
      }
    }
    for (const [id, matches] of local) {
      if (matches.length > 1) issues.push(label(id, catalog) + ' — 기존 편성에 중복 배정이 있습니다.');
      for (const row of matches) if (row.staffId && !names[row.staffId]) {
        issues.push(label(id, catalog) + ' — 편성 자료에 등록되지 않은 교직원 ID가 있습니다.');
      }
    }
    const changes = [];
    for (const id of new Set([...byKey.keys(), ...local.keys(), ...Object.keys(approved)])) {
      const incoming = byKey.get(id) || [], existing = local.get(id) || [], saved = approved[id];
      if (incoming.length > 1) {
        issues.push(label(id, catalog) + ' — 교직원 관리에 담당자가 중복되어 있습니다.');
        continue;
      }
      const target = incoming[0];
      if (!target && !saved) {
        if (existing.length) issues.push(label(id, catalog) + ' — 교직원 관리에 해당 배정이 없습니다. 기존 편성은 유지됩니다.');
        continue;
      }
      if (target && !target.name) continue;
      if (!target && existing.some(row => row.staffId !== saved?.staffId)) {
        issues.push(label(id, catalog) + ' — 승인 연결을 해제해도 별도로 지정한 담당자는 유지됩니다.');
      }
      const row = existing[0];
      const matches = target && existing.length === 1 && row.staffId === target.staffId
        && saved?.staffId === target.staffId && saved.name === target.name && saved.hours === Number(row.hrs)
        && saved.managerHours === target.managerHours && saved.managerClasses === target.managerClasses;
      if (matches) continue;
      const hours = row?.hrs > 0 ? Number(row.hrs) : target?.suggestedHours;
      changes.push({ id, label: label(id, catalog), target, existing, saved, hours, lessons: placements(id, schedule, year, catalog) });
    }
    const conflicts = new Set();
    const candidateLinks = { ...approved };
    for (const change of changes) {
      if (change.target) candidateLinks[change.id] = change.target;
      else delete candidateLinks[change.id];
    }
    for (const [index, a] of schedule.entries()) {
      const first = displayForEntry(a, year, candidateLinks, counts, catalog);
      if (!first.length) continue;
      for (const b of schedule.slice(index + 1)) {
        if (a.weekday !== b.weekday || a.start > b.end || b.start > a.end) continue;
        for (const person of displayForEntry(b, year, candidateLinks, counts, catalog)) {
          if (first.some(row => row.staffId === person.staffId)) conflicts.add(person.name + ' — 제안 항목을 함께 반영하면 같은 요일·교시에 두 수업이 겹칩니다.');
        }
      }
    }
    for (const change of changes) if (change.lessons.length && (change.saved?.staffId !== change.target?.staffId
      || change.saved?.name !== change.target?.name)) issues.push(change.label + ' — 시간표 교사 표시가 새 배정과 다릅니다.');
    return { changes, issues: [...new Set([...issues, ...conflicts])] };
  }
  function label(id, catalog) {
    const [grade, cls, subject] = JSON.parse(id);
    return grade + '학년 ' + cls + '반 · ' + ((catalog[grade] || []).find(item => item.key === subject)?.name || subject);
  }
  function placements(id, schedule, year, catalog) {
    const [grade, cls, subject] = JSON.parse(id);
    const name = (catalog[grade] || []).find(item => item.key === subject)?.name;
    return schedule.filter(entry => Number(entry.year) === Number(year) && entry.kind === '전담과목' &&
      Number(entry.grade) === grade && (!Number(entry.classNo) || Number(entry.classNo) === cls) && slug(entry.title) === name);
  }
  function displayForEntry(entry, year, approved, counts, catalog) {
    if (Number(entry.year) !== Number(year) || entry.kind !== '전담과목') return [];
    const subject = (catalog[entry.grade] || []).find(item => item.name === slug(entry.title))?.key;
    if (!subject) return [];
    const classes = Number(entry.classNo) ? [Number(entry.classNo)] : classesOf({ grade: entry.grade }, counts);
    const teachers = classes.map(cls => approved[key(entry.grade, cls, subject)]).filter(Boolean);
    return [...new Map(teachers.map(row => [row.staffId, row])).values()];
  }
  function apply({ rows, approved = {}, counts, changes, choices }) {
    const selected = new Map(changes.filter(change => choices.has(change.id)).map(change => [change.id, change]));
    const nextApproved = { ...approved };
    const nextRows = rows.flatMap(row => {
      const previousClasses = classesOf(row, counts);
      const remaining = previousClasses.filter(cls => {
        const change = selected.get(key(row.grade, cls, row.subj));
        if (!change) return true;
        return !change.target && row.staffId !== change.saved?.staffId;
      });
      if (remaining.length === previousClasses.length) return [row];
      return remaining.length ? [{ ...row, classes: remaining }] : [];
    });
    for (const [id, change] of selected) {
      if (!change.target) { delete nextApproved[id]; continue; }
      const hours = Number(choices.get(id));
      if (!Number.isInteger(hours) || hours < 1 || hours > 20) throw new Error(change.label + '의 반당 시수를 확인하세요.');
      const { staffId, name, grade, cls, subject, managerHours, managerClasses } = change.target;
      const old = change.existing[0];
      nextRows.push({ ...old, teacher: teacherKey(staffId), staffId, staffName: name,
        grade, subj: subject, classes: [cls], hrs: hours });
      nextApproved[id] = { staffId, name, hours, managerHours, managerClasses };
    }
    return { rows: nextRows, approved: nextApproved };
  }
  const api = { compare, apply, displayForEntry, teacherKey, key };
  if (typeof module !== 'undefined') module.exports = api;
  else window.StaffSyncModel = api;
})();
