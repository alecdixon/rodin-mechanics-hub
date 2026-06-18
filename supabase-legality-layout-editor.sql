-- Legality layout editor migration
-- Run this in Supabase SQL Editor after applying the legality feature/polish SQL.

create extension if not exists pgcrypto;

create table if not exists public.legality_layout_points (
  id uuid primary key default gen_random_uuid(),
  point_key text not null,
  label text not null,
  short_label text not null,
  side text not null default 'Centre',
  position text not null default '',
  x_percent numeric(5,2) not null default 50,
  y_percent numeric(5,2) not null default 50,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.legality_layout_points
  add column if not exists point_key text,
  add column if not exists label text,
  add column if not exists short_label text,
  add column if not exists side text default 'Centre',
  add column if not exists position text default '',
  add column if not exists x_percent numeric(5,2) default 50,
  add column if not exists y_percent numeric(5,2) default 50,
  add column if not exists sort_order integer default 0,
  add column if not exists active boolean default true,
  add column if not exists created_by text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists legality_layout_points_point_key_key
  on public.legality_layout_points (point_key);

create index if not exists legality_layout_points_active_sort_idx
  on public.legality_layout_points (active, sort_order);

create or replace function public.set_legality_layout_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_legality_layout_updated_at on public.legality_layout_points;

create trigger trg_set_legality_layout_updated_at
before update on public.legality_layout_points
for each row
execute function public.set_legality_layout_updated_at();

insert into public.legality_layout_points
  (point_key, label, short_label, side, position, x_percent, y_percent, sort_order, active)
values
  ('fw_lh', 'FW LH', 'FW', 'LH', 'Front wing main plane / endplate area', 13, 18, 10, true),
  ('fwep_lh', 'FWEP LH', 'FWEP', 'LH', 'Front wing endplate', 13, 26, 20, true),
  ('front_lh', 'FRONT LH', 'FRONT', 'LH', 'Front floor / splitter legality point', 13, 43, 30, true),
  ('mid_lh', 'MID LH', 'MID', 'LH', 'Mid floor legality point', 13, 58, 40, true),
  ('rear_lh', 'REAR LH', 'REAR', 'LH', 'Rear floor legality point', 13, 74, 50, true),
  ('diffuser_lh', 'DIFFUSER LH', 'DIFFUSER', 'LH', 'Diffuser legality point', 14, 85, 60, true),
  ('fw_rh', 'FW RH', 'FW', 'RH', 'Front wing main plane / endplate area', 87, 18, 70, true),
  ('fwep_rh', 'FWEP RH', 'FWEP', 'RH', 'Front wing endplate', 87, 26, 80, true),
  ('front_rh', 'FRONT RH', 'FRONT', 'RH', 'Front floor / splitter legality point', 87, 43, 90, true),
  ('mid_rh', 'MID RH', 'MID', 'RH', 'Mid floor legality point', 87, 58, 100, true),
  ('rear_rh', 'REAR RH', 'REAR', 'RH', 'Rear floor legality point', 87, 74, 110, true),
  ('diffuser_rh', 'DIFFUSER RH', 'DIFFUSER', 'RH', 'Diffuser legality point', 86, 85, 120, true),
  ('rw_gap', 'RW GAP', 'RW GAP', 'Centre', 'Rear wing gap measurement', 50, 95, 130, true)
on conflict (point_key) do nothing;

alter table public.legality_layout_points enable row level security;

drop policy if exists "legality_layout_points_select" on public.legality_layout_points;
drop policy if exists "legality_layout_points_insert" on public.legality_layout_points;
drop policy if exists "legality_layout_points_update" on public.legality_layout_points;
drop policy if exists "legality_layout_points_delete" on public.legality_layout_points;

-- This app currently uses its own cookie-based role system rather than Supabase Auth.
-- RLS therefore allows the anon client to read/write this config table, while the UI
-- restricts editing to Chief Mechanic users through lib/userAccess.ts.
create policy "legality_layout_points_select"
on public.legality_layout_points
for select
to anon, authenticated
using (true);

create policy "legality_layout_points_insert"
on public.legality_layout_points
for insert
to anon, authenticated
with check (true);

create policy "legality_layout_points_update"
on public.legality_layout_points
for update
to anon, authenticated
using (true)
with check (true);

create policy "legality_layout_points_delete"
on public.legality_layout_points
for delete
to anon, authenticated
using (true);
