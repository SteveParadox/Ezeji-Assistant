import React, { useCallback, useEffect, useRef, useState } from "react";
import NightlineLanding from "./NightlineLanding";
import { supabase } from "./supabaseClient";
import { fetchPublicProfile, fetchProfile, resolveSignedInUser, upsertProfile, getStoredPlanSelection } from "./shared";
import {
  LoginScreen, SignupScreen, CheckoutScreen, ForgotScreen, VerificationPendingScreen,
  ResetPasswordScreen, BusinessSetupScreen, AuthErrorScreen, PaymentPendingScreen,
} from "./authScreens";
import {
  completeAuthCallback, ensureBusinessProfile, getRegistrationDetails,
  readAuthCallback, hasAuthCallback, scrubAuthCallback, selectedPaidPlan, isSelectedPlanActive, RECOVERY_FLAG, readRecovery, rememberRecovery,
} from "./authLifecycle";
import { DashboardShell, DASHBOARD_PAGES } from "./dashboardPages";
import { ChatWidgetDemo } from "./chatWidget";

function getInitialViewFromUrl() {
  if (typeof window === "undefined") return "landing";
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  return viewParam === "chat" || viewParam === "customer" ? "chatDemo" : "landing";
}

function getBusinessIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("biz");
}

export default function NightlineApp() {
  const [view, setView] = useState(() => getInitialViewFromUrl());
  const [landingScrollY, setLandingScrollY] = useState(0);
  const [restoreScroll, setRestoreScroll] = useState(false);
  const [dashTab, setDashTab] = useState("overview");
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [publicChatProfile, setPublicChatProfile] = useState(null);
  const [publicChatLoading, setPublicChatLoading] = useState(false);
  const authRun = useRef(0);
  const callbackPending = useRef(hasAuthCallback(readAuthCallback()));
  const recoveryMode = useRef(
    readAuthCallback().type === "recovery" ||
    (typeof localStorage !== "undefined" && !!readRecovery())
  );
  const ActivePage = DASHBOARD_PAGES[dashTab];

  const go = (nextView, details) => {
    if (nextView === "verify") setPendingEmail(details?.email || "");
    setView(nextView);
  };

  const finishOwnerLogin = useCallback((profile) => {
    setUser(profile);
    const selection = selectedPaidPlan(getStoredPlanSelection());
    const checkoutReturned = new URLSearchParams(window.location.search).get("checkout") === "success";
    const selectedPlanActive = isSelectedPlanActive(profile, selection);
    if (selectedPlanActive) {
      window.localStorage.removeItem("nightline-plan-selection");
    }
    if (!profile.isStaff && checkoutReturned && !selectedPlanActive) {
      setView("paymentPending"); // Active on a different plan is NOT this payment.
    } else if (!profile.isStaff && selection && !selectedPlanActive) {
      setView("checkout");
    } else {
      setDashTab(profile.isStaff ? "bookings" : "overview");
      setView("dashboard");
    }
  }, []);

  const initializeSession = useCallback(async (nextSession) => {
    const run = ++authRun.current;
    if (!nextSession?.user) return;
    setSession(nextSession);
    if (recoveryMode.current) {
      const marker = readRecovery();
      if (marker?.userId === nextSession.user.id) {
        setUser(null);
        setView("resetPassword");
        return;
      }
      recoveryMode.current = false;
      localStorage.removeItem(RECOVERY_FLAG);
    }
    if (getInitialViewFromUrl() === "chatDemo") return;
    setView("authLoading");
    setAuthError("");
    try {
      let profile = await resolveSignedInUser(nextSession.user, nextSession.access_token);
      if (run !== authRun.current) return;
      if (!profile) {
        const details = getRegistrationDetails(nextSession.user);
        if (details?.business) {
          await ensureBusinessProfile(nextSession, details);
          profile = await fetchProfile(nextSession.user.id, nextSession.user.email, nextSession.user.user_metadata);
        }
      }
      if (run !== authRun.current) return;
      if (!profile || !profile.isStaff && !profile.business) {
        setUser(null);
        setView("businessSetup");
        return;
      }
      finishOwnerLogin(profile);
    } catch (error) {
      if (run !== authRun.current) return;
      setAuthError(error.message || "Account initialization failed. Please retry.");
      setView("authError");
    }
  }, [finishOwnerLogin]);

  useEffect(() => {
    if (view !== "landing" || !restoreScroll) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: landingScrollY, behavior: "auto" }));
    setRestoreScroll(false);
    return () => window.cancelAnimationFrame(frame);
  }, [view, restoreScroll, landingScrollY]);

  useEffect(() => {
    const businessId = getBusinessIdFromUrl();
    if (getInitialViewFromUrl() === "chatDemo" && businessId) {
      setPublicChatLoading(true);
      fetchPublicProfile(businessId).then((profile) => {
        setPublicChatProfile(profile);
        setPublicChatLoading(false);
      }).catch(() => setPublicChatLoading(false));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Do not await Supabase SDK operations inside this callback.
      Promise.resolve().then(() => {
        if (!mounted || callbackPending.current) return;
        if (event === "PASSWORD_RECOVERY") {
          recoveryMode.current = true;
          if (nextSession) rememberRecovery(nextSession);
          if (nextSession) initializeSession(nextSession);
          return;
        }
        if (event === "SIGNED_OUT") {
          ++authRun.current;
          recoveryMode.current = false;
          localStorage.removeItem(RECOVERY_FLAG);
          setSession(null);
          setUser(null);
          setView((current) => current === "resetPassword" ? current : "login");
          return;
        }
        if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event) && nextSession) {
          // Token refresh should not tear down an already usable dashboard.
          if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
            setSession(nextSession);
            return;
          }
          initializeSession(nextSession);
        }
      });
    });

    const callback = readAuthCallback();
    if (hasAuthCallback(callback)) {
      (async () => {
        try {
          const confirmed = await completeAuthCallback(callback);
          if (!mounted) return;
          if (callback.type === "recovery" || callback.otpType === "recovery") {
            recoveryMode.current = true;
            rememberRecovery(confirmed);
          }
          scrubAuthCallback();
          callbackPending.current = false;
          await initializeSession(confirmed);
        } catch (error) {
          if (!mounted) return;
          scrubAuthCallback();
          localStorage.removeItem(RECOVERY_FLAG);
          recoveryMode.current = false;
          callbackPending.current = false;
          setAuthError(error.message || "The verification or recovery link is invalid or expired.");
          setView("authError");
        }
      })();
    } else {
      callbackPending.current = false;
    }
    return () => {
      mounted = false;
      ++authRun.current;
      subscription.unsubscribe();
    };
  }, [initializeSession]);

  const handleLogout = async () => {
    localStorage.removeItem(RECOVERY_FLAG);
    recoveryMode.current = false;
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setDashTab("overview");
    setView("landing");
  };

  const clearCheckoutCallback = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("reference");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const checkPaymentConfirmation = async () => {
    const { data: { session: freshSession } } = await supabase.auth.getSession();
    if (!freshSession) throw new Error("Your session has expired. Sign in again.");
    const current = await fetchProfile(freshSession.user.id, freshSession.user.email, freshSession.user.user_metadata);
    const selection = selectedPaidPlan(getStoredPlanSelection());
    // Without a saved expected plan, an old active subscription is not proof
    // that the latest redirected Paystack transaction was successful.
    if (isSelectedPlanActive(current, selection)) {
      clearCheckoutCallback();
      finishOwnerLogin(current);
      return true;
    }
    return false;
  };

  const handleUpdateUser = async (nextUser) => {
    if (!nextUser?.id) return;
    await upsertProfile(nextUser.id, nextUser);
    setUser(nextUser);
  };

  return (
    <div className="nl-root">
      <style>{GLOBAL_CSS}</style>

      {view === "authLoading" && <div className="auth-screen"><p role="status">Initializing your account...</p></div>}
      {view === "authError" && <AuthErrorScreen go={go} error={authError} retry={() => supabase.auth.getSession().then(({ data }) => data.session ? initializeSession(data.session) : setView("login"))} />}
      {view === "login" && <LoginScreen go={go} />}
      {view === "signup" && <SignupScreen go={go} />}
      {view === "verify" && <VerificationPendingScreen go={go} email={pendingEmail} />}
      {view === "forgot" && <ForgotScreen go={go} />}
      {view === "resetPassword" && <ResetPasswordScreen go={go} />}
      {view === "businessSetup" && <BusinessSetupScreen go={go} session={session} onReady={finishOwnerLogin} />}
      {view === "paymentPending" && <PaymentPendingScreen onCheck={checkPaymentConfirmation}
        onDashboard={() => { clearCheckoutCallback(); setDashTab("billing"); setView("dashboard"); }} />}
      {view === "landing" && (
        <NightlineLanding
          user={user}
          onSignIn={() => go("login")}
          onStartTrial={(selection) => {
            setLandingScrollY(window.scrollY);
            setRestoreScroll(true);
            if (selection) window.localStorage.setItem("nightline-plan-selection", JSON.stringify(selection));
            go(user ? (selection?.mode === "paid" ? "checkout" : "dashboard") : "signup");
          }}
        />
      )}
      {view === "checkout" && <CheckoutScreen go={go} user={user} />}
      {view === "chatDemo" && (
        publicChatLoading ? (
          <div className="widget-demo-stage"><p className="widget-demo-caption">Loading assistant...</p></div>
        ) : <ChatWidgetDemo user={publicChatProfile || user} />
      )}
      {view === "dashboard" && user && (
        <DashboardShell go={(nextView) => (nextView === "login" ? handleLogout() : go(nextView))} active={dashTab} setActive={setDashTab} isStaff={user.isStaff}>
          <ActivePage user={user} onUpdateUser={handleUpdateUser} />
        </DashboardShell>
      )}
    </div>
  );
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.nl-root {
  --ink: #12131F;
  --ink-soft: #191B29;
  --ink-card: #1D1F30;
  --ink-border: #2B2D40;
  --paper: #F5F4F8;
  --paper-muted: #A6A5BA;
  --paper-faint: #6E6D85;
  --amber: #FFA53C;
  --amber-bg: rgba(255,165,60,0.10);
  --amber-text-on: #241505;
  --green: #6FCF97;
  --green-bg: rgba(111,207,151,0.12);
  --red: #FF8A80;
  --red-bg: rgba(255,138,128,0.12);

  background: var(--ink);
  min-height: 100vh;
  width: 100%;
  font-family: 'Inter', sans-serif;
  color: var(--paper);
  position: relative;
}
.nl-root * { box-sizing: border-box; max-width: 100%; }
.display { font-family: 'Instrument Serif', serif; font-weight: 400; }
.mono { font-family: 'IBM Plex Mono', monospace; }
.brand { display: flex; align-items: center; gap: 8px; }
.brand-name { font-weight: 400; font-family: 'Instrument Serif', serif; }
.dot-static { width: 8px; height: 8px; border-radius: 999px; background: var(--amber); display: inline-block; }

.btn { font-size: 14px; font-weight: 500; padding: 10px 18px; border-radius: 10px; border: none; cursor: pointer; transition: transform 0.15s ease; font-family: 'Inter', sans-serif; }
.btn:hover { transform: scale(1.02); }
.btn--amber { background: var(--amber); color: var(--amber-text-on); }
.btn--outline { background: transparent; color: var(--paper); border: 1px solid var(--ink-border); }
.btn--lg { padding: 13px 20px; }
.btn--full { width: 100%; }
.link-btn { background: none; border: none; color: var(--amber); font-size: 13px; cursor: pointer; padding: 0; }
.link-btn--right { align-self: flex-end; margin-top: -8px; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field-label { font-size: 13px; color: var(--paper-muted); }
.field-input-wrap { position: relative; display: flex; align-items: center; }
.field-input {
  width: 100%; background: var(--ink-soft); border: 1px solid var(--ink-border);
  border-radius: 10px; padding: 11px 14px; color: var(--paper); font-size: 14px;
  font-family: 'Inter', sans-serif;
}
.field-input-wrap .field-input { padding-left: 40px; }
.field-icon { width: 16px; height: 16px; color: var(--paper-faint); position: absolute; left: 14px; }
.field-eye { position: absolute; right: 12px; background: none; border: none; cursor: pointer; display: flex; }
.field-eye .field-icon { position: static; }
.field-select { appearance: none; }
.field-textarea { resize: vertical; font-family: 'Inter', sans-serif; }

.auth-screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; }
.auth-card { width: 100%; max-width: 380px; background: var(--ink-card); border: 1px solid var(--ink-border); border-radius: 20px; padding: 32px; display: flex; flex-direction: column; gap: 4px; }
.auth-title { font-size: 26px; margin: 20px 0 4px; font-family: 'Instrument Serif', serif; }
.auth-sub { font-size: 14px; color: var(--paper-muted); margin: 0 0 20px; }
.auth-form { display: flex; flex-direction: column; }
.auth-footer { margin-top: 20px; font-size: 13px; color: var(--paper-muted); }
.auth-error { margin: -4px 0 10px; font-size: 13px; color: var(--red); }
.reset-sent { display: flex; align-items: center; gap: 10px; background: var(--green-bg); border-radius: 10px; padding: 14px; font-size: 14px; }
.reset-sent-icon { width: 20px; height: 20px; color: var(--green); flex-shrink: 0; }

.dash-shell { display: flex; min-height: 100vh; }
.dash-sidebar { width: 240px; flex-shrink: 0; background: var(--ink-soft); border-right: 1px solid var(--ink-border); display: flex; flex-direction: column; padding: 20px 14px; }
.dash-sidebar-top { padding: 0 8px 20px; }
.dash-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.dash-nav-item { display: flex; align-items: center; gap: 10px; background: none; border: none; color: var(--paper-muted); font-size: 13.5px; padding: 10px 10px; border-radius: 8px; cursor: pointer; text-align: left; width: 100%; }
.dash-nav-item:hover { background: var(--ink-card); color: var(--paper); }
.dash-nav-item--active { background: var(--amber-bg); color: var(--amber); }
.dash-nav-icon { width: 16px; height: 16px; flex-shrink: 0; }
.dash-logout { margin-top: 12px; border-top: 1px solid var(--ink-border); padding-top: 16px; }
.dash-main { flex: 1; padding: 32px 40px; max-width: 100%; overflow-x: hidden; }

.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 16px; }
.page-title { font-size: 26px; margin: 0; font-family: 'Instrument Serif', serif; }
.page-sub { font-size: 14px; color: var(--paper-muted); margin: 4px 0 0; }

.ai-toggle-pill { display: flex; align-items: center; gap: 8px; background: var(--ink-card); border: 1px solid var(--ink-border); color: var(--paper-muted); font-size: 13px; padding: 9px 16px; border-radius: 999px; cursor: pointer; }
.ai-toggle-pill--on { background: var(--green-bg); border-color: var(--green); color: var(--green); }
.ai-toggle-icon { width: 14px; height: 14px; }

.share-link-row { display: flex; gap: 10px; flex-wrap: wrap; }
.share-link-input { flex: 1; min-width: 220px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 28px; }
.stat-card { background: var(--ink-card); border: 1px solid var(--ink-border); border-radius: 16px; padding: 18px 20px; }
.stat-label { font-size: 12.5px; color: var(--paper-faint); margin: 0 0 8px; }
.stat-value { font-size: 28px; margin: 0; font-family: 'Instrument Serif', serif; }
.stat-sub { font-size: 12px; color: var(--paper-muted); margin: 6px 0 0; }

.panel { background: var(--ink-card); border: 1px solid var(--ink-border); border-radius: 16px; padding: 22px; margin-bottom: 20px; }
.panel-title { font-size: 15px; font-weight: 500; margin: 0 0 16px; }
.panel-help { font-size: 13px; color: var(--paper-muted); margin: -8px 0 14px; }
.form-panel { display: flex; flex-direction: column; max-width: 460px; }
.save-status { margin: -6px 0 10px; font-size: 13px; color: var(--green); }
.billing-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.billing-form { display: flex; flex-direction: column; max-width: 480px; }
.billing-inline-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) { .billing-inline-fields { grid-template-columns: 1fr; } }

.table { width: 100%; border-collapse: collapse; font-size: 13.5px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.table th { text-align: left; color: var(--paper-faint); font-weight: 500; font-size: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--ink-border); }
.table td { padding: 12px 0; border-bottom: 1px solid var(--ink-border); color: var(--paper); }
.table tr:last-child td { border-bottom: none; }
.table-time { color: var(--paper-faint); }

.badge { font-size: 11.5px; padding: 3px 10px; border-radius: 999px; }
.badge--green { background: var(--green-bg); color: var(--green); }
.badge--amber { background: var(--amber-bg); color: var(--amber); }

.faq-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid var(--ink-border); gap: 12px; }
.faq-q { font-size: 14px; font-weight: 500; margin: 0 0 4px; }
.faq-a { font-size: 13px; color: var(--paper-muted); margin: 0; }
.row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.icon-btn { background: none; border: none; color: var(--paper-faint); cursor: pointer; padding: 6px; border-radius: 8px; display: flex; }
.icon-btn:hover { background: var(--ink-soft); color: var(--paper); }
.icon-btn-icon { width: 15px; height: 15px; }
.faq-add { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.faq-add .field-input { flex: 1; min-width: 160px; }

.hours-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--ink-border); }
.hours-row:last-child { border-bottom: none; }
.hours-day { font-size: 14px; width: 100px; }
.hours-time { font-size: 13px; color: var(--paper-muted); }
.hours-closed { font-size: 13px; color: var(--paper-faint); }

.convo-layout { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
.convo-list { display: flex; flex-direction: column; gap: 8px; }
.convo-item { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; background: var(--ink-card); border: 1px solid var(--ink-border); border-radius: 12px; padding: 14px; cursor: pointer; text-align: left; }
.convo-item--active { border-color: var(--amber); }
.convo-name { font-size: 13.5px; font-weight: 500; margin: 0 0 4px; }
.convo-preview { font-size: 12.5px; color: var(--paper-faint); margin: 0; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.convo-thread { display: flex; flex-direction: column; gap: 10px; }

.chat-bubble { max-width: 75%; border-radius: 16px; padding: 10px 14px; font-size: 13.5px; line-height: 1.5; }
.chat-bubble--customer { align-self: flex-start; background: var(--ink-soft); border: 1px solid var(--ink-border); border-bottom-left-radius: 4px; }
.chat-bubble--ai { align-self: flex-end; background: var(--amber); color: var(--amber-text-on); border-bottom-right-radius: 4px; }
.chat-bubble--offline { background: var(--amber); color: var(--amber-text-on); }

.widget-connection-warning {
  display: flex; align-items: center; gap: 8px;
  background: var(--red-bg); color: var(--red);
  font-size: 12px; padding: 10px 12px; border-radius: 10px;
}
.widget-disappearing-note {
  font-size: 11.5px; color: var(--paper-faint); text-align: center;
  padding: 4px 8px;
}
.chat-bubble--typing { display: flex; gap: 4px; padding: 12px 16px; }
.typing-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--amber-text-on);
  animation: typingBounce 1s ease-in-out infinite;
}
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-3px); opacity: 1; }
}
.icon-btn--active { background: var(--amber-bg); color: var(--amber); }

.bar-chart { display: flex; align-items: flex-end; gap: 14px; height: 140px; }
.bar-col { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; height: 100%; justify-content: flex-end; }
.bar { width: 100%; background: var(--amber); border-radius: 6px 6px 0 0; }
.bar-label { font-size: 11px; color: var(--paper-faint); }
.top-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; font-size: 13.5px; }
.top-list li { display: flex; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--ink-border); }
.top-list li:last-child { border-bottom: none; padding-bottom: 0; }

.current-plan { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
.current-plan-name { font-size: 20px; font-family: 'Instrument Serif', serif; display: flex; align-items: center; gap: 10px; margin: 6px 0 0; }
.payment-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }

.widget-demo-stage { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 20px; }
.widget-booking-note { border-radius: 10px; padding: 10px 12px; background: rgba(111,207,151,0.14); color: var(--green); font-size: 12px; line-height: 1.5; }
.widget-demo-caption { font-size: 13px; color: var(--paper-muted); }
.widget-panel { width: 340px; max-width: 100%; background: var(--ink-card); border: 1px solid var(--ink-border); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
.widget-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--ink-border); gap: 8px; flex-wrap: wrap; }
@media (max-width: 380px) {
  .widget-status-label { display: none; }
  .widget-header-right { gap: 2px; }
  .icon-btn { padding: 4px; }
}
.widget-header-left { display: flex; align-items: center; gap: 10px; }
.widget-header-avatar { width: 34px; height: 34px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; background: var(--amber-bg); color: var(--amber); flex-shrink: 0; }
.widget-header-name { font-size: 14px; font-weight: 500; margin: 0; color: var(--paper); }
.widget-header-time { font-size: 11px; color: var(--paper-faint); margin: 2px 0 0; }
.widget-header-right { display: flex; align-items: center; gap: 10px; }
.widget-status { display: flex; align-items: center; gap: 6px; }
.widget-status-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--green); box-shadow: 0 0 0 0 rgba(111,207,151,0.5); animation: widgetStatusPulse 2s ease-in-out infinite; }
.widget-status-label { font-size: 11px; color: var(--green); }
@keyframes widgetStatusPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(111,207,151,0.5); }
  50% { box-shadow: 0 0 0 4px rgba(111,207,151,0); }
}
.widget-body { display: flex; flex-direction: column; gap: 10px; padding: 16px; min-height: 220px; }
.widget-quick-replies { display: flex; flex-direction: column; gap: 6px; padding: 0 16px 12px; }
.quick-reply { background: var(--ink-soft); border: 1px solid var(--ink-border); color: var(--paper); font-size: 12.5px; padding: 8px 12px; border-radius: 999px; cursor: pointer; text-align: left; }
.quick-reply:hover { border-color: var(--amber); }
.widget-input-row { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--ink-border); }
.widget-input { flex: 1; padding: 9px 12px; }
.widget-voice { width: 38px; flex: 0 0 38px; border: 1px solid var(--ink-border); border-radius: 10px; background: var(--ink-soft); color: var(--paper-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.widget-voice:hover, .widget-voice--active { border-color: var(--amber); color: var(--amber); }
.widget-voice:disabled { cursor: not-allowed; opacity: 0.45; }
.widget-send { background: var(--amber); border: none; border-radius: 10px; padding: 0 12px; cursor: pointer; color: var(--amber-text-on); display: flex; align-items: center; }
.widget-bubble { width: 56px; height: 56px; border-radius: 999px; background: var(--amber); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--amber-text-on); box-shadow: 0 10px 30px rgba(255,165,60,0.35); }

@media (max-width: 900px) {
  .dash-shell {
    flex-direction: column;
  }
  .dash-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--ink-border);
    padding: 16px 14px 12px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .dash-nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }
  .dash-nav-item {
    width: auto;
    flex: 1 1 calc(50% - 6px);
    min-width: 140px;
    justify-content: flex-start;
  }
  .dash-main {
    padding: 24px 20px 32px;
  }
  .convo-layout { grid-template-columns: 1fr; }
}
`;