import * as THREE from 'three';

/** Ein Frame der Handverfolgung im Weltkoordinatensystem. */
export interface HandFrame {
  /** true, wenn in diesem Frame eine Hand erkannt wurde. */
  available: boolean;
  /** Weltposition des getrackten Punktes (Schlägerspitze/Zeigefinger). */
  worldPosition: THREE.Vector3;
  /** Geschwindigkeit in m/s im Weltkoordinatensystem. */
  velocity: THREE.Vector3;
}

/** Zustandsmaschine des Spiels. */
export type GamePhase = 'placing' | 'ready' | 'rolling' | 'sunk';

/** Ergebnis der Schlagerkennung. */
export interface SwingResult {
  hit: boolean;
  /** Impuls-Richtung (normalisiert, horizontal) im Course-Koordinatensystem. */
  direction: THREE.Vector3;
  /** Betrag der Handgeschwindigkeit in m/s. */
  speed: number;
}

/** Gemeinsame Schnittstelle für beide Tracking-Backends. */
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
