import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTES,
  DEFAULT_SKINS,
  LUT_ROW,
  LUT_TEXTURE_HEIGHT,
  LUT_TEXTURE_WIDTH,
  PaperDollCharacter,
  bakeSlotLUTTexture,
  createStarterIsometricPack,
  evaluatePixelMaskRamp,
  parseColor,
  validateAssetPack,
  validateCharacterConfig,
} from '../src/index.js';

describe('@paperdollkit/core v2.0 IR & runtime', () => {
  const pack = createStarterIsometricPack();

  it('validates starter Isometric 2.5D AssetPackManifest cleanly', () => {
    const res = validateAssetPack(pack);
    expect(res.ok).toBe(true);
    expect(pack.directions).toHaveLength(8);
    expect(pack.slots).toHaveLength(17);
    expect(Object.keys(pack.palettes)).toHaveLength(10);
    expect(Object.keys(pack.skins)).toHaveLength(6);
  });

  it('detects cyclic slot hierarchy and invalid mirror targets in schema validation', () => {
    const badPack = structuredClone(pack);
    badPack.slots.find((s) => s.id === 'body_base')!.parent = 'head_base';
    badPack.directions.push({
      id: 'BROKEN',
      label: 'Broken',
      angleDeg: 0,
      facingBack: false,
      mirrorFrom: 'NON_EXISTENT',
      flipX: true,
      side: 0,
    });
    const res = validateAssetPack(badPack);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('Cycle detected'))).toBe(true);
      expect(res.errors.some((e) => e.includes('NON_EXISTENT'))).toBe(true);
    }
  });

  it('resolves 8-dir isometric mirroring (SW mirrors SE) with exact reflection symmetry', () => {
    const hero = new PaperDollCharacter(pack, { preset: 'knight', action: 'attack' });

    hero.setDirection('SE');
    const seFrame = hero.evaluate(200);

    hero.setDirection('SW');
    const swFrame = hero.evaluate(200);

    expect(seFrame.layers.length).toBe(swFrame.layers.length);
    for (let i = 0; i < seFrame.layers.length; i++) {
      const se = seFrame.layers[i]!;
      const sw = swFrame.layers[i]!;
      expect(sw.slotId).toBe(se.slotId);
      expect(sw.flipX).toBe(true);
      // Source art comes from SE asset via mirrorFrom
      expect(sw.frame.imageId).toBe(se.frame.imageId);
      // Exact horizontal mirror across canvas center (canvasSize.width = 256)
      expect(sw.worldTransform.x + se.worldTransform.x).toBeCloseTo(pack.canvasSize.width, 5);
      expect(sw.worldTransform.y).toBeCloseTo(se.worldTransform.y, 5);
      expect(sw.worldTransform.rotationDeg).toBeCloseTo(-se.worldTransform.rotationDeg, 5);
    }
  });

  it('propagates parent -> child socket transforms (body_base -> front_arm -> main_hand)', () => {
    const hero = new PaperDollCharacter(pack, { preset: 'knight', direction: 'SE', action: 'attack' });
    const rest = hero.evaluate(0);
    const windup = hero.evaluate(150);

    const armRest = rest.layers.find((l) => l.slotId === 'front_arm')!;
    const armWindup = windup.layers.find((l) => l.slotId === 'front_arm')!;
    const swordRest = rest.layers.find((l) => l.slotId === 'main_hand')!;
    const swordWindup = windup.layers.find((l) => l.slotId === 'main_hand')!;

    // At 150ms attack windup, front_arm rotates strongly backward (-65 deg) + body (-14 deg)
    expect(armWindup.worldTransform.rotationDeg).toBeLessThan(armRest.worldTransform.rotationDeg);
    // Weapon attached to front_arm's hand_main socket inherits arm rotation + its own track rotation
    expect(swordWindup.worldTransform.rotationDeg).toBeLessThan(armWindup.worldTransform.rotationDeg);
    expect(swordWindup.worldTransform.x).not.toBeCloseTo(swordRest.worldTransform.x, 1);
  });

  it('supports hybrid animation: sequence body frames + rigged equipment + dynamic Z-Order', () => {
    const hero = new PaperDollCharacter(pack, { preset: 'knight', direction: 'S', action: 'walk' });
    const f0 = hero.evaluate(0);
    const f2 = hero.evaluate(200);

    const body0 = f0.layers.find((l) => l.slotId === 'body_base')!;
    const body2 = f2.layers.find((l) => l.slotId === 'body_base')!;
    expect(body0.frame.imageId).toContain('_walk_0.png');
    expect(body2.frame.imageId).not.toBe(body0.frame.imageId);

    // Front vs Back dynamic Z-Order
    const capeIdxS = f0.layers.findIndex((l) => l.slotId === 'back_cape');
    const torsoIdxS = f0.layers.findIndex((l) => l.slotId === 'torso_top');
    expect(capeIdxS).toBeLessThan(torsoIdxS);

    hero.setDirection('N');
    const north = hero.evaluate(0);
    const capeIdxN = north.layers.findIndex((l) => l.slotId === 'back_cape');
    const torsoIdxN = north.layers.findIndex((l) => l.slotId === 'torso_top');
    expect(capeIdxN).toBeGreaterThan(torsoIdxN);
  });

  it('bakes 256×4 RGBA LUT texture and verifies Mask+Ramp recoloring & hand skin sync', () => {
    const crimson = DEFAULT_PALETTES.crimson!;
    const deepSkin = DEFAULT_SKINS.deep!;
    const woodSkin = DEFAULT_SKINS.wood!;

    // 1. Normal mode: B mask channel on front_arm uses deepSkin ramp
    const normalLut = bakeSlotLUTTexture('front_arm', crimson, deepSkin, 'none');
    expect(normalLut.width).toBe(LUT_TEXTURE_WIDTH);
    expect(normalLut.height).toBe(LUT_TEXTURE_HEIGHT);
    expect(normalLut.data.length).toBe(LUT_TEXTURE_WIDTH * LUT_TEXTURE_HEIGHT * 4);

    // Mid-high luminance grayscale albedo (~0.72 matches base stop)
    const baseGray = { r: 184, g: 184, b: 184, a: 255 };
    const pureSkinMask = { r: 0, g: 0, b: 255, a: 0 };
    const purePrimaryMask = { r: 255, g: 0, b: 0, a: 0 };
    const unmaskedLineart = { r: 0, g: 0, b: 0, a: 0 };

    const handColorNormal = evaluatePixelMaskRamp(baseGray, pureSkinMask, normalLut);
    const expectedDeepBase = parseColor('#6e422b');
    expect(Math.abs(handColorNormal.r - expectedDeepBase.r)).toBeLessThanOrEqual(3);
    expect(Math.abs(handColorNormal.g - expectedDeepBase.g)).toBeLessThanOrEqual(3);
    expect(Math.abs(handColorNormal.b - expectedDeepBase.b)).toBeLessThanOrEqual(3);

    // Primary sleeve mask maps to crimson base (#d63e47)
    const sleeveColor = evaluatePixelMaskRamp(baseGray, purePrimaryMask, normalLut);
    const expectedCrimsonBase = parseColor('#d63e47');
    expect(Math.abs(sleeveColor.r - expectedCrimsonBase.r)).toBeLessThanOrEqual(3);
    expect(Math.abs(sleeveColor.g - expectedCrimsonBase.g)).toBeLessThanOrEqual(3);
    expect(Math.abs(sleeveColor.b - expectedCrimsonBase.b)).toBeLessThanOrEqual(3);

    // Unmasked pixel keeps original albedo RGB untouched (preserves dark lineart / highlights)
    const lineartAlbedo = { r: 25, g: 30, b: 40, a: 255 };
    const untouched = evaluatePixelMaskRamp(lineartAlbedo, unmaskedLineart, normalLut);
    expect(untouched).toEqual(lineartAlbedo);

    // 2. baked_wood bug mode: arm skin row falls back to wood instead of deepSkin
    const bugWoodLut = bakeSlotLUTTexture('front_arm', crimson, deepSkin, 'baked_wood');
    const handColorWood = evaluatePixelMaskRamp(baseGray, pureSkinMask, bugWoodLut);
    const expectedWoodBase = parseColor(woodSkin.swatch);
    expect(Math.abs(handColorWood.r - expectedWoodBase.r)).toBeLessThanOrEqual(3);

    // 3. dyed_sleeve bug mode: arm skin row mistakenly samples primary clothing ramp
    const bugSleeveLut = bakeSlotLUTTexture('front_arm', crimson, deepSkin, 'dyed_sleeve');
    const handColorDyed = evaluatePixelMaskRamp(baseGray, pureSkinMask, bugSleeveLut);
    expect(handColorDyed).toEqual(sleeveColor);

    // Row index sanity check
    expect(LUT_ROW.SKIN).toBe(2);
  });

  it('roundtrips CharacterConfig JSON cleanly with validation', () => {
    const hero = new PaperDollCharacter(pack, { preset: 'knight' });
    hero.setSkin('elf').setDirection('NW').setAction('cast').setAllClothingPalette('violet');

    const json = hero.toJSON();
    const validation = validateCharacterConfig(json, pack);
    expect(validation.ok).toBe(true);

    const restored = PaperDollCharacter.fromJSON(pack, json);
    expect(restored.toJSON()).toEqual(json);
    expect(restored.getActiveLayerCount()).toBe(hero.getActiveLayerCount());
  });

  it('evaluates PartRules (hidesSlots & overrideSlots) without mutating underlying slots', () => {
    const ruledPack = createStarterIsometricPack();
    const hatPart = ruledPack.parts.head_hat?.[0];
    const hairParts = ruledPack.parts.hair_style ?? [];
    expect(hatPart).toBeDefined();
    expect(hairParts.length).toBeGreaterThanOrEqual(1);

    // Ensure at least two hair parts exist for overrideSlots testing
    if (hairParts.length < 2) {
      hairParts.push({
        ...hairParts[0]!,
        id: 'hair_long_test',
        name: '测试长发',
      });
    }

    // Attach hidesSlots rule to helmet
    hatPart!.rules = { hidesSlots: ['hair_style'] };

    // Add a second hood-like hat with overrideSlots rule
    const hoodPart = {
      ...hatPart!,
      id: 'hood_test',
      name: '测试兜帽',
      rules: { overrideSlots: { hair_style: hairParts[0]!.id } },
    };
    ruledPack.parts.head_hat!.push(hoodPart);

    const validPack = validateAssetPack(ruledPack);
    expect(validPack.ok).toBe(true);

    // 1. Equipping full helmet hides hair_style while keeping config.slots.hair_style intact
    const hero = new PaperDollCharacter(ruledPack, {
      slots: {
        head_hat: hatPart!.id,
        hair_style: hairParts[1]!.id,
      },
    });
    const frameHidden = hero.evaluate(0);
    expect(frameHidden.layers.some((l) => l.slotId === 'hair_style')).toBe(false);
    expect(frameHidden.suppressedSlots?.hair_style).toMatchObject({
      bySlotId: 'head_hat',
      byPartId: hatPart!.id,
      reason: 'hidden',
    });
    expect(hero.slots.hair_style).toBe(hairParts[1]!.id);

    // 2. Hiding the helmet layer lifts its suppression rule
    hero.setSlotVisible('head_hat', false);
    const frameVisibleAgain = hero.evaluate(0);
    expect(frameVisibleAgain.layers.some((l) => l.slotId === 'hair_style')).toBe(true);
    expect(frameVisibleAgain.suppressedSlots?.hair_style).toBeUndefined();

    // 3. Switching to hood overrides long hair -> short hair without mutating config.slots
    hero.setSlotVisible('head_hat', true).setSlot('head_hat', 'hood_test');
    const frameOverride = hero.evaluate(0);
    const hairLayer = frameOverride.layers.find((l) => l.slotId === 'hair_style');
    expect(hairLayer?.partId).toBe(hairParts[0]!.id);
    expect(frameOverride.suppressedSlots?.hair_style).toMatchObject({
      bySlotId: 'head_hat',
      byPartId: 'hood_test',
      reason: 'overridden',
      overridePartId: hairParts[0]!.id,
    });
    expect(hero.slots.hair_style).toBe(hairParts[1]!.id);

    // 4. Unequipping hat restores original hair_style automatically
    hero.setSlot('head_hat', 'none');
    const frameRestored = hero.evaluate(0);
    expect(frameRestored.layers.find((l) => l.slotId === 'hair_style')?.partId).toBe(hairParts[1]!.id);
    expect(frameRestored.suppressedSlots).toBeUndefined();

    // 5. Validator catches invalid rule target slot
    hatPart!.rules = { hidesSlots: ['nonexistent_slot'] };
    const invalidPack = validateAssetPack(ruledPack);
    expect(invalidPack.ok).toBe(false);
  });
});
