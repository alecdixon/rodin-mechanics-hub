create table if not exists team_jobs (
  id uuid primary key default gen_random_uuid(),
  job_text text not null,
  notes text,
  priority text not null default 'normal',
  published boolean not null default false,
  published_at timestamptz,
  completed boolean not null default false,
  completed_by text,
  completed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz
);

create table if not exists team_job_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table team_jobs enable row level security;
alter table team_job_notifications enable row level security;

drop policy if exists "authenticated can read team jobs" on team_jobs;
drop policy if exists "authenticated can insert team jobs" on team_jobs;
drop policy if exists "authenticated can update team jobs" on team_jobs;
drop policy if exists "authenticated can delete team jobs" on team_jobs;

create policy "authenticated can read team jobs"
on team_jobs for select
to authenticated
using (true);

create policy "authenticated can insert team jobs"
on team_jobs for insert
to authenticated
with check (true);

create policy "authenticated can update team jobs"
on team_jobs for update
to authenticated
using (true)
with check (true);

create policy "authenticated can delete team jobs"
on team_jobs for delete
to authenticated
using (true);

drop policy if exists "authenticated can read team job notifications" on team_job_notifications;
drop policy if exists "authenticated can insert team job notifications" on team_job_notifications;

create policy "authenticated can read team job notifications"
on team_job_notifications for select
to authenticated
using (true);

create policy "authenticated can insert team job notifications"
on team_job_notifications for insert
to authenticated
with check (true);

alter publication supabase_realtime add table team_jobs;
alter publication supabase_realtime add table team_job_notifications;