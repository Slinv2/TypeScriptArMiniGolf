# ⛳ AR Mini Golf (WebXR · AR.js markers · MediaPipe Hands · Cardboard)

Browser-based AR mini golf in **TypeScript + Three.js + Vite**. The course is
anchored in the room with **printed markers**, and your **hand** is the putter.
On a phone, the game runs as a **Cardboard split screen**.

## Modes

| Mode | Device | Anchor | Hand |
|------|--------|--------|------|
| **Marker AR – Cardboard** | Phone in a Cardboard viewer | AR.js markers A–F | MediaPipe (same camera image) |
| **Marker AR** | PC webcam / phone | AR.js markers A–F | MediaPipe (same camera image) |
| **Webcam AR** | PC / phone | fixed ~1 m in front of the camera | MediaPipe |
| **Immersive AR** | WebXR headset | hit test | WebXR Hand Input |

In Marker AR you can switch to split screen at any time with **👓 Cardboard** –
handy for development on the PC.

## Printing the markers

`public/markers/` (also linked on the start screen):

- **`AR-MiniGolf_Markers_A4_16cm.pdf`** – 6 A4 pages, one 16 cm marker each (floor).
- **`AR-MiniGolf_Markers_Table_7cm.pdf`** – all 6 markers at 7 cm on one page (table).
  Set **⚙ Settings → Marker size** to 7 cm.

Print at 100 % and check the 10 cm reference length. If the printed size differs,
enter the measured size (outer edge of the black frame) under **Settings → Marker size**.

| Marker | Role | Virtual object |
|--------|------|----------------|
| **A** | Start / tee | Ball starts in the marker center, origin of the course |
| **B** | Goal | Hole with flag, defines length and direction of the lane |
| **C** | Obstacle 1 | Wall, 32 cm (parallel to the line printed on the page) |
| **D** | Obstacle 2 | Round bumper |
| **E** | Obstacle 3 | Long wall, 50 cm |
| **F** | Obstacle 4 | Windmill (rotating bar) |

Obstacle markers are optional and can be **moved or rotated during the game**
(not while the ball is rolling).

## How to play (Marker AR)

1. Place markers A and B at least 30 cm apart, C–F wherever you like.
2. Choose a mode and get **A and B into view at the same time** → the course appears.
   The chips in the bottom left show which markers are currently detected.
3. Hold your hand in view so the putter is over the ball ("Swing now!").
4. **Swing back and through.** A stroke counts when the putter passes the ball
   (9 cm radius) faster than 0.6 m/s.
5. HUD: status, `PAR · DISTANCE · SCORE`, strokes, power bar. After holing out the
   round restarts automatically (or **↺ Restart**; in Cardboard: tap the screen).

Without internet MediaPipe cannot load its hand model – the **mouse/finger** then
becomes the putter automatically (force it on the PC with `?input=mouse`).

## Cardboard

- Enters fullscreen, landscape and keeps the screen awake (where the browser allows it;
  iOS Safari has no element fullscreen → add the page to the home screen).
- Both eyes show the same camera image (the phone camera is mono), so the virtual
  course stays exactly on the markers.
- **Settings → Cardboard**: adjust lens distortion, image offset and zoom to your viewer.
- Exit with the ✕ at the top center.

## Setup

```bash
npm install
npm run dev
```

Vite runs with **HTTPS** (self-signed) and `--host`, so camera and WebXR also work
on a phone in the same Wi-Fi.

- **PC:** `https://localhost:5173` → *Marker AR*. Accept the certificate warning.
- **Phone:** `https://<LAN-IP>:5173` (shown in the terminal) → *Marker AR – Cardboard*.

URL test helpers: `?autostart=marker|cardboard|webcam`, `?debug=1`,
`?marker=7` (marker size in cm), `?input=mouse`.

```bash
npm run build     # tsc --noEmit + vite build
npm run preview
```

## Project structure

```
public/
  arjs/camera_para.dat        Camera calibration for ARToolKit (640×480)
  markers/                    marker-A…F.patt (AR.js patterns), PNGs, print PDFs
src/
  main.ts                     Start screen, mode selection, settings, toolbar
  config.ts                   Marker assignment, settings (localStorage)
  core/
    Game.ts                   Renderer, loop, state machine, stroke logic, modes
    HUD.ts                    DOM overlay (duplicated per eye in Cardboard)
    types.ts                  HandTracker and AnchorProvider interfaces
  render/
    ArView.ts                 Camera background + AR projection, Cardboard split screen,
                              barrel pre-distortion
  scene/
    Course.ts                 Course: turf, rails, hole, flag, layouts
    Obstacles.ts              Wall / bumper / windmill incl. collision (rotated shapes)
    Ball.ts                   Ball physics with substeps (friction, rails, holing out)
    Club.ts, Reticle.ts       Putter, placement reticle (WebXR)
  tracking/
    CameraFrameSource.ts      Shared 4:3 camera image for AR.js and MediaPipe
    ArjsMarkerAnchor.ts       AR.js markers → course pose, multi-marker fusion, smoothing
    MediaPipeHandTracker.ts   Hand landmark → raycast onto the turf plane
    PointerHandTracker.ts     Mouse/touch as putter (fallback / development)
    WebXRHandTracker.ts       Native WebXR Hand Input
    SwingDetector.ts          Smoothed speed (120 ms window)
  types/arjs.d.ts             Types for AR.js (threex)
tools/
  make_markers.py             Regenerates .patt files, PNGs and PDFs
```

## Technical notes

- **Same camera image:** every video frame is copied once into a 640×480 canvas
  (centered 4:3 crop, matching `camera_para.dat`); AR.js and MediaPipe both read this
  canvas. The background is rendered via WebGL with the same projection, so the
  course sits exactly on the markers.
- **Multi-marker fusion:** once A and B have been seen together, the pose of every
  marker relative to the course is known. After that a single visible marker is enough;
  several are averaged, otherwise the last valid pose is kept.
- **Scale:** `camera_para.dat` is a generic calibration, so distances may be off by
  ~10 % depending on the phone; the overlay in the image stays exact.
- **Marker design:** the 4×4 patterns are chosen to be as dissimilar as possible to
  each other and to their own rotations (max. correlation 0.24) to avoid mix-ups.
- **MediaPipe assets** are loaded from a CDN. For offline use, store the WASM files and
  `hand_landmarker.task` locally and adjust the URLs in `MediaPipeHandTracker.ts`.

## Technology

Three.js 0.169 · AR.js 3.4 (artoolkit5) · MediaPipe Tasks Vision 0.10 · Vite 5 · TypeScript (strict)
