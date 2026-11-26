"""Filming rig for the Tracking Piston GA Accidents intro video (26-Nov-2026).
The app is served from this repo's site/ under its real address; the API is mocked: the feed is a snapshot of the live
feed taken 26-Nov-2026 (tools/video-intro/feed.json, trimmed to the fields the page shows), and profile calls answer with
a demo profile (P7KM-4HXR-9WQD, pilot@example.com), so filming never touches a real profile or sends email.
Viewport 960x540 CSS at 2x = 1920x1080."""
import json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[3]
SITE, V = ROOT / 'site', ROOT / 'tools/video-intro'
FONTS = pathlib.Path('/tmp/fonts')
APP = 'https://tracking-piston-ga-accidents.netlify.app/'
FEED = json.loads((V / 'feed.json').read_text())
FONT_CSS = ''.join(
    f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;src:url(https://fonts.gstatic.com/__f/{pk}/{pk}-latin-{w}-normal.woff2) format('woff2')}}"
    for fam, pk in (('IBM Plex Sans', 'ibm-plex-sans'), ('IBM Plex Mono', 'ibm-plex-mono')) for w in (300, 400, 500, 600))
DEMO = 'P7KM-4HXR-9WQD'
CONFIRMED = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Email confirmed</title>
<style>body{{margin:0;padding:40px 16px;background:#10141a;color:#e7e4dc;font:15px/1.5 -apple-system,system-ui,sans-serif}}main{{max-width:520px;margin:0 auto}}h1{{font-size:19px}}a{{color:#f5a623}}</style></head>
<body><main><h1>Email confirmed</h1><p>Pings for this alert profile will go to pilot@example.com.</p><p><a href="{APP}">Open Tracking Piston GA Accidents</a></p></main></body></html>"""

class Profile:
    def __init__(self):
        self.p = {'code': DEMO, 'email': '', 'emailOn': False, 'emailReady': True, 'emailVerified': True, 'confirmSentAt': None,
                  'rules': {'fatal': True, 'newOn': False, 'sev': ['Fatal', 'Serious'], 'fams': [], 'states': []},
                  'log': [], 'watches': [], 'owner': False}
    def handle(self, r):
        u, m = r.request.url, r.request.method
        if 'op=feed' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(FEED))
        if 'op=profile' in u and m == 'POST':
            b = json.loads(r.request.post_data or '{}'); out = dict(self.p)
            if 'rules' in b: self.p['rules'] = {**self.p['rules'], **b['rules']}
            if 'emailOn' in b: self.p['emailOn'] = b['emailOn']
            if 'email' in b and b['email'] != self.p['email']:
                self.p.update(email=b['email'], emailVerified=False, confirmSentAt='2026-11-26T15:30:00Z'); out = {**self.p, 'confirm': {'ok': True}}
            else: out = dict(self.p)
            return r.fulfill(status=200, content_type='application/json', body=json.dumps(out))
        if 'op=profile' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(self.p))
        if 'op=test' in u: return r.fulfill(status=200, content_type='application/json', body='{"ok":true}')
        if 'op=confirm' in u: self.p['emailVerified'] = True; return r.fulfill(status=200, content_type='text/html', body=CONFIRMED)
        return r.fulfill(status=200, content_type='application/json', body='{}')

def make_route(prof):
    def route(r):
        u = r.request.url
        if 'fonts.googleapis.com' in u: return r.fulfill(status=200, content_type='text/css', body=FONT_CSS)
        if 'fonts.gstatic.com/__f/' in u:
            pk, name = u.split('/__f/')[1].split('/')
            return r.fulfill(path=str(FONTS / f'fontsource-{pk}-5.3.0/files' / name), content_type='font/woff2')
        if u.startswith(APP + '.netlify/functions/api'): return prof.handle(r)
        if u.startswith(APP + 'video/'):
            return r.fulfill(path=str(V / u[len(APP + 'video/'):].split('#')[0].split('?')[0]), content_type='text/html')
        if u.startswith(APP):
            path = u[len(APP):].split('?')[0].split('#')[0] or 'index.html'
            f = SITE / path
            if f.is_dir(): f = f / 'index.html'
            ct = {'.html': 'text/html', '.json': 'application/json', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml'}.get(f.suffix, 'application/octet-stream')
            return r.fulfill(path=str(f), content_type=ct) if f.exists() else r.fulfill(status=404, body='')
        if u.startswith('data:') or u.startswith('blob:'): return r.continue_()
        return r.abort()
    return route

def new_page(browser, filters=None):
    ctx = browser.new_context(viewport={'width': 960, 'height': 540}, device_scale_factor=2)
    prof = Profile(); ctx.route('**/*', make_route(prof))
    ls = {'tpga-code': DEMO, 'tpga-filters2': json.dumps(filters or {'sev': 'fatal', 'fams': []}), 'tpga-watches': '[]'}
    ctx.add_init_script("(() => { const L = " + json.dumps(ls) + "; if (!sessionStorage.getItem('__seeded')) { Object.entries(L).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('__seeded', '1'); } })();")
    pg = ctx.new_page(); pg.errors = []; pg.prof = prof
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    return pg

def ready(pg):
    pg.wait_for_function("() => document.querySelectorAll('#list .acc').length > 0", timeout=10000)
    pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(400)
