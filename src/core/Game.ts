import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { Course } from '../scene/Course';
import { Ball } from '../scene/Ball';
import { Club } from '../scene/Club';
import { Reticle } from '../scene/Reticle';
import { HUD } from './HUD';
import { SwingDetector } from '../tracking/SwingDetector';
import { MediaPipeHandTracker } from '../tracking/MediaPipeHandTracker';
import { WebXRHandTracker } from '../tracking/WebXRHandTracker';
import type { GamePhase, HandFrame, HandTracker } from './types';

type Mode = 'xr' | 'webcam';

const HIT_RADIUS = 0.09; // Distanz Putterkopf<->Ball für Kontakt (m)
const MIN_SWING = 0.6; // Mindest-Handgeschwindigkeit zum Auslösen (m/s)
const SPEED_TRANSFER = 0.6; // Anteil der Handgeschwindigkeit, der auf den Ball übergeht
const MIN_BALL_SPEED = 1.0;
const MAX_BALL_SPEED = 6.0;
const MAX_POWER_SPEED = 4.0; // für die HUD-Anzeige

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

  private readonly swing = new SwingDetector();
  private tracker: HandTracker | null = null;

  private mode: Mode = 'webcam';
  private phase: GamePhase = 'placing';
  private strokes = 0;
  private placed = false;

  private hitTestSource: XRHitTestSource | null = null;
  private hitTestRequested = false;

  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;

  // Wiederverwendbare temporäre Objekte (kein GC-Druck im Loop)
  private readonly tmpLocal = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly invQuat = new THREE.Quaternion();
  private readonly groundPlaneWorld = new THREE.Plane();

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
    this.camera.position.set(0, 1.6, 0);

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
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 3, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);
  }

  // ---------- Modus-Start ----------

  async startImmersive(): Promise<void> {
    this.mode = 'xr';
    this.hud.show();
    this.hud.setStatus('Bewege dein Ger\u00e4t und tippe, um den Parcours zu platzieren.');

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
    this.hud.setStatus('Kamera wird gestartet\u2026');

    this.video = document.getElementById('camera') as HTMLVideoElement;
    this.video.style.display = 'block';

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch {
      // Fallback auf Frontkamera
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    this.video.srcObject = this.stream;
    await this.video.play();

    const mpTracker = new MediaPipeHandTracker(this.video, this.camera, () => this.groundPlaneWorld);
    this.tracker = mpTracker;
    this.hud.setStatus('Handmodell wird geladen\u2026');
    await mpTracker.init();

    // Course automatisch ~0.7 m vor der Kamera platzieren
    this.placeCourseInFront(0.7);
    this.hud.setStatus('Hole aus und schlage den Ball ins Loch! \u26f3');

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.loop(null));
  }

  // ---------- Platzierung ----------

  private placeCourseInFront(distance: number): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();
    const origin = this.camera.position.clone().add(forward.multiplyScalar(distance));
    origin.y = 0; // auf Bodenhöhe (angenommen y=0 unter der Kamera)

    this.course.group.position.copy(origin);
    // Course so drehen, dass das Tee zum Spieler zeigt
    const angle = Math.atan2(forward.x, forward.z);
    this.course.group.rotation.set(0, angle, 0);
    this.course.group.visible = true;

    this.updateGroundPlaneWorld();
    this.ball.resetToTee();
    this.placed = true;
    this.phase = 'ready';
    this.strokes = 0;
    this.hud.setStrokes(0);
  }

  private onSelect(): void {
    if (this.mode !== 'xr') return;
    if (!this.reticle.visible) return;

    if (!this.placed) {
      // Course an Reticle-Position setzen
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      this.reticle.mesh.matrix.decompose(pos, quat, scale);

      this.course.group.position.copy(pos);
      // Ausrichtung: Tee zeigt zur Kamera
      const toCam = this.camera.position.clone().sub(pos);
      toCam.y = 0;
      const angle = Math.atan2(toCam.x, toCam.z);
      this.course.group.rotation.set(0, angle, 0);
      this.course.group.visible = true;

      this.updateGroundPlaneWorld();
      this.ball.resetToTee();
      this.placed = true;
      this.phase = 'ready';
      this.strokes = 0;
      this.hud.setStrokes(0);
      this.reticle.hide();
      this.hud.setStatus('Hole aus und schlage den Ball ins Loch! \u26f3');
    }
  }

  private updateGroundPlaneWorld(): void {
    // Course-Boden (lokal y=0) in Weltkoordinaten als Ebene ausdrücken
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.course.group.quaternion).normalize();
    this.groundPlaneWorld.setFromNormalAndCoplanarPoint(normal, this.course.group.position);
  }

  // ---------- Haupt-Loop ----------

  private loop(frame: XRFrame | null): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.mode === 'xr' && frame) {
      this.updateHitTest(frame);
    }

    this.course.update(elapsed);

    if (this.placed && this.tracker) {
      const hand = this.tracker.update(frame);
      this.handleHand(hand);
    }

    if (this.phase === 'rolling' || this.phase === 'sunk') {
      const finished = this.ball.update(dt);
      if (this.ball.isSunk && this.phase !== 'sunk') {
        this.phase = 'sunk';
        this.hud.setStatus(`Eingelocht! \ud83c\udf89 Mit ${this.strokes} Schl\u00e4gen.`);
      }
      if (this.phase === 'rolling' && !this.ball.isMoving && !this.ball.isSunk) {
        this.phase = 'ready';
        this.hud.setStatus('Bereit f\u00fcr den n\u00e4chsten Schlag.');
      }
      if (finished) {
        // Nach kurzer Pause neu starten
        window.setTimeout(() => this.restartHole(), 2500);
        this.phase = 'sunk';
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private restartHole(): void {
    this.ball.resetToTee();
    this.strokes = 0;
    this.hud.setStrokes(0);
    this.phase = 'ready';
    this.hud.setStatus('Neue Runde \u2013 hole aus und schlage ein! \u26f3');
  }

  private handleHand(hand: HandFrame): void {
    if (!hand.available) {
      this.club.setVisible(false);
      return;
    }

    // Handpunkt in Course-lokale Koordinaten transformieren
    this.tmpLocal.copy(hand.worldPosition);
    this.course.group.worldToLocal(this.tmpLocal);

    // Putterkopf auf Bodenprojektion setzen
    this.club.setVisible(true);
    this.club.setTarget(this.tmpLocal);

    // Swing-Sampling in Weltkoordinaten
    this.swing.addSample(hand.worldPosition, performance.now());
    const handSpeed = this.swing.getSpeed();

    // Kraftanzeige
    this.hud.setPower(handSpeed / MAX_POWER_SPEED);

    if (this.phase !== 'ready') return;

    // Kontaktprüfung: Putterkopf nahe am Ball (XZ, lokal)?
    const dx = this.tmpLocal.x - this.ball.position.x;
    const dz = this.tmpLocal.z - this.ball.position.z;
    const distXZ = Math.hypot(dx, dz);

    if (distXZ < HIT_RADIUS && handSpeed > MIN_SWING) {
      this.doHit(hand.velocity);
    }
  }

  private doHit(worldVelocity: THREE.Vector3): void {
    // Weltgeschwindigkeit in Course-lokale Richtung umrechnen
    this.invQuat.copy(this.course.group.quaternion).invert();
    this.tmpDir.copy(worldVelocity).applyQuaternion(this.invQuat);
    this.tmpDir.y = 0;

    let speed = worldVelocity.length() * SPEED_TRANSFER;
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
    this.hud.setStatus('Der Ball rollt\u2026');
    this.swing.reset();
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
