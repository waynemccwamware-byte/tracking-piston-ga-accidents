// Tracking Piston GA Accidents: hourly check (scheduled function; no URL).
// Runs at :23 past every hour UTC. NTSB data changes at most a few times a day; hourly keeps a fatal
// ping within about an hour of NTSB posting the case. Run on demand in Netlify: Functions > poll > Run now.
import { runPoll } from '../lib/poll-core.mjs';

export default async (req, context) => {
  const s = await runPoll(context);
  console.log(JSON.stringify(s));
};

export const config = { schedule: '23 * * * *' };
