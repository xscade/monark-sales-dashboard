# Attribution strategy

Why this platform optimises on site visits rather than bookings, and what it
costs you if you do the obvious thing instead.

## The constraint

Two hard, externally-imposed deadlines govern everything:

| Platform | Rule | Consequence |
|---|---|---|
| **Google** | GCLID expires **90 days** after the click | Offline conversions uploaded later are silently dropped. No error. |
| **Meta** | `event_time` may not exceed **7 days** at send time | The **entire request** is rejected, not just the stale event. |

These are different kinds of problem and need different responses.

Google's is a **business-model** problem: your sales cycle is longer than their
attribution window, and no amount of engineering fixes that.

Meta's is an **operational** problem: it is entirely within your control, and it
turns outbox lag into permanent data loss.

## Why bookings cannot be the optimisation event

Take a realistic distribution of days from first touch to booking for a ₹3 crore
apartment:

```
45   60   88   95   120   140   210
└──── inside 90d ────┘   └──── lost ────┘
        3 of 7                4 of 7
```

Roughly **half your bookings are unattributable to Google**, structurally. Feed
that into campaign optimisation and Google learns from a biased sample: it sees
only the *fast* buyers. Fast buyers are systematically different — smaller
families, fewer decision-makers, often investors rather than end-users. You will
quietly optimise toward the wrong customer.

There is a second, independent problem. Meta and Google both need roughly
**30+ conversions per month** for a campaign to exit the learning phase. Monark
books a handful of units a month. A campaign optimising on 6 events/month never
stabilises; delivery stays erratic and CPMs stay high.

So bookings fail on both counts: biased sample *and* insufficient volume.

## What to optimise on instead

Pick the **deepest** event that satisfies all three:

1. ≥ ~30/month, so the learning phase converges
2. median time-to-event comfortably inside 90 days
3. genuinely correlated with booking

For a project at Monark's stage that is almost always:

```
Start here ──────────► Graduate to ──────────► Never bid on
lead_qualified         site_visit_completed    booking_confirmed
~3 days                ~18 days                ~75 days
good volume            strong signal           real outcome, tiny volume
```

`recommendOptimizationEvent()` in `packages/core/src/conversions/value-model.ts`
computes this from your own data rather than from the table above, and should be
re-run quarterly. It deliberately refuses to recommend an event whose monthly
volume cannot sustain a learning phase.

**Still send bookings.** They are what calibrates the value model and what makes
the cost-per-booking report real. Just don't ask an ad platform to bid on them.

## Conversion values

Every event carries a value in the same unit — expected rupees of revenue:

```
value(stage) = P(booking | reached stage) × expected sale value
```

That lets the platforms trade events off against each other honestly. The
alternative — inventing a ladder like "walk-in ₹100, booking ₹10,000" — does not
describe a slightly-wrong economy, it describes one that does not exist, and
value-based bidding will optimise against it with total confidence.

Probabilities come from your own pipeline history, shrunk toward a prior:

```
p̂ = (bookings + α) / (reached + α + β)
```

At real-estate volumes this matters enormously. Three site visits and one
booking is **not** a 33% conversion rate — it is four data points. Without
shrinkage the value of a site visit swings wildly month to month and drags your
bidding with it.

The estimator also **forces monotonicity**: a lead that has paid a token cannot
be less likely to book than one that has merely visited. Sampling noise will
produce inversions at low volume, and an inverted ladder actively teaches the
platforms that deeper funnel stages are worth *less*.

## Guarding the identifiers

The 90-day clock starts at the **click**, not at form submission. That matters
because the common journey is:

```
click ad → browse → leave
   …3 days later…
type the domain directly → fill the form
```

A form that reads the current URL sees no `gclid` and reports an organic lead.
`packages/web-snippet/monark.js` captures on first touch and persists for 90
days, with **first touch winning** for click IDs — the original click earned the
demand; overwriting it hands every conversion to whichever retargeting campaign
touched the user last.

Also capture, because each closes a real hole:

- `gbraid` / `wbraid` — iOS and app-to-web Google flows, a growing share
- `ctwa_clid` — click-to-WhatsApp ads, otherwise completely invisible to the CRM
- `fbp` / `fbc` — materially raise Meta's match quality
- `event_id` — shared with the browser Pixel, or Meta counts every enquiry twice

## Reporting honestly

Do not show this:

| Campaign | Leads | CPL |
|---|---|---|
| Meta A | 412 | ₹1,238 |
| Google B | 84 | ₹2,857 |

Show this:

| | Meta A | Google B |
|---|---|---|
| Spend | ₹5.1L | ₹2.4L |
| Leads | 412 | 84 |
| Qualified | 78 | 31 |
| Site visits | 12 | 8 |
| Bookings | 1 | 3 |
| Cost / lead | ₹1,238 | ₹2,857 |
| **Cost / site visit** | **₹42,500** | **₹30,000** |
| **Cost / booking** | **₹5,10,000** | **₹80,000** |

The "expensive" Google leads are six times more profitable. A CPL-only dashboard
hides that completely — and CPL is exactly what Ads Manager shows you by default.

Alongside it, report **attribution loss** explicitly:

> 7 bookings this quarter · 3 attributable · 4 outside Google's 90-day window

Being honest about this number up front prevents a far worse outcome six months
from now: someone comparing platform-reported bookings to CRM bookings,
concluding the ads don't work, and cutting the budget that was working.
