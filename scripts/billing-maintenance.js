import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { reconcileDueCheckouts } from "../server/paymentReconciler.js";

dotenv.config();
for (const key of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PAYSTACK_SECRET_KEY"]) {
  if (!process.env[key]) throw new Error(`Missing required secret: ${key}`);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function verify(reference) {
  const response = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
    headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Paystack verification failed");
  return response.json();
}

try {
  const result = await reconcileDueCheckouts(db, { verify });
  const { data: expired, error } = await db.rpc("expire_paid_subscriptions");
  if (error) throw error;
  const {data: released, error: releaseError} = await db.rpc("expire_ai_reservations");
  if (releaseError) throw releaseError;
  console.info(JSON.stringify({event:"billing_maintenance",...result,expiredSubscriptions:expired,expiredReservations:released}));
} catch (error) {
  console.error(JSON.stringify({ event: "billing_maintenance_failed", reason: error.message }));
  process.exitCode = 1;
}
