import test from "node:test";
import assert from "node:assert/strict";
import { ensureOwnerBusiness, validatedBusinessFields, OnboardingInputError } from "./businessProvisioning.js";

function fakeDatabase(seed = null) {
  const rows = new Map(seed ? [["owner-1", { ...seed }]] : []);
  const stats = { upserts: 0, updates: 0, reads: 0 };
  let lookupError = null;
  const db = {
    rows, stats,
    failReads(error) { lookupError = error; },
    from(table) {
      assert.equal(table, "profiles");
      return {
        select() {
          return {
            eq(column, ownerId) {
              assert.equal(column, "id");
              return {
                async maybeSingle() {
                  stats.reads++;
                  return lookupError ? { data: null, error: lookupError } :
                    { data: rows.get(ownerId) || null, error: null };
                },
              };
            },
          };
        },
        upsert: async (record, options) => {
          stats.upserts++;
          assert.deepEqual(options, { onConflict: "id", ignoreDuplicates: true });
          if (!rows.has(record.id)) rows.set(record.id, record);
          return { error: null };
        },
        update(patch) {
          return {
            async eq(column, ownerId) {
              assert.equal(column, "id");
              stats.updates++;
              rows.set(ownerId, { ...rows.get(ownerId), ...patch });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return db;
}

test("first owner login creates a trial business with server-owned billing values", async () => {
  const db = fakeDatabase();
  const result = await ensureOwnerBusiness(db, "owner-1", {
    business: "New Cafe", name: "Owner", plan: "Business", paymentStatus: "active",
    trialEndsAt: "2999-01-01", role: "admin",
  });
  assert.equal(result.businessId, "owner-1");
  assert.equal(db.rows.get("owner-1").payment_status, "trial");
  assert.equal(db.rows.get("owner-1").plan, "14-day trial");
  assert.equal(db.rows.get("owner-1").trial_active, true);
  assert.equal(db.rows.size, 1);
});

test("repeated and concurrent provisioning do not replace an active subscription", async () => {
  const db = fakeDatabase();
  await Promise.all(Array.from({ length: 8 }, () => ensureOwnerBusiness(db, "owner-1", { business: "Cafe" })));
  assert.equal(db.rows.size, 1);
  db.rows.set("owner-1", { ...db.rows.get("owner-1"), plan: "Business", payment_status: "active" });
  await ensureOwnerBusiness(db, "owner-1", { business: "Wrong name" });
  assert.equal(db.rows.get("owner-1").business, "Cafe");
  assert.equal(db.rows.get("owner-1").plan, "Business");
  assert.equal(db.rows.get("owner-1").payment_status, "active");
});

test("legacy verified owner with a missing business name can recover without losing subscription", async () => {
  const db = fakeDatabase({ id: "owner-1", name: "", business: "", plan: "Professional", payment_status: "active" });
  const result = await ensureOwnerBusiness(db, "owner-1", { business: "Restored", name: "Alex" });
  assert.equal(result.recovered, true);
  assert.equal(db.rows.get("owner-1").business, "Restored");
  assert.equal(db.rows.get("owner-1").plan, "Professional");
});

test("database read failure must not accidentally create a duplicate business", async () => {
  const db = fakeDatabase();
  db.failReads(new Error("Connection timeout"));
  await assert.rejects(ensureOwnerBusiness(db, "owner-1", { business: "Cafe" }), /timeout/);
  assert.equal(db.stats.upserts, 0);
});

test("incomplete or malformed business names require user input", async () => {
  const db = fakeDatabase();
  assert.equal(validatedBusinessFields({ role: "admin" }), null);
  await assert.rejects(
    ensureOwnerBusiness(db, "owner-1", null, {}),
    (error) => error instanceof OnboardingInputError && error.status === 422
  );
});

test("owner identity comes from caller-authenticated ID, not the posted payload", async () => {
  const db = fakeDatabase();
  await ensureOwnerBusiness(db, "owner-1", { business: "Cafe", id: "victim-1" });
  assert.equal(db.rows.has("victim-1"), false);
  assert.equal(db.rows.has("owner-1"), true);
});
