import * as THREE from 'three';

/** Achsen-ausgerichtete Hinderniszone in Course-lokalen Koordinaten (XZ). */
export interface ObstacleBox {
  mesh: THREE.Object3D;
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
  readonly halfWidth = 0.45;
  readonly halfDepth = 0.75;

  private flagCloth!: THREE.Mesh;
  private flagBaseGeo!: THREE.PlaneGeometry;
  private targetRing!: THREE.Mesh;
  private teeRing!: THREE.Mesh;

  constructor() {
    this.build();
  }

  private build(): void {
    this.buildShadowCatcher();

    // Tee (Startpunkt) vorne, Loch hinten
    this.teeLocalPosition.set(0, 0, this.halfDepth - 0.2);
    this.holeLocalPosition.set(0, 0, -this.halfDepth + 0.25);

    this.buildHole();
    this.buildFlag();
    this.buildTargetRing();
    this.buildTeeMarker();
    this.buildObstacles();
  }

  /**
   * Unsichtbare Ebene, die nur Schatten annimmt.
   * So wirken Ball und Hindernisse geerdet, ohne die reale Umgebung zu verdecken.
   */
  private buildShadowCatcher(): void {
    const geo = new THREE.PlaneGeometry(this.halfWidth * 2.4, this.halfDepth * 2.4);
    const mat = new THREE.ShadowMaterial({ opacity: 0.28 });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.001;
    plane.receiveShadow = true;
    this.group.add(plane);
  }

  private buildHole(): void {
    // Vertiefung: dunkler Zylinder als Schacht
    const depth = 0.06;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.holeRadius, this.holeRadius * 0.85, depth, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0a0d0a, side: THREE.DoubleSide, roughness: 1 })
    );
    wall.position.copy(this.holeLocalPosition);
    wall.position.y = -depth / 2 + 0.001;
    this.group.add(wall);

    const bottom = new THREE.Mesh(
      new THREE.CircleGeometry(this.holeRadius * 0.85, 32),
      new THREE.MeshStandardMaterial({ color: 0x05070a })
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.copy(this.holeLocalPosition);
    bottom.position.y = -depth + 0.002;
    this.group.add(bottom);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius, this.holeRadius + 0.012, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(this.holeLocalPosition);
    ring.position.y = 0.004;
    this.group.add(ring);
  }

  private buildFlag(): void {
    const poleHeight = 0.42;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.005, poleHeight, 16),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.5, roughness: 0.35 })
    );
    pole.position.copy(this.holeLocalPosition);
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    this.group.add(pole);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.6, roughness: 0.3 })
    );
    knob.position.copy(this.holeLocalPosition);
    knob.position.y = poleHeight;
    this.group.add(knob);

    // Wehende Fahne (segmentiert für Wellen-Animation)
    this.flagBaseGeo = new THREE.PlaneGeometry(0.14, 0.08, 12, 2);
    const flag = new THREE.Mesh(
      this.flagBaseGeo,
      new THREE.MeshStandardMaterial({
        color: 0xff3b30,
        side: THREE.DoubleSide,
        roughness: 0.8,
        emissive: 0x3a0300,
        emissiveIntensity: 0.3
      })
    );
    flag.position.copy(this.holeLocalPosition);
    flag.position.y = poleHeight - 0.055;
    flag.position.x += 0.07;
    this.flagCloth = flag;
    this.group.add(flag);
  }

  private buildTargetRing(): void {
    const target = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius + 0.045, this.holeRadius + 0.075, 56),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7
      })
    );
    target.rotation.x = -Math.PI / 2;
    target.position.copy(this.holeLocalPosition);
    target.position.y = 0.005;
    this.targetRing = target;
    this.group.add(target);
  }

  private buildTeeMarker(): void {
    const tee = new THREE.Mesh(
      new THREE.RingGeometry(0.028, 0.04, 40),
      new THREE.MeshBasicMaterial({
        color: 0x3ddc84,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      })
    );
    tee.rotation.x = -Math.PI / 2;
    tee.position.copy(this.teeLocalPosition);
    tee.position.y = 0.005;
    this.teeRing = tee;
    this.group.add(tee);
  }

  private buildObstacles(): void {
    // Bunte, leicht leuchtende Hindernisse in verschiedenen Formen
    this.addBlockObstacle(-0.2, 0.12, 0.26, 0.07, 0x4cc9f0);
    this.addBlockObstacle(0.24, -0.28, 0.18, 0.09, 0xf72585);
    this.addCylinderObstacle(0.02, -0.05, 0.055, 0x9b5de5);
  }

  /** Quaderförmiges Hindernis mit heller Deckplatte. */
  private addBlockObstacle(x: number, z: number, w: number, d: number, color: number): void {
    const height = 0.08;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, height, d),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.2,
        emissive: color,
        emissiveIntensity: 0.12
      })
    );
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.008, 0.01, d + 0.008),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 })
    );
    cap.position.y = height / 2 + 0.005;
    mesh.add(cap);

    this.group.add(mesh);
    this.obstacles.push({
      mesh,
      halfX: w / 2,
      halfZ: d / 2,
      center: new THREE.Vector3(x, 0, z)
    });
  }

  /** Runder Prellbock (Bumper). */
  private addCylinderObstacle(x: number, z: number, radius: number, color: number): void {
    const height = 0.08;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 28),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.3,
        metalness: 0.25,
        emissive: color,
        emissiveIntensity: 0.15
      })
    );
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.008, 12, 28),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height / 2;
    mesh.add(ring);

    this.group.add(mesh);
    // AABB-Näherung über den Radius
    this.obstacles.push({
      mesh,
      halfX: radius,
      halfZ: radius,
      center: new THREE.Vector3(x, 0, z)
    });
  }

  /** Animationen (Fahne wehen, Zielring pulsieren). */
  update(elapsed: number): void {
    if (this.flagCloth && this.flagBaseGeo) {
      const pos = this.flagBaseGeo.attributes.position as THREE.BufferAttribute;
      const w = 0.14;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const influence = (x + w / 2) / w;
        const wave = Math.sin(x * 30 - elapsed * 6) * 0.012 * influence;
        pos.setZ(i, wave);
      }
      pos.needsUpdate = true;
    }

    if (this.targetRing) {
      const s = 1 + Math.sin(elapsed * 3) * 0.06;
      this.targetRing.scale.set(s, s, s);
      (this.targetRing.material as THREE.MeshBasicMaterial).opacity =
        0.55 + Math.sin(elapsed * 3) * 0.2;
    }
    if (this.teeRing) {
      const s = 1 + Math.sin(elapsed * 2 + 1) * 0.05;
      this.teeRing.scale.set(s, s, s);
    }
  }
}
