begin;
create table if not exists public.business_staff_memberships(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'agent' check(role in('agent','manager')),
 status text not null default 'active' check(status in('active','revoked','disabled')),
 invited_email text not null,
 invited_by uuid not null references auth.users(id),
 invited_at timestamptz not null default now(),
 accepted_at timestamptz not null default now(),
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(business_id,user_id)
);
create table if not exists public.business_staff_invitations(
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.profiles(id) on delete cascade,
 email text not null,
 role text not null default 'agent' check(role in('agent','manager')),
 token_hash text not null unique,
 status text not null default 'pending' check(status in('pending','accepted','revoked','expired')),
 invited_by uuid not null references auth.users(id),
 expires_at timestamptz not null default(now()+interval '7 days'),
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 accepted_by uuid references auth.users(id)
);
create unique index if not exists staff_pending_business_email_unique
 on public.business_staff_invitations (business_id,lower(email))
 where status='pending';
create index if not exists staff_memberships_by_user
 on public.business_staff_memberships(user_id,status);
alter table public.business_staff_memberships enable row level security;
alter table public.business_staff_invitations enable row level security;
revoke all on public.business_staff_invitations from public,anon,authenticated;
revoke insert,update,delete on public.business_staff_memberships from public,anon,authenticated;
drop policy if exists "Staff can see their memberships" on public.business_staff_memberships;
create policy "Staff can see their memberships" on public.business_staff_memberships
 for select to authenticated using(user_id=auth.uid());

create or replace function public.is_business_staff(p_business_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public
as $function$
 select exists(select 1 from public.business_staff_memberships m
  where m.business_id=p_business_id and m.user_id=auth.uid()
    and m.status='active' and public.has_current_paid_entitlement(m.business_id)
    and exists(select 1 from public.subscriptions s where s.business_id=m.business_id
      and s.plan in('Professional','Business')));
$function$;
revoke all on function public.is_business_staff(uuid) from public,anon;
grant execute on function public.is_business_staff(uuid) to authenticated,service_role;

drop policy if exists "Verified staff read bookings" on public.bookings;
create policy "Verified staff read bookings" on public.bookings for select to authenticated
 using(public.is_business_staff(business_id));
drop policy if exists "Verified staff update bookings" on public.bookings;
create policy "Verified staff update bookings" on public.bookings for update to authenticated
 using(public.is_business_staff(business_id)) with check(public.is_business_staff(business_id));
drop policy if exists "Verified staff read conversations" on public.conversations;
create policy "Verified staff read conversations" on public.conversations for select to authenticated
 using(public.is_business_staff(business_id));
create or replace function public.accept_staff_invitation(
 p_token_hash text,p_user_id uuid,p_email text)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare invitation public.business_staff_invitations%rowtype;
 member_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then
   raise exception 'Privileged invitation acceptance required' using errcode='42501';
 end if;
 select * into invitation from public.business_staff_invitations
 where token_hash=p_token_hash for update;
 if not found then raise exception 'Invalid staff invitation' using errcode='22023'; end if;
 if invitation.status='accepted' and invitation.accepted_by=p_user_id then
   select id into member_id from public.business_staff_memberships
    where business_id=invitation.business_id and user_id=p_user_id and status='active';
   if member_id is not null then return member_id; end if;
 end if;
 if invitation.status<>'pending' or invitation.expires_at<=now() then
   raise exception 'Staff invitation has expired or been used' using errcode='22023';
 end if;
 if lower(trim(invitation.email))<>lower(trim(p_email)) then
   raise exception 'Invitation is not for this verified account' using errcode='42501';
 end if;
 insert into public.business_staff_memberships(
 business_id,user_id,role,status,invited_email,invited_by,invited_at,accepted_at)
 values(invitation.business_id,p_user_id,invitation.role,'active',
  invitation.email,invitation.invited_by,invitation.created_at,now())
 on conflict(business_id,user_id) do update set
 status='active',role=excluded.role,invited_email=excluded.invited_email,
 revoked_at=null,accepted_at=now(),updated_at=now()
 returning id into member_id;
 update public.business_staff_invitations set status='accepted',
 accepted_at=now(),accepted_by=p_user_id where id=invitation.id;
 return member_id;
end;
$function$;
revoke all on function public.accept_staff_invitation(text,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_staff_invitation(text,uuid,text) to service_role;

commit;
