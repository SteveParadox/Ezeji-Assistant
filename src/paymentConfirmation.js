// Neither a Paystack redirect nor an already-active plan proves that the
// specific checkout attempt just returned has settled.
export function paymentVerificationIsSettled(result) {
  return result?.verified === true && result?.status === "paid" &&
    result?.requiresReview !== true;
}
