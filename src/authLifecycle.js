import { supabase } from "./supabaseClient";
import { API_BASE_URL } from "./shared";
import { signupDetails, selectedPaidPlan, callbackUrl } from "./authState";
import { validateSignupFields } from "./signupValidation";
export { RECOVERY_FLAG, selectedPaidPlan, signupDetails, getRegistrationDetails, callbackUrl, readAuthCallback, hasAuthCallback, destinationForBusiness, isSelectedPlanActive, readRecovery, rememberRecovery } from "./authState";

export async function registerBusiness(form) {
  const email = String(form.email || "").trim().toLowerCase();
  const validationError = validateSignupFields(form);
  if (validationError) throw new Error(validationError);
  const { data, error } = await supabase.auth.signUp({
    email,
    password: form.password,
    options: {
      emailRedirectTo: callbackUrl("confirm"),
      data: { business_registration: signupDetails(form) },
    },
  });
  if (error) throw error;
  // Supabase may return a non-null user and a null session until verification.
  return { session: data.session, email };
}

export async function ensureBusinessProfile(session, details) {
  if (!session?.access_token) throw new Error("Sign in before setting up a business.");
  const response = await fetch(API_BASE_URL + "/business/profile/ensure", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify({ fields: signupDetails(details || {}) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not initialize your business. Please retry.");
  return payload;
}

export async function startAuthenticatedCheckout(session, selection) {
  const chosen = selectedPaidPlan(selection);
  if (!chosen) throw new Error("Choose a valid paid subscription plan.");
  if (!session?.access_token) throw new Error("Sign in before starting checkout.");
  const response = await fetch(API_BASE_URL + "/create-checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify(chosen),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url || !payload.reference) throw new Error(payload.error || "Checkout could not be created.");
  window.localStorage.setItem("ezeji-last-checkout-ref", payload.reference);
  return payload.url;
}

export async function completeAuthCallback(callback) {
  if (callback.error) throw new Error(callback.error);
  let result;
  if (callback.tokenHash) {
    const type = callback.otpType || (callback.type === "recovery" ? "recovery" : "signup");
    if (!["recovery", "signup", "email", "magiclink", "invite"].includes(type)) {
      throw new Error("Invalid authentication link type.");
    }
    result = await supabase.auth.verifyOtp({ token_hash: callback.tokenHash, type });
  } else if (callback.code) {
    result = await supabase.auth.exchangeCodeForSession(callback.code);
  } else if (callback.accessToken && callback.refreshToken) {
    result = await supabase.auth.setSession({
      access_token: callback.accessToken,
      refresh_token: callback.refreshToken,
    });
  } else {
    throw new Error("This link is incomplete or expired. Request a new email.");
  }
  if (result.error) throw result.error;
  if (!result.data?.session) throw new Error("Authentication did not establish a session.");
  return result.data.session;
}

export function scrubAuthCallback() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_callback");
  url.searchParams.delete("code");
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search);
}
