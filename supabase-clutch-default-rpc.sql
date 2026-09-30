begin;

-- Adds one authenticated RPC and grants only its execution to authenticated
-- users. It does not add table grants or change RLS policies. The function
-- atomically changes one car's default clutch after checking the same static
-- Chief/Number 1 assignments used by the application.
create or replace function public.set_car_default_clutch(
  p_car_id bigint,
  p_clutch_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_email text;
  assigned_car_id bigint;
  requested_clutch_id text;
  requested_serial text;
  requested_car_id bigint;
  previous_clutch_id text;
  previous_serial text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(email))
  into current_email
  from auth.users
  where id = auth.uid();

  assigned_car_id := case current_email
    when 'simon.crain@rodinmotorsport.com' then 1
    when 'olli.moss@rodinmotorsport.com' then 2
    when 'jack.carter@rodinmotorsport.com' then 3
    else null
  end;

  if current_email = 'dan.crain@rodinmotorsport.com' then
    null;
  elsif assigned_car_id is distinct from p_car_id then
    raise exception 'You cannot change the default clutch for this car'
      using errcode = '42501';
  end if;

  -- Serialise all default-clutch changes for the same car.
  perform id
  from public.dashboard_cars
  where id = p_car_id
  for update;

  if not found then
    raise exception 'Car does not exist' using errcode = '22023';
  end if;

  if p_clutch_id is null or btrim(p_clutch_id) = '' then
    raise exception 'Clutch does not exist' using errcode = '22023';
  end if;

  select id::text, serial_no, current_car_id
  into requested_clutch_id, requested_serial, requested_car_id
  from public.clutch_inventory
  where id::text = btrim(p_clutch_id)
    and coalesce(active, true)
  for update;

  if not found then
    raise exception 'Clutch does not exist or is inactive' using errcode = '22023';
  end if;

  if requested_car_id is not null and requested_car_id <> p_car_id then
    raise exception 'Clutch % is currently assigned to another car and cannot be made the default', requested_serial
      using errcode = '23514';
  end if;

  -- Lock every existing assignment before selecting and clearing it. The car
  -- row lock above prevents concurrent calls from creating two defaults.
  perform 1
  from public.clutch_inventory
  where current_car_id = p_car_id
  for update;

  select id::text, serial_no
  into previous_clutch_id, previous_serial
  from public.clutch_inventory
  where current_car_id = p_car_id
  order by id::text
  limit 1;

  update public.clutch_inventory
  set current_car_id = null
  where current_car_id = p_car_id
    and id::text <> requested_clutch_id;

  update public.clutch_inventory
  set current_car_id = p_car_id
  where id::text = requested_clutch_id;

  return jsonb_build_object(
    'car_id', p_car_id,
    'clutch_id', requested_clutch_id,
    'serial_no', requested_serial,
    'previous_clutch_id', previous_clutch_id,
    'previous_serial_no', previous_serial,
    'changed', previous_clutch_id is distinct from requested_clutch_id
  );
end;
$$;

revoke all on function public.set_car_default_clutch(bigint, text)
  from public, anon, authenticated;
grant execute on function public.set_car_default_clutch(bigint, text)
  to authenticated;

commit;
