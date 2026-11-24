import type { AssetPackManifest, EvaluatedFrame, SlotId } from '@paperdollkit/core';

export interface RenderImageSource {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageLookup {
  get(id: string): RenderImageSource | undefined;
}

export interface PointLight2DOptions {
  enabled: boolean;
  /** Light position in character canvas coordinates (e.g. 0..256). */
  x: number;
  y: number;
  /** Light elevation above the 2D sprite plane in canvas pixels (default 76). */
  z?: number;
  /** Normalized RGB light tint (default [1.0, 0.94, 0.82]). */
  color?: readonly [number, number, number];
  /** Diffuse intensity multiplier (default 1.35). */
  intensity?: number;
  /** Ambient floor illumination (default 0.36). */
  ambient?: number;
}

export type StatusEffectPreset = 'none' | 'frozen' | 'poison' | 'burn' | 'stealth' | 'petrify';

export interface CombatVfxOptions {
  /** Hit-flash blend amount in [0..1] (default 0). */
  flashAmount?: number;
  /** Normalized RGB hit-flash color (default [1, 1, 1]). */
  flashColor?: readonly [number, number, number];
  /** 8-neighbor outer outline width in texels (0 = disabled). */
  outlineWidth?: number;
  /** Normalized RGBA outer outline color (default [0.08, 0.08, 0.12, 1]). */
  outlineColor?: readonly [number, number, number, number];
  /** Combat status filter preset (frozen / poison / burn / stealth / petrify). */
  statusEffect?: StatusEffectPreset;
  /** Status filter blend intensity in [0..1] (default 1.0 when active). */
  statusIntensity?: number;
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
  /** Optional real-time 2D dynamic point light preview using sprite normal maps. */
  light2D?: PointLight2DOptions;
  /** Optional real-time combat VFX (hit flash, 8-neighbor outline, status filters). */
  vfx?: CombatVfxOptions;
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
