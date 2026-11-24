import {
  LUT_TEXTURE_HEIGHT,
  LUT_TEXTURE_WIDTH,
  SCHEMA_VERSION,
  bakeSlotLUTTexture,
  type AssetPackManifest,
  type PartAsset,
  type SpriteFrameRef,
} from '@paperdollkit/core';
import { encodePngRGBA } from '../codec/png.js';
import { buildCreditsFiles } from '../credits/credits.js';
import type {
  BakeCharacterInput,
  ModularExportData,
  ModularExportOptions,
  ModularManifestJson,
  ModularTextureEntry,
} from '../types.js';

function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_');
  return cleaned.endsWith('.png') ? cleaned : `${cleaned}.png`;
}

function collectFrameImageIds(
  frame: SpriteFrameRef,
  albedoIds: Set<string>,
  maskIds: Set<string>,
): void {
  if (frame.imageId) albedoIds.add(frame.imageId);
  if (frame.maskImageId) maskIds.add(frame.maskImageId);
}

/**
 * Builds an engine-agnostic Mode B Modular Runtime Kit containing:
 * - Source albedo & semantic mask PNG textures
 * - Self-contained `paperdoll_manifest.json` (slots, parts, PartRules, palettes, skins, animations + events, presets)
 * - Optional pre-baked 256×4 RGBA8 LUT PNGs for the default character config
 */
export function buildModularExportData(
  input: BakeCharacterInput,
  opts: ModularExportOptions = {},
): ModularExportData {
  const { pack, config, images } = input;
  const kitName = (opts.kitName ?? pack.id ?? 'paperdoll_modular').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const includeAllParts = opts.includeAllParts ?? true;
  const includePrebakedLuts = opts.includePrebakedLuts ?? true;

  // Select parts to include (full wardrobe or only currently equipped parts)
  const exportedParts: AssetPackManifest['parts'] = {};
  let partCount = 0;

  for (const slot of pack.slots) {
    const slotParts = pack.parts[slot.id] ?? [];
    if (includeAllParts) {
      exportedParts[slot.id] = slotParts;
      partCount += slotParts.length;
    } else {
      const equippedId = config.slots[slot.id];
      const filtered: PartAsset[] = [];
      if (equippedId && equippedId !== 'none') {
        const match = slotParts.find((p) => p.id === equippedId);
        if (match) filtered.push(match);
      }
      // Also include any overrideSlots replacement targets referenced by equipped parts
      for (const s2 of pack.slots) {
        const eq2 = config.slots[s2.id];
        if (!eq2 || eq2 === 'none') continue;
        const p2 = pack.parts[s2.id]?.find((p) => p.id === eq2);
        const overrideTarget = p2?.rules?.overrideSlots?.[slot.id];
        if (overrideTarget && overrideTarget !== 'none' && !filtered.some((f) => f.id === overrideTarget)) {
          const match = slotParts.find((p) => p.id === overrideTarget);
          if (match) filtered.push(match);
        }
      }
      exportedParts[slot.id] = filtered;
      partCount += filtered.length;
    }
  }

  // Collect all unique albedo and mask imageIds referenced by exported parts
  const albedoIds = new Set<string>();
  const maskIds = new Set<string>();
  for (const slotParts of Object.values(exportedParts)) {
    for (const part of slotParts) {
      for (const visual of Object.values(part.directions)) {
        for (const frame of visual.frames) {
          collectFrameImageIds(frame, albedoIds, maskIds);
        }
        if (visual.actionFrames) {
          for (const seq of Object.values(visual.actionFrames)) {
            for (const frame of seq) {
              collectFrameImageIds(frame, albedoIds, maskIds);
            }
          }
        }
      }
    }
  }

  const allImageIds = new Set<string>([...albedoIds, ...maskIds]);
  const usedFilenames = new Set<string>();
  const imageFiles: Record<string, string> = {};
  const textures: ModularTextureEntry[] = [];

  for (const imageId of allImageIds) {
    const img = images.get(imageId);
    if (!img) continue;
    let baseName = sanitizeFilename(imageId);
    let suffix = 1;
    while (usedFilenames.has(baseName)) {
      baseName = sanitizeFilename(`${imageId}_${suffix++}`);
    }
    usedFilenames.add(baseName);

    const isMask = maskIds.has(imageId) && !albedoIds.has(imageId);
    const png = encodePngRGBA(img.width, img.height, img.data);
    imageFiles[imageId] = `textures/${baseName}`;
    textures.push({
      imageId,
      filename: baseName,
      width: img.width,
      height: img.height,
      png,
      isMask,
    });
  }

  // Optional pre-baked 256×4 LUT PNGs for the default character config
  const prebakedLuts: Record<string, Uint8Array> = {};
  if (includePrebakedLuts) {
    const defaultSkin = pack.skins[config.skin] ?? Object.values(pack.skins)[0];
    const defaultPal = Object.values(pack.palettes)[0];
    if (defaultSkin && defaultPal) {
      for (const slot of pack.slots) {
        if (!slot.colorable) continue;
        const pal = pack.palettes[config.palettes[slot.id] ?? ''] ?? defaultPal;
        const lut = bakeSlotLUTTexture(slot.id, pal, defaultSkin, config.handColorBugMode);
        prebakedLuts[`lut_${slot.id}.png`] = encodePngRGBA(
          LUT_TEXTURE_WIDTH,
          LUT_TEXTURE_HEIGHT,
          new Uint8ClampedArray(lut.data),
        );
      }
    }
  }

  let eventCount = 0;
  for (const clip of Object.values(pack.animations)) {
    eventCount += clip.events?.length ?? 0;
  }

  const manifest: ModularManifestJson = {
    format: 'paperdollkit-modular-v2',
    schemaVersion: SCHEMA_VERSION,
    kitName,
    canvasSize: { ...pack.canvasSize },
    footAnchor: {
      x: pack.canvasSize.width * 0.5,
      y: pack.canvasSize.height * 0.875,
    },
    imageFiles,
    directions: pack.directions,
    slots: pack.slots,
    zOrder: pack.zOrder,
    palettes: pack.palettes,
    skins: pack.skins,
    parts: exportedParts,
    animations: pack.animations,
    presets: includeAllParts ? pack.presets : [],
    defaultConfig: {
      ...config,
      slots: { ...config.slots },
      palettes: { ...config.palettes },
      ...(config.hiddenSlots ? { hiddenSlots: [...config.hiddenSlots] } : {}),
    },
  };

  const creditsBundle = buildCreditsFiles(pack, includeAllParts ? undefined : [config]);

  return {
    kitName,
    manifest,
    textures,
    prebakedLuts,
    credits: { csv: creditsBundle.csv, txt: creditsBundle.txt },
    stats: {
      partCount,
      textureCount: textures.length,
      animationCount: Object.keys(pack.animations).length,
      eventCount,
      presetCount: manifest.presets.length,
    },
  };
}
