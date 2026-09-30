-- Phase 1 Truck Inventory schema.
-- Apply once in the Supabase SQL editor before supabase-truck-inventory-2025-baseline.sql.
-- Access is Chief Mechanic-only and mirrors lib/userAccess.ts.
begin;

create extension if not exists pgcrypto;

create table if not exists public.parts_catalogue_versions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  year integer not null check (year between 2000 and 2100),
  name text not null check (btrim(name) <> ''),
  imported_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.parts_catalogue_items (
  id uuid primary key default gen_random_uuid(),
  catalogue_version_id uuid not null
    references public.parts_catalogue_versions(id) on delete restrict,
  part_number text not null check (btrim(part_number) <> ''),
  part_number_normalized text generated always as (upper(btrim(part_number))) stored,
  description text,
  category text,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (catalogue_version_id, part_number_normalized)
);

create table if not exists public.truck_inventory_items (
  id uuid primary key default gen_random_uuid(),
  catalogue_part_id uuid references public.parts_catalogue_items(id) on delete set null,
  part_number text,
  part_number_normalized text generated always as
    (case when nullif(btrim(part_number), '') is null then null else upper(btrim(part_number)) end) stored,
  description text,
  target_quantity integer check (target_quantity is null or target_quantity >= 0),
  baseline_quantity_2025 integer check (baseline_quantity_2025 is null or baseline_quantity_2025 >= 0),
  category text,
  truck_location text,
  tracking_status text not null default 'TRACKED'
    check (tracking_status in ('TRACKED', 'NEEDS_REVIEW', 'IGNORED', 'SUPERSEDED', 'OBSOLETE')),
  notes text,
  primary_image_path text,
  baseline_source_key text unique,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (nullif(btrim(part_number), '') is not null or baseline_source_key is not null)
);

create unique index if not exists truck_inventory_part_number_unique_idx
  on public.truck_inventory_items (part_number_normalized)
  where part_number_normalized is not null;
create index if not exists truck_inventory_status_idx
  on public.truck_inventory_items (tracking_status);
create index if not exists truck_inventory_category_idx
  on public.truck_inventory_items (category);
create index if not exists truck_inventory_catalogue_part_idx
  on public.truck_inventory_items (catalogue_part_id);

-- Resolve identity from auth.users, never from the user-email cookie or request data.
create or replace function public.truck_inventory_current_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(trim(email)) from auth.users where id = auth.uid();
$$;

create or replace function public.truck_inventory_is_chief() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.truck_inventory_current_email() = 'dan.crain@rodinmotorsport.com',
    false
  );
$$;

create or replace function public.set_truck_inventory_audit_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_email text := public.truck_inventory_current_email();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := actor_email;
  else
    -- Baseline/source evidence is historical. Normal inventory edits cannot rewrite it.
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.baseline_quantity_2025 := old.baseline_quantity_2025;
    new.baseline_source_key := old.baseline_source_key;
    new.source_data := old.source_data;
  end if;
  new.updated_at := now();
  new.updated_by := actor_email;
  return new;
end;
$$;

drop trigger if exists truck_inventory_audit_fields on public.truck_inventory_items;
create trigger truck_inventory_audit_fields
before insert or update on public.truck_inventory_items
for each row execute function public.set_truck_inventory_audit_fields();

alter table public.parts_catalogue_versions enable row level security;
alter table public.parts_catalogue_items enable row level security;
alter table public.truck_inventory_items enable row level security;

drop policy if exists parts_catalogue_versions_chief_read on public.parts_catalogue_versions;
create policy parts_catalogue_versions_chief_read on public.parts_catalogue_versions
  for select to authenticated using (public.truck_inventory_is_chief());

drop policy if exists parts_catalogue_items_chief_read on public.parts_catalogue_items;
create policy parts_catalogue_items_chief_read on public.parts_catalogue_items
  for select to authenticated using (public.truck_inventory_is_chief());

drop policy if exists truck_inventory_chief_read on public.truck_inventory_items;
create policy truck_inventory_chief_read on public.truck_inventory_items
  for select to authenticated using (public.truck_inventory_is_chief());

drop policy if exists truck_inventory_chief_insert on public.truck_inventory_items;
create policy truck_inventory_chief_insert on public.truck_inventory_items
  for insert to authenticated with check (public.truck_inventory_is_chief());

drop policy if exists truck_inventory_chief_update on public.truck_inventory_items;
create policy truck_inventory_chief_update on public.truck_inventory_items
  for update to authenticated
  using (public.truck_inventory_is_chief())
  with check (public.truck_inventory_is_chief());

-- There is deliberately no delete policy: historical inventory records are archived by status.
revoke all on public.parts_catalogue_versions, public.parts_catalogue_items,
  public.truck_inventory_items from public, anon, authenticated;
grant select on public.parts_catalogue_versions, public.parts_catalogue_items
  to authenticated;
grant select, insert, update on public.truck_inventory_items to authenticated;

insert into storage.buckets (id, name, public)
values ('truck-inventory-images', 'truck-inventory-images', false)
on conflict (id) do update set public = false;

drop policy if exists truck_inventory_images_chief_read on storage.objects;
create policy truck_inventory_images_chief_read on storage.objects
  for select to authenticated
  using (bucket_id = 'truck-inventory-images' and public.truck_inventory_is_chief());

drop policy if exists truck_inventory_images_chief_insert on storage.objects;
create policy truck_inventory_images_chief_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'truck-inventory-images' and public.truck_inventory_is_chief());

drop policy if exists truck_inventory_images_chief_delete on storage.objects;
create policy truck_inventory_images_chief_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'truck-inventory-images' and public.truck_inventory_is_chief());

commit;
