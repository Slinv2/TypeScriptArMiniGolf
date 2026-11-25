import * as THREE from 'three';
import type { Course } from './Course';

const GRAVITY = 9.81;
const ROLL_FRICTION = 1.8; // Verzögerung m/s² beim Rollen
const RESTITUTION = 0.55; // Dämpfung bei Wand-/Hinderniskontakt
const CAPTURE_SPEED = 1.6; // max. Geschwindigkeit für Einlochen

export class Ball {
  readonly mesh: THREE.Mesh;
  readonly radius = 0.021;

  /** Position in Course-lokalen Koordinaten. */
  readonly position = new THREE.Vector3();
  /** Geschwindigkeit in Course-lokalen Koordinaten (m/s). */
  readonly velocity = new THREE.Vector3();

  private airborneY = 0;
  private sunk = false;
  private sinkTimer = 0;
  private readonly shadow: THREE.Mesh;

  constructor(private readonly course: Course) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.1,
        emissive: 0x222222,
        emissiveIntensity: 0.15
      })
    );
    this.mesh.castShadow = true;

    // Weicher Kontaktschatten unter dem Ball
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 1.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    course.group.add(this.shadow);
    course.group.add(this.mesh);
    this.resetToTee();
  }

  resetToTee(): void {
    this.position.copy(this.course.teeLocalPosition);
    this.position.y = this.radius;
    this.velocity.set(0, 0, 0);
    this.airborneY = 0;
    this.sunk = false;
    this.sinkTimer = 0;
    this.mesh.visible = true;
    this.shadow.visible = true;
    this.mesh.scale.setScalar(1);
    this.syncMesh();
  }

  get isMoving(): boolean {
    return this.velocity.lengthSq() > 0.0004;
  }

  get isSunk(): boolean {
    return this.sunk;
  }

  /** Schlag-Impuls anwenden (horizontal, Course-lokal). */
  applyImpulse(direction: THREE.Vector3, speed: number): void {
    if (this.sunk) return;
    const v = direction.clone().setY(0).normalize().multiplyScalar(speed);
    this.velocity.copy(v);
  }

  /**
   * Physik-Schritt.
   * @returns true, wenn der Ball in diesem Schritt vollständig eingelocht wurde.
   */
  update(dt: number): boolean {
    if (this.sunk) {
      return this.animateSink(dt);
    }

    // Substeps gegen "Tunneln" durch dünne Wände bei hoher Geschwindigkeit
    const speed0 = Math.hypot(this.velocity.x, this.velocity.z);
    const steps = Math.min(24, Math.max(1, Math.ceil((speed0 * dt) / (this.radius * 0.8))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.position.x += this.velocity.x * h;
      this.position.z += this.velocity.z * h;
      this.handleBounds();
      this.handleObstacles();
      if (this.checkHole()) return false; // Einsink-Animation startet im nächsten Frame
    }

    // Rollreibung
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizontalSpeed > 0) {
      const newSpeed = Math.max(0, horizontalSpeed - ROLL_FRICTION * dt);
      const factor = newSpeed / horizontalSpeed;
      this.velocity.x *= factor;
      this.velocity.z *= factor;
    }

    // Vertikale Bewegung (falls Ball abhebt)
    if (this.airborneY > 0 || this.velocity.y !== 0) {
      this.velocity.y -= GRAVITY * dt;
      this.airborneY += this.velocity.y * dt;
      if (this.airborneY <= 0) {
        this.airborneY = 0;
        this.velocity.y = 0;
      }
    }
    this.position.y = this.radius + this.airborneY;

    this.syncMesh();
    return false;
  }

  private handleBounds(): void {
    const b = this.course.bounds;
    const r = this.radius;
    if (this.position.x > b.maxX - r) {
      this.position.x = b.maxX - r;
      this.velocity.x = -Math.abs(this.velocity.x) * RESTITUTION;
    } else if (this.position.x < b.minX + r) {
      this.position.x = b.minX + r;
      this.velocity.x = Math.abs(this.velocity.x) * RESTITUTION;
    }
    if (this.position.z > b.maxZ - r) {
      this.position.z = b.maxZ - r;
      this.velocity.z = -Math.abs(this.velocity.z) * RESTITUTION;
    } else if (this.position.z < b.minZ + r) {
      this.position.z = b.minZ + r;
      this.velocity.z = Math.abs(this.velocity.z) * RESTITUTION;
    }
  }

  private handleObstacles(): void {
    for (const o of this.course.obstacles) {
      o.collide(this.position, this.velocity, this.radius);
    }
  }

  private checkHole(): boolean {
    const dx = this.position.x - this.course.holeLocalPosition.x;
    const dz = this.position.z - this.course.holeLocalPosition.z;
    const distXZ = Math.hypot(dx, dz);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (distXZ < this.course.holeRadius && speed < CAPTURE_SPEED) {
      this.sunk = true;
      this.sinkTimer = 0;
      this.velocity.set(0, 0, 0);
      return true;
    }
    return false;
  }

  private animateSink(dt: number): boolean {
    this.sinkTimer += dt;
    const duration = 0.5;
    const t = Math.min(1, this.sinkTimer / duration);
    // In das Loch sinken und schrumpfen
    this.position.x = THREE.MathUtils.lerp(this.position.x, this.course.holeLocalPosition.x, t);
    this.position.z = THREE.MathUtils.lerp(this.position.z, this.course.holeLocalPosition.z, t);
    this.position.y = this.radius - t * (this.radius + 0.05);
    this.mesh.scale.setScalar(1 - t * 0.4);
    this.shadow.visible = false;
    this.syncMesh();
    if (t >= 1) {
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  private syncMesh(): void {
    this.mesh.position.copy(this.position);
    // Schatten am Boden unter dem Ball, verblasst wenn der Ball abhebt
    this.shadow.position.set(this.position.x, 0.006, this.position.z);
    const lift = Math.max(0, this.position.y - this.radius);
    const shadowMat = this.shadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = Math.max(0, 0.28 - lift * 1.5);
    const scale = 1 + lift * 4;
    this.shadow.scale.set(scale, scale, scale);
  }
}
