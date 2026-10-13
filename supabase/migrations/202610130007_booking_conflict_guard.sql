begin;
alter table public.bookings add column if not exists business_timezone text not null default 'Africa/Lagos';
alter table public.bookings add column if not exists requested_by text not null default 'dashboard';
alter table public.bookings add column if not exists client_request_id text;
create unique index if not exists bookings_request_idempotency_idx on public.bookings(business_id,client_request_id) where client_request_id is not null;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists last_transition_at timestamptz not null default now();
-- Historical entries that have only a date and loosely formatted time remain
-- unchanged and unconfirmed by this migration. New requests provide UTC ranges.
alter table public.bookings drop constraint if exists bookings_date_window_valid;
alter table public.bookings add constraint bookings_date_window_valid
 check (starts_at is null or ends_at is null or (ends_at>starts_at and ends_at<=starts_at+interval '8 hours'));

-- Confirmed appointments with exclusive resources must not overlap. Bookings
-- with unassigned resources share the business default resource.
create extension if not exists btree_gist;
alter table public.bookings drop constraint if exists bookings_exclusive_confirmed_no_overlap;
alter table public.bookings add constraint bookings_exclusive_confirmed_no_overlap
 exclude using gist (
   business_id with =,
   (coalesce(resource_id,'default')) with =,
   tstzrange(starts_at,ends_at,'[)') with &&
 ) where (status='confirmed' and starts_at is not null and ends_at is not null);

-- Documented workflow transitions. A pending request may be rejected or
-- confirmed by an authorized dashboard actor. No silent resurrection.
create or replace function public.enforce_booking_transitions()
returns trigger language plpgsql set search_path=pg_catalog,public
as $function$
begin
 if tg_op='UPDATE' and new.status is distinct from old.status then
   if not (
     old.status='pending' and new.status in('confirmed','rejected','canceled')
     or old.status='confirmed' and new.status in('completed','canceled','no_show')
     or old.status='canceled' and new.status='pending'
   ) then
      raise exception 'Invalid booking status transition' using errcode='23514';
   end if;
   new.last_transition_at:=now();
 end if;
 new.updated_at:=now();
 return new;
end;
$function$;
drop trigger if exists booking_status_transition_guard on public.bookings;
create trigger booking_status_transition_guard before update on public.bookings
 for each row execute function public.enforce_booking_transitions();

create or replace function public.create_pending_booking(
 p_business_id uuid,p_customer_name text,p_customer_contact text,
 p_service_id uuid,p_start timestamptz,p_end timestamptz,
 p_timezone text,p_local_date date,p_local_time text,p_source text,p_request_id text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare saved uuid; svc public.services%rowtype; existing public.bookings%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Trusted booking server required' using errcode='42501';
 end if;
 if p_business_id is null or length(trim(coalesce(p_customer_name,''))) not between 2 and 120
    or length(trim(coalesce(p_customer_contact,''))) not between 5 and 160
    or p_start is null or p_end is null or p_end<=p_start
    or p_end>p_start+interval '8 hours'
    or p_start<now()+interval '5 minutes'
    or p_start>now()+interval '120 days'
    or length(coalesce(p_timezone,''))>80
    or p_request_id is null or length(p_request_id) not between 12 and 120 then
   raise exception 'Invalid booking request' using errcode='22023';
 end if;
 select * into svc from public.services
  where id=p_service_id and business_id=p_business_id;
 if not found then raise exception 'Service not found' using errcode='P0002'; end if;
 insert into public.bookings(business_id,customer_name,customer_contact,
    service,service_id,starts_at,ends_at,booking_date,booking_time,
    business_timezone,booking_source,requested_by,status,client_request_id)
 values(p_business_id,p_customer_name,p_customer_contact,svc.name,svc.id,
   p_start,p_end,p_local_date,p_local_time,p_timezone,
   p_source,p_source,'pending',p_request_id)
 on conflict do nothing returning id into saved;
 if saved is null then
   select * into existing from public.bookings where business_id=p_business_id
     and client_request_id=p_request_id;
   if not found or existing.customer_name<>p_customer_name
     or existing.customer_contact<>p_customer_contact
     or existing.service_id<>p_service_id or existing.starts_at<>p_start then
       raise exception 'Conflicting booking idempotency key' using errcode='23514';
   end if;
   return existing.id;
 end if;
 return saved;
end;
$function$;
revoke all on function public.create_pending_booking(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text)
 from public,anon,authenticated;
grant execute on function public.create_pending_booking(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text)
 to service_role;

-- Existing database staff and owner policies continue to determine who may
-- perform confirmation. The exclusion constraint is authoritative under races.
commit;
