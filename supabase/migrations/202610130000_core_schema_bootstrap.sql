-- Bootstrap baseline. Create only missing entities; retain legacy production records.
-- Inspect an existing database's column types and policies before first deployment.
begin;
create extension if not exists btree_gist;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  name text, business text, business_type text, custom_business_type text,
  service_name text, price text, hours text, description text,
  plan text not null default '14-day trial',
  payment_status text not null default 'trial',
  billing_period text not null default 'monthly', currency text not null default 'NGN',
  trial_active boolean not null default true,
  trial_ends_at timestamptz default (now()+ interval '14 days'),
  assistant_name text, tone text, greeting text, escalation_keywords text,
  hours_json jsonb, address text, city_state_zip text,
  disappearing_default boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.services(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  name text not null, price text, duration text,
  created_at timestamptz not null default now()
);
create table if not exists public.faqs(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  question text not null, answer text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.conversations(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  customer_message text, ai_reply text,
  escalated boolean not null default false,
  booking_intent boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.bookings(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  customer_name text, customer_contact text, service text,
  booking_date date, booking_time text, notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create table if not exists public.invoices(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete restrict,
 provider text not null check (provider in ('stripe','paystack','trial')),
 provider_reference text not null,
 amount bigint not null default 0,
 currency text not null default 'USD',
 plan text not null,
 billing_period text not null check (billing_period in ('monthly','yearly')),
 status text not null default 'paid' check (status in ('trial','paid','failed','refunded')),
 customer_email text,
 created_at timestamptz not null default now(),
 unique(provider,provider_reference)
);
create table if not exists public.payment_requests(
 id uuid primary key default gen_random_uuid(),
 customer_email text not null,
 customer_name text not null,
 business_name text not null,
 plan text not null,
 billing_period text not null check (billing_period in ('monthly','yearly')),
 amount bigint not null, currency text not null default 'NGN',
 transfer_reference text, status text not null default 'pending'
  check(status in('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table if not exists public.staff_members(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 email text not null, invited_at timestamptz not null default now()
);
create unique index if not exists staff_members_business_email_unique
 on public.staff_members(business_id,lower(email));
create table if not exists public.channel_connections(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null, phone_number_id text, access_token text,
  created_at timestamptz not null default now(),
  unique(business_id,channel)
);
create unique index if not exists channel_connection_phone_unique
 on public.channel_connections(phone_number_id) where phone_number_id is not null;

-- These are additive for older incomplete schemas. A conflicting existing
-- column type fails the migration rather than destroying customer data.
alter table public.profiles add column if not exists timezone text not null default 'Africa/Lagos';
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.bookings add column if not exists starts_at timestamptz;
alter table public.bookings add column if not exists ends_at timestamptz;
alter table public.bookings add column if not exists service_id uuid;
alter table public.bookings add column if not exists resource_id text;
alter table public.bookings add column if not exists booking_source text not null default 'dashboard';
alter table public.bookings add column if not exists confirmed_by uuid;
alter table public.bookings add column if not exists updated_at timestamptz not null default now();

create index if not exists conversations_by_business_time on public.conversations(business_id,created_at desc);
create index if not exists services_by_business on public.services(business_id);
create index if not exists faqs_by_business on public.faqs(business_id);
create index if not exists bookings_by_business on public.bookings(business_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.faqs enable row level security;
alter table public.bookings enable row level security;
alter table public.conversations enable row level security;
alter table public.channel_connections enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_requests enable row level security;
alter table public.staff_members enable row level security;

drop policy if exists "Ezeji owner profile read" on public.profiles;
create policy "Ezeji owner profile read" on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists "Ezeji profile public read" on public.profiles;
-- Public chat reads only specific fields in application code. Do not grant broad public select.
drop policy if exists "Ezeji services owner" on public.services;
create policy "Ezeji services owner" on public.services for all to authenticated
using (business_id=auth.uid()) with check(business_id=auth.uid());
drop policy if exists "Ezeji faqs owner" on public.faqs;
create policy "Ezeji faqs owner" on public.faqs for all to authenticated
using (business_id=auth.uid()) with check(business_id=auth.uid());
drop policy if exists "Ezeji conversations owner" on public.conversations;
create policy "Ezeji conversations owner" on public.conversations for select to authenticated
using (business_id=auth.uid());
drop policy if exists "Ezeji bookings owner" on public.bookings;
create policy "Ezeji bookings owner" on public.bookings for all to authenticated
using (business_id=auth.uid()) with check(business_id=auth.uid());

-- Previously deployed permissive legacy policies must be audited and revoked
-- before relying on these owner-only policies in production.
revoke all on public.channel_connections from anon,authenticated;
revoke all on public.staff_members from anon,authenticated;
drop policy if exists "Ezeji invoices owner" on public.invoices;
create policy "Ezeji invoices owner" on public.invoices for select to authenticated using(business_id=auth.uid());
revoke insert,update,delete on public.conversations from anon,authenticated;
-- Strict owner access: legacy permissive profile policies must not grant
-- tenant-wide updates. Only safe display fields are writable by clients.
drop policy if exists "Ezeji owner profile update" on public.profiles;
create policy "Ezeji owner profile update" on public.profiles
 for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "Ezeji restrictive profile tenant" on public.profiles;
create policy "Ezeji restrictive profile tenant" on public.profiles
 as restrictive for all to authenticated
 using(id=auth.uid()) with check(id=auth.uid());
revoke select,insert,update,delete on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (name,business,business_type,custom_business_type,
 service_name,price,hours,description,assistant_name,tone,greeting,
 escalation_keywords,hours_json,address,city_state_zip,
 disappearing_default,timezone,onboarding_completed_at,updated_at)
 on public.profiles to authenticated;

create or replace function public.protect_paid_plan_fields()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $function$
begin
 if auth.role()='service_role' then return new; end if;
 if tg_op='INSERT' then
   new.plan:='14-day trial';new.payment_status:='trial';
   new.trial_active:=true;new.trial_ends_at:=now()+interval '14 days';
   new.billing_period:='monthly';new.currency:='NGN';
 else
   new.plan:=old.plan;new.payment_status:=old.payment_status;
   new.trial_active:=old.trial_active;new.trial_ends_at:=old.trial_ends_at;
   new.billing_period:=old.billing_period;new.currency:=old.currency;
 end if;
 return new;
end;
$function$;
revoke all on function public.protect_paid_plan_fields() from public,anon,authenticated;
drop trigger if exists protect_paid_plan_fields on public.profiles;
create trigger protect_paid_plan_fields
 before insert or update on public.profiles
 for each row execute function public.protect_paid_plan_fields();

drop policy if exists "Ezeji services tenant guard" on public.services;
create policy "Ezeji services tenant guard" on public.services
 as restrictive for all to authenticated using(business_id=auth.uid())
 with check(business_id=auth.uid());
drop policy if exists "Ezeji FAQs tenant guard" on public.faqs;
create policy "Ezeji FAQs tenant guard" on public.faqs
 as restrictive for all to authenticated using(business_id=auth.uid())
 with check(business_id=auth.uid());
drop policy if exists "Ezeji invoices tenant guard" on public.invoices;
create policy "Ezeji invoices tenant guard" on public.invoices
 as restrictive for select to authenticated using(business_id=auth.uid());
revoke select,insert,update,delete on public.services,public.faqs from anon;
grant select,insert,update,delete on public.services,public.faqs to authenticated;
grant select on public.invoices to authenticated;
grant select on public.bookings,public.conversations to authenticated;
grant update on public.bookings to authenticated;
commit;
