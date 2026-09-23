import * as THREE from 'three';
import type { WebGLRenderer } from 'three';
import type { HandFrame, HandTracker } from '../core/types';
import { emptyHandFrame } from '../core/types';

/**
 * Handtracking über natives WebXR Hand Input (AR-Brille / Headset).
 * Nutzt die Gelenkpose der Zeigefingerspitze relativ zum Referenzraum
 * und berechnet die Geschwindigkeit per Differenzenquotient.
 */
export class WebXRHandTracker implements HandTracker {
  private referenceSpace: XRReferenceSpace | null = null;

  private readonly prevPos = new THREE.Vector3();
  private prevTime = 0;
  private hasPrev = false;

  constructor(private readonly renderer: WebGLRenderer) {}

  async init(): Promise<void> {
    const rs = this.renderer.xr.getReferenceSpace();
    this.referenceSpace = rs ?? null;
  }

  update(frame?: XRFrame | null): HandFrame {
    const out = emptyHandFrame();
    if (!frame) return out;

    if (!this.referenceSpace) {
      this.referenceSpace = this.renderer.xr.getReferenceSpace() ?? null;
      if (!this.referenceSpace) return out;
    }

    const session = frame.session;
    for (const source of session.inputSources) {
      const hand = source.hand;
      if (!hand) continue;

      const tip = hand.get('index-finger-tip');
      if (!tip) continue;

      const pose = frame.getJointPose?.(tip, this.referenceSpace);
      if (!pose) continue;

      const p = pose.transform.position;
      out.available = true;
      out.worldPosition.set(p.x, p.y, p.z);

      const now = performance.now();
      if (this.hasPrev) {
        const dt = (now - this.prevTime) / 1000;
        if (dt > 0) {
          out.velocity.copy(out.worldPosition).sub(this.prevPos).divideScalar(dt);
        }
      }
      this.prevPos.copy(out.worldPosition);
      this.prevTime = now;
      this.hasPrev = true;
      return out;
    }

    this.hasPrev = false;
    return out;
  }

  dispose(): void {
    this.referenceSpace = null;
  }
}
