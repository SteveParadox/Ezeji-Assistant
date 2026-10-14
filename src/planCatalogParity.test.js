import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_PRICE_NGN_KOBO } from "../shared/planCatalog.js";
import { getPlanDetails } from "./billingLogic.js";

test("monthly/yearly display amounts exactly match backend Paystack kobo catalog", () => {
  for (const [plan, price] of Object.entries(PLAN_PRICE_NGN_KOBO)) {
    assert.equal(getPlanDetails(plan, "NGN", "monthly").amountDue * 100, price.monthly);
    assert.equal(getPlanDetails(plan, "NGN", "yearly").amountDue * 100, price.yearly);
    assert.equal(price.yearly, price.monthly * 10);
  }
});
test("trial never initiates a monetary charge", () => {
  assert.equal(getPlanDetails("14-day trial", "NGN", "monthly").amountDue, 0);
});
