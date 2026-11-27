'use strict';

window.StaffLinks = (() => {
  let activeCount = null, activeIds = [], names = {}, stopSubjects, stopNames;
  function watchRoom(f, db, email, year, callback, error) {
    let staffStop, fallbackStop;
    const stop = f.onSnapshot(f.doc(db, 'staffAccounts', email), link => {
      staffStop?.(); fallbackStop?.();
      const staffId = link.data()?.staffId;
      const legacy = () => {
        fallbackStop?.();
        fallbackStop = f.onSnapshot(f.doc(db, 'rosterYears', year, 'homerooms', email), callback, error);
      };
      if (!staffId) { legacy(); return; }
      staffStop = f.onSnapshot(f.doc(db, 'staffYears', year, 'ownHomerooms', staffId), assignment => {
        if (assignment.exists()) { fallbackStop?.(); callback(assignment); }
        else legacy();
      }, error);
    }, error);
    return () => { stop(); staffStop?.(); fallbackStop?.(); };
  }

  function subscribe() {
    stopSubjects?.(); stopNames?.();
    activeCount = null; activeIds = []; names = {};
    if (!window.Cloud?.ready) return;
    const { F, db } = Cloud.fb;
    const year = String(state.school.year);
    const refresh = () => document.dispatchEvent(new Event('staff-schedule-change'));
    stopSubjects = F.onSnapshot(F.doc(db, 'staffSchedule', year), snap => {
      activeCount = snap.data()?.activeCount ?? null;
      activeIds = snap.data()?.activeStaffIds || [];
      refresh();
    }, () => { activeCount = null; refresh(); });
    stopNames = F.onSnapshot(F.collection(db, 'staffNames'), snap => {
      names = Object.fromEntries(snap.docs.map(doc => [doc.id, doc.data().name]));
      document.dispatchEvent(new Event('staff-directory-change'));
    }, () => { names = {}; });
  }

  document.addEventListener('cloud-change', subscribe);
  document.addEventListener('year-change', subscribe);
  if (window.Cloud?.ready) subscribe();

  const forEntry = entry => window.StaffSubjectSync?.forEntry(entry) || [];
  return { watchRoom, forEntry, activeCount: () => activeCount,
    activeStaff: () => activeIds.filter(id => names[id]).map(id => ({ id, name: names[id] })) };
})();
