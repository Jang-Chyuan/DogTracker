-- Review/run in the SAME project as dog_telemetry. Defaults preserve Wi-Fi.
create table if not exists public.master_upload_routes (
  master_id integer primary key check (master_id > 0),
  mode text not null check (mode in ('wifi','phone')),
  owner_user_id uuid references auth.users(id),
  phone_id uuid,
  check (mode = 'wifi' or (owner_user_id is not null and phone_id is not null))
);
alter table public.master_upload_routes enable row level security;
revoke all on public.master_upload_routes from anon, authenticated;
grant select on public.master_upload_routes to service_role;
insert into public.master_upload_routes(master_id,mode) values (5,'wifi'),(7,'wifi') on conflict do nothing;

alter table public.dog_telemetry add column if not exists upload_source text not null default 'wifi';
alter table public.dog_telemetry add column if not exists uploaded_by uuid;
alter table public.dog_telemetry add column if not exists phone_id uuid;
alter table public.dog_telemetry add column if not exists phone_received_at timestamptz;

-- Enforced on BOTH endpoints, including the existing Wi-Fi function. Provision
-- route rows before switching modes; revoke old device tokens if compromised.
create or replace function public.guard_telemetry_upload_route()
returns trigger language plpgsql security definer set search_path = '' as $$
declare route public.master_upload_routes%rowtype;
begin
  select * into route from public.master_upload_routes where master_id = new.master_id for share;
  if new.upload_source = 'wifi' then
    if found and route.mode <> 'wifi' then raise exception 'Wi-Fi upload disabled for Master' using errcode='42501'; end if;
    if new.uploaded_by is not null or new.phone_id is not null then raise exception 'Invalid Wi-Fi envelope'; end if;
  elsif new.upload_source = 'phone' then
    if route.mode is distinct from 'phone' or route.owner_user_id is distinct from new.uploaded_by
       or route.phone_id is distinct from new.phone_id then
      raise exception 'Phone not assigned to Master' using errcode='42501';
    end if;
    if not exists(select 1 from public.device_members m where m.user_id = new.uploaded_by
      and m.gateway_id = 'master_' || new.master_id::text) then
      raise exception 'Master access denied' using errcode='42501';
    end if;
  else raise exception 'Invalid upload source'; end if;
  return new;
end $$;
revoke all on function public.guard_telemetry_upload_route() from public;
drop trigger if exists enforce_telemetry_upload_route on public.dog_telemetry;
create trigger enforce_telemetry_upload_route before insert on public.dog_telemetry
for each row execute function public.guard_telemetry_upload_route();

-- Run as administrator AFTER reading this phone ID from App settings:
-- insert into public.master_upload_routes(master_id,mode,owner_user_id,phone_id)
-- values (7,'phone','USER_UUID','PHONE_UUID')
-- on conflict(master_id) do update set mode=excluded.mode,
-- owner_user_id=excluded.owner_user_id,phone_id=excluded.phone_id;
-- To return to Wi-Fi, first disable phone forwarding and resolve its queue:
-- update public.master_upload_routes set mode='wifi',owner_user_id=null,phone_id=null where master_id=7;
