import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandFrame, HandTracker } from '../core/types';
import { emptyHandFrame } from '../core/types';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * Handtracking über die Webcam mit MediaPipe Hands.
 * Projiziert das Handgelenk-Landmark auf die Rasenebene des Courses,
 * um daraus eine Weltposition für den Putter-Kopf zu erhalten.
 */
export class MediaPipeHandTracker implements HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;

  private readonly prevPos = new THREE.Vector3();
  private prevTime = 0;
  private hasPrev = false;

  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly camera: THREE.Camera,
    /** Weltebene, auf die projiziert wird (Course-Boden). */
    private readonly planeConstant: () => THREE.Plane
  ) {}

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1
    });
  }

  update(): HandFrame {
    const frame = emptyHandFrame();
    if (!this.landmarker || this.video.readyState < 2) return frame;

    const now = performance.now();
    if (this.video.currentTime === this.lastVideoTime) {
      return frame;
    }
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, now);
    if (!result.landmarks || result.landmarks.length === 0) {
      this.hasPrev = false;
      return frame;
    }

    // Landmark 0 = Handgelenk. Video ist gespiegelt (Selfie) -> x invertieren.
    const wrist = result.landmarks[0][0];
    this.ndc.set(-(wrist.x * 2 - 1), -(wrist.y * 2 - 1));

    this.ray.setFromCamera(this.ndc, this.camera);
    this.groundPlane.copy(this.planeConstant());
    const hit = this.ray.ray.intersectPlane(this.groundPlane, this.hitPoint);
    if (!hit) {
      this.hasPrev = false;
      return frame;
    }

    frame.available = true;
    frame.worldPosition.copy(this.hitPoint);

    if (this.hasPrev) {
      const dt = (now - this.prevTime) / 1000;
      if (dt > 0) {
        frame.velocity.copy(this.hitPoint).sub(this.prevPos).divideScalar(dt);
      }
    }
    this.prevPos.copy(this.hitPoint);
    this.prevTime = now;
    this.hasPrev = true;

    return frame;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
