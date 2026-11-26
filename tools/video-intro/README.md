# Tracking Piston GA Accidents intro video — production kit (26-Nov-2026)

- Script and storyboard: the Claude doc "Tracking Piston GA Accidents: intro video script". Lines in `vo-lines.json`;
  recorder at `/record/` (from Weather's recorder). Wayne's takes in `vo-raw/`, cleaned by `build_vo.py` (RNNoise std, -21 LUFS) into `vo/`.
- `art.html`: title, art A (passive feed), B (phone ping), C (radar), D (pings stacking), link card and end card; `window.frame(scene, t, o)`
  draws one frame. No real accidents on the art: generic types, masked tails. `qr-cp.png` = Control Panel QR.
- `capture/`: `rig.py` serves `site/` under the live address with a feed snapshot (`feed.json`, 26-Nov-2026) and a demo profile
  (no real profile or email touched); `film.py` (from the Mexican Airstrips kit) films frame by frame with pointer and spotlight;
  `scenes.py` = app beats 5, 7–14, 16 (never opens a recent fatal accident: the full-record shot is CEN27LA008, closed);
  `art_scenes.py` = beats 1–4, 6, 15, 17 and the end card. `mail.html` = inbox mock for beats 14 and 16.
- `cut/build.py`: joins the segments, mixes VO + "Acoustic Guitar 1" (Audionautix, CC BY 4.0) bed, -16 LUFS; writes
  `final/` captions (.srt and .en_US.srt for Facebook) and `youtube-description.txt`. The .mp4 itself is not committed.
