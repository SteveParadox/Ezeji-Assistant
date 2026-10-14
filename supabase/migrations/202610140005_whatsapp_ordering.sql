begin;
-- Claim quickly under a DB advisory lock, then process outside the transaction.
-- At most one live inbound lease per verified sender/tenant/phone connection.
create or replace function public.claim_whatsapp_events(p_limit integer default 5)
returns setof public.whatsapp_events language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(741412);
 update public.whatsapp_events set status='dead',lease_until=null,last_error='Retry limit exhausted',updated_at=now() where status='processing' and attempts>=5 and lease_until<now();
 return query with candidate as (
  select ev.id from public.whatsapp_events ev
  where ((ev.status='queued' and ev.next_attempt_at<=now()) or (ev.status='processing' and ev.lease_until<now())) and ev.attempts<5
   and (ev.kind='delivery_status' or not exists(
     select 1 from public.whatsapp_events prev where prev.id<>ev.id and prev.kind='inbound' and prev.business_id=ev.business_id and prev.phone_number_id=ev.phone_number_id and prev.sender_phone=ev.sender_phone
      and ((prev.status='processing' and prev.lease_until>now()) or (prev.status in('queued','processing') and (coalesce(prev.message_occurred_at,prev.created_at),prev.created_at,prev.id)<(coalesce(ev.message_occurred_at,ev.created_at),ev.created_at,ev.id)))
   ))
  order by coalesce(ev.message_occurred_at,ev.created_at),ev.created_at limit least(greatest(p_limit,1),20) for update skip locked
 ) update public.whatsapp_events ev set status='processing',lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now() from candidate c where ev.id=c.id returning ev.*;
end;
$fn$;
commit;
