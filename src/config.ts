/**
 * Zentrale Konfiguration + vom Spieler änderbare Einstellungen (localStorage).
 */

/** IDs der gedruckten Marker (siehe public/markers/*.pdf). */
export type MarkerId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type ObstacleKind = 'wall' | 'bumper' | 'spinner';

export interface MarkerDef {
  id: MarkerId;
  role: 'tee' | 'hole' | 'obstacle';
  label: string;
  /** Nur für Hindernis-Marker: welches virtuelle Hindernis darauf steht. */
  obstacle?: { kind: ObstacleKind; length: number; thickness: number; color: number };
}

/**
 * Marker-Belegung laut Konzept:
 * A = Tee/Ursprung, B = Loch, C…F = Hindernisse.
 * Maße der Hindernisse in Spiel-Metern (bei 16-cm-Markern = echte Meter).
 */
export const MARKERS: MarkerDef[] = [
  { id: 'A', role: 'tee', label: 'Start' },
  { id: 'B', role: 'hole', label: 'Ziel' },
  { id: 'C', role: 'obstacle', label: 'Wand', obstacle: { kind: 'wall', length: 0.32, thickness: 0.05, color: 0x4cc9f0 } },
  { id: 'D', role: 'obstacle', label: 'Bumper', obstacle: { kind: 'bumper', length: 0.075, thickness: 0, color: 0x9b5de5 } },
  { id: 'E', role: 'obstacle', label: 'Wand lang', obstacle: { kind: 'wall', length: 0.5, thickness: 0.05, color: 0xf72585 } },
  { id: 'F', role: 'obstacle', label: 'Drehbalken', obstacle: { kind: 'spinner', length: 0.36, thickness: 0.035, color: 0xffd23f } }
];

/** Referenzgröße: bei dieser Markergröße entspricht 1 Spiel-Meter 1 echtem Meter. */
export const REFERENCE_MARKER_CM = 16;

export type HandPoint = 'wrist' | 'index' | 'palm';

export interface Settings {
  /** Außenkante des schwarzen Marker-Rahmens in cm (so wie gedruckt). */
  markerSizeCm: number;
  /** Barrel-Vorverzerrung für Cardboard-Linsen (0 = aus). */
  lensDistortion: number;
  /** Verschiebung der Augenbilder zur Mitte (+) bzw. nach außen (−), Anteil der Halbbildbreite. */
  lensOffset: number;
  /** Bildausschnitt im Cardboard (1 = ganzes Kamerabild in der Höhe, >1 = Zoom). */
  cardboardZoom: number;
  /** Welcher Hand-Landmark als Putter dient. */
  handPoint: HandPoint;
  /** Kamerabild spiegeln: auto = bei Frontkamera / Laptop-Webcam. */
  mirror: 'auto' | 'on' | 'off';
  /** Faktor auf die Schlagstärke (Hand → Ball). */
  swingPower: number;
  /** Debug-Overlay (FPS, Marker-Erkennung). */
  debug: boolean;
}

const DEFAULTS: Settings = {
  markerSizeCm: 16,
  lensDistortion: 0.22,
  lensOffset: 0,
  cardboardZoom: 1,
  handPoint: 'index',
  mirror: 'auto',
  swingPower: 1,
  debug: false
};

const STORAGE_KEY = 'ar-minigolf-settings-v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* localStorage nicht verfügbar → Defaults */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

// URL-Parameter überschreiben (praktisch zum Testen): ?marker=8&debug=1
(() => {
  const q = new URLSearchParams(location.search);
  const m = Number(q.get('marker'));
  if (m > 0) settings.markerSizeCm = m;
  if (q.get('debug') === '1') settings.debug = true;
})();

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignorieren */
  }
}

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}

/** Maßstab Spielwelt → echte Welt (Tisch-Marker = kleinerer Parcours). */
export function worldScale(): number {
  return settings.markerSizeCm / REFERENCE_MARKER_CM;
}

/** Pfad zu statischen Assets (respektiert Vite-base). */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
