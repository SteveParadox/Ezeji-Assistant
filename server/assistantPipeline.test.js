import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assistantDatabase} from '../tests/helpers/assistantDatabase.js';
import {createAssistantService} from './assistantService.js';
const uuid=()=>crypto.randomUUID();const token=()=>crypto.randomBytes(32).toString('hex');
const logger={info(){},error(){}};
test('complete migration chain and durable multi-channel assistant invariants',async t=>{
 const {pg,db}=await assistantDatabase();t.after(()=>pg.close());
 async function seed(){const id=uuid();await pg.query('insert into auth.users(id) values($1)',[id]);await pg.query("insert into profiles(id,business,description,contact_phone,service_name) values($1,'River Salon','Hair services','2348000000000','Haircut')",[id]);return id;}
 const a=await seed(),b=await seed();let calls=0;const seen=[];
 const service=createAssistantService({db,logger,generate:async input=>{calls++;seen.push(input.messages);return {reply:JSON.stringify({reply:'Haircut costs NGN 12000.',intent:'PRICING',needsHuman:false}),provider:'groq',usage:{total_tokens:100}};}});
 await pg.query("insert into services(business_id,name,price,duration) values($1,'Haircut','NGN 12000','30 mins')",[a]);
 let first;const session=token(),key=uuid();
 await t.test('commits messages and accounting, replays without second generation',async()=>{
  first=await service.process({businessId:a,sessionToken:session,requestId:key,message:'Haircut price?'});
  assert.equal(first.reply,'Haircut costs NGN 12000.');assert.equal(calls,1);
  assert.equal((await service.process({businessId:a,sessionToken:session,requestId:key,message:'Haircut price?'})).reply,first.reply);assert.equal(calls,1);
  assert.deepEqual((await pg.query('select consumed,reserved from usage_periods where business_id=$1',[a])).rows[0],{consumed:1,reserved:0});
  assert.equal((await pg.query('select count(*)::int n from assistant_messages where thread_id=$1',[first.conversationId])).rows[0].n,2);
 });
 await t.test('context comes only from same server session in chronological order',async()=>{
  await service.process({businessId:a,sessionToken:session,requestId:uuid(),message:'What about that service?'});
  const msgs=seen.at(-1);assert.equal(msgs.filter(m=>m.content==='What about that service?').length,1);
  assert.equal(msgs.filter(m=>m.content==='Haircut price?').length,1);
  await service.process({businessId:b,sessionToken:session,requestId:uuid(),message:'Hello'});
  assert.equal(seen.at(-1).some(m=>m.content==='Haircut price?'),false);
  await service.process({businessId:a,sessionToken:token(),requestId:uuid(),message:'Hello'});
  assert.equal(seen.at(-1).some(m=>m.content==='What about that service?'),false);
 });
 await t.test('changed idempotency payload and overlapping requests are rejected',async()=>{
  await assert.rejects(()=>service.process({businessId:a,sessionToken:session,requestId:key,message:'Changed'}),e=>e.status===409);
  let release;let entered;const started=new Promise(r=>{entered=r});
  const slow=createAssistantService({db,logger,generate:async()=>{entered();await new Promise(r=>{release=r});return {reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'};}});
  const s=token(),k=uuid(),pending=slow.process({businessId:b,sessionToken:s,requestId:k,message:'Hello'});await started;
  await assert.rejects(()=>slow.process({businessId:b,sessionToken:s,requestId:k,message:'Hello'}),e=>e.status===409);
  release();await pending;
 });
 await t.test('generation failure releases quota and keeps the inbound message',async()=>{
  const failed=createAssistantService({db,logger,generate:async()=>{throw Object.assign(new Error('secret provider body'),{code:'timeout'});}});
  const s=token(),k=uuid();await assert.rejects(()=>failed.process({businessId:b,sessionToken:s,requestId:k,message:'Question'}),/temporarily unavailable/);
  const r=(await pg.query('select status,reservation_id from assistant_requests where request_key=$1',[k])).rows[0];assert.equal(r.status,'failed');
  assert.equal((await pg.query('select status from usage_reservations where id=$1',[r.reservation_id])).rows[0].status,'released');
  assert.equal((await pg.query('select count(*)::int n from assistant_messages where request_id=(select id from assistant_requests where request_key=$1)',[k])).rows[0].n,1);
 });
 await t.test('failed commit retains generated reply and reservation until replay recovers atomically',async()=>{
  let block=true;const broken={...db,rpc:async(n,p)=>n==='commit_assistant_reply'&&block?{error:{code:'XX000'}}:db.rpc(n,p)};
  const svc=createAssistantService({db:broken,logger,generate:async()=>({reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'})});const s=token(),k=uuid();
  await assert.rejects(()=>svc.process({businessId:b,sessionToken:s,requestId:k,message:'Hi'}),/awaiting recovery/);
  const r=(await pg.query('select status,reservation_id from assistant_requests where request_key=$1',[k])).rows[0];assert.equal(r.status,'generated');
  await db.rpc('expire_ai_reservations');assert.equal((await pg.query('select status from usage_reservations where id=$1',[r.reservation_id])).rows[0].status,'reserved');
  block=false;const reply=await svc.process({businessId:b,sessionToken:s,requestId:k,message:'Hi'});assert.equal(reply.reply,'Hello.');
  assert.equal((await pg.query('select status from usage_reservations where id=$1',[r.reservation_id])).rows[0].status,'consumed');
 });
 await t.test('preview shares facts and quotas but creates no customer exchange or booking',async()=>{
  const before=(await pg.query('select count(*)::int n from conversations')).rows[0].n;
  const result=await service.process({businessId:a,channel:'preview',sessionToken:token(),identity:'owner',requestId:uuid(),message:'Haircut price?'});
  assert.equal(result.preview,true);assert.equal((await pg.query('select count(*)::int n from conversations')).rows[0].n,before);
 });
 await t.test('human handoff is real and prevents further model generation',async()=>{
  const s=token();const result=await service.process({businessId:a,sessionToken:s,requestId:uuid(),message:'I want a human'});
  assert.equal(result.escalated,true);const count=calls;
  const next=await service.process({businessId:a,sessionToken:s,requestId:uuid(),message:'Are you there?'});assert.match(next.reply,/staff review/);assert.equal(calls,count);
  assert.equal((await pg.query('select status from assistant_threads where id=$1',[result.conversationId])).rows[0].status,'human');
  const changed=await db.rpc('set_assistant_handoff',{p_business_id:a,p_thread_id:result.conversationId,p_actor_id:b,p_status:'automated'});assert.equal(changed.error.code,'42501');
 });
 await t.test('pause and expired trials fail before generation',async()=>{
  const id=await seed();await pg.query('update profiles set assistant_active=false where id=$1',[id]);const count=calls;
  await assert.rejects(()=>service.process({businessId:id,sessionToken:token(),requestId:uuid(),message:'Hello'}),e=>e.status===403);
  await pg.query("update profiles set assistant_active=true,trial_ends_at=now()-interval '1 day' where id=$1",[id]);
  await assert.rejects(()=>service.process({businessId:id,sessionToken:token(),requestId:uuid(),message:'Hello'}),e=>e.status===403);assert.equal(calls,count);
 });
 await t.test('server-only functions and message tenant foreign keys reject impersonation',async()=>{
  await pg.exec("set request.jwt.claim.role='anon'");
  const denied=await db.rpc('commit_assistant_reply',{p_request_id:uuid()});assert.equal(denied.error.code,'42501');
  await pg.exec("set request.jwt.claim.role='service_role'");
  await assert.rejects(()=>pg.query('insert into assistant_messages(business_id,thread_id,role,content) values($1,$2,\'user\',\'forged\')',[b,first.conversationId]),/foreign key/);
 });
});
