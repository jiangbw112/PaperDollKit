import { PaperDollCharacter } from '@paperdollkit/core';
import { createDemoHDPackWithImages } from '@paperdollkit/importers';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  bakeCharacterSequences,
  encodePngRGBA,
  exportCocos3BakedBundle,
  exportDualEngineBakedBundle,
  exportGodot4BakedBundle,
  packSpritesToAtlas,
} from '../src/index.js';

function makeRectImage(w: number, h: number, r: number, g: number, b: number, pad = 0) {
  const tw = w + pad * 2;
  const th = h + pad * 2;
  const data = new Uint8ClampedArray(tw * th * 4);
  for (let y = pad; y < pad + h; y++) {
    for (let x = pad; x < pad + w; x++) {
      const i = (y * tw + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: tw, height: th, data };
}

describe('@paperdollkit/exporters (M3 Baked Godot 4 & Cocos 3.x)', () => {
  it('encodes valid lossless RGBA8 PNG binary with IHDR, IDAT, and IEND chunks', () => {
    const img = makeRectImage(8, 6, 220, 60, 80);
    const png = encodePngRGBA(img.width, img.height, img.data);

    // Verify 8-byte PNG signature
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    // Verify IHDR chunk type and width/height
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16, false)).toBe(8);
    expect(view.getUint32(20, false)).toBe(6);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA color type

    // Verify IEND trailer at end
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('packs sprites with MaxRects BSSF without overlaps and preserves trim offsets', () => {
    const inputs = [
      { id: 'a.png', image: makeRectImage(20, 30, 255, 0, 0, 4) },
      { id: 'b.png', image: makeRectImage(28, 16, 0, 255, 0, 6) },
      { id: 'c.png', image: makeRectImage(14, 40, 0, 0, 255, 2) },
      { id: 'd.png', image: makeRectImage(24, 24, 255, 255, 0, 5) },
    ];

    const atlas = packSpritesToAtlas(inputs, { padding: 2, trimTransparent: true });
    expect(atlas.sprites).toHaveLength(4);

    // Check trim preservation
    const spA = atlas.sprites.find((s) => s.id === 'a.png')!;
    expect(spA.rect.width).toBe(20);
    expect(spA.rect.height).toBe(30);
    expect(spA.trimOffset).toEqual({ x: 4, y: 4 });
    expect(spA.sourceSize).toEqual({ width: 28, height: 38 });

    // Check zero rectangle overlaps across all packed sprites
    for (let i = 0; i < atlas.sprites.length; i++) {
      for (let j = i + 1; j < atlas.sprites.length; j++) {
        const a = atlas.sprites[i]!.rect;
        const b = atlas.sprites[j]!.rect;
        const overlap =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('bakes multi-direction × multi-action character sequences and exports valid Godot 4 & Cocos 3.x ZIP bundles', () => {
    const { pack, images } = createDemoHDPackWithImages();
    const hero = new PaperDollCharacter(pack, { preset: 'knight', direction: 'SE', action: 'walk' });

    let progressCalls = 0;
    const baked = bakeCharacterSequences(
      { pack, config: hero.toJSON(), images },
      {
        characterName: 'knight_hero',
        directions: ['SE', 'SW', 'N'],
        actions: ['idle', 'walk'],
        frameSize: { width: 64, height: 64 },
        fpsOverride: 4,
        onProgress: () => {
          progressCalls++;
        },
      },
    );

    expect(progressCalls).toBeGreaterThan(0);
    expect(baked.animations).toHaveLength(6); // 3 dirs × 2 actions
    expect(baked.atlas.sprites.length).toBeGreaterThan(10);
    expect(baked.atlas.image.width).toBeGreaterThan(32);
    expect(baked.atlas.png.length).toBeGreaterThan(100);

    // Verify atlas contains real non-transparent painted pixels
    let opaquePixels = 0;
    for (let i = 3; i < baked.atlas.image.data.length; i += 4) {
      if (baked.atlas.image.data[i]! > 200) opaquePixels++;
    }
    expect(opaquePixels).toBeGreaterThan(500);

    // 1. Godot 4.x Bundle Contract
    const godotBundle = exportGodot4BakedBundle(baked, {
      resBasePath: 'res://characters/knight_hero',
      textureFilter: 'linear',
    });
    expect(godotBundle.zipFilename).toBe('knight_hero_godot4.zip');
    const godotUnzipped = unzipSync(godotBundle.zip);
    expect(godotUnzipped['knight_hero/knight_hero_atlas.png']).toBeDefined();
    expect(godotUnzipped['knight_hero/knight_hero_atlas.png.import']).toBeDefined();
    expect(godotUnzipped['knight_hero/knight_hero_frames.tres']).toBeDefined();
    expect(godotUnzipped['knight_hero/knight_hero.tscn']).toBeDefined();
    expect(godotUnzipped['knight_hero/knight_hero_controller.gd']).toBeDefined();

    const tres = String(godotBundle.files['knight_hero/knight_hero_frames.tres']);
    expect(tres).toContain('[gd_resource type="SpriteFrames"');
    expect(tres).toContain('format=3]');
    expect(tres).toContain('res://characters/knight_hero/knight_hero_atlas.png');
    expect(tres).toContain('&"walk_SE"');
    expect(tres).toContain('&"walk_SW"');
    expect(tres).toContain('&"idle_N"');
    expect(tres).toContain('filter_clip = true');

    // 2. Cocos Creator 3.x Bundle Contract
    const cocosBundle = exportCocos3BakedBundle(baked);
    expect(cocosBundle.zipFilename).toBe('knight_hero_cocos3.zip');
    const cocosUnzipped = unzipSync(cocosBundle.zip);
    expect(cocosUnzipped['knight_hero/knight_hero_atlas.png']).toBeDefined();
    expect(cocosUnzipped['knight_hero/knight_hero_atlas.plist']).toBeDefined();
    expect(cocosUnzipped['knight_hero/knight_hero_manifest.json']).toBeDefined();
    expect(cocosUnzipped['knight_hero/PaperDollBakedPlayer.ts']).toBeDefined();
    expect(cocosUnzipped['knight_hero/animations/knight_hero_walk_SE.anim']).toBeDefined();

    const plist = String(cocosBundle.files['knight_hero/knight_hero_atlas.plist']);
    expect(plist).toContain('<integer>2</integer>');
    expect(plist).toContain('knight_hero_walk_SE_00.png');
    expect(plist).toContain('<key>sourceSize</key>');

    const animJson = JSON.parse(
      String(cocosBundle.files['knight_hero/animations/knight_hero_walk_SE.anim']),
    ) as Array<{ __type__: string; sample?: number; wrapMode?: number }>;
    expect(animJson[0]!.__type__).toBe('cc.AnimationClip');
    expect(animJson[0]!.sample).toBe(4);
    expect(animJson[0]!.wrapMode).toBe(2); // Loop

    // 3. Dual-Engine ZIP Bundle
    const dualBundle = exportDualEngineBakedBundle(baked);
    const dualUnzipped = unzipSync(dualBundle.zip);
    expect(dualUnzipped['godot4/knight_hero/knight_hero_frames.tres']).toBeDefined();
    expect(dualUnzipped['cocos3/knight_hero/knight_hero_atlas.plist']).toBeDefined();
  });
});
