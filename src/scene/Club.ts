import * as THREE from 'three';
import type { Course } from './Course';

/**
 * Visualisierung der getrackten Hand als Putter-Kopf im Course.
 * Der Kopf folgt dem projizierten Handpunkt auf der Rasenebene.
 */
export class Club {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly shaft: THREE.Mesh;
  private visibleFlag = false;

  constructor(course: Course) {
    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.25, 16),
      new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.85, roughness: 0.25 })
    );
    this.shaft.position.y = 0.125;
    this.shaft.castShadow = true;
    this.group.add(this.shaft);

    this.head = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.03, 0.032),
      new THREE.MeshStandardMaterial({
        color: 0x2a6df4,
        metalness: 0.6,
        roughness: 0.3,
        emissive: 0x0a2a66,
        emissiveIntensity: 0.35
      })
    );
    this.head.castShadow = true;
    this.group.add(this.head);

    // Schlagfläche hervorheben
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.078, 0.032, 0.004),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.4, roughness: 0.4 })
    );
    face.position.z = 0.018;
    this.head.add(face);

    this.group.visible = false;
    course.group.add(this.group);
  }

  /** Setzt den Putter-Kopf auf einen Course-lokalen Bodenpunkt. */
  setTarget(localPoint: THREE.Vector3): void {
    this.group.position.set(localPoint.x, 0, localPoint.z);
  }

  setVisible(v: boolean): void {
    if (v !== this.visibleFlag) {
      this.visibleFlag = v;
      this.group.visible = v;
    }
  }
}
