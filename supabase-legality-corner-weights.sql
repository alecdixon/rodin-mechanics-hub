-- Adds manual corner-weight fields to legality checks.
-- Run this once in Supabase SQL Editor before testing Save & Send PDF.

alter table public.legality_checks
add column if not exists corner_weight_fl numeric,
add column if not exists corner_weight_fr numeric,
add column if not exists corner_weight_rl numeric,
add column if not exists corner_weight_rr numeric,
add column if not exists corner_weight_total numeric;

comment on column public.legality_checks.corner_weight_fl is 'Manual FL corner weight, normally kg.';
comment on column public.legality_checks.corner_weight_fr is 'Manual FR corner weight, normally kg.';
comment on column public.legality_checks.corner_weight_rl is 'Manual RL corner weight, normally kg.';
comment on column public.legality_checks.corner_weight_rr is 'Manual RR corner weight, normally kg.';
comment on column public.legality_checks.corner_weight_total is 'Manual total vehicle weight, normally kg. Not auto-calculated by the app.';
