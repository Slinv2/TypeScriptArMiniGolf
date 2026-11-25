import * as THREE from 'three';
import type { CameraFrameSource } from '../tracking/CameraFrameSource';
import { settings } from '../config';

const DISTORTION_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Barrel-Vorverzerrung: gleicht die kissenförmige Verzerrung der Cardboard-Linsen aus.
const DISTORTION_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float k1;
  uniform float k2;
  uniform float aspect;
  uniform float shift;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p.x -= shift;
    vec2 q = vec2(p.x * aspect, p.y);
    float r2 = dot(q, q) / (aspect * aspect + 1.0);
    float f = (1.0 + k1 * r2 + k2 * r2 * r2) / (1.0 + 0.35 * k1);
    vec2 uv = p * f * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      gl_FragColor = texture2D(tDiffuse, uv);
    }
    #include <colorspace_fragment>
  }
`;

/**
 * Rendert die AR-Ansicht für den Marker-Modus:
 *  - Kamerabild als Hintergrund (WebGL-Quad, exakt passend zur AR-Projektion)
 *  - 3D-Szene mit der Projektionsmatrix der AR-Kamera
 *  - optional Cardboard-Splitscreen (zwei Augenbilder, Linsenverzerrung)
 *
 * Das Kamerabild ist monoskopisch; beide Augen erhalten daher dasselbe Bild
 * (biokulare Darstellung) – so bleibt die virtuelle Bahn exakt auf dem Marker.
 */
export class ArView {
  /** Kamera mit der Projektion des vollen AR-Frames (für Raycasts der Hand). */
  readonly arCamera = new THREE.PerspectiveCamera();
  /** Kamera mit der Projektion des sichtbaren Ausschnitts (zum Rendern). */
  readonly renderCamera = new THREE.PerspectiveCamera();

  private stereo = false;
  private readonly bgScene = new THREE.Scene();
  private readonly bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly videoTexture: THREE.VideoTexture;
  private readonly bgMaterial: THREE.MeshBasicMaterial;

  private readonly eyeTarget: THREE.WebGLRenderTarget;
  private readonly distortScene = new THREE.Scene();
  private readonly distortMaterial: THREE.ShaderMaterial;
  private readonly crop = new THREE.Matrix4();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly source: CameraFrameSource,
    projection: THREE.Matrix4
  ) {
    for (const cam of [this.arCamera, this.renderCamera]) {
      cam.matrixAutoUpdate = false;
      cam.matrix.identity();
      cam.updateMatrixWorld(true);
    }
    this.arCamera.projectionMatrix.copy(projection);
    this.arCamera.projectionMatrixInverse.copy(projection).invert();

    this.videoTexture = new THREE.VideoTexture(source.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.generateMipmaps = false;
    this.bgMaterial = new THREE.MeshBasicMaterial({ map: this.videoTexture, toneMapped: false, depthTest: false, depthWrite: false });
    this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMaterial));

    this.eyeTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.eyeTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.distortMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.eyeTarget.texture },
        k1: { value: 0 },
        k2: { value: 0 },
        aspect: { value: 1 },
        shift: { value: 0 }
      },
      vertexShader: DISTORTION_VERT,
      fragmentShader: DISTORTION_FRAG,
      depthTest: false,
      depthWrite: false
    });
    this.distortScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.distortMaterial));
  }

  get isStereo(): boolean {
    return this.stereo;
  }

  setStereo(on: boolean): void {
    this.stereo = on;
  }

  /** Passt Hintergrund-Ausschnitt und Render-Projektion an ein Seitenverhältnis an. */
  private fitTo(viewAspect: number, zoom: number): void {
    const frameAspect = this.source.width / this.source.height;
    let fx: number;
    let fy: number;
    if (viewAspect > frameAspect) {
      fx = 1;
      fy = frameAspect / viewAspect;
    } else {
      fx = viewAspect / frameAspect;
      fy = 1;
    }
    fx /= zoom;
    fy /= zoom;

    // Hintergrund: Ausschnitt des Videos, der dem sichtbaren Teil des AR-Frames entspricht
    const c = this.source.crop;
    const u0 = c.x;
    const v0 = 1 - c.y - c.h; // Videotextur ist vertikal gespiegelt (flipY)
    this.videoTexture.repeat.set(c.w * fx, c.h * fy);
    this.videoTexture.offset.set(u0 + (c.w * (1 - fx)) / 2, v0 + (c.h * (1 - fy)) / 2);

    // Projektion: zentrierter Zoom auf denselben Ausschnitt
    this.crop.makeScale(1 / fx, 1 / fy, 1);
    this.renderCamera.projectionMatrix.multiplyMatrices(this.crop, this.arCamera.projectionMatrix);
    this.renderCamera.projectionMatrixInverse.copy(this.renderCamera.projectionMatrix).invert();
  }

  private renderEye(target: THREE.WebGLRenderTarget | null): void {
    const r = this.renderer;
    r.setRenderTarget(target);
    r.clear();
    r.render(this.bgScene, this.bgCamera);
    r.clearDepth();
    r.render(this.scene, this.renderCamera);
  }

  render(): void {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const dpr = r.getPixelRatio();
    r.autoClear = false;

    if (!this.stereo) {
      this.fitTo(size.x / size.y, 1);
      r.setViewport(0, 0, size.x, size.y);
      this.renderEye(null);
      return;
    }

    // Cardboard: einmal ins Augen-Rendertarget rendern, dann verzerrt in beide Hälften
    const eyeW = size.x / 2;
    const eyeAspect = eyeW / size.y;
    const tw = Math.round(eyeW * dpr);
    const th = Math.round(size.y * dpr);
    if (this.eyeTarget.width !== tw || this.eyeTarget.height !== th) this.eyeTarget.setSize(tw, th);
    this.fitTo(eyeAspect, settings.cardboardZoom);
    this.renderEye(this.eyeTarget);

    const k = settings.lensDistortion;
    const u = this.distortMaterial.uniforms;
    u.k1.value = k;
    u.k2.value = k * k * 0.6;
    u.aspect.value = eyeAspect;

    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.clear();
    for (let eye = 0; eye < 2; eye++) {
      // shift > 0 schiebt das Bild zur Bildschirmmitte
      u.shift.value = (eye === 0 ? 1 : -1) * settings.lensOffset;
      r.setViewport(eye * eyeW, 0, eyeW, size.y);
      r.render(this.distortScene, this.bgCamera);
    }
    r.setViewport(0, 0, size.x, size.y);
  }

  dispose(): void {
    this.videoTexture.dispose();
    this.eyeTarget.dispose();
  }
}
