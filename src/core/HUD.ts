/** Kapselt das DOM-Overlay (Statustext, Schlagzähler, Kraftbalken). */
export class HUD {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly strokes: HTMLElement;
  private readonly powerFill: HTMLElement;

  constructor() {
    this.root = document.getElementById('hud') as HTMLElement;
    this.status = document.getElementById('hud-status') as HTMLElement;
    this.strokes = document.getElementById('hud-strokes') as HTMLElement;
    this.powerFill = document.getElementById('power-fill') as HTMLElement;
  }

  show(): void {
    this.root.style.display = 'block';
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setStrokes(count: number): void {
    this.strokes.textContent = `Schl\u00e4ge: ${count}`;
  }

  /** power im Bereich 0..1. */
  setPower(power: number): void {
    const clamped = Math.max(0, Math.min(1, power));
    this.powerFill.style.width = `${clamped * 100}%`;
  }
}
