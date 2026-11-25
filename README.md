# Tracking Piston GA Accidents

GeezerGeek Pilot app (draft v0.1, 25-Nov-2026). New US piston fixed-wing accidents from NTSB since
01-Oct-2026, a ping on every fatal accident, other pings by severity / type / state, and watches on an
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

1. Ask NTSB (Common/v2/GetCasesByDateRange, mode=aviation) for the last 14 days of event dates and for cases revised in the last 2 days (Common/v1/GetCasesByModifiedDateRange); first runs backfill 01-Oct-2026 on, 10 days a run, without pinging.
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

## Open items

- FAA preliminary notices (next-day, 10 business days kept): no stable machine-readable URL found yet
  (ASIAS page answered 503 on 25-Nov-2026; faa.gov shows an embedded dashboard).
- Public version: alert profiles are keyed by a code only (like Day's Flight Schedule's sync code).
  A public tool should add a sign-in and a real email sender.
- Mexico and Canada: later.
