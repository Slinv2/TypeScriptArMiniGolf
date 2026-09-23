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
      new THREE.CylinderGeometry(0.006, 0.006, 0.25, 12),
      new THREE.MeshStandardMaterial({ color: 0xbfc4cc, metalness: 0.6, roughness: 0.3 })
    );
    this.shaft.position.y = 0.125;
    this.group.add(this.shaft);

    this.head = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x2a6df4, metalness: 0.4, roughness: 0.4 })
    );
    this.group.add(this.head);

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
