// Executes the actual migration in disposable in-memory PostgreSQL.
// Reuses the optional PGlite runtime installed under coverage/gear-ratio-db.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "../coverage/gear-ratio-db/node_modules/@electric-sql/pglite/dist/index.js";
import { canAllocateClutchForCar } from "../lib/userAccess.ts";

const db = new PGlite();
const people = ["dan.crain", "simon.crain", "olli.moss", "jack.carter", "jimmy", "alec.dixon", "guest", "ben.southern", "charlie.lawman", "unknown"];
const uid = name => `00000000-0000-4000-8000-${String(people.indexOf(name) + 1).padStart(12, "0")}`;
const email = name => `${name}@rodinmotorsport.com`;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const denied = (sql, params = [], code = "42501") => assert.rejects(() => query(sql, params), error => error.code === code);
const login = async name => {
  await db.exec("reset role; set role authenticated;");
  await query("select set_config('request.jwt.claim.sub', $1, false)", [uid(name)]);
};
const assign = async (carId, clutchId) => (await query(
  "select public.set_car_default_clutch($1, $2) as result",
  [carId, clutchId],
))[0].result;
const allocations = async () => query("select serial_no,current_car_id from public.clutch_inventory order by serial_no");

try {
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique not null);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated, anon;

    create table public.dashboard_cars (id bigint primary key, name text not null);
    create table public.clutch_inventory (
      id uuid primary key,
      serial_no text not null unique,
      current_car_id bigint references public.dashboard_cars(id),
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    insert into public.dashboard_cars values (1, 'Car 1'), (2, 'Car 2'), (3, 'Car 3');
    insert into public.clutch_inventory (id,serial_no,current_car_id,active) values
      ('10000000-0000-4000-8000-000000000001','CL-001',1,true),
      ('10000000-0000-4000-8000-000000000002','CL-002',null,true),
      ('10000000-0000-4000-8000-000000000003','CL-003',2,true),
      ('10000000-0000-4000-8000-000000000004','CL-004',3,true),
      ('10000000-0000-4000-8000-000000000005','CL-INACTIVE',null,false);
    grant select on public.dashboard_cars, public.clutch_inventory to authenticated;
  `);
  for (const person of people) await query("insert into auth.users values ($1,$2)", [uid(person), email(person)]);
  await db.exec(await readFile(new URL("../supabase-clutch-default-rpc.sql", import.meta.url), "utf8"));

  await login("simon.crain");
  const first = await assign(1, "10000000-0000-4000-8000-000000000002");
  assert.equal(first.serial_no, "CL-002");
  assert.equal(first.previous_serial_no, "CL-001");
  assert.equal(first.changed, true);
  assert.deepEqual(await allocations(), [
    { serial_no: "CL-001", current_car_id: null },
    { serial_no: "CL-002", current_car_id: 1 },
    { serial_no: "CL-003", current_car_id: 2 },
    { serial_no: "CL-004", current_car_id: 3 },
    { serial_no: "CL-INACTIVE", current_car_id: null },
  ]);
  assert.equal((await assign(1, "10000000-0000-4000-8000-000000000002")).changed, false);
  await denied("select public.set_car_default_clutch(2,$1)", ["10000000-0000-4000-8000-000000000003"]);
  await denied("select public.set_car_default_clutch(1,$1)", ["10000000-0000-4000-8000-000000000003"], "23514");
  await denied("select public.set_car_default_clutch(1,$1)", ["10000000-0000-4000-8000-000000000005"], "22023");
  await denied("select public.set_car_default_clutch(1,$1)", ["90000000-0000-4000-8000-000000000009"], "22023");
  await denied("select public.set_car_default_clutch(99,$1)", ["10000000-0000-4000-8000-000000000001"]);

  await login("dan.crain");
  await denied("select public.set_car_default_clutch(99,$1)", ["10000000-0000-4000-8000-000000000001"], "22023");
  const chief = await assign(3, "10000000-0000-4000-8000-000000000001");
  assert.equal(chief.serial_no, "CL-001");
  assert.equal((await allocations()).filter(row => row.current_car_id === 3).length, 1);

  for (const person of people) {
    await login(person);
    for (const carId of [1, 2, 3]) {
      const allowed = canAllocateClutchForCar(email(person), carId);
      if (!allowed) {
        await denied("select public.set_car_default_clutch($1,$2)", [carId, "10000000-0000-4000-8000-000000000002"]);
      }
    }
    await denied("update public.clutch_inventory set current_car_id=null");
  }

  await login("jimmy");
  await query("select set_config('request.jwt.claim.email', 'dan.crain@rodinmotorsport.com', false)");
  await denied("select public.set_car_default_clutch(1,$1)", ["10000000-0000-4000-8000-000000000002"]);
  await db.exec("reset role; set role anon;");
  await denied("select public.set_car_default_clutch(1,$1)", ["10000000-0000-4000-8000-000000000002"]);
  console.log("PASS: narrow clutch RPC permissions, atomic replacement, no-op, invalid inputs, cross-car rejection and direct-write denial.");
} finally {
  await db.close();
}
