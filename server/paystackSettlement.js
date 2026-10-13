import crypto from "node:crypto";

export const PAYSTACK_REFERENCE_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export function newPaystackReference() {
  return "ezeji_" + crypto.randomUUID().replaceAll("-", "");
}

// Only server-to-Paystack transaction/verify data is accepted. Metadata from
// the callback or signed webhook does not dictate the plan or business.
export function parseVerifiedPaystackTransaction(payload, requestedReference) {
  const data = payload?.data;
  if (!PAYSTACK_REFERENCE_PATTERN.test(requestedReference || "") ||
      payload?.status !== true || data?.status !== "success" ||
      data?.reference !== requestedReference ||
      !Number.isSafeInteger(data?.amount) || data.amount <= 0 ||
      typeof data?.currency !== "string" ||
      typeof data?.customer?.email !== "string" ||
      !data.customer.email.trim() ||
      (typeof data?.id !== "number" && typeof data?.id !== "string") ||
      !String(data.id).trim()) {
    const error = new Error("Payment verification did not match a successful provider transaction");
    error.status = 422;
    throw error;
  }
  return {
    p_reference: requestedReference,
    p_amount: data.amount,
    p_currency: data.currency.toUpperCase(),
    p_customer_email: data.customer.email.trim().toLowerCase(),
    p_provider_transaction_id: String(data.id),
  };
}

export function paymentMatchesAttempt(payment, attempt) {
  return !!attempt &&
    attempt.provider === "paystack" &&
    attempt.provider_reference === payment.p_reference &&
    Number(attempt.expected_amount) === payment.p_amount &&
    attempt.currency === payment.p_currency &&
    attempt.customer_email?.trim().toLowerCase() === payment.p_customer_email &&
    (!attempt.provider_transaction_id ||
      attempt.provider_transaction_id === payment.p_provider_transaction_id);
}

export function isTrustedPaystackCheckoutUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "checkout.paystack.com" ||
       parsed.hostname === "paystack.com" || parsed.hostname.endsWith(".paystack.com"));
  } catch {
    return false;
  }
}
