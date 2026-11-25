import * as THREE from 'three';
import type { HandFrame, HandTracker } from '../core/types';
import { emptyHandFrame } from '../core/types';

/**
 * Entwicklungs-/Fallback-Eingabe: Maus oder Finger auf dem Bildschirm dient als
 * Putter. Der Zeiger wird – wie die Hand bei MediaPipe – per Raycast auf die
 * Rasenebene projiziert. Praktisch am PC, wenn kein Handmodell geladen werden kann.
 */
export class PointerHandTracker implements HandTracker {
  private readonly ndc = new THREE.Vector2();
  private active = false;
  private readonly ray = new THREE.Raycaster();
  private readonly hit = new THREE.Vector3();
  private readonly onMove = (e: PointerEvent) => this.handle(e);
  private readonly onLeave = () => (this.active = false);

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly plane: () => THREE.Plane,
    private readonly isMirrored: () => boolean
  ) {}

  async init(): Promise<void> {
    this.element.addEventListener('pointermove', this.onMove);
    this.element.addEventListener('pointerdown', this.onMove);
    this.element.addEventListener('pointerleave', this.onLeave);
    this.element.addEventListener('pointercancel', this.onLeave);
  }

  private handle(e: PointerEvent): void {
    const r = this.element.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    if (this.isMirrored()) x = -x;
    this.ndc.set(x, -(((e.clientY - r.top) / r.height) * 2 - 1));
    this.active = true;
  }

  update(): HandFrame {
    const frame = emptyHandFrame();
    if (!this.active) return frame;
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane(), this.hit)) return frame;
    frame.available = true;
    frame.fresh = true;
    frame.worldPosition.copy(this.hit);
    return frame;
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerdown', this.onMove);
    this.element.removeEventListener('pointerleave', this.onLeave);
    this.element.removeEventListener('pointercancel', this.onLeave);
  }
}
