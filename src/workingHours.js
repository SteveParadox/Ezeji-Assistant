export function normalizeClockTime(value) {
  const raw = String(value || "").trim();
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;
  const match = /^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i.exec(raw);
  if (!match) return "";
  const hours = (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return String(hours).padStart(2, "0") + ":" + match[2];
}

export function normalizeWorkingHours(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    open: normalizeClockTime(row?.open),
    close: normalizeClockTime(row?.close),
    closed: row?.closed === true,
  }));
}


// The editor must always offer all seven days, even if a newly provisioned
// account stores hours_json=[] or a legacy account has only a partial week.
// No opening times are fabricated: missing days are closed and blank.
export function buildWeeklySchedule(rows) {
  const normalized = normalizeWorkingHours(rows);
  const byDay = new Map(normalized.filter(row => row && typeof row.day === "string")
    .map(row => [row.day, row]));
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    .map(day => byDay.has(day) ? byDay.get(day) : { day, open: "", close: "", closed: true });
}

export function validateWorkingHours(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "Configure at least one day.";
  const seen = new Set();
  for (const row of rows) {
    if (!row || !row.day || seen.has(row.day)) return "Every day must appear only once.";
    seen.add(row.day);
    if (row.closed) continue;
    if (!normalizeClockTime(row.open) || !normalizeClockTime(row.close) ||
      normalizeClockTime(row.open) >= normalizeClockTime(row.close)) {
      return `Closing time for ${row.day} must be after opening time.`;
    }
  }
  return null;
}

export function summarizeWorkingHours(rows, timezone) {
  return rows.map((row) => row.closed
    ? `${row.day}: Closed`
    : `${row.day}: ${row.open}-${row.close}`
  ).join("; ") + (timezone ? ` (${timezone})` : "");
}
