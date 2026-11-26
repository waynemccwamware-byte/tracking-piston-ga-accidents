"""Art and card scenes for the intro video, drawn frame by frame from ../art.html (window.frame), 1920x1080, 30 fps."""
import sys, pathlib, subprocess
from playwright.sync_api import sync_playwright
import scenes
from scenes import cue, end, dur, LEAD, TAIL
V = scenes.V; OUT = pathlib.Path('/tmp/vid/art'); OUT.mkdir(parents=True, exist_ok=True)
F = pathlib.Path('/tmp/fonts')
CSS = ''.join(f"@font-face{{font-family:'IBM Plex Sans';font-weight:{w};src:url(file://{F}/fontsource-ibm-plex-sans-5.3.0/files/ibm-plex-sans-latin-{w}-normal.woff2)}}" for w in (300, 400, 500, 600))
CSS += ''.join(f"@font-face{{font-family:'IBM Plex Mono';font-weight:{w};src:url(file://{F}/fontsource-ibm-plex-mono-5.3.0/files/ibm-plex-mono-latin-{w}-normal.woff2)}}" for w in (500, 600))
FPS = 30
def plan():
    return {
        's01':   ('title', 5.5, {}),
        'b02':   ('CtoA', end(2), {'x': cue(2, 'to avoid it') + 0.4}),
        'b03':   ('A', end(3), {'f0': end(2) - cue(2, 'to avoid it') - 0.4}),
        'b04':   ('B', end(4), {'tn': cue(4, 'to be pinged')}),
        'b06':   ('link', end(6) + 1.5, {}),
        'b15':   ('D', end(15), {'ts': [cue(15, 'A new fatal'), cue(15, 'A new case'), cue(15, 'And when a case')]}),
        'b17':   ('BtoC', end(17) + 1.0, {'tn': -5, 'x': cue(17, 'This app simply')}),
        'end':   ('end', 9.0, {}),
    }
def render(pg, name, scene, length, o):
    tmp = OUT / f'.{name}.tmp.mp4'
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', str(FPS), str(tmp)], stdin=subprocess.PIPE)
    n = round(length * FPS)
    for i in range(n):
        pg.evaluate('a => window.frame(a[0], a[1], a[2])', [scene, i / FPS, o])
        ff.stdin.write(pg.screenshot(type='jpeg', quality=92))
    ff.stdin.close(); assert ff.wait() == 0
    tmp.rename(OUT / f'{name}.mp4'); print(name, f'{length:.2f}s', n, 'frames')
if __name__ == '__main__':
    P = plan(); names = sys.argv[1:] or list(P)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.goto('file://' + str(V / 'art.html')); pg.add_style_tag(content=CSS); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(500)
        for nme in names: render(pg, nme, *P[nme])
        b.close()
