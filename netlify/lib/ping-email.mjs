// Tracking Piston GA Accidents — the ping email (v0.40, Wayne 27-Nov-2026).
// One email per hourly check per profile, listing everything new for that profile: new accidents that match
// its rules, FAA prelim fatal accidents, and changes on its watch list. Each item is a snapshot of the case
// (what the app's opened record shows), as a formatted email with a plain-text copy. Links, no attachments.
//
// Items:
//   { kind: 'new',    c }            c = slim NTSB case (common.mjs slimCase)
//   { kind: 'prelim', pr }           pr = prelim entry (poll-core.mjs prelimFromNotice / manual)
//   { kind: 'watch',  c, w, what }   w = the watch, what = describeChange() list
import { APP_URL, fmtDate, injuryText, reportPdf } from './common.mjs';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const caseUrl = c => `https://web.ntsb.gov/investigations/?ntsbnumber=${encodeURIComponent(c.ntsb)}`;
const regUrl = t => `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(t)}`;
const appUrl = id => APP_URL + '?case=' + encodeURIComponent(id);
// same rule as the page's reportLabel: the newest report past NTSB's initial notice
const reportLabel = c => !c.mkey ? '' : (c.status === 'Completed' || /final/i.test(c.profile || '')) ? 'NTSB final report (PDF)'
  : /factual/i.test(c.profile || '') ? 'NTSB factual report (PDF)' : /prelim/i.test(c.profile || '') ? 'NTSB preliminary report (PDF)' : '';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const dmg = d => !d ? '' : /destroy/i.test(d) ? 'aircraft destroyed' : /none/i.test(d) ? 'no damage' : d.toLowerCase() + ' damage';
// NTSB publish profiles in plain words (DirectorApprovedBriefFinal → final report)
const stage = p => !p ? '' : /final/i.test(p) ? 'final report' : /factual/i.test(p) ? 'factual report' : /prelim/i.test(p) ? 'preliminary report' : /initial/i.test(p) ? 'initial notice' : p.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function head(it) {
  if (it.kind === 'prelim') return { tag: 'FATAL (prelim)', fatal: true, ac: `${it.pr.make} ${it.pr.model}`, reg: it.pr.reg };
  const c = it.c, ac = `${c.make} ${c.model}`;
  if (it.kind === 'watch') return { tag: 'Watch update', fatal: c.fatal > 0, ac, reg: c.reg };
  return { tag: c.fatal > 0 ? 'FATAL' : 'New accident', fatal: c.fatal > 0, ac, reg: c.reg };
}

// the snapshot as label/value rows (plain text and HTML both use these)
function rows(it) {
  if (it.kind === 'prelim') {
    const p = it.pr;
    return {
      top: `${fmtDate(p.date)} · ${p.city}${p.st ? ', ' + p.st : ''}`,
      lines: [['Injuries', 'Fatal (number not yet stated)'],
        ['Source', `${p.src === 'FAA' ? 'FAA preliminary notice' : 'Prelim entry'}${p.entered ? ', entered ' + fmtDate(p.entered) : ''}. NTSB hasn't listed it yet; preliminary and subject to change.`]],
      links: [['Open in the app', appUrl(p.id)], p.reg ? ['FAA Registry', regUrl(p.reg)] : null].filter(Boolean),
    };
  }
  const c = it.c;
  const inj = injuryText(c);
  const lines = [];
  if (it.kind === 'watch') lines.push(['What changed', cap(it.what.join('; ')) + (it.w.kind === 'tail' ? ` (watching ${it.w.tail})` : '')]);
  lines.push(['Injuries', cap(inj) + (c.damage ? `; ${dmg(c.damage)}` : '')]);
  const ac = [c.fam && c.fam !== c.model ? c.fam : '', c.yb ? 'built ' + c.yb : ''].filter(Boolean).join(', ');
  if (ac) lines.push(['Aircraft', ac]);
  const what = [c.phase, c.def].filter(Boolean).join(' · ');
  if (what) lines.push(['What happened', what]);
  lines.push(['NTSB', [c.ntsb, c.status, stage(c.profile), c.reportDate ? 'dated ' + fmtDate(c.reportDate) : ''].filter(Boolean).join(' · ')]);
  if (c.pc) lines.push(['Probable cause', c.pc]);
  const links = [['NTSB case page', caseUrl(c)],
    reportLabel(c) ? [reportLabel(c), reportPdf(c)] : null,
    c.docket && c.mkey ? ['NTSB docket', `https://data.ntsb.gov/Docket?ProjectID=${c.mkey}`] : null,
    c.reg ? ['FAA Registry', regUrl(c.reg)] : null,
    ['Open in the app', appUrl(c.ntsb)]].filter(Boolean);
  return { top: `${fmtDate(c.date)} · ${c.city}${c.st ? ', ' + c.st : ''}`, lines, links };
}

export function buildPing(items, { unsub = '', test = false } = {}) {
  const hs = items.map(head);
  const nF = hs.filter(h => h.fatal && !/^Watch/.test(h.tag)).length, nW = items.filter(i => i.kind === 'watch').length, nN = items.length - nF - nW;
  const one = h => `${h.tag}: ${h.ac} ${h.reg}`;
  let title = items.length === 1 ? (items[0].kind === 'watch' ? `Watch update: ${items[0].what[0]} · ${hs[0].ac} ${hs[0].reg}` : one(hs[0]))
    : [nF ? `${nF} fatal accident${nF > 1 ? 's' : ''}` : '', nN ? `${nN} new accident${nN > 1 ? 's' : ''}` : '', nW ? `${nW} watch update${nW > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ') + ` (first: ${hs[0].ac} ${hs[0].reg})`;
  if (test) title = 'TEST · ' + title;

  // plain text
  const tx = [];
  if (test) tx.push('This is a test ping: it shows how a real one looks, using the newest fatal accident in the list.\n');
  if (items.length > 1) tx.push(`${items.length} items from this check:\n`);
  items.forEach((it, i) => {
    const h = hs[i], r = rows(it);
    tx.push(`${items.length > 1 ? (i + 1) + '. ' : ''}${h.tag.toUpperCase()}: ${h.ac} ${h.reg}`, r.top);
    r.lines.forEach(([k, v]) => tx.push(`${k}: ${v}`));
    r.links.forEach(([k, v]) => tx.push(`${k}: ${v}`));
    tx.push('');
  });
  tx.push('--', `Tracking Piston GA Accidents (GeezerGeek Pilot). Change these emails in Pings (section 1) of ${APP_URL}`);
  if (unsub) tx.push(`Stop all emails with one click: ${unsub}`);
  const text = tx.join('\n');

  // formatted (inline styles only; light card that reads in light and dark mail apps)
  const card = (it, i) => {
    const h = hs[i], r = rows(it), col = h.fatal ? '#c0392b' : it.kind === 'watch' ? '#b7791f' : '#5b6675';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;background:#ffffff;border:1px solid #d9dde3;border-left:4px solid ${col};border-radius:6px">
<tr><td style="padding:12px 14px 4px;font:600 15px/1.35 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d232b"><span style="color:${col}">${esc(h.tag)}</span> · ${esc(h.ac)} <span style="font-family:Menlo,Consolas,monospace;color:#9a6a12">${esc(h.reg)}</span></td></tr>
<tr><td style="padding:0 14px 8px;font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#5b6675">${esc(r.top)}</td></tr>
<tr><td style="padding:0 14px 6px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${r.lines.map(([k, v]) =>
      `<tr><td valign="top" style="padding:3px 10px 3px 0;font:12.5px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#5b6675;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;font:13px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d232b">${esc(v)}</td></tr>`).join('')}</table></td></tr>
<tr><td style="padding:4px 14px 12px;font:13px/1.8 -apple-system,Segoe UI,Helvetica,Arial,sans-serif">${r.links.map(([k, v]) => `<a href="${esc(v)}" style="color:#0b7a72;text-decoration:none;margin-right:14px;white-space:nowrap">${esc(k)} →</a>`).join(' ')}</td></tr>
</table>`;
  };
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f2f4f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7"><tr><td align="center" style="padding:16px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 2px 10px;font:600 13px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#9a6a12">Tracking Piston GA Accidents · ping${items.length > 1 ? ` · ${items.length} items` : ''}</td></tr>
${test ? `<tr><td style="padding:0 2px 10px;font:13px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#5b6675">This is a test ping: it shows how a real one looks, using the newest fatal accident in the list.</td></tr>` : ''}
<tr><td>${items.map(card).join('')}</td></tr>
<tr><td style="padding:6px 2px 0;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#7a8594">Tracking Piston GA Accidents (GeezerGeek Pilot). <a href="${APP_URL}#secPings" style="color:#0b7a72">Change these emails</a>${unsub ? ` · <a href="${esc(unsub)}" style="color:#0b7a72">Stop all emails</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { title, text, html };
}
