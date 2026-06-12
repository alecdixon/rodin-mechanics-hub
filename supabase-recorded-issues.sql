-- Recorded Issues feature
-- Run this once in the Supabase SQL editor before using /recorded-issues.

create extension if not exists pgcrypto;

create table if not exists public.recorded_issues (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  circuit text not null,
  affected_subsystem text not null,
  recorded_issue text not null,
  recorded_solution text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create index if not exists recorded_issues_report_date_idx
  on public.recorded_issues (report_date desc);

create index if not exists recorded_issues_subsystem_idx
  on public.recorded_issues (affected_subsystem);

create index if not exists recorded_issues_circuit_idx
  on public.recorded_issues (circuit);

-- Optional but useful for fast database-level text searching later.
create index if not exists recorded_issues_search_idx
  on public.recorded_issues using gin (
    to_tsvector(
      'english',
      coalesce(circuit, '') || ' ' ||
      coalesce(affected_subsystem, '') || ' ' ||
      coalesce(recorded_issue, '') || ' ' ||
      coalesce(recorded_solution, '')
    )
  );

alter table public.recorded_issues enable row level security;

-- These policies match the current app pattern: authenticated team users can view/add/update.
-- Delete is still restricted in the UI to chief mechanics, but Supabase RLS
-- cannot see the local role map in lib/userAccess.ts. Tighten this later if you move roles
-- into a Supabase profiles table.
drop policy if exists "Recorded issues are viewable by authenticated users" on public.recorded_issues;
create policy "Recorded issues are viewable by authenticated users"
  on public.recorded_issues
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can add recorded issues" on public.recorded_issues;
create policy "Authenticated users can add recorded issues"
  on public.recorded_issues
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update recorded issues" on public.recorded_issues;
create policy "Authenticated users can update recorded issues"
  on public.recorded_issues
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete recorded issues" on public.recorded_issues;
create policy "Authenticated users can delete recorded issues"
  on public.recorded_issues
  for delete
  to authenticated
  using (true);
