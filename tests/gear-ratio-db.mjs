// Executes the actual migration in disposable in-memory PostgreSQL (PGlite).
// Optional test-only runtime, kept outside application dependencies:
// npm.cmd install --prefix coverage/gear-ratio-db --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
// node tests/gear-ratio-db.mjs
// Never connects to Supabase or reads environment credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "../coverage/gear-ratio-db/node_modules/@electric-sql/pglite/dist/index.js";
import { canAccessCarPages, canAcknowledgeGearRatio, canChangeGearRatio } from "../lib/userAccess.ts";

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
const save = async (car, ratio, version) => (await query("select * from public.set_car_gear_ratio($1, $2, $3)", [car, ratio, version]))[0];
const ack = async (car, version) => (await query("select public.acknowledge_car_gear_ratio($1, $2) as version", [car, version]))[0].version;

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
    create table public.dashboard_cars (id integer primary key, name text not null);
    insert into public.dashboard_cars values (1, 'Car 1'), (2, 'Car 2'), (3, 'Car 3');
  `);
  for (const person of people) await query("insert into auth.users values ($1,$2)", [uid(person), email(person)]);
  await db.exec(await readFile(new URL("../supabase-gear-ratio.sql", import.meta.url), "utf8"));
  await login("dan.crain");
  assert.deepEqual(await query("select * from public.car_gear_ratio_config"), [], "No implicit STD default");
  const first = await save(1, "STD", 0);
  assert.equal(first.version, 1);
  assert.equal(first.updated_by, uid("dan.crain"));
  assert.equal(first.updated_by_email, email("dan.crain"));
  const noop = await save(1, "STD", 0);
  assert.deepEqual(noop, first, "No-op preserves version, timestamp and audit identity even with a stale expected version");
  assert.equal((await save(1, "LONG", 1)).version, 2);
  assert.equal((await save(1, "EXTRA_LONG", 2)).version, 3);
  await save(2, "LONG", 0);
  await save(3, "STD", 0);
  assert.deepEqual((await query("select car_id,selected_ratio,version from public.car_gear_ratio_config order by car_id")), [
    { car_id: 1, selected_ratio: "EXTRA_LONG", version: 3 },
    { car_id: 2, selected_ratio: "LONG", version: 1 },
    { car_id: 3, selected_ratio: "STD", version: 1 },
  ]);
  const history = await query("select previous_ratio, selected_ratio from public.car_gear_ratio_history where car_id=1 order by version");
  assert.deepEqual(history, [
    { previous_ratio: null, selected_ratio: "STD" },
    { previous_ratio: "STD", selected_ratio: "LONG" },
    { previous_ratio: "LONG", selected_ratio: "EXTRA_LONG" },
  ]);
  await denied("select public.set_car_gear_ratio(1,'STD',1)", [], "40001");
  await denied("select public.set_car_gear_ratio(1,'STD',null)", [], "40001");
  await denied("select public.set_car_gear_ratio(1,'INVALID',3)", [], "22023");
  await denied("select public.set_car_gear_ratio(1,null,3)", [], "22023");
  await denied("select public.set_car_gear_ratio(99,'STD',0)", [], "22023");
  assert.equal((await query("select count(*)::int as count from public.car_gear_ratio_history"))[0].count, 5);
  console.log("PASS: actual SQL migration, all selections, independent cars, no-op, optimistic conflict, input validation and audit history.");

  for (const person of people) {
    await login(person);
    for (const carId of [1, 2, 3]) {
      const canView = canAccessCarPages(email(person), carId);
      const canAck = canAcknowledgeGearRatio(email(person), carId);
      const access = (await query("select public.gear_ratio_can_view($1) as view, public.gear_ratio_can_acknowledge($1) as ack, public.gear_ratio_is_chief() as chief", [carId]))[0];
      assert.deepEqual(access, { view: canView, ack: canAck, chief: canChangeGearRatio(email(person)) }, `${person}, car ${carId}: SQL must match TypeScript`);
      assert.equal((await query("select * from public.car_gear_ratio_config where car_id=$1", [carId])).length, canView ? 1 : 0);
      if (canAck) assert.equal(await ack(carId, 1), 1);
      else await denied("select public.acknowledge_car_gear_ratio($1,1)", [carId]);
    }
    if (!canChangeGearRatio(email(person))) await denied("select public.set_car_gear_ratio(1,'STD',3)");
    assert.equal((await query("select * from public.car_gear_ratio_history")).length, person === "dan.crain" ? 5 : 0);
    // Even Chief must use RPCs, so no role can fabricate a version/audit entry.
    for (const table of ["car_gear_ratio_config", "car_gear_ratio_history", "car_gear_ratio_acknowledgements"]) {
      await denied(`delete from public.${table}`);
      await denied(`update public.${table} set car_id=car_id`);
      await denied(`insert into public.${table} (car_id) values (1)`);
    }
  }
  console.log("PASS: real RLS/grants and RPC authorization match every application role and car assignment; direct writes rejected.");

  await login("simon.crain");
  await denied("select public.acknowledge_car_gear_ratio(1,4)", [], "22023");
  await denied("select public.acknowledge_car_gear_ratio(1,0)", [], "22023");
  await denied("select public.acknowledge_car_gear_ratio(1,null)", [], "22023");
  assert.equal(await ack(1, 3), 3);
  assert.equal(await ack(1, 1), 3, "Old device must not regress acknowledgement");
  assert.equal((await query("select * from public.car_gear_ratio_acknowledgements")).length, 1, "Cannot read other users' acknowledgements");
  await login("dan.crain"); await save(1, "STD", 3);
  await login("simon.crain");
  assert.equal(await ack(1, 3), 3, "Acknowledging an older displayed version must not acknowledge a later change");
  const unread = async () => (await query(`select c.version > a.acknowledged_version as changed
    from public.car_gear_ratio_config c join public.car_gear_ratio_acknowledgements a using(car_id) where c.car_id=1`))[0].changed;
  assert.equal(await unread(), true);
  await ack(1, 4);
  assert.equal(await unread(), false);
  await login("olli.moss"); await login("simon.crain");
  assert.equal(await unread(), false, "Acknowledgement persists between sessions");
  await login("jimmy");
  await query("select set_config('request.jwt.claim.email', 'dan.crain@rodinmotorsport.com', false)");
  await denied("select public.set_car_gear_ratio(1,'LONG',4)");
  await db.exec("reset role; set role anon;");
  await denied("select * from public.car_gear_ratio_config");
  await denied("select public.set_car_gear_ratio(1,'LONG',4)");
  await denied("select public.acknowledge_car_gear_ratio(1,4)");
  console.log("PASS: per-user persistence, old-device and change races, invalid/future acknowledgements, forged identity and anonymous access.");
} finally {
  await db.close();
}
