(function exposeRosterPreview(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RosterPreview = api;
}(typeof window !== 'undefined' ? window : globalThis, function createRosterPreview() {
  function rosterPreviewKey(userId, tanggal) {
    return `${userId}|${tanggal}`;
  }

  function addDaysIso(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function diffDaysIso(start, end) {
    return Math.floor((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
  }

  function buildEmployeeCycle(employee) {
    const validStatuses = new Set(['S', 'M', 'CP', 'C', 'OFF']);
    const templateDays = Array.isArray(employee.template_days)
      ? employee.template_days
        .map(status => String(status || '').trim().toUpperCase())
        .filter(status => validStatuses.has(status))
      : [];
    if (templateDays.length) return templateDays;

    const workDays = Number(employee.roster_kerja_hari);
    const leaveDays = Number(employee.roster_cuti_hari);
    const tokens = String(employee.pola_shift || '').trim().toUpperCase().split(/[,+\s]+/).filter(Boolean);
    const workPattern = [];
    tokens.forEach((token) => {
      const match = token.match(/^(\d+)?(OFF|S|M)$/);
      if (!match) return;
      const count = Number(match[1] || 1);
      for (let index = 0; index < count; index += 1) workPattern.push(match[2]);
    });
    if (!Number.isInteger(workDays) || workDays < 1 || !Number.isInteger(leaveDays) || leaveDays < 0 || !workPattern.length) return [];
    const cycle = Array.from({ length: workDays }, (_, index) => workPattern[index % workPattern.length]);
    cycle.push(...Array(leaveDays).fill('CP'));
    return cycle;
  }

  function buildRosterStatusPreview({ employees = [], dates = [], changes = [] } = {}) {
    const preview = new Map();
    const employeeById = new Map(employees.map(employee => [String(employee.id), employee]));
    const changesByUser = new Map();
    changes.forEach((change) => {
      const userId = String(change.user_id || '');
      if (!employeeById.has(userId)) return;
      if (!changesByUser.has(userId)) changesByUser.set(userId, []);
      changesByUser.get(userId).push({ ...change, user_id: userId });
    });

    changesByUser.forEach((userChanges, userId) => {
      const employee = employeeById.get(userId);
      const cycle = buildEmployeeCycle(employee);
      userChanges.sort((a, b) => a.tanggal.localeCompare(b.tanggal)).forEach((change) => {
        preview.set(rosterPreviewKey(userId, change.tanggal), change.status);
        if (change.status !== 'CP' && change.status !== 'OFF') return;

        const leaveDays = change.status === 'CP' ? Number(employee.roster_cuti_hari) : 1;
        if (!Number.isInteger(leaveDays) || leaveDays < 1) return;
        const resetDate = addDaysIso(change.tanggal, leaveDays);
        dates.forEach((date) => {
          if (date >= change.tanggal && date < resetDate) {
            preview.set(rosterPreviewKey(userId, date), change.status);
          } else if (date >= resetDate && cycle.length) {
            const cycleIndex = diffDaysIso(resetDate, date) % cycle.length;
            preview.set(rosterPreviewKey(userId, date), cycle[cycleIndex]);
          }
        });
      });
    });
    return preview;
  }

  return { buildRosterStatusPreview, rosterPreviewKey };
}));
