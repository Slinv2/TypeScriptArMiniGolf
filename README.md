# ⛳ AR Minigolf (WebXR + MediaPipe Hands)

Ein WebXR-basiertes AR-Minigolfspiel in **TypeScript + Three.js + Vite**.
Du siehst deine reale Umgebung, deine Hand wird beim Ausholen und Schlagen
getrackt, und der Ball muss ins Loch mit Fahne – vorbei an Hindernissen.

## Zwei Modi

Das Spiel bietet beim Start eine Auswahl:

| Modus | Gerät | Handtracking |
|-------|-------|--------------|
| **Immersive AR** | AR-Brille / Headset (z. B. Meta Quest) | Natives **WebXR Hand Input** |
| **Webcam AR** | Handy / Laptop mit Kamera | **Google MediaPipe Hands** |

- **Immersive AR** platziert den Parcours per Hit-Test auf einer realen Fläche
  (Gerät bewegen, tippen). Die Hand wird über die Fingergelenke des Headsets
  getrackt.
- **Webcam AR** zeigt das Kamerabild als Hintergrund mit transparentem
  3D-Overlay. MediaPipe erkennt deine Hand und projiziert sie als Putter auf
  den Rasen. Der Parcours wird automatisch ~0,7 m vor dir platziert.

> Der Webcam-Modus funktioniert direkt am Laptop – ideal zum Testen ohne Brille.

## Setup

```bash
npm install
npm run dev
```

Vite startet mit **HTTPS** (selbst-signiertes Zertifikat) und `--host`, damit
WebXR und der Kamerazugriff auch auf echten Geräten im lokalen Netz
funktionieren (beides erfordert einen sicheren Kontext).

- **Am Laptop:** Öffne die angezeigte `https://localhost:5173`-URL und wähle
  *Webcam AR*. Beim ersten Mal die Zertifikatswarnung akzeptieren.
- **Auf dem Handy / Headset:** Öffne die `https://<deine-LAN-IP>:5173`-URL
  (wird im Terminal angezeigt), im selben WLAN. Zertifikat akzeptieren.

### Build

```bash
npm run build     # tsc --noEmit + vite build
npm run preview
```

## Steuerung / Spielablauf

1. Modus wählen.
2. (Nur Immersive AR) Fläche anvisieren bis das grüne Reticle erscheint und
   tippen, um den Parcours zu platzieren.
3. Hand über den weißen Ball halten – ein blauer Putter-Kopf erscheint.
4. **Ausholen und durchschwingen.** Trifft der Putter den Ball mit genug
   Geschwindigkeit, bekommt der Ball einen Impuls in Schwungrichtung.
5. Ball ins Loch mit Fahne spielen – vorbei an den braunen Hindernissen.
6. Der Kraftbalken unten zeigt deine aktuelle Handgeschwindigkeit,
   oben rechts die Anzahl der Schläge.

## Projektstruktur

```
index.html                  Canvas, HUD, Modus-Auswahl, Video-Element
src/
  main.ts                   Einstiegspunkt, Modus-Auswahl
  style.css                 Layout, HUD, Kamera-Overlay
  core/
    Game.ts                 Orchestrierung: Renderer, Loop, Physik, Swing
    HUD.ts                  DOM-Overlay (Status, Schläge, Kraft)
    types.ts                Gemeinsame Typen & Tracker-Interface
  scene/
    Course.ts               Parcours: Rasen, Loch, Fahne, Hindernisse, Ziel
    Ball.ts                 Ball-Physik (Reibung, Kollisionen, Einlochen)
    Club.ts                 Putter-Visualisierung
    Reticle.ts              Platzierungs-Ring für Hit-Test (XR)
  tracking/
    SwingDetector.ts        Geschwindigkeitsschätzung über Zeitfenster
    MediaPipeHandTracker.ts Webcam-Handtracking (MediaPipe Hands)
    WebXRHandTracker.ts     Natives WebXR Hand Input
```

## Technische Hinweise

- **MediaPipe-Assets** werden per CDN geladen (WASM-Runtime + `hand_landmarker.task`).
  Für Offline-Nutzung die Dateien lokal ablegen und die URLs in
  `src/tracking/MediaPipeHandTracker.ts` anpassen.
- **Warum zwei Tracking-Backends?** MediaPipe braucht exklusiven Rohzugriff auf
  die Kamera (`getUserMedia`) – das kollidiert mit einer immersiven
  WebXR-Session, in der der Browser die Kamera kontrolliert. AR-Brillen liefern
  Handtracking dagegen nativ über WebXR. Deshalb: natives Hand Input im
  Immersive-Modus, MediaPipe im Webcam-Modus.
- Für Immersive AR ist ein **WebXR-fähiges Gerät** mit `immersive-ar`- und
  `hand-tracking`-Unterstützung nötig. Ist das nicht verfügbar, ist der Button
  deaktiviert und du nutzt den Webcam-Modus.

## Technologie

- [Three.js](https://threejs.org/) – 3D-Rendering & WebXR
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) – Hand Landmarks
- [Vite](https://vitejs.dev/) – Dev-Server & Build
- TypeScript (strict)
