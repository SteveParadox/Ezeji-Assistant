import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { Eye, EyeOff } from "lucide-react";
import { resolveSignedInUserWith } from "./signedInUser.js";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5174";

export function Logo({ size = 18 }) {
  return (
    <div className="brand">
      <span className="dot-static" />
      <span className="brand-name" style={{ fontSize: size }}>Ezeji Assistant</span>
    </div>
  );
}

export async function fetchPublicProfile(businessId) {
  if (typeof businessId !== "string" || !/^[0-9a-f-]{36}$/i.test(businessId)) return null;
  const response = await fetch(`${API_BASE_URL}/public-business/${encodeURIComponent(businessId)}`);
  if (response.status === 404) return null;
  const payload = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(payload.error || "Public business information unavailable");
  return payload.business;
}

export async function fetchProfile(userId, email, userMetadata = {}) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // A failed lookup must never be confused with a missing business.
    throw new Error("Unable to load your business account. Please retry.");
  }
  if (!data) return null;

  let paidSubscription = null;
  if (data.plan !== "14-day trial") {
    const { data: subscription, error: subscriptionError } = await supabase.from("subscriptions")
      .select("plan,billing_period,status,current_period_end,grace_period_ends_at,cancel_at_period_end")
      .eq("business_id", data.id).maybeSingle();
    if (subscriptionError) throw new Error("Unable to validate your subscription. Please retry.");
    paidSubscription = subscription;
  }
  const subscriptionValid = paidSubscription && (
    (["active", "cancellation_scheduled"].includes(paidSubscription.status) &&
      Date.parse(paidSubscription.current_period_end) > Date.now()) ||
    (paidSubscription.status === "grace" &&
      Date.parse(paidSubscription.grace_period_ends_at) > Date.now())
  );

  return {
    id: data.id,
    email,
    name: data.name,
    business: data.business,
    businessType: data.business_type,
    customBusinessType: data.custom_business_type,
    serviceName: data.service_name,
    price: data.price,
    hours: data.hours,
    description: data.description,
    phone: data.contact_phone || "",
    contactEmail: data.public_contact_email || "",
    website: data.website || "",
    plan: paidSubscription?.plan || data.plan,
    billingPeriod: paidSubscription?.billing_period || data.billing_period,
    currency: data.currency,
    paymentStatus: data.plan === "14-day trial" ? data.payment_status : (subscriptionValid ? "active" : "expired"),
    subscriptionEndsAt: paidSubscription?.current_period_end || null,
    cancelAtPeriodEnd: paidSubscription?.cancel_at_period_end === true,
    trialActive: data.trial_active,
    trialEndsAt: data.trial_ends_at,
    assistantName: data.assistant_name,
    tone: data.tone,
    greeting: data.greeting,
    escalationKeywords: data.escalation_keywords,
    hoursJson: data.hours_json,
    timezone: data.timezone || 'Africa/Lagos',
    address: data.address,
    cityStateZip: data.city_state_zip,
    disappearingDefault: data.disappearing_default,
    assistantLive: userMetadata?.assistant_live !== false,
  };
}

export async function resolveSignedInUser(authUser, accessToken) {
  return resolveSignedInUserWith(authUser, accessToken, {
    lookupProfile: fetchProfile,
    lookupStaff: (token) => {
      const selected = typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("ezeji-staff-business") : null;
      const query = selected ? "?businessId=" + encodeURIComponent(selected) : "";
      const headers = { Authorization: `Bearer ${token}` };
      return fetch(`${API_BASE_URL}/staff/me${query}`, { headers }).then(async response => {
        if (selected && response.status === 403) {
          // A previous account's saved business context must never trap a
          // newly signed-in member in an unauthorized selection loop.
          sessionStorage.removeItem("ezeji-staff-business");
          return fetch(`${API_BASE_URL}/staff/me`, { headers });
        }
        return response;
      });
    },
  });
}

export async function upsertProfile(userId, fields) {
  // Update display/configuration fields only. Creation and billing changes
  // belong to the authenticated server provisioning/payment paths.
  const changes = {
    name: fields.name,
    business: fields.business,
    business_type: fields.businessType,
    custom_business_type: fields.customBusinessType,
    service_name: fields.serviceName,
    price: fields.price,
    hours: fields.hours,
    description: fields.description,
    contact_phone: fields.phone,
    public_contact_email: fields.contactEmail,
    website: fields.website,
    assistant_name: fields.assistantName,
    tone: fields.tone,
    greeting: fields.greeting,
    escalation_keywords: fields.escalationKeywords,
    hours_json: fields.hoursJson,
    timezone: fields.timezone,
    address: fields.address,
    city_state_zip: fields.cityStateZip,
  };
  const patch = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
  const { data, error } = await supabase.from("profiles")
    .update(patch).eq("id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Business profile is missing or access was denied.");

  if (typeof fields.assistantLive === "boolean") {
    const { error: metadataError } = await supabase.auth.updateUser({
      data: { assistant_live: fields.assistantLive },
    });
    if (metadataError) throw metadataError;
  }
}

export function TextField({ label, type = "text", icon: Icon, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-input-wrap">
        {Icon && <Icon className="field-icon" />}
        <input
          className="field-input"
          type={isPassword && show ? "text" : type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
        {isPassword && (
          <button type="button" className="field-eye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff className="field-icon" /> : <Eye className="field-icon" />}
          </button>
        )}
      </div>
    </label>
  );
}

export function AuthShell({ children, footer }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Logo size={20} />
        {children}
      </div>
      <p className="auth-footer">{footer}</p>
    </div>
  );
}


export function getStoredPlanSelection() {
  const trial = { plan: "14-day trial", mode: "trial", billingPeriod: "monthly", currency: "NGN" };
  if (typeof window === "undefined") return trial;
  try {
    const saved = window.localStorage.getItem("nightline-plan-selection");
    if (saved) {
      const selection = JSON.parse(saved);
      return selection && typeof selection === "object" && !Array.isArray(selection)
        ? { ...trial, ...selection, currency: "NGN" }
        : trial;
    }
    const legacy = window.localStorage.getItem("nightline-trial-plan");
    return legacy ? {
      plan: legacy,
      mode: legacy === "14-day trial" ? "trial" : "paid",
      billingPeriod: "monthly",
      currency: "NGN",
    } : trial;
  } catch {
    return trial;
  }
}

export const STAFF_LIMITS = {
  '14-day trial': 1,
  'Starter': 1,
  'Professional': 3,
  'Business': Infinity,
};

export const ANALYTICS_TIER = {
  '14-day trial': 'basic',
  'Starter': 'basic',
  'Professional': 'advanced',
  'Business': 'advanced',
};

export const AI_PERSONALITY_PLANS = ['Professional', 'Business'];

// Must match PLAN_LIMITS in server.js exactly - this is what's shown to the
// business owner so they can see a limit coming before a real customer
// actually gets blocked by it.
export const CONVERSATION_LIMITS = {
  '14-day trial': 100,
  'Starter': 500,
  'Professional': 2500,
  'Business': Infinity,
};


export function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value" style={accent ? { color: "var(--amber)" } : undefined}>{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

// Real, simple CSV export - pure client-side, no backend needed. This is
// what makes "Export your data" an actual capability instead of copy.
export function downloadCsv(filename, rows, columns) {
  if (!rows.length) return;
  const escape = (val) => {
    const s = `${val ?? ""}`.replace(/"/g, '""');
    return `"${s}"`;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(c.get(row))).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}