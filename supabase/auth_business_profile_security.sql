-- Apply after supabase/staff_access.sql. Non-destructive and repeatable.
-- Ezeji uses profiles.id = auth.users.id as the owner/business identity.
-- Backend business creation uses the service role, never the browser.
begin;

alter table public.profiles enable row level security;

drop policy if exists "Ezeji owner profile read" on public.profiles;
create policy "Ezeji owner profile read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Ezeji owner profile write" on public.profiles;
create policy "Ezeji owner profile write" on public.profiles
  as restrictive for update to public
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Ezeji owner profile update grant" on public.profiles;
create policy "Ezeji owner profile update grant" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Ezeji owner profile create" on public.profiles;
create policy "Ezeji owner profile create" on public.profiles
  as restrictive for insert to public
  with check (id = (select auth.uid()));

-- Sensitive fields are controlled by service-role payment and provisioning
-- operations, not by client requests. Preserve existing subscribed profiles.
create or replace function public.protect_paid_plan_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
begin
  -- SECURITY DEFINER changes current_user to function owner. Never trust it.
  -- Only verified service-role JWTs may change billing fields.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan := '14-day trial';
    new.payment_status := 'trial';
    new.trial_active := true;
    new.trial_ends_at := now() + interval '14 days';
    new.billing_period := 'monthly';
    new.currency := 'NGN';
  else
    new.plan := old.plan;
    new.payment_status := old.payment_status;
    new.trial_active := old.trial_active;
    new.trial_ends_at := old.trial_ends_at;
    new.billing_period := old.billing_period;
    new.currency := old.currency;
  end if;
  return new;
end
$function$;

revoke all on function public.protect_paid_plan_fields() from public;
drop trigger if exists protect_paid_plan_fields on public.profiles;
create trigger protect_paid_plan_fields
  before insert or update on public.profiles
  for each row execute function public.protect_paid_plan_fields();

commit;

-- Before deployment, inspect existing public.profiles SELECT policies to
-- ensure only deliberately public business fields are exposed to anonymous
-- users. Current public-chat functionality needs limited public profile
-- fields, so this migration intentionally does not delete unknown policies.
-- This migration assumes profiles.id is already a unique owner UUID.
