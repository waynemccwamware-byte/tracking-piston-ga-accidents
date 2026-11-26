"""Frame-by-frame filming of the live app: eased pointer, amber spotlight ring, click ripple, eased scroll.
Time is virtual: each frame is 1/30 s of video, rendered by screenshot, so actions land on exact VO times."""
import subprocess, math, os
FPS = 30
OVERLAY = r"""
(() => {
  if (window.__ov) return;
  const mk = (css) => { const d = document.createElement('div'); d.style.cssText = css; document.documentElement.appendChild(d); return d; };
  const cur = mk('position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;will-change:transform');
  cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const spot = mk('position:fixed;left:0;top:0;width:0;height:0;border:3px solid #f5a623;border-radius:10px;box-shadow:0 0 18px 2px rgba(245,166,35,.55),0 0 0 4000px rgba(8,10,14,.32);z-index:2147483640;pointer-events:none;opacity:0');
  const rip = mk('position:fixed;left:0;top:0;width:0;height:0;border:3px solid #f5a623;border-radius:50%;z-index:2147483646;pointer-events:none;opacity:0');
  const fade = mk('position:fixed;inset:0;background:#000;z-index:2147483645;pointer-events:none;opacity:0');
  window.__ov = (s) => {
    cur.style.transform = `translate(${s.cx - 3}px,${s.cy - 2}px)`; cur.style.opacity = s.cur;
    if (s.sp) { const p = 8; Object.assign(spot.style, { left: s.sp[0] - p + 'px', top: s.sp[1] - p + 'px', width: s.sp[2] + 2 * p + 'px', height: s.sp[3] + 2 * p + 'px', opacity: s.spo }); }
    else spot.style.opacity = 0;
    if (s.rp) { const r = s.rp[2]; Object.assign(rip.style, { left: s.rp[0] - r + 'px', top: s.rp[1] - r + 'px', width: 2 * r + 'px', height: 2 * r + 'px', opacity: s.rp[3] }); }
    else rip.style.opacity = 0;
    fade.style.opacity = s.fade;
  };
})();
"""
def ease(x):
    x = max(0.0, min(1.0, x)); return 4 * x * x * x if x < .5 else 1 - (-2 * x + 2) ** 3 / 2

class Film:
    def __init__(self, page, out, fade_in=0.4):
        self.pg, self.out, self.t, self.n = page, out, 0.0, 0
        self.cx, self.cy, self.curo = 480.0, 360.0, 1.0
        self.sp = None; self.sp_from = None; self.sp_t0 = -9; self.spo_target = 0; self.spo = 0.0; self.spo_from = 0.0
        self.rp_t0 = None; self.rp_xy = (0, 0); self.fade_in = fade_in; self.fade_out_at = None
        page.evaluate(OVERLAY); pass
        self.ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', str(FPS), out], stdin=subprocess.PIPE)
    # ---- one frame ----
    def frame(self):
        t = self.t
        # spotlight: rect glides and opacity fades over 0.35 s
        k = ease((t - self.sp_t0) / 0.35)
        rect = None
        if self.sp:
            if self.sp_from and self.spo_from > 0.01: rect = [a + (b - a) * k for a, b in zip(self.sp_from, self.sp)]
            else: rect = self.sp
        self.spo = self.spo_from + (self.spo_target - self.spo_from) * k
        rp = None
        if self.rp_t0 is not None:
            u = (t - self.rp_t0) / 0.7
            if 0 <= u <= 1: rp = [self.rp_xy[0], self.rp_xy[1], 6 + 26 * ease(u), 1 - u]
        fade = 0.0
        if t < self.fade_in: fade = 1 - t / self.fade_in
        if self.fade_out_at is not None and t > self.fade_out_at: fade = min(1, (t - self.fade_out_at) / 0.4)
        self.pg.evaluate('s => window.__ov && window.__ov(s)', {'cx': self.cx, 'cy': self.cy, 'cur': self.curo, 'sp': rect, 'spo': round(self.spo, 3), 'rp': rp, 'fade': fade})
        self.ff.stdin.write(self.pg.screenshot(type='jpeg', quality=93))
        self.n += 1; self.t = self.n / FPS
    def until(self, t):
        while self.t < t - 1e-6: self.frame()
    def wait(self, s): self.until(self.t + s)
    # ---- pointer ----
    def glide(self, x, y, dur=0.7, drag=False):
        x0, y0, t0 = self.cx, self.cy, self.t
        while self.t < t0 + dur - 1e-6:
            k = ease((self.t - t0) / dur)
            self.cx, self.cy = x0 + (x - x0) * k, y0 + (y - y0) * k
            self.pg.mouse.move(self.cx, self.cy)
            self.frame()
        self.cx, self.cy = x, y; self.pg.mouse.move(x, y)
    def center(self, sel_or_box):
        b = self.box(sel_or_box); return b[0] + b[2] / 2, b[1] + b[3] / 2
    def lbox(self, loc):
        b = loc.bounding_box(); return [b['x'], b['y'], b['width'], b['height']]
    def box(self, s):
        if isinstance(s, (list, tuple)): return list(s)
        b = self.pg.locator(s).first.bounding_box(); return [b['x'], b['y'], b['width'], b['height']]
    def click(self, settle=0.25, real=True):
        self.rp_t0, self.rp_xy = self.t, (self.cx, self.cy)
        if real: self.pg.mouse.down(); self.pg.mouse.up()
        self.pg.wait_for_timeout(int(settle * 1000))   # real time for the app to react; no video time passes
    def click_on(self, sel, dur=0.7, settle=0.25, dx=0, dy=0):
        x, y = self.center(sel); self.glide(x + dx, y + dy, dur); self.click(settle)
    def drag(self, x, y, dur=1.0):
        self.pg.mouse.down(); self.rp_t0, self.rp_xy = self.t, (self.cx, self.cy)
        self.glide(x, y, dur); self.pg.mouse.up(); self.pg.wait_for_timeout(250)
    def type(self, text, cps=9):
        for ch in text:
            self.pg.keyboard.type(ch); self.wait(1 / cps)
    # ---- spotlight ----
    def spot(self, s, pad=0):
        b = self.box(s); b = [b[0] - pad, b[1] - pad, b[2] + 2 * pad, b[3] + 2 * pad]
        self.sp_from = [*self.sp] if self.sp else None
        self.spo_from = self.spo; self.sp = b; self.spo_target = 1; self.sp_t0 = self.t
    def spot_off(self):
        self.spo_from = self.spo; self.spo_target = 0; self.sp_t0 = self.t
    def spot_clear(self):
        self.sp = None; self.spo = self.spo_from = self.spo_target = 0.0
    def hide_cursor(self): self.curo = 0
    def show_cursor(self): self.curo = 1
    # ---- scroll ----
    def scroll_to(self, y, dur=0.8):
        y0, t0 = self.pg.evaluate('scrollY'), self.t
        while self.t < t0 + dur - 1e-6:
            self.pg.evaluate(f'window.scrollTo(0,{y0 + (y - y0) * ease((self.t - t0) / dur):.1f})'); self.frame()
        self.pg.evaluate(f'window.scrollTo(0,{y})')
    def top_of(self, sel): return self.pg.evaluate(f"Math.round(document.querySelector('{sel}').getBoundingClientRect().top+scrollY)")
    def close(self, end):
        self.fade_out_at = end - 0.4; self.until(end)
        self.ff.stdin.close(); assert self.ff.wait() == 0
        print(os.path.basename(self.out), f'{self.t:.2f}s', self.n, 'frames')
