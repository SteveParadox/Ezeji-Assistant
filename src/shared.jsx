import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { Eye, EyeOff } from "lucide-react";

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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, business, business_type, custom_business_type, service_name, price, hours, description")
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    console.error("fetchPublicProfile error:", error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    business: data.business,
    businessType: data.business_type,
    customBusinessType: data.custom_business_type,
    serviceName: data.service_name,
    price: data.price,
    hours: data.hours,
    description: data.description,
  };
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
    plan: data.plan,
    billingPeriod: data.billing_period,
    currency: data.currency,
    paymentStatus: data.payment_status,
    trialActive: data.trial_active,
    trialEndsAt: data.trial_ends_at,
    assistantName: data.assistant_name,
    tone: data.tone,
    greeting: data.greeting,
    escalationKeywords: data.escalation_keywords,
    hoursJson: data.hours_json,
    address: data.address,
    cityStateZip: data.city_state_zip,
    disappearingDefault: data.disappearing_default,
    assistantLive: userMetadata.assistant_live !== false,
  };
}

export async function resolveSignedInUser(authUser, accessToken) {
  const profile = await fetchProfile(authUser.id, authUser.email, authUser.user_metadata);
  if (profile) return profile;

  const response = await fetch(`${API_BASE_URL}/staff/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load staff access.");

  return {
    id: result.businessId,
    email: authUser.email,
    plan: result.plan,
    authUserId: authUser.id,
    isStaff: true,
  };
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
    assistant_name: fields.assistantName,
    tone: fields.tone,
    greeting: fields.greeting,
    escalation_keywords: fields.escalationKeywords,
    hours_json: fields.hoursJson,
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
          <button type="button" className="field-eye" onClick={() => setShow((s) => !s)}>
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
  if (typeof window === "undefined") return { plan: "14-day trial", mode: "trial", billingPeriod: "monthly", currency: "USD" };
  try {
    const saved = window.localStorage.getItem("nightline-plan-selection");
    if (saved) return { billingPeriod: "monthly", currency: "USD", ...JSON.parse(saved) };
    const legacy = window.localStorage.getItem("nightline-trial-plan");
    return legacy ? { plan: legacy, mode: legacy === "14-day trial" ? "trial" : "paid", billingPeriod: "monthly", currency: "USD" } : { plan: "14-day trial", mode: "trial", billingPeriod: "monthly", currency: "USD" };
  } catch {
    return { plan: "14-day trial", mode: "trial", billingPeriod: "monthly", currency: "USD" };
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