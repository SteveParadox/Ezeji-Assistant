begin;
create table if not exists public.payment_refund_events(
 id uuid primary key default gen_random_uuid(),
 provider text not null default 'paystack',
 provider_reference text not null,
 refund_reference text not null,
 amount bigint not null check(amount>0),
 currency text not null,
 status text not null check(status in('processed','manual_review')),
 processed_at timestamptz not null default now(),
 unique(provider,refund_reference)
);
alter table public.payment_refund_events enable row level security;
revoke all on public.payment_refund_events from public,anon,authenticated;
grant select,insert,update on public.payment_refund_events to service_role;

create or replace function public.record_verified_paystack_refund(
 p_reference text,p_refund_reference text,p_amount bigint,p_currency text)
returns text language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare inv public.invoices%rowtype;
 s public.subscriptions%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Trusted refund processing required' using errcode='42501';
 end if;
 if p_reference is null or p_refund_reference is null
  or length(p_refund_reference)<5 or p_amount<=0 or p_currency<>'NGN' then
   raise exception 'Invalid verified refund fields' using errcode='22023';
 end if;
 select * into inv from public.invoices
  where provider='paystack' and provider_reference=p_reference for update;
 if not found then raise exception 'Original invoice unavailable' using errcode='P0002'; end if;
 if inv.currency<>p_currency or p_amount>inv.amount then
   raise exception 'Refund amount conflicts with original payment' using errcode='23514';
 end if;
 insert into public.payment_refund_events(provider,provider_reference,refund_reference,
   amount,currency,status)
 values('paystack',p_reference,p_refund_reference,p_amount,p_currency,
   case when p_amount=inv.amount then 'processed' else 'manual_review' end)
 on conflict(provider,refund_reference) do nothing;
 if p_amount<>inv.amount then return 'manual_review'; end if;
 if inv.status='refunded' then return 'already_refunded'; end if;
 if inv.status<>'paid' then
   raise exception 'Invoice cannot be refunded automatically' using errcode='23514';
 end if;
 update public.invoices set status='refunded' where id=inv.id;
 select * into s from public.subscriptions
   where business_id=inv.business_id for update;
 if s.id is not null and s.last_successful_invoice_id=inv.id then
   update public.subscriptions set status='suspended',updated_at=now()
    where id=s.id;
   update public.profiles set payment_status='refunded'
    where id=inv.business_id;
 end if;
 return 'refunded';
end;
$function$;
revoke all on function public.record_verified_paystack_refund(text,text,bigint,text)
 from public,anon,authenticated;
grant execute on function public.record_verified_paystack_refund(text,text,bigint,text)
 to service_role;
commit;
