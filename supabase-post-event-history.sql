-- Apply before deploying the updated mechanics Post Event page.
-- Reuse the existing append-per-save records; do not rewrite legacy submissions.
begin;
-- Hold writes during the verification so concurrent submissions cannot affect it.
-- Run as the project database owner, with a short lock timeout to avoid queuing
-- behind a busy application. A timeout rolls back the entire migration.
set local lock_timeout = '5s';
lock table public.post_event_sheets in access exclusive mode;
create temporary table post_event_history_before on commit drop as
  select id, to_jsonb(sheet) as original_record
  from public.post_event_sheets as sheet;

alter table public.post_event_sheets
  add column if not exists track_name text,
  add column if not exists post_event_date date,
  add column if not exists submission_snapshot jsonb;

-- Snapshot stores the submitter identity and exact check labels/values (including notes).
-- Nullable additions preserve legacy rows without inventing event dates or identities.
-- Existing table grants and RLS policies remain unchanged.
create index if not exists post_event_sheets_car_history_idx
  on public.post_event_sheets (car_id, created_at desc, id desc);

-- Abort rather than commit if any pre-existing row or value has changed.
do $$
begin
  if (select count(*) from public.post_event_sheets) <>
     (select count(*) from post_event_history_before)
     or exists (
       select 1 from post_event_history_before as original
       left join public.post_event_sheets as current on current.id = original.id
       where current.id is null
          or not (to_jsonb(current) @> original.original_record)
     ) then
    raise exception 'Post-event migration verification failed: existing records changed';
  end if;
end;
$$;
commit;
