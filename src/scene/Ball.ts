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

  constructor(private readonly course: Course) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 })
    );
    this.mesh.castShadow = true;
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

    // Horizontale Bewegung
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // Rollreibung
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizontalSpeed > 0) {
      const decel = ROLL_FRICTION * dt;
      const newSpeed = Math.max(0, horizontalSpeed - decel);
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

    this.handleBounds();
    this.handleObstacles();

    if (this.checkHole()) {
      return false; // Einsink-Animation startet im nächsten Frame
    }

    this.syncMesh();
    return false;
  }

  private handleBounds(): void {
    const c = this.course;
    const limitX = c.halfWidth - this.radius;
    const limitZ = c.halfDepth - this.radius;
    if (this.position.x > limitX) {
      this.position.x = limitX;
      this.velocity.x = -this.velocity.x * RESTITUTION;
    } else if (this.position.x < -limitX) {
      this.position.x = -limitX;
      this.velocity.x = -this.velocity.x * RESTITUTION;
    }
    if (this.position.z > limitZ) {
      this.position.z = limitZ;
      this.velocity.z = -this.velocity.z * RESTITUTION;
    } else if (this.position.z < -limitZ) {
      this.position.z = -limitZ;
      this.velocity.z = -this.velocity.z * RESTITUTION;
    }
  }

  private handleObstacles(): void {
    for (const o of this.course.obstacles) {
      const dx = this.position.x - o.center.x;
      const dz = this.position.z - o.center.z;
      const overlapX = o.halfX + this.radius - Math.abs(dx);
      const overlapZ = o.halfZ + this.radius - Math.abs(dz);
      if (overlapX > 0 && overlapZ > 0) {
        // Auf der Achse mit geringster Durchdringung herausschieben
        if (overlapX < overlapZ) {
          this.position.x += Math.sign(dx || 1) * overlapX;
          this.velocity.x = -this.velocity.x * RESTITUTION;
        } else {
          this.position.z += Math.sign(dz || 1) * overlapZ;
          this.velocity.z = -this.velocity.z * RESTITUTION;
        }
      }
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
    this.syncMesh();
    if (t >= 1) {
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  private syncMesh(): void {
    this.mesh.position.copy(this.position);
  }
}
