'use strict';

(() => {
  const isoDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  function bounds(year, configured) {
    const fallback = { start: year + '-03-01', end: (Number(year) + 1) + '-03-01' };
    const start = configured?.start, end = configured?.end;
    return isoDate(start) && isoDate(end) && start < end && start.startsWith(year + '-')
      && end.startsWith((Number(year) + 1) + '-') ? { start, end } : fallback;
  }
  const contains = (date, range) => isoDate(date) && date >= range.start && date < range.end;
  const inferredYear = date => isoDate(date) ? Number(date.slice(0, 4)) - (date.slice(5, 7) < '03' ? 1 : 0) : null;
  const range = () => bounds(state.school.year, window.Haksa?.operatingPeriod);
  const activeDate = () => {
    const today = fmt(new Date()), term = range();
    return contains(today, term) ? today : term.start;
  };
  const canWrite = date => contains(date, range());
  const yearOf = date => canWrite(date) ? state.school.year : inferredYear(date);
  const statsRef = (F, db, year = state.school.year) => F.doc(db, 'yearStats', String(year));
  const api = { bounds, contains, inferredYear, range, activeDate, canWrite, yearOf, statsRef };
  if (typeof module !== 'undefined') module.exports = api;
  else window.OperatingCalendar = api;
})();
