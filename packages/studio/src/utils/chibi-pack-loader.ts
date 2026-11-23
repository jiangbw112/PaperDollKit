import {
  DEFAULT_ARPG_ANIMATIONS,
  DEFAULT_ISOMETRIC_Z_ORDER,
  DEFAULT_PALETTES,
  DEFAULT_SKINS,
  ISOMETRIC_8_DIRECTIONS,
  SCHEMA_VERSION,
  STANDARD_17_SLOTS,
  type AssetPackManifest,
  type PartAsset,
  type SlotDefinition,
  type SpriteFrameRef,
} from '@paperdollkit/core';
import type { ImportedImage } from '@paperdollkit/importers';

type SizeMap = Record<string, { width: number; height: number }>;

async function fetchImageRGBA(url: string, id: string): Promise<ImportedImage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch chibi asset "${url}" (${res.status})`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context while decoding PNG asset.');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return {
    id,
    width: imgData.width,
    height: imgData.height,
    data: imgData.data,
  };
}

const CANONICAL_FRONT_DIRS = ['S', 'SE', 'E'] as const;
const CANONICAL_BACK_DIRS = ['N', 'NE'] as const;

/**
 * Loads the Q-version (Chibi) HD painted 2D Diablo-isometric asset pack
 * from `/assets/chibi-hero/` (real external PNG albedos + paired RGBA semantic masks).
 */
export async function loadChibiHDPack(basePath = '/assets/chibi-hero'): Promise<{
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
}> {
  const sizesRes = await fetch(`${basePath}/sizes.json`);
  if (!sizesRes.ok) {
    throw new Error(`Failed to fetch chibi pack sizes.json (${sizesRes.status})`);
  }
  const sizes = (await sizesRes.json()) as SizeMap;

  const images = new Map<string, ImportedImage>();
  const fetchJobs: Promise<void>[] = [];

  const queueAsset = (key: string, hasMask = true) => {
    const albedoId = `${key}.png`;
    if (!images.has(albedoId)) {
      fetchJobs.push(
        fetchImageRGBA(`${basePath}/${albedoId}`, albedoId).then((img) => {
          images.set(albedoId, img);
        }),
      );
    }
    if (hasMask) {
      const maskId = `${key}_mask.png`;
      if (!images.has(maskId)) {
        fetchJobs.push(
          fetchImageRGBA(`${basePath}/${maskId}`, maskId).then((img) => {
            images.set(maskId, img);
          }),
        );
      }
    }
  };

  const makeFrame = (
    key: string,
    pivot: { x: number; y: number },
    hasMask = true,
    sockets?: SpriteFrameRef['sockets'],
  ): SpriteFrameRef => {
    queueAsset(key, hasMask);
    const dim = sizes[key] ?? { width: 96, height: 96 };
    return {
      imageId: `${key}.png`,
      sourceRect: { x: 0, y: 0, width: dim.width, height: dim.height },
      originalSize: { width: dim.width, height: dim.height },
      trimOffset: { x: 0, y: 0 },
      pivot,
      maskImageId: hasMask ? `${key}_mask.png` : undefined,
      maskRect: hasMask ? { x: 0, y: 0, width: dim.width, height: dim.height } : undefined,
      sockets,
    };
  };

  // Chibi 2.2-head-tall tuned slot hierarchy (SE 3/4 view: near shoulder on viewer-left x<0, far shoulder on viewer-right x>0)
  const chibiSlots: SlotDefinition[] = STANDARD_17_SLOTS.map((s) => {
    const overrides: Partial<Record<string, Partial<SlotDefinition>>> = {
      shadow: { defaultOffset: { x: 0, y: 2 } },
      body_base: { defaultOffset: { x: 0, y: -2 }, defaultPivot: { x: 0.5, y: 0.92 } },
      legs_bottom: { defaultOffset: { x: 0, y: -44 }, defaultPivot: { x: 0.5, y: 0.15 } },
      feet_shoes: { defaultOffset: { x: 0, y: 24 }, defaultPivot: { x: 0.5, y: 0.5 } },
      torso_top: { defaultOffset: { x: 0, y: -56 }, defaultPivot: { x: 0.5, y: 0.65 } },
      belt_waist: { defaultOffset: { x: 0, y: 12 }, defaultPivot: { x: 0.5, y: 0.5 } },
      back_cape: { defaultOffset: { x: -4, y: -80 }, defaultPivot: { x: 0.5, y: 0.14 } },
      back_prop: { defaultOffset: { x: 0, y: -74 }, defaultPivot: { x: 0.5, y: 0.5 } },
      front_arm: { defaultOffset: { x: -24, y: -72 }, defaultPivot: { x: 0.72, y: 0.18 } },
      main_hand: { defaultOffset: { x: -22, y: 34 }, defaultPivot: { x: 0.28, y: 0.78 } },
      back_arm: { defaultOffset: { x: 24, y: -72 }, defaultPivot: { x: 0.30, y: 0.18 } },
      off_hand: { defaultOffset: { x: 10, y: 26 }, defaultPivot: { x: 0.5, y: 0.5 } },
      head_base: { defaultOffset: { x: 0, y: -88 }, defaultPivot: { x: 0.5, y: 0.85 } },
      hair_style: { defaultOffset: { x: 0, y: -38 }, defaultPivot: { x: 0.5, y: 0.55 } },
      head_hat: { defaultOffset: { x: 0, y: -42 }, defaultPivot: { x: 0.5, y: 0.62 } },
    };
    const ov = overrides[s.id];
    return ov ? { ...s, ...ov } : { ...s };
  });

  const parts: Record<string, PartAsset[]> = {};
  for (const s of chibiSlots) {
    parts[s.id] = [];
  }

  const registerDualFacingPart = (
    slotId: string,
    id: string,
    name: string,
    frontFrame: SpriteFrameRef,
    backFrame: SpriteFrameRef,
    recolorMode: PartAsset['recolorMode'] = 'mask_ramp',
    walkSeq?: { front: SpriteFrameRef[]; back: SpriteFrameRef[]; fps?: number },
  ) => {
    const directions: PartAsset['directions'] = {};
    for (const d of CANONICAL_FRONT_DIRS) {
      directions[d] = walkSeq
        ? {
            mode: 'sequence',
            frames: [frontFrame],
            actionFrames: { walk: walkSeq.front },
            fps: walkSeq.fps ?? 8,
          }
        : { mode: 'rigged', frames: [frontFrame] };
    }
    for (const d of CANONICAL_BACK_DIRS) {
      directions[d] = walkSeq
        ? {
            mode: 'sequence',
            frames: [backFrame],
            actionFrames: { walk: walkSeq.back },
            fps: walkSeq.fps ?? 8,
          }
        : { mode: 'rigged', frames: [backFrame] };
    }
    parts[slotId]!.push({ id, name, slotId, recolorMode, directions });
  };

  /** Computes exact normalized pivot inside a symmetrically padded walk frame so idle & walk align 1:1. */
  const paddedPivot = (
    baseKey: string,
    basePivot: { x: number; y: number },
    padX: number,
    padY: number,
  ) => {
    const orig = sizes[baseKey] ?? { width: 60, height: 76 };
    return {
      x: (basePivot.x * orig.width + padX) / (orig.width + padX * 2),
      y: (basePivot.y * orig.height + padY) / (orig.height + padY * 2),
    };
  };

  const makeWalkFrames = (
    baseKey: string,
    basePivot: { x: number; y: number },
    padX: number,
    padY: number,
    sockets?: SpriteFrameRef['sockets'],
  ): SpriteFrameRef[] => {
    const p = paddedPivot(baseKey, basePivot, padX, padY);
    return [0, 1, 2, 3, 4, 5].map((idx) => makeFrame(`${baseKey}_walk_${idx}`, p, true, sockets));
  };

  // Shadow
  const shadowFrame = makeFrame('shadow_oval', { x: 0.5, y: 0.5 }, false);
  registerDualFacingPart('shadow', 'oval', '柔光椭圆投影', shadowFrame, shadowFrame, 'none');

  // Body base (upper torso/tunic/neck only — legs live cleanly in legs_bottom so bare legs NEVER peek behind armor!)
  const bodySockets: SpriteFrameRef['sockets'] = {
    neck: { x: 0, y: -86 },
    shoulder_front: { x: -24, y: -72 },
    shoulder_back: { x: 24, y: -72 },
    back_mount: { x: -4, y: -76 },
  };
  const bodyFront = makeFrame('body_base_front', { x: 0.5, y: 0.92 }, true, bodySockets);
  registerDualFacingPart('body_base', 'chibi_body', 'Q版上身素体', bodyFront, bodyFront, 'mask_ramp');

  // Legs (6-frame stride sequences for both armored greaves and bare chibi legs!)
  registerDualFacingPart(
    'legs_bottom',
    'greaves',
    '重甲护腿战靴',
    makeFrame('legs_greaves_front', { x: 0.5, y: 0.18 }),
    makeFrame('legs_greaves_back', { x: 0.5, y: 0.18 }),
    'mask_ramp',
    {
      front: makeWalkFrames('legs_greaves_front', { x: 0.5, y: 0.18 }, 18, 10),
      back: makeWalkFrames('legs_greaves_back', { x: 0.5, y: 0.18 }, 18, 10),
      fps: 8,
    },
  );
  const bareLegsIdle = makeFrame('legs_bare_front', { x: 0.5, y: 0.08 });
  const bareLegsWalk = makeWalkFrames('legs_bare_front', { x: 0.5, y: 0.08 }, 16, 10);
  registerDualFacingPart(
    'legs_bottom',
    'bare_legs',
    '素体赤足双腿',
    bareLegsIdle,
    bareLegsIdle,
    'mask_ramp',
    {
      front: bareLegsWalk,
      back: bareLegsWalk,
      fps: 8,
    },
  );

  // Torso Top
  registerDualFacingPart(
    'torso_top',
    'plate_cuirass',
    '圣殿板甲胸铠',
    makeFrame('torso_plate_front', { x: 0.5, y: 0.62 }),
    makeFrame('torso_plate_back', { x: 0.5, y: 0.62 }),
  );
  registerDualFacingPart(
    'torso_top',
    'mage_robe',
    '奥术符文法袍',
    makeFrame('torso_robe_front', { x: 0.5, y: 0.60 }),
    makeFrame('torso_robe_back', { x: 0.5, y: 0.60 }),
  );

  // Belt
  const beltFrame = makeFrame('belt_gold', { x: 0.5, y: 0.52 });
  registerDualFacingPart('belt_waist', 'gold_belt', '圣徽腰带', beltFrame, beltFrame);

  // Back Cape & Props
  const capeFrame = makeFrame('cape_long', { x: 0.52, y: 0.14 });
  registerDualFacingPart('back_cape', 'cloak_long', '骑士长斗篷', capeFrame, capeFrame);

  const wingsFrame = makeFrame('prop_wings', { x: 0.5, y: 0.52 });
  registerDualFacingPart('back_prop', 'wings', '炽天使羽翼', wingsFrame, wingsFrame);

  const quiverFrame = makeFrame('prop_quiver', { x: 0.5, y: 0.55 });
  registerDualFacingPart('back_prop', 'quiver', '游侠箭袋', quiverFrame, quiverFrame);

  // Arms (with hand sockets + B-channel skin palm!)
  const frontArmArmor = makeFrame('arm_armor_front', { x: 0.30, y: 0.16 }, true, {
    hand_main: { x: 18, y: 42, rotationDeg: 18 },
  });
  const frontArmCloth = makeFrame('arm_cloth_front', { x: 0.62, y: 0.16 }, true, {
    hand_main: { x: -24, y: 44, rotationDeg: -16 },
  });
  registerDualFacingPart('front_arm', 'armor_sleeve', '臂铠护腕', frontArmArmor, frontArmArmor);
  registerDualFacingPart('front_arm', 'cloth_sleeve', '法师长袖', frontArmCloth, frontArmCloth);

  const backArmCloth = makeFrame('arm_cloth_front', { x: 0.52, y: 0.16 }, true, {
    hand_off: { x: 14, y: 34, rotationDeg: 4 },
  });
  const backArmArmor = makeFrame('arm_armor_front', { x: 0.32, y: 0.16 }, true, {
    hand_off: { x: 20, y: 34, rotationDeg: 6 },
  });
  registerDualFacingPart('back_arm', 'cloth_sleeve', '法师长袖', backArmCloth, backArmCloth);
  registerDualFacingPart('back_arm', 'armor_sleeve', '臂铠护腕', backArmArmor, backArmArmor);

  // Head Base (adorable chibi eyes on front, smooth rear head on back!)
  const headSockets: SpriteFrameRef['sockets'] = {
    head_top: { x: 0, y: -40 },
  };
  registerDualFacingPart(
    'head_base',
    'chibi_head',
    'Q版萌系头型',
    makeFrame('head_base_front', { x: 0.5, y: 0.86 }, true, headSockets),
    makeFrame('head_base_back', { x: 0.5, y: 0.86 }, true, headSockets),
  );

  // Hair Styles (open-face bangs+crown on front, full spiky hair on back!)
  registerDualFacingPart(
    'hair_style',
    'hero_crown',
    '王冠碎发',
    makeFrame('hair_crown_front', { x: 0.52, y: 0.58 }),
    makeFrame('hair_spiky_back', { x: 0.50, y: 0.52 }),
  );
  registerDualFacingPart(
    'hair_style',
    'spiky_back',
    '蓬松短发(背)',
    makeFrame('hair_full_front', { x: 0.50, y: 0.52 }),
    makeFrame('hair_spiky_back', { x: 0.50, y: 0.52 }),
  );

  // Head Hats
  registerDualFacingPart(
    'head_hat',
    'knight_helm',
    '羽饰骑士盔',
    makeFrame('helm_knight_front', { x: 0.58, y: 0.60 }),
    makeFrame('helm_knight_back', { x: 0.50, y: 0.62 }),
  );
  const wizardHatFrame = makeFrame('hat_wizard', { x: 0.50, y: 0.86 });
  registerDualFacingPart('head_hat', 'wizard_hat', '星辰法师帽', wizardHatFrame, wizardHatFrame);

  const hoodFrame = makeFrame('hat_hood_front', { x: 0.52, y: 0.44 });
  registerDualFacingPart('head_hat', 'hood', '游侠兜帽', hoodFrame, hoodFrame);

  // Main Hand Weapons
  const swordFrame = makeFrame('weapon_sword', { x: 0.22, y: 0.80 });
  registerDualFacingPart('main_hand', 'broadsword', '圣殿长剑', swordFrame, swordFrame);

  const staffFrame = makeFrame('weapon_staff', { x: 0.36, y: 0.62 });
  registerDualFacingPart('main_hand', 'arcane_staff', '秘法水晶杖', staffFrame, staffFrame);

  const axeFrame = makeFrame('weapon_axe', { x: 0.22, y: 0.80 });
  registerDualFacingPart('main_hand', 'battle_axe', '双刃战斧', axeFrame, axeFrame);

  // Off Hand Equipment
  const shieldFrame = makeFrame('offhand_shield', { x: 0.5, y: 0.5 });
  registerDualFacingPart('off_hand', 'kite_shield', '纹章重盾', shieldFrame, shieldFrame);

  const tomeFrame = makeFrame('offhand_tome', { x: 0.5, y: 0.5 });
  registerDualFacingPart('off_hand', 'spell_tome', '魔法典籍', tomeFrame, tomeFrame);

  await Promise.all(fetchJobs);

  const pack: AssetPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: 'chibi-fantasy-hd',
    name: 'Q版暗黑奇幻高清角色包 (256×256)',
    canvasSize: { width: 256, height: 256 },
    perspective: 'isometric_8',
    directions: ISOMETRIC_8_DIRECTIONS,
    slots: chibiSlots,
    zOrder: DEFAULT_ISOMETRIC_Z_ORDER,
    palettes: DEFAULT_PALETTES,
    skins: DEFAULT_SKINS,
    parts,
    animations: DEFAULT_ARPG_ANIMATIONS,
    presets: [
      {
        id: 'prince_knight',
        name: '皇冠骑士',
        tag: '主角颜值',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'chibi_body', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'chibi_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'hero_crown', head_hat: 'none', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'cobalt', torso_top: 'cobalt', belt_waist: 'cobalt',
          back_arm: 'cobalt', off_hand: 'cobalt', hair_style: 'bronze', front_arm: 'cobalt', main_hand: 'cobalt',
        },
      },
      {
        id: 'heavy_knight',
        name: '羽盔重甲',
        tag: '重装坦克',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'chibi_body', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'chibi_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'none', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'crimson', torso_top: 'crimson', belt_waist: 'crimson',
          back_arm: 'crimson', off_hand: 'crimson', head_hat: 'crimson', front_arm: 'crimson', main_hand: 'crimson',
        },
      },
      {
        id: 'archmage',
        name: '星辰法师',
        tag: '元素奥术',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'chibi_body', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'mage_robe', belt_waist: 'none',
          back_arm: 'cloth_sleeve', off_hand: 'spell_tome', head_base: 'chibi_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'none', head_hat: 'wizard_hat', front_arm: 'cloth_sleeve', main_hand: 'arcane_staff',
        },
        palettes: {
          back_cape: 'violet', legs_bottom: 'obsidian', torso_top: 'violet',
          back_arm: 'violet', off_hand: 'crimson', head_hat: 'violet', front_arm: 'violet', main_hand: 'frost',
        },
      },
      {
        id: 'seraph_paladin',
        name: '炽天使',
        tag: '圣光羽翼',
        skin: 'tan',
        slots: {
          shadow: 'oval', body_base: 'chibi_body', back_cape: 'none', back_prop: 'wings',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'chibi_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'hero_crown', head_hat: 'none', front_arm: 'armor_sleeve', main_hand: 'battle_axe',
        },
        palettes: {
          back_prop: 'ivory', legs_bottom: 'ivory', torso_top: 'ivory', belt_waist: 'amber',
          back_arm: 'ivory', off_hand: 'ivory', hair_style: 'sakura', front_arm: 'ivory', main_hand: 'amber',
        },
      },
      {
        id: 'emerald_ranger',
        name: '翡翠游侠',
        tag: '潜行暗影',
        skin: 'bronze',
        slots: {
          shadow: 'oval', body_base: 'chibi_body', back_cape: 'cloak_long', back_prop: 'quiver',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'mage_robe', belt_waist: 'gold_belt',
          back_arm: 'cloth_sleeve', off_hand: 'none', head_base: 'chibi_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'none', head_hat: 'hood', front_arm: 'cloth_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'emerald', back_prop: 'bronze', legs_bottom: 'obsidian', torso_top: 'emerald',
          belt_waist: 'bronze', back_arm: 'emerald', head_hat: 'emerald', front_arm: 'emerald', main_hand: 'emerald',
        },
      },
    ],
  };

  return { pack, images };
}
