import * as THREE from 'three';

/** Achsen-ausgerichtete Hinderniszone in Course-lokalen Koordinaten (XZ). */
export interface ObstacleBox {
  mesh: THREE.Mesh;
  /** Halbe Ausdehnung in X. */
  halfX: number;
  /** Halbe Ausdehnung in Z. */
  halfZ: number;
  center: THREE.Vector3;
}

/**
 * Der komplette Minigolf-Parcours als THREE.Group.
 * Alle Spiel-Logik-Werte (Loch, Tee, Hindernisse) liegen in lokalen Koordinaten,
 * damit die Gruppe frei in der realen Welt platziert werden kann.
 */
export class Course {
  readonly group = new THREE.Group();

  readonly holeLocalPosition = new THREE.Vector3();
  readonly teeLocalPosition = new THREE.Vector3();
  readonly holeRadius = 0.08;
  readonly obstacles: ObstacleBox[] = [];

  /** Spielfeldgrenzen in lokalem X/Z (halbe Breite/Tiefe). */
  readonly halfWidth = 0.6;
  readonly halfDepth = 1.1;

  private flagCloth!: THREE.Mesh;

  constructor() {
    this.build();
  }

  private build(): void {
    // Rasenfläche
    const groundGeo = new THREE.PlaneGeometry(this.halfWidth * 2, this.halfDepth * 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2e8b57,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Umrandung
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.halfWidth * 2, 0.02, this.halfDepth * 2)),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    edge.position.y = 0.01;
    this.group.add(edge);

    // Tee (Startpunkt) vorne, Loch hinten
    this.teeLocalPosition.set(0, 0, this.halfDepth - 0.2);
    this.holeLocalPosition.set(0, 0, -this.halfDepth + 0.25);

    this.buildHole();
    this.buildFlag();
    this.buildTargetRing();
    this.buildTeeMarker();
    this.buildObstacles();
  }

  private buildHole(): void {
    const holeGeo = new THREE.CircleGeometry(this.holeRadius, 32);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x05070a, side: THREE.DoubleSide });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.copy(this.holeLocalPosition);
    hole.position.y = 0.002;
    this.group.add(hole);

    // Lochrand
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius, this.holeRadius + 0.012, 32),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(this.holeLocalPosition);
    ring.position.y = 0.003;
    this.group.add(ring);
  }

  private buildFlag(): void {
    const poleHeight = 0.4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, poleHeight, 12),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.3, roughness: 0.5 })
    );
    pole.position.copy(this.holeLocalPosition);
    pole.position.y = poleHeight / 2;
    this.group.add(pole);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xff3b30, side: THREE.DoubleSide })
    );
    flag.position.copy(this.holeLocalPosition);
    flag.position.y = poleHeight - 0.05;
    flag.position.x += 0.06;
    this.flagCloth = flag;
    this.group.add(flag);
  }

  private buildTargetRing(): void {
    const target = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius + 0.05, this.holeRadius + 0.07, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    target.rotation.x = -Math.PI / 2;
    target.position.copy(this.holeLocalPosition);
    target.position.y = 0.004;
    this.group.add(target);
  }

  private buildTeeMarker(): void {
    const tee = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.04, 32),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    tee.rotation.x = -Math.PI / 2;
    tee.position.copy(this.teeLocalPosition);
    tee.position.y = 0.004;
    this.group.add(tee);
  }

  private buildObstacles(): void {
    const specs = [
      { x: -0.22, z: 0.1, w: 0.28, d: 0.08 },
      { x: 0.25, z: -0.35, w: 0.22, d: 0.1 }
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.8 });
    for (const s of specs) {
      const height = 0.09;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, height, s.d), mat);
      mesh.position.set(s.x, height / 2, s.z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.obstacles.push({
        mesh,
        halfX: s.w / 2,
        halfZ: s.d / 2,
        center: new THREE.Vector3(s.x, 0, s.z)
      });
    }
  }

  /** Fahnen-Animation. */
  update(elapsed: number): void {
    if (this.flagCloth) {
      this.flagCloth.rotation.z = Math.sin(elapsed * 3) * 0.08;
    }
  }
}
