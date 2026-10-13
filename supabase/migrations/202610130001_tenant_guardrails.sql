-- Incremental security hardening for an existing Ezeji database.
-- IMPORTANT: Apply only after a staging backup and baseline schema verification.
begin;
do $guardrails$
begin
  if to_regclass('public.conversations') is not null then
    execute 'alter table public.conversations enable row level security';
    execute 'drop policy if exists "Customers can log conversations" on public.conversations';
    execute 'revoke insert, update, delete on public.conversations from anon, authenticated';
  end if;
  if to_regclass('public.payment_requests') is not null then
    execute 'alter table public.payment_requests enable row level security';
    execute 'drop policy if exists "Customers can update their payment requests" on public.payment_requests';
    execute 'revoke update, delete on public.payment_requests from anon, authenticated';
  end if;
  if to_regclass('public.channel_connections') is not null then
    execute 'alter table public.channel_connections enable row level security';
    execute 'revoke all on public.channel_connections from anon, authenticated';
  end if;
end $guardrails$;
commit;
