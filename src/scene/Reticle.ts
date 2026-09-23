import * as THREE from 'three';

/**
 * Platzierungs-Reticle für den immersiven AR-Modus.
 * Wird über Hit-Test auf reale Oberflächen projiziert.
 */
export class Reticle {
  readonly mesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.9 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  setFromMatrix(matrix: THREE.Matrix4): void {
    this.mesh.visible = true;
    this.mesh.matrix.copy(matrix);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }
}
