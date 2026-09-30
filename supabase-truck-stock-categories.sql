-- Add persistent categories to the shared Truck Stock Checklist.
-- Preserves every item, checked state, and audit field.
begin;

create table if not exists public.truck_stock_checklist_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and name = btrim(name)),
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create unique index if not exists truck_stock_categories_name_idx
  on public.truck_stock_checklist_categories (lower(name));

create unique index if not exists truck_stock_categories_sort_idx
  on public.truck_stock_checklist_categories (sort_order);

insert into public.truck_stock_checklist_categories (name, sort_order)
select seed.name, seed.sort_order
from (values
  ('Consumables', 1),
  ('Fluids / Chemicals', 2),
  ('Tyre / Wheel', 3),
  ('Workshop / Hardware', 4),
  ('Garage / General', 5),
  ('Other', 6)
) as seed(name, sort_order)
where not exists (
  select 1
  from public.truck_stock_checklist_categories existing
  where lower(existing.name) = lower(seed.name)
);

alter table public.truck_stock_checklist_items
  add column if not exists category_id uuid
  references public.truck_stock_checklist_categories(id);

update public.truck_stock_checklist_items item
set category_id = category.id
from public.truck_stock_checklist_categories category
where item.category_id is null
  and lower(category.name) = lower(case
    when split_part(item.baseline_source_key, ':', 2) in ('01', '02', '03', '04', '05', '06', '08') then 'Consumables'
    when split_part(item.baseline_source_key, ':', 2) in ('07', '09', '13', '14', '15', '16', '28') then 'Fluids / Chemicals'
    when split_part(item.baseline_source_key, ':', 2) in ('18', '19', '20', '21') then 'Tyre / Wheel'
    when split_part(item.baseline_source_key, ':', 2) in ('12', '22', '23', '24', '25', '29') then 'Workshop / Hardware'
    when split_part(item.baseline_source_key, ':', 2) in ('10', '11', '17', '26', '27', '30') then 'Garage / General'
    else 'Other'
  end);

alter table public.truck_stock_checklist_items
  alter column category_id set not null;

create index if not exists truck_stock_items_category_idx
  on public.truck_stock_checklist_items (category_id, sort_order);

alter table public.truck_stock_checklist_categories enable row level security;

drop policy if exists truck_stock_categories_read on public.truck_stock_checklist_categories;
create policy truck_stock_categories_read on public.truck_stock_checklist_categories
  for select to authenticated using (public.truck_stock_can_view());

revoke all on public.truck_stock_checklist_categories from public, anon, authenticated;
grant select on public.truck_stock_checklist_categories to authenticated;

-- Keep the currently deployed Add Item call working during the rollout window.
create or replace function public.add_truck_stock_checklist_item(
  p_label text
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  clean_label text := btrim(p_label);
  actor_email text := public.truck_stock_current_email();
  default_category_id uuid;
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can add Truck Stock Checklist items'
      using errcode = '42501';
  end if;
  if clean_label is null or clean_label = '' then
    raise exception 'Item text is required' using errcode = '22023';
  end if;

  select id into default_category_id
  from public.truck_stock_checklist_categories
  where lower(name) = 'other';

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('truck_stock_checklist_sort_order'));
  insert into public.truck_stock_checklist_items
    (label, category_id, sort_order, created_by, updated_by)
  select clean_label, default_category_id, coalesce(max(sort_order), 0) + 1, actor_email, actor_email
  from public.truck_stock_checklist_items
  returning * into saved_item;

  return saved_item;
end;
$$;

create or replace function public.create_truck_stock_category(
  p_name text
) returns public.truck_stock_checklist_categories
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := pg_catalog.regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  actor_email text := public.truck_stock_current_email();
  saved_category public.truck_stock_checklist_categories;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can create Truck Stock categories'
      using errcode = '42501';
  end if;
  if clean_name is null or clean_name = '' then
    raise exception 'Category name is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('truck_stock_category_name'));
  select * into saved_category
  from public.truck_stock_checklist_categories
  where lower(name) = lower(clean_name);

  if saved_category.id is not null then
    return saved_category;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('truck_stock_category_sort_order'));
  insert into public.truck_stock_checklist_categories
    (name, sort_order, created_by, updated_by)
  select clean_name, coalesce(max(sort_order), 0) + 1, actor_email, actor_email
  from public.truck_stock_checklist_categories
  returning * into saved_category;

  return saved_category;
end;
$$;

create or replace function public.create_truck_stock_checklist_item(
  p_item_name text,
  p_category_id uuid
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(p_item_name);
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can add Truck Stock Checklist items'
      using errcode = '42501';
  end if;
  if clean_name is null or clean_name = '' then
    raise exception 'Item name is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.truck_stock_checklist_categories where id = p_category_id
  ) then
    raise exception 'Truck Stock category was not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('truck_stock_checklist_sort_order'));
  insert into public.truck_stock_checklist_items
    (label, category_id, sort_order, created_by, updated_by)
  select clean_name, p_category_id, coalesce(max(sort_order), 0) + 1, actor_email, actor_email
  from public.truck_stock_checklist_items
  returning * into saved_item;

  return saved_item;
end;
$$;

create or replace function public.update_truck_stock_checklist_item(
  p_item_id uuid,
  p_item_name text,
  p_category_id uuid
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := btrim(p_item_name);
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_is_chief() then
    raise exception 'Only the Chief Mechanic can edit Truck Stock Checklist items'
      using errcode = '42501';
  end if;
  if clean_name is null or clean_name = '' then
    raise exception 'Item name is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.truck_stock_checklist_categories where id = p_category_id
  ) then
    raise exception 'Truck Stock category was not found' using errcode = 'P0002';
  end if;

  update public.truck_stock_checklist_items
  set label = clean_name,
      category_id = p_category_id,
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

revoke all on function public.create_truck_stock_category(text),
  public.create_truck_stock_checklist_item(text, uuid),
  public.update_truck_stock_checklist_item(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.create_truck_stock_category(text),
  public.create_truck_stock_checklist_item(text, uuid),
  public.update_truck_stock_checklist_item(uuid, text, uuid)
  to authenticated;

commit;

notify pgrst, 'reload schema';
