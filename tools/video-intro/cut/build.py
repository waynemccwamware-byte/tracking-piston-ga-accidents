"""Assemble the Tracking Piston GA Accidents intro video: segments -> concat (copy) -> mix (VO + music bed) -> -16 LUFS.
Also writes captions (.srt + .en_US.srt for Facebook) and the YouTube description with chapters."""
import subprocess, pathlib, json, re, sys
import numpy as np
V = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V / 'capture'))
from scenes import cue, dur, LEAD, LINES
APP, ART, W = pathlib.Path('/tmp/vid/app'), pathlib.Path('/tmp/vid/art'), pathlib.Path('/tmp/vid/cut')
W.mkdir(parents=True, exist_ok=True)
MUSIC = pathlib.Path('/home/claude/claude-foreflight-primer/tools/music/audionautix-acoustic-guitar-1.mp3')
ORDER = ['s01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08', 'b09', 'b10', 'b11', 'b12', 'b13', 'b14', 'b15', 'b16', 'b17', 'end']
ART_SEGS = {'s01', 'b02', 'b03', 'b04', 'b06', 'b15', 'b17', 'end'}
FADES = {'s01': (0.8, 0.35), 'b03': (0.35, 0.35),   # b02 = app clip + flow chart, joined with its own fades (v2)
          'b04': (0.35, 0.35), 'b06': (0.35, 0.35), 'b15': (0.35, 0.35), 'b17': (0.35, 0), 'end': (0, 1.2)}
SR = 48000
def run(*a): subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)
def length(f): return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout)
def pcm(f, ch=2):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', str(f), '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()

# 1. segments (art ones get their fades; a crossfade-free join, so every file is encoded once more at most)
segs, starts, t = [], {}, 0.0
for n in ORDER:
    src = (ART if n in ART_SEGS else APP) / f'{n}.mp4'
    out = src
    if n in FADES:
        d = length(src); fi, fo = FADES[n]; vf = ['format=yuv420p']
        if fi: vf.append(f'fade=t=in:st=0:d={fi}')
        if fo: vf.append(f'fade=t=out:st={d - fo:.3f}:d={fo}')
        out = W / f'{n}.mp4'; tmp = W / f'.{n}.tmp.mp4'
        run('-i', str(src), '-vf', ','.join(vf), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', str(tmp)); tmp.rename(out)
    starts[n] = t; t += length(out); segs.append(out)
TOTAL = t
(W / 'list.txt').write_text(''.join(f"file '{s}'\n" for s in segs))
run('-f', 'concat', '-safe', '0', '-i', str(W / 'list.txt'), '-c', 'copy', str(W / 'video.mp4'))

# 2. sound: VO at each beat's start + LEAD; music bed under beats 1-4 and 17-end, low under the voice
N = int(TOTAL * SR) + SR
mix = np.zeros((N, 2), np.float32)
vo_spans = []
for n in ORDER:
    if not n.startswith('b'): continue
    v = pcm(V / f'vo/{n}.m4a'); i = int((starts[n] + LEAD) * SR)
    mix[i:i + len(v)] += v; vo_spans.append((starts[n] + LEAD, starts[n] + LEAD + len(v) / SR))
m = pcm(MUSIC)
def lufs_of(x):
    p = W / '.l.wav'; import wave
    with wave.open(str(p), 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    e = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(p), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', e)[-1])
m_l = lufs_of(m[:SR * 60])
HI, LO = -30.0, -37.0          # music alone (title, end card) and under the voice; the VO sits at -21
def bed(t0, t1, off):           # music from track offset `off`, placed t0..t1, with a gain envelope
    a, b = int(t0 * SR), int(t1 * SR); seg = m[int(off * SR): int(off * SR) + (b - a)].copy()
    tt = t0 + np.arange(len(seg)) / SR
    g = np.full(len(seg), HI)
    for s0, s1 in vo_spans:     # duck under speech, ramp 0.6 s
        k = np.clip(np.minimum(tt - (s0 - 0.6), (s1 + 0.6) - tt) / 0.6, 0, 1); g = np.minimum(g, HI - (HI - LO) * k)
    gain = 10 ** ((g - m_l) / 20)
    fi, fo = min(2.0, (t1 - t0) / 4), 3.0
    gain *= np.clip((tt - t0) / fi, 0, 1) * np.clip((t1 - tt) / fo, 0, 1)
    mix[a:a + len(seg)] += seg * gain[:, None]
bed(0.0, starts['b05'] + 1.5, 0.0)
bed(starts['b17'] - 2.0, TOTAL, 40.0)
mix = mix[:int(TOTAL * SR)]
import wave
with wave.open(str(W / 'mix.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
mj = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(W / 'mix.wav'), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
j = json.loads(mj[mj.rindex('{'):mj.rindex('}') + 1])
final = V / 'final'; final.mkdir(exist_ok=True)
outv = final / 'tracking-piston-ga-accidents.mp4'
run('-i', str(W / 'video.mp4'), '-i', str(W / 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true,aresample=48000",
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', str(outv))

# 3. captions: each take split into sentences, timed by their share of the text
def ts(x): h, r = divmod(x, 3600); mm, s = divmod(r, 60); return f'{int(h):02d}:{int(mm):02d}:{s:06.3f}'.replace('.', ',')
subs = []
for n in ORDER:
    if not n.startswith('b'): continue
    k = int(n[1:]); text = LINES[str(k)]
    parts = [p for p in re.split(r'(?<=[.!?:])\s+', text) if p]
    pos = 0
    for i, p in enumerate(parts):
        a = text.index(p, pos); pos = a + len(p)
        t0 = starts[n] + cue(k, p); t1 = starts[n] + (cue(k, parts[i + 1]) if i + 1 < len(parts) else LEAD + dur(k) - 0.3)
        subs.append((t0, t1 - 0.05, p))
srt = ''.join(f'{i + 1}\n{ts(a)} --> {ts(b)}\n{x}\n\n' for i, (a, b, x) in enumerate(subs))
(final / 'tracking-piston-ga-accidents.srt').write_text(srt); (final / 'tracking-piston-ga-accidents.en_US.srt').write_text(srt)

# 4. YouTube description
def mmss(x): return f'{int(x // 60)}:{int(x % 60):02d}'
chapters = [(0, 'Passive vs. active'), (starts['b05'], 'The app'), (starts['b07'], 'Key stats'),
            (starts['b08'], 'Recent accidents and PRELIM entries'), (starts['b11'], 'Set up your alerts'),
            (starts['b15'], 'What the pings look like'), (starts['b17'], 'Wrap-up')]
desc = f"""Get pinged, by email, when a serious accident happens in a type like the one you fly. Tracking Piston GA Accidents is a free GeezerGeek Pilot app that lists US piston airplane accidents as NTSB posts them (and earlier, from the FAA's preliminary notices), and emails you about the ones you care about.

Open GeezerGeek Pilot Apps and pick Tracking Piston GA Accidents (Safety Stats):
https://geezer-geek-pilot-control-panel.netlify.app/

Chapters
{chr(10).join(f'{mmss(t)} {n}' for t, n in chapters)}

Accident data: NTSB (Public API) and the FAA's Preliminary Accident and Incident Notices. Preliminary information is subject to change; NTSB's final report is the record. The accident list shown was captured 26-Nov-2026; the email addresses and the inbox shown are demo stand-ins, and the phone graphics use made-up, masked tail numbers.

Music: "Acoustic Guitar 1" by Audionautix is licensed under a Creative Commons Attribution 4.0 license. https://creativecommons.org/licenses/by/4.0/
"""
(final / 'youtube-description.txt').write_text(desc)
print(json.dumps({'total': round(TOTAL, 2), 'music_lufs_ref': m_l, 'starts': {k: round(v, 2) for k, v in starts.items()}}, indent=0))
print(desc)
