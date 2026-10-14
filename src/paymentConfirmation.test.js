import test from "node:test";
import assert from "node:assert/strict";
import { paymentVerificationIsSettled } from "./paymentConfirmation.js";

test("only a verified paid receipt may close the pending checkout flow", () => {
  assert.equal(paymentVerificationIsSettled({ verified: true, status: "paid" }), true);
  assert.equal(paymentVerificationIsSettled({ verified: false, status: "pending" }), false);
  assert.equal(paymentVerificationIsSettled({ verified: false, status: "review_required", requiresReview: true }), false);
  assert.equal(paymentVerificationIsSettled({ verified: false, status: "failed" }), false);
  assert.equal(paymentVerificationIsSettled({ status: "paid" }), false);
  assert.equal(paymentVerificationIsSettled(null), false);
});
