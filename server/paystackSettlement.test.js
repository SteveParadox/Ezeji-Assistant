import test from "node:test";
import assert from "node:assert/strict";
import {
  newPaystackReference, parseVerifiedPaystackTransaction,
  paymentMatchesAttempt, isTrustedPaystackCheckoutUrl,
} from "./paystackSettlement.js";

const reference = "ezeji_123456789";
const data = { status: true, data: { id: 808, reference, status: "success",
  amount: 3500000, currency: "NGN", customer: { email: "OWNER@example.test" },
  paid_at: "2026-10-13T12:00:00.000Z",
  metadata: { businessId: "untrusted", plan: "Business" } } };
const attempt = { provider: "paystack", provider_reference: reference,
  expected_amount: 3500000, currency: "NGN", customer_email: "owner@example.test" };

test("references are unique, URL safe, and do not contain customer details", () => {
  const a = newPaystackReference();
  const b = newPaystackReference();
  assert.notEqual(a, b);
  assert.match(a, /^ezeji_[a-f0-9]{32}$/);
});
test("Paystack verification rejects errors and mismatched references", () => {
  for (const changed of [
    { status: false }, { data: { ...data.data, status: "failed" } },
    { data: { ...data.data, reference: "wrong" } },
    { data: { ...data.data, amount: 0 } },
    { data: { ...data.data, customer: {} } },
  ]) assert.throws(() => parseVerifiedPaystackTransaction({ ...data, ...changed }, reference), /verification/);
});
test("provider response ignores arbitrary metadata and agrees with persisted attempt", () => {
  const verified = parseVerifiedPaystackTransaction(data, reference);
  assert.equal(verified.p_reference, reference);
  assert.equal(verified.p_amount, 3500000);
  assert.equal(verified.p_customer_email, "owner@example.test");
  assert.equal("plan" in verified, false);
  assert.equal("businessId" in verified, false);
  assert.equal(paymentMatchesAttempt(verified, attempt), true);
});
test("provider identity, amount, currency, email, transaction ID cannot conflict", () => {
  const verified = parseVerifiedPaystackTransaction(data, reference);
  for (const tampered of [
    { provider_reference: "other" }, { expected_amount: 1 },
    { currency: "USD" }, { customer_email: "attacker@example.test" },
    { provider_transaction_id: "999" }, { provider: "stripe" },
  ]) assert.equal(paymentMatchesAttempt(verified, { ...attempt, ...tampered }), false);
});
test("redirect cannot send a user to an attacker-controlled host", () => {
  assert.equal(isTrustedPaystackCheckoutUrl("https://checkout.paystack.com/abcd"), true);
  for (const url of ["http://checkout.paystack.com/abcd",
    "https://checkout.paystack.com.evil.example/x", "javascript:alert(1)", ""]) {
    assert.equal(isTrustedPaystackCheckoutUrl(url), false);
  }
});
