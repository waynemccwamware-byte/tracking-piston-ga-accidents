#!/usr/bin/env python3
"""Build site/data/trend.json for the key stats' "better/worse than trend" lines (v0.12; v0.31 split).

Source: GA Accident Stats' bundled NTSB data (piston-ga-stats repo, site/data/accidents.json), which covers
only its listed piston families (no homebuilts or other makes). Like GA Accident Stats' Summary, only Part 91
accidents count (its `part` column 0; Part 135 is 1). For each of the last ten full years it keeps the month/day
of every accident, split into piston singles (S) and piston twins (T) by GA Accident Stats' TWINS list:
  fatal: {S: {year: [mmdd…]}, T: {…}}   all: {S: {…}, T: {…}}
so the page can count any date window per year for All pistons (S+T), All singles (S) or All twins (T).

Usage: python3 tools/build-trend.py /path/to/piston-ga-stats/site/data/accidents.json
Re-run once a year (or after GA Accident Stats' monthly update) and commit the result.
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
years = list(range(last - 9, last + 1))
out = {'source': 'GA Accident Stats (piston-ga-stats site/data/accidents.json), Part 91', 'ntsbAsOf': m['ntsbAsOf'],
       'fams': sorted({m['fams'][i][1] for i in piston}), 'twins': sorted({m['fams'][i][1] for i in twin}),
       'fatal': {'S': {}, 'T': {}}, 'all': {'S': {}, 'T': {}}}
for y in years:
    rows = [r for r in src['rows'] if r[C['y']] == y and r[C['fam']] in piston and r[C['part']] == 0]
    for g, keep in (('S', lambda r: r[C['fam']] not in twin), ('T', lambda r: r[C['fam']] in twin)):
        out['all'][g][str(y)] = sorted(r[C['m']] * 100 + r[C['d']] for r in rows if keep(r))
        out['fatal'][g][str(y)] = sorted(r[C['m']] * 100 + r[C['d']] for r in rows if keep(r) and r[C['fatal']] > 0)
json.dump(out, open('site/data/trend.json', 'w'), separators=(',', ':'))
for y in map(str, years):
    print(y, 'singles', len(out['all']['S'][y]), len(out['fatal']['S'][y]), ' twins', len(out['all']['T'][y]), len(out['fatal']['T'][y]))
print('twins:', out['twins'])
