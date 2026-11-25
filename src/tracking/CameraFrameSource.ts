/**
 * Gemeinsame Kameraquelle für Marker- und Handtracking.
 *
 * Konzept: AR.js und MediaPipe werten DASSELBE Kamerabild aus. Dafür wird
 * jeder neue Videoframe einmal in ein 4:3-Canvas (640×480) kopiert – zentrierter
 * Ausschnitt, damit er zur Kalibrierung camera_para.dat (640×480) passt und
 * die Pixel quadratisch bleiben. Beide Tracker lesen dieses Canvas.
 */
export class CameraFrameSource {
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private lastTime = -1;
  private frameCounter = 0;

  /** Ausschnitt des Videos (normiert 0..1), der dem AR-Frame entspricht. */
  readonly crop = { x: 0, y: 0, w: 1, h: 1 };
  /** true, wenn die Kamera zum Nutzer zeigt (Selfie/Laptop-Webcam). */
  facingUser = false;

  constructor(
    video: HTMLVideoElement,
    readonly width = 640,
    readonly height = 480
  ) {
    this.video = video;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D-Canvas nicht verfügbar');
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: 30 }
        },
        audio: false
      },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false }
    ];
    let lastError: unknown = null;
    for (const c of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!this.stream) throw lastError ?? new Error('Keine Kamera');

    const track = this.stream.getVideoTracks()[0];
    const s = track?.getSettings?.() ?? {};
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.facingUser = s.facingMode === 'user' || (!s.facingMode && !isTouch);

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await new Promise<void>((resolve) => {
      if (this.video.videoWidth > 0) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    this.updateCrop();
  }

  private updateCrop(): void {
    const vw = this.video.videoWidth || this.width;
    const vh = this.video.videoHeight || this.height;
    const target = this.width / this.height;
    const actual = vw / vh;
    if (actual > target) {
      // Video breiter als 4:3 → links/rechts abschneiden
      const w = target / actual;
      Object.assign(this.crop, { x: (1 - w) / 2, y: 0, w, h: 1 });
    } else {
      const h = actual / target;
      Object.assign(this.crop, { x: 0, y: (1 - h) / 2, w: 1, h });
    }
  }

  /**
   * Kopiert einen neuen Videoframe ins AR-Canvas.
   * @returns true, wenn ein neuer Frame vorliegt.
   */
  grab(): boolean {
    if (this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastTime) return false;
    this.lastTime = this.video.currentTime;
    if (this.frameCounter++ % 30 === 0) this.updateCrop(); // Rotation des Handys
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    this.ctx.drawImage(
      this.video,
      this.crop.x * vw,
      this.crop.y * vh,
      this.crop.w * vw,
      this.crop.h * vh,
      0,
      0,
      this.width,
      this.height
    );
    return true;
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
