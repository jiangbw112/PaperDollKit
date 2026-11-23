import type { Rect, Vec2 } from '@paperdollkit/core';
import type { ImportedImage } from './types.js';

export interface TrimResult {
  isEmpty: boolean;
  trimmed: ImportedImage;
  sourceRect: Rect;
  trimOffset: Vec2;
  originalSize: { width: number; height: number };
}

/**
 * Computes the tight non-transparent bounding box of an RGBA8 image and crops it.
 * Preserves trimOffset and originalSize so SpriteFrameRef restores exact alignment.
 */
export function trimTransparentImage(
  image: ImportedImage,
  alphaThreshold: number = 1,
): TrimResult {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const a = data[rowOffset + x * 4 + 3]!;
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      isEmpty: true,
      trimmed: { id: image.id, width: 1, height: 1, data: new Uint8ClampedArray(4) },
      sourceRect: { x: 0, y: 0, width: 1, height: 1 },
      trimOffset: { x: 0, y: 0 },
      originalSize: { width, height },
    };
  }

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;

  if (minX === 0 && minY === 0 && trimW === width && trimH === height) {
    return {
      isEmpty: false,
      trimmed: image,
      sourceRect: { x: 0, y: 0, width, height },
      trimOffset: { x: 0, y: 0 },
      originalSize: { width, height },
    };
  }

  const cropped = new Uint8ClampedArray(trimW * trimH * 4);
  for (let y = 0; y < trimH; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    const srcEnd = srcStart + trimW * 4;
    cropped.set(data.subarray(srcStart, srcEnd), y * trimW * 4);
  }

  return {
    isEmpty: false,
    trimmed: {
      id: image.id,
      width: trimW,
      height: trimH,
      data: cropped,
    },
    sourceRect: { x: 0, y: 0, width: trimW, height: trimH },
    trimOffset: { x: minX, y: minY },
    originalSize: { width, height },
  };
}
