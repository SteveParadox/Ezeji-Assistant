import { parseVerifiedPaystackTransaction, paymentMatchesAttempt } from "./paystackSettlement.js";

export function reconciliationDelayMs(attempts) {
  return Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(10, Math.max(0, attempts)));
}

export async function reconcileDueCheckouts(db, {
  verify,
  now = () => new Date(),
  batchSize = 20,
  maxAttempts = 8,
} = {}) {
  if (typeof verify !== "function") throw new Error("Trusted Paystack verifier required");
  const clock = now();
  const cutoff = new Date(clock.getTime() - 120_000).toISOString();
  const { data: rows, error } = await db.from("checkout_attempts")
    .select("id,business_id,provider,provider_reference,provider_transaction_id,expected_amount,currency,customer_email,status,expires_at,reconciliation_attempts")
    .in("status", ["pending", "initialized", "initialization_failed"])
    .lt("created_at", cutoff)
    .or(`next_reconciliation_at.is.null,next_reconciliation_at.lte.${clock.toISOString()}`)
    .order("created_at", { ascending: true }).limit(Math.min(50, Math.max(1, batchSize)));
  if (error) throw error;

  const stats = { checked: 0, settled: 0, pending: 0, reviewed: 0, failures: 0 };
  // Bounded sequential processing: safe for low-volume SaaS, avoids provider spikes.
  for (const attempt of rows || []) {
    stats.checked++;
    let state = "pending";
    let failureReason = null;
    try {
      const response = await verify(attempt.provider_reference);
      if (response?.data?.reference !== attempt.provider_reference) throw new Error("Provider reference mismatch");
      if (response?.data?.status === "success") {
        const verified = parseVerifiedPaystackTransaction(response, attempt.provider_reference);
        if (!paymentMatchesAttempt(verified, attempt)) {
          state = "review_required";
          failureReason = "Verified charge differs from immutable checkout intent";
        } else {
          const { data: settled, error: rpcError } = await db.rpc("settle_paystack_payment", verified);
          if (rpcError) throw rpcError;
          const row = Array.isArray(settled) ? settled[0] : settled;
          if (!row || row.settled_business_id !== attempt.business_id) throw new Error("Settlement response mismatch");
          if (row.outcome === "review_required") {
            stats.reviewed++;
            continue;
          }
          if (!["settled", "already_settled"].includes(row.outcome)) throw new Error("Unexpected settlement result");
          stats.settled++;
          continue;
        }
      } else if (["failed", "abandoned"].includes(response?.data?.status) &&
          Date.parse(attempt.expires_at) < clock.getTime()) {
        state = "failed";
        failureReason = "Provider confirms failed or abandoned transaction";
      } else if (Date.parse(attempt.expires_at) < clock.getTime()) {
        state = "expired";
        failureReason = "Checkout expired without a verified successful payment";
      }
    } catch (error) {
      stats.failures++;
      failureReason = "Reconciliation retry or review required";
      if ((attempt.reconciliation_attempts || 0) + 1 >= maxAttempts) state = "review_required";
    }
    if (state === "review_required") stats.reviewed++;
    else stats.pending++;
    const attempts = (attempt.reconciliation_attempts || 0) + 1;
    const { error: writeError } = await db.from("checkout_attempts").update({
      status: state,
      reconciliation_attempts: attempts,
      last_reconciliation_at: clock.toISOString(),
      next_reconciliation_at: new Date(clock.getTime() + reconciliationDelayMs(attempts)).toISOString(),
      failure_reason: failureReason,
      updated_at: clock.toISOString(),
    }).eq("id", attempt.id).in("status", ["pending","initialized","initialization_failed"]);
    if (writeError) throw writeError;
  }
  return stats;
}
