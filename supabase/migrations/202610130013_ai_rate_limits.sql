-- Audit repair 013: PostgreSQL-atomic per-business and global request caps.
-- A rate cap mitigates provider abuse but is NOT a monetary/token budget.
begin;
create table if not exists public.ai_request_rate_buckets(
 bucket_key text primary key,
 request_count integer not null check(request_count>=0),
 created_at timestamptz not null default now()
);
alter table public.ai_request_rate_buckets enable row level security;
revoke all on public.ai_request_rate_buckets from public,anon,authenticated;
grant select,insert,update,delete on public.ai_request_rate_buckets to service_role;
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
 tenant_hits integer;
 global_hits integer;
 tenant_limit integer;
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
   -- Never hand an in-flight/completed reservation to another execution.
   -- The caller must await the original request or retrieve its stored reply.
   raise exception 'Duplicate AI request idempotency key' using errcode='P0003';
 end if;
 if current_row.consumed+current_row.reserved>=limit_count then
    raise exception 'AI quota exhausted' using errcode='P0001';
 end if;
 -- Reserve both the tenant and global request-rate budgets inside this
 -- same transaction. If either cap is reached, all increments roll back.
 tenant_limit:=case p.plan when '14-day trial' then 8
    when 'Starter' then 15 when 'Professional' then 35
    when 'Business' then 70 else 8 end;
 insert into public.ai_request_rate_buckets(bucket_key,request_count)
  values('tenant:'||p_business_id::text||':'||
    to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'),1)
 on conflict(bucket_key) do update
    set request_count=public.ai_request_rate_buckets.request_count+1
    where public.ai_request_rate_buckets.request_count<tenant_limit
 returning request_count into tenant_hits;
 if tenant_hits is null then
   raise exception 'Business AI request rate exhausted' using errcode='P0004';
 end if;
 insert into public.ai_request_rate_buckets(bucket_key,request_count)
  values('global:'||to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'),1)
 on conflict(bucket_key) do update
    set request_count=public.ai_request_rate_buckets.request_count+1
    where public.ai_request_rate_buckets.request_count<250
 returning request_count into global_hits;
 if global_hits is null then
   raise exception 'Global AI request rate exhausted' using errcode='P0004';
 end if;
 insert into public.usage_reservations(business_id,period_key,idempotency_key)
 values(p_business_id,p_period_key,p_idempotency_key) returning id into new_id;
 update public.usage_periods set reserved=reserved+1,updated_at=now()
  where business_id=p_business_id and period_key=p_period_key;
 return new_id;
end;
$function$;


revoke all on function public.reserve_ai_usage(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,text,text) to service_role;

create or replace function public.prune_ai_request_rate_buckets()
returns integer language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare n integer;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
   raise exception 'Service role required' using errcode='42501';
 end if;
 delete from public.ai_request_rate_buckets
   where created_at < now()-interval '48 hours';
 get diagnostics n=row_count;
 return n;
end;
$function$;
revoke all on function public.prune_ai_request_rate_buckets() from public,anon,authenticated;
grant execute on function public.prune_ai_request_rate_buckets() to service_role;
commit;
