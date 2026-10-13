import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { getPlanDetails } from "./billingLogic";
import { Mail, Lock, CheckCircle2, Building2 } from "lucide-react";
import { Logo, TextField, AuthShell, getStoredPlanSelection, resolveSignedInUser, upsertProfile, API_BASE_URL } from "./shared";

export function LoginScreen({ go, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setIsSubmitting(false);
        return;
      }

      const profile = await resolveSignedInUser(data.user, data.session.access_token);
      onLogin(profile || { id: data.user.id, email: data.user.email });
      go("dashboard");
    } catch (loginError) {
      console.error("sign-in error:", loginError);
      setError(loginError.message || "Unable to sign in right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      footer={
        <>
          Don't have an account?{" "}
          <button className="link-btn" onClick={() => go("signup")}>Sign up</button>
        </>
      }
    >
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Log in to manage your business assistant.</p>
      <div className="auth-form">
        <TextField label="Email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        <TextField label="Password" type="password" icon={Lock} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" />
        <button className="link-btn link-btn--right" onClick={() => go("forgot")}>Forgot password?</button>
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Logging in..." : "Log in"}
        </button>
        <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </div>
    </AuthShell>
  );
}

export function SignupScreen({ go, onLogin }) {
  const [form, setForm] = useState(() => {
    const selection = getStoredPlanSelection();
    return {
      name: "",
      business: "",
      businessType: "Restaurant",
      customBusinessType: "",
      email: "",
      password: "",
      serviceName: "",
      price: "",
      hours: "",
      description: "",
      selectedPlan: selection.plan || "14-day trial",
      selectedMode: selection.mode || "trial",
      selectedBillingPeriod: selection.billingPeriod || "monthly",
      selectedCurrency: selection.currency || "USD",
    };
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (form.selectedMode === "paid") {
      go("checkout");
      return;
    }
    if (!form.email.trim() || !form.password || !form.business.trim()) {
      setError("Business name, email, and password are required.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsSubmitting(false);
      return;
    }

    if (!data.session) {
      setIsSubmitting(false);
      setError("Check your email to confirm your account before logging in.");
      return;
    }

    const profileFields = {
      name: form.name.trim() || "New user",
      business: form.business.trim() || "My business",
      businessType: form.businessType || "Restaurant",
      customBusinessType: form.businessType === "Other" ? form.customBusinessType.trim() : "",
      serviceName: form.serviceName.trim() || "Main service",
      price: form.price.trim() || "$100",
      hours: form.hours.trim() || "by appointment",
      description: form.description.trim() || "",
      trialActive: form.selectedMode !== "paid",
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      plan: form.selectedPlan || "14-day trial",
      paymentStatus: form.selectedMode === "paid" ? "active" : "trial",
      billingPeriod: form.selectedBillingPeriod || "monthly",
      currency: form.selectedCurrency || "USD",
    };

    try {
      await upsertProfile(data.user.id, profileFields);
    } catch (err) {
      setIsSubmitting(false);
      setError("Account created, but saving your business profile failed. Try again from the dashboard.");
      return;
    }

    setIsSubmitting(false);
    onLogin({ id: data.user.id, email: data.user.email, ...profileFields });
    go("dashboard");
  };

  return (
    <AuthShell
      footer={
        <>
          Already have an account?{" "}
          <button className="link-btn" onClick={() => go("login")}>Log in</button>
        </>
      }
    >
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">Start your 14-day free trial. No card required.</p>
      <div className="auth-form">
        <TextField label="Your name" value={form.name} onChange={set("name")} placeholder="Maya Reyes" />
        <TextField label="Business name" icon={Building2} value={form.business} onChange={set("business")} placeholder="Bloom & Co. Salon" />
        <label className="field">
          <span className="field-label">Business type</span>
          <select className="field-input field-select" value={form.businessType} onChange={set("businessType")}>
            {[
              "Restaurant",
              "Salon & Beauty",
              "Hotel",
              "Clinic",
              "Laundry",
              "Gym",
              "Real Estate",
              "Other",
            ].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        {form.businessType === "Other" && (
          <TextField label="Custom business type" value={form.customBusinessType} onChange={set("customBusinessType")} placeholder="Wedding planner, moving company, tutoring, etc." />
        )}
        <TextField label="Email" type="email" icon={Mail} value={form.email} onChange={set("email")} placeholder="you@business.com" />
        <TextField label="Service name" value={form.serviceName} onChange={set("serviceName")} placeholder="Services your business offers" />
        <TextField label="Price" value={form.price} onChange={set("price")} placeholder="$180" />
        <TextField label="Hours" value={form.hours} onChange={set("hours")} placeholder="Mon-Sat 9:00 AM - 6:00 PM" />
        <label className="field">
          <span className="field-label">Describe your work</span>
          <textarea className="field-input field-textarea" rows={3} value={form.description} onChange={set("description")} placeholder="Tell the assistant about your services, style, or specialties like dreadlocks, loc maintenance, twists, and consultations." />
        </label>
        <TextField label="Password" type="password" icon={Lock} value={form.password} onChange={set("password")} placeholder="********" />
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Sign Up"}
        </button>
        <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </div>
    </AuthShell>
  );
}

export function CheckoutScreen({ go, onLogin }) {
  const selection = getStoredPlanSelection();
  const [form, setForm] = useState({
    name: "",
    email: "",
    business: "",
    password: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const planName = selection.plan || "Professional";
  const billingPeriod = selection.billingPeriod || "monthly";
  const planDetails = getPlanDetails(planName, "NGN", billingPeriod);

  const handlePay = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.business.trim() || !form.password.trim()) {
      setError("Please complete your account details before paying.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      // Create the real account FIRST - this is what was missing before:
      // a checkout that collected a password but never actually signed
      // anyone up, leaving no way to log in after paying.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      if (signUpError) {
        setError(signUpError.message);
        setIsSubmitting(false);
        return;
      }
      if (!data.session) {
        setError("Check your email to confirm your account, then come back to complete payment from Billing.");
        setIsSubmitting(false);
        return;
      }

      const profileFields = {
        name: form.name.trim(),
        business: form.business.trim(),
        businessType: "Restaurant",
        serviceName: "Main service",
        price: "",
        hours: "by appointment",
        description: "",
        trialActive: false,
        trialEndsAt: new Date().toISOString(),
        plan: planName,
        paymentStatus: "pending",
        billingPeriod,
        currency: "NGN",
      };
      await upsertProfile(data.user.id, profileFields);
      onLogin({ id: data.user.id, email: data.user.email, ...profileFields });

      const response = await fetch(`${API_BASE_URL}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({
          plan: planName,
          billingPeriod,
          email: form.email.trim().toLowerCase(),
          business: form.business.trim(),
          name: form.name.trim(),
          businessId: data.user.id,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Checkout could not be created.");
      }

      window.location.href = payload.url;
    } catch (err) {
      setError(err.message || "Payment setup failed. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      footer={<button className="link-btn" onClick={() => go("landing")}>Back to landing</button>}
    >
      <h1 className="auth-title">Checkout</h1>
      <p className="auth-sub">Create your account and pay securely with Paystack for the {planName} plan.</p>
      <div className="auth-form">
        <TextField label="Your name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Maya Reyes" />
        <TextField label="Business name" value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))} placeholder="Bloom & Co." />
        <TextField label="Email" type="email" icon={Mail} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="you@business.com" />
        <TextField label="Create password" type="password" icon={Lock} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="********" />
        <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
          <p className="stat-label">Amount due</p>
          <p className="current-plan-name">{planDetails.displayPrice}/{billingPeriod === "yearly" ? "year" : "month"}</p>
          <p className="panel-help">You'll be taken to Paystack's secure page to enter your card details. Your account is created now; your plan activates automatically once Paystack confirms payment.</p>
        </div>
        <button className="btn btn--amber btn--full btn--lg" onClick={handlePay} disabled={isSubmitting}>{isSubmitting ? "Setting up..." : `Continue to Paystack`}</button>
        {error && <p className="auth-error">{error}</p>}
      </div>
    </AuthShell>
  );
}

export function ForgotScreen({ go }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: window.location.origin }
    );

    setIsSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("login")}>Back to log in</button>}>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">
        {sent ? "Check your inbox for a reset link." : "Enter your email and we'll send you a reset link."}
      </p>
      {!sent ? (
        <div className="auth-form">
          <TextField label="Email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
          <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
        </div>
      ) : (
        <div className="reset-sent">
          <CheckCircle2 className="reset-sent-icon" />
          <p>We sent a link to <strong>{email || "your email"}</strong>.</p>
        </div>
      )}
    </AuthShell>
  );
}