begin;
-- Keep client request identities consistent across restoration and replay.
create view public.assistant_message_history with (security_invoker=true) as
 select m.id,m.business_id,m.thread_id,m.request_id,m.sequence,m.role,m.content,m.delivery_status,m.created_at,r.request_key
 from public.assistant_messages m left join public.assistant_requests r on r.id=m.request_id and r.business_id=m.business_id;
revoke all on public.assistant_message_history from public,anon,authenticated;
grant select on public.assistant_message_history to service_role;
commit;
