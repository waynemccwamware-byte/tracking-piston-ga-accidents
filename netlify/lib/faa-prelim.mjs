// FAA Preliminary Accident and Incident Notices (v0.16, 25-Nov-2026).
//
// Source: the dashboard on https://www.faa.gov/data_research/accident_incident/preliminary_data
// ("notices reported ... within the past 10 business days. All information is preliminary and subject to change").
// Its Detailed Notices view exports as CSV with no sign-in:
//   https://explore.dot.gov/t/FAA/views/PrelimininaryAccidentandIncidentReportData/DetailedNotices.csv
// (FAA's own spelling, "Prelimininary"). Checked 25-Nov-2026 in a browser with cookies off: about 600 lines,
// entries 12-Nov to 25-Nov-2026, N462DL (Cirrus SR22, Jackson MS, 21-Nov-2026, ACCIDENT, FATAL) among them.
//
// The export copies the dashboard's layout, so one notice is spread over ~7 lines that share a UniqueID
// (N-number + city + event date). Header seen 25-Nov-2026 (names repeat):
//   AIRCRAFT_MODEL, CITY, Date Entered, EVENT DATE, EVENT TYPE, Highlight, Label - Acft Make Name (crop),
//   Label - Fatal, Label - Loc State Name (crop), REGIST_NBR, UniqueID, aircraft, Label - Fatal, REGIST_NBR,
//   STATE + COUNTRY, STATE, Max. Document, Min. Date Entered, …
// Each field is taken from the first line of the group that has it. If FAA changes the dashboard, the header
// check fails and the poll records the error and carries on (manual prelim entries still work).
// Damage, injury counts, flight phase and the description are only on each notice's report page, not in the CSV.

export const FAA_CSV = 'https://explore.dot.gov/t/FAA/views/PrelimininaryAccidentandIncidentReportData/DetailedNotices.csv';
export const FAA_PAGE = 'https://www.faa.gov/data_research/accident_incident/preliminary_data';

const ST = { ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT',
  DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  'PUERTO RICO': 'PR', 'VIRGIN ISLANDS': 'VI', 'U.S. VIRGIN ISLANDS': 'VI', GUAM: 'GU' };
export const stateCode = s => { const u = String(s || '').toUpperCase().trim(); return ST[u] || (Object.values(ST).includes(u) ? u : ''); };

// RFC 4180 lines (quoted fields may hold commas and doubled quotes)
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

const mdyToIso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ''); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };

// -> [{reg, date, entered, make, model, city, stName, st, type, fatal}]
export function noticesFromCsv(text) {
  const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
  if (!rows.length) throw new Error('FAA notices CSV was empty');
  const h = rows[0].map(x => x.trim());
  const idx = name => h.reduce((a, x, i) => (x === name ? a.concat(i) : a), []);
  const need = ['UniqueID', 'REGIST_NBR', 'AIRCRAFT_MODEL', 'CITY', 'EVENT DATE', 'EVENT TYPE'];
  const miss = need.filter(n => !idx(n).length);
  if (miss.length) throw new Error('FAA notices CSV layout changed (missing ' + miss.join(', ') + ')');
  const I = { id: idx('UniqueID')[0], reg: idx('REGIST_NBR'), model: idx('AIRCRAFT_MODEL'), city: idx('CITY'),
    ev: idx('EVENT DATE'), type: idx('EVENT TYPE'), fatal: idx('Label - Fatal'), make: idx('aircraft').concat(idx('Label - Acft Make Name (crop)')),
    st: idx('STATE').concat(idx('STATE + COUNTRY'), idx('Label - Loc State Name (crop)')), entered: idx('Min. Date Entered').concat(idx('Date Entered')) };
  const groups = new Map();
  rows.slice(1).forEach(r => { const k = (r[I.id] || '').trim(); if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const first = (g, cols) => { for (const c of cols) for (const r of g) { const v = (r[c] || '').trim(); if (v) return v; } return ''; };
  const out = [];
  groups.forEach(g => {
    const reg = first(g, I.reg).toUpperCase().replace(/[\s-]/g, '');
    const evRaw = first(g, I.ev);
    const date = /^\d{4}-\d{2}-\d{2}/.test(evRaw) ? evRaw.slice(0, 10) : mdyToIso(evRaw);
    const stName = first(g, I.st);
    out.push({ reg, date, entered: mdyToIso(first(g, I.entered)), make: first(g, I.make), model: first(g, I.model),
      city: first(g, I.city), stName, st: stateCode(stName), type: first(g, I.type).toUpperCase(),
      fatal: /FATAL/i.test(first(g, I.fatal)) });
  });
  return out.filter(n => n.reg && n.date);
}

export async function fetchFaaNotices(ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(FAA_CSV, { headers: { Accept: 'text/csv' }, signal: ctl.signal });
    if (!r.ok) throw new Error('FAA notices answered ' + r.status);
    return noticesFromCsv(await r.text());
  } finally { clearTimeout(t); }
}

// FAA lists everything (airliners, helicopters, balloons, drones…). Makes that are never piston airplanes, on top of
// the NTSB list's own test (isPiston). FAA uses short make names ("HONDA", "HAWKER", "AMAZON").
export const FAA_NOT_PISTON = /HELICOPTER|ROTORCRAFT|GYRO|BALLOON|AIRSHIP|BLIMP|GOODYEAR|AMAZON|ZIPLINE|WING AVIATION|DRONE|\bUAS\b|ULTRALIGHT|^HONDA|^HAWKER$|^SIKORSKY|^AGUSTA|^MCDONNELL|^SCHWEIZER|^SILLER|^AEROSPATIALE|^DASSAULT|^CANADAIR|^DE ?HAVILLAND/;

// one prelim entry, as the page and the pings see it
export const prelimId = (reg, date) => `P-${reg}-${date}`;
