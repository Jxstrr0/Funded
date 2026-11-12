# Art: backdrop scene

`build_scene.py` builds the whole trading-floor scene from Blender's factory startup and renders the two backdrops. Everything is procedural (no downloaded assets).

## Run

```
blender -b --factory-startup -P art/build_scene.py -- [--out DIR] [--samples N] [--preview] [--cams main,wide] [--variant NAME]
```

- `--out DIR`: output folder (default `art/out`). Writes `desk.png` (CAM_main) and `wide.png` (CAM_wide).
- `--samples N`: Cycles samples (default 192; 16 with `--preview`). The OpenImageDenoise denoiser is always on.
- `--preview`: half resolution (540x960) for quick checks.
- `--cams`: render only some cameras, e.g. `--cams wide`.
- `--variant NAME`: which career desk to build for the gameplay view. `tier1` (default) is the original scene and writes `desk.png` and `wide.png`. The others render only CAM_main by default and add the variant to the file name:
  - `tier2` -> `desk-tier2.png`: mid-floor. Wing monitors at the frame edges with dim charts, the tall back partition and the pillar gone, desks right behind, a ticker board hanging over the floor, a walnut desk.
  - `tier3` -> `desk-tier3.png`: window seat. Floor-to-ceiling glass just behind the desk, a dusk sky and skyline (with a few near towers tall enough to show above the monitors), the wing monitors, a dark stone desk.
  - `fired` -> `desk-fired.png`: the tier1 desk cleared out, with a cardboard box of belongings (folders, a mug, a plant, a photo) in the foreground and colder, dimmer light.

  Convert them like the others: `ffmpeg -y -i art/out/desk-tier2.png -q:v 3 assets/desk-tier2.jpg` (and the same for `tier3` and `fired`).

Needs Blender 4.2 LTS. It renders with Cycles on the CPU (EEVEE needs a GPU). A full render at 192 samples takes about 9 minutes for CAM_main and 12 for CAM_wide on 4 cores (tier1 both: about 22 minutes; tier2 8, tier3 3, fired 9).

The script prints the measured screen rectangles for both cameras and checks them against the contract below, then ray-casts each hero screen to check that nothing hides it. For a variant it also projects every added object and checks that nothing in front of the screens lands inside their rectangles; for `fired`, every part of the box must sit below the bottom screen (lower than 78.4% of the frame).

## Camera and screen contract (keep fixed)

The game draws its UI over the two hero screens by percentage of frame, so do not change these:

- Output: 1080x1920 (9:16 portrait).
- `CAM_main`: 35mm lens, sensor 36mm, sensor fit AUTO, at (0, -1.02, 1.17), rotation (90°, 0, 0), no shift.
- `CAM_wide`: 30mm lens, sensor 36mm, AUTO, at (0, -2.85, 1.70), rotation (1.466, 0, -0.025) rad, XYZ Euler.
- `HERO_screen_top`: 0.54 x 0.32 m plane facing -Y, centred at (0, 0.18, 1.36).
- `HERO_screen_bottom`: 0.54 x 0.32 m plane facing -Y, centred at (0, 0.18, 0.98).
- Screen material: flat emission #0B1730, strength 1, Standard view transform. No content, reflection or gradient.

Expected rectangles (% of frame, left / right / top / bottom, measured from the top-left):

| Camera | Top screen | Bottom screen |
| --- | --- | --- |
| CAM_main | 11.0 / 89.0 / 21.6 / 47.6 | 11.0 / 89.0 / 52.4 / 78.4 |
| CAM_wide | 33.0 / 59.4 / 46.2 / 54.9 | 33.2 / 59.3 / 56.4 / 65.0 |

Also keep the hero monitors unobstructed in CAM_wide (the intro zooms into them). The hero chair is shown only in the wide shot; in the gameplay view the player is sitting in it.

## What's in the hero desk

All built in `build_hero_desk()` and shared by every variant:

- Monitors (`monitor()`): thin 8 mm bezels with a chamfered front frame, a 16 mm logo-free chin, a tapered back shell and a VESA boss. A tiny green power LED sits on the bottom monitor's chin. The background and wing monitors use the same cached meshes.
- Stand (`build_monitor_stand()`): a clamp on the back edge of the desk, a round pole with a cable, and two silver gas-spring arms. The top arm leaves its collar at eye level, so it shows in the gap between the screens.
- Keyboard (`build_keyboard()`): a wedge case and individually bevelled keycaps on a staggered tenkeyless layout (lilac Esc and Enter, lighter modifiers), with a faint lilac backlight between the keys. Mouse (`build_mouse()`) with a rounded shell and scroll wheel, on a navy felt desk mat with a stitched edge.
- Desk: a pale oak laminate (`make_wood()`, grain, pores and roughness variation) with a dark edge band; tier2 swaps in walnut and tier3 dark engineered stone (`make_stone()`).
- Partitions: woven fabric (bump and tone) with rounded satin-aluminium caps, posts and kick plates (`make_alu()`).
- Light: ceiling panels and window fill, a soft key area light over the sitter's left shoulder, a cool rim light from behind the partition, and the warm desk lamp.

Bevelled boxes are smooth-shaded with hard edges kept by angle (`smooth_bm()`), so every bevel catches a highlight.

## Free to change

Materials, lighting, props, background desks and the city (all in `build_scene.py`, grouped by function: `build_room`, `build_hero_desk`, `build_bg_desks`, `build_city`, `make_tower`, `make_trading_screen`). The variants are `variant_tier2`, `variant_tier3` and `variant_fired`. The background monitors use only the game's monitor palette (green #2FBF71, red #E5484D, lilac #B48CE8).
