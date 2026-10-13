begin;
create table if not exists public.usage_periods(
 business_id uuid not null references public.profiles(id) on delete cascade,
 period_key text not null,
 consumed integer not null default 0 check(consumed>=0),
 reserved integer not null default 0 check(reserved>=0),
 updated_at timestamptz not null default now(),
 primary key(business_id,period_key)
);
create table if not exists public.usage_reservations(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 period_key text not null,
 idempotency_key text not null,
 status text not null default 'reserved' check(status in('reserved','consumed','released')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '5 minutes'),
 finalized_at timestamptz,
 unique(business_id,idempotency_key),
 foreign key(business_id,period_key) references public.usage_periods(business_id,period_key)
);
create index if not exists usage_reservations_due
 on public.usage_reservations(expires_at) where status='reserved';
alter table public.usage_periods enable row level security;
alter table public.usage_reservations enable row level security;
revoke all on public.usage_periods,public.usage_reservations from public,anon,authenticated;
grant select,insert,update on public.usage_periods,public.usage_reservations to service_role;

create or replace function public.reserve_ai_usage(
 p_business_id uuid,p_period_key text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare
 p public.profiles%rowtype;
 current_row public.usage_periods%rowtype;
 existing public.usage_reservations%rowtype;
 limit_count integer;
 new_id uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Usage reservations are server only' using errcode='42501';
 end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 12 and 120
    or p_period_key is null or length(p_period_key)>80 then
   raise exception 'Invalid idempotency or period key' using errcode='22023';
 end if;
 select * into p from public.profiles where id=p_business_id;
 if not found then raise exception 'Unknown business' using errcode='P0002'; end if;
 if p.plan='14-day trial' then
   if not p.trial_active or p.trial_ends_at is null or p.trial_ends_at<=now() then
     raise exception 'Trial has expired' using errcode='42501';
   end if;
   limit_count:=100;
   if p_period_key<>'trial' then raise exception 'Invalid trial quota period' using errcode='22023'; end if;
 else
   if not public.has_current_paid_entitlement(p_business_id) then
     raise exception 'Subscription has expired' using errcode='42501';
   end if;
   limit_count:=case p.plan when 'Starter' then 500 when 'Professional' then 2500
     when 'Business' then 2147483647 else 0 end;
   if p_period_key<>to_char(now() at time zone 'UTC','YYYY-MM') then
      raise exception 'Invalid paid quota period' using errcode='22023';
   end if;
 end if;
 if limit_count=0 then raise exception 'Unknown plan' using errcode='42501'; end if;
 insert into public.usage_periods(business_id,period_key)
 values(p_business_id,p_period_key) on conflict do nothing;
 select * into current_row from public.usage_periods
  where business_id=p_business_id and period_key=p_period_key for update;
 select * into existing from public.usage_reservations
  where business_id=p_business_id and idempotency_key=p_idempotency_key;
 if found then
   if existing.period_key<>p_period_key or existing.status='released' then
      raise exception 'Idempotency key cannot be reused for a new request' using errcode='23514';
   end if;
   return existing.id;
 end if;
 if current_row.consumed+current_row.reserved>=limit_count then
    raise exception 'AI quota exhausted' using errcode='P0001';
 end if;
 insert into public.usage_reservations(business_id,period_key,idempotency_key)
 values(p_business_id,p_period_key,p_idempotency_key) returning id into new_id;
 update public.usage_periods set reserved=reserved+1,updated_at=now()
  where business_id=p_business_id and period_key=p_period_key;
 return new_id;
end;
$function$;
revoke all on function public.reserve_ai_usage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,text,text) to service_role;

create or replace function public.finalize_ai_usage(p_reservation_id uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare r public.usage_reservations%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into r from public.usage_reservations where id=p_reservation_id for update;
 if not found then raise exception 'Reservation not found' using errcode='P0002'; end if;
 if r.status<>'reserved' then return r.status='consumed'; end if;
 update public.usage_periods set
 reserved=greatest(0,reserved-1),
 consumed=consumed+case when p_success then 1 else 0 end,
 updated_at=now()
 where business_id=r.business_id and period_key=r.period_key;
 update public.usage_reservations set
 status=case when p_success then 'consumed' else 'released' end,
 finalized_at=now() where id=r.id;
 return p_success;
end;
$function$;
revoke all on function public.finalize_ai_usage(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finalize_ai_usage(uuid,boolean) to service_role;

create or replace function public.expire_ai_reservations()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare r public.usage_reservations%rowtype;
 counter integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 for r in select * from public.usage_reservations
  where status='reserved' and expires_at<now()
  order by expires_at limit 100 for update skip locked
 loop
   update public.usage_periods set reserved=greatest(0,reserved-1),updated_at=now()
     where business_id=r.business_id and period_key=r.period_key;
   update public.usage_reservations set status='released',finalized_at=now() where id=r.id;
   counter:=counter+1;
 end loop;
 return counter;
end;
$function$;
revoke all on function public.expire_ai_reservations() from public,anon,authenticated;
grant execute on function public.expire_ai_reservations() to service_role;
commit;
