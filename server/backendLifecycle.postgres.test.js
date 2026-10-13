import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const url=process.env.EZEJI_LIFECYCLE_TEST_DATABASE_URL;
let name="";
try{name=decodeURIComponent(new URL(url).pathname.slice(1))}catch{}
const available=!!url&&/_test$/.test(name)&&spawnSync("psql",["--version"]).status===0;
const options=available?{}:{skip:"Need disposable PostgreSQL DB ending _test and psql executable"};
const args=["-X","-A","-t","-q","-v","ON_ERROR_STOP=1","-d",url||""];
function query(sql,allowFailure=false) {
 const result=spawnSync("psql",[...args,"-c",sql],{encoding:"utf8"});
 if(result.status!==0&&!allowFailure)throw new Error(result.stderr||result.stdout);
 return {ok:result.status===0,output:result.stdout.trim()};
}
function migration(file) {
 const result=spawnSync("psql",[...args,"-f",file],{encoding:"utf8"});
 if(result.status!==0)throw new Error("Failed "+file+": "+result.stderr);
}
const uuid=()=>crypto.randomUUID();
const ref=()=>("ezeji_"+uuid().replaceAll("-",""));
const roleSql=sql=>"begin; set local request.jwt.claim.role='service_role'; "+sql+"; commit;";
function count(table,column,value){return Number(query(`select count(*) from ${table} where ${column}='${value}'`).output);}
function seedOwner(owner) {
 query(roleSql(`insert into auth.users(id)values('${owner}');
 insert into public.profiles(id,business,plan,trial_active,trial_ends_at)
 values('${owner}','Test', '14-day trial',true,now()+interval '14 days')`));
}
function attempt(owner,reference,plan="Professional",amount=3500000) {
 query(roleSql(`insert into public.checkout_attempts(
 business_id,user_id,provider_reference,plan,billing_period,
 expected_amount,currency,customer_email,status,expires_at)
 values('${owner}','${owner}','${reference}','${plan}','monthly',${amount},
 'NGN','owner@example.test','initialized',now()+interval '1 day')`));
}
function settle(reference,amount=3500000,providerId="991") {
 return roleSql(`select outcome from public.settle_paystack_payment(
 '${reference}',${amount},'NGN','owner@example.test','${providerId}',now())`);
}

test("Ezeji new full migration bootstrap and transactional invariants",options,async t=>{
 // Never connect to production or a database not explicitly named *_test.
 query(`create schema if not exists auth;
 do $roles$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end $roles$;
 create table if not exists auth.users(id uuid primary key);
 create or replace function auth.uid()returns uuid language sql stable
 as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 create or replace function auth.role()returns text language sql stable
 as 'select current_setting(''request.jwt.claim.role'',true)';`);
 const root="supabase/migrations";
 for(const filename of fs.readdirSync(root).filter(f=>f.endsWith(".sql")).sort()) {
   migration(path.join(root,filename));
 }
 await t.test("50 overlapping settlements create exactly one paid invoice",async()=>{
   const owner=uuid(),reference=ref(),providerId=uuid();
   seedOwner(owner);attempt(owner,reference);
   const cmd=promisify(execFile);
   const results=await Promise.all(Array.from({length:50},()=>cmd("psql",[...args,"-c",settle(reference,3500000,providerId)])));
   assert.equal(results.filter(x=>/already_settled/.test(x.stdout)).length,49);
   assert.equal(count("public.invoices","provider_reference",reference),1);
   assert.equal(count("public.subscriptions","business_id",owner),1);
 });
 await t.test("invoice error rolls back paid subscription and attempt status",()=>{
   const owner=uuid(),reference=ref();
   seedOwner(owner);attempt(owner,reference);
   query(`create or replace function public.fail_test_invoice() returns trigger language plpgsql
   as 'begin raise exception ''invoice failure'';end';
   create trigger fail_test_invoice before insert on public.invoices
   for each row execute function public.fail_test_invoice()`);
   try {
     assert.equal(query(settle(reference,3500000,uuid()),true).ok,false);
     assert.equal(count("public.subscriptions","business_id",owner),0);
     assert.equal(count("public.invoices","provider_reference",reference),0);
     assert.equal(query(`select status from public.checkout_attempts where provider_reference='${reference}'`).output,"initialized");
   }finally{
     query("drop trigger fail_test_invoice on public.invoices;drop function public.fail_test_invoice()");
   }
 });
 await t.test("100 concurrent trial reservations never oversubscribe remaining capacity",async()=>{
   const owner=uuid();seedOwner(owner);
   query(roleSql(`insert into public.usage_periods(business_id,period_key,consumed,reserved)
    values('${owner}','trial',98,0)`));
   const cmd=promisify(execFile);
   const results=await Promise.all(Array.from({length:100},(_,i)=>
     cmd("psql",[...args,"-c",roleSql(`select public.reserve_ai_usage(
     '${owner}','trial','${uuid()}')`)])
     .then(()=>true).catch(()=>false)));
   assert.equal(results.filter(Boolean).length,2);
   assert.equal(query(`select consumed+reserved from public.usage_periods where business_id='${owner}'`).output,"100");
 });
 await t.test("duplicate reservation keys never authorize two concurrent AI runs", async()=>{
   const owner=uuid(),key="same-request-"+uuid();
   seedOwner(owner);
   const cmd=promisify(execFile);
   const results=await Promise.all(Array.from({length:10},()=>
     cmd("psql",[...args,"-c",roleSql(`select public.reserve_ai_usage('${owner}','trial','${key}')`)])
       .then(()=>true).catch(()=>false)));
   assert.equal(results.filter(Boolean).length,1);
   assert.equal(query(`select consumed+reserved from public.usage_periods
     where business_id='${owner}' and period_key='trial'`).output,"1");
 });
 await t.test("incomplete confirmed bookings are rejected",()=>{
   const owner=uuid();seedOwner(owner);
   assert.equal(query(roleSql(`insert into public.bookings(business_id,status)
      values('${owner}','confirmed')`),true).ok,false);
 });
 await t.test("exclusive confirmed booking ranges cannot overlap",()=>{
   const owner=uuid();seedOwner(owner);
   const a=uuid(),b=uuid(),service=uuid();
   query(roleSql(`insert into public.services(id,business_id,name,duration)
     values('${service}','${owner}','Haircut','60 mins')`));
   query(roleSql(`insert into public.bookings(id,business_id,service_id,service,booking_date,booking_time,status,starts_at,ends_at,resource_id)
     values('${a}','${owner}','${service}','Haircut',current_date+2,'14:00','confirmed',
       now()+interval '2 days',now()+interval '2 days 1 hour','chair1')`));
   assert.equal(query(roleSql(`insert into public.bookings(id,business_id,service_id,service,booking_date,booking_time,status,starts_at,ends_at,resource_id)
     values('${b}','${owner}','${service}','Haircut',current_date+2,'14:30','confirmed',
       now()+interval '2 days 30 minutes',now()+interval '2 days 90 minutes','chair1')`),true).ok,false);
 });
});
