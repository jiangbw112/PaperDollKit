import type { AssetPackManifest, DirectionId, PerspectivePreset, SlotId } from '@paperdollkit/core';

/** Raw RGBA8 image buffer independent of DOM / HTMLImageElement. */
export interface ImportedImage {
  id: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Input image entry fed into the unified pack builder (from PSD layers, PNG files, or generators). */
export interface RawImageEntry {
  /** Virtual file path or PSD group/layer path (e.g. "SE/torso_top/plate.png"). */
  path: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Optional top-left position on a shared authoring canvas (e.g. PSD layer left/top). */
  canvasOffset?: { x: number; y: number };
  /** Optional shared authoring canvas dimensions (e.g. PSD document width/height). */
  canvasSize?: { width: number; height: number };
  /** Explicit overrides when the user imports directly into a specific slot in Studio. */
  explicitSlotId?: SlotId;
  explicitPartId?: string;
  explicitPartName?: string;
  explicitDirectionId?: DirectionId;
  explicitIsMask?: boolean;
}

export interface ParsedLayerMeta {
  slotId: SlotId | null;
  partId: string;
  partName: string;
  directionId: DirectionId;
  actionId?: string;
  frameIndex?: number;
  isMask: boolean;
}

export interface BuildPackOptions {
  packId?: string;
  packName?: string;
  perspective?: PerspectivePreset;
  /** Existing manifest to merge imported parts into (preserves existing parts & presets). */
  basePack?: AssetPackManifest;
  /** Existing images map to preserve when merging into basePack. */
  baseImages?: Map<string, ImportedImage>;
  /** Default direction assigned when filename/group does not specify one (default: 'SE'). */
  defaultDirection?: DirectionId;
  /** Trim fully transparent borders around imported images (default: true). */
  trimTransparent?: boolean;
  /** Alpha cutoff for trimming (default: 1). */
  alphaThreshold?: number;
  /** Copy a single imported direction to all canonical directions if only 1 direction was supplied. */
  duplicateSingleDirection?: boolean;
}

export interface ImportReport {
  importedImages: number;
  importedParts: number;
  pairedMasks: number;
  skippedEmpty: number;
  unmatchedPaths: string[];
  warnings: string[];
  canvasSize: { width: number; height: number };
}

export interface ImportResult {
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
  report: ImportReport;
}
