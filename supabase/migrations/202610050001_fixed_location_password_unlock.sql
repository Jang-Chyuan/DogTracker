-- Only the password-verifying Edge Function may issue a short-lived grant.
create table public.fixed_location_unlocks (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slave_id integer not null check (slave_id between 1 and 255),
  master_id integer not null check (master_id between 1 and 65535),
  expires_at timestamptz not null default now() + interval '5 minutes',
  unique (user_id, slave_id)
);
alter table public.fixed_location_unlocks enable row level security;
revoke all on public.fixed_location_unlocks from public, anon, authenticated;
grant all on public.fixed_location_unlocks to service_role;

-- Keep existing read policies; direct writes can no longer bypass the lock.
revoke insert, update on public.slave_fixed_locations from authenticated;

create function public.save_unlocked_fixed_location(
  p_token uuid, p_slave_id integer, p_master_id integer, p_name text,
  p_latitude double precision, p_longitude double precision, p_enabled boolean
) returns public.slave_fixed_locations
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  saved public.slave_fixed_locations;
begin
  -- Serialize grant consumption and edits, including first inserts.
  perform pg_catalog.pg_advisory_xact_lock(74051, p_slave_id);
  if caller is null or not exists (
    select 1 from public.fixed_location_unlocks u
    where u.token = p_token and u.user_id = caller and u.slave_id = p_slave_id
      and u.master_id = p_master_id and u.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'Password unlock required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.device_members m
    where m.user_id = caller and m.gateway_id = 'master_' || p_master_id::text)
    or exists (select 1 from public.slave_fixed_locations f where f.slave_id = p_slave_id
      and not exists (select 1 from public.device_members m
        where m.user_id = caller and m.gateway_id = 'master_' || f.master_id::text)) then
    raise exception 'Master access denied' using errcode = '42501';
  end if;
  insert into public.slave_fixed_locations(slave_id, master_id, name, latitude, longitude, enabled, updated_by)
  values (p_slave_id, p_master_id, btrim(p_name), p_latitude, p_longitude, p_enabled, caller)
  on conflict (slave_id) do update set master_id = excluded.master_id, name = excluded.name,
    latitude = excluded.latitude, longitude = excluded.longitude, enabled = excluded.enabled
  returning * into saved;
  -- A save consumes the grant; retrying requires another password verification.
  delete from public.fixed_location_unlocks where token = p_token;
  return saved;
end;
$$;
revoke all on function public.save_unlocked_fixed_location(uuid, integer, integer, text, double precision, double precision, boolean) from public, anon;
grant execute on function public.save_unlocked_fixed_location(uuid, integer, integer, text, double precision, double precision, boolean) to authenticated;
