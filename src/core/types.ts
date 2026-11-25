import * as THREE from 'three';
import type { MarkerId } from '../config';

/** Ein Frame der Handverfolgung im Weltkoordinatensystem. */
export interface HandFrame {
  /** true, wenn in diesem Frame eine Hand erkannt wurde. */
  available: boolean;
  /** Weltposition des getrackten Punktes (Schlägerspitze/Zeigefinger). */
  worldPosition: THREE.Vector3;
  /** Geschwindigkeit in m/s im Weltkoordinatensystem. */
  velocity: THREE.Vector3;
  /** false, wenn der Frame nur der gehaltene letzte Stand ist (kein neues Kamerabild). */
  fresh?: boolean;
}

/** Zustandsmaschine des Spiels. */
export type GamePhase = 'placing' | 'ready' | 'rolling' | 'sunk';

/** Gemeinsame Schnittstelle für alle Hand-Tracking-Backends. */
export interface HandTracker {
  init(): Promise<void>;
  /**
   * Liefert den aktuellen Hand-Frame.
   * @param frame optionaler XRFrame (nur im immersiven Modus).
   */
  update(frame?: XRFrame | null): HandFrame;
  dispose(): void;
}

export function emptyHandFrame(): HandFrame {
  return {
    available: false,
    worldPosition: new THREE.Vector3(),
    velocity: new THREE.Vector3()
  };
}

// ---------------------------------------------------------------------------
// Anker-Abstraktion (Konzept Kap. 5): liefert die Pose des Parcours.
// ---------------------------------------------------------------------------

/** Pose + Layout eines Hindernis-Markers in Course-lokalen Spiel-Koordinaten. */
export interface ObstaclePlacement {
  id: MarkerId;
  x: number;
  z: number;
  /** Drehung um die Hochachse (rad). */
  yaw: number;
  /** Marker wurde mindestens einmal relativ zum Parcours vermessen. */
  known: boolean;
  /** Marker ist im aktuellen Kamerabild sichtbar. */
  visible: boolean;
}

/** Ergebnis eines Anker-Updates. */
export interface AnchorState {
  /** Parcours ist verankert (Start + Ziel wurden gemeinsam erkannt). */
  ready: boolean;
  /** Pose des Parcours (Course-Gruppe) in Weltkoordinaten inkl. Maßstab. */
  courseMatrix: THREE.Matrix4;
  /** Lochposition in Course-lokalen Spiel-Koordinaten (Tee liegt im Ursprung). */
  holeLocal: THREE.Vector3;
  obstacles: ObstaclePlacement[];
  /** Sichtbarkeit je Marker in diesem Frame. */
  visible: Record<MarkerId, boolean>;
  /** Wie viele Sekunden seit der letzten gültigen Messung vergangen sind. */
  staleSeconds: number;
}

/** Gemeinsame Schnittstelle für Platzierungs-Back-ends (Hit-Test, fix, Marker). */
export interface AnchorProvider {
  init(): Promise<void>;
  /**
   * @param lockLayout true, solange der Ball rollt: Loch/Hindernisse
   *                   werden dann nicht verschoben, nur die Pose nachgeführt.
   */
  update(lockLayout: boolean): AnchorState;
  dispose(): void;
}
