import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationDelayMs, reconcileDueCheckouts } from "./paymentReconciler.js";

test("reconciliation backoff is bounded", () => {
  assert.equal(reconciliationDelayMs(0), 60_000);
  assert.equal(reconciliationDelayMs(1), 120_000);
  assert.ok(reconciliationDelayMs(50) <= 86_400_000);
});
function dbFor(attempts, updateLog) {
  return {
    from(table) {
      assert.equal(table,"checkout_attempts");
      return {
        select() {return {in() {return {lt() {return {or() {return {order() {return {async limit() {
          return { data: attempts, error: null };
        }}}}}}}}}}}}},
        update(data) {
          updateLog.push(data);
          return { eq() {return {async in() {return {error:null}}}} };
        },
      };
    },
    async rpc() {return {data:[{outcome:"settled",settled_business_id:"owner-1"}],error:null}},
  };
}
test("failed network verification never grants entitlement and schedules retry",async()=>{
 const changes=[];
 const db=dbFor([{ id:"id",business_id:"owner-1",provider_reference:"ref",status:"initialized",expires_at:"2099-01-01",reconciliation_attempts:0 }],changes);
 const result=await reconcileDueCheckouts(db,{verify:async()=>{throw Error("timeout")},now:()=>new Date("2026-10-13T12:00:00Z")});
 assert.equal(result.failures,1);
 assert.equal(changes[0].status,"pending");
 assert.equal(result.settled,0);
});
