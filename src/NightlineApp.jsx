import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import NightlineLanding from "./NightlineLanding";
import "./designTokens.css";
import "./appStyles.css";
import "./workspace.css";
import { supabase } from "./supabaseClient";
import { fetchPublicProfile, fetchProfile, resolveSignedInUser, upsertProfile, getStoredPlanSelection, API_BASE_URL } from "./shared";
import {
  LoginScreen, SignupScreen, CheckoutScreen, ForgotScreen, VerificationPendingScreen,
  ResetPasswordScreen, BusinessSetupScreen, AuthErrorScreen, PaymentPendingScreen,
} from "./authScreens";
import {
  completeAuthCallback, ensureBusinessProfile, getRegistrationDetails,
  readAuthCallback, hasAuthCallback, scrubAuthCallback, selectedPaidPlan, isSelectedPlanActive, RECOVERY_FLAG, readRecovery, rememberRecovery,
} from "./authLifecycle";
import { DASHBOARD_PAGES } from "./dashboardPages";
import { DashboardShell } from "./DashboardShell";
import { resolveDashboardTab, dashboardUrlForTab } from "./dashboardNavigation";
import { ChatWidgetDemo } from "./chatWidget";
import { isUsablePublicBusiness } from "./chatRequest";
import { requiresCoreBusinessSetup } from "./onboardingState";
import { paymentVerificationIsSettled } from "./paymentConfirmation";

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
  const [dashTab, setDashTab] = useState(() => resolveDashboardTab(typeof window === "undefined" ? "" : window.location.search));
  const [user, setUser] = useState(null);
  const [staffMembershipOptions, setStaffMembershipOptions] = useState([]);
  const [session, setSession] = useState(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [publicChatProfile, setPublicChatProfile] = useState(null);
  const [publicChatLoading, setPublicChatLoading] = useState(false);
  const [publicChatError, setPublicChatError] = useState("");
  const authRun = useRef(0);
  const callbackPending = useRef(hasAuthCallback(readAuthCallback()));
  const recoveryMode = useRef(
    readAuthCallback().type === "recovery" ||
    (typeof localStorage !== "undefined" && !!readRecovery())
  );
  const ActivePage = DASHBOARD_PAGES[dashTab];

  const go = (nextView, details) => {
    if (nextView === "verify") setPendingEmail(details?.email || "");
    if (nextView === "landing" && window.location.search.includes("view=dashboard")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      url.searchParams.delete("tab");
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
    }
    setView(nextView);
  };

  const finishOwnerLogin = useCallback((profile) => {
    setUser(profile);
    const selection = selectedPaidPlan(getStoredPlanSelection());
    const checkoutReturned = new URLSearchParams(window.location.search).get("checkout") === "success";
    const selectedPlanActive = isSelectedPlanActive(profile, selection);

    // An existing active plan is not proof that a NEW Paystack checkout
    // succeeded. Never clear the provider reference before verification.
    if (!profile.isStaff && checkoutReturned) {
      setView("paymentPending");
      return;
    }
    if (selectedPlanActive) window.localStorage.removeItem("nightline-plan-selection");

    // An outstanding paid choice resumes in the data-backed setup overview.
    // Only that page knows whether services/FAQs actually exist; a handful
    // of profile fields cannot prove business onboarding is complete.
    if (!profile.isStaff && selection && !selectedPlanActive) {
      setDashTab("gettingStarted");
      setView("dashboard");
      return;
    }
    const fallback = profile.isStaff ? "bookings" : requiresCoreBusinessSetup(profile) ? "gettingStarted" : "overview";
    setDashTab(resolveDashboardTab(window.location.search, !!profile.isStaff, fallback));
    setView("dashboard");
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
      const inviteToken = new URLSearchParams(window.location.search).get("staff_invite");
      if (inviteToken && /^[a-f0-9]{64}$/.test(inviteToken)) {
        const accepted = await fetch(`${API_BASE_URL}/staff/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${nextSession.access_token}` },
          body: JSON.stringify({ token: inviteToken }),
        });
        const result = await accepted.json().catch(() => ({}));
        if (!accepted.ok) throw new Error(result.error || "Unable to accept staff invitation.");
        const clean = new URL(window.location.href);
        clean.searchParams.delete("staff_invite");
        window.history.replaceState(null, "", clean.pathname + clean.search);
      }
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
      if (Array.isArray(error.memberships) && error.memberships.length) {
        setStaffMembershipOptions(error.memberships);
        setView("staffSelection");
        return;
      }
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
    if (getInitialViewFromUrl() !== "chatDemo") return;
    const businessId = getBusinessIdFromUrl();
    if (!businessId) {
      setPublicChatError("This customer chat link is missing its business identifier.");
      return;
    }
    let cancelled = false;
    setPublicChatError("");
    setPublicChatLoading(true);
    fetchPublicProfile(businessId).then((profile) => {
      if (cancelled) return;
      if (!isUsablePublicBusiness(profile, businessId)) {
        setPublicChatError("This business chat link is invalid or unavailable.");
        setPublicChatProfile(null);
      } else {
        setPublicChatProfile(profile);
      }
    }).catch(() => {
      if (!cancelled) {
        setPublicChatProfile(null);
        setPublicChatError("Business chat is temporarily unavailable. Please try again later.");
      }
    }).finally(() => {
      if (!cancelled) setPublicChatLoading(false);
    });
    return () => { cancelled = true; };
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
          // Expiring/signing out of an unrelated owner session must not eject
          // a public customer from the shared business chat link.
          setView((current) => getInitialViewFromUrl() === "chatDemo" ? "chatDemo" :
            current === "resetPassword" ? current : "login");
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
    sessionStorage.removeItem("ezeji-staff-business");
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
    window.localStorage.removeItem("ezeji-last-checkout-ref");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const checkPaymentConfirmation = async () => {
    const { data: { session: freshSession } } = await supabase.auth.getSession();
    if (!freshSession) throw new Error("Your session has expired. Sign in again.");
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || window.localStorage.getItem("ezeji-last-checkout-ref");
    if (!reference || !/^[A-Za-z0-9._-]{1,120}$/.test(reference)) {
      throw new Error("The checkout reference is missing or invalid. Contact support before attempting another payment.");
    }
    const response = await fetch(`${API_BASE_URL}/verify-paystack/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${freshSession.access_token}` },
    });
    const verification = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(verification.error || "Payment verification unavailable.");
    if (verification.requiresReview) throw new Error("Your payment needs manual reconciliation; no new access has been granted.");
    if (verification.status === "failed") throw new Error("This Paystack payment did not succeed.");
    if (!paymentVerificationIsSettled(verification)) return false;
    const current = await fetchProfile(freshSession.user.id, freshSession.user.email, freshSession.user.user_metadata);
    const selection = selectedPaidPlan(getStoredPlanSelection());
    // Without a saved expected plan, an old active subscription is not proof
    // that the latest redirected Paystack transaction was successful.
    // A lost local plan selection must not strand a provider-verified,
    // atomically settled payment in an endless pending screen.
    const entitlementReady = selection
      ? isSelectedPlanActive(current, selection)
      : current?.paymentStatus === "active";
    if (entitlementReady) {
      clearCheckoutCallback();
      finishOwnerLogin(current);
      return true;
    }
    throw new Error("Payment is confirmed, but subscription activation is still pending. Retry verification before paying again.");
  };

  const navigateDashboard = (tab) => {
    if (!user) return;
    const nextUrl = dashboardUrlForTab(window.location.href, tab, !!user.isStaff);
    if (nextUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(null, "", nextUrl);
    }
    setDashTab(tab);
  };

  useEffect(() => {
    const handleHistory = () => {
      const urlView = new URLSearchParams(window.location.search).get("view");
      if (urlView === "dashboard") {
        if (!user) {
          setView("login");
          return;
        }
        setDashTab(resolveDashboardTab(window.location.search, !!user.isStaff,
          user.isStaff ? "bookings" : "overview"));
        setView("dashboard");
      } else if (urlView === "chat" || urlView === "customer") {
        // A public chat link needs a fresh business lookup. Never reuse
        // the cached profile of another customer or signed-in owner.
        window.location.reload();
      } else if (view === "dashboard" || view === "landing") {
        setView("landing");
      }
    };
    window.addEventListener("popstate", handleHistory);
    return () => window.removeEventListener("popstate", handleHistory);
  }, [view, user]);

  const handleUpdateUser = async (nextUser) => {
    if (!nextUser?.id) return;
    await upsertProfile(nextUser.id, nextUser);
    setUser(nextUser);
  };

  return (
    <div className="nl-root">

      {view === "authLoading" && <div className="auth-screen"><p role="status">Initializing your account...</p></div>}
      {view === "authError" && <AuthErrorScreen go={go} error={authError} retry={() => supabase.auth.getSession().then(({ data }) => data.session ? initializeSession(data.session) : setView("login"))} />}
      {view === "staffSelection" && (
        <div className="auth-screen"><div className="auth-card">
          <h2>Choose a business</h2>
          <p>Select the business whose staff dashboard you want to open.</p>
          {staffMembershipOptions.map((item) => (
            <button key={item.businessId} className="btn btn--outline btn--full"
              onClick={() => {
                sessionStorage.setItem("ezeji-staff-business", item.businessId);
                if (session) initializeSession(session);
              }}>
              {item.business} ({item.role})
            </button>
          ))}
        </div></div>
      )}
      {view === "login" && <LoginScreen go={go} />}
      {view === "signup" && <SignupScreen go={go} />}
      {view === "verify" && <VerificationPendingScreen go={go} email={pendingEmail} />}
      {view === "forgot" && <ForgotScreen go={go} />}
      {view === "resetPassword" && <ResetPasswordScreen go={go} />}
      {view === "businessSetup" && <BusinessSetupScreen go={go} session={session} onReady={finishOwnerLogin} />}
      {view === "paymentPending" && <PaymentPendingScreen onCheck={checkPaymentConfirmation}
        onDashboard={() => { setDashTab("billing"); setView("dashboard"); }} />}
      {view === "landing" && (
        <NightlineLanding
          user={user}
          onSignIn={() => go("login")}
          onStartTrial={(selection) => {
            setLandingScrollY(window.scrollY);
            setRestoreScroll(true);
            if (selection) window.localStorage.setItem("nightline-plan-selection", JSON.stringify(selection));
            if (user && selection?.mode === "paid") {
              setDashTab("gettingStarted");
              go("dashboard");
            } else {
              go(user ? "dashboard" : "signup");
            }
          }}
        />
      )}
      {view === "checkout" && <CheckoutScreen go={go} user={user} />}
      {view === "chatDemo" && (
        publicChatLoading ? (
          <div className="widget-demo-stage"><p className="widget-demo-caption" role="status">Loading business chat...</p></div>
        ) : publicChatError || !publicChatProfile ? (
          <div className="widget-demo-stage">
            <div className="panel" role="alert">
              <h1 className="panel-title">Customer chat unavailable</h1>
              <p>{publicChatError || "This business is not available."}</p>
            </div>
          </div>
        ) : <ChatWidgetDemo key={publicChatProfile.id} user={publicChatProfile} />
      )}
      {view === "dashboard" && user && (
        <DashboardShell go={(nextView) => (nextView === "login" ? handleLogout() : go(nextView))} active={dashTab} setActive={navigateDashboard} isStaff={user.isStaff} user={user}>
          <Suspense fallback={<div className="panel" role="status">Loading workspace...</div>}>
          <ActivePage key={`${user.id}:${user.isStaff ? "staff" : "owner"}:${dashTab}`} user={user} onUpdateUser={handleUpdateUser} onNavigate={navigateDashboard} onCheckout={() => go("checkout")} />
          </Suspense>
        </DashboardShell>
      )}
    </div>
  );
}
