// Only Paystack's signed charge.success webhook can invoke settlement.
// A provider reference is immutable and must never re-activate a subscription
// after it has already been invoiced, refunded or otherwise finalized.
export function validatePaymentReplay(prior, payment) {
  const { reference, provider, plan, businessId, billingPeriod, currency, amount } = payment;
  if (typeof reference !== "string" || !/^[a-zA-Z0-9._-]{1,120}$/.test(reference)) {
    throw new Error("Invalid payment reference");
  }
  if (!prior) return "new";
  if (prior.business_id !== businessId || prior.plan !== plan ||
      prior.billing_period !== billingPeriod || Number(prior.amount) !== amount ||
      prior.currency !== String(currency || "").toUpperCase() ||
      (prior.provider && prior.provider !== provider)) {
    throw new Error("Conflicting payment reference");
  }
  if (prior.status === "paid") return "already_settled";
  throw new Error("Previously recorded payment is not eligible for activation");
}

// A different billing term for an active plan is a legitimate upgrade.
export function isSameActiveSubscription(profile, plan, billingPeriod) {
  return profile?.payment_status === "active" &&
    profile.plan === plan && profile.billing_period === billingPeriod;
}
