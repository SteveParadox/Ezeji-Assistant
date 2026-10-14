import test from "node:test";
import assert from "node:assert/strict";
import { requiresCoreBusinessSetup } from "./onboardingState.js";

const complete = { isStaff: false, business: "Cafe", description: "We serve coffee",
  address: "1 Main St", cityStateZip: "Lagos", hoursJson: [{ day: "Monday", open: "09:00", close: "17:00", closed: false }] };

test("new paid registrations complete business setup before the checkout screen", () => {
  assert.equal(requiresCoreBusinessSetup({ ...complete, description: "", hoursJson: null }), true);
  assert.equal(requiresCoreBusinessSetup(complete), false);
});
test("staff do not enter owner onboarding", () => {
  assert.equal(requiresCoreBusinessSetup({ isStaff: true }), false);
});

test("all-closed hours do not mean a business is ready for customer appointments", () => {
  assert.equal(requiresCoreBusinessSetup({
    ...complete, hoursJson: [{ day: "Monday", open: "", close: "", closed: true }],
  }), true);
});
