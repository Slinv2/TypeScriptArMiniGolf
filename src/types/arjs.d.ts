// Minimale Typdeklarationen für die Three.js-Variante von AR.js (threex).
// Es werden nur die Teile beschrieben, die das Spiel tatsächlich nutzt.
declare module '@ar-js-org/ar.js/three.js/build/ar-threex.mjs' {
  import type { Matrix4, Object3D } from 'three';

  export interface ArToolkitContextParameters {
    cameraParametersUrl?: string;
    detectionMode?: 'color' | 'color_and_matrix' | 'mono' | 'mono_and_matrix';
    matrixCodeType?: string;
    maxDetectionRate?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    patternRatio?: number;
    labelingMode?: 'black_region' | 'white_region';
    imageSmoothingEnabled?: boolean;
    debug?: boolean;
  }

  export interface ArController {
    canvas: HTMLCanvasElement;
    artoolkit: Record<string, number>;
    setThresholdMode(mode: number): void;
    setThreshold(value: number): void;
    getCameraMatrix(): Float32Array | number[];
    process(image: CanvasImageSource): void;
    loadMarker(url: string): Promise<number>;
    trackPatternMarkerId(id: number, size?: number): unknown;
    addEventListener(name: string, listener: (event: any) => void): void;
  }

  export class ArToolkitContext {
    constructor(parameters: ArToolkitContextParameters);
    arController: ArController | null;
    initialized: boolean;
    init(onCompleted?: () => void): void;
    update(source: CanvasImageSource): boolean;
    getProjectionMatrix(): Matrix4;
    dispose(): void;
  }

  export interface ArMarkerControlsParameters {
    size?: number;
    type?: 'pattern' | 'barcode' | 'nft' | 'unknown';
    patternUrl?: string;
    barcodeValue?: number;
    changeMatrixMode?: 'modelViewMatrix' | 'cameraTransformMatrix';
    minConfidence?: number;
    smooth?: boolean;
  }

  export class ArMarkerControls {
    constructor(context: ArToolkitContext, object3d: Object3D, parameters: ArMarkerControlsParameters);
    object3d: Object3D;
    dispose(): void;
  }
}
