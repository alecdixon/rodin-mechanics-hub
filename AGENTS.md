<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
# Rodin Mechanics Hub — Codex Instructions

## Project overview

This repository contains the Rodin Mechanics Hub, a motorsport operations application used by mechanics and engineers.

Technology:

- Next.js App Router
- TypeScript
- React
- Supabase
- Vercel

Before making changes, inspect the existing implementation, relevant routes,
components, database queries and types. Follow established repository patterns.

## Core functionality

Important areas include:

- Role-based authentication and routing
- Chief mechanic dashboard
- Workshop Job Lists
- Evening Preparation Job Lists
- Team Jobs
- Drain Out records
- Surface Table Checks
- Plank Legality
- Clutch Measurements
- Recorded Issues
- Sticker Lists
- Post-Event Checks
- Generated reports and browser-viewable records

## Roles and permissions

Existing roles include:

- chief_mechanic
- number1_mechanic
- number2_mechanic
- engineer
- guest

Preserve existing role permissions and routing behaviour.

Do not rename, merge or simplify roles without explicit approval.

Guest users must remain read-only.

## Engineering rules

- Understand and explain the root cause before applying a fix.
- Make the smallest reliable change needed.
- Reuse existing components, utilities, types and design patterns.
- Do not perform unrelated refactoring.
- Preserve existing styling unless a visual change is requested.
- Preserve compatibility with existing stored records.
- Do not add mock data, placeholders or incomplete implementations.
- Do not hide errors with silent fallback behaviour.
- Do not edit timestamped .bak files.
- Treat route.ts, page.tsx and other normal tracked files as active code.
- Preserve unrelated uncommitted user work.

## Supabase and database safety

- Do not modify the database schema without explicit approval.
- Do not create or run migrations without explicit approval.
- Do not alter Row Level Security policies without explicit approval.
- Do not delete, rewrite or bulk-update production records.
- Inspect existing table and column names before writing queries.
- Clearly identify when a requested change requires database work.

## Secrets

- Never display or copy secret values.
- Do not print the contents of .env or .env.local files.
- Do not edit environment files unless explicitly instructed.
- Never put credentials, tokens or service-role keys into source code.

## Commands requiring explicit approval

Do not run these unless explicitly instructed:

- git commit
- git push
- force push
- branch deletion
- vercel --prod
- production deployments
- Supabase migrations
- destructive database commands
- bulk file deletion
- git reset --hard
- git clean -fd
- installation of new production dependencies

## Validation

After changing code:

1. Review the complete Git diff.
2. Run the most relevant focused checks.
3. Run npm run build.
4. Run lint if the repository has a lint command.
5. Resolve TypeScript errors caused by the change.
6. Check related roles and routes for regressions.
7. Confirm no secrets appear in the diff.

Do not claim something works unless it was verified.

Clearly distinguish between:

- verified by a successful test or command
- inspected but not executed
- not verifiable locally

## Completion report

At the end of every task, report:

- Root cause
- Implemented solution
- Every file changed
- Commands and checks run
- Whether the build passed
- Remaining risks or unverified behaviour
- Any database or deployment action still required

Do not commit, push or deploy unless explicitly instructed.
