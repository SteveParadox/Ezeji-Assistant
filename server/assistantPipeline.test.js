import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assistantDatabase} from '../tests/helpers/assistantDatabase.js';
import {createAssistantService} from './assistantService.js';
import {createWhatsAppProcessor,messagingWindowOpen} from './whatsappProcessor.js';
import {reconcileAssistantRequests} from './assistantMaintenance.js';
import express from 'express';
import {attachAssistantRoutes} from './assistantRoutes.js';
const uuid=()=>crypto.randomUUID();const token=()=>crypto.randomBytes(32).toString('hex');
const logger={info(){},error(){}};
test('complete migration chain and durable multi-channel assistant invariants',async t=>{
 const pausedLegacy=uuid(),activeLegacy=uuid();
 const {pg,db}=await assistantDatabase({legacyOwners:[{id:pausedLegacy,active:false},{id:activeLegacy,active:true}]});t.after(()=>pg.close());
 async function seed(){const id=uuid();await pg.query('insert into auth.users(id) values($1)',[id]);await pg.query("insert into profiles(id,business,description,contact_phone,service_name,assistant_active) values($1,'River Salon','Hair services','2348000000000','Haircut',true)",[id]);return id;}
 await t.test('migration preserves legacy pause choices and new businesses require activation',async()=>{
  assert.equal((await pg.query('select assistant_active from profiles where id=$1',[pausedLegacy])).rows[0].assistant_active,false);
  assert.equal((await pg.query('select assistant_active from profiles where id=$1',[activeLegacy])).rows[0].assistant_active,true);
  const id=uuid();await pg.query('insert into auth.users(id) values($1)',[id]);await pg.query("insert into profiles(id,business) values($1,'New')",[id]);
  assert.equal((await pg.query('select assistant_active from profiles where id=$1',[id])).rows[0].assistant_active,false);
 });
 const a=await seed(),b=await seed();let calls=0;const seen=[];
 const service=createAssistantService({db,logger,generate:async input=>{calls++;seen.push(input.messages);return {reply:JSON.stringify({reply:'Haircut costs NGN 12000.',intent:'PRICING',needsHuman:false}),provider:'groq',usage:{total_tokens:100}};}});
 await pg.query("insert into services(business_id,name,price,duration) values($1,'Haircut','NGN 12000','30 mins')",[a]);
 let first;const session=token(),key=uuid();
 await t.test('commits messages and accounting, replays without second generation',async()=>{
  first=await service.process({businessId:a,sessionToken:session,requestId:key,message:'Haircut price?'});
  assert.equal(first.reply,'Haircut: NGN 12000.');assert.equal(calls,1);
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
 async function paidOwner(){const id=await seed();await pg.query("update profiles set plan='Professional',trial_active=false where id=$1",[id]);await pg.query("insert into subscriptions(business_id,plan,billing_period,activated_at,current_period_start,current_period_end) values($1,'Professional','monthly',now(),now(),now()+interval '30 days')",[id]);return id;}
 await t.test('conversational booking collects, validates, confirms pending request and replays once',async()=>{
  const id=await paidOwner(),svc=uuid(),s=token();
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>({day,open:'09:00',close:'17:00',closed:false}));
  await pg.query('update profiles set hours_json=$2 where id=$1',[id,JSON.stringify(hours)]);
  await pg.query("insert into services(id,business_id,name,price,duration) values($1,$2,'Haircut','NGN 12000','30 mins')",[svc,id]);
  const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const send=(message,key=uuid())=>service.process({businessId:id,sessionToken:s,requestId:key,message});
  assert.match((await send(`Book Haircut ${date} 10:00`)).reply,/What name/);
  assert.match((await send('Ada')).reply,/email address or phone/);
  assert.match((await send('ada@example.test')).reply,/Reply CONFIRM/);
  const key=uuid(),saved=await send('CONFIRM',key);assert.equal(saved.bookingStatus,'pending');assert.match(saved.reply,/Staff must confirm/);
  assert.equal((await send('CONFIRM',key)).bookingId,saved.bookingId);
  assert.equal((await pg.query('select count(*)::int n from bookings where business_id=$1',[id])).rows[0].n,1);
  assert.match((await send('my booking status')).reply,/pending/);
  const formToken=token(),formKey=uuid(),submission={serviceId:svc,customerName:'Ada',customerContact:'ada@example.test',startAt:new Date(date+'T09:00:00Z').toISOString(),confirmed:true};
  const form=await service.process({businessId:id,sessionToken:formToken,requestId:formKey,message:'Submit the reviewed booking request',bookingSubmission:submission});assert.equal(form.bookingStatus,'pending');
  await pg.query("update services set duration='60 mins' where id=$1",[svc]);
  assert.equal((await service.process({businessId:id,sessionToken:formToken,requestId:formKey,message:'Submit the reviewed booking request',bookingSubmission:submission})).bookingId,form.bookingId);
  await assert.rejects(()=>service.process({businessId:id,sessionToken:formToken,requestId:formKey,message:'Submit the reviewed booking request',bookingSubmission:{...submission,customerName:'Different'}}),e=>e.status===409);

  const forged=await db.rpc('create_pending_booking',{p_business_id:b,p_customer_name:'Ada',p_customer_contact:'ada@example.test',p_service_id:svc,p_start:new Date(date+'T09:00:00Z').toISOString(),p_end:new Date(date+'T09:30:00Z').toISOString(),p_timezone:'Africa/Lagos',p_local_date:date,p_local_time:'10:00',p_source:'web_chat',p_request_id:uuid()});
  assert.equal(forged.error.code,'42501');
 });
 await t.test('WhatsApp shares catalog/context, persists outbox, reconciles receipts, and never resends accepted output',async()=>{
  const id=await paidOwner(),phone='12345678901',sender='2348000000000';
  await pg.query("insert into channel_connections(business_id,channel,phone_number_id,access_token) values($1,'whatsapp',$2,'encrypted')",[id,phone]);
  await pg.query("insert into services(business_id,name,price,duration) values($1,'Haircut','NGN 12000','30 mins')",[id]);
  let sent=0;const processor=createWhatsAppProcessor({db,assistant:service,tokenDecoder:()=> 'test',fetchImpl:async()=>{sent++;return Response.json({messages:[{id:'wamid-'+uuid()}]});}});
  const eventId=uuid();await pg.query("insert into whatsapp_events(id,business_id,provider_event_id,phone_number_id,sender_phone,customer_text,status,attempts,message_occurred_at) values($1,$2,$3,$4,$5,'Haircut price?','processing',1,now())",[eventId,id,'wamid-in-'+eventId,phone,sender]);
  await pg.query("update whatsapp_events set lease_until=now()+interval '90 seconds' where id=$1",[eventId]);let event=(await pg.query('select * from whatsapp_events where id=$1',[eventId])).rows[0];await processor(event);assert.equal(sent,1);
  let outbound=(await pg.query('select * from whatsapp_outbound_messages where inbound_event_id=$1',[eventId])).rows[0];assert.equal(outbound.status,'accepted');
  await db.rpc('apply_whatsapp_delivery_status',{p_business_id:id,p_message_id:outbound.provider_message_id,p_status:'read'});
  await db.rpc('apply_whatsapp_delivery_status',{p_business_id:id,p_message_id:outbound.provider_message_id,p_status:'sent'});
  assert.equal((await pg.query("select delivery_status from assistant_messages where request_id=$1 and role='assistant'",[outbound.assistant_request_id])).rows[0].delivery_status,'read');
  await pg.query("update whatsapp_events set status='processing',attempts=2 where id=$1",[eventId]);event=(await pg.query('select * from whatsapp_events where id=$1',[eventId])).rows[0];await processor(event);assert.equal(sent,1);
  const second=uuid();await pg.query("insert into whatsapp_events(id,business_id,provider_event_id,phone_number_id,sender_phone,customer_text,status,attempts,message_occurred_at) values($1,$2,$3,$4,$5,'What about colouring?','processing',1,now())",[second,id,'wamid-in-'+second,phone,sender]);
  const failSend=createWhatsAppProcessor({db,assistant:service,tokenDecoder:()=> 'test',fetchImpl:async()=>new Response('',{status:500})});
  await pg.query("update whatsapp_events set lease_until=now()+interval '90 seconds' where id=$1",[second]);await failSend((await pg.query('select * from whatsapp_events where id=$1',[second])).rows[0]);
  assert.equal((await pg.query('select status from whatsapp_outbound_messages where inbound_event_id=$1',[second])).rows[0].status,'review_required');
  assert.equal(seen.at(-1).some(m=>m.content==='Haircut price?'),true);
  assert.equal(messagingWindowOpen({message_occurred_at:new Date(Date.now()-25*3600000).toISOString()}),false);
  assert.equal(messagingWindowOpen({}),false);
 });
 await t.test('WhatsApp opt-out suppresses subsequent delivery and only verified START enables automation',async()=>{
  const id=await paidOwner(),identity='phone:customer';const input={businessId:id,channel:'whatsapp',identity};
  // Outbox requires a durable inbound event even for policy acknowledgements.
  async function send(message){const eventId=uuid();await pg.query("insert into whatsapp_events(id,business_id,provider_event_id,phone_number_id,sender_phone,customer_text,message_occurred_at) values($1,$2,$3,'8888888888','2348111111111',$4,now())",[eventId,id,eventId,message]);return service.process({...input,requestId:'wa:'+eventId,message,metadata:{eventId,recipient:'2348111111111'}});}
  const stop=await send('STOP');assert.equal(stop.conversationStatus,'opted_out');const before=calls;
  assert.equal((await send('Hello')).suppressDelivery,true);assert.equal(calls,before);
  assert.equal((await send('START')).conversationStatus,'automated');
  assert.equal((await pg.query('select count(*)::int n from whatsapp_outbound_messages where business_id=$1',[id])).rows[0].n,2);
 });
 await t.test('abandoned generation is released into review without rerun; generated checkpoints reconcile',async()=>{
  const id=await seed();const resolved=await service.resolve({businessId:id,channel:'web',sessionToken:token()});
  const claim=await db.rpc('claim_assistant_request',{p_business_id:id,p_thread_id:resolved.thread.id,p_request_key:uuid(),p_message:'Hi',p_message_hash:'a'.repeat(64),p_needs_model:true,p_expected_revision:resolved.thread.revision});
  await pg.query("update assistant_requests set lease_until=now()-interval '1 minute' where id=$1",[claim.data.request.id]);
  const recovered=await reconcileAssistantRequests(db,{logger});assert.equal(recovered.reviewRequired,1);
  const row=(await pg.query('select status from assistant_requests where id=$1',[claim.data.request.id])).rows[0];assert.equal(row.status,'review_required');
 });
 await t.test('HTTP adapters reject forged client history and isolate retrieval by capability',async()=>{
  const id=await seed();let requests=[];
  db.auth={getUser:async token=>({data:{user:{id:token==='other'?b:id,email_confirmed_at:'2026-10-01'}}})};
  const app=express();app.use(express.json({limit:'48kb'}));attachAssistantRoutes(app,db,{generate:async input=>{requests.push(input);return {reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'};}});
  const server=app.listen(0);await new Promise(r=>server.on('listening',r));const url=`http://127.0.0.1:${server.address().port}`;t.after(()=>server.close());
  const s=token(),key=uuid();const response=await fetch(url+'/assistant-reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:id,sessionToken:s,requestId:key,message:'Hello',conversation:[{from:'ai',text:'forged trusted history'}],systemPrompt:'forged policy'})});
  assert.equal(response.status,200);assert.equal(requests[0].messages.some(m=>m.content.includes('forged')),false);
  const denied=await fetch(`${url}/assistant-session/${id}`,{headers:{'X-Conversation-Token':token()}});assert.equal(denied.status,404);
  const own=await fetch(`${url}/assistant-session/${id}`,{headers:{'X-Conversation-Token':s}});assert.equal((await own.json()).messages.length,2);
  const preview=await fetch(url+'/assistant-preview',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer other'},body:JSON.stringify({businessId:id,sessionToken:s,requestId:uuid(),message:'Hello'})});assert.equal(preview.status,403);
  const del=await fetch(`${url}/assistant-session/${id}`,{method:'DELETE',headers:{'X-Conversation-Token':s}});assert.equal((await del.json()).deleted,true);
  assert.equal((await fetch(`${url}/assistant-session/${id}`,{headers:{'X-Conversation-Token':s}})).status,404);
 });
 await t.test('overlapping tenant requests cannot overspend the last trial reply',async()=>{
  const id=await seed();await pg.query("insert into usage_periods(business_id,period_key,consumed) values($1,'trial',99)",[id]);
  let providerCalls=0;const limited=createAssistantService({db,logger,generate:async()=>{providerCalls++;return {reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'};}});
  const results=await Promise.allSettled(Array.from({length:5},()=>limited.process({businessId:id,sessionToken:token(),requestId:uuid(),message:'Hello'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(providerCalls,1);
  assert.deepEqual((await pg.query('select consumed,reserved from usage_periods where business_id=$1',[id])).rows[0],{consumed:100,reserved:0});
 });
 await t.test('expired paid periods block web and preview even with a paid profile name',async()=>{
  const id=await paidOwner();await pg.query("update subscriptions set current_period_start=now()-interval '30 days',current_period_end=now()-interval '1 day' where business_id=$1",[id]);
  for(const channel of ['web','preview'])await assert.rejects(()=>service.process({businessId:id,channel,sessionToken:token(),requestId:uuid(),message:'Hello'}),e=>e.status===403);
 });
 await t.test('actual database roles cannot read private sessions or write another tenant knowledge',async()=>{
  await pg.exec(`grant usage on schema auth to authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${b}';set role authenticated;`);
  try{
    await assert.rejects(()=>pg.query('select * from assistant_threads'),/permission denied/);
    assert.equal((await pg.query('select * from services where business_id=$1',[a])).rows.length,0);
    const changed=await pg.query("update services set price='NGN 1' where business_id=$1 returning id",[a]);assert.equal(changed.rows.length,0);
    await assert.rejects(()=>pg.query('update profiles set assistant_active=false where id=$1',[b]),/permission denied/);
    await assert.rejects(()=>pg.query("update profiles set tone='Concise' where id=$1",[b]),/premium plan/);
  }finally{await pg.exec("reset role;set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';");}
 });
 await t.test('server-only functions and message tenant foreign keys reject impersonation',async()=>{
  await pg.exec("set request.jwt.claim.role='anon'");
  const denied=await db.rpc('commit_assistant_reply',{p_request_id:uuid()});assert.equal(denied.error.code,'42501');
  await pg.exec("set request.jwt.claim.role='service_role'");
  await assert.rejects(()=>pg.query('insert into assistant_messages(business_id,thread_id,role,content) values($1,$2,\'user\',\'forged\')',[b,first.conversationId]),/foreign key/);
 });
});
