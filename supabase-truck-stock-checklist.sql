-- Shared Truck Stock Checklist schema and 30-item baseline.
-- Apply once in the Supabase SQL editor before deploying /truck-stock.
begin;

create extension if not exists pgcrypto;

create table if not exists public.truck_stock_checklist_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (btrim(label) <> ''),
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  is_checked boolean not null default false,
  checked_at timestamptz,
  checked_by text,
  baseline_source_key text unique,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (
    (is_checked and checked_at is not null and checked_by is not null)
    or (not is_checked and checked_at is null and checked_by is null)
  )
);

create unique index if not exists truck_stock_checklist_active_sort_idx
  on public.truck_stock_checklist_items (sort_order)
  where is_active;

create table if not exists public.truck_stock_checklist_state (
  singleton boolean primary key default true check (singleton),
  last_reset_at timestamptz,
  last_reset_by text
);

insert into public.truck_stock_checklist_state (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.truck_stock_current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(trim(email)) from auth.users where id = auth.uid();
$$;

create or replace function public.truck_stock_can_view() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.truck_stock_current_email() in (
    'dan.crain@rodinmotorsport.com',
    'jimmy@rodinmotorsport.com',
    'simon.crain@rodinmotorsport.com',
    'olli.moss@rodinmotorsport.com',
    'jack.carter@rodinmotorsport.com',
    'ben.southern@rodinmotorsport.com',
    'charlie.lawman@rodinmotorsport.com',
    'alec.dixon@rodinmotorsport.com',
    'guest@rodinmotorsport.com'
  ), false);
$$;

create or replace function public.truck_stock_can_check() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.truck_stock_current_email() in (
    'dan.crain@rodinmotorsport.com',
    'simon.crain@rodinmotorsport.com',
    'olli.moss@rodinmotorsport.com',
    'jack.carter@rodinmotorsport.com',
    'ben.southern@rodinmotorsport.com',
    'charlie.lawman@rodinmotorsport.com'
  ), false);
$$;

create or replace function public.truck_stock_is_chief() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.truck_stock_current_email() = 'dan.crain@rodinmotorsport.com',
    false
  );
$$;

revoke all on function public.truck_stock_current_email(),
  public.truck_stock_can_view(),
  public.truck_stock_can_check(),
  public.truck_stock_is_chief() from public, anon;
grant execute on function public.truck_stock_current_email(),
  public.truck_stock_can_view(),
  public.truck_stock_can_check(),
  public.truck_stock_is_chief() to authenticated;

alter table public.truck_stock_checklist_items enable row level security;
alter table public.truck_stock_checklist_state enable row level security;

drop policy if exists truck_stock_items_read on public.truck_stock_checklist_items;
create policy truck_stock_items_read on public.truck_stock_checklist_items
  for select to authenticated using (public.truck_stock_can_view());

drop policy if exists truck_stock_state_read on public.truck_stock_checklist_state;
create policy truck_stock_state_read on public.truck_stock_checklist_state
  for select to authenticated using (public.truck_stock_can_view());

-- Tables are read-only to clients. Narrow security-definer functions own every write.
revoke all on public.truck_stock_checklist_items,
  public.truck_stock_checklist_state from public, anon, authenticated;
grant select on public.truck_stock_checklist_items,
  public.truck_stock_checklist_state to authenticated;

create or replace function public.set_truck_stock_item_checked(
  p_item_id uuid,
  p_is_checked boolean
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  saved_item public.truck_stock_checklist_items;
  actor_email text := public.truck_stock_current_email();
begin
  if not public.truck_stock_can_check() then
    raise exception 'You do not have permission to update the Truck Stock Checklist'
      using errcode = '42501';
  end if;

  update public.truck_stock_checklist_items
  set is_checked = p_is_checked,
      checked_at = case when p_is_checked then now() else null end,
      checked_by = case when p_is_checked then actor_email else null end,
      updated_at = now(),
      updated_by = actor_email
  where id = p_item_id and is_active
  returning * into saved_item;

  if saved_item.id is null then
    raise exception 'Truck Stock Checklist item was not found' using errcode = 'P0002';
  end if;

  return saved_item;
end;
$$;

create or replace function public.add_truck_stock_checklist_item(
  p_label text
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  clean_label text := btrim(p_label);
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can add Truck Stock Checklist items'
      using errcode = '42501';
  end if;
  if clean_label is null or clean_label = '' then
    raise exception 'Item text is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('truck_stock_checklist_sort_order'));
  insert into public.truck_stock_checklist_items
    (label, sort_order, created_by, updated_by)
  select clean_label, coalesce(max(sort_order), 0) + 1, actor_email, actor_email
  from public.truck_stock_checklist_items
  returning * into saved_item;
  return saved_item;
end;
$$;

create or replace function public.rename_truck_stock_checklist_item(
  p_item_id uuid,
  p_label text
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  clean_label text := btrim(p_label);
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can edit Truck Stock Checklist items'
      using errcode = '42501';
  end if;
  if clean_label is null or clean_label = '' then
    raise exception 'Item text is required' using errcode = '22023';
  end if;

  update public.truck_stock_checklist_items
  set label = clean_label, updated_at = now(), updated_by = actor_email
  where id = p_item_id and is_active
  returning * into saved_item;
  if saved_item.id is null then
    raise exception 'Truck Stock Checklist item was not found' using errcode = 'P0002';
  end if;
  return saved_item;
end;
$$;

create or replace function public.archive_truck_stock_checklist_item(
  p_item_id uuid
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can remove Truck Stock Checklist items'
      using errcode = '42501';
  end if;

  update public.truck_stock_checklist_items
  set is_active = false,
      is_checked = false,
      checked_at = null,
      checked_by = null,
      updated_at = now(),
      updated_by = actor_email
  where id = p_item_id and is_active
  returning * into saved_item;
  if saved_item.id is null then
    raise exception 'Truck Stock Checklist item was not found' using errcode = 'P0002';
  end if;
  return saved_item;
end;
$$;

create or replace function public.reset_truck_stock_checklist()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  actor_email text := public.truck_stock_current_email();
  affected integer;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can reset the Truck Stock Checklist'
      using errcode = '42501';
  end if;

  update public.truck_stock_checklist_items
  set is_checked = false,
      checked_at = null,
      checked_by = null,
      updated_at = now(),
      updated_by = actor_email
  where is_active;
  get diagnostics affected = row_count;

  update public.truck_stock_checklist_state
  set last_reset_at = now(), last_reset_by = actor_email
  where singleton;

  return affected;
end;
$$;

revoke all on function public.set_truck_stock_item_checked(uuid, boolean),
  public.add_truck_stock_checklist_item(text),
  public.rename_truck_stock_checklist_item(uuid, text),
  public.archive_truck_stock_checklist_item(uuid),
  public.reset_truck_stock_checklist() from public, anon, authenticated;
grant execute on function public.set_truck_stock_item_checked(uuid, boolean),
  public.add_truck_stock_checklist_item(text),
  public.rename_truck_stock_checklist_item(uuid, text),
  public.archive_truck_stock_checklist_item(uuid),
  public.reset_truck_stock_checklist() to authenticated;

insert into public.truck_stock_checklist_items
  (label, sort_order, baseline_source_key)
values
  ('SPRAYS/AEROSOLS - WD40/PAINT/SILICONE/ELECTRICAL CLEANER', 1, 'truck-stock-checklist:01'),
  ('CLEANING - QUICK DETAILER/GLASS', 2, 'truck-stock-checklist:02'),
  ('GLOVES', 3, 'truck-stock-checklist:03'),
  ('RAGS/MICROFIBRE', 4, 'truck-stock-checklist:04'),
  ('BRAKE CLEANER', 5, 'truck-stock-checklist:05'),
  ('BLUEROLL', 6, 'truck-stock-checklist:06'),
  ('GLUES/SILICONE', 7, 'truck-stock-checklist:07'),
  ('BIN BAGS', 8, 'truck-stock-checklist:08'),
  ('GREASES - ZX1/THIXO/RUBBER', 9, 'truck-stock-checklist:09'),
  ('WATERS', 10, 'truck-stock-checklist:10'),
  ('SEAT FIT KIT - CUPS/PART A & B FOAM', 11, 'truck-stock-checklist:11'),
  ('TAPES - TESA/DOUBLE SIDED/DUAL LOCK/PTFE/INSULATION/DUCT TAPE/WHEEL WRAP/GURNEY/FOAM/CLEAR', 12, 'truck-stock-checklist:12'),
  ('GEAROIL 20L', 13, 'truck-stock-checklist:13'),
  ('ENGINE OIL', 14, 'truck-stock-checklist:14'),
  ('COOLANT 2.5L ANTIFREEZE - 1/3 WATER WETTER 20L DRUM', 15, 'truck-stock-checklist:15'),
  ('BRAKE FLUID', 16, 'truck-stock-checklist:16'),
  ('TRUCK WASH SOAP', 17, 'truck-stock-checklist:17'),
  ('WHEEL WEIGHTS', 18, 'truck-stock-checklist:18'),
  ('TYRE PRESSURE PADS', 19, 'truck-stock-checklist:19'),
  ('TYRE SOAP', 20, 'truck-stock-checklist:20'),
  ('TYRE PENS', 21, 'truck-stock-checklist:21'),
  ('CABLE TIES - BIG/MEDIUM/SMALL/METAL', 22, 'truck-stock-checklist:22'),
  ('RIVETS/RIVNUTS', 23, 'truck-stock-checklist:23'),
  ('NUTS & BOLTS', 24, 'truck-stock-checklist:24'),
  ('THREAD REPAIR', 25, 'truck-stock-checklist:25'),
  ('PENS', 26, 'truck-stock-checklist:26'),
  ('PAPER', 27, 'truck-stock-checklist:27'),
  ('LOCTITE 330', 28, 'truck-stock-checklist:28'),
  ('CABLE TIE BLOCKS', 29, 'truck-stock-checklist:29'),
  ('BATTERIES AA/AAA/9V/LR/CR', 30, 'truck-stock-checklist:30')
on conflict (baseline_source_key) do nothing;

alter table public.truck_stock_checklist_items replica identity full;

-- Commit the core schema and seed before the optional realtime publication step.
commit;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'truck_stock_checklist_items'
  ) then
    alter publication supabase_realtime add table public.truck_stock_checklist_items;
  end if;
end;
$$;

notify pgrst, 'reload schema';
