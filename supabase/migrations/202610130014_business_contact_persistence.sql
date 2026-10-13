-- Audit repair 014: persist customer-facing contact fields previously only in React state.
begin;
alter table public.profiles add column if not exists contact_phone text;
alter table public.profiles add column if not exists public_contact_email text;
alter table public.profiles add column if not exists website text;
-- Auth email is NOT editable through this profile UI.
grant update(contact_phone,public_contact_email,website) on public.profiles to authenticated;
commit;
