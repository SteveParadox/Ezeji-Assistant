-- A new, private checkout intent ledger. Do not use public.payment_requests:
-- that table serves customer transfer requests and allows user-submitted rows.
-- Run AFTER public.profiles and public.invoices exist and before deploying the
-- payment server. Take a staging backup and inspect legacy inconsistent invoices.
begin;

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text not null check (provider_reference ~ '^[A-Za-z0-9._-]{1,120}$'),
  provider_transaction_id text,
  plan text not null check (plan in ('Starter','Professional','Business')),
  billing_period text not null check (billing_period in ('monthly','yearly')),
  expected_amount bigint not null check (expected_amount > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  customer_email text not null check (length(trim(customer_email)) > 3),
  status text not null default 'pending'
    check (status in ('pending','initialized','initialization_failed','settled')),
  applied_to_subscription boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint payment_attempt_reference_unique unique (provider,provider_reference),
  constraint payment_attempt_settlement_complete check (
    (status = 'settled' and settled_at is not null) or
    (status <> 'settled' and settled_at is null and not applied_to_subscription)
  )
);

create index if not exists payment_attempts_business_order_idx
  on public.payment_attempts (business_id,created_at desc,id desc);
create unique index if not exists payment_attempt_provider_transaction_unique
  on public.payment_attempts (provider,provider_transaction_id)
  where provider_transaction_id is not null;
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from PUBLIC, anon, authenticated;
grant select,insert,update on public.payment_attempts to service_role;

-- Safety net for repositories that predate the unique constraint in invoices.
-- The documented baseline public.invoices.sql already defines this uniqueness.
create unique index if not exists invoice_provider_reference_unique_atomic
  on public.invoices (provider,provider_reference);

create or replace function public.settle_paystack_payment(
  p_reference text,
  p_amount bigint,
  p_currency text,
  p_customer_email text,
  p_provider_transaction_id text
)
returns table (outcome text, settled_business_id uuid, subscription_applied boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_locked_business uuid;
  v_invoice public.invoices%rowtype;
  v_newer_paid_exists boolean;
begin
  -- Even if someone accidentally grants EXECUTE later, reject direct clients.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Trusted settlement role required' using errcode = '42501';
  end if;
  if p_reference is null or p_reference !~ '^[A-Za-z0-9._-]{1,120}$' or
     p_amount is null or p_amount <= 0 or
     p_currency is distinct from 'NGN' or
     p_customer_email is null or length(trim(p_customer_email)) = 0 or
     p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
    raise exception 'Invalid verified payment fields' using errcode = '22023';
  end if;

  -- Serialize all deliveries of a reference across backend instances.
  select * into v_attempt
    from public.payment_attempts
   where provider = 'paystack' and provider_reference = p_reference
   for update;
  if not found then
    raise exception 'Payment attempt missing; reconcile with provider'
      using errcode = 'P0002';
  end if;

  -- The checkout intent, not user/webhook metadata, owns these immutable facts.
  if v_attempt.expected_amount <> p_amount
      or v_attempt.currency <> p_currency
      or lower(trim(v_attempt.customer_email)) <> lower(trim(p_customer_email))
      or (v_attempt.provider_transaction_id is not null and
          v_attempt.provider_transaction_id <> p_provider_transaction_id) then
    raise exception 'Provider payment conflicts with the stored checkout intent'
      using errcode = '23514';
  end if;

  -- Lock the business across different payment references. A late older
  -- payment is still invoiced but must never downgrade a newer paid plan.
  select id into v_locked_business from public.profiles
   where id = v_attempt.business_id for update;
  if not found then
    raise exception 'Business profile missing; retry after reconciliation'
      using errcode = 'P0002';
  end if;

  if v_attempt.status = 'settled' then
    select * into v_invoice from public.invoices
     where provider = 'paystack' and provider_reference = p_reference;
    if not found or v_invoice.status <> 'paid'
        or v_invoice.business_id <> v_attempt.business_id
        or v_invoice.plan <> v_attempt.plan
        or v_invoice.billing_period <> v_attempt.billing_period
        or v_invoice.amount <> v_attempt.expected_amount
        or v_invoice.currency <> v_attempt.currency then
      raise exception 'Previously settled payment requires manual reconciliation'
        using errcode = '23514';
    end if;
    return query select 'already_settled'::text,
      v_attempt.business_id, v_attempt.applied_to_subscription;
    return;
  end if;

  if v_attempt.status not in ('pending','initialized','initialization_failed') then
    raise exception 'Payment attempt is not eligible for settlement'
      using errcode = '23514';
  end if;

  -- Any failed insert or profile write aborts this entire RPC transaction.
  insert into public.invoices (
    business_id, provider,provider_reference,amount,currency,plan,
    billing_period,status,customer_email
  ) values (
    v_attempt.business_id,'paystack',v_attempt.provider_reference,
    v_attempt.expected_amount,v_attempt.currency,v_attempt.plan,
    v_attempt.billing_period,'paid',v_attempt.customer_email
  );

  select exists (
    select 1 from public.payment_attempts newer
     where newer.business_id = v_attempt.business_id
       and newer.status = 'settled'
       and (newer.created_at,newer.id) > (v_attempt.created_at,v_attempt.id)
  ) into v_newer_paid_exists;

  if not v_newer_paid_exists then
    update public.profiles
       set plan = v_attempt.plan,
           billing_period = v_attempt.billing_period,
           currency = v_attempt.currency,
           payment_status = 'active',
           trial_active = false,
           trial_ends_at = now()
     where id = v_attempt.business_id;
    if not found then
      raise exception 'Business activation failed' using errcode = 'P0002';
    end if;
  end if;

  update public.payment_attempts
     set status = 'settled',
         settled_at = now(),
         updated_at = now(),
         provider_transaction_id = p_provider_transaction_id,
         applied_to_subscription = not v_newer_paid_exists
   where id = v_attempt.id;

  return query select 'settled'::text,
    v_attempt.business_id, (not v_newer_paid_exists);
end;
$function$;

revoke all on function public.settle_paystack_payment(text,bigint,text,text,text)
  from PUBLIC, anon, authenticated;
grant execute on function public.settle_paystack_payment(text,bigint,text,text,text)
  to service_role;

commit;

-- Reconciliation: review and verify with Paystack before manually correcting.
-- SELECT p.id,p.plan,p.payment_status FROM public.profiles p
-- WHERE p.payment_status='active' AND NOT EXISTS
-- (SELECT 1 FROM public.invoices i WHERE i.business_id=p.id AND i.status='paid');
-- Do NOT generate synthetic invoices or deactivate accounts automatically.
