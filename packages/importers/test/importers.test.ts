import { validateAssetPack } from '@paperdollkit/core';
import { writePsdBuffer } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import {
  buildAssetPackFromEntries,
  createDemoHDPackWithImages,
  generateAutoMaskFromImage,
  importPsdBuffer,
  parseLayerPath,
  trimTransparentImage,
} from '../src/index.js';

function makeSolidRGBA(w: number, h: number, r: number, g: number, b: number, a: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

describe('@paperdollkit/importers', () => {
  it('parses English and Chinese layer paths with direction, action, frame, and mask flags', () => {
    expect(parseLayerPath('torso_top/plate_SE.png')).toMatchObject({
      slotId: 'torso_top',
      partId: 'plate',
      directionId: 'SE',
      isMask: false,
    });

    expect(parseLayerPath('SE/front_arm/armor_sleeve_mask.png')).toMatchObject({
      slotId: 'front_arm',
      partId: 'armor_sleeve',
      directionId: 'SE',
      isMask: true,
    });

    expect(parseLayerPath('body_base/hero_E_walk_02.png')).toMatchObject({
      slotId: 'body_base',
      partId: 'hero',
      directionId: 'E',
      actionId: 'walk',
      frameIndex: 2,
      isMask: false,
    });

    expect(parseLayerPath('上衣护甲/龙鳞甲_NE_遮罩')).toMatchObject({
      slotId: 'torso_top',
      partId: '龙鳞甲',
      directionId: 'NE',
      isMask: true,
    });
  });

  it('trims transparent padding while preserving trimOffset and originalSize', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    // Paint a 4×6 opaque block at (5, 3)
    for (let y = 3; y < 9; y++) {
      for (let x = 5; x < 9; x++) {
        const idx = (y * 16 + x) * 4;
        data[idx] = 200;
        data[idx + 1] = 100;
        data[idx + 2] = 50;
        data[idx + 3] = 255;
      }
    }

    const res = trimTransparentImage({ id: 'test', width: 16, height: 16, data });
    expect(res.isEmpty).toBe(false);
    expect(res.originalSize).toEqual({ width: 16, height: 16 });
    expect(res.trimOffset).toEqual({ x: 5, y: 3 });
    expect(res.sourceRect).toEqual({ x: 0, y: 0, width: 4, height: 6 });
    expect(res.trimmed.width).toBe(4);
    expect(res.trimmed.height).toBe(6);
  });

  it('builds a valid AssetPack pairing albedo + mask layers and trimming both identically', () => {
    const albedo = new Uint8ClampedArray(32 * 32 * 4);
    const mask = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = 8; y < 24; y++) {
      for (let x = 6; x < 26; x++) {
        const i = (y * 32 + x) * 4;
        albedo[i] = 180;
        albedo[i + 1] = 180;
        albedo[i + 2] = 180;
        albedo[i + 3] = 255;
        // Upper half primary (R), lower half skin (B)
        mask[i] = y < 16 ? 255 : 0;
        mask[i + 2] = y >= 16 ? 255 : 0;
        mask[i + 3] = 255;
      }
    }

    const result = buildAssetPackFromEntries([
      { path: 'front_arm/steel_bracer_SE.png', width: 32, height: 32, data: albedo },
      { path: 'front_arm/steel_bracer_SE_mask.png', width: 32, height: 32, data: mask },
    ], { duplicateSingleDirection: true });

    expect(validateAssetPack(result.pack).ok).toBe(true);
    expect(result.report.importedParts).toBe(1);
    expect(result.report.pairedMasks).toBe(1);

    const part = result.pack.parts.front_arm?.find((p) => p.id === 'steel_bracer');
    expect(part).toBeDefined();
    expect(part!.recolorMode).toBe('mask_ramp');
    const seFrame = part!.directions.SE!.frames[0]!;
    expect(seFrame.sourceRect).toEqual({ x: 0, y: 0, width: 20, height: 16 });
    expect(seFrame.trimOffset).toEqual({ x: 6, y: 8 });
    expect(seFrame.maskImageId).toBeDefined();
    const maskImg = result.images.get(seFrame.maskImageId!)!;
    expect(maskImg.width).toBe(20);
    expect(maskImg.height).toBe(16);
  });

  it('imports a real layered binary PSD buffer preserving groups, masks, and exact canvas pivots', () => {
    const psdBytes = writePsdBuffer({
      width: 256,
      height: 256,
      children: [
        {
          name: 'SE',
          children: [
            {
              name: 'torso_top',
              children: [
                {
                  name: 'royal_plate',
                  left: 88,
                  top: 100,
                  imageData: {
                    width: 80,
                    height: 80,
                    data: makeSolidRGBA(80, 80, 175, 175, 175, 255),
                  },
                },
                {
                  name: 'royal_plate_mask',
                  left: 88,
                  top: 100,
                  imageData: {
                    width: 80,
                    height: 80,
                    data: makeSolidRGBA(80, 80, 255, 0, 0, 255),
                  },
                },
              ],
            },
            {
              name: 'hidden_guide',
              hidden: true,
              left: 0,
              top: 0,
              imageData: {
                width: 16,
                height: 16,
                data: makeSolidRGBA(16, 16, 255, 0, 255, 255),
              },
            },
          ],
        },
      ],
    });

    const result = importPsdBuffer(new Uint8Array(psdBytes));
    expect(validateAssetPack(result.pack).ok).toBe(true);
    expect(result.report.importedParts).toBe(1);
    expect(result.report.pairedMasks).toBe(1);
    expect(result.report.unmatchedPaths).toHaveLength(0);

    const plate = result.pack.parts.torso_top?.find((p) => p.id === 'royal_plate');
    expect(plate).toBeDefined();
    expect(plate!.recolorMode).toBe('mask_ramp');
    const frame = plate!.directions.SE!.frames[0]!;
    expect(frame.maskImageId).toBeDefined();
    // Exact PSD document coordinate preserved via computed pivot
    expect(frame.pivot.x).toBeCloseTo((128 - 88) / 80, 3);
  });

  it('generates a valid high-resolution (256×256) demo HD asset pack with masks and 4 presets', () => {
    const { pack, images } = createDemoHDPackWithImages();
    const validation = validateAssetPack(pack);
    expect(validation.ok).toBe(true);
    expect(pack.presets).toHaveLength(4);
    expect(images.size).toBeGreaterThan(100);
    // Verify front_arm mask contains BOTH primary (R) sleeve pixels and skin (B) hand pixels
    const armMask = images.get('front_arm/armor_sleeve_SE_mask.png')!;
    let hasSleeveR = false;
    let hasHandB = false;
    for (let i = 0; i < armMask.data.length; i += 4) {
      if (armMask.data[i]! > 200) hasSleeveR = true;
      if (armMask.data[i + 2]! > 200) hasHandB = true;
    }
    expect(hasSleeveR).toBe(true);
    expect(hasHandB).toBe(true);
  });

  it('auto-generates an opaque (A=255) semantic mask separating lineart, skin (B), primary (R), and secondary (G)', () => {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    const fillRect = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
        }
      }
    };
    // Dark outline
    fillRect(0, 0, 40, 4, 20, 22, 28);
    // Large cobalt blue sleeve (should become Primary R)
    fillRect(0, 4, 40, 24, 48, 108, 215);
    // Smaller emerald cuff trim (should become Secondary G)
    fillRect(0, 24, 40, 32, 36, 178, 110);
    // Warm peach skin hand (should become Skin B on front_arm)
    fillRect(0, 32, 40, 40, 240, 194, 156);

    const res = generateAutoMaskFromImage(
      { id: 'custom_arm.png', width: w, height: h, data },
      { slotId: 'front_arm' },
    );

    // Every pixel must have opaque alpha = 255
    for (let i = 3; i < res.mask.data.length; i += 4) {
      expect(res.mask.data[i]).toBe(255);
    }

    const pxAt = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [res.mask.data[i], res.mask.data[i + 1], res.mask.data[i + 2], res.mask.data[i + 3]];
    };
    expect(pxAt(10, 2)).toEqual([0, 0, 0, 255]);    // Lineart preserved
    expect(pxAt(10, 14)).toEqual([255, 0, 0, 255]); // Primary sleeve -> R
    expect(pxAt(10, 28)).toEqual([0, 255, 0, 255]); // Secondary trim -> G
    expect(pxAt(10, 36)).toEqual([0, 0, 255, 255]); // Skin hand -> B
    expect(res.stats.primaryPixels).toBeGreaterThan(res.stats.secondaryPixels);
    expect(res.stats.skinPixels).toBe(40 * 8);
    expect(res.stats.preservedPixels).toBe(40 * 4);
  });
});
