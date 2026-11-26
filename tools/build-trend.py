#!/usr/bin/env python3
"""Build site/data/trend.json for the key stats' fatal-accident chart (v0.33).

Source: GA Accident Stats' bundled NTSB data (piston-ga-stats repo, site/data/accidents.json), which covers
only its listed piston families (no homebuilts or other makes). Like GA Accident Stats' Summary, only Part 91
accidents count (its `part` column 0; Part 135 is 1). Output:
  years:  {S: {year: fatal accidents}, T: {…}}  2000 to the last full year; piston singles (S) and twins (T)
          split by GA Accident Stats' TWINS list (the page draws the 3-year average from 2002)
  qshare: [q1, q2, q3, q4]  average share of a year's fatal accidents in each quarter, last ten full years,
          all piston types (used to annualize a quarter: count ÷ share)

Usage: python3 tools/build-trend.py /path/to/piston-ga-stats/site/data/accidents.json
Re-run each January (or after GA Accident Stats' monthly update) and commit the result.
"""
import json, sys

# GA Accident Stats site/index.html TWINS (brand + family), checked 26-Nov-2026
TWINS = {'Beech Baron 55/58', 'Beech Duchess 76', 'Beech Travel Air 95', 'Cessna 310/320', 'Cessna 335/340',
         'Cessna 336/337', 'Cessna 401-421 twins', 'Diamond DA42', 'Diamond DA62', 'Piper PA-23 Apache/Aztec',
         'Piper PA-30/39 Twin Comanche', 'Piper PA-31 Navajo', 'Piper PA-34 Seneca', 'Piper PA-44 Seminole'}
src = json.load(open(sys.argv[1]))
m = src['meta']
C = {c: i for i, c in enumerate(m['cols'])}
TURBOPROP = {'PA-46 Meridian/M500/M600/M700', 'PA-46 JetPROP', 'PC-12', 'E1000', 'TBM'}
piston = {i for i, (brand, fam) in enumerate(m['fams']) if m['eng'][i] == 'P' and fam not in TURBOPROP}
twin = {i for i in piston if ' '.join(m['fams'][i]) in TWINS}
last = int(m['ntsbAsOf'][:4]) - 1          # last full year in the data
fatal = [r for r in src['rows'] if r[C['fam']] in piston and r[C['part']] == 0 and r[C['fatal']] > 0 and 2000 <= r[C['y']] <= last]
out = {'source': 'GA Accident Stats (piston-ga-stats site/data/accidents.json), Part 91, fatal accidents', 'ntsbAsOf': m['ntsbAsOf'],
       'fams': sorted({m['fams'][i][1] for i in piston}), 'twins': sorted({m['fams'][i][1] for i in twin}),
       'years': {'S': {}, 'T': {}}}
for y in range(2000, last + 1):
    out['years']['S'][str(y)] = sum(1 for r in fatal if r[C['y']] == y and r[C['fam']] not in twin)
    out['years']['T'][str(y)] = sum(1 for r in fatal if r[C['y']] == y and r[C['fam']] in twin)
shares = []
for y in range(last - 9, last + 1):
    rs = [r for r in fatal if r[C['y']] == y]
    shares.append([sum(1 for r in rs if (r[C['m']] - 1) // 3 == q) / len(rs) for q in range(4)])
out['qshare'] = [round(sum(s[q] for s in shares) / len(shares), 4) for q in range(4)]
json.dump(out, open('site/data/trend.json', 'w'), separators=(',', ':'))
print('qshare', out['qshare'])
for y in range(2000, last + 1): print(y, out['years']['S'][str(y)], out['years']['T'][str(y)])
