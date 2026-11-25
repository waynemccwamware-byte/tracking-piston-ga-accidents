// The check that finds new accidents and changes on watched ones, then sends the pings.
// Run hourly by netlify/functions/poll.mjs (scheduled) and on demand by api.mjs (?op=refresh, throttled).
//
// Blobs keys (store tracking-piston-ga-accidents):
//   cases       {asOf, cases:{<ntsb>: slim case + fp}}   every piston fixed-wing US case since SINCE
//   status      {lastRun, ok, error, counts, note}
//   users       [codes]                                    index of alert profiles
//   user/<code> {code, topic, email, rules, watches, log}  one alert profile (see api.mjs)

import {
  blobs, SINCE, APP_URL, casesSince, casesForTail, slimCase, isPiston, fingerprint,
  ntfy, caseLine, injuryText, reportPdf, fmtDate, tailKey,
} from './common.mjs';

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

  const state = (await B.get('cases')) || { asOf: null, cases: {} };
  const seeding = !state.asOf;                  // first run: fill the list without pinging 8 weeks of accidents
  const prior = state.cases || {};
  const now = {};
  const fresh = [], changed = [];

  // 1. every case since SINCE
  try {
    const raw = await casesSince(SINCE, today());
    raw.forEach(rc => {
      const c = slimCase(rc);
      if (!c.ntsb || !US(c.country) || !isPiston(c) || c.date < SINCE) return;
      c.fp = fingerprint(c);
      now[c.ntsb] = c;
      const o = prior[c.ntsb];
      if (!o) fresh.push(c); else if (o.fp !== c.fp) changed.push([o, c]);
    });
    status.counts.ntsbAnswered = raw.length;
  } catch (e) {
    status.error = 'Date query: ' + e.message;
  }
  // keep cases NTSB did not return this time (a failed or partial answer must not empty the list)
  Object.keys(prior).forEach(k => { if (!now[k]) now[k] = prior[k]; });

  // 2. alert profiles
  const codes = (await B.get('users')) || [];
  const profiles = [];
  for (const code of codes.slice(0, 200)) { const p = await B.get('user/' + code); if (p) profiles.push(p); }

  // 3. watched N-numbers (and the tails of watched cases outside the list), five at a time
  const tails = new Set();
  profiles.forEach(p => (p.watches || []).forEach(w => { if (w.tail) tails.add(w.tail); }));
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
  const send = async (p, msg) => {
    p.log = [{ at: started, text: msg.title + ' — ' + msg.body.split('\n')[0] }, ...(p.log || [])].slice(0, 60);
    if (silent || !p.topic) return;
    const wantPush = p.push !== false, wantEmail = !!(p.email && p.emailOn);
    if (!wantPush && !wantEmail) return;
    try { await ntfy(p.topic, { ...msg, email: wantEmail ? p.email : '' }); sent++; } catch (e) { /* keep going */ }
  };

  for (const p of profiles) {
    let dirty = false;
    if (!seeding) {
      for (const c of fresh) {
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
        const fromTail = (byTail.get(w.tail) || []).find(c => c.ntsb === w.id);
        list = [fromTail || now[w.id]].filter(Boolean);
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
        w.fps[c.ntsb] = { fp: c.fp, c: { status: c.status, reportDate: c.reportDate, pc: c.pc ? 1 : 0, closed: c.closed, fatal: c.fatal, serious: c.serious } };
        dirty = true;
      }
      if (byTail.get(w.tail) !== null) { w.checked = started; dirty = true; }
      const latest = list.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latest) w.latest = { ntsb: latest.ntsb, date: latest.date, status: latest.status, reportDate: latest.reportDate, highest: injuryText(latest), mkey: latest.mkey, make: latest.make, model: latest.model };
    }
    if (dirty) await B.set('user/' + p.code, p);
  }

  state.cases = now;
  if (!status.error) state.asOf = started;
  await B.set('cases', state);
  status.ok = !status.error;
  status.counts = { ...status.counts, cases: Object.keys(now).length, fresh: fresh.length, changed: changed.length, profiles: profiles.length, pings: sent };
  status.note = seeding ? 'First run: list filled without pings.' : '';
  await B.set('status', status);
  return status;
}

export { tailKey };
