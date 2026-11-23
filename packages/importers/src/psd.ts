import { initializeCanvas, readPsd, type Layer } from 'ag-psd';
import { buildAssetPackFromEntries } from './pack-builder.js';
import type { BuildPackOptions, ImportResult, RawImageEntry } from './types.js';

let headlessInitialized = false;

function ensureAgPsdImageDataReady(): void {
  if (headlessInitialized) return;
  const hasDocument = typeof (globalThis as { document?: unknown }).document !== 'undefined';
  if (!hasDocument) {
    initializeCanvas(
      () => {
        throw new Error('DOM Canvas is unavailable in headless mode; useImageData is enabled.');
      },
      undefined,
      (width: number, height: number) =>
        ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
          colorSpace: 'srgb',
        }) as unknown as ReturnType<NonNullable<Parameters<typeof initializeCanvas>[2]>>,
    );
  }
  headlessInitialized = true;
}

export interface ImportPsdOptions extends BuildPackOptions {
  /** Include hidden PSD layers (default: false). */
  includeHiddenLayers?: boolean;
}

function collectPsdLayers(
  layers: readonly Layer[],
  prefix: string[],
  docSize: { width: number; height: number },
  includeHidden: boolean,
  out: RawImageEntry[],
): void {
  for (const layer of layers) {
    if (!includeHidden && layer.hidden) continue;
    const name = (layer.name ?? 'layer').trim();
    const pathParts = [...prefix, name];

    if (layer.children && layer.children.length > 0) {
      collectPsdLayers(layer.children, pathParts, docSize, includeHidden, out);
      continue;
    }

    const img = layer.imageData;
    if (!img || img.width <= 0 || img.height <= 0 || !img.data) continue;

    // Normalize Uint8ClampedArray across Node & Browser
    const rgba =
      img.data instanceof Uint8ClampedArray
        ? img.data
        : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);

    out.push({
      path: pathParts.join('/'),
      width: img.width,
      height: img.height,
      data: rgba,
      canvasOffset: {
        x: layer.left ?? 0,
        y: layer.top ?? 0,
      },
      canvasSize: docSize,
    });
  }
}

/**
 * Parses a layered Adobe Photoshop / Clip Studio Paint / Krita `.psd` binary buffer
 * directly into a PaperDollKit v2.0 AssetPackManifest + RGBA image store.
 *
 * Works identically in Browser and Node.js (`useImageData: true`, zero DOM Canvas dependency).
 */
export function importPsdBuffer(
  buffer: ArrayBuffer | Uint8Array,
  opts: ImportPsdOptions = {},
): ImportResult {
  ensureAgPsdImageDataReady();
  const psd = readPsd(buffer, {
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });

  const docSize = {
    width: Math.max(1, psd.width || 256),
    height: Math.max(1, psd.height || 256),
  };

  const entries: RawImageEntry[] = [];
  if (psd.children && psd.children.length > 0) {
    collectPsdLayers(psd.children, [], docSize, opts.includeHiddenLayers ?? false, entries);
  }

  return buildAssetPackFromEntries(entries, {
    duplicateSingleDirection: true,
    ...opts,
  });
}
