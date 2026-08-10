# Deployment — Supabase + Vercel

No Docker anywhere. Local development connects to a hosted Supabase project.

## 1. Supabase

Create two projects — `monark-dev` and `monark-prod`. Sharing one between local
development and production means a bad seed or a stray `DELETE` during
development lands on live customer data.

**Choose the region deliberately.** Put Supabase in `ap-south-1` (Mumbai) and
Vercel in `bom1`. Every serverless invocation opens a fresh connection, so a
cross-continent hop adds 200–300ms to *every* request — enough to turn a fast
API into a slow one for reasons that never show up in application code.

### Connection strings

Project Settings → Database → Connection string. You need **two**, and they are
not interchangeable:

| Variable | Which string | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | **Transaction** pooler | 6543 | API + cron at runtime |
| `DIRECT_URL` | **Session** pooler | 5432 | migrations, seeds |

Both live on `aws-0-<region>.pooler.supabase.com`.

Two traps worth naming:

- **Do not use `db.<ref>.supabase.co` for `DIRECT_URL`.** Direct connections are
  IPv6-only on newer Supabase projects, which silently breaks GitHub Actions and
  most CI runners. Use the session pooler host instead.
- **Do not point `DIRECT_URL` at 6543.** The transaction pooler hands each
  statement a different backend, so `CREATE TYPE` followed by a `CREATE TABLE`
  using that type can land on separate connections and fail in ways that look
  random. `drizzle.config.ts` throws if you try.

### Migrate and seed

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

The seed prints an API key **once** — only its hash is stored.

### Verify RLS

Migration `0002` enables Row Level Security on every table with no policies.
This matters more than it sounds: Supabase auto-exposes a PostgREST endpoint
over `public`, reachable with the **anon key, which is designed to be published
in your frontend bundle**. Without RLS, anyone who views source on the Monark
website can read every buyer's name, phone, budget and booking value.

Confirm it took effect:

```bash
psql "$DIRECT_URL" -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity;"
```

Zero rows is correct. Server-side code is unaffected — it connects as the table
owner, and owners bypass RLS.

## 2. Vercel

Import the repo. Because `api/` and `vercel.json` sit at the repository root,
**no Root Directory or build settings need changing** — Vercel detects the
functions and installs the pnpm workspace itself.

### Environment variables

Set for Production **and** Preview:

```
DATABASE_URL                 transaction pooler, :6543
DIRECT_URL                   session pooler, :5432
CREDENTIALS_ENCRYPTION_KEY   openssl rand -base64 32
SESSION_SECRET               openssl rand -base64 48
CRON_SECRET                  openssl rand -hex 32
CONVERSIONS_DRY_RUN          true
OUTBOX_LAG_ALERT_MINUTES     180
OUTBOX_TIME_BUDGET_MS        240000
```

`CREDENTIALS_ENCRYPTION_KEY` is not rotatable in place — every stored Meta token
and Google service-account key is encrypted with it and unrecoverable without
it. Back it up somewhere that is not this repository.

`CRON_SECRET` is not optional. The cron handler fails closed when it is unset,
because an open `/api/cron/outbox` lets anyone force a drain — and a forced
drain against a misconfigured destination burns the retry budget on permanent
errors.

### Why vercel.json looks the way it does

`vercel.json` is strict JSON with **no additional properties** — comment keys
like `"// note"` fail schema validation outright, so the reasoning lives here
instead.

- **`framework: null`** — explicit rather than omitted, so Vercel never
  misdetects a framework from something in the workspace.
- **`buildCommand`** is a deliberate no-op. `@vercel/node` compiles `api/*.ts`
  itself; there is nothing else to build. Leaving it unset makes Vercel run the
  root `build` script instead, and a recursive workspace build that produces no
  output is an easy way to fail a deploy for no reason.
- **`outputDirectory: "public"`** — the directory must exist or the deploy fails
  with *"No Output Directory found"*. It holds a small static status page, which
  doubles as the first rung of the diagnostic ladder below.
- **No rewrite for `/api/*`** — filesystem routing already serves those
  functions directly. An identity rewrite there is at best a no-op and at worst
  a loop.
- **No `export const config` in the function files.** Runtime and `maxDuration`
  are declared once, here. An unrecognised `runtime` value makes the builder
  skip the function entirely, which presents as a 404 on every route with
  nothing in the logs to explain it.

### If every route returns 404

A 404 on `/api/index` itself is not a routing problem — it means no function was
deployed. Work down this ladder:

| Symptom | Cause |
|---|---|
| `/` shows the status page, `/health` returns JSON | Working. |
| `/` shows the page, `/health` 404s | Static deployed, functions did not build. Check the build log for `api/index.ts`. |
| `/` also 404s | The deploy is not landing at all. Check **Root Directory** first. |

**Root Directory must be blank** (Settings → General). The deployment surface —
`api/` and `vercel.json` — lives at the repository root. Pointing Root Directory
at `apps/api` means Vercel never sees either file, and every route 404s.

### Deployment Protection must be off for Production

Vercel's Deployment Protection intercepts requests before your function runs and
returns an HTML login page. cron-job.org would receive a `401` on every
execution and no drain would ever happen.

Production deployments are public by default, so usually nothing to do — but if
you have enabled protection, either disable it for Production or generate a
**Protection Bypass for Automation** secret and add it to the cron job as an
`x-vercel-protection-bypass` header alongside the Authorization header.

## 3. Scheduling with cron-job.org

Vercel Cron is not used. cron-job.org schedules the drain, which means this
project runs fine on **Vercel Hobby** — Hobby only permits daily Vercel crons,
which would be far too coarse to trust.

### Create the job

| Field | Value |
|---|---|
| URL | `https://<your-app>.vercel.app/api/cron/outbox` |
| Schedule | every **2 minutes** |
| Request method | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Notifications | enable on failure |
| Save responses | on — the JSON body is the drain report |

The header goes in the job's **Advanced / Headers** section. `CRON_SECRET` must
be the same value you set in the Vercel environment variables.

### Why 2 minutes and a 20-second budget

**cron-job.org aborts the connection at 30 seconds.** That number, not Vercel's
`maxDuration`, is what sizes the work.

The subtlety worth understanding: when cron-job.org aborts, the Vercel function
**keeps running**. So a 60- or 240-second budget would not lose data — the drain
would complete — but every single execution would be reported as *failed*. The
failure notification becomes constant noise, you mute it, and the lag alarm that
actually matters stops working.

So `OUTBOX_TIME_BUDGET_MS=20000` finishes comfortably inside the abort window,
leaving ~10s for the lag query and response. Anything the budget did not reach
is explicitly released back to `pending` and picked up 2 minutes later.

Frequency was never the real constraint — Meta's limit is 7 days. Honest
success/failure signalling is.

### Why the drain returns 500

On excessive lag the handler responds `500`, which cron-job.org treats as a
failed execution and notifies you about. This is deliberate.

Outbox lag is a **data-loss alarm**, not a latency metric. Meta rejects any
request containing an event older than 7 days — and rejects the *entire
request*, not just the stale event. A queue quietly backing up for a week has
permanently destroyed those conversions, and every dashboard will still look
healthy while it happens.

### Test before you schedule

Locally — the dev server mounts the identical handler:

```bash
curl -i -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env | cut -d= -f2)" http://localhost:3001/api/cron/outbox
```

Against the deployment:

```bash
curl -i -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/cron/outbox
```

Expect `200` with a JSON drain report. A `401` means the token is wrong or
`CRON_SECRET` is unset in Vercel — the handler fails closed rather than running
unauthenticated. HTML instead of JSON means Deployment Protection is on.

### If you outgrow it

`apps/worker` is the same processing logic driven by a loop rather than a
schedule — deployable to Fly, Railway or any small VM for sub-minute delivery.
Running it *alongside* the cron is safe: the claim query uses
`FOR UPDATE SKIP LOCKED`, so the two take disjoint work.

## 4. Local development

```bash
cp .env.example .env
```

Fill in the `monark-dev` connection strings, then:

```bash
pnpm dev
```

The API listens on `:3001`. `apps/api/src/app.ts` holds the Hono app with no
server binding, so the same code serves both `src/server.ts` locally and
`api/index.ts` on Vercel — no build-time branching.

To drain the outbox by hand:

```bash
pnpm --filter @monark/worker once
```

## 5. Going live with conversions

Destinations ship **disabled and in dry-run**, and that default is load-bearing:
a conversion cannot be retracted once a platform records it, and a week of
malformed events degrades Smart Bidding for longer than it takes to notice.

1. Fill in real credentials on each destination row.
2. Leave `dry_run = true`. Google's dry-run is a real round trip using
   `validateOnly`, so it genuinely exercises auth and payload validation.
3. Inspect `conversion_delivery_attempts` and read the payloads.
4. `is_enabled = true`, then `dry_run = false`.
5. Watch match quality and outbox lag for a week.

## 6. Connection budget

Supabase's free tier allows 60 pooled connections; Pro allows 200. Each warm
Vercel instance holds **one** (`max: 1` in `packages/db/src/client.ts`), which is
why that setting is not a tuning knob — raising it multiplies by instance count
and starts returning "max clients reached" under exactly the traffic you wanted
to serve.

If you see connection exhaustion, the fix is fewer concurrent instances or a
larger Supabase plan, not a bigger pool.
