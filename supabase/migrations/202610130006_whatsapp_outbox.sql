begin;
create table if not exists public.whatsapp_events(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 provider_event_id text not null unique,
 phone_number_id text not null,
 sender_phone text,
 customer_text text,
 kind text not null default 'inbound' check(kind in('inbound','delivery_status')),
 status text not null default 'queued'
   check(status in('queued','processing','completed','dead','review_required')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 last_error text,
 provider_outbound_message_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.whatsapp_outbound_messages(
 id uuid primary key default gen_random_uuid(),
 inbound_event_id uuid not null unique references public.whatsapp_events(id) on delete cascade,
 business_id uuid not null references public.profiles(id) on delete cascade,
 recipient_phone text not null,
 reply_text text not null,
 provider_message_id text unique,
 status text not null default 'queued'
 check(status in('queued','sending','accepted','sent','delivered','read','failed','review_required')),
 failure_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists whatsapp_event_claim_due_idx
 on public.whatsapp_events(next_attempt_at,created_at)
 where status in('queued','processing');
create index if not exists whatsapp_outbound_business_idx
 on public.whatsapp_outbound_messages(business_id,created_at desc);
alter table public.whatsapp_events enable row level security;
alter table public.whatsapp_outbound_messages enable row level security;
revoke all on public.whatsapp_events,public.whatsapp_outbound_messages from public,anon,authenticated;
grant select,insert,update on public.whatsapp_events,public.whatsapp_outbound_messages to service_role;

create or replace function public.claim_whatsapp_events(p_limit integer default 5)
returns setof public.whatsapp_events language plpgsql security definer
set search_path=pg_catalog,public
as $function$
begin
 if coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Only the worker can claim messages' using errcode='42501';
 end if;
 update public.whatsapp_events
   set status='dead',lease_until=null,last_error='Retry limit exhausted',
     updated_at=now()
   where status='processing' and attempts>=5 and lease_until<now();
 return query
 with candidate as (
   select id from public.whatsapp_events
   where ((status='queued' and next_attempt_at<=now()) or
       (status='processing' and lease_until<now()))
     and attempts<5
   order by created_at
   limit least(greatest(p_limit,1),20)
   for update skip locked
 )
 update public.whatsapp_events ev
 set status='processing',lease_until=now()+interval '90 seconds',
     attempts=attempts+1,updated_at=now()
 from candidate c where ev.id=c.id returning ev.*;
end;
$function$;
revoke all on function public.claim_whatsapp_events(integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_events(integer) to service_role;
commit;
