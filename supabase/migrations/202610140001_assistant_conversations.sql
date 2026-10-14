-- Durable channel-isolated assistant sessions, request replay and atomic reply/usage commit.
begin;
alter table public.profiles add column if not exists assistant_active boolean not null default true;
-- Preserve existing owner pause choices, then require activation for newly created businesses.
do $pause$ begin
 if exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='raw_user_meta_data') then
   execute 'update public.profiles p set assistant_active=false from auth.users u where u.id=p.id and u.raw_user_meta_data->>''assistant_live''=''false''';
 end if;
end;$pause$;
alter table public.profiles alter column assistant_active set default false;
alter table public.profiles add column if not exists booking_policy text;
alter table public.profiles add column if not exists cancellation_policy text;
alter table public.profiles add column if not exists refund_policy text;
alter table public.profiles add column if not exists language_preferences text;
alter table public.services add column if not exists description text;
grant update(booking_policy,cancellation_policy,refund_policy,language_preferences) on public.profiles to authenticated;

create table public.assistant_threads(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 channel text not null check(channel in('web','whatsapp','preview')),
 identity_hash text not null check(length(identity_hash)=64),
 status text not null default 'automated' check(status in('automated','human','resolved','opted_out')),
 escalation_reason text, booking_draft jsonb, service_context_id uuid, latest_booking_id uuid,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,channel,identity_hash), unique(id,business_id)
);
create table public.assistant_requests(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 thread_id uuid not null,
 request_key text not null check(length(request_key) between 12 and 120),
 message_hash text not null check(length(message_hash)=64),
 status text not null default 'processing' check(status in('processing','generated','committed','failed','review_required')),
 attempt integer not null default 1,
 reservation_id uuid references public.usage_reservations(id),
 outcome jsonb, error_code text,
 channel_metadata jsonb not null default '{}',
 lease_until timestamptz not null default now()+interval '3 minutes',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,thread_id,request_key), unique(id,business_id),
 foreign key(thread_id,business_id) references public.assistant_threads(id,business_id) on delete cascade
);
create table public.assistant_messages(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null, thread_id uuid not null, request_id uuid,
 sequence bigint generated always as identity,
 role text not null check(role in('user','assistant','staff')),
 content text not null check(length(content) between 1 and 8000),
 delivery_status text not null default 'stored' check(delivery_status in('stored','queued','accepted','sent','delivered','read','failed','review_required')),
 created_at timestamptz not null default now(),
 unique(request_id,role),
 foreign key(thread_id,business_id) references public.assistant_threads(id,business_id) on delete cascade,
 foreign key(request_id,business_id) references public.assistant_requests(id,business_id) on delete cascade
);
alter table public.conversations add column if not exists assistant_request_id uuid unique references public.assistant_requests(id) on delete cascade;
alter table public.conversations add column if not exists thread_id uuid references public.assistant_threads(id) on delete cascade;
alter table public.conversations add column if not exists channel text;
alter table public.whatsapp_events add column if not exists message_occurred_at timestamptz;
alter table public.whatsapp_outbound_messages add column if not exists assistant_request_id uuid unique references public.assistant_requests(id) on delete set null;
create index assistant_history on public.assistant_messages(thread_id,sequence desc);
create index assistant_requests_recovery on public.assistant_requests(status,lease_until) where status in('processing','generated');
create index assistant_threads_owner on public.assistant_threads(business_id,updated_at desc);

alter table public.assistant_threads enable row level security;
alter table public.assistant_requests enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_threads,public.assistant_requests,public.assistant_messages from public,anon,authenticated;
grant all on public.assistant_threads,public.assistant_requests,public.assistant_messages to service_role;
grant usage,select on sequence public.assistant_messages_sequence_seq to service_role;
-- Customers only access these resources through a server-validated 256-bit capability.
-- Preview is not customer activity and is never listed in the staff inbox.

create function public.resolve_assistant_thread(p_business_id uuid,p_channel text,p_identity_hash text)
returns public.assistant_threads language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare t public.assistant_threads%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if p_channel not in('web','whatsapp','preview') or length(p_identity_hash)<>64 then raise exception 'Invalid identity' using errcode='22023'; end if;
 insert into public.assistant_threads(business_id,channel,identity_hash,expires_at)
 values(p_business_id,p_channel,p_identity_hash,now()+case when p_channel='preview' then interval '1 day' else interval '30 days' end)
 on conflict(business_id,channel,identity_hash) do nothing;
 select * into t from public.assistant_threads where business_id=p_business_id and channel=p_channel and identity_hash=p_identity_hash for update;
 if t.expires_at<now() then
   if t.channel='whatsapp' and not exists(select 1 from public.assistant_requests where thread_id=t.id and status in('processing','generated')) then
     if t.status='opted_out' then
       delete from public.assistant_requests where thread_id=t.id;
       delete from public.assistant_messages where thread_id=t.id;
       update public.assistant_threads set expires_at=now()+interval '30 days',booking_draft=null,service_context_id=null where id=t.id returning * into t;
     else
       delete from public.assistant_threads where id=t.id;
       insert into public.assistant_threads(business_id,channel,identity_hash,expires_at) values(p_business_id,p_channel,p_identity_hash,now()+interval '30 days') returning * into t;
     end if;
   else raise exception 'Conversation expired; start a new session' using errcode='P0005'; end if;
 end if;
 return t;
end;
$fn$;

create function public.claim_assistant_request(p_business_id uuid,p_thread_id uuid,p_request_key text,p_message text,p_message_hash text,p_needs_model boolean,p_metadata jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare t public.assistant_threads%rowtype; r public.assistant_requests%rowtype; p public.profiles%rowtype; reservation uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if length(p_message) not between 1 and 2000 or length(p_request_key) not between 12 and 120 or length(p_message_hash)<>64 then raise exception 'Invalid request' using errcode='22023'; end if;
 -- Serializes a conversation, then the global concurrency budget (transactional, not process-local).
 select * into t from public.assistant_threads where id=p_thread_id and business_id=p_business_id for update;
 if not found or t.expires_at<now() then raise exception 'Session unavailable' using errcode='42501'; end if;
 select * into r from public.assistant_requests where thread_id=t.id and request_key=p_request_key;
 if found then
   if r.message_hash<>p_message_hash then raise exception 'Request key payload changed' using errcode='23514'; end if;
   if r.status<>'failed' then return jsonb_build_object('state',r.status,'request',to_jsonb(r)); end if;
   if exists(select 1 from public.assistant_requests where thread_id=t.id and created_at>r.created_at) then raise exception 'Stale retry after a newer message' using errcode='23514'; end if;
   if r.attempt>=3 then return jsonb_build_object('state','review_required','request',to_jsonb(r)); end if;
 end if;
 select * into p from public.profiles where id=p_business_id;
 if (t.channel<>'preview' and not p.assistant_active) or
    not ((p.plan='14-day trial' and p.trial_active and p.trial_ends_at>now()) or public.has_current_paid_entitlement(p.id)) then
   raise exception 'Assistant not available' using errcode='42501';
 end if;
 if t.status='resolved' then update public.assistant_threads set status='automated' where id=t.id; end if;
 if p_needs_model and t.status in('human','opted_out') then raise exception 'Automation is disabled for this conversation' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(741411);
 if exists(select 1 from public.assistant_requests where thread_id=t.id and status in('processing','generated')) then
   raise exception 'Conversation request in progress' using errcode='P0006';
 end if;
 if (select count(*) from public.assistant_requests where status in('processing','generated'))>=16 or
    (select count(*) from public.assistant_requests where business_id=p_business_id and status in('processing','generated'))>=2 then
   raise exception 'Assistant busy' using errcode='P0004';
 end if;
 if r.id is null then
   insert into public.assistant_requests(business_id,thread_id,request_key,message_hash,channel_metadata)
   values(p_business_id,t.id,p_request_key,p_message_hash,p_metadata) returning * into r;
 else
   update public.assistant_requests set status='processing',attempt=attempt+1,error_code=null,lease_until=now()+interval '3 minutes',updated_at=now() where id=r.id returning * into r;
 end if;
 if p_needs_model then
   reservation:=public.reserve_ai_usage(p.id,case when p.plan='14-day trial' then 'trial' else to_char(now() at time zone 'UTC','YYYY-MM') end,'assistant:'||r.id::text||':'||r.attempt::text);
   update public.assistant_requests set reservation_id=reservation where id=r.id returning * into r;
 else
   -- Apply the same durable tenant rate budget even to non-LLM handoff/status requests.
   insert into public.ai_request_rate_buckets(bucket_key,request_count)
   values('control:'||p.id::text||':'||to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'),1)
   on conflict(bucket_key) do update set request_count=public.ai_request_rate_buckets.request_count+1
   where public.ai_request_rate_buckets.request_count<20;
   if not found then raise exception 'Request rate exhausted' using errcode='P0004'; end if;
 end if;
 insert into public.assistant_messages(business_id,thread_id,request_id,role,content) values(p.id,t.id,r.id,'user',p_message) on conflict(request_id,role) do nothing;
 return jsonb_build_object('state','claimed','request',to_jsonb(r));
end;
$fn$;

create function public.checkpoint_assistant_reply(p_request_id uuid,p_outcome jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_outcome->'reply'),'')<>'string' or length(p_outcome->>'reply') not between 1 and 8000 then raise exception 'Invalid reply' using errcode='22023'; end if;
 update public.assistant_requests set outcome=p_outcome,status='generated',updated_at=now() where id=p_request_id and status='processing';
 if found then return true; end if;
 return exists(select 1 from public.assistant_requests where id=p_request_id and status='generated' and outcome=p_outcome);
end;
$fn$;
create function public.commit_assistant_reply(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.assistant_requests%rowtype; t public.assistant_threads%rowtype; msg text; wa public.whatsapp_events%rowtype; booking_id uuid; action jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 -- Lock thread before request, matching claim lock order.
 select th.* into t from public.assistant_threads th join public.assistant_requests req on req.thread_id=th.id where req.id=p_request_id for update of th;
 select * into r from public.assistant_requests where id=p_request_id for update;
 if r.status='committed' then return r.outcome; end if;
 if r.status<>'generated' or r.outcome is null then raise exception 'Reply not ready' using errcode='23514'; end if;
 if r.reservation_id is not null and not public.finalize_ai_usage(r.reservation_id,true) then raise exception 'Usage reservation was released' using errcode='23514'; end if;
 if r.outcome ? 'bookingDraft' then update public.assistant_threads set booking_draft=nullif(r.outcome->'bookingDraft','null'::jsonb) where id=t.id; end if;
 if r.outcome->>'serviceId' is not null and exists(select 1 from public.services where id=(r.outcome->>'serviceId')::uuid and business_id=r.business_id) then update public.assistant_threads set service_context_id=(r.outcome->>'serviceId')::uuid where id=t.id; end if;
 if r.outcome ? 'bookingAction' then
   if t.channel='preview' then raise exception 'Preview cannot book' using errcode='42501'; end if;
   action:=r.outcome->'bookingAction';
   booking_id:=public.create_pending_booking(r.business_id,action->>'name',action->>'contact',(action->>'serviceId')::uuid,(action->>'start')::timestamptz,(action->>'end')::timestamptz,action->>'timezone',(action->>'localDate')::date,action->>'localTime',t.channel||'_chat','assistant-booking:'||r.id::text);
   update public.assistant_threads set latest_booking_id=booking_id where id=t.id;
   r.outcome:=(r.outcome-'bookingAction')||jsonb_build_object('bookingId',booking_id,'bookingStatus','pending','reply','Booking request '||booking_id::text||' has been saved with pending status. Staff must confirm; no appointment is reserved.');
 end if;
 insert into public.assistant_messages(business_id,thread_id,request_id,role,content,delivery_status)
 values(r.business_id,r.thread_id,r.id,'assistant',r.outcome->>'reply',case when t.channel='whatsapp' and not coalesce((r.outcome->>'suppressDelivery')::boolean,false) then 'queued' else 'stored' end) on conflict(request_id,role) do nothing;
 if t.channel<>'preview' then
   select content into msg from public.assistant_messages where request_id=r.id and role='user';
   insert into public.conversations(business_id,customer_message,ai_reply,escalated,booking_intent,assistant_request_id,thread_id,channel)
   values(r.business_id,msg,r.outcome->>'reply',coalesce((r.outcome->>'escalated')::boolean,false),coalesce((r.outcome->>'bookingIntent')::boolean,false),r.id,r.thread_id,t.channel) on conflict(assistant_request_id) do nothing;
   if coalesce((r.outcome->>'escalated')::boolean,false) then
     update public.assistant_threads set status='human',escalation_reason=left(coalesce(r.outcome->>'escalationReason','Customer requested staff'),300) where id=t.id;
   end if;
   if r.outcome->>'conversationStatus'='opted_out' then update public.assistant_threads set status='opted_out' where id=t.id; end if;
   if r.outcome->>'conversationStatus'='automated' then update public.assistant_threads set status='automated',escalation_reason=null where id=t.id; end if;
 end if;
 if t.channel='whatsapp' and not coalesce((r.outcome->>'suppressDelivery')::boolean,false) then
   select * into wa from public.whatsapp_events where id=(r.channel_metadata->>'eventId')::uuid and business_id=r.business_id;
   if not found or wa.sender_phone is distinct from r.channel_metadata->>'recipient' then raise exception 'WhatsApp tenant mismatch' using errcode='42501'; end if;
   insert into public.whatsapp_outbound_messages(inbound_event_id,business_id,recipient_phone,reply_text,assistant_request_id)
   values(wa.id,r.business_id,wa.sender_phone,r.outcome->>'reply',r.id) on conflict(inbound_event_id) do nothing;
 end if;
 update public.assistant_threads set updated_at=now() where id=t.id;
 update public.assistant_requests set status='committed',outcome=r.outcome,updated_at=now() where id=r.id;
 return r.outcome;
end;
$fn$;
create function public.fail_assistant_request(p_request_id uuid,p_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.assistant_requests%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 select * into r from public.assistant_requests where id=p_request_id for update;
 if r.status<>'processing' then return false; end if;
 if r.reservation_id is not null then perform public.finalize_ai_usage(r.reservation_id,false); end if;
 update public.assistant_requests set status='failed',error_code=left(p_code,80),updated_at=now() where id=r.id;
 return true;
end;
$fn$;
-- Durable maintenance excludes pipeline reservations from the legacy blind expiry.
create or replace function public.expire_ai_reservations()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.usage_reservations%rowtype; n integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 for r in select * from public.usage_reservations ur where status='reserved' and expires_at<now()
 and not exists(select 1 from public.assistant_requests req where req.reservation_id=ur.id)
 order by expires_at limit 100 for update skip locked loop
   perform public.finalize_ai_usage(r.id,false); n:=n+1;
 end loop;
 return n;
end;
$fn$;
-- A crash during provider generation is ambiguous; never regenerate that request.
create function public.recover_abandoned_assistant_requests()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.assistant_requests%rowtype; n integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 for r in select * from public.assistant_requests where status='processing' and lease_until<now() order by lease_until limit 50 for update skip locked loop
   if r.reservation_id is not null then perform public.finalize_ai_usage(r.reservation_id,false); end if;
   update public.assistant_requests set status='review_required',error_code='generation_outcome_unknown',updated_at=now() where id=r.id;
   n:=n+1;
 end loop;
 return n;
end;
$fn$;
create function public.prune_assistant_data()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare n integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 -- Preserve the minimal opt-out identity, but expire its message content.
 delete from public.assistant_requests r using public.assistant_threads t where r.thread_id=t.id and t.status='opted_out' and r.created_at<now()-interval '30 days' and r.status not in('processing','generated');
 delete from public.assistant_threads t where status<>'opted_out' and expires_at<now() and not exists(select 1 from public.assistant_requests r where r.thread_id=t.id and status in('processing','generated'));
 get diagnostics n=row_count;
 delete from public.whatsapp_events where created_at<now()-interval '30 days' and status in('completed','dead','review_required');
 delete from public.conversations where created_at<now()-interval '30 days' and assistant_request_id is null;
 return n;
end;
$fn$;
-- Functions are service-only even in databases with permissive default grants.
do $grants$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in('resolve_assistant_thread','claim_assistant_request','checkpoint_assistant_reply','commit_assistant_reply','fail_assistant_request','recover_abandoned_assistant_requests','prune_assistant_data') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end;$grants$;
commit;
