import { supabase } from "./supabaseClient";
import { API_BASE_URL } from "./shared";

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

export async function registerBusiness(form) {
  const email = String(form.email || "").trim().toLowerCase();
  if (!email || !email.includes("@") || String(form.password || "").length < 8 || !String(form.business || "").trim()) {
    throw new Error("Enter a business name, valid email, and a password of at least 8 characters.");
  }
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
  if (!response.ok || !payload.url) throw new Error(payload.error || "Checkout could not be created.");
  return payload.url;
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
