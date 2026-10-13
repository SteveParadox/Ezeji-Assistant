// URL state is presentation-only. Authorization remains server-side.
export const OWNER_DASHBOARD_TABS = Object.freeze([
  "gettingStarted", "overview", "profile", "services", "hours", "faqs",
  "ai", "conversations", "bookings", "staff", "integrations", "analytics", "billing",
]);
export const STAFF_DASHBOARD_TABS = Object.freeze(["conversations", "bookings"]);

export function resolveDashboardTab(search = "", isStaff = false, fallback = null) {
  const allowed = isStaff ? STAFF_DASHBOARD_TABS : OWNER_DASHBOARD_TABS;
  const requested = new URLSearchParams(search).get("tab");
  if (requested && allowed.includes(requested)) return requested;
  if (fallback && allowed.includes(fallback)) return fallback;
  return isStaff ? "bookings" : "overview";
}

export function dashboardUrlForTab(href, tab, isStaff = false) {
  const allowed = isStaff ? STAFF_DASHBOARD_TABS : OWNER_DASHBOARD_TABS;
  if (!allowed.includes(tab)) throw new RangeError("Dashboard page is unavailable for this account.");
  const url = new URL(href);
  url.searchParams.set("view", "dashboard");
  url.searchParams.set("tab", tab);
  return url.pathname + url.search + url.hash;
}
