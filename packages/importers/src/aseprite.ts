import { unzlibSync } from 'fflate';
import { buildAssetPackFromEntries } from './pack-builder.js';
import type { BuildPackOptions, ImportResult, ImportedImage, RawImageEntry } from './types.js';

export interface AsepriteLayerInfo {
  index: number;
  name: string;
  visible: boolean;
  isGroup: boolean;
  childLevel: number;
  opacity: number;
}

export interface AsepriteTagInfo {
  name: string;
  from: number;
  to: number;
}

export interface ParsedAseprite {
  width: number;
  height: number;
  colorDepth: number;
  frameCount: number;
  layers: AsepriteLayerInfo[];
  tags: AsepriteTagInfo[];
  /** Per-frame per-layer composited RGBA8 buffers of size width×height. */
  frames: Array<{
    durationMs: number;
    cels: Map<number, Uint8ClampedArray>;
  }>;
}

function readAseString(view: DataView, offset: number): { value: string; nextOffset: number } {
  const len = view.getUint16(offset, true);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 2, len);
  const value = new TextDecoder('utf-8').decode(bytes);
  return { value, nextOffset: offset + 2 + len };
}

function decodeCelPixelsToRgba(
  raw: Uint8Array,
  celW: number,
  celH: number,
  colorDepth: number,
  palette: Uint8ClampedArray,
  transparentIndex: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(celW * celH * 4);
  if (colorDepth === 32) {
    out.set(raw.subarray(0, out.length));
  } else if (colorDepth === 16) {
    for (let i = 0; i < celW * celH; i++) {
      const v = raw[i * 2] ?? 0;
      const a = raw[i * 2 + 1] ?? 0;
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = a;
    }
  } else if (colorDepth === 8) {
    for (let i = 0; i < celW * celH; i++) {
      const idx = raw[i] ?? 0;
      if (idx === transparentIndex) continue;
      const po = idx * 4;
      out[i * 4] = palette[po] ?? 0;
      out[i * 4 + 1] = palette[po + 1] ?? 0;
      out[i * 4 + 2] = palette[po + 2] ?? 0;
      out[i * 4 + 3] = palette[po + 3] ?? 255;
    }
  }
  return out;
}

/**
 * Pure TypeScript parser for Aseprite `.ase` / `.aseprite` binary files
 * (supports 32-bit RGBA, 16-bit Grayscale, 8-bit Indexed, raw/linked/zlib cels, layers, and tags).
 */
export function parseAsepriteBuffer(buffer: ArrayBuffer | Uint8Array): ParsedAseprite {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 128) {
    throw new Error('Invalid Aseprite file: smaller than 128-byte header.');
  }
  const magic = view.getUint16(4, true);
  if (magic !== 0xa5e0) {
    throw new Error(`Invalid Aseprite magic 0x${magic.toString(16)}; expected 0xA5E0.`);
  }

  const frameCount = view.getUint16(6, true);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  const colorDepth = view.getUint16(12, true);
  const transparentIndex = view.getUint8(28);

  const palette = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    palette[i * 4] = i;
    palette[i * 4 + 1] = i;
    palette[i * 4 + 2] = i;
    palette[i * 4 + 3] = 255;
  }

  const layers: AsepriteLayerInfo[] = [];
  const tags: AsepriteTagInfo[] = [];
  const frames: ParsedAseprite['frames'] = [];

  let offset = 128;
  for (let f = 0; f < frameCount && offset + 16 <= bytes.byteLength; f++) {
    const frameSize = view.getUint32(offset, true);
    const frameMagic = view.getUint16(offset + 4, true);
    if (frameMagic !== 0xf1fa) {
      throw new Error(`Invalid Aseprite frame magic at frame ${f}.`);
    }
    const oldChunks = view.getUint16(offset + 6, true);
    const durationMs = view.getUint16(offset + 8, true) || 100;
    const newChunks = view.getUint32(offset + 12, true);
    const chunkCount = newChunks > 0 ? newChunks : oldChunks;

    const cels = new Map<number, Uint8ClampedArray>();
    let cOff = offset + 16;

    for (let c = 0; c < chunkCount && cOff + 6 <= offset + frameSize; c++) {
      const chunkSize = view.getUint32(cOff, true);
      const chunkType = view.getUint16(cOff + 4, true);
      const dataStart = cOff + 6;
      const dataEnd = Math.min(bytes.byteLength, cOff + chunkSize);

      if (chunkType === 0x2004 && dataStart + 18 <= dataEnd) {
        // Layer Chunk
        const flags = view.getUint16(dataStart, true);
        const layerType = view.getUint16(dataStart + 2, true);
        const childLevel = view.getUint16(dataStart + 4, true);
        const opacity = view.getUint8(dataStart + 12);
        const { value: name } = readAseString(view, dataStart + 16);
        layers.push({
          index: layers.length,
          name,
          visible: (flags & 1) !== 0,
          isGroup: layerType === 1,
          childLevel,
          opacity,
        });
      } else if (chunkType === 0x2019 && dataStart + 20 <= dataEnd) {
        // Palette Chunk
        const firstIdx = view.getUint32(dataStart + 4, true);
        const lastIdx = view.getUint32(dataStart + 8, true);
        let pOff = dataStart + 20;
        for (let idx = firstIdx; idx <= lastIdx && idx < 256 && pOff + 6 <= dataEnd; idx++) {
          const entryFlags = view.getUint16(pOff, true);
          palette[idx * 4] = view.getUint8(pOff + 2);
          palette[idx * 4 + 1] = view.getUint8(pOff + 3);
          palette[idx * 4 + 2] = view.getUint8(pOff + 4);
          palette[idx * 4 + 3] = view.getUint8(pOff + 5);
          pOff += 6;
          if ((entryFlags & 1) !== 0 && pOff + 2 <= dataEnd) {
            pOff = readAseString(view, pOff).nextOffset;
          }
        }
      } else if (chunkType === 0x2018 && dataStart + 10 <= dataEnd) {
        // Tags Chunk
        const numTags = view.getUint16(dataStart, true);
        let tOff = dataStart + 10;
        for (let t = 0; t < numTags && tOff + 17 <= dataEnd; t++) {
          const from = view.getUint16(tOff, true);
          const to = view.getUint16(tOff + 2, true);
          const { value: name, nextOffset } = readAseString(view, tOff + 17);
          tags.push({ name, from, to });
          tOff = nextOffset;
        }
      } else if (chunkType === 0x2005 && dataStart + 16 <= dataEnd) {
        // Cel Chunk
        const layerIndex = view.getUint16(dataStart, true);
        const posX = view.getInt16(dataStart + 2, true);
        const posY = view.getInt16(dataStart + 4, true);
        const celType = view.getUint16(dataStart + 7, true);

        if (celType === 1 && dataStart + 18 <= dataEnd) {
          // Linked cel
          const linkedFrame = view.getUint16(dataStart + 16, true);
          const prev = frames[linkedFrame]?.cels.get(layerIndex);
          if (prev) cels.set(layerIndex, new Uint8ClampedArray(prev));
        } else if ((celType === 0 || celType === 2) && dataStart + 20 <= dataEnd) {
          const celW = view.getUint16(dataStart + 16, true);
          const celH = view.getUint16(dataStart + 18, true);
          const payload = bytes.subarray(dataStart + 20, dataEnd);
          const rawPixels = celType === 2 ? unzlibSync(payload) : payload;
          const celRgba = decodeCelPixelsToRgba(
            rawPixels,
            celW,
            celH,
            colorDepth,
            palette,
            transparentIndex,
          );
          // Blit cel onto full-canvas RGBA buffer
          const full = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < celH; y++) {
            const dy = posY + y;
            if (dy < 0 || dy >= height) continue;
            for (let x = 0; x < celW; x++) {
              const dx = posX + x;
              if (dx < 0 || dx >= width) continue;
              const si = (y * celW + x) * 4;
              const di = (dy * width + dx) * 4;
              full[di] = celRgba[si]!;
              full[di + 1] = celRgba[si + 1]!;
              full[di + 2] = celRgba[si + 2]!;
              full[di + 3] = celRgba[si + 3]!;
            }
          }
          cels.set(layerIndex, full);
        }
      }

      cOff += Math.max(6, chunkSize);
    }

    frames.push({ durationMs, cels });
    offset += Math.max(16, frameSize);
  }

  return { width, height, colorDepth, frameCount, layers, tags, frames };
}

/**
 * Imports an Aseprite `.ase` / `.aseprite` file directly into a PaperDollKit AssetPackManifest,
 * mapping layer names to standard 17 slots and preserving frame sequences.
 */
export function importAsepriteBuffer(
  buffer: ArrayBuffer | Uint8Array,
  opts: BuildPackOptions & { includeHiddenLayers?: boolean } = {},
): ImportResult {
  const parsed = parseAsepriteBuffer(buffer);
  const entries: RawImageEntry[] = [];

  for (const layer of parsed.layers) {
    if (layer.isGroup) continue;
    if (!opts.includeHiddenLayers && !layer.visible) continue;

    for (let fIdx = 0; fIdx < parsed.frames.length; fIdx++) {
      const celData = parsed.frames[fIdx]!.cels.get(layer.index);
      if (!celData) continue;

      const suffix = parsed.frames.length > 1 ? `_walk_${fIdx}` : '';
      entries.push({
        path: `${layer.name}${suffix}.png`,
        width: parsed.width,
        height: parsed.height,
        data: celData,
      });
    }
  }

  return buildAssetPackFromEntries(entries, {
    duplicateSingleDirection: true,
    ...opts,
  });
}

export interface SliceSpriteStripOptions {
  /** Number of horizontal columns (if omitted, derived from frameWidth). */
  columns?: number;
  /** Number of vertical rows (default: 1). */
  rows?: number;
  /** Explicit frame width in pixels (optional when columns is set). */
  frameWidth?: number;
  /** Explicit frame height in pixels (optional when rows is set). */
  frameHeight?: number;
  /** Logical path prefix (e.g. "legs_bottom/custom_pants_SE_walk"). */
  pathPrefix: string;
}

/**
 * Slices a horizontal strip or grid spritesheet PNG into individual RawImageEntry frames
 * ready to be fed into `buildAssetPackFromEntries`.
 */
export function sliceSpriteStrip(
  image: ImportedImage,
  opts: SliceSpriteStripOptions,
): RawImageEntry[] {
  const rows = Math.max(1, opts.rows ?? 1);
  const frameH = Math.max(1, opts.frameHeight ?? Math.floor(image.height / rows));
  const cols = Math.max(
    1,
    opts.columns ?? (opts.frameWidth ? Math.floor(image.width / opts.frameWidth) : 1),
  );
  const frameW = Math.max(1, opts.frameWidth ?? Math.floor(image.width / cols));

  const entries: RawImageEntry[] = [];
  let frameIdx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * frameW;
      const sy = r * frameH;
      if (sx + frameW > image.width || sy + frameH > image.height) continue;

      const data = new Uint8ClampedArray(frameW * frameH * 4);
      let hasOpaque = false;
      for (let y = 0; y < frameH; y++) {
        const srcOff = ((sy + y) * image.width + sx) * 4;
        const rowSlice = image.data.subarray(srcOff, srcOff + frameW * 4);
        data.set(rowSlice, y * frameW * 4);
        if (!hasOpaque) {
          for (let a = 3; a < rowSlice.length; a += 4) {
            if (rowSlice[a]! > 8) {
              hasOpaque = true;
              break;
            }
          }
        }
      }
      if (!hasOpaque) continue;

      entries.push({
        path: `${opts.pathPrefix}_${frameIdx++}.png`,
        width: frameW,
        height: frameH,
        data,
      });
    }
  }

  return entries;
}
