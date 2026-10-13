import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationDelayMs, reconcileDueCheckouts } from "./paymentReconciler.js";

test("reconciliation backoff stays bounded", () => {
  assert.equal(reconciliationDelayMs(0), 60_000);
  assert.equal(reconciliationDelayMs(1), 120_000);
  assert.ok(reconciliationDelayMs(50) <= 86_400_000);
});

function fakeDatabase(attempts, updates) {
  const selection = {
    select: () => selection, in: () => selection, lt: () => selection,
    or: () => selection, order: () => selection,
    async limit() {return {data:attempts,error:null}},
  };
  const updating = {
    eq: () => updating,
    async in() {return {error:null}},
  };
  return {
    from(table) {
      assert.equal(table,"checkout_attempts");
      return {
        ...selection,
        update(record) { updates.push(record); return updating; },
      };
    },
    async rpc() { return {data:[{outcome:"settled",settled_business_id:"owner-1"}],error:null}; },
  };
}

test("verification timeout never activates payment and schedules retry", async () => {
  const updates=[];
  const db=fakeDatabase([{
    id:"id",business_id:"owner-1",provider_reference:"ref",status:"initialized",
    expires_at:"2099-01-01",reconciliation_attempts:0,
  }],updates);
  const result=await reconcileDueCheckouts(db,{
    verify:async()=>{throw new Error("timeout")},
    now:()=>new Date("2026-10-13T12:00:00Z"),
  });
  assert.equal(result.failures,1);
  assert.equal(result.settled,0);
  assert.equal(updates.length,1);
  assert.equal(updates[0].status,"pending");
});
