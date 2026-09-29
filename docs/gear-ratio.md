# Per-car Gear Ratio

The application previously had no gear ratio configuration or acknowledgement state.
This feature uses the existing Supabase browser client, car workspaces, navigation,
email-based role map and dark UI styling. Gear pairs are defined once in
`lib/gearRatios.ts`; the panel and Complete By summary share the same native dialog.

## Database and deployment

Apply `supabase-gear-ratio.sql` **once before deploying the application changes**.
It requires the existing `public.dashboard_cars(id)` numeric car identifier.
The migration is transactional and creates only feature-specific objects:

- `car_gear_ratio_config`: one selected configuration/version per car; no row means NOT SET.
- `car_gear_ratio_history`: immutable version history with previous/new ratio, user UUID,
  email snapshot and server timestamp. The Chief sees the latest ten entries.
- `car_gear_ratio_acknowledgements`: highest seen version per authenticated user/car.
- Narrow save/acknowledgement RPCs and read policies. Direct client table writes are denied.

No existing RLS policy, car record or workflow record is changed. The user has now
reported that the migration was applied successfully to live Supabase. Read-only
live probes confirmed all three tables and the permission helper reject anonymous
access with PostgreSQL error 42501. The user subsequently authorized committing,
pushing and publishing while skipping the remaining live verification phase.

The SQL functions mirror `lib/userAccess.ts`. Keep both in sync when roles or car
assignments change. Identity comes from `auth.uid()` and the stored `auth.users.email`,
not an email cookie, RPC parameter or editable user metadata.

| Role | View | Change selection | Acknowledge |
| --- | --- | --- | --- |
| Chief Mechanic | All cars + history | Yes | No |
| Number 1 mechanic | Assigned car | No | Own assigned car |
| Number 2 mechanic | Existing restriction: no car workspaces | No | No |
| Engineer / guest | All accessible car workspaces | No | No |
| Unknown / signed out | No | No | No |

Saves serialize on the car row. An expected-version check prevents overwriting an
unseen change; selecting the current ratio preserves its version and audit timestamp.
Configuration and history are written in the same transaction.

## Seeing a change

The sidebar compares the current version with the user's acknowledged version. It
refreshes every 15 seconds while visible, and when the window regains focus/visibility.
Opening the visible Gear Ratio panel acknowledges the displayed version. Sidebar
loading, prefetching and opening Complete By details do not acknowledge anything.
Hidden tabs wait until visible. A subsequent change while the panel is already open
remains flagged until the user clicks Gear Ratio again or Acknowledge change.

Acknowledgements persist in Supabase across login/device changes. They never move
backwards, and acknowledging an older version cannot clear a newer change. Failed
loads/saves/acknowledgements remain visible as errors; a load failure is not NOT SET.

## Verification

Commands run successfully:

```text
node --test tests/gear-ratios.test.mjs
node tests/gear-ratio-db.mjs
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 -p 3101
node tests/gear-ratio-browser.mjs
```

Focused ESLint passed for all new TypeScript components/routes, the permission helper
and all three tests. `npm.cmd run lint` still reports the same **15 errors and 21
warnings** observed before implementation, in existing application and coverage files.
The build also reports the existing Next.js middleware deprecation warning.

The database test executes the actual migration and RLS/RPC operations in disposable
in-memory PostgreSQL via PGlite, with fixture `auth.users`, `auth.uid()` and cars.
It verifies all role mappings, car isolation, direct-write rejection, version conflicts,
input validation, no-op saves, history, acknowledgement persistence and stale versions.
Install its optional runtime separately from application dependencies:

```text
npm.cmd install --prefix coverage/gear-ratio-db --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
```

Browser tests follow the repository's existing headless Chrome/CDP pattern. They run
the built app with intercepted Supabase responses and blocked external/websocket
traffic. They verify all three selections and exact modal contents, deliberate saves,
refresh, separate cars, unread/acknowledgement lifecycle, hidden tabs, failed requests,
Complete By with/without a deadline, NOT SET, role routing, and modal/page sizing at
320, 390, 768 and 1440 pixels. Test fixtures are confined to test code.

Not yet verified against live Supabase: the complete deployed policies/schema,
authenticated role operations, real sessions across devices and concurrent saves.
The latter is protected by the inspected row lock and optimistic version check;
the local database test exercises stale-version conflicts sequentially.
The remaining live workflow check is Chief save → assigned mechanic badge → open
panel → acknowledge, including refresh persistence and a subsequent change.

The follow-up build, TypeScript, focused lint, all gear-ratio tests, Post Event and
clutch browser regressions, and both existing email/PDF test scripts passed. Full
lint remains at 15 errors and 21 warnings. Separate interactive Chief/Car 1 mechanic
browser sessions were prepared for genuine live verification but remained signed
out. The user explicitly waived the remaining test phase and authorized production
publication; authenticated live behaviour is therefore still unverified.

## Files changed

- `lib/gearRatios.ts`
- `lib/userAccess.ts`
- `app/components/GearRatioProvider.tsx`
- `app/components/GearRatioDetails.tsx`
- `app/components/GearRatioPanel.tsx`
- `app/components/ChiefCarNavigation.tsx`
- `app/car/[carId]/layout.tsx`
- `app/car/[carId]/job-list/page.tsx`
- `app/car/[carId]/gear-ratio/page.tsx`
- `app/dashboard/car/[carId]/layout.tsx`
- `app/dashboard/car/[carId]/gear-ratio/page.tsx`
- `supabase-gear-ratio.sql`
- `tests/gear-ratios.test.mjs`
- `tests/gear-ratio-browser.mjs`
- `tests/gear-ratio-db.mjs`
- `docs/gear-ratio.md`

The pre-existing working-tree change to `supabase-post-event-history.sql` was left untouched.
