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
| `netlify/lib/common.mjs` | Blobs client, NTSB API calls, case shaping, piston test and type families, ntfy |

No npm packages and no build step (App Conventions §1).

## Settings on the Netlify site

- `NTSB_API_KEY` (secret, Functions scope): Wayne's developer.ntsb.gov key, same as on piston-ga-stats.
- `NTFY_TOKEN` (optional, secret): access token of an ntfy.sh account with a verified email address.
  Needed only for email pings; ntfy.sh sends email only for signed-in accounts, 5 a day on the free plan.

## Storage (Netlify Blobs, store `tracking-piston-ga-accidents`)

`cases` (the list), `status` (last check), `users` (profile codes), `user/<code>` (one alert profile:
rules, push/email, watches with what was last seen, recent pings).

## How the check works

1. Ask NTSB for every case with an event date from 01-Oct-2026 to today (query names in `RECENT_QUERY`).
2. Keep US cases where NTSB lists an airplane with a reciprocating engine, or, without an engine type,
   a model in GA Accident Stats' piston families (port of `build/families.py`).
3. New cases ping profiles whose rules match (fatal always, unless turned off). The very first run fills
   the list without pinging.
4. Each watched N-number is asked for by tail (`GetAviationCasesFiltered?aircraftRegistrationNumber=`,
   checked 22-Nov-2026). A change in status, report date, probable cause, closure or injury counts pings.

## Open items

- FAA preliminary notices (next-day, 10 business days kept): no stable machine-readable URL found yet
  (ASIAS page answered 503 on 25-Nov-2026; faa.gov shows an embedded dashboard).
- Public version: alert profiles are keyed by a code only (like Day's Flight Schedule's sync code).
  A public tool should add a sign-in and a real email sender.
- Mexico and Canada: later.
