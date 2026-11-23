import type { AssetPackManifest, EvaluatedFrame, SlotId } from '@paperdollkit/core';

export interface RenderImageSource {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageLookup {
  get(id: string): RenderImageSource | undefined;
}

export interface RenderFrameOptions {
  /** Clear color RGBA normalized [0..1] (default transparent [0,0,0,0]). */
  clearColor?: readonly [number, number, number, number];
  /** Whether to clear the render target before drawing this frame (default true). Set false for multi-character compositing. */
  clearBeforeRender?: boolean;
  /** Viewport zoom multiplier (default 1). */
  zoom?: number;
  /** Viewport horizontal pan in CSS/canvas pixels (default 0). */
  panX?: number;
  /** Viewport vertical pan in CSS/canvas pixels (default 0). */
  panY?: number;
  /** Visualize RGBA semantic masks instead of recolored output (default false). */
  debugMaskView?: boolean;
  /** Optional slotId to softly highlight in the viewport. */
  highlightSlotId?: SlotId | null;
}

export interface PaperDollRenderer {
  readonly backend: 'webgl2' | 'canvas2d';
  /** Clears the viewport with an optional normalized RGBA color. */
  clear(clearColor?: readonly [number, number, number, number]): void;
  render(
    pack: AssetPackManifest,
    frame: EvaluatedFrame,
    images: ImageLookup,
    opts?: RenderFrameOptions,
  ): void;
  /** Invalidates a specific image texture when an asset is replaced. */
  invalidateImage(imageId: string): void;
  /** Clears all cached GPU/CPU textures (e.g. when switching asset packs). */
  invalidateAll(): void;
  /** Releases GPU resources. */
  dispose(): void;
}
