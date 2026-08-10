# Monark Sales Intelligence Platform

Lead CRM, walk-in / site-visit tracking, and an offline conversion feedback loop
that teaches Meta and Google what a genuinely valuable prospect looks like —
rather than what a cheap form fill looks like.

## The one thing to understand first

**Google expires a GCLID 90 days after the click.** Offline conversions uploaded
after that are silently discarded — no error, no partial credit, they simply
never attribute.

A ₹2.5–4 crore apartment does not sell in 90 days. Enquiry → site visit → family
decision → finance → token → booking routinely runs 60–180 days. So a large
share of **bookings will fall outside the window and can never be credited to
the click that produced them**, no matter how good this CRM is.

That single fact drives the architecture:

| | Strategy |
|---|---|
| **Optimise ad delivery on** | `lead_qualified`, `site_visit_completed` — real quality signal, enough monthly volume for a learning phase, reliably inside 90 days |
| **Send but don't bid on** | `token_paid`, `booking_confirmed` — the real outcome, but a handful per month and frequently past the window |
| **Never send** | disqualified leads, spam, test submissions, anyone without consent |

Optimising campaigns on six bookings a year is how you get erratic delivery and
a conclusion that "Google doesn't work". Full reasoning in
[docs/attribution-strategy.md](docs/attribution-strategy.md).

## Architecture

```
Website · Landing pages · Meta Lead Ads · WhatsApp · Portals · Walk-ins · CSV
                              │
                              ▼
                    POST /v1/leads          ← one door for every source
                     HMAC + idempotency
                              │
                              ▼
              Normalise → Resolve identity → Consent
                              │
                              ▼
                    ┌─────────────────┐
                    │    Postgres     │  append-only stage/touchpoint history
                    └────────┬────────┘
                             │  (same transaction)
                             ▼
                     Conversion outbox
                             │
                             ▼
                    Worker · SKIP LOCKED
                    backoff · eligibility gate
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
        Meta CAPI                  Google Data Manager API
        (dataset)                  (events:ingest)
```

The outbox is not incidental. Business code **never** calls Meta or Google
inline: if it did, either the HTTP call happens before commit (and a rolled-back
transaction has already told Meta about a site visit that never happened), or
after commit (and a crash loses the conversion with no record it was owed).
Writing intent to the same database in the same transaction makes it atomic.

## Layout

Runs on **Supabase** (Postgres) and **Vercel** (functions + cron). No Docker.

```
api/                      Vercel entry points
  index.ts                  → Hono app, handles /v1/* and /health
  cron/outbox.ts            → outbox drain, invoked by Vercel Cron
packages/
  core/          normalisation, hashing, identity resolution, stage machine,
                 attribution windows, eligibility gate, value model   [46 tests]
  db/            Drizzle schema + migrations (31 tables), Supabase pooling
  connectors/    Meta CAPI + Google Data Manager adapters             [16 tests]
  services/      ingestLead, emitConversionEvent, outbox processor, crypto
  web-snippet/   drop-in JS that captures click IDs before they're lost
apps/
  api/           the Hono app + a local dev server
  web/           authenticated Next.js sales dashboard + public /v1 proxy
  worker/        optional long-lived worker, for non-Vercel hosting
```

Vercel cannot host a persistent process, so the outbox worker becomes a
cron-invoked function with a wall-clock budget: it stops claiming new work
before Vercel kills it and explicitly releases anything it did not reach, rather
than stranding rows as `in_flight`.

## Setup

```bash
pnpm install
```

Create a Supabase project (put it in `ap-south-1`, and Vercel in `bom1` — every
serverless invocation opens a fresh connection, so a cross-region hop taxes
every single request).

```bash
cp .env.example .env
```

Generate the secrets:

```bash
echo "SESSION_SECRET=$(openssl rand -base64 48)"; echo "CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)"; echo "CRON_SECRET=$(openssl rand -hex 32)"
```

Then fill in **two** Supabase connection strings — they are not interchangeable:

- `DATABASE_URL` — **transaction** pooler, port 6543. Runtime.
- `DIRECT_URL` — **session** pooler, port 5432. Migrations only, because DDL
  needs a stable session. Use the pooler host, not `db.<ref>.supabase.co`, which
  is IPv6-only and silently breaks CI.

```bash
pnpm db:migrate && pnpm db:seed
```

The seed prints an API key **once**. Store it — only its hash is kept.

```bash
pnpm dev
```

Full deployment walkthrough, including the Vercel cron plan requirement, is in
[docs/deployment.md](docs/deployment.md).

## Dashboard

The deployed dashboard is a responsive sales operating system, not a read-only
report. Role-gated workflows are available for:

- overview trends, funnel, attribution health and team performance;
- direct lead capture, deduplicated customer records, pipeline and complete
  lead timelines;
- today queues, follow-up tasks, office walk-ins and scheduled/completed site
  visits;
- unit inventory and holds, lead shortlists, negotiations, bookings, token and
  subsequent payments, refunds and cancellation;
- campaign/creative outcomes, commercial reports and the Meta/Google delivery
  log;
- users, projects, sources, API keys, encrypted integration credentials and
  conversion-event mappings.

The fastest operational entry points are:

```text
/leads/new       direct customer / opportunity capture
/walk-ins/new    offline-capable fresh walk-in capture
/site-visits     schedule, confirm, arrive, complete, no-show or cancel
/settings/sources website endpoint, hosted snippet and source health
```

The walk-in form uses a service worker plus a small, bounded local queue. If a
salesperson loses connectivity at the site, the same idempotent submission is
retried when the device reconnects instead of creating another lead.

## Sending a lead

Production endpoint:

```text
POST https://monark-sales-dashboard-api.vercel.app/v1/leads
```

```bash
curl -X POST https://monark-sales-dashboard-api.vercel.app/v1/leads \
  -H "Authorization: Bearer mk_live_xxxx_yyyy" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: form-873278" \
  -d '{"name":"Ravi Kumar","phone":"9876543210","email":"ravi@example.com","source":"website_form","utm_campaign":"windwave_4bhk","gclid":"Cj0KCQ...","consent":{"marketing":true,"ad_user_data":true,"ad_personalization":true}}'
```

```json
{
  "lead_id": "…",
  "lead_reference": "LD-2026-000001",
  "status": "created",
  "is_duplicate": false,
  "spam_score": 0,
  "attribution_expires_at": "2026-11-08T00:00:00.000Z"
}
```

`attribution_expires_at` is the 90-day clock. It is returned deliberately: it is
the deadline the entire feedback loop runs on.

For websites, use the hosted snippet instead of hand-rolling the call — it
handles first/last-touch capture, explicit consent and idempotent retry behavior
that a form-time URL read misses:

```html
<script
  src="https://monark-sales-dashboard-api.vercel.app/monark.js"
  data-endpoint="https://monark-sales-dashboard-api.vercel.app/v1/leads"
  data-key="mk_live_xxxx_yyyy"
  defer
></script>
```

## Going live with conversions

Destinations ship **disabled and in dry-run**, and that default is deliberate:
there is no way to retract a conversion once a platform has recorded it, and a
week of malformed events degrades Smart Bidding for longer than it takes to
notice.

1. Fill in real credentials on each destination.
2. Leave `dryRun = true`. Payloads are built, validated and logged in full —
   Google's dry-run is a real round trip using `validateOnly`, so it exercises
   auth and validation without recording anything.
3. Inspect `conversion_delivery_attempts` and confirm the payloads look right.
4. Set `isEnabled = true`, then `dryRun = false`.
5. Watch match quality and outbox lag for a week.

## Operational alarms

**Outbox lag is a data-loss alarm, not a latency metric.** Meta rejects any
event whose `event_time` is more than 7 days old — and rejects the *entire
request*, not just the stale event. A queue stuck for a week destroys those
conversions permanently while every dashboard still looks healthy.

So the drain handler deliberately returns **500** on excessive lag, which
cron-job.org treats as a failed execution and notifies on.

The drain is scheduled by **cron-job.org**, not Vercel Cron — which means this
runs fine on Vercel Hobby. cron-job.org aborts at 30s, so
`OUTBOX_TIME_BUDGET_MS` is 20s and the job runs every 2 minutes. A longer budget
would not lose data (the function keeps running after the abort) but would
report every run as failed, and a permanently-red alert is one you stop reading.

**Supabase RLS is enabled on every table with no policies** (migration `0002`).
Supabase auto-exposes PostgREST over `public` using the anon key — a key
designed to ship in your frontend bundle — so without this, viewing source on
the Monark website would expose every buyer's phone number, budget and booking
value. Server code is unaffected: it connects as the table owner, which bypasses
RLS. Add org-scoped policies when the dashboard needs client-side reads.

## Tests

```bash
pnpm test
```

96 workspace tests, concentrated on the places where a bug is **silent**: phone/email
normalisation and PII hashing (wrong format = 0% match rate, no error anywhere),
identity resolution (over-merging combines two real buyers), attribution window
arithmetic, the eligibility gate, authorization/validation, integration
configuration and browser-form retry/consent behavior. The standalone snippet
suite runs with:

```bash
node --test packages/web-snippet/monark.test.cjs
```

That adds 8 browser-snippet tests, for 104 automated checks in the release
gate. Browser API keys are bearer-only by design; server API keys require the
timestamped `X-Monark-Signature` HMAC shown when the key is created.

Note that Meta and Google normalise phone numbers **differently** — Meta wants
digits only, Google wants E.164 with the leading `+`. There is a test pinning
that divergence, and it is the first thing to check if match rates look wrong.

## External rollout dependencies

The dashboard and universal lead contract are live. These provider-bound jobs
remain deliberate rollout items because they require account-specific access,
reviewed field mappings and production credentials rather than UI code alone:

- direct Meta Lead Ads and WhatsApp webhook receivers (both can already post
  their normalized payloads through `/v1/leads`);
- scheduled Meta Insights / Google Ads spend imports (the reporting tables and
  campaign/creative outcome views are ready for the feed);
- nightly value-model recomputation and automated speed-to-lead escalation.

Until each provider is configured, keep conversion destinations disabled and
in dry-run. Do not treat a successful local credential validation as a live API
round trip.
