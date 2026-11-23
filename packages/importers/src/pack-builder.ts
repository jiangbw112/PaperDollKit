import {
  DEFAULT_ARPG_ANIMATIONS,
  DEFAULT_ISOMETRIC_Z_ORDER,
  DEFAULT_PALETTES,
  DEFAULT_SKINS,
  ISOMETRIC_4_DIRECTIONS,
  ISOMETRIC_8_DIRECTIONS,
  SCHEMA_VERSION,
  SIDE_2_DIRECTIONS,
  STANDARD_17_SLOTS,
  type AssetPackManifest,
  type DirectionId,
  type DirectionSpec,
  type PartAsset,
  type SlotDefinition,
  type SlotId,
  type SpriteFrameRef,
} from '@paperdollkit/core';
import { parseLayerPath } from './naming.js';
import { trimTransparentImage } from './trim.js';
import type {
  BuildPackOptions,
  ImportedImage,
  ImportReport,
  ImportResult,
  RawImageEntry,
} from './types.js';

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getDirectionsForPerspective(perspective: BuildPackOptions['perspective']): DirectionSpec[] {
  if (perspective === 'isometric_4') return cloneData(ISOMETRIC_4_DIRECTIONS);
  if (perspective === 'side_2') return cloneData(SIDE_2_DIRECTIONS);
  return cloneData(ISOMETRIC_8_DIRECTIONS);
}

interface PendingAssetFrame {
  slotId: SlotId;
  partId: string;
  partName: string;
  directionId: DirectionId;
  actionId?: string;
  frameIndex: number;
  albedo?: {
    image: ImportedImage;
    frameRef: SpriteFrameRef;
  };
  mask?: {
    image: ImportedImage;
    rect: SpriteFrameRef['sourceRect'];
  };
}

/**
 * Computes the character-relative world origin of a slot on a shared authoring canvas
 * (so PSD layers aligned on a single document canvas preserve their exact pixel positions).
 */
function computeSlotCanvasOrigin(
  slotMap: Map<SlotId, SlotDefinition>,
  slotId: SlotId,
  canvasSize: { width: number; height: number },
): { x: number; y: number } {
  let x = canvasSize.width * 0.5;
  let y = canvasSize.height * 0.875;
  const chain: SlotDefinition[] = [];
  let cur = slotMap.get(slotId);
  while (cur) {
    chain.push(cur);
    cur = cur.parent ? slotMap.get(cur.parent) : undefined;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = chain[i]!;
    x += s.defaultOffset.x;
    y += s.defaultOffset.y;
  }
  return { x, y };
}

/**
 * Builds or updates an AssetPackManifest and image store from raw RGBA image entries
 * (sourced from layered PSD files, PNG uploads, or procedural HD generators).
 */
export function buildAssetPackFromEntries(
  entries: readonly RawImageEntry[],
  opts: BuildPackOptions = {},
): ImportResult {
  const basePack = opts.basePack;
  const perspective = opts.perspective ?? basePack?.perspective ?? 'isometric_8';
  const directions = basePack
    ? cloneData(basePack.directions)
    : getDirectionsForPerspective(perspective);
  const slots = basePack ? cloneData(basePack.slots) : cloneData(STANDARD_17_SLOTS);
  const slotMap = new Map<SlotId, SlotDefinition>(slots.map((s) => [s.id, s]));
  const knownSlotIds = new Set<SlotId>(slots.map((s) => s.id));

  // Determine canonical canvas size from PSD / entries / basePack
  let canvasWidth = basePack?.canvasSize.width ?? 256;
  let canvasHeight = basePack?.canvasSize.height ?? 256;
  for (const e of entries) {
    if (e.canvasSize) {
      canvasWidth = Math.max(canvasWidth, e.canvasSize.width);
      canvasHeight = Math.max(canvasHeight, e.canvasSize.height);
    } else if (!basePack) {
      canvasWidth = Math.max(canvasWidth, e.width);
      canvasHeight = Math.max(canvasHeight, e.height);
    }
  }
  const canvasSize = { width: canvasWidth, height: canvasHeight };

  const images = new Map<string, ImportedImage>(opts.baseImages ?? []);
  const report: ImportReport = {
    importedImages: 0,
    importedParts: 0,
    pairedMasks: 0,
    skippedEmpty: 0,
    unmatchedPaths: [],
    warnings: [],
    canvasSize,
  };

  const defaultDir = opts.defaultDirection ?? directions[0]?.id ?? 'SE';
  const trimEnabled = opts.trimTransparent ?? true;
  const alphaThreshold = opts.alphaThreshold ?? 1;

  const pendingMap = new Map<string, PendingAssetFrame>();

  for (const entry of entries) {
    const parsed = parseLayerPath(entry.path, defaultDir, knownSlotIds);
    const slotId = entry.explicitSlotId ?? parsed.slotId;
    const partId = entry.explicitPartId ?? parsed.partId;
    const partName = entry.explicitPartName ?? parsed.partName;
    const directionId = entry.explicitDirectionId ?? parsed.directionId;
    const isMask = entry.explicitIsMask ?? parsed.isMask;
    const actionId = parsed.actionId;
    const frameIndex = parsed.frameIndex ?? 0;

    if (!slotId || !knownSlotIds.has(slotId)) {
      report.unmatchedPaths.push(entry.path);
      continue;
    }

    const key = `${slotId}::${partId}::${directionId}::${actionId ?? '_base'}::${frameIndex}`;
    let pending = pendingMap.get(key);
    if (!pending) {
      pending = {
        slotId,
        partId,
        partName,
        directionId,
        actionId,
        frameIndex,
      };
      pendingMap.set(key, pending);
    }

    const imageId = `${slotId}/${partId}_${directionId}${actionId ? `_${actionId}_${frameIndex}` : frameIndex > 0 ? `_${frameIndex}` : ''}${isMask ? '_mask' : ''}`;
    const rawImg: ImportedImage = {
      id: imageId,
      width: entry.width,
      height: entry.height,
      data: entry.data,
    };

    const trimRes = trimEnabled
      ? trimTransparentImage(rawImg, alphaThreshold)
      : {
          isEmpty: false,
          trimmed: rawImg,
          sourceRect: { x: 0, y: 0, width: entry.width, height: entry.height },
          trimOffset: { x: 0, y: 0 },
          originalSize: { width: entry.width, height: entry.height },
        };

    if (trimRes.isEmpty) {
      report.skippedEmpty++;
      continue;
    }

    if (isMask) {
      // Keep mask un-trimmed relative to its original image size if we want exact UV alignment with albedo
      // (or store mask directly; during pairing we match albedo trimOffset).
      pending.mask = {
        image: rawImg,
        rect: { x: 0, y: 0, width: rawImg.width, height: rawImg.height },
      };
    } else {
      const slotDef = slotMap.get(slotId)!;
      let pivot = { ...slotDef.defaultPivot };

      // If this entry came from a shared document canvas (like a layered PSD), compute exact pivot
      // so the layer appears at the exact pixel coordinate drawn by the artist.
      if (entry.canvasOffset && entry.canvasSize) {
        const slotOrigin = computeSlotCanvasOrigin(slotMap, slotId, entry.canvasSize);
        const relX = slotOrigin.x - entry.canvasOffset.x;
        const relY = slotOrigin.y - entry.canvasOffset.y;
        pivot = {
          x: entry.width > 0 ? relX / entry.width : 0.5,
          y: entry.height > 0 ? relY / entry.height : 0.5,
        };
      }

      pending.albedo = {
        image: trimRes.trimmed,
        frameRef: {
          imageId: trimRes.trimmed.id,
          sourceRect: trimRes.sourceRect,
          originalSize: trimRes.originalSize,
          trimOffset: trimRes.trimOffset,
          pivot,
        },
      };
    }
  }

  // Group pending frames into PartAsset records
  const partsRecord: Record<SlotId, PartAsset[]> = basePack
    ? cloneData(basePack.parts)
    : {};
  for (const s of slots) {
    if (!partsRecord[s.id]) partsRecord[s.id] = [];
  }

  const touchedParts = new Set<string>();

  for (const pending of pendingMap.values()) {
    if (!pending.albedo) {
      if (pending.mask) {
        report.warnings.push(
          `Found orphan mask for ${pending.slotId}/${pending.partId} (${pending.directionId}) with no matching albedo.`,
        );
      }
      continue;
    }

    const { image: albedoImg, frameRef } = pending.albedo;
    images.set(albedoImg.id, albedoImg);
    report.importedImages++;

    // Pair mask texture if provided, cropping it with the exact same trimOffset as albedo
    if (pending.mask) {
      const maskSrc = pending.mask.image;
      const { trimOffset, sourceRect } = frameRef;
      let maskImg: ImportedImage = maskSrc;
      let maskRect = { x: 0, y: 0, width: maskSrc.width, height: maskSrc.height };

      if (
        maskSrc.width === frameRef.originalSize.width &&
        maskSrc.height === frameRef.originalSize.height &&
        (trimOffset.x > 0 ||
          trimOffset.y > 0 ||
          sourceRect.width !== maskSrc.width ||
          sourceRect.height !== maskSrc.height)
      ) {
        const croppedMask = new Uint8ClampedArray(sourceRect.width * sourceRect.height * 4);
        for (let y = 0; y < sourceRect.height; y++) {
          const srcStart = ((trimOffset.y + y) * maskSrc.width + trimOffset.x) * 4;
          const srcEnd = srcStart + sourceRect.width * 4;
          croppedMask.set(maskSrc.data.subarray(srcStart, srcEnd), y * sourceRect.width * 4);
        }
        maskImg = {
          id: maskSrc.id,
          width: sourceRect.width,
          height: sourceRect.height,
          data: croppedMask,
        };
        maskRect = { x: 0, y: 0, width: sourceRect.width, height: sourceRect.height };
      }

      images.set(maskImg.id, maskImg);
      frameRef.maskImageId = maskImg.id;
      frameRef.maskRect = maskRect;
      report.pairedMasks++;
    }

    const slotList = partsRecord[pending.slotId]!;
    let part = slotList.find((p) => p.id === pending.partId);
    if (!part) {
      const slotDef = slotMap.get(pending.slotId)!;
      part = {
        id: pending.partId,
        name: pending.partName,
        slotId: pending.slotId,
        recolorMode: pending.mask
          ? 'mask_ramp'
          : slotDef.colorable
            ? 'tint'
            : 'none',
        directions: {},
      };
      slotList.push(part);
    } else if (pending.mask) {
      part.recolorMode = 'mask_ramp';
    }

    touchedParts.add(`${pending.slotId}/${pending.partId}`);

    let dirVisual = part.directions[pending.directionId];
    if (!dirVisual) {
      dirVisual = {
        mode: pending.actionId ? 'sequence' : 'rigged',
        frames: [],
      };
      part.directions[pending.directionId] = dirVisual;
    }

    if (pending.actionId) {
      dirVisual.mode = 'sequence';
      if (!dirVisual.actionFrames) dirVisual.actionFrames = {};
      if (!dirVisual.actionFrames[pending.actionId]) dirVisual.actionFrames[pending.actionId] = [];
      dirVisual.actionFrames[pending.actionId]![pending.frameIndex] = frameRef;
      if (dirVisual.frames.length === 0) {
        dirVisual.frames.push(frameRef);
      }
    } else {
      dirVisual.frames[pending.frameIndex] = frameRef;
      if (dirVisual.frames.length > 1) {
        dirVisual.mode = 'sequence';
      }
    }
  }

  // Compact sparse frame arrays & optionally fan out single-direction uploads to all canonical directions
  const canonicalDirs = directions.filter((d) => !d.mirrorFrom).map((d) => d.id);
  for (const partList of Object.values(partsRecord)) {
    for (const part of partList) {
      for (const visual of Object.values(part.directions)) {
        visual.frames = visual.frames.filter(Boolean);
        if (visual.actionFrames) {
          for (const [act, arr] of Object.entries(visual.actionFrames)) {
            visual.actionFrames[act] = arr.filter(Boolean);
          }
        }
      }
      if (opts.duplicateSingleDirection) {
        const authoredDirs = Object.keys(part.directions);
        if (authoredDirs.length === 1) {
          const onlyVisual = part.directions[authoredDirs[0]!]!;
          for (const d of canonicalDirs) {
            if (!part.directions[d]) {
              part.directions[d] = cloneData(onlyVisual);
            }
          }
        }
      }
    }
  }

  report.importedParts = touchedParts.size;

  const zOrder = basePack
    ? cloneData(basePack.zOrder)
    : Object.fromEntries(
        directions.map((d) => [
          d.id,
          DEFAULT_ISOMETRIC_Z_ORDER[d.id] ?? slots.map((s) => s.id),
        ]),
      );

  const pack: AssetPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: opts.packId ?? basePack?.id ?? 'imported-hd-pack',
    name: opts.packName ?? basePack?.name ?? 'Imported HD Paper-Doll Pack',
    canvasSize,
    perspective,
    directions,
    slots,
    zOrder,
    palettes: basePack ? cloneData(basePack.palettes) : cloneData(DEFAULT_PALETTES),
    skins: basePack ? cloneData(basePack.skins) : cloneData(DEFAULT_SKINS),
    parts: partsRecord,
    animations: basePack
      ? cloneData(basePack.animations)
      : cloneData(DEFAULT_ARPG_ANIMATIONS),
    presets: basePack ? cloneData(basePack.presets) : [],
  };

  return { pack, images, report };
}
