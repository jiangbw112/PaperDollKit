import {
  SCHEMA_VERSION,
  validateAssetPack,
  type AssetPackManifest,
} from '@paperdollkit/core';
import {
  buildCreditsFiles,
  encodePngRGBA,
  packZip,
  unpackZip,
} from '@paperdollkit/exporters';
import type { ImportedImage } from '@paperdollkit/importers';

export interface PdkPackEnvelope {
  format: 'paperdollkit-pack-v2';
  schemaVersion: string;
  exportedAt: string;
  pack: AssetPackManifest;
  /** Maps logical imageId -> relative path inside the ZIP (e.g. "images/albedo_atlas.png"). */
  imageFiles: Record<string, string>;
}

function sanitizeImageFilename(raw: string): string {
  const cleaned = raw
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_');
  return cleaned.endsWith('.png') ? cleaned : `${cleaned}.png`;
}

/**
 * Packages the active AssetPackManifest together with all referenced textures
 * (albedo, semantic masks, 2D normal maps), custom palettes, animation events,
 * and CREDITS into a portable `.pdkpack.zip` archive.
 */
export function exportPdkPackZip(
  pack: AssetPackManifest,
  images: Map<string, ImportedImage>,
): { bytes: Uint8Array; filename: string; imageCount: number } {
  const referencedIds = new Set<string>();
  for (const slotParts of Object.values(pack.parts)) {
    for (const part of slotParts) {
      for (const visual of Object.values(part.directions)) {
        for (const f of visual.frames) {
          if (f.imageId) referencedIds.add(f.imageId);
          if (f.maskImageId) referencedIds.add(f.maskImageId);
          if (f.normalImageId) referencedIds.add(f.normalImageId);
        }
        if (visual.actionFrames) {
          for (const seq of Object.values(visual.actionFrames)) {
            for (const f of seq) {
              if (f.imageId) referencedIds.add(f.imageId);
              if (f.maskImageId) referencedIds.add(f.maskImageId);
              if (f.normalImageId) referencedIds.add(f.normalImageId);
            }
          }
        }
      }
    }
  }

  const files: Record<string, Uint8Array | string> = {};
  const imageFiles: Record<string, string> = {};
  const usedNames = new Set<string>();
  let imageCount = 0;

  for (const imageId of referencedIds) {
    const img = images.get(imageId);
    if (!img) continue;
    let base = sanitizeImageFilename(imageId);
    let idx = 1;
    while (usedNames.has(base)) {
      base = sanitizeImageFilename(`${imageId}_${idx++}`);
    }
    usedNames.add(base);
    const relPath = `images/${base}`;
    imageFiles[imageId] = relPath;
    files[relPath] = encodePngRGBA(img.width, img.height, img.data);
    imageCount++;
  }

  const envelope: PdkPackEnvelope = {
    format: 'paperdollkit-pack-v2',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    pack,
    imageFiles,
  };
  files['manifest.json'] = JSON.stringify(envelope, null, 2);

  const credits = buildCreditsFiles(pack);
  files['CREDITS.csv'] = credits.csv;
  files['CREDITS.txt'] = credits.txt;

  const safePackId = (pack.id || 'custom_pack').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return {
    bytes: packZip(files),
    filename: `${safePackId}.pdkpack.zip`,
    imageCount,
  };
}

async function decodePngBytes(bytes: Uint8Array, id: string): Promise<ImportedImage> {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Unable to acquire 2D canvas context for .pdkpack.zip image decoding.');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    id,
    width: imgData.width,
    height: imgData.height,
    data: imgData.data,
  };
}

/**
 * Unpacks and validates a `.pdkpack.zip` archive in the browser, decoding all
 * bundled PNG textures into a ready-to-render `AssetPackManifest` + `Map<string, ImportedImage>`.
 */
export async function importPdkPackZip(
  buffer: ArrayBuffer | Uint8Array,
): Promise<{ pack: AssetPackManifest; images: Map<string, ImportedImage>; imageCount: number }> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = unpackZip(bytes);
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) {
    throw new Error('无效的 .pdkpack.zip：缺少 manifest.json');
  }

  const envelope = JSON.parse(new TextDecoder('utf-8').decode(manifestRaw)) as Partial<PdkPackEnvelope>;
  if (envelope.format !== 'paperdollkit-pack-v2' || !envelope.pack) {
    throw new Error('不支持的压缩包格式：仅支持 paperdollkit-pack-v2 (.pdkpack.zip)');
  }

  const validation = validateAssetPack(envelope.pack);
  if (!validation.ok) {
    throw new Error(`资产包 Schema 校验失败：${validation.errors.slice(0, 2).join('; ')}`);
  }

  const images = new Map<string, ImportedImage>();
  const imageFiles = envelope.imageFiles ?? {};
  let imageCount = 0;

  for (const [imageId, relPath] of Object.entries(imageFiles)) {
    const cleanPath = relPath.replace(/^\/+/, '');
    const pngBytes = entries[cleanPath];
    if (!pngBytes) continue;
    const decoded = await decodePngBytes(pngBytes, imageId);
    images.set(imageId, decoded);
    imageCount++;
  }

  return {
    pack: envelope.pack,
    images,
    imageCount,
  };
}
