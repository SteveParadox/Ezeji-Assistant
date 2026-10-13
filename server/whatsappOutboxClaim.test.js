import test from "node:test";
import assert from "node:assert/strict";
import {claimQueuedOutbound} from "./whatsappOutboxClaim.js";
function fakeDatabase(row,error=null) {
  const changes=[];
  const chain={eq:()=>chain,select:()=>chain,async maybeSingle(){return {data:row,error}}};
  return {changes,db:{from(table) {
    assert.equal(table,"whatsapp_outbound_messages");
    return {update(value){changes.push(value);return chain}};
  }}};
}
test("successful queued-to-sending transition permits one Meta send",async()=>{
 const {db,changes}=fakeDatabase({id:"outbound-1"});
 assert.equal(await claimQueuedOutbound(db,"outbound-1",()=>new Date("2026-10-13T13:00:00Z")),true);
 assert.equal(changes[0].status,"sending");
});
test("zero-row update means another worker already claimed and MUST NOT send",async()=>{
 const {db}=fakeDatabase(null);
 assert.equal(await claimQueuedOutbound(db,"outbound-1"),false);
});
test("database error never becomes send permission",async()=>{
 const {db}=fakeDatabase(null,new Error("connection refused"));
 await assert.rejects(claimQueuedOutbound(db,"outbound-1"),/connection refused/);
});
