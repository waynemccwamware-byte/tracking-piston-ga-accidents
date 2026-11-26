# Tracking Piston GA Accidents

GeezerGeek Pilot app (draft v0.1, 25-Nov-2026). New US piston fixed-wing accidents from NTSB by
calendar year (this year and last, from 01-Jan-2026; v0.24), a ping on every fatal accident, other pings by severity / type / state, and watches on an
NTSB case or an N-number that ping when NTSB adds or changes something.

Live: https://tracking-piston-ga-accidents.netlify.app/ · Netlify deploys from `main`, publish dir `site/`.
Sister app: GA Accident Stats (https://piston-ga-stats.netlify.app/), linked both ways.

## Files

| Path | What |
|---|---|
| `site/index.html` | the page (App Conventions skeleton; footer blocks written by the Control Panel's `tools/ggp-footer`) |
| `netlify/functions/poll.mjs` | scheduled hourly at :23 UTC: runs the check (`netlify/lib/poll-core.mjs`) |
| `netlify/functions/api.mjs` | page calls: feed, alert profiles, watch lookups, test ping, on-demand check |
| `netlify/lib/common.mjs` | Blobs client, NTSB API calls, case shaping, piston test and type families, email sending (Resend) |

No npm packages and no build step (App Conventions §1).

## Settings on the Netlify site

- `NTSB_API_KEY` (secret, Functions scope): Wayne's developer.ntsb.gov key, same as on piston-ga-stats.
- `RESEND_API_KEY` (secret): Resend API key for email pings (free plan 3,000 a month, 100 a day).
- `PING_FROM` (optional): sender once a domain is verified in Resend; until then the sender is
  onboarding@resend.dev, which Resend delivers only to the Resend account's own address.
  (ntfy push was dropped 25-Nov-2026: its iPhone app showed pings only inside the app.)

## Storage (Netlify Blobs, store `tracking-piston-ga-accidents`)

`cases` (the list), `status` (last check), `users` (profile codes), `user/<code>` (one alert profile:
rules, email, watches with what was last seen, recent pings).

## How the check works

1. Ask NTSB (Common/v2/GetCasesByDateRange, mode=aviation) for the last 14 days of event dates and for cases revised in the last 2 days (Common/v1/GetCasesByModifiedDateRange); first runs backfill from the start gate, 30 days a run, without pinging.
   Start gate (v0.24): 01-Jan of last year, never before 01-Jan-2026 (`sinceFor` in common.mjs); each 01-Jan the oldest year drops off.
   `cases.coveredFrom` = the list is complete from that date. The v0.23 list (from 01-Oct-2026) is filled back to the
   gate 30 days per run, newest month first, quietly. Only a case dated on or after coveredFrom (as it stood at the start
   of the run) that wasn't in the list before pings as new, so a not-yet-filled month never pings.
   Watch pings go out only for a change a pilot would call an update (status, report, docket, probable cause published
   or revised, case closed, injuries); a fingerprint change with none of those is stored without a ping.
2. Keep US cases where NTSB lists an airplane with a reciprocating engine, or, without an engine type,
   a model in GA Accident Stats' piston families (port of `build/families.py`).
3. New cases ping profiles whose rules match (fatal always, unless turned off). The very first run fills
   the list without pinging.
4. Each watched N-number is asked for by tail (`GetAviationCasesFiltered?aircraftRegistrationNumber=`,
   checked 22-Nov-2026); each watched case by number (Aviation/v1/GetAviationCase?ntsbNumber=, checked 25-Nov-2026). A change in status, report type, factual report, docket, report date, probable cause, closure or injury counts pings.

## Email pings (v0.11)

- A new address gets a confirm-your-email link; nothing else is sent to it until the link is clicked
  (profiles saved before v0.11 count as confirmed).
- Every ping and test email ends with a one-click stop link (`?op=unsub`).
- Caps: 12 emails per profile per day and 90 in all per day (Resend free plan: 100 a day); pings over
  a cap are logged in the profile as "Not emailed (daily limit reached)".
- Sender: pings@alerts.wamware.com (domain verified in Resend 25-Nov-2026). `PING_FROM` overrides it.

## Fatal accidents vs. trend (v0.12)

`site/data/trend.json` (built by `tools/build-trend.py` from GA Accident Stats' accidents.json) holds the
month/day of every fatal accident in GA Accident Stats' piston types for the last ten full years. The page
counts this year's fatal accidents in those same types from the start of the stats window to 14 days ago,
and compares them with: straight-line trend of the ten yearly totals carried to this year × the average share
of a year's fatal accidents falling between those dates. Differences smaller than 2 × √expected are labeled
"within normal variation". Rebuild trend.json each January.

## Open items

- FAA preliminary notices (next-day, 10 business days kept): no stable machine-readable URL found yet
  (ASIAS page answered 503 on 25-Nov-2026; faa.gov shows an embedded dashboard).
- Public version: alert profiles are keyed by a code only (like Day's Flight Schedule's sync code).
  A public tool should add a sign-in and a real email sender.
- Mexico and Canada: later.

## Prelim entries (v0.16, 25-Nov-2026)

- **FAA preliminary notices.** The hourly check also reads the CSV export of the FAA's Preliminary Accident and Incident
  Notices dashboard (`netlify/lib/faa-prelim.mjs`; https://explore.dot.gov/t/FAA/views/PrelimininaryAccidentandIncidentReportData/DetailedNotices.csv,
  no sign-in, checked 25-Nov-2026). It covers notices entered in the last 10 business days. The export copies the
  dashboard layout: one notice is ~7 lines joined by `UniqueID`. If the header changes, the check records
  "FAA notices: … layout changed" in its status and carries on.
- Kept: US (state given), event type ACCIDENT, event date from the start gate, and piston airplanes by the same test as
  NTSB cases (`isPiston`) plus an FAA make deny list (`FAA_NOT_PISTON`: helicopters, balloons, drones, HondaJet…).
- Stored in Blobs `cases.prelims` keyed `P-<N-number>-<event date>`. Dropped when NTSB lists a case with the same
  N-number and an event date within 3 days, or after 120 days.
- The page shows them with a PRELIM badge; they are left out of the key stats and trend. No automatic watch
  (Wayne, 25-Nov-2026); a prelim row offers "Watch <N-number>".
- Pings: a fatal prelim entry sends the fatal ping (and matches "other new accidents" rules as Fatal); its NTSB case then
  doesn't ping again as new. The first FAA read was quiet, so the notices already listed then didn't ping; their NTSB
  cases ping as usual.
- **Manual entries** (owner only): section 1, "Add a prelim entry". Owner = profile whose code's SHA-256 is in
  `OWNER_HASHES` in `api.mjs` (Wayne's profile). Ops `prelim-add`, `prelim-del`.
- Also fixed in v0.16: a new NTSB case returned by both the event-date and modified-date queries counted (and
  pinged) twice.
- Also fixed in v0.16: once the first backfill reached the recent window it's marked done (`backfillDone`); before,
  the first run after midnight UTC each day re-entered backfill mode for one day, and that run sent no pings.

## Key stats, trend and chart (v0.24)

One calendar year at a time (year picker when the list holds two; before 15-Jan the page opens on last year).
Fatal accidents and all accidents, each with "n better/worse than trend / on trend" and a year-to-date chart
(inline SVG) of the running count against the trend's expected running count, ± 2√expected shaded. Like for like:
GA Accident Stats' piston types only on both sides; counted to 14 days back. v0.31: All pistons / All singles / All twins
(remembered) and counted like GA Accident Stats' Summary: its piston types, Part 91 (blank Part counts), so the key
stats match that app; homebuilts and other makes stay in the list but not in the key stats. `site/data/trend.json`
carries per-year month/day lists, Part 91, split singles/twins: `fatal.S`, `fatal.T`, `all.S`, `all.T`; rebuild each January with
`python3 tools/build-trend.py <piston-ga-stats>/site/data/accidents.json`.
