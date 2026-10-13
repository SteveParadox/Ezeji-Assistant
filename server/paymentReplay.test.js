import test from "node:test";
import assert from "node:assert/strict";
import { validatePaymentReplay } from "./paymentReplay.js";

const payment = {
  reference: "pay_abc123", provider: "paystack", businessId: "owner-1",
  plan: "Professional", billingPeriod: "monthly", currency: "NGN",
  amount: 3500000,
};
const invoice = {
  business_id: "owner-1", provider: "paystack",
  plan: "Professional", billing_period: "monthly", currency: "NGN",
  amount: 3500000, status: "paid",
};

test("fresh signed success event can proceed to settlement", () => {
  assert.equal(validatePaymentReplay(null, payment), "new");
});

test("identical settled reference is idempotent", () => {
  assert.equal(validatePaymentReplay(invoice, payment), "already_settled");
});

test("a previous refund cannot be reactivated from replay", () => {
  assert.throws(() => validatePaymentReplay({ ...invoice, status: "refunded" }, payment),
    /not eligible/);
});

test("cross-tenant reference reuse cannot change another company's plan", () => {
  assert.throws(() => validatePaymentReplay(invoice, { ...payment, businessId: "other-owner" }),
    /Conflicting/);
});

test("different amount, plan, period, or currency is a conflict", () => {
  for (const changed of [
    { amount: 1 }, { plan: "Business" }, { billingPeriod: "yearly" }, { currency: "USD" },
  ]) assert.throws(() => validatePaymentReplay(invoice, { ...payment, ...changed }), /Conflicting/);
});

test("malformed references are always rejected", () => {
  for (const reference of ["", "a/../../b", "hello world"]) {
    assert.throws(() => validatePaymentReplay(null, { ...payment, reference }), /Invalid/);
  }
});
