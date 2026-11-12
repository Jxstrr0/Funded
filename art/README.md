# Art: backdrop scene

`build_scene.py` builds the whole trading-floor scene from Blender's factory startup and renders the two backdrops. Everything is procedural (no downloaded assets).

## Run

```
blender -b --factory-startup -P art/build_scene.py -- [--out DIR] [--samples N] [--preview] [--cams main,wide] [--variant NAME] [--tod am|mid|pm]
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
- `--tod am|mid|pm`: time of day for `tier1`, `tier2` and `tier3` (not `fired`), so the game can crossfade the desk from the opening bell to the close. `mid` is the default and writes the plain names; `am` and `pm` render CAM_main only and add `-am` / `-pm` (`desk-am.png`, `desk-tier2-pm.png`, `desk-tier3-am.png` ...). Only lights, the sky, the window glass and the city's materials change (`tod_env()` and `apply_tod()`); geometry, cameras, the hero screens and the exposure stay as they are.
  - `am` (about 9:30): cool, soft morning. Dimmer ceiling panels and key, a brighter pale blue-white window fill, a pale sky, more haze and fewer lit windows in the city, the desk lamp low.
  - `mid`: tier1 and tier2 are the original look. tier3 `mid` is a clear daytime sky with a high soft sun.
  - `pm` (about 16:00): warm late afternoon. Golden ceiling, key and rim light, a low warm sun through the window wall, a warm orange-pink sky, more lit windows and a stronger desk lamp. tier3 `pm` is the original dusk.

Needs Blender 4.2 LTS. It renders with Cycles on the CPU (EEVEE needs a GPU). A full render at 192 samples takes about 9 minutes for CAM_main and 12 for CAM_wide on 4 cores (tier1 both: about 22 minutes; tier2 8, tier3 3, fired 9). The `am` / `pm` renders take about as long as their `mid` desk (two at once on 4 cores roughly doubles each). A `--preview` takes under a minute.

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

## Pass desks, rain days and the intro move

These are flags on the same script. Each one keeps the camera and screen contract and runs the usual checks (rectangles, occlusion and prop clearance).

```
blender -b --factory-startup -P art/build_scene.py -- [--variant tier1|tier2|tier3] --funded
blender -b --factory-startup -P art/build_scene.py -- [--variant tier1|tier2|tier3] --weather rain
blender -b --factory-startup -P art/build_scene.py -- --dolly [--dolly-res 720] [--dolly-frames 60]
```

### The tier1 room opens onto the city (concept F)

- The tier1 room is used by `tier1`, `fired`, and their `--tod`, `--funded`, `--weather` and `--dolly` renders. It no longer has the pillar, the window soffit or the last row of background desks (y = 7.15), so the skyline shows above the back partition on both sides of the monitors and fills the back of `wide.jpg`.
- Its towers use `CITY_TOWERS` (one entry each for am, mid, pm and rain). Compared with the tier2 room, they have less haze, darker facades and more lit windows, so the city reads in the narrow side strips at every time of day and in rain.
- `--old-room` brings back the old closed-in back row.
- tier2 and tier3 are unchanged. A tier2 preview from before and after the change differs by at most 1/255.
- Re-rendered for this change: `desk.jpg`, `desk-am.jpg`, `desk-pm.jpg`, `desk-rain.jpg`, `desk-funded.jpg`, `desk-fired.jpg`, `wide.jpg` and `intro.mp4`. The prop overlays in `assets/props/tier1` are matte crops of the props only, so they didn't need re-rendering.

### `--funded`: the eval-passed desk

- Works with `--variant tier1|tier2|tier3`. It cannot be combined with `--tod`, because it has its own light, or with `--weather`.
- Writes `desk-funded.png`, `desk-tier2-funded.png` and `desk-tier3-funded.png` (CAM_main only).
- Uses the `--tod pm` light for that tier, so tier3 gets the dusk. The props are added in `variant_funded()` and are the same on every desk:
  - a cream tent card with FUNDED in gold foil, a foil border and rule, and EVALUATION PASSED;
  - an envelope on the desk mat, flap up, with a green wax seal pressed with a ▲;
  - a walnut wedge plaque with a brass plate that says only FUNDED;
  - a champagne bottle at the left edge of the frame.
- Every prop sits below the bottom screen (lower than 78.4% of the frame) or in the side strips (x < 11% or > 89%). `check_clear(..., below=78.4, strips=(11, 89))` checks this and also projects the text through its evaluated mesh. The highest prop outside the strips is the back of the tent card, at 79.4%.
- The words use DejaVu Sans Bold, falling back to Blender's built-in font. Space Grotesk is a variable font, and its overlapping contours fill badly as Blender text.
- Convert: `ffmpeg -y -i art/out/desk-funded.png -q:v 3 assets/desk-funded.jpg` (do the same for `-tier2-funded` and `-tier3-funded`).

### `--weather rain`: rain days

- Works with `--variant tier1|tier2|tier3` at the mid time of day only. The game turns off the am/pm layers on rain days.
- Writes `desk-rain.png`, `desk-tier2-rain.png` and `desk-tier3-rain.png` (CAM_main only).
- `weather_env()` sets an overcast grey sky and makes the towers fade into a grey mist. `apply_weather()` removes the sun and makes the window fill cool and flat. The office lights stay on and the desk lamp is a little brighter, as the warm accent.
- **tier3** (the glass is right behind the desk): `make_rain_glass(near=True)` adds three sizes of bead and a few wavy rivulets.
  - Real refraction made the drops look like dark specks, because the sky and towers are visible to camera rays only. Each drop is faked instead: a clear core lifted with a little sky-coloured light (brighter in its lower half, where a drop focuses the sky), a darker refracting rim, and a glossy coat on a domed bump that catches the ceiling lights.
  - Camera-only "rain curtain" planes outside add thin, slightly slanted falling streaks.
- **tier1 and tier2** (the windows are far away): the glass is misty with faint running streaks, plus rain curtains outside. Most of the change is in the light: greyer, duller ceiling, key and rim lights, and a dimmer window fill.
- Convert: `ffmpeg -y -i art/out/desk-rain.png -q:v 3 assets/desk-rain.jpg` (do the same for `-tier2-rain` and `-tier3-rain`).

### `--dolly`: the intro camera move

- Renders the plain tier1 desk at the mid time of day as PNG frames, `art/out/dolly/0001.png` to `0060.png` (git-ignored). That is 60 frames at 24 fps, so 2.5 s.
- **Frame 1** is CAM_wide exactly, with the chair in place, so it matches `wide.jpg`. **Frame 60** is CAM_main exactly, with the chair gone, so it matches `desk.jpg`. The script measures the screen rectangles and occlusion on both end frames.
- **The move:**
  - Position is gently eased: `DOLLY_EASE` = 0.6 blends linear motion with smoothstep.
  - Rotation is an ease-in-out quaternion slerp.
  - The lens goes from 30 to 35 mm on the position curve.
- **The chair:** the hero chair rolls back out of the cubicle and away to the right, turning from −14° to −58° (`CHAIR_PATH`, `CHAIR_TURN`, `CHAIR_END`). It is out of frame by about frame 31, and is hidden from frame 44 on, while it is behind the camera.
- **Rendering:**
  - Default size is 720x1280 (`--dolly-res 540` gives 540x960).
  - Seed is fixed, the denoiser is on, and persistent data keeps the BVH between frames.
  - Frames that already exist are skipped, so an interrupted run can resume. Delete `art/out/dolly/` to re-render everything.
- Encode:

  ```
  ffmpeg -y -framerate 24 -i art/out/dolly/%04d.png -c:v libx264 -preset veryslow -crf 22 \
         -pix_fmt yuv420p -movflags +faststart -an assets/intro.mp4
  ```

  The result is H.264, yuv420p, 720x1280, 24 fps, 60 frames (2.5 s), 466 KB, with no audio. Its first frame matches `wide.jpg` and its last matches `desk.jpg`: the mean absolute difference is about 2/255 after encoding and about 1/255 for the PNG frames.

### `--mouse`: the desk mouse layers (art/build_props.py)

```
python3 art/build_props.py --mouse [--tiers tier1,tier2,tier3] [--tods mid,am,pm] [--samples 192]
```

- For each tier and time of day, this runs `build_scene.py` with `--hook art/build_props.py --mouse`. It renders a crop of CAM_main around the hero mouse three times, like the edge props: with the mouse (A), without it (B), and as a matte (M).
- It writes `assets/mouse/<tier>-plate[-am|-pm].webp`: the desk with the mouse and its shadow removed. The plate is fully opaque with a hard edge: it matches the desk to about 1/255, and a soft edge would leave a faint seam where the game stacks the `-am` / `-pm` plates at partial opacity.
- It writes `assets/mouse/<tier>-mouse[-am|-pm].webp`: the mouse and its contact shadow, with straight alpha. The plate and the mouse share one box, so the mouse over the plate reproduces A.
- The mouse hangs off the right and bottom edges of the frame. The crop is rendered with a 160 px overscan: a copy of CAM_main with a larger sensor and resolution at the same pixel scale. So the layer has no cut edge when it slides left or up, and the box runs past 100%.
- The box leaves room for `MOUSE_TRAVEL` (±1.4% of frame width, ±0.8% of height) plus a 12 px spare margin on every edge that can come into frame. It is the same for every tod. The script prints it as `MOUSE LAYOUT` for `CLICKER.mouse.layout` and saves it in `art/out/mouse/layout-<tier>.json`. All three tiers come out the same: `{ l: 86.2, t: 86.72, w: 28.61, h: 17.55 }`.
- It then composites plate + mouse over each desk JPG with Pillow and prints the error at rest. The mean inside the box is about 1.9/255, and p99 is 8–10. It also writes `art/out/mouse/check-mouse.png`. The columns are: desk, at rest, the four corners of the travel, and |rest − desk| ×8.
- `--tods mid,am,pm,rain` also writes `-rain` layers for the `--weather rain` desks, but the game doesn't load them yet.
- Time: about 30–70 s per tier and tod at 192 samples (8 min for all nine).

### Render times (4 CPU cores)

| Render | Samples, size | Time |
| --- | --- | --- |
| `--funded` (tier1 / tier2 / tier3) | 192, 1080x1920 | 589 s / 619 s / 268 s (tier1 city re-render: 670 s) |
| `--weather rain` (tier1 / tier2 / tier3) | 192, 1080x1920 | 775 s / 391 s / 170 s (tier1 city re-render: 721 s) |
| tier1 city stills: plain (main + wide) / am / pm / fired | 192, 1080x1920 | 693 s + 929 s / 673 s / 654 s / 698 s |
| `--dolly` | 96, 720x1280, 60 frames | 114 min (85–130 s a frame) |

Two times are per tier. The tier1 city stills ran two at a time on 2 threads each.

## Edge props (`build_props.py`, `props.py`)

Every edge card has a prop that also appears on the desk once the player owns it: rewind = cassette, hotHand = chili, stopDiscipline = STOP sticky note, tapeReader = coil of ticker tape, riskFriend = lilac donut on a napkin, shortWeek = flip calendar with a date circled, coffee = mug with steam, whisper = folded "psst" note, rainmaker = brass desk bell, thetaShield = hourglass. The models are in `props.py` (one `build_<id>()` each, fully procedural).

    python3 art/build_props.py [--tiers tier1,tier2,tier3] [--ids coffee,rewind] [--samples 160] [--cards] [--card-samples 128] [--no-desk] [--check]

- Desk overlays: for each tier it runs `build_scene.py --variant <tier> --hook art/build_props.py`. The hook puts every prop in its fixed slot (`SLOTS` in `build_props.py`) and checks that each vertex is either below the bottom screen (78.4% of the frame) or in a side strip (x < 11% or > 89%). It then renders each prop in a small crop of CAM_main three times: with the prop, without it, and as a matte with every other object a holdout. From these it writes `assets/props/<tier>/<id>.webp` with straight alpha and a soft contact shadow, so the prop placed over `desk-<tier>.jpg` reproduces the full render, including the keyboard hiding its lower edge. Positions go to `art/out/props/layout-<tier>.json` as % of 1080x1920 (left, top, width, height); copy them into `EDGE_PROPS.layout` in `js/config.js`. Add `--slots-only` after `--hook` to check slots without rendering.
- The desk is the same in every tier, so the slots are identical. Only the trimmed crops differ slightly, because of shadows and light.
- Props never overlap each other, so any combination can be shown at once. To move one, edit its slot, run with `--ids <id> --check`, and look at `art/out/props/check-<tier>.png` (needs Pillow).
- `--cards`: 480x480 close-ups on a transparent background with a shadow-catcher floor, a warm key, a lilac and a cool rim light, AgX. Writes `assets/cards/<id>.webp`. The pose and camera height for each prop are in `CARD`.
- Times on 4 cores at 160 samples: about 9 minutes each for tier1 and tier2, 5 for tier3, 9 for the cards. WebP is made with ffmpeg (libwebp, yuva420p, quality 85).
