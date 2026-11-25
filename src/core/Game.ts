import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { Course } from '../scene/Course';
import { Ball } from '../scene/Ball';
import { Club } from '../scene/Club';
import { Reticle } from '../scene/Reticle';
import { HUD, type MarkerChipState } from './HUD';
import { SwingDetector } from '../tracking/SwingDetector';
import { MediaPipeHandTracker } from '../tracking/MediaPipeHandTracker';
import { WebXRHandTracker } from '../tracking/WebXRHandTracker';
import { CameraFrameSource } from '../tracking/CameraFrameSource';
import { ArjsMarkerAnchor } from '../tracking/ArjsMarkerAnchor';
import { ArView } from '../render/ArView';
import { PointerHandTracker } from '../tracking/PointerHandTracker';
import { MARKERS, settings, worldScale, type MarkerId } from '../config';
import type { AnchorState, GamePhase, HandFrame, HandTracker } from './types';

type Mode = 'xr' | 'webcam' | 'marker';

const HIT_RADIUS = 0.09; // Distanz Putterkopf<->Ball für Kontakt (Spiel-m)
const READY_RADIUS = 0.2; // ab hier "Jetzt schwingen!" anzeigen
const MIN_SWING = 0.6; // Mindest-Handgeschwindigkeit zum Auslösen (Spiel-m/s)
const SPEED_TRANSFER = 0.6; // Anteil der Handgeschwindigkeit, der auf den Ball übergeht
const MIN_BALL_SPEED = 1.0;
const MAX_BALL_SPEED = 6.0;
const MAX_POWER_SPEED = 4.0; // für die HUD-Anzeige
const STALE_WARNING_S = 1.5; // Marker so lange nicht gesehen → Hinweis
const RESTART_DELAY_MS = 2800;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly hud = new HUD();

  private readonly course = new Course();
  private readonly ball: Ball;
  private readonly club: Club;
  private readonly reticle = new Reticle();
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;

  private readonly swing = new SwingDetector();
  private tracker: HandTracker | null = null;

  private mode: Mode = 'webcam';
  private phase: GamePhase = 'placing';
  private strokes = 0;
  private placed = false;
  private restartTimer: number | null = null;
  private par = 2;
  private totalScore = 0;
  private holesPlayed = 0;
  private gameStatus = '';
  private warning: string | null = null;

  private hitTestSource: XRHitTestSource | null = null;
  private hitTestRequested = false;

  // Marker-Modus
  private frameSource: CameraFrameSource | null = null;
  private anchor: ArjsMarkerAnchor | null = null;
  private arView: ArView | null = null;
  private freshCameraFrame = false;
  private handTrackingError: string | null = null;
  private handTrackingErrorUntil = 0;

  // Debug / FPS
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private detections = 0;
  private detectRate = 0;

  // Wiederverwendbare temporäre Objekte (kein GC-Druck im Loop)
  private readonly tmpLocal = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly groundPlaneWorld = new THREE.Plane();
  private readonly prevPutter = new THREE.Vector3();
  private hasPrevPutter = false;

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
    this.camera.position.set(0, 1.6, 0);

    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x3a5030, 0.9);
    this.keyLight = new THREE.DirectionalLight(0xfff2d8, 1.4);
    this.setupLights();
    this.scene.add(this.course.group);
    this.scene.add(this.reticle.mesh);

    this.ball = new Ball(this.course);
    this.club = new Club(this.course);

    // Course ist bis zur Platzierung unsichtbar
    this.course.group.visible = false;

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLights(): void {
    this.scene.add(this.hemi);

    // Warmes Hauptlicht mit weichem Schatten. Licht + Ziel hängen am Parcours,
    // damit die Schatten überall passen (auch wenn der Parcours an Markern hängt).
    const key = this.keyLight;
    key.position.set(1.2, 3, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    this.course.group.add(key, key.target);
    this.fitShadowCamera(1.5);

    // Kühles Fülllicht von der anderen Seite
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.4);
    fill.position.set(-1.5, 1.8, -1);
    this.scene.add(fill);
  }

  private fitShadowCamera(radius: number): void {
    const cam = this.keyLight.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.updateProjectionMatrix();
  }

  // ---------- Modus-Start ----------

  async startImmersive(): Promise<void> {
    this.mode = 'xr';
    this.hud.show();
    this.setGameStatus('Move your device and tap to place the course.');

    this.renderer.xr.enabled = true;
    const arButton = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['hand-tracking', 'local-floor']
    });
    arButton.classList.add('ar-button');
    document.body.appendChild(arButton);

    const xrTracker = new WebXRHandTracker(this.renderer);
    this.tracker = xrTracker;

    this.renderer.xr.addEventListener('sessionstart', async () => {
      await xrTracker.init();
      const session = this.renderer.xr.getSession();
      session?.addEventListener('select', () => this.onSelect());
    });

    this.renderer.setAnimationLoop((_, frame) => this.loop(frame ?? null));
  }

  async startWebcam(): Promise<void> {
    this.mode = 'webcam';
    this.hud.show();
    this.setGameStatus('Starting camera…');

    const video = document.getElementById('camera') as HTMLVideoElement;
    video.classList.add('backdrop');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    video.srcObject = stream;
    await video.play();

    const mpTracker = new MediaPipeHandTracker(video, this.camera, () => this.groundPlaneWorld, {
      mirrorX: true,
      handPoint: 'wrist'
    });
    this.setGameStatus('Loading hand model…');
    try {
      await mpTracker.init();
      this.tracker = mpTracker;
    } catch (e) {
      console.error(e);
      const pointer = new PointerHandTracker(this.renderer.domElement, this.camera, () => this.groundPlaneWorld, () => false);
      await pointer.init();
      this.tracker = pointer;
      this.handTrackingError = 'Hand tracking unavailable (MediaPipe needs internet) – mouse/finger is now the putter.';
      this.handTrackingErrorUntil = performance.now() + 8000;
    }

    // Im Webcam-Modus bewegt sich die Kamera nicht (kein Head-Tracking).
    this.camera.position.set(0, 1.3, 0);
    this.camera.quaternion.identity();
    this.placeCourseInFront(1.0);
    this.camera.lookAt(this.course.group.position.x, 0.1, this.course.group.position.z);
    this.camera.updateMatrixWorld();

    this.setGameStatus('Swing and putt the ball into the hole! ⛳');
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.loop(null));
  }

  /**
   * Marker-AR (AR.js): Parcours über gedruckte Marker A–F, Hand über MediaPipe
   * auf demselben Kamerabild. Optional direkt im Cardboard-Splitscreen.
   */
  async startMarker(cardboard: boolean): Promise<void> {
    this.mode = 'marker';
    this.hud.show();
    document.body.classList.add('marker-mode');
    this.setGameStatus('Starting camera…');

    const video = document.getElementById('camera') as HTMLVideoElement;
    video.classList.add('source-only');
    const source = new CameraFrameSource(video);
    try {
      await source.start();
    } catch (e) {
      this.setGameStatus(`Camera not available: ${(e as Error)?.message ?? e}`);
      return;
    }
    this.frameSource = source;

    this.setGameStatus('Loading marker tracking…');
    this.course.useMarkerLayout();
    this.course.group.matrixAutoUpdate = false;
    const anchor = new ArjsMarkerAnchor(source);
    try {
      await anchor.init();
    } catch (e) {
      console.error(e);
      this.setGameStatus('AR.js could not be loaded (see console).');
      return;
    }
    this.anchor = anchor;
    this.arView = new ArView(this.renderer, this.scene, source, anchor.projection);

    const mirror = settings.mirror === 'on' || (settings.mirror === 'auto' && source.facingUser);
    document.body.classList.toggle('mirrored', mirror);
    this.setCardboard(cardboard);

    // Handtracking parallel laden – das Spiel läuft schon, Marker werden bereits erkannt.
    const mpTracker = new MediaPipeHandTracker(source.canvas, this.arView.arCamera, () => this.groundPlaneWorld, {
      mirrorX: false,
      handPoint: settings.handPoint,
      hasNewFrame: () => {
        const fresh = this.freshCameraFrame;
        this.freshCameraFrame = false;
        return fresh;
      }
    });
    const usePointer = () => {
      const view = this.arView!;
      const pointer = new PointerHandTracker(this.renderer.domElement, view.renderCamera, () => this.groundPlaneWorld, () =>
        document.body.classList.contains('mirrored')
      );
      void pointer.init();
      this.tracker = pointer;
    };
    if (new URLSearchParams(location.search).get('input') === 'mouse') {
      usePointer();
    } else {
      mpTracker
        .init()
        .then(() => {
          this.tracker = mpTracker;
        })
        .catch((e) => {
          console.error(e);
          this.handTrackingError = 'Hand tracking unavailable (MediaPipe needs internet) \u2013 mouse/finger is now the putter.';
          this.handTrackingErrorUntil = performance.now() + 8000;
          usePointer();
        });
    }

    this.setGameStatus('Show marker A (start) and B (goal) at the same time.');
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.loop(null));
  }

  get isMarkerMode(): boolean {
    return this.mode === 'marker';
  }

  get isCardboard(): boolean {
    return this.arView?.isStereo ?? false;
  }

  /** Cardboard-Splitscreen an/aus. Sollte aus einem Klick-Handler aufgerufen werden (Vollbild). */
  setCardboard(on: boolean): void {
    if (!this.arView) return;
    this.arView.setStereo(on);
    this.hud.setStereo(on);
    document.body.classList.toggle('cardboard', on);
    if (on) {
      document.body.classList.remove('mirrored');
      void enterImmersiveDisplay();
    } else {
      const mirror = settings.mirror === 'on' || (settings.mirror === 'auto' && (this.frameSource?.facingUser ?? false));
      document.body.classList.toggle('mirrored', mirror);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, on ? 1.5 : 2));
    this.onResize();
    this.refreshStats();
  }

  /** Runde neu starten (Button / Tippen im Cardboard). */
  restart(): void {
    if (!this.placed) return;
    this.restartHole();
  }

  // ---------- Platzierung ----------

  private placeCourseInFront(distance: number): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();
    const origin = this.camera.position.clone().add(forward.multiplyScalar(distance));
    origin.y = 0;

    this.course.group.position.copy(origin);
    const angle = Math.atan2(-forward.x, -forward.z); // Tee zeigt zum Spieler
    this.course.group.rotation.set(0, angle, 0);
    this.course.group.visible = true;
    this.course.group.updateMatrixWorld(true);

    this.updateGroundPlaneWorld();
    this.onCoursePlaced();
  }

  private onSelect(): void {
    if (this.mode !== 'xr') return;
    if (!this.reticle.visible || this.placed) return;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.reticle.mesh.matrix.decompose(pos, quat, scale);

    this.course.group.position.copy(pos);
    const toCam = this.camera.position.clone().sub(pos);
    toCam.y = 0;
    const angle = Math.atan2(toCam.x, toCam.z);
    this.course.group.rotation.set(0, angle, 0);
    this.course.group.visible = true;
    this.course.group.updateMatrixWorld(true);

    this.updateGroundPlaneWorld();
    this.reticle.hide();
    this.onCoursePlaced();
  }

  private onCoursePlaced(): void {
    this.ball.resetToTee();
    this.placed = true;
    this.phase = 'ready';
    this.strokes = 0;
    this.hud.setStrokes(0);
    this.updatePar();
    this.setGameStatus('Hold your hand over the ball and swing! ⛳');
  }

  private updatePar(): void {
    this.par = 2 + Math.floor(this.course.length / 1.5);
    this.refreshStats();
  }

  private updateGroundPlaneWorld(): void {
    // Course-Boden (lokal y=0) in Weltkoordinaten als Ebene ausdrücken
    const m = this.course.group.matrixWorld;
    const normal = this.tmpVec.setFromMatrixColumn(m, 1).normalize();
    const point = new THREE.Vector3().setFromMatrixPosition(m);
    this.groundPlaneWorld.setFromNormalAndCoplanarPoint(normal, point);
  }

  // ---------- Marker-Anker ----------

  /** @returns Warnhinweis für das HUD oder null. */
  private applyAnchor(state: AnchorState): string | null {
    const group = this.course.group;
    if (state.ready) {
      group.matrix.copy(state.courseMatrix);
      group.matrixWorldNeedsUpdate = true;
      group.updateMatrixWorld(true);
      group.visible = true;
      this.course.updateFromMarkers(state.holeLocal, state.obstacles);
      this.updateGroundPlaneWorld();

      // Hemisphärenlicht entlang der Bodennormalen ausrichten
      this.hemi.position.copy(this.groundPlaneWorld.normal);
      const b = this.course.bounds;
      this.keyLight.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
      this.keyLight.position.copy(this.keyLight.target.position).add(this.tmpVec.set(1.2, 3, 1.5));
      this.fitShadowCamera(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.6 * worldScale() + 0.2);

      if (!this.placed) this.onCoursePlaced();
      else if (this.phase === 'ready') this.updatePar();
    }

    // Marker-Chips im HUD
    const chips = {} as Record<MarkerId, MarkerChipState>;
    const known = new Set(state.obstacles.filter((o) => o.known).map((o) => o.id));
    if (state.ready) {
      known.add('A');
      known.add('B');
    }
    for (const m of MARKERS) chips[m.id] = state.visible[m.id] ? 'visible' : known.has(m.id) ? 'known' : 'unseen';
    this.hud.setMarkers(chips);

    // Hinweise
    if (!state.ready) {
      const a = state.visible.A;
      const b = state.visible.B;
      this.setGameStatus(
        a && b
          ? 'Start and goal are too close together (min. 30 cm).'
          : a
            ? 'Marker A found – now bring marker B (goal) into view!'
            : b
              ? 'Marker B found – now bring marker A (start) into view!'
              : 'Show marker A (start) and B (goal) at the same time.'
      );
    }
    return state.ready && state.staleSeconds > STALE_WARNING_S ? 'No marker in view – look at the course.' : null;
  }

  // ---------- Haupt-Loop ----------

  private loop(frame: XRFrame | null): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.trackFps(dt);

    if (this.mode === 'xr' && frame) {
      this.updateHitTest(frame);
    }

    let warning: string | null = null;
    if (this.mode === 'marker' && this.frameSource && this.anchor) {
      if (this.frameSource.grab()) {
        this.anchor.processFrame();
        this.freshCameraFrame = true;
        this.detections++;
      }
      warning = this.applyAnchor(this.anchor.update(this.phase === 'rolling' || this.phase === 'sunk'));
    }

    this.course.update(elapsed);

    if (this.placed && this.tracker) {
      const hand = this.tracker.update(frame);
      this.handleHand(hand);
    }
    if (this.handTrackingError && performance.now() < this.handTrackingErrorUntil) {
      warning ??= this.handTrackingError;
    }
    this.setWarning(warning);

    if (this.phase === 'rolling' || this.phase === 'sunk') {
      const finished = this.ball.update(dt);
      if (this.ball.isSunk && this.phase !== 'sunk') {
        this.phase = 'sunk';
        this.onHoled();
      }
      if (this.phase === 'rolling' && !this.ball.isMoving && !this.ball.isSunk) {
        this.phase = 'ready';
        this.setGameStatus('Ready for the next stroke.');
      }
      if (finished && this.restartTimer === null) {
        this.restartTimer = window.setTimeout(() => this.restartHole(), RESTART_DELAY_MS);
      }
    }

    if (this.placed) this.refreshStats();
    if (settings.debug) this.updateDebug();

    if (this.arView) this.arView.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private onHoled(): void {
    const diff = this.strokes - this.par;
    this.totalScore += diff;
    this.holesPlayed += 1;
    const names: Record<string, string> = { '-3': 'Albatros', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double Bogey' };
    const label = this.strokes === 1 ? 'Hole-in-One!' : names[String(diff)] ?? (diff > 0 ? `+${diff}` : `${diff}`);
    this.setGameStatus(`Holed in ${this.strokes} ${this.strokes === 1 ? 'stroke' : 'strokes'} – ${label} 🎉`);
  }

  private restartHole(): void {
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.ball.resetToTee();
    this.strokes = 0;
    this.hud.setStrokes(0);
    this.phase = 'ready';
    this.swing.reset();
    this.updatePar();
    this.setGameStatus('New round – take your swing! ⛳');
  }

  private handleHand(hand: HandFrame): void {
    if (!hand.available) {
      this.hasPrevPutter = false;
      this.club.setVisible(false);
      this.hud.setPower(0);
      return;
    }

    // Handpunkt in Course-lokale Koordinaten transformieren
    this.tmpLocal.copy(hand.worldPosition);
    this.course.group.worldToLocal(this.tmpLocal);

    this.club.setVisible(true);
    this.club.setTarget(this.tmpLocal);

    // Swing-Sampling in Course-Koordinaten: Kopfbewegungen (Cardboard)
    // verfälschen so die Schlaggeschwindigkeit nicht.
    if (hand.fresh !== false) this.swing.addSample(this.tmpLocal, performance.now());
    const localVelocity = this.swing.getVelocity();
    localVelocity.y = 0;
    const handSpeed = localVelocity.length();
    this.hud.setPower(handSpeed / MAX_POWER_SPEED);

    if (this.phase !== 'ready') return;

    // Kontakt: kürzester Abstand der Strecke (letzte → aktuelle Putterposition)
    // zum Ball. So werden auch schnelle Schwünge erkannt, bei denen der Putter
    // zwischen zwei Kameraframes über den Ball "springt".
    const distXZ = this.hasPrevPutter
      ? segmentPointDistanceXZ(this.prevPutter, this.tmpLocal, this.ball.position)
      : Math.hypot(this.tmpLocal.x - this.ball.position.x, this.tmpLocal.z - this.ball.position.z);
    if (hand.fresh !== false) {
      this.prevPutter.copy(this.tmpLocal);
      this.hasPrevPutter = true;
    }

    if (distXZ < READY_RADIUS && this.gameStatus.startsWith('Hold')) {
      this.setGameStatus('Swing now! \ud83c\udfcc\ufe0f');
    }

    if (distXZ < HIT_RADIUS && handSpeed > MIN_SWING) {
      this.doHit(localVelocity);
    }
  }

  private doHit(localVelocity: THREE.Vector3): void {
    this.tmpDir.copy(localVelocity);
    this.tmpDir.y = 0;

    let speed = this.tmpDir.length() * SPEED_TRANSFER * settings.swingPower;
    speed = THREE.MathUtils.clamp(speed, MIN_BALL_SPEED, MAX_BALL_SPEED);

    if (this.tmpDir.lengthSq() < 1e-4) {
      // Richtung unklar -> Richtung zum Loch als Hilfe
      this.tmpDir.copy(this.course.holeLocalPosition).sub(this.ball.position);
      this.tmpDir.y = 0;
    }
    this.tmpDir.normalize();

    this.ball.applyImpulse(this.tmpDir, speed);
    this.strokes += 1;
    this.hud.setStrokes(this.strokes);
    this.phase = 'rolling';
    this.setGameStatus('The ball is rolling…');
    this.swing.reset();
  }

  // ---------- HUD-Helfer ----------

  private setGameStatus(text: string): void {
    this.gameStatus = text;
    if (!this.warning) this.hud.setStatus(text);
  }

  private setWarning(text: string | null): void {
    if (text === this.warning) return;
    this.warning = text;
    this.hud.setStatus(text ?? this.gameStatus);
  }

  private refreshStats(): void {
    if (!this.placed) {
      this.hud.setStats(null, null, null);
      return;
    }
    const scale = this.mode === 'marker' ? worldScale() : 1;
    const dist = this.ball.isSunk
      ? 0
      : Math.hypot(this.ball.position.x - this.course.holeLocalPosition.x, this.ball.position.z - this.course.holeLocalPosition.z) * scale;
    this.hud.setStats(this.par, dist, this.holesPlayed > 0 ? this.totalScore : null);
  }

  private trackFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.detectRate = this.detections / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.detections = 0;
    }
  }

  private updateDebug(): void {
    const parts = [`${this.fps.toFixed(0)} fps`, `Camera ${this.detectRate.toFixed(0)} Hz`];
    if (this.mode === 'marker') {
      parts.push(`Marker ${settings.markerSizeCm} cm`, `Course ${(this.course.length * worldScale()).toFixed(2)} m`);
    }
    parts.push(this.tracker ? 'Hand: ready' : 'Hand: loading');
    this.hud.setDebug(parts.join(' · '));
  }

  // ---------- WebXR Hit-Test ----------

  private updateHitTest(frame: XRFrame): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    if (!this.hitTestRequested) {
      this.hitTestRequested = true;
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource?.({ space: viewerSpace })?.then((source) => {
          this.hitTestSource = source;
        });
      });
      session.addEventListener('end', () => {
        this.hitTestRequested = false;
        this.hitTestSource = null;
      });
    }

    if (this.placed || !this.hitTestSource) return;

    const refSpace = this.renderer.xr.getReferenceSpace();
    if (!refSpace) return;

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        this.reticle.setFromMatrix(new THREE.Matrix4().fromArray(pose.transform.matrix));
      }
    } else {
      this.reticle.hide();
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

/** Vollbild + Querformat + Bildschirm wach halten (für Cardboard). */
export async function enterImmersiveDisplay(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    /* z. B. iOS Safari: kein Fullscreen-API für Elemente */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {
    /* nicht überall erlaubt */
  }
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
    await nav.wakeLock?.request('screen');
  } catch {
    /* optional */
  }
}

/** Abstand eines Punktes zur Strecke a–b in der XZ-Ebene. */
function segmentPointDistanceXZ(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}
