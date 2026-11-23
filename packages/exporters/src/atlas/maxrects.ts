import type { Rect } from '@paperdollkit/core';
import { encodePngRGBA } from '../codec/png.js';
import type { PackedAtlas, PackedSprite, RgbaImage, SpritePackInput } from '../types.js';

export interface PackAtlasOptions {
  padding?: number;
  maxSize?: number;
  powerOfTwo?: boolean;
  trimTransparent?: boolean;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Trims transparent borders around an RGBA image while preserving sourceSize and trimOffset. */
export function trimRgbaImage(image: RgbaImage, alphaThreshold = 1): {
  trimmed: RgbaImage;
  sourceSize: { width: number; height: number };
  trimOffset: { x: number; y: number };
} {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      trimmed: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
      sourceSize: { width, height },
      trimOffset: { x: 0, y: 0 },
    };
  }

  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const src = ((minY + y) * width + minX) * 4;
    out.set(data.subarray(src, src + tw * 4), y * tw * 4);
  }

  return {
    trimmed: { width: tw, height: th, data: out },
    sourceSize: { width, height },
    trimOffset: { x: minX, y: minY },
  };
}

function rectsOverlap(a: FreeRect, b: FreeRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isContainedIn(a: FreeRect, b: FreeRect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

/**
 * Attempts to pack rectangles into a bin of size (binW × binH) using
 * MaxRects Best-Short-Side-Fit (BSSF).
 */
function tryPackMaxRects(
  items: ReadonlyArray<{ index: number; w: number; h: number }>,
  binW: number,
  binH: number,
): Map<number, { x: number; y: number }> | null {
  const freeRects: FreeRect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  const placements = new Map<number, { x: number; y: number }>();

  for (const item of items) {
    let bestRect: FreeRect | null = null;
    let bestShortSide = Number.POSITIVE_INFINITY;
    let bestLongSide = Number.POSITIVE_INFINITY;

    for (const fr of freeRects) {
      if (item.w <= fr.w && item.h <= fr.h) {
        const leftoverX = Math.abs(fr.w - item.w);
        const leftoverY = Math.abs(fr.h - item.h);
        const shortSide = Math.min(leftoverX, leftoverY);
        const longSide = Math.max(leftoverX, leftoverY);
        if (
          shortSide < bestShortSide ||
          (shortSide === bestShortSide && longSide < bestLongSide)
        ) {
          bestRect = { x: fr.x, y: fr.y, w: item.w, h: item.h };
          bestShortSide = shortSide;
          bestLongSide = longSide;
        }
      }
    }

    if (!bestRect) return null;
    placements.set(item.index, { x: bestRect.x, y: bestRect.y });

    // Split all free rectangles intersecting bestRect
    const nextFree: FreeRect[] = [];
    for (const fr of freeRects) {
      if (!rectsOverlap(fr, bestRect)) {
        nextFree.push(fr);
        continue;
      }
      if (bestRect.x > fr.x) {
        nextFree.push({ x: fr.x, y: fr.y, w: bestRect.x - fr.x, h: fr.h });
      }
      if (bestRect.x + bestRect.w < fr.x + fr.w) {
        nextFree.push({
          x: bestRect.x + bestRect.w,
          y: fr.y,
          w: fr.x + fr.w - (bestRect.x + bestRect.w),
          h: fr.h,
        });
      }
      if (bestRect.y > fr.y) {
        nextFree.push({ x: fr.x, y: fr.y, w: fr.w, h: bestRect.y - fr.y });
      }
      if (bestRect.y + bestRect.h < fr.y + fr.h) {
        nextFree.push({
          x: fr.x,
          y: bestRect.y + bestRect.h,
          w: fr.w,
          h: fr.y + fr.h - (bestRect.y + bestRect.h),
        });
      }
    }

    // Prune redundant contained free rectangles
    freeRects.length = 0;
    for (let i = 0; i < nextFree.length; i++) {
      const a = nextFree[i]!;
      let redundant = false;
      for (let j = 0; j < nextFree.length; j++) {
        if (i !== j && isContainedIn(a, nextFree[j]!)) {
          redundant = true;
          break;
        }
      }
      if (!redundant) freeRects.push(a);
    }
  }

  return placements;
}

/**
 * Packs a list of sprites tightly into a single RGBA8 Texture Atlas PNG
 * using MaxRects BSSF with configurable border padding & transparent trimming.
 */
export function packSpritesToAtlas(
  inputs: readonly SpritePackInput[],
  opts: PackAtlasOptions = {},
): PackedAtlas {
  const padding = opts.padding ?? 2;
  const maxSize = opts.maxSize ?? 4096;
  const trim = opts.trimTransparent ?? true;

  if (inputs.length === 0) {
    const empty: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    return { image: empty, png: encodePngRGBA(1, 1, empty.data), sprites: [] };
  }

  const prepared = inputs.map((inp, idx) => {
    if (inp.trim) {
      return {
        index: idx,
        id: inp.id,
        image: inp.image,
        sourceSize: inp.trim.sourceSize,
        trimOffset: inp.trim.trimOffset,
      };
    }
    if (trim) {
      const t = trimRgbaImage(inp.image);
      return {
        index: idx,
        id: inp.id,
        image: t.trimmed,
        sourceSize: t.sourceSize,
        trimOffset: t.trimOffset,
      };
    }
    return {
      index: idx,
      id: inp.id,
      image: inp.image,
      sourceSize: { width: inp.image.width, height: inp.image.height },
      trimOffset: { x: 0, y: 0 },
    };
  });

  // Sort tallest/largest area first for optimal MaxRects packing density
  const sortedItems = prepared
    .map((p) => ({
      index: p.index,
      w: p.image.width + padding,
      h: p.image.height + padding,
    }))
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

  const totalArea = sortedItems.reduce((sum, s) => sum + s.w * s.h, 0);
  const maxItemW = Math.max(...sortedItems.map((s) => s.w));
  const maxItemH = Math.max(...sortedItems.map((s) => s.h));

  // Search compact candidate dimensions starting near sqrt(totalArea)
  let binW = Math.max(maxItemW + padding, nextPowerOfTwo(Math.ceil(Math.sqrt(totalArea))));
  let binH = Math.max(maxItemH + padding, Math.ceil(totalArea / Math.max(1, binW)));
  if (opts.powerOfTwo) {
    binW = nextPowerOfTwo(binW);
    binH = nextPowerOfTwo(binH);
  }

  let placements: Map<number, { x: number; y: number }> | null = null;
  while (binW <= maxSize && binH <= maxSize) {
    placements = tryPackMaxRects(sortedItems, binW - padding, binH - padding);
    if (placements) break;
    if (binW <= binH) {
      binW = Math.min(maxSize, opts.powerOfTwo ? binW * 2 : Math.ceil(binW * 1.25) + 32);
    } else {
      binH = Math.min(maxSize, opts.powerOfTwo ? binH * 2 : Math.ceil(binH * 1.25) + 32);
    }
    if (binW === maxSize && binH === maxSize) {
      placements = tryPackMaxRects(sortedItems, binW - padding, binH - padding);
      break;
    }
  }

  if (!placements) {
    throw new Error(`Unable to pack ${inputs.length} sprites within ${maxSize}×${maxSize} atlas.`);
  }

  // Tighten final atlas dimensions to actual used extent (unless powerOfTwo requested)
  let usedW = 1;
  let usedH = 1;
  for (const p of prepared) {
    const pos = placements.get(p.index)!;
    usedW = Math.max(usedW, pos.x + padding + p.image.width + padding);
    usedH = Math.max(usedH, pos.y + padding + p.image.height + padding);
  }
  const atlasW = opts.powerOfTwo ? nextPowerOfTwo(usedW) : usedW;
  const atlasH = opts.powerOfTwo ? nextPowerOfTwo(usedH) : usedH;

  const atlasData = new Uint8ClampedArray(atlasW * atlasH * 4);
  const sprites: PackedSprite[] = [];

  for (const p of prepared) {
    const pos = placements.get(p.index)!;
    const dstX = pos.x + padding;
    const dstY = pos.y + padding;
    const { width: sw, height: sh, data: sdata } = p.image;

    for (let y = 0; y < sh; y++) {
      const srcRow = y * sw * 4;
      const dstRow = ((dstY + y) * atlasW + dstX) * 4;
      atlasData.set(sdata.subarray(srcRow, srcRow + sw * 4), dstRow);
    }

    const rect: Rect = { x: dstX, y: dstY, width: sw, height: sh };
    sprites.push({
      id: p.id,
      rect,
      sourceSize: p.sourceSize,
      trimOffset: p.trimOffset,
      rotated: false,
    });
  }

  const image: RgbaImage = { width: atlasW, height: atlasH, data: atlasData };
  const png = encodePngRGBA(atlasW, atlasH, atlasData);

  return { image, png, sprites };
}
