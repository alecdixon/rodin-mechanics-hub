-- Apply once, before deploying Gear Ratio. No existing records/policies are changed.
-- Requires the existing public.dashboard_cars(id) table.
-- Access matches lib/userAccess.ts, including no car workspace access for Number 2.
-- If that email/assignment map changes, update these feature-specific functions too.
begin;

create table public.car_gear_ratio_config (
  car_id bigint primary key references public.dashboard_cars(id),
  selected_ratio text not null check (selected_ratio in ('STD', 'LONG', 'EXTRA_LONG')),
  version integer not null check (version > 0),
  updated_at timestamptz not null,
  updated_by uuid not null,
  updated_by_email text not null
);

create table public.car_gear_ratio_history (
  car_id bigint not null references public.dashboard_cars(id),
  version integer not null check (version > 0),
  previous_ratio text check (previous_ratio in ('STD', 'LONG', 'EXTRA_LONG')),
  selected_ratio text not null check (selected_ratio in ('STD', 'LONG', 'EXTRA_LONG')),
  updated_at timestamptz not null,
  updated_by uuid not null,
  updated_by_email text not null,
  primary key (car_id, version)
);

create table public.car_gear_ratio_acknowledgements (
  car_id bigint not null references public.car_gear_ratio_config(car_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_version integer not null check (acknowledged_version > 0),
  acknowledged_at timestamptz not null,
  primary key (car_id, user_id)
);

-- Resolve identity from the authenticated user, never from request parameters,
-- user-editable metadata or the application's user-email cookie.
create function public.gear_ratio_current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(trim(email)) from auth.users where id = auth.uid();
$$;

create function public.gear_ratio_is_chief() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.gear_ratio_current_email() = 'dan.crain@rodinmotorsport.com', false);
$$;

create function public.gear_ratio_can_view(p_car_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case public.gear_ratio_current_email()
    when 'dan.crain@rodinmotorsport.com' then true
    when 'jimmy@rodinmotorsport.com' then true
    when 'alec.dixon@rodinmotorsport.com' then true
    when 'guest@rodinmotorsport.com' then true
    when 'simon.crain@rodinmotorsport.com' then p_car_id = 1
    when 'olli.moss@rodinmotorsport.com' then p_car_id = 2
    when 'jack.carter@rodinmotorsport.com' then p_car_id = 3
    else false end, false);
$$;

create function public.gear_ratio_can_acknowledge(p_car_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case public.gear_ratio_current_email()
    when 'simon.crain@rodinmotorsport.com' then p_car_id = 1
    when 'olli.moss@rodinmotorsport.com' then p_car_id = 2
    when 'jack.carter@rodinmotorsport.com' then p_car_id = 3
    else false end, false);
$$;

alter table public.car_gear_ratio_config enable row level security;
alter table public.car_gear_ratio_history enable row level security;
alter table public.car_gear_ratio_acknowledgements enable row level security;

create policy gear_ratio_config_read on public.car_gear_ratio_config
  for select to authenticated using (public.gear_ratio_can_view(car_id));
create policy gear_ratio_history_read on public.car_gear_ratio_history
  for select to authenticated using (public.gear_ratio_is_chief());
create policy gear_ratio_acknowledgements_read on public.car_gear_ratio_acknowledgements
  for select to authenticated using (user_id = auth.uid() and public.gear_ratio_can_acknowledge(car_id));

-- All writes go through the narrow RPCs below, including acknowledgements.
-- Direct table writes cannot bypass versioning or falsify audit identity.
revoke all on public.car_gear_ratio_config, public.car_gear_ratio_history,
  public.car_gear_ratio_acknowledgements from public, anon, authenticated;
grant select on public.car_gear_ratio_config, public.car_gear_ratio_history,
  public.car_gear_ratio_acknowledgements to authenticated;

create function public.set_car_gear_ratio(
  p_car_id bigint, p_ratio text, p_expected_version integer
) returns public.car_gear_ratio_config
language plpgsql security definer set search_path = '' as $$
declare
  current_config public.car_gear_ratio_config;
  saved_config public.car_gear_ratio_config;
begin
  if not public.gear_ratio_is_chief() then
    raise exception 'Only the Chief Mechanic can change gear ratios' using errcode = '42501';
  end if;
  if p_ratio is null or p_ratio not in ('STD', 'LONG', 'EXTRA_LONG') then
    raise exception 'Invalid gear ratio' using errcode = '22023';
  end if;

  -- Lock the existing car even for its first configuration. Concurrent saves
  -- serialize per car without blocking independent cars or creating duplicate versions.
  perform id from public.dashboard_cars where id = p_car_id for update;
  if not found then
    raise exception 'Car does not exist' using errcode = '22023';
  end if;
  select * into current_config from public.car_gear_ratio_config where car_id = p_car_id;
  if current_config.selected_ratio = p_ratio then
    return current_config;
  end if;
  if p_expected_version is distinct from coalesce(current_config.version, 0) then
    raise exception 'Gear ratio changed since it was loaded. Refresh and select again.' using errcode = '40001';
  end if;

  insert into public.car_gear_ratio_config
    (car_id, selected_ratio, version, updated_at, updated_by, updated_by_email)
  values (p_car_id, p_ratio, coalesce(current_config.version, 0) + 1,
    clock_timestamp(), auth.uid(), public.gear_ratio_current_email())
  on conflict (car_id) do update set
    selected_ratio = excluded.selected_ratio, version = excluded.version,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by,
    updated_by_email = excluded.updated_by_email
  returning * into saved_config;

  insert into public.car_gear_ratio_history
    (car_id, version, previous_ratio, selected_ratio, updated_at, updated_by, updated_by_email)
  values (saved_config.car_id, saved_config.version, current_config.selected_ratio,
    saved_config.selected_ratio, saved_config.updated_at, saved_config.updated_by, saved_config.updated_by_email);
  return saved_config;
end;
$$;

create function public.acknowledge_car_gear_ratio(p_car_id bigint, p_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  current_version integer;
  saved_version integer;
begin
  if not public.gear_ratio_can_acknowledge(p_car_id) then
    raise exception 'You cannot acknowledge gear ratios for this car' using errcode = '42501';
  end if;
  select version into current_version from public.car_gear_ratio_config where car_id = p_car_id;
  if p_version is null or p_version < 1 or current_version is null or p_version > current_version then
    raise exception 'Invalid gear ratio version' using errcode = '22023';
  end if;
  -- Only acknowledge the version actually displayed. A concurrent later change
  -- remains unread; an older device must never move acknowledgement backwards.
  insert into public.car_gear_ratio_acknowledgements
    (car_id, user_id, acknowledged_version, acknowledged_at)
  values (p_car_id, auth.uid(), p_version, clock_timestamp())
  on conflict (car_id, user_id) do update set
    acknowledged_version = greatest(car_gear_ratio_acknowledgements.acknowledged_version, excluded.acknowledged_version),
    acknowledged_at = case when excluded.acknowledged_version > car_gear_ratio_acknowledgements.acknowledged_version
      then excluded.acknowledged_at else car_gear_ratio_acknowledgements.acknowledged_at end
  returning acknowledged_version into saved_version;
  return saved_version;
end;
$$;

revoke all on function public.gear_ratio_current_email(), public.gear_ratio_is_chief(),
  public.gear_ratio_can_view(bigint), public.gear_ratio_can_acknowledge(bigint),
  public.set_car_gear_ratio(bigint, text, integer), public.acknowledge_car_gear_ratio(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.gear_ratio_is_chief(), public.gear_ratio_can_view(bigint),
  public.gear_ratio_can_acknowledge(bigint), public.set_car_gear_ratio(bigint, text, integer),
  public.acknowledge_car_gear_ratio(bigint, integer) to authenticated;

commit;
