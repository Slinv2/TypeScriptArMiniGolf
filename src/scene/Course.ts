import * as THREE from 'three';
import { MARKERS, type MarkerId } from '../config';
import type { ObstaclePlacement } from '../core/types';
import { Obstacle } from './Obstacles';

/** Spielfeldgrenzen in Course-lokalen Koordinaten. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const FIELD_MARGIN = 0.28; // Abstand Rand ↔ Tee/Loch/Hindernis
const MIN_HALF_WIDTH = 0.42;
const RAIL_HEIGHT = 0.035;
const RAIL_WIDTH = 0.025;

/**
 * Der komplette Minigolf-Parcours als THREE.Group.
 * Alle Spiel-Logik-Werte (Loch, Tee, Hindernisse, Grenzen) liegen in lokalen
 * Koordinaten, damit die Gruppe frei in der realen Welt platziert werden kann.
 *
 * Zwei Betriebsarten:
 *  - fester Standard-Parcours (Webcam / Immersive AR)
 *  - Marker-Parcours: Loch und Hindernisse folgen den gedruckten Markern.
 */
export class Course {
  readonly group = new THREE.Group();

  readonly holeLocalPosition = new THREE.Vector3();
  readonly teeLocalPosition = new THREE.Vector3();
  readonly holeRadius = 0.08;
  readonly obstacles: Obstacle[] = [];
  readonly bounds: Bounds = { minX: -0.45, maxX: 0.45, minZ: -0.75, maxZ: 0.75 };

  private readonly holeGroup = new THREE.Group();
  private readonly teeGroup = new THREE.Group();
  private readonly markerObstacles = new Map<MarkerId, Obstacle>();
  private flagBaseGeo!: THREE.PlaneGeometry;
  private targetRing!: THREE.Mesh;
  private teeRing!: THREE.Mesh;
  private turf!: THREE.Mesh;
  private shadowCatcher!: THREE.Mesh;
  private readonly rails: THREE.Mesh[] = [];
  private layoutKey = '';

  constructor() {
    this.build();
  }

  private build(): void {
    this.buildTurf();
    this.buildRails();
    this.group.add(this.holeGroup, this.teeGroup);
    this.buildHole();
    this.buildFlag();
    this.buildTargetRing();
    this.buildTeeMarker();
    this.useDefaultLayout();
  }

  // ---------- Layouts ----------

  /** Fester Parcours wie im ursprünglichen Prototyp. */
  useDefaultLayout(): void {
    this.clearObstacles();
    this.teeLocalPosition.set(0, 0, 0.55);
    this.holeLocalPosition.set(0, 0, -0.5);
    this.addStatic('wall', -0.2, 0.12, 0, 0.26, 0.07, 0x4cc9f0);
    this.addStatic('wall', 0.24, -0.28, 0, 0.18, 0.09, 0xf72585);
    this.addStatic('bumper', 0.02, -0.05, 0, 0.055, 0, 0x9b5de5);
    Object.assign(this.bounds, { minX: -0.45, maxX: 0.45, minZ: -0.75, maxZ: 0.75 });
    this.applyLayout(true);
  }

  /** Marker-Parcours: Tee im Ursprung, Hindernisse entstehen erst, wenn ihr Marker gesehen wurde. */
  useMarkerLayout(): void {
    this.clearObstacles();
    this.teeLocalPosition.set(0, 0, 0);
    this.holeLocalPosition.set(0, 0, -1);
    for (const def of MARKERS) {
      if (def.role !== 'obstacle' || !def.obstacle) continue;
      const o = new Obstacle(def.obstacle.kind, def.obstacle.length, def.obstacle.thickness, def.obstacle.color);
      o.mesh.visible = false;
      this.group.add(o.mesh);
      this.obstacles.push(o);
      this.markerObstacles.set(def.id, o);
    }
    this.applyLayout(true);
  }

  /** Übernimmt Loch- und Hindernispositionen aus dem Marker-Anker. */
  updateFromMarkers(holeLocal: THREE.Vector3, placements: ObstaclePlacement[]): void {
    this.holeLocalPosition.set(holeLocal.x, 0, holeLocal.z);
    for (const p of placements) {
      const o = this.markerObstacles.get(p.id);
      if (!o) continue;
      o.setPose(p.x, p.z, p.yaw);
      o.mesh.visible = p.known;
    }
    this.applyLayout(false);
  }

  private clearObstacles(): void {
    for (const o of this.obstacles) this.group.remove(o.mesh);
    this.obstacles.length = 0;
    this.markerObstacles.clear();
  }

  private addStatic(kind: 'wall' | 'bumper', x: number, z: number, yaw: number, len: number, thick: number, color: number): void {
    const o = new Obstacle(kind, len, thick, color);
    o.setPose(x, z, yaw);
    this.group.add(o.mesh);
    this.obstacles.push(o);
  }

  /** Grenzen aus Tee, Loch und Hindernissen ableiten und Geometrie nachziehen. */
  private applyLayout(force: boolean): void {
    this.holeGroup.position.set(this.holeLocalPosition.x, 0, this.holeLocalPosition.z);
    this.teeGroup.position.set(this.teeLocalPosition.x, 0, this.teeLocalPosition.z);

    if (this.markerObstacles.size > 0) {
      let halfW = MIN_HALF_WIDTH;
      let minZ = Math.min(this.holeLocalPosition.z, this.teeLocalPosition.z) - FIELD_MARGIN;
      let maxZ = Math.max(this.holeLocalPosition.z, this.teeLocalPosition.z) + FIELD_MARGIN;
      for (const o of this.obstacles) {
        if (!o.mesh.visible) continue;
        halfW = Math.max(halfW, Math.abs(o.center.x) + o.length / 2 + 0.1);
        minZ = Math.min(minZ, o.center.z - 0.15);
        maxZ = Math.max(maxZ, o.center.z + 0.15);
      }
      Object.assign(this.bounds, { minX: -halfW, maxX: halfW, minZ, maxZ });
    }

    // Geometrie nur neu bauen, wenn sich das Feld spürbar geändert hat
    const b = this.bounds;
    const key = [b.minX, b.maxX, b.minZ, b.maxZ, this.holeLocalPosition.x, this.holeLocalPosition.z]
      .map((v) => Math.round(v * 50))
      .join('|');
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    this.rebuildTurf();
    this.layoutRails();
  }

  /** Länge der Bahn (Tee → Loch) in Spiel-Metern. */
  get length(): number {
    return this.teeLocalPosition.distanceTo(this.holeLocalPosition);
  }

  // ---------- Geometrie ----------

  private buildTurf(): void {
    // Halbtransparenter Rasen: die reale Umgebung bleibt sichtbar
    this.turf = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x2fae5a,
        roughness: 0.95,
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      })
    );
    this.turf.rotation.x = -Math.PI / 2;
    this.turf.position.y = 0.002;
    this.turf.receiveShadow = true;
    this.group.add(this.turf);

    // Unsichtbare Ebene, die nur Schatten annimmt
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.003;
    this.shadowCatcher.receiveShadow = true;
    this.group.add(this.shadowCatcher);
  }

  private rebuildTurf(): void {
    const b = this.bounds;
    const shape = new THREE.Shape();
    // Shape liegt in XY und wird um −90° um X gedreht: y_shape = −z_local
    shape.moveTo(b.minX, -b.maxZ);
    shape.lineTo(b.maxX, -b.maxZ);
    shape.lineTo(b.maxX, -b.minZ);
    shape.lineTo(b.minX, -b.minZ);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(this.holeLocalPosition.x, -this.holeLocalPosition.z, this.holeRadius + 0.012, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    this.turf.geometry.dispose();
    this.turf.geometry = new THREE.ShapeGeometry(shape, 48);

    this.shadowCatcher.scale.set(b.maxX - b.minX + 0.6, b.maxZ - b.minZ + 0.6, 1);
    this.shadowCatcher.position.x = (b.minX + b.maxX) / 2;
    this.shadowCatcher.position.z = (b.minZ + b.maxZ) / 2;
  }

  private buildRails(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5, metalness: 0.05 });
    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1, RAIL_HEIGHT, RAIL_WIDTH), mat);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.rails.push(rail);
      this.group.add(rail);
    }
  }

  private layoutRails(): void {
    const b = this.bounds;
    const w = b.maxX - b.minX + RAIL_WIDTH * 2;
    const d = b.maxZ - b.minZ;
    const y = RAIL_HEIGHT / 2;
    const [front, back, left, right] = this.rails;
    front.scale.set(w, 1, 1);
    front.position.set((b.minX + b.maxX) / 2, y, b.maxZ + RAIL_WIDTH / 2);
    back.scale.set(w, 1, 1);
    back.position.set((b.minX + b.maxX) / 2, y, b.minZ - RAIL_WIDTH / 2);
    left.scale.set(d, 1, 1);
    left.rotation.y = Math.PI / 2;
    left.position.set(b.minX - RAIL_WIDTH / 2, y, (b.minZ + b.maxZ) / 2);
    right.scale.set(d, 1, 1);
    right.rotation.y = Math.PI / 2;
    right.position.set(b.maxX + RAIL_WIDTH / 2, y, (b.minZ + b.maxZ) / 2);
  }

  private buildHole(): void {
    const depth = 0.06;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.holeRadius, this.holeRadius * 0.85, depth, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0a0d0a, side: THREE.DoubleSide, roughness: 1 })
    );
    wall.position.y = -depth / 2 + 0.001;
    this.holeGroup.add(wall);

    const bottom = new THREE.Mesh(
      new THREE.CircleGeometry(this.holeRadius * 0.85, 32),
      new THREE.MeshStandardMaterial({ color: 0x05070a })
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -depth + 0.002;
    this.holeGroup.add(bottom);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius, this.holeRadius + 0.012, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.holeGroup.add(ring);
  }

  private buildFlag(): void {
    const poleHeight = 0.42;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.005, poleHeight, 16),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.5, roughness: 0.35 })
    );
    pole.position.y = poleHeight / 2;
    pole.castShadow = true;
    this.holeGroup.add(pole);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.6, roughness: 0.3 })
    );
    knob.position.y = poleHeight;
    this.holeGroup.add(knob);

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
    flag.position.set(0.07, poleHeight - 0.055, 0);
    flag.castShadow = true;
    this.holeGroup.add(flag);
  }

  private buildTargetRing(): void {
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(this.holeRadius + 0.045, this.holeRadius + 0.075, 56),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.005;
    this.holeGroup.add(this.targetRing);
  }

  private buildTeeMarker(): void {
    this.teeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.028, 0.04, 40),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    this.teeRing.rotation.x = -Math.PI / 2;
    this.teeRing.position.y = 0.005;
    this.teeGroup.add(this.teeRing);
  }

  /** Animationen (Fahne wehen, Zielring pulsieren, Drehbalken). */
  update(elapsed: number): void {
    const pos = this.flagBaseGeo.attributes.position as THREE.BufferAttribute;
    const w = 0.14;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const influence = (x + w / 2) / w;
      pos.setZ(i, Math.sin(x * 30 - elapsed * 6) * 0.012 * influence);
    }
    pos.needsUpdate = true;

    const s = 1 + Math.sin(elapsed * 3) * 0.06;
    this.targetRing.scale.set(s, s, s);
    (this.targetRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(elapsed * 3) * 0.2;
    const t = 1 + Math.sin(elapsed * 2 + 1) * 0.05;
    this.teeRing.scale.set(t, t, t);

    for (const o of this.obstacles) o.update(elapsed);
  }
}
