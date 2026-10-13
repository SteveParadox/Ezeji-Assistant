-- Repair 011: persist Meta receipts and apply status transitions monotonically.
begin;
alter table public.whatsapp_events add column if not exists receipt_message_id text;
alter table public.whatsapp_events add column if not exists receipt_status text;
alter table public.whatsapp_events add column if not exists receipt_occurred_at timestamptz;
create index if not exists whatsapp_receipts_by_message on public.whatsapp_events
 (business_id,receipt_message_id) where kind='delivery_status';

create or replace function public.apply_whatsapp_delivery_status(
 p_business_id uuid,p_message_id text,p_status text
)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare outbox public.whatsapp_outbound_messages%rowtype;
 from_rank integer;
 to_rank integer;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
  raise exception 'Trusted message worker required' using errcode='42501';
 end if;
 if p_message_id is null or length(trim(p_message_id))=0 or
    p_status not in ('sent','delivered','read','failed') then
  raise exception 'Invalid Meta status' using errcode='22023';
 end if;
 select * into outbox from public.whatsapp_outbound_messages
  where business_id=p_business_id and provider_message_id=p_message_id for update;
 if not found then return false; end if;
 -- Monotonicity: accepted -> sent -> delivered -> read, while a failed
 -- delivery cannot erase a previously confirmed delivery/read receipt.
 from_rank:=case outbox.status
   when 'queued' then 0 when 'sending' then 0 when 'accepted' then 1
   when 'sent' then 2 when 'failed' then 2
   when 'delivered' then 3 when 'read' then 4 else 5 end;
 to_rank:=case p_status
   when 'sent' then 2 when 'failed' then 2
   when 'delivered' then 3 when 'read' then 4 else 0 end;
 if to_rank>from_rank then
   update public.whatsapp_outbound_messages
    set status=p_status,updated_at=now() where id=outbox.id;
 end if;
 return true;
end;
$function$;
revoke all on function public.apply_whatsapp_delivery_status(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.apply_whatsapp_delivery_status(uuid,text,text)
 to service_role;
commit;
