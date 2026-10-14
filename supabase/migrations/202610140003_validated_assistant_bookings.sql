-- Harden existing booking service, shared by web form and conversational channels.
begin;
alter function public.create_pending_booking(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text) rename to insert_pending_booking_validated_input;
revoke all on function public.insert_pending_booking_validated_input(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text) from public,anon,authenticated,service_role;
create function public.create_pending_booking(
 p_business_id uuid,p_customer_name text,p_customer_contact text,p_service_id uuid,p_start timestamptz,p_end timestamptz,
 p_timezone text,p_local_date date,p_local_time text,p_source text,p_request_id text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare p public.profiles%rowtype; s public.services%rowtype; d jsonb; local_start timestamp; local_end timestamp; duration_match text[]; mins integer; existing public.bookings%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 -- Repeat prior successful submissions even after clock advances, but only for identical authorized input.
 select * into existing from public.bookings where business_id=p_business_id and client_request_id=p_request_id;
 if found then
   if existing.customer_name is distinct from p_customer_name or existing.customer_contact is distinct from p_customer_contact or existing.service_id is distinct from p_service_id or existing.starts_at is distinct from p_start then raise exception 'Booking key payload changed' using errcode='23514'; end if;
   return existing.id;
 end if;
 select * into p from public.profiles where id=p_business_id for share;
 select * into s from public.services where id=p_service_id and business_id=p_business_id for share;
 if p.id is null or s.id is null or not p.assistant_active or not public.has_active_premium_plan(p_business_id) then raise exception 'Business not accepting booking requests' using errcode='42501'; end if;
 if p_timezone is distinct from p.timezone then raise exception 'Timezone changed; review request again' using errcode='23514'; end if;
 duration_match:=regexp_match(lower(trim(s.duration)),'^(\d{1,3})\s*(min|mins|minute|minutes|h|hr|hour|hours)$');
 if duration_match is null then raise exception 'Service duration is missing' using errcode='23514'; end if;
 mins:=duration_match[1]::integer*case when duration_match[2] in('h','hr','hour','hours') then 60 else 1 end;
 if mins not between 15 and 480 or p_end is distinct from p_start+make_interval(mins=>mins) then raise exception 'Service duration changed; review request again' using errcode='23514'; end if;
 local_start:=p_start at time zone p.timezone;local_end:=p_end at time zone p.timezone;
 if local_start::date is distinct from p_local_date or to_char(local_start,'HH24:MI') is distinct from p_local_time or local_start::date<>local_end::date then raise exception 'Invalid local appointment time' using errcode='23514'; end if;
 select row into d from jsonb_array_elements(coalesce(p.hours_json,'[]')) row where lower(row->>'day')=lower(trim(to_char(local_start,'Day'))) limit 1;
 if d is null or coalesce((d->>'closed')::boolean,true) or (d->>'open') !~ '^\d{2}:\d{2}$' or (d->>'close') !~ '^\d{2}:\d{2}$' or local_start::time<(d->>'open')::time or local_end::time>(d->>'close')::time then raise exception 'Requested time is outside saved business hours' using errcode='23514'; end if;
 -- This is only a request. No calendar/inventory availability is implied.
 return public.insert_pending_booking_validated_input(p_business_id,p_customer_name,p_customer_contact,p_service_id,p_start,p_end,p_timezone,p_local_date,p_local_time,p_source,p_request_id);
end;
$fn$;
revoke all on function public.create_pending_booking(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text) from public,anon,authenticated;
grant execute on function public.create_pending_booking(uuid,text,text,uuid,timestamptz,timestamptz,text,date,text,text,text) to service_role;
commit;
