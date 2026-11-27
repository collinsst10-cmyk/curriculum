'use strict';

// 최소한의 조회용 정보만 저장한다. 학생 인적사항과 학적의 원본은 소속 문서다.
window.YearStudentViews = (() => {
  function stage(tx, fb, row) {
    const ref = fb.F.doc(fb.db, 'rosterYears', String(row.year), 'migrantRoster', row.studentId);
    const stat = fb.F.doc(fb.db, 'rosterYears', String(row.year), 'migrantStats', row.studentId);
    if (row.status !== 'enrolled' || !row.mig) { tx.delete(ref); tx.delete(stat); return; }
    const { studentId, year, classId, grade, cls, no, mig, country, displayName } = row;
    tx.set(ref, { studentId, year, classId, grade, cls, no, type: mig, country: country || '', name: displayName });
    tx.set(stat, { type: mig, country: country || '' });
  }
  return { stage };
})();
