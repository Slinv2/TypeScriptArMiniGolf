import * as THREE from 'three';

interface Sample {
  position: THREE.Vector3;
  time: number; // ms
}

/**
 * Sammelt Hand-Positionen über ein kurzes Zeitfenster und schätzt daraus
 * eine geglättete Geschwindigkeit für die Schlagerkennung.
 */
export class SwingDetector {
  private readonly samples: Sample[] = [];
  private readonly windowMs = 120;

  addSample(worldPosition: THREE.Vector3, timeMs: number): void {
    this.samples.push({ position: worldPosition.clone(), time: timeMs });
    const cutoff = timeMs - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  /** Geschätzte Geschwindigkeit (Weltkoordinaten, m/s). */
  getVelocity(): THREE.Vector3 {
    if (this.samples.length < 2) return new THREE.Vector3();
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0) return new THREE.Vector3();
    return last.position.clone().sub(first.position).divideScalar(dt);
  }

  getSpeed(): number {
    return this.getVelocity().length();
  }

  reset(): void {
    this.samples.length = 0;
  }
}
