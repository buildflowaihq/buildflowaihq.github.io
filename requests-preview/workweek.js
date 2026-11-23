/* BuildFlowAI work-week helper. ONE shared rule: which days a client's team works, and who may approve an exception.
   Reads the client's settings: { workDays: [1,2,3,4,5] (0=Sun..6=Sat), approvers: ['kyle','mary'] }.
   Used by the dashboard now; the scheduling engine, inbox agent and gap check call the same functions later (works in node too). */
(function (root) {
  var DEF = { workDays: [1, 2, 3, 4, 5], approvers: [] };
  function cfg(c) { c = c || {}; return { workDays: Array.isArray(c.workDays) && c.workDays.length ? c.workDays : DEF.workDays, approvers: (c.approvers || DEF.approvers).map(function (x) { return String(x).toLowerCase(); }) }; }
  function dow(iso) { var m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : null; }
  function isWorkDay(iso, c) { var d = dow(iso); return d === null ? true : cfg(c).workDays.indexOf(d) >= 0; }
  function nextWorkDay(iso, c) {
    var m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/); if (!m) return iso;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    for (var i = 0; i < 8 && !isWorkDay(new Date(t).toISOString().slice(0, 10), c); i++) t += 864e5;
    return new Date(t).toISOString().slice(0, 10);
  }
  // key for an approval: date + job + title, so one OK covers exactly that item
  function key(item) { return [item.date || item.iso || '', item.job || '', String(item.title || item.text || '').toLowerCase().slice(0, 60)].join('|'); }
  // needsApproval: ONLY for system-generated dates (item.system or item.auto) on a non-work day with no owner OK.
  // A date a person (owner, worker) set on purpose is never flagged.
  function needsApproval(item, approvals, c) { if (!(item.system || item.auto)) return false; return !isWorkDay(item.date || item.iso, c) && !(approvals && approvals[key(item)]); }
  function canApprove(personId, c) { return cfg(c).approvers.indexOf(String(personId || '').toLowerCase()) >= 0; }
  // auto-set dates (inbox agent, gap check, scheduling engine): move to next work day unless the deadline is real
  function autoDate(iso, real, c) { return real || isWorkDay(iso, c) ? iso : nextWorkDay(iso, c); }
  var api = { cfg: cfg, isWorkDay: isWorkDay, nextWorkDay: nextWorkDay, key: key, needsApproval: needsApproval, canApprove: canApprove, autoDate: autoDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BFWeek = api;
})(typeof window !== 'undefined' ? window : this);
