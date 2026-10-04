-- Apply in the existing dog_telemetry/device_members project.
-- Slave IDs identify dogs globally. Members of the recorded Master share editing.
create table public.slave_fixed_locations (
  slave_id integer primary key check (slave_id between 1 and 255),
  master_id integer not null check (master_id between 1 and 65535),
  name text not null check (length(btrim(name)) between 1 and 80),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.slave_fixed_locations enable row level security;
revoke all on public.slave_fixed_locations from anon, authenticated;
grant select, insert, update on public.slave_fixed_locations to authenticated;

create policy fixed_locations_read on public.slave_fixed_locations
for select to authenticated using (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_fixed_locations.master_id::text)
);
create policy fixed_locations_insert on public.slave_fixed_locations
for insert to authenticated with check (
  updated_by = (select auth.uid()) and
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_fixed_locations.master_id::text)
);
create policy fixed_locations_update on public.slave_fixed_locations
for update to authenticated using (
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_fixed_locations.master_id::text)
) with check (
  updated_by = (select auth.uid()) and
  exists (select 1 from public.device_members m where m.user_id = (select auth.uid())
    and m.gateway_id = 'master_' || slave_fixed_locations.master_id::text)
);

create function public.stamp_fixed_location() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;
revoke all on function public.stamp_fixed_location() from public;
create trigger stamp_fixed_location before insert or update on public.slave_fixed_locations
for each row execute function public.stamp_fixed_location();
