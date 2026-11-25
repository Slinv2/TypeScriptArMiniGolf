import * as THREE from 'three';
import type { ArToolkitContext } from '@ar-js-org/ar.js/three.js/build/ar-threex.mjs';
import { MARKERS, asset, settings, worldScale, type MarkerId } from '../config';
import type { AnchorProvider, AnchorState, ObstaclePlacement } from '../core/types';
import type { CameraFrameSource } from './CameraFrameSource';

const POS_SMOOTH = 0.55; // Anteil der neuen Messung pro Frame (Kamera-Raum)
const SNAP_DISTANCE = 0.15; // m – größere Sprünge (Kopfdrehung) sofort übernehmen
const SNAP_ANGLE = THREE.MathUtils.degToRad(20);
const LAYOUT_SMOOTH = 0.35; // Glättung von Loch-/Hindernis-Positionen
const MIN_CONFIDENCE = 0.62; // Mindest-Konfidenz der Pattern-Erkennung
const PATTERN_MARKER = 0; // artoolkit5-js: ARToolkit.PATTERN_MARKER

interface ArMarkerEvent {
  data: {
    type: number;
    marker: { idPatt: number; cfPatt: number };
    matrix: ArrayLike<number>;
  };
}

const MIN_COURSE_LENGTH = 0.3; // m – Start und Ziel müssen mindestens so weit auseinander liegen

interface MarkerSlot {
  id: MarkerId;
  object: THREE.Object3D;
  /** Pose des Markers relativ zum Parcours (Meter, unskaliert). */
  rel: THREE.Matrix4 | null;
}

/**
 * Verankerung des Parcours über gedruckte AR.js-Pattern-Marker.
 *
 * - Marker A (Start) = Ursprung des Course-Koordinatensystems.
 * - Marker B (Ziel)  = Lochposition; legt Länge und Richtung der Bahn fest.
 * - Marker C…F       = Hindernisse, frei verschiebbar.
 *
 * Multi-Marker-Verbund: Jeder Marker, dessen Lage relativ zum Parcours einmal
 * vermessen wurde, kann die Pose des Parcours schätzen. Sichtbare Marker werden
 * gemittelt; ist kein Marker sichtbar, bleibt die letzte gültige Pose erhalten.
 */
export class ArjsMarkerAnchor implements AnchorProvider {
  private context: ArToolkitContext | null = null;
  private readonly slots = new Map<MarkerId, MarkerSlot>();
  /** Projektionsmatrix der AR-Kamera für den vollen 4:3-AR-Frame. */
  readonly projection = new THREE.Matrix4();

  private ready = false;
  private hasPose = false;
  private readonly camFromCourse = new THREE.Matrix4(); // geglättet, Meter
  private courseLength = 1; // m
  private lastSeen = 0;
  private readonly obstacles = new Map<MarkerId, ObstaclePlacement>();
  private readonly visible = {} as Record<MarkerId, boolean>;

  // Wiederverwendete Temporärobjekte
  private readonly tPos = new THREE.Vector3();
  private readonly tQuat = new THREE.Quaternion();
  private readonly tScale = new THREE.Vector3();
  private readonly tMat = new THREE.Matrix4();
  private readonly tInv = new THREE.Matrix4();

  constructor(private readonly source: CameraFrameSource) {
    for (const m of MARKERS) this.visible[m.id] = false;
  }

  async init(): Promise<void> {
    // AR.js wird erst hier geladen (1,6 MB inkl. WASM) – andere Modi zahlen nichts.
    const { ArToolkitContext } = await import('@ar-js-org/ar.js/three.js/build/ar-threex.mjs');
    const context = new ArToolkitContext({
      cameraParametersUrl: asset('arjs/camera_para.dat'),
      detectionMode: 'mono',
      canvasWidth: this.source.width,
      canvasHeight: this.source.height,
      maxDetectionRate: 60,
      patternRatio: 0.5
    });
    await new Promise<void>((resolve) => context.init(() => resolve()));
    this.context = context;
    if (import.meta.env.DEV) (window as unknown as { __anchor: unknown }).__anchor = this;

    const ctrl = context.arController;
    if (!ctrl) throw new Error('ARController not initialized');
    // Automatische Schwelle → robuster bei wechselndem Licht
    const otsu = ctrl.artoolkit?.AR_LABELING_THRESH_MODE_AUTO_OTSU;
    if (typeof otsu === 'number') ctrl.setThresholdMode(otsu);

    this.projection.copy(context.getProjectionMatrix());
    // ARToolKit liefert near≈0.0001 → schlechte Tiefenauflösung. Near/Far neu setzen.
    const near = 0.01;
    const far = 50;
    const e = this.projection.elements;
    e[10] = -(far + near) / (far - near);
    e[14] = (-2 * far * near) / (far - near);

    // Pattern-Dateien NACHEINANDER laden: paralleles Laden (wie es
    // ArMarkerControls macht) vergibt in artoolkit5-js teils dieselbe ID.
    // ARToolKits ICP-Initialisierung scheitert bei sehr kleinen Zahlen (Meter):
    // daher in "Marker-Einheiten" (Größe 1) rechnen und erst danach skalieren.
    this.sizeMeters = settings.markerSizeCm / 100;
    for (const def of MARKERS) {
      const pattId = await ctrl.loadMarker(asset(`markers/marker-${def.id}.patt`));
      ctrl.trackPatternMarkerId(pattId, 1);
      const object = new THREE.Object3D();
      object.matrixAutoUpdate = false;
      object.visible = false;
      this.slots.set(def.id, { id: def.id, object, rel: null });
      this.byPattId.set(pattId, def.id);
    }

    ctrl.addEventListener('getMarker', (ev) => this.onGetMarker(ev));
  }

  private sizeMeters = 0.16;
  private readonly byPattId = new Map<number, MarkerId>();
  private readonly bestConfidence = new Map<MarkerId, number>();
  /** ARToolKit → three.js-Achsen (wie AR.js): Kamera um 180° um Z und Y. */
  private readonly axisFix = new THREE.Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI));
  /** Marker-Normale als +Y (AR.js-Konvention) statt +Z (ARToolKit). */
  private readonly markerAxis = new THREE.Matrix4().makeRotationX(Math.PI / 2);

  private onGetMarker(ev: ArMarkerEvent): void {
    const { data } = ev;
    if (data.type !== PATTERN_MARKER) return;
    const id = this.byPattId.get(data.marker.idPatt);
    if (!id || data.marker.cfPatt < MIN_CONFIDENCE) return;
    // Bei Doppel-Erkennung im selben Frame gewinnt die höhere Konfidenz
    const best = this.bestConfidence.get(id) ?? -1;
    if (data.marker.cfPatt <= best) return;
    this.bestConfidence.set(id, data.marker.cfPatt);

    const slot = this.slots.get(id)!;
    const m = slot.object.matrix;
    m.fromArray(Array.from(data.matrix));
    m.premultiply(this.axisFix).multiply(this.markerAxis);
    m.elements[12] *= this.sizeMeters;
    m.elements[13] *= this.sizeMeters;
    m.elements[14] *= this.sizeMeters;
    slot.object.visible = true;
  }

  /** Neuen Kameraframe (aus CameraFrameSource.canvas) auswerten. */
  processFrame(): void {
    const ctrl = this.context?.arController;
    if (!ctrl) return;
    for (const slot of this.slots.values()) slot.object.visible = false;
    this.bestConfidence.clear();
    ctrl.process(this.source.canvas);
  }

  update(lockLayout: boolean): AnchorState {
    const now = performance.now() / 1000;
    for (const slot of this.slots.values()) this.visible[slot.id] = slot.object.visible;

    const a = this.slots.get('A')!;
    const b = this.slots.get('B')!;
    let measured: THREE.Matrix4 | null = null;
    let usedAnchors = false;

    if (a.object.visible && b.object.visible) {
      const direct = this.frameFromStartAndGoal(a.object.matrix, b.object.matrix);
      if (direct) {
        measured = direct.matrix;
        usedAnchors = true;
        if (!lockLayout || !this.ready) {
          this.courseLength = this.ready
            ? THREE.MathUtils.lerp(this.courseLength, direct.length, LAYOUT_SMOOTH)
            : direct.length;
        }
        // Relative Lage von A und B lernen (für spätere Einzel-Sichtungen)
        this.tInv.copy(direct.matrix).invert();
        a.rel = new THREE.Matrix4().multiplyMatrices(this.tInv, a.object.matrix);
        b.rel = new THREE.Matrix4().multiplyMatrices(this.tInv, b.object.matrix);
        this.ready = true;
      }
    }

    if (!measured && this.ready) {
      // Pose aus allen sichtbaren, bereits vermessenen Markern schätzen.
      // Start/Ziel haben Vorrang; Hindernisse nur, wenn beide fehlen
      // (Hindernisse dürfen verschoben werden und sind daher unsicherer).
      const primary = [a, b].filter((s) => s.object.visible && s.rel);
      const candidates = primary.length
        ? primary
        : [...this.slots.values()].filter((s) => s.id !== 'A' && s.id !== 'B' && s.object.visible && s.rel);
      usedAnchors = primary.length > 0;
      if (candidates.length) measured = this.average(candidates);
    }

    if (measured) {
      this.smoothInto(measured);
      this.lastSeen = now;
    }

    if (this.ready && this.hasPose && usedAnchors) this.updateObstacles(lockLayout);

    // Für Hindernisse, die nicht sichtbar sind: Sichtbarkeit aktualisieren
    for (const o of this.obstacles.values()) o.visible = this.visible[o.id];

    const s = worldScale();
    const courseMatrix = new THREE.Matrix4()
      .copy(this.camFromCourse)
      .multiply(this.tMat.makeScale(s, s, s));

    return {
      ready: this.ready && this.hasPose,
      courseMatrix,
      holeLocal: new THREE.Vector3(0, 0, -this.courseLength / s),
      obstacles: [...this.obstacles.values()],
      visible: { ...this.visible },
      staleSeconds: this.lastSeen ? now - this.lastSeen : Infinity
    };
  }

  /** Course-Frame aus Start- und Zielmarker: Ursprung A, −Z zeigt zum Loch, Y = Bodennormale. */
  private frameFromStartAndGoal(
    ma: THREE.Matrix4,
    mb: THREE.Matrix4
  ): { matrix: THREE.Matrix4; length: number } | null {
    const pa = new THREE.Vector3().setFromMatrixPosition(ma);
    const pb = new THREE.Vector3().setFromMatrixPosition(mb);
    const ya = new THREE.Vector3().setFromMatrixColumn(ma, 1).normalize();
    const yb = new THREE.Vector3().setFromMatrixColumn(mb, 1).normalize();
    const up = ya.add(yb).normalize();
    const fwd = pb.sub(pa);
    fwd.addScaledVector(up, -fwd.dot(up));
    const length = fwd.length();
    if (length < MIN_COURSE_LENGTH) return null;
    const z = fwd.multiplyScalar(-1 / length);
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const matrix = new THREE.Matrix4().makeBasis(x, up, z).setPosition(pa);
    return { matrix, length };
  }

  /** Mittelt die Parcours-Pose aus mehreren Markern (Position + Quaternion). */
  private average(slots: MarkerSlot[]): THREE.Matrix4 {
    const pos = new THREE.Vector3();
    const acc = new THREE.Vector4();
    let ref: THREE.Quaternion | null = null;
    for (const s of slots) {
      this.tInv.copy(s.rel!).invert();
      this.tMat.multiplyMatrices(s.object.matrix, this.tInv);
      this.tMat.decompose(this.tPos, this.tQuat, this.tScale);
      pos.add(this.tPos);
      if (!ref) ref = this.tQuat.clone();
      const sign = ref.dot(this.tQuat) < 0 ? -1 : 1;
      acc.x += this.tQuat.x * sign;
      acc.y += this.tQuat.y * sign;
      acc.z += this.tQuat.z * sign;
      acc.w += this.tQuat.w * sign;
    }
    pos.divideScalar(slots.length);
    const q = new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w).normalize();
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  }

  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();

  private smoothInto(target: THREE.Matrix4): void {
    target.decompose(this.tPos, this.tQuat, this.tScale);
    if (!this.hasPose) {
      this.curPos.copy(this.tPos);
      this.curQuat.copy(this.tQuat);
      this.hasPose = true;
    } else {
      const jump = this.curPos.distanceTo(this.tPos) > SNAP_DISTANCE || this.curQuat.angleTo(this.tQuat) > SNAP_ANGLE;
      const alpha = jump ? 1 : POS_SMOOTH;
      this.curPos.lerp(this.tPos, alpha);
      this.curQuat.slerp(this.tQuat, alpha);
    }
    this.camFromCourse.compose(this.curPos, this.curQuat, new THREE.Vector3(1, 1, 1));
  }

  /** Hindernis-Marker relativ zum Parcours vermessen (nur bei sicherer Pose). */
  private updateObstacles(lockLayout: boolean): void {
    const s = worldScale();
    this.tInv.copy(this.camFromCourse).invert();
    for (const def of MARKERS) {
      if (def.role !== 'obstacle') continue;
      const slot = this.slots.get(def.id)!;
      if (!slot.object.visible) continue;
      const rel = new THREE.Matrix4().multiplyMatrices(this.tInv, slot.object.matrix);
      slot.rel = rel;
      if (lockLayout && this.obstacles.has(def.id)) continue;

      const p = new THREE.Vector3().setFromMatrixPosition(rel).divideScalar(s);
      const xAxis = new THREE.Vector3().setFromMatrixColumn(rel, 0);
      const yaw = Math.atan2(-xAxis.z, xAxis.x);
      const existing = this.obstacles.get(def.id);
      if (!existing) {
        this.obstacles.set(def.id, { id: def.id, x: p.x, z: p.z, yaw, known: true, visible: true });
      } else {
        existing.x = THREE.MathUtils.lerp(existing.x, p.x, LAYOUT_SMOOTH);
        existing.z = THREE.MathUtils.lerp(existing.z, p.z, LAYOUT_SMOOTH);
        let d = yaw - existing.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        existing.yaw += d * LAYOUT_SMOOTH;
      }
    }
  }

  dispose(): void {
    this.context?.dispose();
    this.context = null;
  }
}
