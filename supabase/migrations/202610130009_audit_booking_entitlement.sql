-- Audit repair 009: remove stale paid-status authority and reject unsafe booking confirmations.
-- Depends on migrations 000..008, preserving existing records.
begin;
-- Legacy policies from supabase/staff_access.sql are still present on upgraded
-- databases. They use payment_status='active' rather than paid-period dates.
drop policy if exists "Paid plans only for booking management" on public.bookings;
drop policy if exists "Business owners can delete bookings" on public.bookings;
drop policy if exists "Staff can delete business bookings" on public.bookings;
drop policy if exists "Business owners can update bookings" on public.bookings;
drop policy if exists "Staff can update business bookings" on public.bookings;
drop policy if exists "Business owners can read bookings" on public.bookings;
drop policy if exists "Staff can read business bookings" on public.bookings;
drop policy if exists "Verified staff update bookings" on public.bookings;
drop policy if exists "Verified staff read bookings" on public.bookings;
drop policy if exists "Ezeji bookings owner" on public.bookings;
drop policy if exists "Ezeji restrictive booking tenant" on public.bookings;

-- Read and update require *current* paid entitlement, not a legacy profile
-- status. The authenticated member ID is checked inside is_business_staff().
create policy "Ezeji current bookings read" on public.bookings
 for select to authenticated
 using (
  (business_id=auth.uid() and public.has_current_paid_entitlement(business_id)
   and exists(select 1 from public.subscriptions s
     where s.business_id=bookings.business_id and s.plan in('Professional','Business')))
  or public.is_business_staff(business_id)
 );
create policy "Ezeji current bookings update" on public.bookings
 for update to authenticated
 using (
  (business_id=auth.uid() and public.has_current_paid_entitlement(business_id)
   and exists(select 1 from public.subscriptions s
     where s.business_id=bookings.business_id and s.plan in('Professional','Business')))
  or public.is_business_staff(business_id)
 )
 with check (
  (business_id=auth.uid() and public.has_current_paid_entitlement(business_id)
   and exists(select 1 from public.subscriptions s
     where s.business_id=bookings.business_id and s.plan in('Professional','Business')))
  or public.is_business_staff(business_id)
 );
-- A restrictive guard also constrains any unknown permissive legacy policy.
create policy "Ezeji current booking tenant guard" on public.bookings
 as restrictive for all to authenticated
 using (
  (business_id=auth.uid() and public.has_current_paid_entitlement(business_id)
   and exists(select 1 from public.subscriptions s
     where s.business_id=bookings.business_id and s.plan in('Professional','Business')))
  or public.is_business_staff(business_id)
 )
 with check (
  (business_id=auth.uid() and public.has_current_paid_entitlement(business_id)
   and exists(select 1 from public.subscriptions s
     where s.business_id=bookings.business_id and s.plan in('Professional','Business')))
  or public.is_business_staff(business_id)
 );

revoke insert,delete on public.bookings from anon,authenticated;
revoke update on public.bookings from anon,authenticated;
grant select on public.bookings to authenticated;
grant update(status) on public.bookings to authenticated;

-- New appointments must have complete, bounded start/end intervals to become
-- confirmed. Historical incomplete bookings remain pending until corrected.
create or replace function public.enforce_booking_transitions()
returns trigger language plpgsql set search_path=pg_catalog,public
as $function$
begin
 if tg_op='UPDATE' and (new.business_id is distinct from old.business_id or
    new.client_request_id is distinct from old.client_request_id) then
   raise exception 'Booking ownership/idempotency cannot be changed' using errcode='42501';
 end if;
 if new.status='confirmed' then
   if new.starts_at is null or new.ends_at is null or new.service_id is null
      or new.ends_at<=new.starts_at or new.booking_date is null
      or nullif(trim(new.booking_time),'') is null then
     raise exception 'Booking cannot be confirmed without a complete time and service' using errcode='23514';
   end if;
 end if;
 if tg_op='UPDATE' and new.status is distinct from old.status then
   if not (
     old.status='pending' and new.status in('confirmed','rejected','canceled')
     or old.status='confirmed' and new.status in('completed','canceled','no_show')
     or old.status='canceled' and new.status='pending'
   ) then
      raise exception 'Invalid booking status transition' using errcode='23514';
   end if;
   if new.status='confirmed' and auth.role()<>'service_role' then
     new.confirmed_by:=auth.uid();
   end if;
   new.last_transition_at:=now();
 end if;
 new.updated_at:=now();
 return new;
end;
$function$;
drop trigger if exists booking_status_transition_guard on public.bookings;
create trigger booking_status_transition_guard
 before insert or update on public.bookings for each row
 execute function public.enforce_booking_transitions();

-- Ensure no legacy paid plan helper can authorize a new endpoint based on a
-- stale profiles.payment_status value.
create or replace function public.has_active_premium_plan(p_business_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $function$
 select public.has_current_paid_entitlement(p_business_id)
 and exists(select 1 from public.subscriptions s where s.business_id=p_business_id
  and s.plan in ('Professional','Business'));
$function$;
revoke all on function public.has_active_premium_plan(uuid) from public,anon;
grant execute on function public.has_active_premium_plan(uuid) to authenticated,service_role;
commit;
