-- Audit repair 012: serialize seat allocation across concurrent invitations.
begin;
create or replace function public.create_staff_invitation(
 p_business_id uuid,p_invited_by uuid,p_email text,
 p_role text,p_token_hash text
)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public
as $function$
declare
 p public.profiles%rowtype;
 seats integer;
 taken integer;
 invited uuid;
 normalized_email text;
begin
 if coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Trusted staff service required' using errcode='42501';
 end if;
 normalized_email:=lower(trim(coalesce(p_email,'')));
 if p_business_id is null or p_invited_by is distinct from p_business_id
   or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or length(normalized_email)>254 or p_role not in('agent','manager')
   or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid invitation parameters' using errcode='22023';
 end if;
 select * into p from public.profiles where id=p_business_id for update;
 if not found or not public.has_current_paid_entitlement(p_business_id)
   or p.plan not in ('Professional','Business') then
   raise exception 'Premium owner account required' using errcode='42501';
 end if;
 seats:=case when p.plan='Professional' then 3 else 2147483647 end;

 update public.business_staff_invitations
   set status='expired' where business_id=p_business_id
     and status='pending' and expires_at<=now();

 select count(*) into taken from (
   select id from public.business_staff_memberships
      where business_id=p_business_id and status='active'
   union all
   select id from public.business_staff_invitations
      where business_id=p_business_id and status='pending'
 ) a;
 if taken>=seats then raise exception 'Staff seat limit reached' using errcode='P0001'; end if;
 if exists(select 1 from public.business_staff_memberships
    where business_id=p_business_id and lower(invited_email)=normalized_email
      and status='active') then
   raise exception 'Staff member already active' using errcode='23505';
 end if;
 insert into public.business_staff_invitations(
  business_id,email,role,token_hash,invited_by)
 values(p_business_id,normalized_email,p_role,p_token_hash,p_invited_by)
 returning id into invited;
 return invited;
end;
$function$;
revoke all on function public.create_staff_invitation(uuid,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.create_staff_invitation(uuid,uuid,text,text,text)
 to service_role;
commit;
