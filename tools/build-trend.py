#!/usr/bin/env python3
"""Build site/data/trend.json for the "better/worse than trend" line under Fatal accidents (v0.12).

Source: GA Accident Stats' bundled NTSB data (piston-ga-stats repo, site/data/accidents.json), which covers
only its listed piston families (no homebuilts or other makes). For each of the last ten full years it keeps
the month/day of every fatal accident in those families, so the page can count any date window per year.

Usage: python3 tools/build-trend.py /path/to/piston-ga-stats/site/data/accidents.json
Re-run once a year (or after GA Accident Stats' monthly update) and commit the result.
"""
import json, sys

src = json.load(open(sys.argv[1]))
m = src['meta']
C = {c: i for i, c in enumerate(m['cols'])}
TURBOPROP = {'PA-46 Meridian/M500/M600/M700', 'PA-46 JetPROP', 'PC-12', 'E1000', 'TBM'}
piston = {i for i, (brand, fam) in enumerate(m['fams']) if m['eng'][i] == 'P' and fam not in TURBOPROP}
last = int(m['ntsbAsOf'][:4]) - 1          # last full year in the data
years = list(range(last - 9, last + 1))
out = {'source': 'GA Accident Stats (piston-ga-stats site/data/accidents.json)', 'ntsbAsOf': m['ntsbAsOf'],
       'fams': sorted({m['fams'][i][1] for i in piston}), 'years': {}}
for y in years:
    out['years'][str(y)] = sorted(r[C['m']] * 100 + r[C['d']] for r in src['rows']
                                  if r[C['y']] == y and r[C['fam']] in piston and r[C['fatal']] > 0)
json.dump(out, open('site/data/trend.json', 'w'), separators=(',', ':'))
print({y: len(v) for y, v in out['years'].items()})
