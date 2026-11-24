import { validateAssetPack } from '@paperdollkit/core';
import { writePsdBuffer } from 'ag-psd';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildAssetPackFromEntries,
  createDemoHDPackWithImages,
  generateAutoMaskFromImage,
  generateAutoNormalMap,
  importAsepriteBuffer,
  importPsdBuffer,
  parseAsepriteBuffer,
  parseLayerPath,
  sliceSpriteStrip,
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

  it('parses and imports a binary .aseprite file with zlib-compressed RGBA cel and layer path', () => {
    const layerName = new TextEncoder().encode('torso_top/ase_tunic_SE');
    const layerChunkSize = 6 + 16 + 2 + layerName.length;
    const layerChunk = new Uint8Array(layerChunkSize);
    const lv = new DataView(layerChunk.buffer);
    lv.setUint32(0, layerChunkSize, true);
    lv.setUint16(4, 0x2004, true); // Layer chunk
    lv.setUint16(6, 1, true); // flags: visible
    lv.setUint16(8, 0, true); // type: normal
    lv.setUint16(10, 0, true); // child level
    lv.setUint8(18, 255); // opacity
    lv.setUint16(22, layerName.length, true);
    layerChunk.set(layerName, 24);

    // Compressed cel (8×8 solid RGBA at offset 4,4)
    const rawPixels = makeSolidRGBA(8, 8, 90, 140, 220, 255);
    const compressed = zlibSync(new Uint8Array(rawPixels.buffer));
    const celChunkSize = 6 + 16 + 4 + compressed.length;
    const celChunk = new Uint8Array(celChunkSize);
    const cv = new DataView(celChunk.buffer);
    cv.setUint32(0, celChunkSize, true);
    cv.setUint16(4, 0x2005, true); // Cel chunk
    cv.setUint16(6, 0, true); // layer index 0
    cv.setInt16(8, 4, true); // x = 4
    cv.setInt16(10, 4, true); // y = 4
    cv.setUint8(12, 255); // opacity
    cv.setUint16(13, 2, true); // cel type 2 = compressed
    cv.setUint16(22, 8, true); // width
    cv.setUint16(24, 8, true); // height
    celChunk.set(compressed, 26);

    const frameBytes = 16 + layerChunk.length + celChunk.length;
    const totalBytes = 128 + frameBytes;
    const buf = new Uint8Array(totalBytes);
    const hv = new DataView(buf.buffer);
    hv.setUint32(0, totalBytes, true);
    hv.setUint16(4, 0xa5e0, true); // ASE magic
    hv.setUint16(6, 1, true); // 1 frame
    hv.setUint16(8, 16, true); // width 16
    hv.setUint16(10, 16, true); // height 16
    hv.setUint16(12, 32, true); // 32bpp RGBA

    // Frame header at 128
    hv.setUint32(128, frameBytes, true);
    hv.setUint16(132, 0xf1fa, true); // frame magic
    hv.setUint16(134, 2, true); // 2 chunks
    hv.setUint16(136, 120, true); // duration 120ms
    buf.set(layerChunk, 144);
    buf.set(celChunk, 144 + layerChunk.length);

    const parsed = parseAsepriteBuffer(buf);
    expect(parsed.width).toBe(16);
    expect(parsed.height).toBe(16);
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0]!.name).toBe('torso_top/ase_tunic_SE');

    const imported = importAsepriteBuffer(buf, { duplicateSingleDirection: true });
    expect(validateAssetPack(imported.pack).ok).toBe(true);
    expect(imported.report.importedParts).toBe(1);
    const part = imported.pack.parts.torso_top?.find((p) => p.id === 'ase_tunic');
    expect(part).toBeDefined();
    expect(part!.directions.SE!.frames[0]!.trimOffset).toEqual({ x: 4, y: 4 });
  });

  it('slices a horizontal spritesheet strip into individual non-empty frame entries', () => {
    const strip = new Uint8ClampedArray(96 * 32 * 4);
    // Paint frame 0 (0..31) and frame 2 (64..95); leave frame 1 (32..63) empty
    for (let y = 4; y < 28; y++) {
      for (let x = 4; x < 28; x++) {
        const i0 = (y * 96 + x) * 4;
        strip[i0] = 200;
        strip[i0 + 3] = 255;
        const i2 = (y * 96 + (64 + x)) * 4;
        strip[i2 + 1] = 200;
        strip[i2 + 3] = 255;
      }
    }
    const entries = sliceSpriteStrip(
      { id: 'hero_walk.png', width: 96, height: 32, data: strip },
      { frameWidth: 32, frameHeight: 32, pathPrefix: 'torso_top/strip_hero_SE_walk' },
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]!.path).toBe('torso_top/strip_hero_SE_walk_0.png');
    expect(entries[1]!.path).toBe('torso_top/strip_hero_SE_walk_1.png');
    expect(entries[0]!.width).toBe(32);
    expect(entries[0]!.height).toBe(32);
  });

  it('generates a tangent-space 2D normal map with flat (128,128,255) background and Sobel edge slopes', () => {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    // Bright horizontal ramp inside (4..11, 4..11)
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        const i = (y * w + x) * 4;
        const v = Math.round(((x - 4) / 7) * 255);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const normal = generateAutoNormalMap({ id: 'plate.png', width: w, height: h, data });
    expect(normal.id).toBe('plate_normal.png');
    expect(normal.width).toBe(w);
    expect(normal.height).toBe(h);
    // Transparent corner -> flat neutral normal (128, 128, 255, 255)
    expect([normal.data[0], normal.data[1], normal.data[2], normal.data[3]]).toEqual([128, 128, 255, 255]);
    // Rising ramp left->right => negative nx => R < 128, positive nz => B > 128
    const mid = (8 * w + 8) * 4;
    expect(normal.data[mid]!).toBeLessThan(120);
    expect(normal.data[mid + 2]!).toBeGreaterThan(128);
    expect(normal.data[mid + 3]!).toBe(255);
  });
});
