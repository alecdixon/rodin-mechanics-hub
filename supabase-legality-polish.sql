-- Legality polish migration
-- Run this AFTER the previous legality SQL / supabase-legality-fixed.sql.
-- Adds circuit + engineer allocation fields and removes the old practical need for chassis number.

create extension if not exists pgcrypto;

-- Parent table upgrades
alter table public.legality_checks
  add column if not exists circuit text,
  add column if not exists engineer_name text,
  add column if not exists engineer_email text,
  add column if not exists sent_to_engineer_at timestamptz;

-- Keep chassis_number for compatibility with older rows/code, but the UI no longer asks for it.
-- The app writes 'N/A' into this column.
update public.legality_checks
set
  chassis_number = coalesce(nullif(chassis_number, ''), 'N/A'),
  circuit = coalesce(nullif(circuit, ''), 'Unknown'),
  engineer_name = coalesce(nullif(engineer_name, ''), 'Engineer Car ' || car_id::text)
where chassis_number is null
   or btrim(chassis_number) = ''
   or circuit is null
   or btrim(circuit) = ''
   or engineer_name is null
   or btrim(engineer_name) = '';

alter table public.legality_checks
  alter column chassis_number set default 'N/A',
  alter column circuit set default 'Unknown';

alter table public.legality_checks
  alter column circuit set not null;

-- Replace the previous car/date uniqueness with car/date/circuit.
-- This means the same car can have separate legality sheets on the same date if the circuit/event text differs.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'legality_checks_car_date_unique'
  ) then
    alter table public.legality_checks
      drop constraint legality_checks_car_date_unique;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'legality_checks_car_date_circuit_unique'
  ) then
    alter table public.legality_checks
      add constraint legality_checks_car_date_circuit_unique unique (car_id, check_date, circuit);
  end if;
end $$;

create index if not exists legality_checks_car_date_circuit_idx
  on public.legality_checks (car_id, check_date desc, circuit);

create index if not exists legality_checks_sent_to_engineer_idx
  on public.legality_checks (sent_to_engineer_at desc);

-- Keep existing RLS helper/policies, but recreate the grants in case the earlier migration was partial.
grant select, insert, update on public.legality_checks to authenticated;
grant select, insert, update on public.legality_check_items to authenticated;
