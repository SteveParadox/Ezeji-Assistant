begin;
alter table public.usage_reservations add constraint usage_reservation_tenant_unique unique(id,business_id);
alter table public.assistant_requests add constraint assistant_usage_tenant_fk foreign key(reservation_id,business_id) references public.usage_reservations(id,business_id);
alter table public.conversations add constraint assistant_exchange_tenant_fk foreign key(thread_id,business_id) references public.assistant_threads(id,business_id) on delete cascade;
create function public.delete_assistant_thread(p_business_id uuid,p_thread_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 perform 1 from public.assistant_threads where id=p_thread_id and business_id=p_business_id and channel in('web','preview') for update;
 if not found then return false; end if;
 if exists(select 1 from public.assistant_requests where thread_id=p_thread_id and status in('processing','generated')) then raise exception 'Pending reply prevents deletion' using errcode='P0006'; end if;
 delete from public.assistant_threads where id=p_thread_id and business_id=p_business_id;
 return found;
end;
$fn$;
create function public.check_assistant_client_rate(p_client_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $fn$
declare n integer;
begin
 if coalesce(auth.role(),'')<>'service_role' or length(p_client_hash)<>64 then raise exception 'Server only' using errcode='42501'; end if;
 insert into public.ai_request_rate_buckets(bucket_key,request_count)
 values('client:'||p_client_hash||':'||to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'),1)
 on conflict(bucket_key) do update set request_count=public.ai_request_rate_buckets.request_count+1 where public.ai_request_rate_buckets.request_count<25 returning request_count into n;
 return n is not null;
end;
$fn$;
create function public.assistant_owner_metrics(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 return jsonb_build_object(
 'conversations',(select count(*) from public.assistant_threads where business_id=p_business_id and channel<>'preview'),
 'web',(select count(*) from public.assistant_threads where business_id=p_business_id and channel='web'),
 'whatsapp',(select count(*) from public.assistant_threads where business_id=p_business_id and channel='whatsapp'),
 'escalations',(select count(*) from public.assistant_threads where business_id=p_business_id and status='human'),
 'unresolved',(select count(*) from public.assistant_threads where business_id=p_business_id and channel<>'preview' and status in('automated','human')),
 'customerMessages',(select count(*) from public.assistant_messages m join public.assistant_threads t on t.id=m.thread_id where m.business_id=p_business_id and t.channel<>'preview' and m.role='user'),
 'aiReplies',(select count(*) from public.assistant_requests r join public.assistant_threads t on t.id=r.thread_id where r.business_id=p_business_id and t.channel<>'preview' and r.status='committed' and r.outcome->>'provider'='groq'),
 'pendingBookings',(select count(*) from public.bookings where business_id=p_business_id and status='pending'),
 'active',(select assistant_active from public.profiles where id=p_business_id),
 'retentionDays',30);
end;
$fn$;
-- Reflect delivery receipts in canonical message records too.
create function public.sync_assistant_delivery()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if new.assistant_request_id is not null and new.status<>old.status then
   update public.assistant_messages set delivery_status=case when new.status='sending' then 'queued' else new.status end where request_id=new.assistant_request_id and role='assistant';
 end if;
 return new;
end;
$fn$;
create trigger assistant_delivery_receipt after update on public.whatsapp_outbound_messages for each row execute function public.sync_assistant_delivery();
do $grant$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('delete_assistant_thread','check_assistant_client_rate','assistant_owner_metrics') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end;$grant$;
commit;
