// Tracking Piston GA Accidents: the page's server calls.
//
//   GET  ?op=feed                     accident list since 01-Oct-2026 + last check status
//   POST ?op=profile-new              new alert profile -> {code, ...}
//   GET  ?op=profile&code=XXXX-XXXX-XXXX
//   POST ?op=profile&code=…           save rules / email / watches (server keeps each watch's history)
//   POST ?op=test&code=…              send a test ping
//   GET  ?op=tail&q=N12345            NTSB cases for one N-number (for adding a watch)
//   GET  ?op=case&n=WPR27FA039        one NTSB case (watch list status)
//   POST ?op=confirm-again&code=…   send the confirm-your-email link again
//   GET  ?op=confirm&code=…&t=…      the link in that email: confirms the address (HTML page)
//   GET  ?op=unsub&code=…&t=…        one-click stop from any ping email (HTML page)
//   POST ?op=refresh                  run the check now (at most once every 10 minutes)
//
// An alert profile is keyed by a 12-character code, like Day's Flight Schedule's sync code: anyone
// with the code can see and change that profile. Good enough for one user now; a public version
// would add a sign-in (see README).

import { blobs, json, page, apiUrl, unsubUrl, casesForTail, caseByNumber, slimCase, tailKey, sendEmail, emailReady, APP_URL, SINCE } from '../lib/common.mjs';
import { runPoll } from '../lib/poll-core.mjs';

const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const rnd = (n, a = ALPH) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map(x => a[x % a.length]).join(''); };
const newCode = () => `${rnd(4)}-${rnd(4)}-${rnd(4)}`;

const pub = p => ({
  code: p.code, email: p.email || '', emailOn: !!p.emailOn, emailReady: emailReady(),
  emailVerified: p.emailVerified !== false, confirmSentAt: p.confirmSentAt || null,
  rules: p.rules, log: (p.log || []).slice(0, 30),
  watches: (p.watches || []).map(w => ({ kind: w.kind, id: w.id, tail: w.tail, label: w.label || '', added: w.added, checked: w.checked || null, latest: w.latest || null })),
});

function cleanRules(r) {
  r = r && typeof r === 'object' ? r : {};
  const arr = (a, n, len) => (Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len)) : []);
  return {
    fatal: r.fatal !== false,
    newOn: !!r.newOn,
    sev: arr(r.sev, 4, 10).filter(s => ['Fatal', 'Serious', 'Minor', 'None'].includes(s)),
    fams: arr(r.fams, 60, 40),
    states: arr(r.states, 60, 3).map(s => s.toUpperCase()),
  };
}

function mergeWatches(oldW, inW) {
  const old = new Map((oldW || []).map(w => [w.kind + ':' + w.id, w]));
  return (Array.isArray(inW) ? inW : []).slice(0, 50).map(w => {
    const kind = w.kind === 'case' ? 'case' : 'tail';
    const id = kind === 'tail' ? tailKey(w.id) : String(w.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
    const tail = tailKey(w.tail || (kind === 'tail' ? id : ''));
    if (!id || !/^N[1-9][0-9A-Z]{0,4}$/.test(tail)) return null;
    const prev = old.get(kind + ':' + id);
    return prev ? { ...prev, label: String(w.label || prev.label || '').slice(0, 80) }
      : { kind, id, tail, label: String(w.label || '').slice(0, 80), added: new Date().toISOString() };
  }).filter(Boolean);
}

async function sendConfirmEmail(p) {
  p.etoken = rnd(24, 'abcdefghijkmnpqrstuvwxyz23456789');
  p.confirmSentAt = new Date().toISOString();
  return sendEmail(p.email, {
    title: 'Confirm your email for Tracking Piston GA Accidents',
    body: `Someone (hopefully you) asked for accident pings from Tracking Piston GA Accidents to go to this address.\n\nConfirm with this link:\n${apiUrl({ op: 'confirm', code: p.code, t: p.etoken })}\n\nIf it wasn't you, ignore this email and nothing more will be sent.`,
  });
}

export default async (req, context) => {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || '';
  const B = blobs(context);
  if (!B.ok) return json(503, { error: 'Storage unavailable' });

  try {
    if (op === 'feed') {
      const [state, status] = await Promise.all([B.get('cases'), B.get('status')]);
      const cases = Object.values((state && state.cases) || {}).map(({ fp, ...c }) => c)
        .sort((a, b) => b.date.localeCompare(a.date) || b.ntsb.localeCompare(a.ntsb));
      return json(200, { since: SINCE, asOf: state ? state.asOf : null, status: status || null, cases },
        { 'Cache-Control': 'public, max-age=60' });
    }

    if (op === 'tail') {
      const t = tailKey(url.searchParams.get('q'));
      if (!/^N[1-9][0-9A-Z]{0,4}$/.test(t)) return json(400, { error: 'Not a US N-number' });
      const list = (await casesForTail(t)).map(c => slimCase(c, t)).sort((a, b) => b.date.localeCompare(a.date));
      return json(200, { tail: t, cases: list });
    }

    if (op === 'case') {
      const n = String(url.searchParams.get('n') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
      if (!n) return json(400, { error: 'No case number' });
      // by number first; NTSB's GetAviationCase can come back empty for a brand-new case, so fall back to the tail
      let rc = (await caseByNumber(n).catch(() => []))[0];
      const t = tailKey(url.searchParams.get('tail'));
      if (!rc && /^N[1-9][0-9A-Z]{0,4}$/.test(t)) rc = (await casesForTail(t)).find(c => String(c.ntsbNumber).toUpperCase() === n);
      return json(rc ? 200 : 404, rc ? { case: slimCase(rc) } : { error: 'NTSB has no case ' + n }, { 'Cache-Control': 'public, max-age=300' });
    }

    if (op === 'refresh' && req.method === 'POST') {
      const st = await B.get('status');
      if (st && Date.now() - Date.parse(st.lastRun) < 10 * 60e3) return json(429, { error: 'Checked less than 10 minutes ago', status: st });
      return json(200, { status: await runPoll(context) });
    }

    if (op === 'profile-new' && req.method === 'POST') {
      const p = { code: newCode(), email: '', emailOn: false,
        rules: cleanRules({ fatal: true, newOn: false, sev: ['Fatal', 'Serious'] }), watches: [], log: [], created: new Date().toISOString() };
      await B.set('user/' + p.code, p);
      const users = (await B.get('users')) || [];
      users.push(p.code);
      await B.set('users', users);
      return json(200, pub(p));
    }

    // links from emails (GET, answered with a small page)
    if (op === 'confirm' || op === 'unsub') {
      const c = String(url.searchParams.get('code') || '').toUpperCase(), t = String(url.searchParams.get('t') || '');
      const q = CODE_RE.test(c) ? await B.get('user/' + c) : null;
      if (!q || !q.etoken || t !== q.etoken) return page('Link not valid', 'This link has expired or was replaced by a newer one. Open the app and use section 3.');
      if (op === 'confirm') { q.emailVerified = true; q.emailOn = true; await B.set('user/' + c, q);
        return page('Email confirmed', `Pings for this alert profile will go to ${q.email.replace(/</g, '')}.`); }
      q.emailOn = false; await B.set('user/' + c, q);
      return page('Emails stopped', 'This alert profile will not send any more emails. You can turn them back on in section 3 of the app.');
    }

    const code = String(url.searchParams.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code)) return json(400, { error: 'Bad profile code' });
    const p = await B.get('user/' + code);
    if (!p) return json(404, { error: 'No profile with that code' });

    if (op === 'profile' && req.method === 'GET') return json(200, pub(p));

    if (op === 'profile' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if ('rules' in body) p.rules = cleanRules(body.rules);
      if ('emailOn' in body) p.emailOn = !!body.emailOn;
      let sendConfirm = false;
      if ('email' in body) {
        const e = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/.test(String(body.email || '').trim()) ? String(body.email).trim() : '';
        // v0.11: a new address must be confirmed by clicking a link before any ping goes to it
        if (e.toLowerCase() !== String(p.email || '').toLowerCase()) { p.email = e; p.emailVerified = false; p.etoken = ''; sendConfirm = !!e; }
      }
      if ('watches' in body) p.watches = mergeWatches(p.watches, body.watches);
      let confirm = null;
      if (sendConfirm) confirm = await sendConfirmEmail(p);
      await B.set('user/' + code, p);
      return json(200, { ...pub(p), confirm });
    }

    if (op === 'confirm-again' && req.method === 'POST') {
      if (!p.email) return json(400, { error: 'No email address saved' });
      if (p.confirmSentAt && Date.now() - Date.parse(p.confirmSentAt) < 60e3) return json(429, { error: 'Sent less than a minute ago' });
      const r = await sendConfirmEmail(p);
      await B.set('user/' + code, p);
      return json(r.ok ? 200 : 502, { ...pub(p), confirm: r });
    }

    if (op === 'test' && req.method === 'POST') {
      if (p.emailVerified === false) return json(409, { ok: false, why: 'Confirm your address first: click the link in the email sent to ' + p.email + '.' });
      const r = await sendEmail(p.email, {
        title: 'Test ping from Tracking Piston GA Accidents',
        body: 'If you can read this, pings for this alert profile reach you by email.',
        click: APP_URL, unsub: unsubUrl(p),
      });
      return json(r.ok ? 200 : 502, r);
    }

    return json(400, { error: 'Unknown request' });
  } catch (e) {
    return json(500, { error: e.message || 'Server error' });
  }
};
