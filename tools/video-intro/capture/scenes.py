"""App scenes for the Tracking Piston GA Accidents intro video, each timed to Wayne's cleaned take.
A scene starts LEAD s before its take; cue(name, phrase) = when that phrase is spoken (by its share of the text, a
good-enough estimate for steady narration). Recent fatal accidents are never opened (Wayne, 26-Nov-2026)."""
import sys, json, pathlib, subprocess
from playwright.sync_api import sync_playwright
import rig
from film import Film
V = rig.V; OUT = pathlib.Path('/tmp/vid/app'); OUT.mkdir(parents=True, exist_ok=True)
LINES = dict(json.loads((V / 'vo-lines.json').read_text()))
LEAD, TAIL = 0.3, 0.5
def dur(n): return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(V / f'vo/b{n:02d}.m4a')], capture_output=True, text=True).stdout)
def cue(n, phrase):
    t = LINES[str(n)] if str(n) in LINES else LINES[n]; i = t.index(phrase)
    return LEAD + 0.4 + (dur(n) - 0.8) * i / len(t)
def end(n): return LEAD + dur(n) + TAIL
def box(pg, sel): b = pg.locator(sel).first.bounding_box(); return [b['x'], b['y'], b['width'], b['height']]
def scroll_top(pg, sel, off=12): pg.evaluate(f"window.scrollTo(0, document.querySelector('{sel}').getBoundingClientRect().top + scrollY - {off})"); pg.wait_for_timeout(200)

def textbox(pg, sel):
    return pg.evaluate("s => { const r = document.createRange(); r.selectNodeContents(document.querySelector(s)); const b = r.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }", sel)

def b02a(pg):   # v2 opening: the real list, gently scrolling, no pointer (until the flow chart takes over)
    from art_scenes import B02_SPLIT
    pg.goto(rig.APP); rig.ready(pg); pg.click('#sevSeg button[data-v="all"]'); pg.wait_for_timeout(300); scroll_top(pg, '#kstats', 16)
    f = Film(pg, str(OUT / 'b02a.mp4')); f.hide_cursor()
    f.until(0.6); f.scroll_to(f.top_of('#secList') + 120, B02_SPLIT - 1.2)
    f.close(B02_SPLIT)

def b05(pg):
    pg.goto(rig.APP); rig.ready(pg)
    f = Film(pg, str(OUT / 'b05.mp4')); f.cx, f.cy = 700, 330
    f.until(cue(5, 'I built')); f.glide(*f.center(textbox(pg, 'h1')), 0.8); f.spot(textbox(pg, 'h1'), 6)
    f.until(cue(5, 'Tracking Piston')); f.spot('.purpose-line', 4)
    f.until(cue(5, 'Tracking Piston') + 1.2); f.spot(textbox(pg, 'h1'), 6)
    f.close(end(5))

def b07(pg):
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#kstats', 16)
    f = Film(pg, str(OUT / 'b07.mp4')); f.cx, f.cy = 700, 420
    ks = pg.locator('#kstats .ks')
    f.until(cue(7, 'US piston')); f.spot(f.lbox(ks.nth(0)), 4); f.glide(*f.center(f.lbox(ks.nth(0))), 0.7)
    f.until(cue(7, 'fatal accidents,')); f.spot(f.lbox(ks.nth(1)), 4); f.glide(*f.center(f.lbox(ks.nth(1))), 0.6)
    f.until(cue(7, 'better or worse')); f.spot('#ksTrend', 6)
    f.close(end(7))

def b08(pg):
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#secList', 10)
    f = Film(pg, str(OUT / 'b08.mp4')); f.cx, f.cy = 600, 380
    f.until(0.5); f.click_on('#sevSeg button[data-v="all"]', 0.6)
    f.until(cue(8, 'newest first')); f.spot('#list', 2)
    f.until(cue(8, 'Tap an accident') - 0.9); f.spot_off(); f.click_on('#q', 0.5); f.type('N6741E', 12)
    f.until(cue(8, "for NTSB's")); f.click_on('#c-CEN27LA008', 0.6)
    pg.wait_for_timeout(300); f.spot('#c-CEN27LA008', 3)
    f.until(cue(8, 'probable cause')); f.spot('#c-CEN27LA008 .pc', 4)
    f.close(end(8))

def b09(pg):
    pg.goto(rig.APP); rig.ready(pg); pg.click('#sevSeg button[data-v="all"]'); pg.wait_for_timeout(300); scroll_top(pg, '#sevSeg', 70)
    f = Film(pg, str(OUT / 'b09.mp4')); f.cx, f.cy = 700, 420
    f.until(cue(9, "When the FAA")); f.spot('#c-P-N3236G-2026-11-24', 3)
    row = '#c-P-N3236G-2026-11-24'
    f.until(cue(9, 'marked PRELIM') - 0.5); f.spot(row + ' .pl', 6); f.glide(*f.center(row + ' .pl'), 0.6)
    f.until(cue(9, 'and the NTSB record') + 1.2); f.spot(row, 3)
    f.close(end(9))

def b10(pg):
    pg.goto(rig.APP); rig.ready(pg); pg.click('#sevSeg button[data-v="all"]'); pg.wait_for_timeout(300); scroll_top(pg, '#sevSeg', 40)
    f = Film(pg, str(OUT / 'b10.mp4')); f.cx, f.cy = 600, 300
    f.until(0.4); f.click_on('#famBtn', 0.6); f.spot('#famPanel', 2)
    f.until(cue(10, 'your type')); f.click_on('#famPanel input[data-f="SR22"]', 0.6)
    f.until(cue(10, 'a whole brand')); f.click_on('#famPanel input[data-f="DA40"]', 0.6)
    f.until(cue(10, 'all singles')); f.spot('#famPanel .pick-quick', 4); f.glide(*f.center('#famPanel .qbtn[data-q="ps"]'), 0.6)
    f.close(end(10))

def b11(pg):
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#secList', 10)
    f = Film(pg, str(OUT / 'b11.mp4')); f.hide_cursor()
    f.until(0.4); f.scroll_to(f.top_of('#secAlerts') - 10, 1.4)
    f.until(cue(11, 'Alerts')); f.spot('#secAlerts', 2)
    f.close(end(11))

def b12(pg):
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#secAlerts', 10)
    f = Film(pg, str(OUT / 'b12.mp4')); f.cx, f.cy = 700, 300
    f.until(cue(12, 'Every fatal')); f.spot(f.lbox(pg.locator('label.ck', has=pg.locator('#rFatal'))), 4); f.glide(*f.center('#rFatal'), 0.6)
    f.until(cue(12, 'Add other')); f.click_on('#rNew', 0.6); f.spot('#rNewBox', 4)
    f.until(cue(12, 'severity')); f.spot('#rSev', 4)
    f.until(cue(12, 'types you')); f.spot_off(); f.click_on('#rFamBtn', 0.5)
    pg.wait_for_timeout(200); scroll_top(pg, '#rFamPanel', 120)
    f.click_on('#rFamPanel input[data-f="SR22"]', 0.5); f.click_on('#rFamPanel input[data-f="DA40"]', 0.5)
    f.close(end(12))

def b13(pg):
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#secAlerts', 10)
    f = Film(pg, str(OUT / 'b13.mp4')); f.cx, f.cy = 760, 380
    f.until(0.25); f.click_on('#emailIn', 0.4); f.type('pilot@example.com', 18)
    f.spot(f.lbox(pg.locator('label.ck', has=pg.locator('#pEmail'))), 4)
    f.until(cue(13, 'Save') - 0.2); f.spot_off(); f.click_on('#save', 0.4, settle=0.5); f.spot('#msg', 4)
    f.close(end(13) + 0.4)

def b14(pg):
    pg.goto(rig.APP + 'video/mail.html#confirm'); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(400)
    f = Film(pg, str(OUT / 'b14.mp4')); f.cx, f.cy = 300, 420
    f.until(0.5); f.spot('#i1', 2)
    f.until(cue(14, 'confirm link')); f.spot('#link', 4); f.glide(*f.center('#link'), 0.7)
    f.until(cue(14, 'Click it')); f.click(0.1); f.spot_clear()
    pg.goto(rig.APP + '.netlify/functions/api?op=confirm&code=P7KM-4HXR-9WQD&t=k2m8'); pg.wait_for_timeout(300)
    f.cx, f.cy = 420, 260
    f.until(cue(14, 'You can send') - 0.2)
    pg.prof.p.update(email='pilot@example.com', emailOn=True, emailVerified=True)
    pg.goto(rig.APP); rig.ready(pg); scroll_top(pg, '#secAlerts', 10)
    f.cx, f.cy = 560, 300
    f.spot('#test', 4); f.glide(*f.center('#test'), 0.7)
    f.until(cue(14, 'to be sure')); f.click(0.5); f.spot('#msg', 4)
    f.close(end(14))

def b16(pg):
    pg.goto(rig.APP + 'video/mail.html#ping'); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(400)
    f = Film(pg, str(OUT / 'b16.mp4')); f.cx, f.cy = 300, 420; f.hide_cursor()
    f.until(cue(16, 'one-click')); f.spot('#foot', 6)
    f.close(end(16))

if __name__ == '__main__':
    names = sys.argv[1:] or ['b05', 'b07', 'b08', 'b09', 'b10', 'b11', 'b12', 'b13', 'b14', 'b16']
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for n in names:
            pg = rig.new_page(b, {'sev': 'fatal', 'fams': []})
            globals()[n](pg)
            if pg.errors: print(n, 'PAGE ERRORS', pg.errors)
            pg.context.close()
        b.close()
