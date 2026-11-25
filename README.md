# ⛳ AR Minigolf (WebXR · AR.js-Marker · MediaPipe Hands · Cardboard)

Browserbasiertes AR-Minigolf in **TypeScript + Three.js + Vite**. Der Parcours
wird über **gedruckte Marker** im Raum verankert, die **Hand** ist der Putter.
Am Handy läuft das Spiel im **Cardboard-Splitscreen**.

## Modi

| Modus | Gerät | Verankerung | Hand |
|-------|-------|-------------|------|
| **Marker AR – Cardboard** | Handy in Cardboard-Brille | AR.js-Marker A–F | MediaPipe (gleiches Kamerabild) |
| **Marker AR** | PC-Webcam / Handy | AR.js-Marker A–F | MediaPipe (gleiches Kamerabild) |
| **Webcam AR** | PC / Handy | fest ~1 m vor der Kamera | MediaPipe |
| **Immersive AR** | WebXR-Headset | Hit-Test | WebXR Hand Input |

Im Marker-Modus kann am PC jederzeit mit **👓 Cardboard** auf Splitscreen
umgeschaltet werden – praktisch zum Entwickeln.

## Marker drucken

`public/markers/` (auch über den Startbildschirm erreichbar):

- **`AR-Minigolf_Marker_A4_16cm.pdf`** – 6 Seiten A4, je ein Marker mit 16 cm (Boden).
- **`AR-Minigolf_Marker_Tisch_8cm.pdf`** – alle 6 Marker mit 8 cm auf einer Seite (Tisch).

Mit **100 % / „Tatsächliche Größe“** drucken und das 10-cm-Kontrollmaß nachmessen.
Weicht die Größe ab, in der App unter **⚙ Einstellungen → Markergröße** den
gemessenen Wert (Außenkante schwarzer Rahmen) eintragen. Bei 8-cm-Markern wird der
ganze Parcours automatisch halb so groß.

| Marker | Rolle | Virtuelles Objekt |
|--------|-------|-------------------|
| **A** | Start / Tee | Ball liegt in der Markermitte, Ursprung des Parcours |
| **B** | Ziel | Loch mit Fahne, legt Länge + Richtung der Bahn fest |
| **C** | Hindernis 1 | Wand 32 cm (parallel zur Markierungslinie auf dem Blatt) |
| **D** | Hindernis 2 | runder Bumper |
| **E** | Hindernis 3 | lange Wand 50 cm |
| **F** | Hindernis 4 | Drehbalken (Windmühle) |

Die Hindernis-Marker sind optional und können **während des Spiels verschoben
oder gedreht** werden (nicht während der Ball rollt).

## Spielablauf (Marker-Modus)

1. Marker A und B mit mindestens 30 cm Abstand auslegen, C–F nach Belieben.
2. Modus wählen und **A und B gleichzeitig** ins Bild nehmen → der Parcours erscheint.
   Die Chips unten links zeigen, welche Marker gerade erkannt werden.
3. Hand ins Bild halten, sodass der Putter über dem Ball liegt („Jetzt schwingen!“).
4. **Ausholen und durchschwingen.** Der Schlag zählt, wenn der Putter den Ball
   (9 cm Radius) mit > 0,6 m/s überstreicht.
5. HUD: Status, `PAR · DISTANZ · SCORE`, Schläge, Kraftbalken. Nach dem
   Einlochen startet die Runde automatisch neu (oder **↺ Neu**; im Cardboard: Bildschirm antippen).

Ohne Internet kann MediaPipe sein Handmodell nicht laden – dann wird automatisch
**Maus/Finger** zum Putter (am PC auch erzwingbar mit `?input=mouse`).

## Cardboard

- Startet Vollbild, Querformat und hält den Bildschirm wach (wo der Browser es erlaubt;
  iOS Safari kennt kein Element-Vollbild → Seite zum Home-Bildschirm hinzufügen).
- Beide Augen zeigen dasselbe Kamerabild (die Handykamera ist mono) – so bleibt der
  virtuelle Parcours exakt auf den Markern.
- **Einstellungen → Cardboard**: Linsenverzerrung, Bildabstand zur Mitte und Zoom an
  die eigene Brille anpassen.
- Beenden über das ✕ oben in der Mitte.

## Setup

```bash
npm install
npm run dev
```

Vite startet mit **HTTPS** (selbst-signiert) und `--host`, damit Kamera und WebXR
auch auf dem Handy im gleichen WLAN funktionieren.

- **PC:** `https://localhost:5173` → *Marker AR*. Zertifikatswarnung akzeptieren.
- **Handy:** `https://<LAN-IP>:5173` (steht im Terminal) → *Marker AR – Cardboard*.

Testhilfen per URL: `?autostart=marker|cardboard|webcam`, `?debug=1`,
`?marker=8` (Markergröße in cm), `?input=mouse`.

```bash
npm run build     # tsc --noEmit + vite build
npm run preview
```

## Projektstruktur

```
public/
  arjs/camera_para.dat        Kamerakalibrierung für ARToolKit (640×480)
  markers/                    marker-A…F.patt (AR.js-Pattern), PNGs, Druck-PDFs
src/
  main.ts                     Start, Modus-Auswahl, Einstellungen, Toolbar
  config.ts                   Marker-Belegung, Einstellungen (localStorage)
  core/
    Game.ts                   Renderer, Loop, Zustandsmaschine, Schlaglogik, Modi
    HUD.ts                    DOM-Overlay (pro Auge dupliziert im Cardboard)
    types.ts                  HandTracker- und AnchorProvider-Schnittstellen
  render/
    ArView.ts                 Kamerahintergrund + AR-Projektion, Cardboard-Splitscreen,
                              Barrel-Vorverzerrung
  scene/
    Course.ts                 Parcours: Rasen, Banden, Loch, Fahne, Layouts
    Obstacles.ts              Wand / Bumper / Drehbalken inkl. Kollision (gedrehte Formen)
    Ball.ts                   Ballphysik mit Substeps (Reibung, Banden, Einlochen)
    Club.ts, Reticle.ts       Putter, Platzierungsring (WebXR)
  tracking/
    CameraFrameSource.ts      Gemeinsames 4:3-Kamerabild für AR.js und MediaPipe
    ArjsMarkerAnchor.ts       AR.js-Marker → Course-Pose, Multi-Marker-Verbund, Glättung
    MediaPipeHandTracker.ts   Hand-Landmark → Raycast auf Rasenebene
    PointerHandTracker.ts     Maus/Touch als Putter (Fallback / Entwicklung)
    WebXRHandTracker.ts       Natives WebXR Hand Input
    SwingDetector.ts          Geglättete Geschwindigkeit (120-ms-Fenster)
  types/arjs.d.ts             Typen für AR.js (threex)
```

## Technische Hinweise

- **Gleiches Kamerabild:** Jeder Videoframe wird einmal in ein 640×480-Canvas
  (zentrierter 4:3-Ausschnitt, passend zu `camera_para.dat`) kopiert; AR.js und
  MediaPipe lesen beide dieses Canvas. Der Hintergrund wird per WebGL mit derselben
  Projektion gerendert, daher liegt die Bahn exakt auf den Markern.
- **Multi-Marker-Verbund:** Sobald A und B gemeinsam gesehen wurden, ist die Lage
  jedes Markers relativ zum Parcours bekannt. Danach reicht *ein* sichtbarer Marker
  für die Pose; mehrere werden gemittelt, sonst bleibt die letzte gültige Pose.
- **Maßstab:** `camera_para.dat` ist eine generische Kalibrierung. Abstände können
  daher je nach Handy um ~10 % abweichen; die Überlagerung im Bild bleibt trotzdem exakt.
- **Marker-Design:** Die 4×4-Muster wurden so gewählt, dass sie untereinander und
  gegen Drehung möglichst unähnlich sind (max. Korrelation 0,24) – das vermeidet
  Verwechslungen. `tools/make_markers.py` erzeugt `.patt`, PNGs und PDFs neu
  (Format wie der AR.js-Marker-Trainer).
- **MediaPipe-Assets** kommen per CDN. Für Offline-Betrieb WASM + `hand_landmarker.task`
  lokal ablegen und die URLs in `MediaPipeHandTracker.ts` anpassen.

## Technologie

Three.js 0.169 · AR.js 3.4 (artoolkit5) · MediaPipe Tasks Vision 0.10 · Vite 5 · TypeScript (strict)
