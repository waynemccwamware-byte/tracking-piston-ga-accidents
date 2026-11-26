// The check that finds new accidents and changes on watched ones, then sends the pings.
// Run hourly by netlify/functions/poll.mjs (scheduled) and on demand by api.mjs (?op=refresh, throttled).
//
// Blobs keys (store tracking-piston-ga-accidents):
//   cases       {asOf, cases:{<ntsb>: slim case + fp}, prelims:{<P-reg-date>: prelim entry}}
//               every piston fixed-wing US case since SINCE, plus prelim entries NTSB hasn't listed yet (v0.16)
//   status      {lastRun, ok, error, counts, note}
//   users       [codes]                                    index of alert profiles
//   user/<code> {code, email, emailOn, rules, watches, log}  one alert profile (see api.mjs)

import {
  blobs, SINCE, APP_URL, casesByEventDate, casesModified, caseByNumber, casesForTail, slimCase, isPiston, fingerprint,
  sendEmail, unsubUrl, CAP_DAY_ALL, CAP_DAY_PROFILE, caseLine, injuryText, reportPdf, fmtDate, tailKey, family,
} from './common.mjs';
import { fetchFaaNotices, FAA_NOT_PISTON, FAA_PAGE, prelimId } from './faa-prelim.mjs';

// v0.16 prelim entries: FAA preliminary notices (and Wayne's manual ones) for accidents NTSB hasn't listed yet.
// Shown with a PRELIM badge, left out of the key stats and trend, and dropped once NTSB lists a case with the
// same N-number and an event date within 3 days (or after 120 days).
export const PRELIM_MATCH_DAYS = 3, PRELIM_KEEP_DAYS = 120;
export function prelimFromNotice(n) {
  const fam = family(n.make, n.model);
  return { prelim: true, id: prelimId(n.reg, n.date), src: 'FAA', srcUrl: FAA_PAGE, entered: n.entered || '', date: n.date,
    reg: n.reg, make: n.make, model: n.model, city: n.city, st: n.st, type: n.type || 'ACCIDENT', fatal: !!n.fatal,
    brand: fam[0] || '', fam: fam[1] || '' };
}
export function prelimIsPiston(n) {
  const mk = String(n.make || '').toUpperCase();
  if (FAA_NOT_PISTON.test(mk)) return false;
  const fam = family(n.make, n.model);
  return isPiston({ cat: '', engType: '', make: n.make || '', model: n.model || '', fam: fam[1] || '' });
}
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const prelimLine = p => `${fmtDate(p.date)} ${p.reg} ${p.make} ${p.model}, ${p.city}${p.st ? ', ' + p.st : ''}`;

const US = s => !s || /^(US|USA|UNITED STATES)$/i.test(s);
const today = () => new Date().toISOString().slice(0, 10);

export function matchesRules(c, r) {
  if (!r || !r.newOn) return false;
  const sev = c.fatal ? 'Fatal' : c.serious ? 'Serious' : c.minor ? 'Minor' : 'None';
  if (Array.isArray(r.sev) && r.sev.length && !r.sev.includes(sev)) return false;
  if (Array.isArray(r.fams) && r.fams.length && !r.fams.includes(c.fam)) return false;
  if (Array.isArray(r.states) && r.states.length && !r.states.includes(c.st)) return false;
  return true;
}

const describeChange = (o, c) => {
  const bits = [];
  if (!o) return ['new NTSB case ' + c.ntsb];
  if (o.status !== c.status) bits.push(`status ${o.status || '—'} → ${c.status || '—'}`);
  if (o.profile !== c.profile && c.profile) bits.push(`${c.profile.toLowerCase()} report posted`);
  if (o.factual !== c.factual && c.factual) bits.push('factual report posted');
  if (o.docket !== c.docket && c.docket) bits.push('public docket opened');
  if (o.reportDate !== c.reportDate && c.reportDate) bits.push(`report dated ${fmtDate(c.reportDate)}`);
  if (!o.pc && c.pc) bits.push('probable cause published');
  if (!o.closed && c.closed) bits.push('case closed');
  if (o.fatal !== c.fatal || o.serious !== c.serious) bits.push(`injuries now ${injuryText(c)}`);
  return bits.length ? bits : ['details updated'];
};

export async function runPoll(context, { silent = false } = {}) {
  const B = blobs(context);
  const started = new Date().toISOString();
  const status = { lastRun: started, ok: false, error: '', counts: {}, note: '' };
  if (!B.ok) { status.error = 'Blobs unavailable'; return status; }

  const state = (await B.get('cases')) || { asOf: null, cases: {}, backfillTo: null };
  const prior = state.cases || {};
  const now = { ...prior };
  const fresh = [], changed = [];
  const day = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const T = today();

  // Every run stays inside the 30 s a scheduled function gets:
  //   a) backfill: until it reaches 14 days ago, the next 30 days of event dates from 01-Oct-2026 (silent)
  //   b) the last 14 days by event date (new cases; NTSB usually lists a case days after the event)
  //   c) cases NTSB created or revised in the last 2 days (catches changes to older cases in the list)
  // Pings only start once the backfill is done, so the first runs don't ping weeks of old accidents.
  const recentFrom = day(T, -14);
  const backfilling = !state.backfillTo || state.backfillTo < recentFrom;
  const take = (raw, quiet) => raw.forEach(rc => {
    const c = slimCase(rc);
    if (!c.ntsb || c.date < SINCE || !US(c.country) || (c.mode && !/aviation/i.test(c.mode)) || !isPiston(c)) return;
    c.fp = fingerprint(c);
    const o = prior[c.ntsb];
    now[c.ntsb] = c;
    if (quiet) return;
    // a new case usually comes back from both the event-date and the modified-date query: count it once (v0.16 fix)
    if (!o) { if (!fresh.some(x => x.ntsb === c.ntsb)) fresh.push(c); }
    else if (o.fp !== c.fp && !changed.some(([, x]) => x.ntsb === c.ntsb)) changed.push([o, c]);
  });
  const errs = [];
  try {
    if (backfilling) {
      const from = state.backfillTo ? day(state.backfillTo, 1) : SINCE;
      const to = [day(from, 29), recentFrom].sort()[0];
      take(await casesByEventDate(from, to), true);
      state.backfillTo = to;
      status.counts.backfill = `${from} to ${to}`;
    }
  } catch (e) { errs.push('backfill: ' + e.message); }
  const quiet = backfilling;
  try { const raw = await casesByEventDate(recentFrom, T); take(raw, quiet); status.counts.recent = raw.length; }
  catch (e) { errs.push('recent: ' + e.message); }
  try { const raw = await casesModified(day(T, -2), T); take(raw, quiet); status.counts.modified = raw.length; }
  catch (e) { errs.push('modified: ' + e.message); }

  // 1b. FAA preliminary notices (the last 10 business days). The first read is quiet, so the notices already
  //     listed when this went live don't all ping at once.
  const prelims = { ...(state.prelims || {}) };
  try {
    const ns = await fetchFaaNotices();
    let kept = 0;
    for (const n of ns) {
      if (!/ACCIDENT/.test(n.type) || !n.st || n.date < SINCE || !prelimIsPiston(n)) continue;
      const e = prelimFromNotice(n), old = prelims[e.id];
      prelims[e.id] = old ? { ...old, ...e, notified: old.notified, firstSeen: old.firstSeen } : { ...e, notified: !state.prelimSeeded, quietSeed: !state.prelimSeeded, firstSeen: started };
      kept++;
    }
    state.prelimSeeded = true;
    status.counts.faa = `${ns.length} notices, ${kept} piston accidents`;
  } catch (e) { errs.push('FAA notices: ' + e.message); }
  status.error = errs.join('; ');
  // re-apply the piston test to stored cases, so a tightened rule also clears earlier entries
  Object.keys(now).forEach(k => { if (!isPiston(now[k])) delete now[k]; });
  const seeding = backfilling;

  // prelim entries that NTSB now lists drop out; an NTSB case whose prelim already sent its fatal ping
  // doesn't ping again as new (prelims recorded quietly at the first FAA read let the NTSB case ping)
  const pingedViaPrelim = new Set();
  const nowList = Object.values(now);
  Object.keys(prelims).forEach(k => {
    const pr = prelims[k];
    const hit = nowList.find(c => c.reg === pr.reg && dayDiff(c.date, pr.date) <= PRELIM_MATCH_DAYS);
    if (hit) { if (pr.notified && pr.fatal && !pr.quietSeed) pingedViaPrelim.add(hit.ntsb); delete prelims[k]; return; }
    if (dayDiff(pr.date, T) > PRELIM_KEEP_DAYS) delete prelims[k];
  });
  const freshPrelims = seeding ? [] : Object.values(prelims).filter(pr => !pr.notified && pr.fatal);

  // 2. alert profiles
  const codes = (await B.get('users')) || [];
  const profiles = [];
  for (const code of codes.slice(0, 200)) { const p = await B.get('user/' + code); if (p) profiles.push(p); }

  // 3. watched N-numbers (and the tails of watched cases outside the list), five at a time
  const tails = new Set(), caseIds = new Set(), tailOf = new Map();
  profiles.forEach(p => (p.watches || []).forEach(w => { if (w.kind === 'tail') tails.add(w.tail); else { caseIds.add(w.id); if (w.tail) tailOf.set(w.id, w.tail); } }));
  const byCase = new Map();
  const cl = [...caseIds].slice(0, 60);
  for (let i = 0; i < cl.length; i += 5) {
    await Promise.all(cl.slice(i, i + 5).map(async n => {
      try { const r = await caseByNumber(n); let rc = r[0]; if (!rc) { const tw = tailOf.get(n); if (tw) rc = (await casesForTail(tw)).find(c => String(c.ntsbNumber).toUpperCase() === n); } if (rc) { const c = slimCase(rc); c.fp = fingerprint(c); byCase.set(n, c); } }
      catch (e) { byCase.set(n, null); }
    }));
  }
  status.counts.casesChecked = cl.length;
  const byTail = new Map();
  const tl = [...tails].slice(0, 60);
  for (let i = 0; i < tl.length; i += 5) {
    await Promise.all(tl.slice(i, i + 5).map(async t => {
      try { byTail.set(t, (await casesForTail(t)).map(rc => { const c = slimCase(rc, t); c.fp = fingerprint(c); return c; })); }
      catch (e) { byTail.set(t, null); }
    }));
  }
  status.counts.tailsChecked = tl.length;

  // 4. pings
  let sent = 0;
  const dayKey = started.slice(0, 10);
  const sends = (await B.get('sends')) || {};
  if (sends.day !== dayKey) { sends.day = dayKey; sends.n = 0; }
  const send = async (p, msg) => {
    const line = msg.title + ' — ' + msg.body.split('\n')[0];
    // only confirmed addresses (profiles from before v0.11 have no emailVerified field and count as confirmed)
    if (silent || !(p.email && p.emailOn) || p.emailVerified === false) { p.log = [{ at: started, text: line }, ...(p.log || [])].slice(0, 60); return; }
    if (p.sentDay !== dayKey) { p.sentDay = dayKey; p.sentN = 0; }
    if (p.sentN >= CAP_DAY_PROFILE || sends.n >= CAP_DAY_ALL) {
      p.log = [{ at: started, text: 'Not emailed (daily limit reached): ' + line }, ...(p.log || [])].slice(0, 60); return;
    }
    p.log = [{ at: started, text: line }, ...(p.log || [])].slice(0, 60);
    try { const r = await sendEmail(p.email, { ...msg, unsub: unsubUrl(p) }); if (r.ok) { sent++; p.sentN++; sends.n++; } } catch (e) { /* keep going */ }
  };

  for (const p of profiles) {
    let dirty = false;
    if (!seeding) {
      for (const pr of freshPrelims) {
        if (p.rules?.fatal !== false || matchesRules({ fatal: 1, fam: pr.fam, st: pr.st }, p.rules)) {
          await send(p, {
            title: `FATAL (prelim): ${pr.make} ${pr.model} ${pr.reg}`,
            body: `${prelimLine(pr)}\n${pr.src === 'FAA' ? 'FAA preliminary notice' + (pr.entered ? ' entered ' + fmtDate(pr.entered) : '') : 'Prelim entry'}; NTSB hasn't listed it yet. Preliminary and subject to change.`,
            click: APP_URL + '?case=' + encodeURIComponent(pr.id),
          });
          dirty = true;
        }
      }
      for (const c of fresh) {
        if (pingedViaPrelim.has(c.ntsb)) continue;
        const isFatal = c.fatal > 0;
        if ((isFatal && p.rules?.fatal !== false) || matchesRules(c, p.rules)) {
          await send(p, {
            title: (isFatal ? 'FATAL: ' : 'New accident: ') + `${c.make} ${c.model} ${c.reg}`,
            body: `${caseLine(c)}\n${injuryText(c)}${c.damage ? ', ' + c.damage.toLowerCase() + ' damage' : ''}\nNTSB ${c.ntsb}`,
            priority: isFatal ? 5 : 3, tags: isFatal ? 'warning' : 'small_airplane',
            click: APP_URL + '?case=' + encodeURIComponent(c.ntsb),
          });
          dirty = true;
        }
      }
    }
    for (const w of p.watches || []) {
      // candidates for this watch: the case itself, or every case on the tail
      let list = [];
      if (w.kind === 'case') {
        list = [byCase.get(w.id) || now[w.id]].filter(Boolean);
      } else {
        list = byTail.get(w.tail) || [];
      }
      w.fps = w.fps || {};
      const firstLook = !w.checked;
      for (const c of list) {
        const old = w.fps[c.ntsb];
        if (old && old.fp === c.fp) continue;
        if (!firstLook && !silent) {
          const what = describeChange(old && old.c, c);
          await send(p, {
            title: `Watch ${w.kind === 'tail' ? w.tail : w.id}: ${what[0]}`,
            body: `${caseLine(c)}\n${what.join('; ')}\nNTSB ${c.ntsb}${reportPdf(c) && c.status === 'Completed' ? '\nReport: ' + reportPdf(c) : ''}`,
            priority: 4, tags: 'eyes', click: APP_URL + '?case=' + encodeURIComponent(c.ntsb),
          });
        }
        w.fps[c.ntsb] = { fp: c.fp, c: { status: c.status, profile: c.profile, factual: c.factual, docket: c.docket, reportDate: c.reportDate, pc: c.pc ? 1 : 0, closed: c.closed, fatal: c.fatal, serious: c.serious } };
        dirty = true;
      }
      if ((w.kind === 'tail' ? byTail.get(w.tail) : byCase.get(w.id)) != null) { w.checked = started; dirty = true; }
      const latest = list.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latest) w.latest = { ntsb: latest.ntsb, date: latest.date, status: latest.status, reportDate: latest.reportDate, highest: injuryText(latest), mkey: latest.mkey, make: latest.make, model: latest.model };
    }
    if (dirty) await B.set('user/' + p.code, p);
  }

  if (sent) await B.set('sends', sends);
  if (!silent) Object.values(prelims).forEach(pr => { pr.notified = true; });
  state.cases = now;
  state.prelims = prelims;
  state.asOf = started;
  await B.set('cases', state);
  status.ok = !status.error;
  status.counts = { ...status.counts, cases: Object.keys(now).length, prelims: Object.keys(prelims).length, fresh: fresh.length, changed: changed.length, profiles: profiles.length, pings: sent };
  status.note = seeding ? `Filling the list from 01-Oct-2026 (through ${state.backfillTo}); pings start when it's done.` : '';
  await B.set('status', status);
  return status;
}

export { tailKey };
