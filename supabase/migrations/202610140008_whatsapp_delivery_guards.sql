-- Fence outbound delivery against the event lease, consent and staff control.
begin;
alter table public.assistant_requests add column delivery_revision uuid;
-- Only the latest existing committed turn can match the current conversation snapshot.
update public.assistant_requests r set delivery_revision=t.revision from public.assistant_threads t
where r.thread_id=t.id and r.status='committed' and not exists(select 1 from public.assistant_requests newer where newer.thread_id=t.id and newer.status='committed' and newer.created_at>r.created_at);
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
 update public.assistant_requests set status='committed',outcome=r.outcome,delivery_revision=(select revision from public.assistant_threads where id=t.id),updated_at=now() where id=r.id;
 return r.outcome;
end;
$fn$;

create function public.claim_whatsapp_outbound(p_outbound_id uuid,p_event_id uuid,p_attempt integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare ev public.whatsapp_events%rowtype; o public.whatsapp_outbound_messages%rowtype; r public.assistant_requests%rowtype; t public.assistant_threads%rowtype; p public.profiles%rowtype; conn public.channel_connections%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 select * into ev from public.whatsapp_events where id=p_event_id for update;
 if not found or ev.status<>'processing' or ev.attempts is distinct from p_attempt or ev.lease_until is null or ev.lease_until<=clock_timestamp() then return jsonb_build_object('state','lease_lost'); end if;
 -- Renew under the same lease token before the bounded Meta request, without
 -- granting any older/replaced worker the ability to send.
 update public.whatsapp_events set lease_until=clock_timestamp()+interval '90 seconds' where id=ev.id;
 select * into o from public.whatsapp_outbound_messages where id=p_outbound_id and inbound_event_id=ev.id and business_id=ev.business_id and recipient_phone=ev.sender_phone;
 if not found then return jsonb_build_object('state','blocked'); end if;
 if o.status<>'queued' then return jsonb_build_object('state','already_claimed'); end if;
 select * into r from public.assistant_requests where id=o.assistant_request_id and business_id=ev.business_id;
 select * into t from public.assistant_threads where id=r.thread_id and business_id=ev.business_id for share;
 -- Match thread-before-outbox lock order used by commit/retention.
 select * into o from public.whatsapp_outbound_messages where id=p_outbound_id and inbound_event_id=ev.id and business_id=ev.business_id for update;
 if not found then return jsonb_build_object('state','blocked'); end if;
 if o.status<>'queued' then return jsonb_build_object('state','already_claimed'); end if;
 select * into p from public.profiles where id=ev.business_id for share;
 select * into conn from public.channel_connections where business_id=ev.business_id and channel='whatsapp' and phone_number_id=ev.phone_number_id for share;
 if r.status is distinct from 'committed' or t.id is null or r.delivery_revision is distinct from t.revision
   or not p.assistant_active or not public.has_active_premium_plan(ev.business_id)
   or ev.message_occurred_at is null or ev.message_occurred_at<=clock_timestamp()-interval '24 hours' or ev.message_occurred_at>clock_timestamp()+interval '5 minutes'
   or conn.id is null
   or (t.status='opted_out' and r.outcome->>'conversationStatus' is distinct from 'opted_out')
   or (t.status='human' and not coalesce((r.outcome->>'escalated')::boolean,false))
   or t.status='resolved' then
   update public.whatsapp_outbound_messages set status='failed',failure_reason='Delivery blocked by current consent, handoff, connection or entitlement',updated_at=clock_timestamp() where id=o.id;
   return jsonb_build_object('state','blocked');
 end if;
 update public.whatsapp_outbound_messages set status='sending',updated_at=clock_timestamp() where id=o.id;
 return jsonb_build_object('state','claimed','accessToken',conn.access_token);
end;
$fn$;
revoke all on function public.claim_whatsapp_outbound(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_outbound(uuid,uuid,integer) to service_role;
-- A readable permanent opt-out identity must not leak an expired cached booking draft.
create or replace function public.prune_assistant_data()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare n integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 delete from public.assistant_requests r using public.assistant_threads t where r.thread_id=t.id and t.status='opted_out' and r.created_at<clock_timestamp()-interval '30 days' and r.status not in('processing','generated');
 update public.assistant_threads t set booking_draft=null,service_context_id=null,latest_booking_id=null where status='opted_out' and expires_at<clock_timestamp() and (booking_draft is not null or service_context_id is not null or latest_booking_id is not null) and not exists(select 1 from public.assistant_requests r where r.thread_id=t.id and r.status in('processing','generated'));
 delete from public.assistant_threads t where status<>'opted_out' and expires_at<clock_timestamp() and not exists(select 1 from public.assistant_requests r where r.thread_id=t.id and r.status in('processing','generated'));
 get diagnostics n=row_count;
 delete from public.whatsapp_events where created_at<clock_timestamp()-interval '30 days' and status in('completed','dead','review_required');
 delete from public.conversations where created_at<clock_timestamp()-interval '30 days' and assistant_request_id is null;
 return n;
end;
$fn$;
-- Readiness must cover the corrected RPC contract, not merely the oldest tables.
create or replace function public.assistant_schema_ready() returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select to_regclass('public.assistant_message_history') is not null
 and to_regprocedure('public.claim_assistant_request(uuid,uuid,text,text,text,boolean,jsonb,uuid)') is not null
 and to_regprocedure('public.checkpoint_assistant_reply(uuid,jsonb,integer)') is not null
 and to_regprocedure('public.claim_whatsapp_outbound(uuid,uuid,integer)') is not null;
$fn$;
notify pgrst,'reload schema';
commit;
