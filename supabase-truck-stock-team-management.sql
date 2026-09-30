-- Allow normal authenticated team roles to manage individual Truck Stock items.
-- Guest remains read-only and Reset for Next Event remains Chief-only.
begin;

create or replace function public.truck_stock_can_check() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.truck_stock_current_email() in (
    'dan.crain@rodinmotorsport.com',
    'jimmy@rodinmotorsport.com',
    'simon.crain@rodinmotorsport.com',
    'olli.moss@rodinmotorsport.com',
    'jack.carter@rodinmotorsport.com',
    'ben.southern@rodinmotorsport.com',
    'charlie.lawman@rodinmotorsport.com',
    'alec.dixon@rodinmotorsport.com'
  ), false);
$$;

create or replace function public.truck_stock_can_manage() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.truck_stock_current_email() in (
    'dan.crain@rodinmotorsport.com',
    'jimmy@rodinmotorsport.com',
    'simon.crain@rodinmotorsport.com',
    'olli.moss@rodinmotorsport.com',
    'jack.carter@rodinmotorsport.com',
    'ben.southern@rodinmotorsport.com',
    'charlie.lawman@rodinmotorsport.com',
    'alec.dixon@rodinmotorsport.com'
  ), false);
$$;

revoke all on function public.truck_stock_can_check(),
  public.truck_stock_can_manage() from public, anon;
grant execute on function public.truck_stock_can_check(),
  public.truck_stock_can_manage() to authenticated;

-- Compatibility RPC retained for the earlier UI version.
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
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to add Truck Stock Checklist items'
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

-- Compatibility RPC retained for the earlier UI version.
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
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to edit Truck Stock Checklist items'
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

create or replace function public.create_truck_stock_category(
  p_name text
) returns public.truck_stock_checklist_categories
language plpgsql security definer set search_path = '' as $$
declare
  clean_name text := pg_catalog.regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  actor_email text := public.truck_stock_current_email();
  saved_category public.truck_stock_checklist_categories;
begin
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to create Truck Stock categories'
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
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to add Truck Stock Checklist items'
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
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to edit Truck Stock Checklist items'
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

create or replace function public.archive_truck_stock_checklist_item(
  p_item_id uuid
) returns public.truck_stock_checklist_items
language plpgsql security definer set search_path = '' as $$
declare
  actor_email text := public.truck_stock_current_email();
  saved_item public.truck_stock_checklist_items;
begin
  if not public.truck_stock_can_manage() then
    raise exception 'You do not have permission to remove Truck Stock Checklist items'
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

revoke all on function public.add_truck_stock_checklist_item(text),
  public.rename_truck_stock_checklist_item(uuid, text),
  public.create_truck_stock_category(text),
  public.create_truck_stock_checklist_item(text, uuid),
  public.update_truck_stock_checklist_item(uuid, text, uuid),
  public.archive_truck_stock_checklist_item(uuid)
  from public, anon, authenticated;

grant execute on function public.add_truck_stock_checklist_item(text),
  public.rename_truck_stock_checklist_item(uuid, text),
  public.create_truck_stock_category(text),
  public.create_truck_stock_checklist_item(text, uuid),
  public.update_truck_stock_checklist_item(uuid, text, uuid),
  public.archive_truck_stock_checklist_item(uuid)
  to authenticated;

commit;

notify pgrst, 'reload schema';
