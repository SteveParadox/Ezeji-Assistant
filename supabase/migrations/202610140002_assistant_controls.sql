begin;
create function public.set_assistant_handoff(p_business_id uuid,p_thread_id uuid,p_actor_id uuid,p_status text)
returns text language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare t public.assistant_threads%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if p_actor_id<>p_business_id and not exists(select 1 from public.business_staff_memberships where business_id=p_business_id and user_id=p_actor_id and status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_actor_id<>p_business_id and not public.has_active_premium_plan(p_business_id) then raise exception 'Subscription expired' using errcode='42501'; end if;
 if p_status not in('human','automated','resolved') then raise exception 'Invalid status' using errcode='22023'; end if;
 select * into t from public.assistant_threads where id=p_thread_id and business_id=p_business_id and channel<>'preview' for update;
 if not found or t.status='opted_out' then raise exception 'Unavailable conversation' using errcode='42501'; end if;
 if exists(select 1 from public.assistant_requests where thread_id=t.id and status in('processing','generated')) then raise exception 'Reply in progress' using errcode='P0006'; end if;
 update public.assistant_threads set status=p_status,escalation_reason=case when p_status='human' then coalesce(escalation_reason,'Staff took control') else null end,updated_at=now() where id=t.id;
 return p_status;
end;
$fn$;
revoke all on function public.set_assistant_handoff(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_assistant_handoff(uuid,uuid,uuid,text) to service_role;

create function public.validate_assistant_knowledge_write()
returns trigger language plpgsql set search_path=pg_catalog,public
as $fn$
begin
 if tg_table_name='profiles' then
   if length(coalesce(new.business,''))>160 or length(coalesce(new.description,''))>2000 or
      length(coalesce(new.assistant_name,''))>80 or length(coalesce(new.greeting,''))>500 or length(coalesce(new.escalation_keywords,''))>500 or
      length(coalesce(new.booking_policy,''))>1500 or length(coalesce(new.cancellation_policy,''))>1500 or length(coalesce(new.refund_policy,''))>1500 or length(coalesce(new.language_preferences,''))>160 then
     raise exception 'Business knowledge exceeds allowed lengths' using errcode='23514';
   end if;
   if new.timezone not in(select name from pg_timezone_names) then raise exception 'Invalid business timezone' using errcode='23514'; end if;
   if new.tone is not null and new.tone not in('Friendly & warm','Professional','Playful','Concise') then raise exception 'Invalid assistant tone' using errcode='23514'; end if;
   if auth.role()<>'service_role' and new.plan not in('Professional','Business') and
      (new.assistant_name is distinct from old.assistant_name or new.tone is distinct from old.tone or new.greeting is distinct from old.greeting or new.escalation_keywords is distinct from old.escalation_keywords) then
     raise exception 'Custom personality requires a premium plan' using errcode='42501';
   end if;
 elsif tg_table_name='services' then
   if length(trim(new.name)) not between 1 and 160 or length(coalesce(new.price,''))>160 or length(coalesce(new.duration,''))>80 or length(coalesce(new.description,''))>600 then raise exception 'Invalid service fields' using errcode='23514'; end if;
 elsif tg_table_name='faqs' then
   if length(trim(new.question)) not between 1 and 300 or length(trim(new.answer)) not between 1 and 1000 then raise exception 'Invalid FAQ fields' using errcode='23514'; end if;
 end if;
 return new;
end;
$fn$;
create trigger validate_assistant_profile before update on public.profiles for each row execute function public.validate_assistant_knowledge_write();
create trigger validate_assistant_services before insert or update on public.services for each row execute function public.validate_assistant_knowledge_write();
create trigger validate_assistant_faqs before insert or update on public.faqs for each row execute function public.validate_assistant_knowledge_write();
create function public.assistant_schema_ready() returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select to_regclass('public.assistant_requests') is not null and to_regprocedure('public.commit_assistant_reply(uuid)') is not null;
$fn$;
revoke all on function public.assistant_schema_ready() from public,anon,authenticated;
grant execute on function public.assistant_schema_ready() to service_role;
commit;
