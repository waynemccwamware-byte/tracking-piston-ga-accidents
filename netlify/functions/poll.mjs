// Tracking Piston GA Accidents: the check (scheduled function; no URL).
// v0.29: wakes every 5 minutes but does a full check only when an hour has passed since the last one, or while
// earlier months are still being filled in (then each wake-up fills the next ~10 s worth). So a fill-in finishes in
// minutes, and otherwise it's the same hourly check as before. NTSB data changes at most a few times a day; hourly
// keeps a fatal ping within about an hour of NTSB posting the case. Run on demand in Netlify: Functions > poll > Run now.
import { runPoll } from '../lib/poll-core.mjs';
import { blobs, sinceNow } from '../lib/common.mjs';

export default async (req, context) => {
  const B = blobs(context);
  if (B.ok) {
    const [state, status] = await Promise.all([B.get('cases'), B.get('status')]);
    // a list from before v0.24 has no coveredFrom yet: it's complete only from 01-Oct-2026
    const cov = state ? (state.coveredFrom || ((state.backfillTo || state.backfillDone) ? '2026-10-01' : '')) : '';
    const filling = !!(cov && cov > sinceNow());
    const due = !status || !status.lastRun || Date.now() - Date.parse(status.lastRun) >= 55 * 60e3;
    if (!filling && !due) return;
  }
  const s = await runPoll(context);
  console.log(JSON.stringify(s));
};

export const config = { schedule: '*/5 * * * *' };
