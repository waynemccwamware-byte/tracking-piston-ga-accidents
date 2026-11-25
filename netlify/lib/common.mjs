// Tracking Piston GA Accidents — shared server code (imported by the functions; not a function itself).
// Dependency-free on purpose (App Conventions §1: no npm install, no build step).
//
// Pieces:
//   Blobs     — dependency-free Netlify Blobs client (same approach as Day's Flight Schedule sync.mjs)
//   NTSB      — NTSB Public API (key: Netlify secret env var NTSB_API_KEY, header Ocp-Apim-Subscription-Key)
//   slimCase  — one NTSB case reduced to what the app shows and watches
//   piston    — piston fixed-wing test + type family names (ported from GA Accident Stats build/families.py)
//   sendEmail — email pings through Resend (see below)

export const STORE = 'tracking-piston-ga-accidents';
export const SINCE = '2026-10-01';          // first accident date gathered (Wayne, 25-Nov-2026)
export const APP_URL = 'https://tracking-piston-ga-accidents.netlify.app/';
export const STATS_URL = 'https://piston-ga-stats.netlify.app/';

// ---------------------------------------------------------------- Blobs
function blobsContext() {
  const raw = globalThis.netlifyBlobsContext
    || (globalThis.Netlify && globalThis.Netlify.env && globalThis.Netlify.env.get('NETLIFY_BLOBS_CONTEXT'))
    || (typeof process !== 'undefined' && process.env ? process.env.NETLIFY_BLOBS_CONTEXT : '');
  if (typeof raw !== 'string' || !raw) return {};
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e) { return {}; }
}

export function blobs(context) {
  const ctx = blobsContext();
  if (!ctx.siteID && context && context.site && context.site.id) ctx.siteID = context.site.id;
  const ok = !!(ctx.siteID && ctx.token && ctx.edgeURL);
  const url = (base, key) => new URL(`/${ctx.siteID}/${STORE}/${encodeURIComponent(key)}`, base).toString();
  return {
    ok,
    async get(key) {
      if (!ok) throw new Error('Blobs context unavailable');
      const r = await fetch(url(ctx.uncachedEdgeURL || ctx.edgeURL, key), { headers: { authorization: `Bearer ${ctx.token}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Blobs GET ${key}: HTTP ${r.status}`);
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { return null; }
    },
    async set(key, value) {
      if (!ok) throw new Error('Blobs context unavailable');
      const r = await fetch(url(ctx.edgeURL, key), {
        method: 'PUT',
        headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'text/plain' },
        body: JSON.stringify(value),
      });
      if (!r.ok) throw new Error(`Blobs PUT ${key}: HTTP ${r.status}`);
    },
  };
}

// ---------------------------------------------------------------- NTSB
export const NTSB_API = 'https://api.ntsb.gov/public/api/Aviation/v1/';
const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);

export async function ntsbGet(path, params, ms = 12000) {
  const key = env('NTSB_API_KEY');
  if (!key) throw new Error('NTSB_API_KEY is not set on this Netlify site');
  const u = new URL(path, NTSB_API);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(u, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache', Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`NTSB answered ${r.status} for ${u.pathname}`);
    const body = await r.json();
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body)) return body;
    if (body && body.data && typeof body.data === 'object') return [body.data];
    return body && typeof body === 'object' && body.ntsbNumber ? [body] : [];
  } finally { clearTimeout(t); }
}

// Verified 22-Nov-2026 (GA Accident Stats ntsb-tail.mjs): cases for one N-number.
export const casesForTail = tail => ntsbGet('GetAviationCasesFiltered/', { aircraftRegistrationNumber: tail });

// Verified 25-Nov-2026 in the developer portal (signed in, "Try it" with Wayne's key):
//   Common/v2/GetCasesByDateRange?startDate=MM/DD/YYYY&endDate=MM/DD/YYYY&mode=aviation[&marker=]
//     -> {startDate, endDate, pageSize, hasMore, nextMarker, data:[cases]}; event-date range, inclusive,
//        up to 1000 per page, same case shape as the Aviation operations.
//   Common/v1/GetCasesByModifiedDateRange?startDate&endDate  (cases created or revised in the range)
//   Aviation/v1/GetAviationCase?ntsbNumber=  (one case)
const mdy = iso => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
export async function casesByEventDate(fromISO, toISO) {
  const out = [];
  let marker = '';
  for (let page = 0; page < 5; page++) {
    const key = env('NTSB_API_KEY');
    if (!key) throw new Error('NTSB_API_KEY is not set on this Netlify site');
    const u = new URL('https://api.ntsb.gov/public/api/Common/v2/GetCasesByDateRange/');
    u.searchParams.set('startDate', mdy(fromISO)); u.searchParams.set('endDate', mdy(toISO)); u.searchParams.set('mode', 'aviation');
    if (marker) u.searchParams.set('marker', marker);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(u, { headers: { 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache', Accept: 'application/json' }, signal: ctl.signal });
      if (r.status === 204) break;
      if (!r.ok) throw new Error(`NTSB answered ${r.status} for GetCasesByDateRange`);
      const b = await r.json();
      (Array.isArray(b.data) ? b.data : []).forEach(c => out.push(c));
      if (!b.hasMore || !b.nextMarker) break;
      marker = b.nextMarker;
    } finally { clearTimeout(t); }
  }
  return out;
}
export const casesModified = (fromISO, toISO) =>
  ntsbGet('https://api.ntsb.gov/public/api/Common/v1/GetCasesByModifiedDateRange/', { startDate: mdy(fromISO), endDate: mdy(toISO) }, 20000);
export const caseByNumber = n => ntsbGet('GetAviationCase/', { ntsbNumber: n });

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const str = v => (v == null ? '' : String(v).trim());
export const tailKey = s => { let t = String(s || '').toUpperCase().replace(/[\s-]/g, ''); if (t && !t.startsWith('N')) t = 'N' + t; return t; };

// Same field names as GA Accident Stats ntsb-tail.mjs (read from live answers 22-Nov-2026), plus the
// aircraft category and engine fields used by isPiston() when NTSB supplies them.
export function slimCase(c, tail) {
  const acs = Array.isArray(c.aircrafts) ? c.aircrafts : [];
  const ac = (tail && acs.find(a => tailKey(a.aircraftRegistrationNumber) === tail)) || acs[0] || {};
  const narr = (Array.isArray(c.narratives) ? c.narratives : []).find(n => n.aircraftNumber === ac.aircraftNumber) || (c.narratives || [])[0] || {};
  const d = (Array.isArray(ac.events) ? ac.events : []).find(e => e.isDefiningEvent);
  const dmg = (Array.isArray(ac.aircraftAccidents) ? ac.aircraftAccidents : [])[0] || {};
  const eng = (Array.isArray(ac.engines) ? ac.engines : [])[0] || {};
  const make = str(ac.aircraftMake || ac.aircraftManufacturer), model = str(ac.aircraftModel);
  const fam = family(make, model);
  return {
    ntsb: str(c.ntsbNumber),
    mkey: typeof c.mKey === 'number' ? c.mKey : null,
    type: str(c.eventType),
    date: str(c.eventDate).slice(0, 10),
    city: str(c.eventCity), st: str(c.eventStateOrRegion), country: str(c.eventCountry),
    status: str(c.completionStatus),
    profile: str(c.publishProfile),
    docket: str(c.docketOpenDate).slice(0, 10),
    factual: str(c.factualPublishedDate).slice(0, 10),
    mode: str(c.mode),
    closed: !!c.caseClosed,
    reportDate: str(c.reportDate || c.originalPublishedDate).slice(0, 10),
    highest: str(c.highestInjuryLevel),
    fatal: num(c.totalFatal), serious: num(c.totalSerious), minor: num(c.totalMinor),
    pc: str(narr.probableCause).slice(0, 1200),
    def: d ? str(d.eventTier2Name) : '',
    phase: d ? str(d.cicttPhaseSOEGroup) : '',
    reg: tailKey(ac.aircraftRegistrationNumber),
    make, model, yb: str(ac.yearOfManufacture),
    damage: str(dmg.damageLevel),
    cat: str(ac.aircraftCategory),
    engType: str(eng.engineType || ac.engineType),
    amateur: !!ac.aircraftAmateurBuilt,
    far: str(ac.regulationFlightConductedUnder || ac.federalRegulation || ''),
    brand: fam[0] || '', fam: fam[1] || '',
  };
}

// What a watcher cares about changing.
export const fingerprint = c => [c.status, c.profile, c.closed ? 1 : 0, c.reportDate, c.factual, c.docket, c.pc ? c.pc.length : 0, c.fatal, c.serious, c.highest].join('|');

// ---------------------------------------------------------------- piston test + families
// Port of GA Accident Stats build/families.py (brand + family regexes). Used to name the type and as a
// fallback piston test when NTSB gives no engine type.
const BR = [
  [/^(CESSNA|TEXTRON AVIATION|REIMS)/, 'Cessna'], [/^(NEW )?PIPER(?! ?\/| -|-[A-Z])/, 'Piper'],
  [/^(BEECH(?!ER)|BEECHCRAFT|RAYTHEON AIRCRAFT|HAWKER BEECHCRAFT|HAWKER$)/, 'Beech'],
  [/^MOONEY( AIRCRAFT| AIRPLANE| INTERNATIONAL|$)/, 'Mooney'], [/^CIRRUS/, 'Cirrus'], [/^DIAMOND( AIRCRAFT|$)/, 'Diamond'],
  [/^PILATUS(?!.*BRITTEN)/, 'Pilatus'], [/^(EADS[ -]SOCATA|SOCATA|AEROSPATIALE\/SOCATA|DAHER|COMPAGNIE DAHER)/, 'Daher'], [/^EPIC( AIRCRAFT|$)/, 'Epic'],
];
const FAM = [
  ['Cirrus','SR20',/^SR ?20/],['Cirrus','SR22T',/^SR ?22 ?T/],['Cirrus','SR22',/^SR ?22/],
  ['Diamond','DA20',/^DA ?20/],['Diamond','DA40 NG',/^DA ?40 ?(NG|D)\b|^DA ?40 ?NG|^DA40D/],['Diamond','DA40',/^DA ?40/],['Diamond','DA42',/^DA ?42/],['Diamond','DA62',/^DA ?62/],
  ['Cessna','120/140',/^(120|140)/],['Cessna','150/152',/^(F|A|FA)?15[02]/],['Cessna','170',/^170/],
  ['Cessna','172RG',/^172 ?RG/],['Cessna','172 Hawk XP',/^(F?R172|R172)/],['Cessna','172',/^(F|P)?172/],['Cessna','175',/^175/],
  ['Cessna','177/Cardinal',/^177/],['Cessna','180/185',/^(A)?18[05]/],['Cessna','182',/^(F|R|T|TR|FR)?182/],['Cessna','195',/^19[05]/],
  ['Cessna','205/206/207',/^(P|T|U|TU|TP)?20[567]|^210-5/],['Cessna','210',/^(P|T)?210/],
  ['Cessna','350/400 (Columbia)',/^(LC4[012]|T240|400|350)/],
  ['Cessna','310/320',/^T?-?3[12]0/],['Cessna','335/340',/^3(35|40)/],['Cessna','336/337',/^(M|T|P|F)?33[67]/],['Cessna','401-421 twins',/^4(01|02|11|14|21)/],
  ['Piper','J-3 Cub',/^J-?3/],['Piper','PA-18 Super Cub',/^PA-?18/],['Piper','PA-22 Tri-Pacer/Colt',/^PA-?22/],
  ['Piper','PA-28R Arrow',/^PA-?28R/],['Piper','PA-28 Cherokee/Warrior/Archer',/^PA-?28(-|$)/],
  ['Piper','PA-32 Cherokee Six/Saratoga',/^PA-?32/],['Piper','PA-24 Comanche',/^PA-?24/],
  ['Piper','PA-46 Meridian/M500/M600/M700',/^PA-?46R?-? ?(500|600|701) ?TP|^P46T/],['Piper','PA-46 Malibu/Mirage',/^PA-?46/],
  ['Piper','PA-23 Apache/Aztec',/^PA-?23/],['Piper','PA-30/39 Twin Comanche',/^PA-?(30|39)/],['Piper','PA-34 Seneca',/^PA-?34/],
  ['Piper','PA-38 Tomahawk',/^PA-?38/],['Piper','PA-44 Seminole',/^PA-?44/],['Piper','PA-31 Navajo',/^PA-?31/],['Piper','PA-12 Super Cruiser',/^PA-?12/],
  ['Beech','Bonanza 35 (V-tail)',/^[A-Z]?35(?!-)[A-Z]?$|^[A-Z]35[AB]?$|^35$/],['Beech','Bonanza 33',/^(35-)?[A-Z]?33[A-Z]?$|^35-[A-Z]?33/],
  ['Beech','Bonanza 36',/^[A-Z]?36/],['Beech','Musketeer/Sundowner/Sierra',/^[A-Z]?(19|23|24)([A-Z]?$|-|R$)/],
  ['Beech','Baron 55/58',/^(95-)?[A-Z]?-?55|^[A-Z]?58/],['Beech','Travel Air 95',/^[A-Z]?95/],['Beech','Duchess 76',/^76/],['Beech','Skipper 77',/^77$/],
  ['Pilatus','PC-12',/^PC[- ]?12/],['Epic','E1000',/^E ?1000/],['Daher','TBM',/^TBM/],
  ['Mooney','M20 (C/E/F/G/J)',/^M-?20[CDEFGJ]/],['Mooney','M20K/M/R/S/TN/V',/^M-?20(K|M|R|S|TN|V|U)/],['Mooney','M20 early (A/B)',/^M-?20[AB]?$/],
];
const TURBOPROP = new Set(['PA-46 Meridian/M500/M600/M700', 'PC-12', 'E1000', 'TBM']);
export function family(make, model) {
  const m = String(make || '').toUpperCase();
  const b = (BR.find(([r]) => r.test(m)) || [])[1];
  if (!b) return [null, null];
  let mo = String(model || '').toUpperCase().trim().replace(/^(CESSNA|PIPER|BEECH|MOONEY|CIRRUS|DIAMOND)\s+/, '').replace('PA ', 'PA-');
  const f = FAM.find(([bb, , r]) => bb === b && r.test(mo));
  return [b, f ? f[1] : null];
}

// Piston fixed-wing. Early NTSB records often have no aircraft category and no engines yet (seen 25-Nov-2026:
// a new Cessna 210D case with category null, engines []), so:
//   category given and not Airplane -> out;  engine type given -> reciprocating only;
//   otherwise a known piston family is in, a known turbine/jet/rotorcraft make or model is out, and
//   anything else (homebuilts, Maules, Citabrias…) is in, marked "engine not yet stated".
const NOT_PISTON_MAKE = /^(BOEING|AIRBUS|EMBRAER|BOMBARDIER|CANADAIR|GULFSTREAM|LEARJET|DASSAULT|HONDA AIRCRAFT|HONDAJET|ATR|DE HAVILLAND CANADA|VIKING AIR|SAAB|FOKKER|MCDONNELL|LOCKHEED|ROBINSON|BELL|SIKORSKY|EUROCOPTER|AIRBUS HELICOPTERS|AGUSTA|LEONARDO|MD HELICOPTERS|HUGHES|ENSTROM|SCHWEIZER|HILLER|KAMAN|AIR TRACTOR|THRUSH|AYRES|QUEST|KODIAK|DAHER|SOCATA|EPIC|PILATUS|ECLIPSE|CIRRUS DESIGN CORP VISION|BEECH(CRAFT)? (KING|PREMIER)|TEXTRON (BELL|EAVIATION))/;
const NOT_PISTON_MODEL = /^(208|CITATION|5\d\d|6\d\d|7\d\d|C-?208|PA-?31T|PA-?42|PA-?46-?(500|600|701)TP|B?200|B?300|350|C?90|E?90|F90|1900|99|SF50|TBM|PC-?(6|12|24)|AT-?(5|6|8)\d\d|DHC-?[2-8]|R(22|44|66)|EC|AS ?3|BO-?105|BK|UH|OH|MD ?(5|9)|369)/;
export function isPiston(c) {
  const cat = c.cat.toUpperCase(), eng = c.engType.toUpperCase();
  if (cat && !/^AIRPLANE/.test(cat)) return false;
  if (eng) return /RECIP/.test(eng);
  const mk = c.make.toUpperCase(), mo = c.model.toUpperCase().replace(/^(CESSNA|PIPER|BEECH)\s+/, '');
  // turbine versions that the piston family regexes would otherwise catch (PA-31T Cheyenne, Lancair IV-P-T Propjet)
  if (/^PA-?31T|^PA-?42|IV-?P-?T\b|PROPJET|JETPROP/.test(mo)) return false;
  if (c.fam) return !TURBOPROP.has(c.fam);
  if (NOT_PISTON_MAKE.test(mk)) return false;
  if (/^(CESSNA|TEXTRON|BEECH|PIPER|HAWKER|RAYTHEON)/.test(mk) && NOT_PISTON_MODEL.test(mo)) return false;
  return true;
}

// ---------------------------------------------------------------- email (Resend)
// POST https://api.resend.com/emails, Authorization: Bearer <RESEND_API_KEY>, JSON {from, to, subject, text}
// (resend.com/docs/api-reference/emails/send-email, read 25-Nov-2026). Free plan: 3,000 a month, 100 a day.
// Until a domain is verified in Resend, the sender must be onboarding@resend.dev and Resend delivers only to
// the Resend account's own address (resend.com/docs/knowledge-base/403-error-resend-dev-domain). PING_FROM sets
// a different sender. alerts.wamware.com was verified in Resend 25-Nov-2026 (DNS at Sierra Web / Domains Done Right),
// so the default sender is pings@alerts.wamware.com.
// ntfy was dropped 25-Nov-2026: its iPhone app showed pings only inside the app.
export const emailReady = () => !!env('RESEND_API_KEY');
// Sending caps (v0.11): Resend's free plan allows 100 emails a day, so stay under it with room for confirm emails.
export const CAP_DAY_ALL = 90, CAP_DAY_PROFILE = 12;
export const apiUrl = q => APP_URL + '.netlify/functions/api?' + new URLSearchParams(q).toString();
export const unsubUrl = p => p.etoken ? apiUrl({ op: 'unsub', code: p.code, t: p.etoken }) : '';
export const page = (title, msg) => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:40px 16px;background:#10141a;color:#e7e4dc;font:15px/1.5 -apple-system,system-ui,sans-serif}main{max-width:520px;margin:0 auto}h1{font-size:19px}a{color:#f5a623}</style></head>
<body><main><h1>${title}</h1><p>${msg}</p><p><a href="${APP_URL}">Open Tracking Piston GA Accidents</a></p></main></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
export async function sendEmail(to, { title, body, click = '', unsub = '' }) {
  const key = env('RESEND_API_KEY');
  if (!key) return { ok: false, status: 0, why: 'Email sending is not set up on the server yet (RESEND_API_KEY).' };
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/.test(to || '')) return { ok: false, status: 0, why: 'No valid email address in the profile.' };
  const text = String(body || '') + (click ? `\n\nOpen in the app: ${click}` : '') +
    `\n\n--\nTracking Piston GA Accidents (GeezerGeek Pilot). Change these emails in section 3 of ${APP_URL}` +
    (unsub ? `\nStop all emails with one click: ${unsub}` : '');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('PING_FROM') || 'Tracking Piston GA Accidents <pings@alerts.wamware.com>', to: [to], subject: String(title || '').slice(0, 200), text }),
  });
  let why = '';
  if (!r.ok) { try { why = (await r.json()).message || ''; } catch (e) { /* ignore */ } }
  return { ok: r.ok, status: r.status, why };
}

export const fmtDate = iso => {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${M[+m[2] - 1]}-${m[1]}` : '';
};
export const caseLine = c => `${fmtDate(c.date)} ${c.reg} ${c.make} ${c.model}, ${c.city}${c.st ? ', ' + c.st : ''}`;
export const injuryText = c => c.fatal ? `${c.fatal} fatal` : c.serious ? `${c.serious} serious` : c.minor ? `${c.minor} minor` : c.highest ? 'no injuries' : 'injuries not yet stated';
export const reportPdf = c => c.mkey ? `https://data.ntsb.gov/carol-repgen/api/Aviation/ReportMain/GenerateNewestReport/${c.mkey}/pdf` : '';

export const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});
