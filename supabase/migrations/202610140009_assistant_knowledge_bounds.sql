begin;
-- Validate only changed schedules. Do not rewrite or reject untouched legacy data
-- during authentication/payment/profile updates.
create function public.validate_assistant_schedule() returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
declare d jsonb; days text[]:='{}'; day text; opens text; closes text;
begin
 if new.hours_json is not distinct from old.hours_json or new.hours_json is null then return new; end if;
 if jsonb_typeof(new.hours_json)<>'array' then raise exception 'Weekly hours must be an array' using errcode='23514'; end if;
 if jsonb_array_length(new.hours_json)>7 or octet_length(new.hours_json::text)>4000 then raise exception 'Weekly hours exceed allowed size' using errcode='23514'; end if;
 for d in select * from jsonb_array_elements(new.hours_json) loop
   day:=d->>'day'; opens:=d->>'open';closes:=d->>'close';
   if jsonb_typeof(d)<>'object' or day is null or day not in('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') or day=any(days) or coalesce(jsonb_typeof(d->'closed'),'')<>'boolean' then raise exception 'Invalid or duplicate weekday' using errcode='23514'; end if;
   days:=array_append(days,day);
   if not (d->>'closed')::boolean and (opens is null or closes is null or opens !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or closes !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or opens>=closes) then raise exception 'Open weekdays require valid opening and closing times' using errcode='23514'; end if;
 end loop;
 return new;
end;
$fn$;
create trigger validate_assistant_schedule before update of hours_json on public.profiles for each row execute function public.validate_assistant_schedule();
create or replace function public.assistant_schema_ready() returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select to_regclass('public.assistant_message_history') is not null
 and to_regprocedure('public.claim_assistant_request(uuid,uuid,text,text,text,boolean,jsonb,uuid)') is not null
 and to_regprocedure('public.checkpoint_assistant_reply(uuid,jsonb,integer)') is not null
 and to_regprocedure('public.fail_assistant_request(uuid,text,integer)') is not null
 and to_regprocedure('public.claim_whatsapp_outbound(uuid,uuid,integer)') is not null
 and to_regprocedure('public.validate_assistant_schedule()') is not null;
$fn$;
notify pgrst,'reload schema';
commit;
