import test from "node:test";
import assert from "node:assert/strict";
import { attachAssistantPreviewRoute } from "./assistantPreview.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function response() {
  return {
    code: 200, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function setup(authId = UUID) {
  let handler;
  const called = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: authId } }, error: null }) },
    from(table) {
      called.push(table);
      if (table === "conversations" || table === "bookings") {
        throw new Error("Preview must never persist operational customer records.");
      }
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: { id: UUID, business: "Sample Shop", plan: "14-day trial", hours: "Mon-Fri 9-5" }, error: null };
        },
        async limit() { return { data: [], error: null }; },
      };
    },
    async rpc(name, params) {
      called.push(name);
      if (name === "reserve_ai_usage") {
        assert.equal(params.p_business_id, UUID);
        return { data: "reservation-1", error: null };
      }
      assert.equal(params.p_reservation_id, "reservation-1");
      return { data: true, error: null };
    },
  };
  const app = { post(path, fn) { assert.equal(path, "/assistant-preview"); handler = fn; } };
  attachAssistantPreviewRoute(app, db, async () => ({
    reply: "A request needs staff confirmation.", provider: "groq",
  }));
  return { handler, called };
}

test("preview requires an authenticated owner token", async () => {
  const { handler, called } = setup();
  const res = response();
  await handler({ headers: {}, body: { businessId: UUID, message: "Hello" } }, res);
  assert.equal(res.code, 401);
  assert.deepEqual(called, []);
});

test("preview rejects cross-business access before querying tenant data", async () => {
  const { handler, called } = setup(OTHER);
  const res = response();
  await handler({ headers: { authorization: "Bearer valid" }, body: { businessId: UUID, message: "Hello" } }, res);
  assert.equal(res.code, 403);
  assert.deepEqual(called, []);
});

test("preview uses persisted business facts and quota but writes no conversations or bookings", async () => {
  const { handler, called } = setup();
  const res = response();
  await handler({ headers: { authorization: "Bearer valid" },
    body: { businessId: UUID, message: "Can I book?", requestId: OTHER, conversation: [] } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.preview, true);
  assert.match(res.body.reply, /staff confirmation/i);
  assert.ok(called.includes("reserve_ai_usage"));
  assert.ok(called.includes("finalize_ai_usage"));
  assert.ok(!called.includes("conversations"));
  assert.ok(!called.includes("bookings"));
});
