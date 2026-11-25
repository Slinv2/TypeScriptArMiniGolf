import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandFrame, HandTracker } from '../core/types';
import { emptyHandFrame } from '../core/types';
import type { HandPoint } from '../config';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Wie lange eine Hand nach dem letzten Treffer noch als "da" gilt (ms). */
const HOLD_MS = 120;

export interface MediaPipeOptions {
  /** Landmark-x spiegeln (Selfie-Ansicht im Webcam-Modus). */
  mirrorX: boolean;
  handPoint: HandPoint;
  /** Liefert true, wenn seit dem letzten Aufruf ein neuer Kameraframe vorliegt. */
  hasNewFrame?: () => boolean;
}

/**
 * Handtracking über die Kamera mit MediaPipe Hands.
 * Projiziert einen Hand-Landmark per Raycast auf die Rasenebene des Courses,
 * um daraus eine Weltposition für den Putter-Kopf zu erhalten.
 */
export class MediaPipeHandTracker implements HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = 0;

  private readonly prevPos = new THREE.Vector3();
  private prevTime = 0;
  private hasPrev = false;
  private lastHit = 0;
  private readonly last = emptyHandFrame();

  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();

  /** Normierte Bildkoordinate des zuletzt erkannten Handpunkts (Debug). */
  readonly imagePoint = new THREE.Vector2(-1, -1);

  constructor(
    private readonly source: HTMLVideoElement | HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    /** Weltebene, auf die projiziert wird (Course-Boden). */
    private readonly planeConstant: () => THREE.Plane,
    private readonly options: MediaPipeOptions = { mirrorX: true, handPoint: 'wrist' }
  ) {}

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
    try {
      this.landmarker = await create('GPU');
    } catch {
      this.landmarker = await create('CPU');
    }
  }

  private newFrameAvailable(): boolean {
    if (this.options.hasNewFrame) return this.options.hasNewFrame();
    const video = this.source as HTMLVideoElement;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = video.currentTime;
    return true;
  }

  update(): HandFrame {
    if (!this.landmarker || !this.newFrameAvailable()) {
      // Kein neuer Kameraframe: letzten Stand halten (kein Flackern des Putters)
      const held = performance.now() - this.lastHit < HOLD_MS && this.last.available;
      return { ...this.last, available: held, fresh: false };
    }

    const now = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;
    const result = this.landmarker.detectForVideo(this.source, now);
    if (!result.landmarks || result.landmarks.length === 0) {
      this.hasPrev = false;
      const held = now - this.lastHit < HOLD_MS && this.last.available;
      if (!held) this.last.available = false;
      return { ...this.last, available: held, fresh: false };
    }

    const p = this.pickPoint(result.landmarks[0]);
    this.imagePoint.set(p.x, p.y);
    const nx = p.x * 2 - 1;
    this.ndc.set(this.options.mirrorX ? -nx : nx, -(p.y * 2 - 1));

    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    this.groundPlane.copy(this.planeConstant());
    const hit = this.ray.ray.intersectPlane(this.groundPlane, this.hitPoint);
    if (!hit) {
      this.hasPrev = false;
      return { ...emptyHandFrame(), fresh: false };
    }

    const frame: HandFrame = { ...emptyHandFrame(), fresh: true };
    frame.available = true;
    frame.worldPosition.copy(this.hitPoint);
    if (this.hasPrev) {
      const dt = (now - this.prevTime) / 1000;
      if (dt > 0) frame.velocity.copy(this.hitPoint).sub(this.prevPos).divideScalar(dt);
    }
    this.prevPos.copy(this.hitPoint);
    this.prevTime = now;
    this.hasPrev = true;
    this.lastHit = now;
    this.last.available = true;
    this.last.worldPosition.copy(frame.worldPosition);
    this.last.velocity.copy(frame.velocity);
    return frame;
  }

  private pickPoint(lm: { x: number; y: number }[]): { x: number; y: number } {
    switch (this.options.handPoint) {
      case 'index':
        return lm[8];
      case 'palm': {
        const ids = [0, 5, 9, 13, 17];
        return {
          x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length,
          y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length
        };
      }
      default:
        return lm[0];
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
