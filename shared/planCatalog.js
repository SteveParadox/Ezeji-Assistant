// One NGN catalog shared by the server's authoritative checkout path and
// frontend display. Amounts are integer KOBO, not naira.
export const PLAN_PRICE_NGN_KOBO = Object.freeze({
  Starter: Object.freeze({ monthly: 1_500_000, yearly: 15_000_000 }),
  Professional: Object.freeze({ monthly: 3_500_000, yearly: 35_000_000 }),
  Business: Object.freeze({ monthly: 7_500_000, yearly: 75_000_000 }),
});
