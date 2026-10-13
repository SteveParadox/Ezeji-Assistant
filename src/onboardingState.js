// Required fields for the guided setup route. This is UX guidance, not
// authorization. The backend remains responsible for plan entitlements.
export function requiresCoreBusinessSetup(profile) {
  if (!profile || profile.isStaff) return false;
  const hours = Array.isArray(profile.hoursJson) ? profile.hoursJson : [];
  return !String(profile.business || "").trim() ||
    !String(profile.description || "").trim() ||
    !String(profile.address || "").trim() ||
    !String(profile.cityStateZip || "").trim() ||
    hours.length === 0;
}
