// Required fields for the guided setup route. This is UX guidance, not
// authorization. The backend remains responsible for plan entitlements.
export function hasConfiguredOpeningHours(rows) {
  return Array.isArray(rows) && rows.some((row) => row && row.closed === false &&
    typeof row.open === "string" && row.open.trim() &&
    typeof row.close === "string" && row.close.trim());
}

export function requiresCoreBusinessSetup(profile) {
  if (!profile || profile.isStaff) return false;
  const hours = Array.isArray(profile.hoursJson) ? profile.hoursJson : [];
  return !String(profile.business || "").trim() ||
    !String(profile.description || "").trim() ||
    !String(profile.address || "").trim() ||
    !String(profile.cityStateZip || "").trim() ||
    !hasConfiguredOpeningHours(hours);
}
