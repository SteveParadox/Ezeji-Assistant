import test from "node:test";
import assert from "node:assert/strict";
import {
  selectedPaidPlan, signupDetails, getRegistrationDetails, readAuthCallback,
  hasAuthCallback, destinationForBusiness,
} from "./authState.js";

test("paid-plan choices must come from the server-supported plan allowlist", () => {
  assert.equal(selectedPaidPlan({ plan: "14-day trial" }), null);
  assert.equal(selectedPaidPlan({ plan: "admin" }), null);
  assert.deepEqual(selectedPaidPlan({ plan: "Professional", billingPeriod: "yearly", price: 1 }),
    { plan: "Professional", billingPeriod: "yearly" });
});

test("registration metadata contains only business display values, no secrets or entitlements", () => {
  const data = signupDetails({ business: "  Salon ", password: "SECRET", paymentStatus: "active", plan: "Business", name: " A " });
  assert.equal(data.business, "Salon");
  assert.equal(data.name, "A");
  assert.equal(JSON.stringify(data).includes("SECRET"), false);
  assert.equal("plan" in data, false);
  assert.equal("paymentStatus" in data, false);
});

test("missing registration details require a recovery form, not a synthetic business", () => {
  assert.equal(getRegistrationDetails({ user_metadata: {} }), null);
  assert.equal(destinationForBusiness(null, { plan: "Business" }), "businessSetup");
});

test("verified owners resume paid checkout without fake subscription activation", () => {
  const sel = { plan: "Starter", billingPeriod: "monthly" };
  assert.equal(destinationForBusiness({ business: "Cafe", plan: "14-day trial", paymentStatus: "trial" }, sel), "checkout");
  assert.equal(destinationForBusiness({ business: "Cafe", plan: "Starter", paymentStatus: "active" }, sel), "dashboard");
  assert.equal(destinationForBusiness({ isStaff: true }, sel), "dashboard");
});

test("PKCE confirmation link and recovery callbacks can be distinguished", () => {
  const confirm = readAuthCallback({ search: "?auth_callback=confirm&code=abc", hash: "" });
  assert.equal(confirm.code, "abc");
  assert.equal(confirm.type, "confirm");
  assert.equal(hasAuthCallback(confirm), true);
  const recovery = readAuthCallback({ search: "?auth_callback=recovery", hash: "#access_token=a&refresh_token=b&type=recovery" });
  assert.equal(recovery.type, "recovery");
  assert.equal(recovery.accessToken, "a");
});

test("expired recovery links convey errors rather than authorizing a normal session", () => {
  const invalid = readAuthCallback({ search: "?auth_callback=recovery&error=access_denied", hash: "" });
  assert.equal(invalid.error, "access_denied");
  assert.equal(hasAuthCallback(invalid), true);
});
