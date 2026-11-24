import { createHash } from 'node:crypto';
import { PaperDollCharacter } from '@paperdollkit/core';
import { createDemoHDPackWithImages } from '@paperdollkit/importers';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  bakeCharacterSequences,
  buildModularExportData,
  encodePngRGBA,
  exportCocos3BakedBundle,
  exportCocos3ModularBundle,
  exportDualEngineBakedBundle,
  exportDualEngineModularBundle,
  exportGodot4BakedBundle,
  exportGodot4ModularBundle,
  exportUniversalAtlasBundle,
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

  it('exports Mode B Modular Runtime Kits for Godot 4.x & Cocos Creator 3.x with Mask+Ramp LUT shaders, PartRules, and animation events', () => {
    const { pack, images } = createDemoHDPackWithImages();
    // Attach a PartRule to verify rules serialize cleanly into paperdoll_manifest.json
    if (pack.parts.head_hat?.[0]) {
      pack.parts.head_hat[0].rules = { hidesSlots: ['hair_style'] };
    }
    const hero = new PaperDollCharacter(pack, { preset: 'knight', direction: 'SE', action: 'attack' });

    const modular = buildModularExportData(
      { pack, config: hero.toJSON(), images },
      { kitName: 'hero_kit', includeAllParts: true, includePrebakedLuts: true },
    );

    expect(modular.manifest.format).toBe('paperdollkit-modular-v2');
    expect(modular.stats.partCount).toBeGreaterThan(10);
    expect(modular.stats.textureCount).toBeGreaterThan(0);
    expect(modular.stats.eventCount).toBeGreaterThanOrEqual(5);
    expect(modular.manifest.animations.attack?.events?.some((e) => e.name === 'hit')).toBe(true);
    expect(modular.manifest.parts.head_hat?.[0]?.rules?.hidesSlots).toEqual(['hair_style']);
    expect(Object.keys(modular.prebakedLuts).length).toBeGreaterThan(0);

    // 1. Godot 4.x Mode B Bundle
    const godotMod = exportGodot4ModularBundle(modular, {
      resBasePath: 'res://characters/hero_kit',
    });
    expect(godotMod.zipFilename).toBe('hero_kit_godot4_modular.zip');
    const godotFiles = unzipSync(godotMod.zip);
    expect(godotFiles['hero_kit/paperdoll_manifest.json']).toBeDefined();
    expect(godotFiles['hero_kit/shaders/paperdoll_mask_ramp.gdshader']).toBeDefined();
    expect(godotFiles['hero_kit/scripts/paperdoll_modular.gd']).toBeDefined();
    expect(godotFiles['hero_kit/hero_kit_modular.tscn']).toBeDefined();

    const gdShader = String(godotMod.files['hero_kit/shaders/paperdoll_mask_ramp.gdshader']);
    expect(gdShader).toContain('shader_type canvas_item;');
    expect(gdShader).toContain('u_lut_tex');
    expect(gdShader).toContain('u_flash_amount');
    expect(gdShader).toContain('u_outline_width');

    const gdScript = String(godotMod.files['hero_kit/scripts/paperdoll_modular.gd']);
    expect(gdScript).toContain('class_name PaperDollModular');
    expect(gdScript).toContain('signal animation_event');
    expect(gdScript).toContain('_resolve_part_rules');
    expect(gdScript).toContain('trigger_hit_flash');
    expect(gdScript).toContain('set_outline');

    // 2. Cocos Creator 3.x Mode B Bundle
    const cocosMod = exportCocos3ModularBundle(modular);
    expect(cocosMod.zipFilename).toBe('hero_kit_cocos3_modular.zip');
    const cocosFiles = unzipSync(cocosMod.zip);
    expect(cocosFiles['hero_kit/paperdoll_manifest.json']).toBeDefined();
    expect(cocosFiles['hero_kit/shaders/paperdoll-mask-ramp.effect']).toBeDefined();
    expect(cocosFiles['hero_kit/scripts/PaperDollModular.ts']).toBeDefined();

    const ccEffect = String(cocosMod.files['hero_kit/shaders/paperdoll-mask-ramp.effect']);
    expect(ccEffect).toContain('CCEffect');
    expect(ccEffect).toContain('lutTexture');
    expect(ccEffect).toContain('flashColor');
    expect(ccEffect).toContain('outlineColor');

    const ccScript = String(cocosMod.files['hero_kit/scripts/PaperDollModular.ts']);
    expect(ccScript).toContain("@ccclass('PaperDollModular')");
    expect(ccScript).toContain('resolvePartRules');
    expect(ccScript).toContain('triggerHitFlash');
    expect(ccScript).toContain('paperdoll-event');

    // 3. Dual-Engine Mode B ZIP Bundle
    const dualMod = exportDualEngineModularBundle(modular);
    expect(dualMod.zipFilename).toBe('hero_kit_godot4_cocos3_modular.zip');
    const dualFiles = unzipSync(dualMod.zip);
    expect(dualFiles['godot4/hero_kit/scripts/paperdoll_modular.gd']).toBeDefined();
    expect(dualFiles['cocos3/hero_kit/scripts/PaperDollModular.ts']).toBeDefined();
    expect(dualFiles['godot4/hero_kit/CREDITS.csv']).toBeDefined();
    expect(dualFiles['cocos3/hero_kit/CREDITS.txt']).toBeDefined();
  });

  it('exports Universal Multi-Engine Atlas (TexturePacker, Aseprite JSON, Unity .meta) and passes SHA-256 golden render determinism', () => {
    const { pack, images } = createDemoHDPackWithImages();
    const hero = new PaperDollCharacter(pack, { preset: 'knight', direction: 'SE', action: 'idle' });
    const cfg = hero.toJSON();

    const bakeOnce = () =>
      bakeCharacterSequences(
        { pack, config: cfg, images },
        {
          characterName: 'golden_knight',
          directions: ['SE', 'SW'],
          actions: ['idle'],
          frameSize: { width: 64, height: 64 },
          fpsOverride: 4,
        },
      );

    const baked1 = bakeOnce();
    const baked2 = bakeOnce();

    // Golden-render SHA-256 determinism: identical inputs must produce byte-identical atlas PNGs
    const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const hash1 = sha256(baked1.atlas.png);
    const hash2 = sha256(baked2.atlas.png);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    // Verify palette change visibly alters golden hash (ensures LUT recoloring is active)
    const recolored = new PaperDollCharacter(pack, cfg).setAllClothingPalette('crimson').toJSON();
    const bakedCrimson = bakeCharacterSequences(
      { pack, config: recolored, images },
      {
        characterName: 'golden_knight',
        directions: ['SE', 'SW'],
        actions: ['idle'],
        frameSize: { width: 64, height: 64 },
        fpsOverride: 4,
      },
    );
    expect(sha256(bakedCrimson.atlas.png)).not.toBe(hash1);

    // Universal atlas bundle validation
    const uni = exportUniversalAtlasBundle(baked1);
    expect(uni.zipFilename).toBe('golden_knight_universal_atlas.zip');
    const files = unzipSync(uni.zip);
    expect(files['golden_knight/golden_knight_atlas.png']).toBeDefined();
    expect(files['golden_knight/golden_knight_atlas.png.meta']).toBeDefined();
    expect(files['golden_knight/golden_knight_texturepacker.json']).toBeDefined();
    expect(files['golden_knight/golden_knight_aseprite.json']).toBeDefined();

    const tp = JSON.parse(String(uni.files['golden_knight/golden_knight_texturepacker.json'])) as {
      frames: Record<string, unknown>;
      animations: Record<string, string[]>;
    };
    expect(Object.keys(tp.frames).length).toBe(baked1.atlas.sprites.length);
    expect(tp.animations.idle_SE?.length).toBeGreaterThan(0);

    const ase = JSON.parse(String(uni.files['golden_knight/golden_knight_aseprite.json'])) as {
      meta: { frameTags: Array<{ name: string; from: number; to: number }> };
    };
    expect(ase.meta.frameTags.map((t) => t.name)).toEqual(['idle_SE', 'idle_SW']);

    const unityMeta = String(uni.files['golden_knight/golden_knight_atlas.png.meta']);
    expect(unityMeta).toContain('spriteMode: 2');
    expect(unityMeta).toContain('name: golden_knight_idle_SE_00');
  });
});
