const PLANS = new Set(["Starter", "Professional", "Business"]);
export const RECOVERY_FLAG = "ezeji-password-recovery";

export function selectedPaidPlan(selection) {
  if (!selection || !PLANS.has(selection.plan)) return null;
  return {
    plan: selection.plan,
    billingPeriod: selection.billingPeriod === "yearly" ? "yearly" : "monthly",
  };
}

export function signupDetails(form) {
  return {
    name: String(form.name || "").trim().slice(0, 120),
    business: String(form.business || "").trim().slice(0, 160),
    businessType: String(form.businessType || "Other").trim().slice(0, 80),
    customBusinessType: String(form.customBusinessType || "").trim().slice(0, 120),
    serviceName: String(form.serviceName || "").trim().slice(0, 160),
    price: String(form.price || "").trim().slice(0, 100),
    hours: String(form.hours || "").trim().slice(0, 160),
    description: String(form.description || "").trim().slice(0, 2000),
  };
}

export function getRegistrationDetails(user) {
  const fields = user?.user_metadata?.business_registration;
  return fields && typeof fields === "object" && !Array.isArray(fields)
    ? signupDetails(fields) : null;
}

export function callbackUrl(type) {
  // The SPA is served at / on the existing Vite and static-host deployments.
  return window.location.origin + "/?auth_callback=" + encodeURIComponent(type);
}

export function readAuthCallback(location = window.location) {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const type = query.get("auth_callback") || (hash.get("type") === "recovery" ? "recovery" : null);
  return {
    type,
    code: query.get("code"),
    tokenHash: query.get("token_hash"),
    otpType: query.get("type"),
    accessToken: hash.get("access_token"),
    refreshToken: hash.get("refresh_token"),
    error: query.get("error_description") || hash.get("error_description") || query.get("error") || hash.get("error"),
  };
}

export function hasAuthCallback(callback) {
  return !!(callback.type || callback.code || callback.tokenHash || callback.accessToken || callback.error);
}

export function destinationForBusiness(profile, selection) {
  if (!profile || (!profile.isStaff && !profile.business)) return "businessSetup";
  if (profile.isStaff) return "dashboard";
  const paid = selectedPaidPlan(selection);
  return paid && !(profile.paymentStatus === "active" && profile.plan === paid.plan)
    ? "checkout" : "dashboard";
}


// Recovery-only navigation marker. This is NOT an authentication credential.
// A Supabase authenticated recovery session remains mandatory to update a password.
export function rememberRecovery(session, storage = window.localStorage, now = Date.now()) {
  if (!session?.user?.id) throw new Error("Recovery session required");
  storage.setItem(RECOVERY_FLAG, JSON.stringify({
    userId: session.user.id,
    expiresAt: now + 30 * 60 * 1000,
  }));
}

export function readRecovery(storage = window.localStorage, now = Date.now()) {
  try {
    const state = JSON.parse(storage.getItem(RECOVERY_FLAG) || "null");
    if (typeof state?.userId === "string" && Number.isFinite(state.expiresAt) && state.expiresAt > now) return state;
  } catch {
    // Corrupt markers are ignored. Supabase controls actual authentication.
  }
  return null;
}
