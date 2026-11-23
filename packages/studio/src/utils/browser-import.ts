import type { AssetPackManifest, DirectionId, SlotId } from '@paperdollkit/core';
import {
  buildAssetPackFromEntries,
  importPsdBuffer,
  type ImportResult,
  type ImportedImage,
  type RawImageEntry,
} from '@paperdollkit/importers';

/** Decodes a browser image File (PNG/WebP/JPG) into raw RGBA8 pixels. */
export async function decodeImageFile(file: File): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D context for image decoding.');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    width: imgData.width,
    height: imgData.height,
    data: imgData.data,
  };
}

export interface ExplicitSlotImportTarget {
  slotId: SlotId;
  partId?: string;
  partName?: string;
  directionId?: DirectionId;
  isMask?: boolean;
}

/**
 * Imports dropped/selected `.psd` or `.png`/`.webp` files and merges them into
 * the active AssetPackManifest and image store.
 */
export async function importBrowserFiles(
  files: readonly File[],
  basePack: AssetPackManifest,
  baseImages: Map<string, ImportedImage>,
  explicitTarget?: ExplicitSlotImportTarget,
): Promise<ImportResult> {
  let currentPack = basePack;
  let currentImages = new Map(baseImages);

  const psdFiles = files.filter((f) => /\.psd$/i.test(f.name));
  const imageFiles = files.filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f.name));

  let aggregateReport: ImportResult['report'] = {
    importedImages: 0,
    importedParts: 0,
    pairedMasks: 0,
    skippedEmpty: 0,
    unmatchedPaths: [],
    warnings: [],
    canvasSize: currentPack.canvasSize,
  };

  for (const psdFile of psdFiles) {
    const buf = await psdFile.arrayBuffer();
    const res = importPsdBuffer(buf, {
      basePack: currentPack,
      baseImages: currentImages,
      defaultDirection: explicitTarget?.directionId ?? 'SE',
      duplicateSingleDirection: true,
    });
    currentPack = res.pack;
    currentImages = res.images;
    aggregateReport = {
      importedImages: aggregateReport.importedImages + res.report.importedImages,
      importedParts: aggregateReport.importedParts + res.report.importedParts,
      pairedMasks: aggregateReport.pairedMasks + res.report.pairedMasks,
      skippedEmpty: aggregateReport.skippedEmpty + res.report.skippedEmpty,
      unmatchedPaths: [...aggregateReport.unmatchedPaths, ...res.report.unmatchedPaths],
      warnings: [...aggregateReport.warnings, ...res.report.warnings],
      canvasSize: res.report.canvasSize,
    };
  }

  if (imageFiles.length > 0) {
    const entries: RawImageEntry[] = [];
    for (const file of imageFiles) {
      const decoded = await decodeImageFile(file);
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      entries.push({
        path: relPath,
        width: decoded.width,
        height: decoded.height,
        data: decoded.data,
        explicitSlotId: explicitTarget?.slotId,
        explicitPartId: explicitTarget?.partId,
        explicitPartName: explicitTarget?.partName,
        explicitDirectionId: explicitTarget?.directionId,
        explicitIsMask: explicitTarget?.isMask,
      });
    }

    const res = buildAssetPackFromEntries(entries, {
      basePack: currentPack,
      baseImages: currentImages,
      defaultDirection: explicitTarget?.directionId ?? 'SE',
      duplicateSingleDirection: true,
    });
    currentPack = res.pack;
    currentImages = res.images;
    aggregateReport = {
      importedImages: aggregateReport.importedImages + res.report.importedImages,
      importedParts: aggregateReport.importedParts + res.report.importedParts,
      pairedMasks: aggregateReport.pairedMasks + res.report.pairedMasks,
      skippedEmpty: aggregateReport.skippedEmpty + res.report.skippedEmpty,
      unmatchedPaths: [...aggregateReport.unmatchedPaths, ...res.report.unmatchedPaths],
      warnings: [...aggregateReport.warnings, ...res.report.warnings],
      canvasSize: res.report.canvasSize,
    };
  }

  return {
    pack: currentPack,
    images: currentImages,
    report: aggregateReport,
  };
}

export function downloadTextFile(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
