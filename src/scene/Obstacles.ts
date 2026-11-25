import * as THREE from 'three';
import type { ObstacleKind } from '../config';

const WALL_RESTITUTION = 0.55;
const BUMPER_RESTITUTION = 0.9;
const HEIGHT = 0.08;

/**
 * Ein Hindernis im Course (lokale XZ-Ebene). Kollisionen werden analytisch
 * gegen die echte Form gerechnet (gedrehte Box mit runden Ecken bzw. Kreis),
 * damit Hindernisse auf Markern beliebig gedreht werden können.
 */
export class Obstacle {
  readonly mesh = new THREE.Group();
  readonly center = new THREE.Vector3();
  /** Drehung um Y (rad). */
  yaw = 0;
  active = true;

  private spin = 0;
  private readonly rotor: THREE.Object3D;

  constructor(
    readonly kind: ObstacleKind,
    /** Wand/Balken: Länge; Bumper: Radius. */
    readonly length: number,
    readonly thickness: number,
    color: number
  ) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.14
    });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 });

    if (kind === 'bumper') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(length, length, HEIGHT, 32), mat);
      body.position.y = HEIGHT / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(length, 0.009, 12, 32), white);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = HEIGHT;
      body.castShadow = true;
      body.receiveShadow = true;
      this.mesh.add(body, ring);
      this.rotor = body;
    } else if (kind === 'wall') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(length, HEIGHT, thickness), mat);
      body.position.y = HEIGHT / 2;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(length + 0.008, 0.01, thickness + 0.008), white);
      cap.position.y = HEIGHT / 2 + 0.005;
      body.add(cap);
      body.castShadow = true;
      body.receiveShadow = true;
      this.mesh.add(body);
      this.rotor = body;
    } else {
      // Drehbalken (Windmühle): Sockel + rotierender Balken
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, HEIGHT * 1.6, 20), white);
      post.position.y = HEIGHT * 0.8;
      post.castShadow = true;
      const rotor = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(length, HEIGHT * 0.7, thickness), mat);
      bar.position.y = HEIGHT * 0.35 + 0.004;
      bar.castShadow = true;
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), mat);
      hub.position.y = HEIGHT * 1.6;
      rotor.add(bar);
      this.mesh.add(post, rotor, hub);
      this.rotor = rotor;
    }
  }

  /** Winkelgeschwindigkeit des Drehbalkens (rad/s). */
  get angularVelocity(): number {
    return this.kind === 'spinner' ? 1.2 : 0;
  }

  setPose(x: number, z: number, yaw: number): void {
    this.center.set(x, 0, z);
    this.yaw = yaw;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = this.kind === 'spinner' ? 0 : yaw;
  }

  update(elapsed: number): void {
    if (this.kind === 'spinner') {
      this.spin = this.yaw + elapsed * this.angularVelocity;
      this.rotor.rotation.y = this.spin;
    }
  }

  /** Kollision Ball ↔ Hindernis. Ändert pos/vel in-place. */
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean {
    if (!this.active || !this.mesh.visible) return false;
    if (this.kind === 'bumper') return this.collideCircle(pos, vel, radius);
    const yaw = this.kind === 'spinner' ? this.spin : this.yaw;
    return this.collideBox(pos, vel, radius, yaw, this.length / 2, this.thickness / 2);
  }

  private collideCircle(pos: THREE.Vector3, vel: THREE.Vector3, r: number): boolean {
    const dx = pos.x - this.center.x;
    const dz = pos.z - this.center.z;
    const dist = Math.hypot(dx, dz);
    const minDist = this.length + r;
    if (dist >= minDist) return false;
    const nx = dist > 1e-6 ? dx / dist : 1;
    const nz = dist > 1e-6 ? dz / dist : 0;
    pos.x = this.center.x + nx * minDist;
    pos.z = this.center.z + nz * minDist;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= (1 + BUMPER_RESTITUTION) * vn * nx;
      vel.z -= (1 + BUMPER_RESTITUTION) * vn * nz;
    }
    return true;
  }

  private collideBox(pos: THREE.Vector3, vel: THREE.Vector3, r: number, yaw: number, hx: number, hz: number): boolean {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = pos.x - this.center.x;
    const dz = pos.z - this.center.z;
    // Welt → Box-lokal (inverse Y-Rotation)
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const qx = THREE.MathUtils.clamp(lx, -hx, hx);
    const qz = THREE.MathUtils.clamp(lz, -hz, hz);
    let ox = lx - qx;
    let oz = lz - qz;
    let dist = Math.hypot(ox, oz);
    let pen: number;
    if (dist > 1e-6) {
      if (dist >= r) return false;
      ox /= dist;
      oz /= dist;
      pen = r - dist;
    } else {
      // Ballmittelpunkt in der Box → über die nächste Seite herausdrücken
      const px = hx - Math.abs(lx);
      const pz = hz - Math.abs(lz);
      if (px < pz) {
        ox = Math.sign(lx) || 1;
        oz = 0;
        pen = px + r;
      } else {
        ox = 0;
        oz = Math.sign(lz) || 1;
        pen = pz + r;
      }
      dist = 0;
    }
    // Normale zurück in Course-Koordinaten
    const nx = ox * c + oz * s;
    const nz = -ox * s + oz * c;
    pos.x += nx * pen;
    pos.z += nz * pen;

    // Oberflächengeschwindigkeit (nur Drehbalken): ω × r
    const w = this.angularVelocity;
    const cx = pos.x - this.center.x;
    const cz = pos.z - this.center.z;
    const svx = w * cz;
    const svz = -w * cx;
    const rvn = (vel.x - svx) * nx + (vel.z - svz) * nz;
    if (rvn < 0) {
      vel.x -= (1 + WALL_RESTITUTION) * rvn * nx;
      vel.z -= (1 + WALL_RESTITUTION) * rvn * nz;
    }
    return true;
  }
}
