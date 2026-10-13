-- Canonicalize the prior P0 ledger; preserve its records and references.
-- All new and legacy checkout logic must use public.checkout_attempts.
begin;
do $migrate$
begin
 if to_regclass('public.checkout_attempts') is null
    and to_regclass('public.payment_attempts') is not null then
   alter table public.payment_attempts rename to checkout_attempts;
 elsif to_regclass('public.checkout_attempts') is not null
    and to_regclass('public.payment_attempts') is not null then
   raise exception 'Two payment ledgers exist: reconcile before migration';
 end if;
end $migrate$;
alter table public.checkout_attempts add column if not exists user_id uuid;
alter table public.checkout_attempts add column if not exists provider_initialized_at timestamptz;
alter table public.checkout_attempts add column if not exists expires_at timestamptz;
alter table public.checkout_attempts add column if not exists paid_at timestamptz;
alter table public.checkout_attempts add column if not exists failure_reason text;
alter table public.checkout_attempts add column if not exists reconciliation_attempts integer not null default 0;
alter table public.checkout_attempts add column if not exists last_reconciliation_at timestamptz;
alter table public.checkout_attempts add column if not exists next_reconciliation_at timestamptz;
update public.checkout_attempts set expires_at = created_at + interval '24 hours'
 where expires_at is null;
alter table public.checkout_attempts alter column expires_at set default (now() + interval '24 hours');
alter table public.checkout_attempts alter column user_id set default auth.uid();
alter table public.checkout_attempts drop constraint if exists payment_attempts_status_check;
alter table public.checkout_attempts drop constraint if exists checkout_attempts_status_check;
alter table public.checkout_attempts add constraint checkout_attempts_status_check
 check(status in ('pending','initialized','initialization_failed','settled','failed','expired','review_required'));
create index if not exists checkout_attempts_reconciliation_due_idx
 on public.checkout_attempts(next_reconciliation_at,created_at)
 where status in ('pending','initialized','initialization_failed','review_required');
alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from public,anon,authenticated;
grant select,insert,update on public.checkout_attempts to service_role;

create table if not exists public.subscriptions(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null unique references public.profiles(id) on delete restrict,
 plan text not null check(plan in('Starter','Professional','Business')),
 billing_period text not null check(billing_period in('monthly','yearly')),
 status text not null default 'active' check(status in
   ('trialing','active','past_due','grace','cancellation_scheduled','canceled','expired','suspended')),
 provider text not null default 'paystack',
 provider_subscription_code text,
 provider_customer_code text,
 activated_at timestamptz not null,
 current_period_start timestamptz not null,
 current_period_end timestamptz not null,
 next_renewal_at timestamptz,
 cancel_at_period_end boolean not null default false,
 canceled_at timestamptz,
 expired_at timestamptz,
 last_payment_at timestamptz,
 last_successful_invoice_id uuid references public.invoices(id),
 renewal_failure_count integer not null default 0,
 last_renewal_failure_at timestamptz,
 grace_period_ends_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint subscription_period_valid check(current_period_end>current_period_start)
);
create index if not exists subscriptions_expiring on public.subscriptions(current_period_end)
 where status in('active','cancellation_scheduled','grace');
alter table public.subscriptions enable row level security;
drop policy if exists "Owners read their own subscription" on public.subscriptions;
create policy "Owners read their own subscription" on public.subscriptions
 for select to authenticated using(business_id=auth.uid());
revoke insert,update,delete on public.subscriptions from anon,authenticated;
grant select,insert,update on public.subscriptions to service_role;

create or replace function public.has_current_paid_entitlement(p_business_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $function$
 select exists(
   select 1 from public.subscriptions s
   where s.business_id=p_business_id
     and (s.status in ('active','cancellation_scheduled')
          and s.current_period_end>now()
          or s.status='grace' and s.grace_period_ends_at>now())
     and s.canceled_at is null
 );
$function$;
revoke all on function public.has_current_paid_entitlement(uuid) from public,anon;
grant execute on function public.has_current_paid_entitlement(uuid) to authenticated,service_role;

-- Replace previous transaction, upgrading it rather than adding a second
-- settlement authority. A provider-verified paid timestamp is required.
create or replace function public.settle_paystack_payment(
  p_reference text, p_amount bigint, p_currency text,
  p_customer_email text, p_provider_transaction_id text,
  p_paid_at timestamptz
)
returns table(outcome text,settled_business_id uuid,subscription_applied boolean)
language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 a public.checkout_attempts%rowtype;
 s public.subscriptions%rowtype;
 inv public.invoices%rowtype;
 profile_id uuid;
 newer_paid boolean;
 period_start timestamptz;
 period_end timestamptz;
 begin_at timestamptz;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
   raise exception 'Trusted settlement role required' using errcode='42501';
 end if;
 if p_reference is null or p_reference !~ '^[A-Za-z0-9._-]{1,120}$'
    or p_amount is null or p_amount <= 0 or p_currency <> 'NGN'
    or p_customer_email is null or length(trim(p_customer_email))=0
    or p_provider_transaction_id is null or length(trim(p_provider_transaction_id))=0
    or p_paid_at is null or p_paid_at > now() + interval '5 minutes' then
   raise exception 'Invalid verified payment fields' using errcode='22023';
 end if;
 select * into a from public.checkout_attempts
  where provider='paystack' and provider_reference=p_reference for update;
 if not found then
   raise exception 'Missing authorized checkout attempt' using errcode='P0002';
 end if;
 if a.expected_amount <> p_amount or a.currency <> p_currency
  or lower(trim(a.customer_email)) <> lower(trim(p_customer_email))
  or (a.provider_transaction_id is not null
      and a.provider_transaction_id <> p_provider_transaction_id) then
   raise exception 'Payment does not match authorized checkout' using errcode='23514';
 end if;
 select id into profile_id from public.profiles where id=a.business_id for update;
 if not found then raise exception 'Business missing' using errcode='P0002'; end if;

 if a.status='settled' then
   select * into inv from public.invoices
    where provider='paystack' and provider_reference=p_reference;
   if not found or inv.status<>'paid' or inv.business_id<>a.business_id
     or inv.amount<>a.expected_amount or inv.plan<>a.plan
     or inv.billing_period<>a.billing_period or inv.currency<>a.currency then
     raise exception 'Settlement requires manual reconciliation' using errcode='23514';
   end if;
   return query select 'already_settled'::text,a.business_id,a.applied_to_subscription;
   return;
 end if;
 if a.status in ('failed','review_required') then
   raise exception 'Payment requires reconciliation review' using errcode='23514';
 end if;
 if a.status not in ('pending','initialized','initialization_failed','expired') then
   raise exception 'Attempt is not eligible for settlement' using errcode='23514';
 end if;
 if p_paid_at > a.expires_at then
    update public.checkout_attempts set status='review_required',
      failure_reason='Payment completed after attempt expiry; requires refund or manual review',
      paid_at=p_paid_at,provider_transaction_id=p_provider_transaction_id,
      updated_at=now()
    where id=a.id;
    return query select 'review_required'::text,a.business_id,false;
    return;
 end if;

 insert into public.invoices(business_id,provider,provider_reference,amount,currency,
     plan,billing_period,status,customer_email)
 values(a.business_id,'paystack',a.provider_reference,a.expected_amount,
   a.currency,a.plan,a.billing_period,'paid',a.customer_email)
 returning * into inv;

 select exists(select 1 from public.checkout_attempts newer
   where newer.business_id=a.business_id and newer.status='settled'
     and (newer.created_at,newer.id)>(a.created_at,a.id)) into newer_paid;

 if not newer_paid then
   select * into s from public.subscriptions where business_id=a.business_id for update;
   begin_at := p_paid_at;
   -- A same-term renewal extends an existing paid period, without
   -- counting a replay as a new term or shortening already-paid access.
   if s.id is not null and s.plan=a.plan and s.billing_period=a.billing_period
      and s.status in('active','cancellation_scheduled','grace')
      and s.current_period_end>begin_at then
      period_start := s.current_period_end;
   else
      period_start := begin_at;
   end if;
   period_end := period_start + case when a.billing_period='yearly'
      then interval '1 year' else interval '1 month' end;
   insert into public.subscriptions(business_id,plan,billing_period,status,provider,
     activated_at,current_period_start,current_period_end,last_payment_at,
     last_successful_invoice_id,updated_at)
   values(a.business_id,a.plan,a.billing_period,
     case when period_end>now() then 'active' else 'expired' end,
     'paystack',coalesce(s.activated_at,begin_at),period_start,period_end,
     p_paid_at,inv.id,now())
   on conflict(business_id) do update set
      plan=excluded.plan,billing_period=excluded.billing_period,
      status=excluded.status,provider=excluded.provider,
      current_period_start=excluded.current_period_start,
      current_period_end=excluded.current_period_end,
      last_payment_at=excluded.last_payment_at,
      last_successful_invoice_id=excluded.last_successful_invoice_id,
      cancel_at_period_end=false,canceled_at=null,expired_at=null,
      renewal_failure_count=0,updated_at=now();
   update public.profiles set plan=a.plan,billing_period=a.billing_period,
     currency=a.currency,payment_status=
     case when period_end>now() then 'active' else 'expired' end,
     trial_active=false,trial_ends_at=now() where id=a.business_id;
 end if;
 update public.checkout_attempts set status='settled',paid_at=p_paid_at,
    settled_at=now(),provider_transaction_id=p_provider_transaction_id,
    applied_to_subscription=not newer_paid,updated_at=now()
  where id=a.id;
 return query select 'settled'::text,a.business_id,(not newer_paid);
end;
$function$;
revoke all on function public.settle_paystack_payment(text,bigint,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_paystack_payment(text,bigint,text,text,text,timestamptz) to service_role;
-- Remove legacy five-argument RPC so there is exactly one settlement path.
drop function if exists public.settle_paystack_payment(text,bigint,text,text,text);
create or replace function public.production_billing_ready()
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $function$
 select coalesce(auth.role(),'') = 'service_role'
   and to_regclass('public.checkout_attempts') is not null
   and to_regclass('public.subscriptions') is not null;
$function$;
revoke all on function public.production_billing_ready() from public,anon,authenticated;
grant execute on function public.production_billing_ready() to service_role;

-- A narrow DB operation for overdue terms. Authorization must independently
-- check period end, even if this scheduled transition has not yet executed.
create or replace function public.expire_paid_subscriptions()
returns integer language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare changed integer;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
   raise exception 'Only the scheduler service role may expire terms' using errcode='42501';
 end if;
 update public.subscriptions set status='expired',expired_at=now(),updated_at=now()
   where status in('active','cancellation_scheduled')
     and current_period_end<=now();
 get diagnostics changed = row_count;
 update public.profiles p set payment_status='expired'
   from public.subscriptions s where p.id=s.business_id
     and s.status='expired' and p.payment_status='active';
 return changed;
end;
$function$;
revoke all on function public.expire_paid_subscriptions() from public,anon,authenticated;
grant execute on function public.expire_paid_subscriptions() to service_role;


commit;
