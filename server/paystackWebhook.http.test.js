// Real Express/HTTP regression tests for webhook HMAC and retry responses.
// These deliberately run with no Supabase credentials or Paystack network.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

test("Paystack webhook rejects forged payloads and never ACKs unsettled charges", async (t) => {
  process.env.VERCEL = "1"; // Do not start server.js's production listener.
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.PAYSTACK_SECRET_KEY = "test-paystack-webhook-secret";
  const { default: app } = await import("../server.js");
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/webhooks/paystack`;

  async function send(data, signature = "valid") {
    const body = JSON.stringify(data);
    const signed = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(body).digest("hex");
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature === "valid" ? signed : signature,
      },
      body,
    });
  }
  await t.test("bad HMAC is denied before touching settlement", async () => {
    const response = await send({ event: "charge.success", data: { status: "success", reference: "anything" } }, "invalid");
    assert.equal(response.status, 401);
  });
  await t.test("signed irrelevant event is acknowledged without activation", async () => {
    const response = await send({ event: "transfer.success" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ignored, true);
  });
  await t.test("signed successful charge gets retryable failure if database is unavailable", async () => {
    const response = await send({ event: "charge.success", data: {
      status: "success", amount: 3500000, currency: "NGN", reference: "ezeji_test",
    } });
    assert.equal(response.status, 503);
  });
  await t.test("signed failed charge never activates service", async () => {
    const response = await send({ event: "charge.success", data: { status: "failed" } });
    assert.equal(response.status, 422);
  });
});
