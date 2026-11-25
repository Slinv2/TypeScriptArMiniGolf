import { MARKERS, type MarkerId } from '../config';

const PANE_HTML = `
  <div class="hud-status" data-role="status">Willkommen zu AR Minigolf</div>
  <div class="hud-stats" data-role="stats"></div>
  <div class="hud-strokes" data-role="strokes">Schl&auml;ge: 0</div>
  <div class="hud-markers" data-role="markers"></div>
  <div class="hud-debug" data-role="debug"></div>
  <div class="power-meter"><div class="power-fill" data-role="power"></div></div>
`;

export type MarkerChipState = 'unseen' | 'known' | 'visible';

/**
 * Kapselt das DOM-Overlay (Status, Par/Distanz/Score, Schläge, Kraft, Marker).
 * Im Cardboard-Modus wird das HUD für jedes Auge dupliziert.
 */
export class HUD {
  private readonly root: HTMLElement;
  private panes: HTMLElement[] = [];
  private lastStatus = '';
  private readonly cache = new Map<string, string>();

  constructor() {
    this.root = document.getElementById('hud') as HTMLElement;
    this.setStereo(false);
  }

  show(): void {
    this.root.style.display = 'block';
  }

  setStereo(stereo: boolean): void {
    this.root.innerHTML = '';
    this.root.classList.toggle('stereo', stereo);
    this.panes = [];
    for (let i = 0; i < (stereo ? 2 : 1); i++) {
      const pane = document.createElement('div');
      pane.className = 'hud-pane';
      pane.innerHTML = PANE_HTML;
      this.root.appendChild(pane);
      this.panes.push(pane);
    }
    // Inhalte nach dem Neuaufbau wiederherstellen
    const cached = [...this.cache.entries()];
    this.cache.clear();
    for (const [role, html] of cached) this.setHtml(role, html);
    this.lastStatus = '';
  }

  private setHtml(role: string, html: string): void {
    if (this.cache.get(role) === html) return;
    this.cache.set(role, html);
    for (const pane of this.panes) {
      const el = pane.querySelector<HTMLElement>(`[data-role="${role}"]`);
      if (el) el.innerHTML = html;
    }
  }

  setStatus(text: string): void {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.setHtml('status', escapeHtml(text));
    // Pop-Animation neu auslösen
    for (const pane of this.panes) {
      const el = pane.querySelector<HTMLElement>('[data-role="status"]');
      if (!el) continue;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  }

  private strokeCount = 0;

  setStrokes(count: number): void {
    this.strokeCount = count;
    this.setHtml('strokes', `Schl&auml;ge: ${count}`);
  }

  /** Kopfzeile wie im Konzept-Sketch (setStrokes vorher aufrufen): „PAR 2 · DISTANZ 3.5 m · SCORE +1“. */
  setStats(par: number | null, distanceMeters: number | null, score: number | null): void {
    if (par === null) {
      this.setHtml('stats', '');
      return;
    }
    const dist = distanceMeters === null ? '–' : `${distanceMeters.toFixed(distanceMeters < 10 ? 2 : 1)} m`;
    const sc = score === null ? '–' : score === 0 ? 'E' : score > 0 ? `+${score}` : `${score}`;
    this.setHtml(
      'stats',
      `<span>PAR <b>${par}</b></span><span>DISTANZ <b>${dist}</b></span>` +
        `<span class="stereo-only">SCHL&Auml;GE <b>${this.strokeCount}</b></span><span>SCORE <b>${sc}</b></span>`
    );
  }

  setMarkers(states: Record<MarkerId, MarkerChipState> | null): void {
    if (!states) {
      this.setHtml('markers', '');
      return;
    }
    this.setHtml(
      'markers',
      MARKERS.map(
        (m) => `<span class="chip ${states[m.id]}" title="${m.label}">${m.id}<small>${m.label}</small></span>`
      ).join('')
    );
  }

  setDebug(text: string): void {
    this.setHtml('debug', escapeHtml(text));
  }

  /** power im Bereich 0..1. */
  setPower(power: number): void {
    const clamped = Math.max(0, Math.min(1, power));
    for (const pane of this.panes) {
      const el = pane.querySelector<HTMLElement>('[data-role="power"]');
      if (el) el.style.width = `${clamped * 100}%`;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
