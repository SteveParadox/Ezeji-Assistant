import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assistantDatabase} from '../tests/helpers/assistantDatabase.js';
import {createAssistantService,hash} from './assistantService.js';
import {createWhatsAppProcessor} from './whatsappProcessor.js';
import {loadBusinessKnowledge} from './assistantKnowledge.js';
const uuid=()=>crypto.randomUUID(),token=()=>crypto.randomBytes(32).toString('hex');
const logger={info(){},error(){}};
test('assistant corrective audit: durable race and recovery regressions',async t=>{
 const {pg,db}=await assistantDatabase();t.after(()=>pg.close());
 async function seed(paid=false){const id=uuid();await pg.query('insert into auth.users(id) values($1)',[id]);
  await pg.query("insert into profiles(id,business,description,contact_phone,assistant_active) values($1,'Salon','Hair services','2348000000000',true)",[id]);
  if(paid){await pg.query("update profiles set plan='Professional' where id=$1",[id]);await pg.query("insert into subscriptions(business_id,plan,billing_period,activated_at,current_period_start,current_period_end) values($1,'Professional','monthly',now(),now(),now()+interval '30 days')",[id]);}
  return id;
 }
 const svc=createAssistantService({db,logger,generate:async()=>({reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'})});
 async function claim(id,s,message='Hello',key=uuid(),model=true){const {thread}=await svc.resolve({businessId:id,channel:'web',sessionToken:s});
  const result=await db.rpc('claim_assistant_request',{p_business_id:id,p_thread_id:thread.id,p_request_key:key,p_message:message,p_message_hash:hash(message),p_needs_model:model,p_expected_revision:thread.revision});assert.equal(result.error,null);return {thread,req:result.data.request,key};}
 await t.test('policy retry must not reuse a released provider reservation',async()=>{
  const id=await seed(),s=token(),first=await claim(id,s);
  await db.rpc('fail_assistant_request',{p_request_id:first.req.id,p_code:'timeout',p_attempt:first.req.attempt});
  const retry=await claim(id,s,'Hello',first.key,false);
  await db.rpc('checkpoint_assistant_reply',{p_request_id:retry.req.id,p_attempt:retry.req.attempt,p_outcome:{reply:'Awaiting staff review.',provider:'policy'}});
  const result=await db.rpc('commit_assistant_reply',{p_request_id:retry.req.id});assert.equal(result.error,null);
  assert.equal((await pg.query('select consumed from usage_periods where business_id=$1',[id])).rows[0].consumed,0);
 });
 await t.test('late failure callback from an earlier attempt must not release its replacement',async()=>{
  const id=await seed(),s=token(),first=await claim(id,s);await db.rpc('fail_assistant_request',{p_request_id:first.req.id,p_code:'timeout',p_attempt:first.req.attempt});
  const retry=await claim(id,s,'Hello',first.key);
  await db.rpc('fail_assistant_request',{p_request_id:first.req.id,p_code:'late_timeout',p_attempt:first.req.attempt});
  const row=(await pg.query('select status,reservation_id from assistant_requests where id=$1',[retry.req.id])).rows[0];assert.equal(row.status,'processing');
 });
 await t.test('rejected booking checkpoint must not occupy the global generation queue forever',async()=>{
  const id=await seed(true),c=await claim(id,token(),'CONFIRM',uuid(),false);
  await db.rpc('checkpoint_assistant_reply',{p_request_id:c.req.id,p_attempt:c.req.attempt,p_outcome:{reply:'Submitting.',provider:'policy',bookingAction:{serviceId:uuid(),name:'Ada',contact:'ada@example.test',start:'2026-10-20T09:00:00Z',end:'2026-10-20T09:30:00Z',timezone:'Africa/Lagos',localDate:'2026-10-20',localTime:'10:00'}}});
  const result=await db.rpc('commit_assistant_reply',{p_request_id:c.req.id});assert.equal(result.error,null);assert.equal(result.data.bookingStatus,'failed');
  assert.equal((await pg.query('select status from assistant_requests where id=$1',[c.req.id])).rows[0].status,'committed');
 });
 await t.test('booking state must be refreshed if another turn commits during knowledge loading',async()=>{
  const id=await seed(true),s=token();const serviceId=uuid();const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>({day,open:'09:00',close:'17:00',closed:false}));
  await pg.query('update profiles set hours_json=$2 where id=$1',[id,JSON.stringify(hours)]);await pg.query("insert into services(id,business_id,name,duration) values($1,$2,'Haircut','30 mins')",[serviceId,id]);
  let release,entered;const ready=new Promise(r=>entered=r);let first=true;
  const slow=createAssistantService({db,logger,generate:async()=>({reply:JSON.stringify({reply:'Hello.',intent:'GREETING'}),provider:'groq'}),knowledgeLoader:async(...args)=>{const knowledge=await loadBusinessKnowledge(...args);if(first){first=false;entered();await new Promise(r=>release=r);}return knowledge;}});
  const pending=slow.process({businessId:id,sessionToken:s,requestId:uuid(),message:'Ada'});await ready;
  await svc.process({businessId:id,sessionToken:s,requestId:uuid(),message:`Book Haircut ${date} 10:00`});release();
  assert.match((await pending).reply,/email address or phone/);
 });
 await t.test('stale checkpoints cannot attach an earlier response to a replacement attempt',async()=>{
  const id=await seed(),s=token(),first=await claim(id,s);await db.rpc('fail_assistant_request',{p_request_id:first.req.id,p_code:'timeout',p_attempt:first.req.attempt});
  const retry=await claim(id,s,'Hello',first.key);
  const stale=await db.rpc('checkpoint_assistant_reply',{p_request_id:first.req.id,p_attempt:first.req.attempt,p_outcome:{reply:'Old response.',provider:'groq'}});assert.equal(stale.data,false);
  const fresh=await db.rpc('checkpoint_assistant_reply',{p_request_id:retry.req.id,p_attempt:retry.req.attempt,p_outcome:{reply:'Fresh response.',provider:'groq'}});assert.equal(fresh.data,true);
  assert.equal((await db.rpc('commit_assistant_reply',{p_request_id:retry.req.id})).data.reply,'Fresh response.');
 });
 await t.test('same booking submission cannot create a second appointment after chat deletion',async()=>{
  const id=await seed(true),s=token(),key=uuid(),serviceId=uuid();const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>({day,open:'09:00',close:'17:00',closed:false}));
  await pg.query('update profiles set hours_json=$2 where id=$1',[id,JSON.stringify(hours)]);await pg.query("insert into services(id,business_id,name,duration) values($1,$2,'Haircut','30 mins')",[serviceId,id]);
  const input={businessId:id,sessionToken:s,requestId:key,message:'Submit the reviewed booking request',bookingSubmission:{serviceId,customerName:'Ada',customerContact:'ada@example.test',startAt:date+'T09:00:00Z',confirmed:true}};
  const first=await svc.process(input);assert.equal(first.bookingStatus,'pending');
  await db.rpc('delete_assistant_thread',{p_business_id:id,p_thread_id:first.conversationId});
  const second=await svc.process(input);assert.equal(second.bookingId,first.bookingId);assert.equal((await pg.query('select count(*)::int n from bookings where business_id=$1',[id])).rows[0].n,1);
 });
 async function whatsapp(message='Hello') {
  const id=await seed(true),eventId=uuid(),phone='1'+String(Math.floor(Math.random()*1e10)).padStart(10,'0'),sender='2348111111111';
  await pg.query("insert into channel_connections(business_id,channel,phone_number_id,access_token) values($1,'whatsapp',$2,'encrypted-old')",[id,phone]);
  await pg.query("insert into whatsapp_events(id,business_id,provider_event_id,phone_number_id,sender_phone,customer_text,status,attempts,lease_until,message_occurred_at) values($1,$2,$3,$4,$5,$6,'processing',1,now()+interval '90 seconds',now())",[eventId,id,'wa-'+eventId,phone,sender,message]);
  const event=(await pg.query('select * from whatsapp_events where id=$1',[eventId])).rows[0];
  const reply=await svc.process({businessId:id,channel:'whatsapp',identity:phone+':'+sender,requestId:'wa-'+eventId,message,metadata:{eventId,recipient:sender}});
  const outbound=(await pg.query('select * from whatsapp_outbound_messages where inbound_event_id=$1',[eventId])).rows[0];
  return {id,event,reply,outbound};
 }
 await t.test('replaced or expired WhatsApp leases cannot authorize an outbound send',async()=>{
  const {event,outbound}=await whatsapp();await pg.query('update whatsapp_events set attempts=2 where id=$1',[event.id]);
  assert.equal((await db.rpc('claim_whatsapp_outbound',{p_outbound_id:outbound.id,p_event_id:event.id,p_attempt:1})).data.state,'lease_lost');
  await pg.query("update whatsapp_events set lease_until=now()-interval '1 second' where id=$1",[event.id]);
  assert.equal((await db.rpc('claim_whatsapp_outbound',{p_outbound_id:outbound.id,p_event_id:event.id,p_attempt:2})).data.state,'lease_lost');
 });
 await t.test('staff control or opt-out changes suppress an already queued AI reply',async()=>{
  for(const status of ['human','opted_out']) {
   const {event,reply,outbound}=await whatsapp();await pg.query('update assistant_threads set status=$2 where id=$1',[reply.conversationId,status]);
   const denied=await db.rpc('claim_whatsapp_outbound',{p_outbound_id:outbound.id,p_event_id:event.id,p_attempt:event.attempts});assert.equal(denied.data.state,'blocked');
   assert.equal((await pg.query('select status from whatsapp_outbound_messages where id=$1',[outbound.id])).rows[0].status,'failed');
  }
 });
 await t.test('atomic WhatsApp claim uses current credentials and permits a recorded handoff acknowledgement',async()=>{
  const {id,event,outbound}=await whatsapp('I want a human');await pg.query("update channel_connections set access_token='encrypted-new' where business_id=$1",[id]);
  const allowed=await db.rpc('claim_whatsapp_outbound',{p_outbound_id:outbound.id,p_event_id:event.id,p_attempt:event.attempts});assert.equal(allowed.data.state,'claimed');assert.equal(allowed.data.accessToken,'encrypted-new');
 });
 await t.test('worker with stale event attempt never calls Meta despite a queued reply',async()=>{
  const {event}=await whatsapp();await pg.query('update whatsapp_events set attempts=2 where id=$1',[event.id]);let sends=0;
  const processor=createWhatsAppProcessor({db,assistant:svc,fetchImpl:async()=>{sends++;throw new Error('Must not send');},tokenDecoder:()=> 'token'});
  await assert.rejects(()=>processor(event),/lease lost/);assert.equal(sends,0);
 });
 await t.test('duplicate/malformed weekly schedules fail at save time without poisoning knowledge',async()=>{
  const id=await seed();for(const hours of [[{day:'Monday',closed:false,open:'09:00',close:'17:00'},{day:'Monday',closed:true}],{day:'Monday'},[{day:'Monday',closed:false,open:'garbage',close:'17:00'}]])await assert.rejects(()=>pg.query('update profiles set hours_json=$2 where id=$1',[id,JSON.stringify(hours)]));
 });

 await t.test('server memory includes staff turns without a request ID while excluding the current turn',async()=>{
  const id=await seed(),s=token(),{thread}=await svc.resolve({businessId:id,channel:'web',sessionToken:s});
  await pg.query("insert into assistant_messages(business_id,thread_id,role,content) values($1,$2,'staff','Staff explained the request')",[id,thread.id]);
  let context;const service=createAssistantService({db,logger,generate:async input=>{context=input.messages;return {provider:'groq',reply:JSON.stringify({reply:'Understood.',intent:'GENERAL_ENQUIRY'})};}});
  await service.process({businessId:id,sessionToken:s,requestId:uuid(),message:'Please clarify'});assert.equal(context.some(m=>m.content==='Staff explained the request'),true);assert.equal(context.filter(m=>m.content==='Please clarify').length,1);
 });
 await t.test('changed catalog details require a fresh customer confirmation',async()=>{
  const id=await seed(true),s=token(),serviceId=uuid(),date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const hours=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>({day,open:'09:00',close:'17:00',closed:false}));
  await pg.query('update profiles set hours_json=$2 where id=$1',[id,JSON.stringify(hours)]);await pg.query("insert into services(id,business_id,name,price,duration) values($1,$2,'Haircut','NGN 12000','30 mins')",[serviceId,id]);
  const send=message=>svc.process({businessId:id,sessionToken:s,requestId:uuid(),message});
  await send(`Book Haircut ${date} 10:00`);await send('Ada');await send('ada@example.test');await pg.query("update services set price='NGN 15000',duration='60 mins' where id=$1",[serviceId]);
  const changed=await send('CONFIRM');assert.equal(changed.bookingId,undefined);assert.match(changed.reply,/NGN 15000/);assert.match(changed.reply,/CONFIRM/);
  assert.equal((await send('CONFIRM')).bookingStatus,'pending');
 });

});
