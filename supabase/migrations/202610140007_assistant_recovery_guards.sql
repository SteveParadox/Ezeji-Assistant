-- Corrective audit: fence request attempts, prevent stale snapshots, finish rejected actions.
-- Additive to the published assistant migrations; deploy with API/worker update.
begin;
alter table public.assistant_threads add column revision uuid not null default gen_random_uuid();
create function public.advance_assistant_revision() returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin new.revision:=gen_random_uuid(); return new; end;$fn$;
create trigger assistant_revision before update on public.assistant_threads for each row execute function public.advance_assistant_revision();
-- Explicitly invalidate old unfenced signatures rather than silently accepting stale callbacks.
drop function public.claim_assistant_request(uuid,uuid,text,text,text,boolean,jsonb);
drop function public.checkpoint_assistant_reply(uuid,jsonb);
drop function public.fail_assistant_request(uuid,text);
-- Existing action keys remain valid through a separate durable session-key mapping.
alter table public.bookings add constraint booking_tenant_identity_unique unique(id,business_id);
create table public.assistant_booking_keys(
 business_id uuid not null references public.profiles(id) on delete cascade,
 session_request_hash text not null check(length(session_request_hash)=64),
 booking_id uuid not null references public.bookings(id) on delete cascade,
 primary key(business_id,session_request_hash),
 foreign key(booking_id,business_id) references public.bookings(id,business_id) on delete cascade
);
alter table public.assistant_booking_keys enable row level security;
revoke all on public.assistant_booking_keys from public,anon,authenticated;
grant select,insert on public.assistant_booking_keys to service_role;
insert into public.assistant_booking_keys(business_id,session_request_hash,booking_id)
 select b.business_id,encode(sha256(convert_to(t.channel||':'||t.identity_hash||':'||r.request_key,'UTF8')),'hex'),b.id
 from public.bookings b join public.assistant_requests r on b.business_id=r.business_id and b.client_request_id='assistant-booking:'||r.id::text
 join public.assistant_threads t on t.id=r.thread_id on conflict do nothing;

create or replace function public.claim_assistant_request(p_business_id uuid,p_thread_id uuid,p_request_key text,p_message text,p_message_hash text,p_needs_model boolean,p_metadata jsonb default '{}',p_expected_revision uuid default null)
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
 if p_expected_revision is null or t.revision is distinct from p_expected_revision then raise exception 'Conversation changed; reload its state' using errcode='P0007'; end if;
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
   update public.assistant_requests set status='processing',attempt=attempt+1,error_code=null,reservation_id=null,outcome=null,lease_until=now()+interval '3 minutes',updated_at=now() where id=r.id returning * into r;
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
create or replace function public.checkpoint_assistant_reply(p_request_id uuid,p_outcome jsonb,p_attempt integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if coalesce(jsonb_typeof(p_outcome->'reply'),'')<>'string' or length(p_outcome->>'reply') not between 1 and 8000 then raise exception 'Invalid reply' using errcode='22023'; end if;
 update public.assistant_requests set outcome=p_outcome,status='generated',updated_at=now() where id=p_request_id and attempt=p_attempt and status='processing' and lease_until>clock_timestamp();
 if found then return true; end if;
 return exists(select 1 from public.assistant_requests where id=p_request_id and attempt=p_attempt and status='generated' and outcome=p_outcome);
end;
$fn$;
create or replace function public.fail_assistant_request(p_request_id uuid,p_code text,p_attempt integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.assistant_requests%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 select * into r from public.assistant_requests where id=p_request_id for update;
 if r.attempt is distinct from p_attempt or r.status<>'processing' then return false; end if;
 if r.reservation_id is not null then perform public.finalize_ai_usage(r.reservation_id,false); end if;
 update public.assistant_requests set status='failed',error_code=left(p_code,80),updated_at=now() where id=r.id;
 return true;
end;
$fn$;
create or replace function public.commit_assistant_reply(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare r public.assistant_requests%rowtype; t public.assistant_threads%rowtype; msg text; wa public.whatsapp_events%rowtype; booking_id uuid; action jsonb; saved_status text; session_key text; prior_key text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 -- Lock thread before request, matching claim lock order.
 select th.* into t from public.assistant_threads th join public.assistant_requests req on req.thread_id=th.id where req.id=p_request_id for update of th;
 select * into r from public.assistant_requests where id=p_request_id for update;
 if r.status='committed' then return r.outcome; end if;
 if r.status<>'generated' or r.outcome is null then raise exception 'Reply not ready' using errcode='23514'; end if;
 if r.reservation_id is not null then
   if r.outcome->>'provider'='groq' then
     if not public.finalize_ai_usage(r.reservation_id,true) then raise exception 'Usage reservation was released' using errcode='23514'; end if;
   else perform public.finalize_ai_usage(r.reservation_id,false); end if;
 end if;
 if r.outcome ? 'bookingDraft' then update public.assistant_threads set booking_draft=nullif(r.outcome->'bookingDraft','null'::jsonb) where id=t.id; end if;
 if r.outcome->>'serviceId' is not null and exists(select 1 from public.services where id=(r.outcome->>'serviceId')::uuid and business_id=r.business_id) then update public.assistant_threads set service_context_id=(r.outcome->>'serviceId')::uuid where id=t.id; end if;
 if r.outcome ? 'bookingAction' then
   if t.channel='preview' then raise exception 'Preview cannot book' using errcode='42501'; end if;
   action:=r.outcome->'bookingAction';
   begin
     session_key:=encode(sha256(convert_to(t.channel||':'||t.identity_hash||':'||r.request_key,'UTF8')),'hex');
     select b.client_request_id into prior_key from public.assistant_booking_keys k join public.bookings b on b.id=k.booking_id and b.business_id=k.business_id where k.business_id=r.business_id and k.session_request_hash=session_key;
     booking_id:=public.create_pending_booking(r.business_id,action->>'name',action->>'contact',(action->>'serviceId')::uuid,(action->>'start')::timestamptz,(action->>'end')::timestamptz,action->>'timezone',(action->>'localDate')::date,action->>'localTime',t.channel||'_chat',
       coalesce(prior_key,'assistant-booking:'||session_key));
     insert into public.assistant_booking_keys(business_id,session_request_hash,booking_id) values(r.business_id,session_key,booking_id) on conflict do nothing;
     select status into saved_status from public.bookings where id=booking_id and business_id=r.business_id;
     update public.assistant_threads set latest_booking_id=booking_id where id=t.id;
     r.outcome:=(r.outcome-'bookingAction')||jsonb_build_object('bookingId',booking_id,'bookingStatus',saved_status,'reply','Booking request '||booking_id::text||' has status '||saved_status||'. '||case when saved_status='pending' then 'Staff must confirm; no appointment is reserved.' else 'This is the saved status of your earlier request.' end);
   exception when sqlstate '42501' or sqlstate '23514' or sqlstate '22023' or sqlstate 'P0002' or sqlstate '22007' or sqlstate '22P02' then
     -- Expected validation/entitlement failures are a durable unsuccessful action,
     -- not an indefinitely generated request occupying global capacity.
     r.outcome:=(r.outcome-'bookingAction')||jsonb_build_object('bookingStatus','failed','actionError','BOOKING_NOT_ACCEPTED','reply','The booking request could not be submitted because the details or business settings are no longer valid. Start a new booking request or contact staff. No appointment was created or confirmed.');
   end;
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

revoke all on function public.claim_assistant_request(uuid,uuid,text,text,text,boolean,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_assistant_request(uuid,uuid,text,text,text,boolean,jsonb,uuid) to service_role;
revoke all on function public.checkpoint_assistant_reply(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.checkpoint_assistant_reply(uuid,jsonb,integer) to service_role;
revoke all on function public.fail_assistant_request(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.fail_assistant_request(uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
