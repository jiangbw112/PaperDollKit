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

interface AtlasFrameEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  hasMask: boolean;
}

interface AtlasManifestJson {
  width: number;
  height: number;
  frames: Record<string, AtlasFrameEntry>;
}

async function fetchImageRGBA(url: string, id: string): Promise<ImportedImage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch sticker asset "${url}" (${res.status})`);
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

const CANONICAL_DIRS = ['S', 'SE', 'E', 'NE', 'N'] as const;
const ALBEDO_ATLAS_ID = 'sticker/albedo_atlas.png';
const MASK_ATLAS_ID = 'sticker/mask_atlas.png';

/**
 * Loads the minimalist flat-cartoon paper-sticker / wooden-doll character pack
 * inspired by 0xsu.com/lessons/ep01 ("从一个木头人开始") from just 3 files:
 *   - atlas.json
 *   - albedo_atlas.png
 *   - mask_atlas.png
 *
 * Instant loading (<150ms even over proxied remote preview tunnels) + single-atlas GPU rendering!
 */
export async function loadStickerHDPack(basePath = './assets/sticker-hero'): Promise<{
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
}> {
  const [atlasRes, albedoImg, maskImg] = await Promise.all([
    fetch(`${basePath}/atlas.json`).then(async (r) => {
      if (!r.ok) throw new Error(`Failed to fetch sticker atlas.json (${r.status})`);
      return (await r.json()) as AtlasManifestJson;
    }),
    fetchImageRGBA(`${basePath}/albedo_atlas.png`, ALBEDO_ATLAS_ID),
    fetchImageRGBA(`${basePath}/mask_atlas.png`, MASK_ATLAS_ID),
  ]);

  const images = new Map<string, ImportedImage>([
    [ALBEDO_ATLAS_ID, albedoImg],
    [MASK_ATLAS_ID, maskImg],
  ]);

  const makeFrame = (
    key: string,
    pivot: { x: number; y: number },
    hasMask = true,
    sockets?: SpriteFrameRef['sockets'],
  ): SpriteFrameRef => {
    const entry = atlasRes.frames[key] ?? { x: 0, y: 0, w: 64, h: 64, hasMask: false };
    const rect = { x: entry.x, y: entry.y, width: entry.w, height: entry.h };
    const useMask = hasMask && entry.hasMask;
    return {
      imageId: ALBEDO_ATLAS_ID,
      sourceRect: rect,
      originalSize: { width: entry.w, height: entry.h },
      trimOffset: { x: 0, y: 0 },
      pivot,
      maskImageId: useMask ? MASK_ATLAS_ID : undefined,
      maskRect: useMask ? rect : undefined,
      sockets,
    };
  };

  // Stylized wooden-peg / paper-sticker slot hierarchy (256x256 canvas, foot origin at (128, 224))
  const stickerSlots: SlotDefinition[] = STANDARD_17_SLOTS.map((s) => {
    const overrides: Partial<Record<string, Partial<SlotDefinition>>> = {
      shadow:      { defaultOffset: { x: 0, y: 0 } },
      body_base:   { defaultOffset: { x: 0, y: -34 }, defaultPivot: { x: 0.5, y: 0.85 } },
      legs_bottom: { defaultOffset: { x: 0, y: -12 }, defaultPivot: { x: 0.5, y: 0.25 } },
      torso_top:   { defaultOffset: { x: 0, y: -26 }, defaultPivot: { x: 0.5, y: 0.58 } },
      belt_waist:  { defaultOffset: { x: 0, y: 20 },  defaultPivot: { x: 0.5, y: 0.50 } },
      back_cape:   { defaultOffset: { x: -2, y: -54 }, defaultPivot: { x: 0.5, y: 0.16 } },
      back_prop:   { defaultOffset: { x: 0, y: -42 }, defaultPivot: { x: 0.5, y: 0.50 } },
      front_arm:   { defaultOffset: { x: -27, y: -46 }, defaultPivot: { x: 0.5, y: 0.20 } },
      main_hand:   { defaultOffset: { x: 0, y: 40 },  defaultPivot: { x: 0.35, y: 0.72 } },
      back_arm:    { defaultOffset: { x: 27, y: -46 }, defaultPivot: { x: 0.5, y: 0.20 } },
      off_hand:    { defaultOffset: { x: 6, y: 36 },  defaultPivot: { x: 0.5, y: 0.50 } },
      head_base:   { defaultOffset: { x: 0, y: -62 }, defaultPivot: { x: 0.5, y: 0.78 } },
      face_eyes:   { defaultOffset: { x: 0, y: -24 }, defaultPivot: { x: 0.5, y: 0.50 } },
      hair_style:  { defaultOffset: { x: 0, y: -32 }, defaultPivot: { x: 0.5, y: 0.52 } },
      head_hat:    { defaultOffset: { x: 0, y: -34 }, defaultPivot: { x: 0.5, y: 0.58 } },
    };
    const ov = overrides[s.id];
    return ov ? { ...s, ...ov } : { ...s };
  });

  const parts: Record<string, PartAsset[]> = {};
  for (const s of stickerSlots) {
    parts[s.id] = [];
  }

  const addDirectionalPart = (
    slotId: string,
    id: string,
    name: string,
    recolorMode: PartAsset['recolorMode'],
    builder: (dir: string) => PartAsset['directions'][string],
  ) => {
    const directions: PartAsset['directions'] = {};
    for (const d of CANONICAL_DIRS) {
      directions[d] = builder(d);
    }
    parts[slotId]!.push({ id, name, slotId, recolorMode, directions });
  };

  const addSharedPart = (
    slotId: string,
    id: string,
    name: string,
    frame: SpriteFrameRef,
    recolorMode: PartAsset['recolorMode'] = 'mask_ramp',
  ) => {
    addDirectionalPart(slotId, id, name, recolorMode, () => ({
      mode: 'rigged',
      frames: [frame],
    }));
  };

  // 1. Shadow
  addSharedPart('shadow', 'oval', '贴纸投影', makeFrame('shadow_oval', { x: 0.5, y: 0.5 }, false), 'none');

  // 2. Body Base (wooden peg-doll upper torso, with direction-aware shoulder sockets!)
  addDirectionalPart('body_base', 'mannequin', '原木木头人素体', 'mask_ramp', (d) => {
    const sx = d === 'E' ? 0.78 : d === 'SE' || d === 'NE' ? 0.94 : 1.0;
    const sockets: SpriteFrameRef['sockets'] = {
      neck: { x: 0, y: -62 },
      shoulder_front: { x: -27 * sx, y: -46 },
      shoulder_back: { x: 27 * sx, y: -46 },
      back_mount: { x: -2 * sx, y: -52 },
    };
    return {
      mode: 'rigged',
      frames: [makeFrame(`body_base_${d}`, { x: 0.5, y: 0.85 }, true, sockets)],
    };
  });

  // 3. Legs Bottom (all 3 styles have full 6-frame walking stride across all 5 canonical facings!)
  const addLegsStyle = (id: string, name: string, prefix: string) => {
    addDirectionalPart('legs_bottom', id, name, 'mask_ramp', (d) => ({
      mode: 'sequence',
      frames: [makeFrame(`${prefix}_${d}`, { x: 0.5, y: 0.25 })],
      actionFrames: {
        walk: [0, 1, 2, 3, 4, 5].map((i) =>
          makeFrame(`${prefix}_${d}_walk_${i}`, { x: 0.5, y: 0.25 }),
        ),
      },
      fps: 8,
    }));
  };
  addLegsStyle('bare_legs', '木头人素体腿', 'legs_bare');
  addLegsStyle('greaves', '骑士靴护腿', 'legs_greaves');
  addLegsStyle('robe_skirt', '法师长裙靴', 'legs_robe_skirt');

  // 4. Torso Top
  addDirectionalPart('torso_top', 'plate_cuirass', '卡通板甲胸铠', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`torso_plate_${d}`, { x: 0.5, y: 0.58 })],
  }));
  addDirectionalPart('torso_top', 'mage_robe', '魔法师长袍', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`torso_robe_${d}`, { x: 0.5, y: 0.58 })],
  }));
  addDirectionalPart('torso_top', 'ranger_vest', '游侠皮甲背心', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`torso_vest_${d}`, { x: 0.5, y: 0.58 })],
  }));

  // 5. Belt
  addDirectionalPart('belt_waist', 'gold_belt', '扣带腰带', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`belt_gold_${d}`, { x: 0.5, y: 0.5 })],
  }));

  // 6. Back Cape & Back Props
  addDirectionalPart('back_cape', 'cloak_long', '骑士斗篷', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`cape_long_${d}`, { x: 0.5, y: 0.16 })],
  }));
  addSharedPart('back_prop', 'wings', '小天使羽翼', makeFrame('prop_wings', { x: 0.5, y: 0.5 }));
  addSharedPart('back_prop', 'quiver', '游侠箭袋', makeFrame('prop_quiver', { x: 0.5, y: 0.5 }));

  // 7. Arms (front & back — sleeve R + cute round cartoon hand palm B!)
  const makeArmSet = (slotId: 'front_arm' | 'back_arm') => {
    const socketName = slotId === 'front_arm' ? 'hand_main' : 'hand_off';
    const handSocket: SpriteFrameRef['sockets'] = {
      [socketName]: slotId === 'front_arm'
        ? { x: -4, y: 42, rotationDeg: 6 }
        : { x: 6, y: 38, rotationDeg: -4 },
    };
    addSharedPart(slotId, 'bare_arm', '木头人素体臂', makeFrame('arm_bare', { x: 0.5, y: 0.20 }, true, handSocket));
    addSharedPart(slotId, 'cloth_sleeve', '长袖布衣臂', makeFrame('arm_cloth', { x: 0.5, y: 0.20 }, true, handSocket));
    addSharedPart(slotId, 'armor_sleeve', '臂铠护腕臂', makeFrame('arm_armor', { x: 0.5, y: 0.20 }, true, handSocket));
  };
  makeArmSet('front_arm');
  makeArmSet('back_arm');

  // 8. Head Base
  addDirectionalPart('head_base', 'mannequin_head', '木头人圆头', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [
      makeFrame(`head_base_${d}`, { x: 0.5, y: 0.78 }, true, {
        head_top: { x: 0, y: -32 },
      }),
    ],
  }));

  // 9. Swappable Sticker Faces (0xsu ep06 style!)
  addDirectionalPart('face_eyes', 'dot', '豆豆眼微笑', 'none', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`face_dot_${d}`, { x: 0.5, y: 0.5 }, false)],
  }));
  addDirectionalPart('face_eyes', 'happy', '开心弯月眼', 'none', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`face_happy_${d}`, { x: 0.5, y: 0.5 }, false)],
  }));
  addDirectionalPart('face_eyes', 'sharp', '坚毅战瞳', 'none', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`face_sharp_${d}`, { x: 0.5, y: 0.5 }, false)],
  }));
  addDirectionalPart('face_eyes', 'arcane', '奥术发光瞳', 'none', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`face_arcane_${d}`, { x: 0.5, y: 0.5 }, false)],
  }));

  // 10. Hair Styles
  addDirectionalPart('hair_style', 'short', '蓬松短刘海', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hair_short_${d}`, { x: 0.5, y: 0.52 })],
  }));
  addDirectionalPart('hair_style', 'hero_crown', '小王冠短发', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hair_crown_${d}`, { x: 0.5, y: 0.54 })],
  }));
  addDirectionalPart('hair_style', 'long', '披肩长发', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hair_long_${d}`, { x: 0.5, y: 0.48 })],
  }));

  // 11. Hats
  addDirectionalPart('head_hat', 'knight_helm', '羽饰骑士盔', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hat_knight_helm_${d}`, { x: 0.5, y: 0.48 })],
  }));
  addDirectionalPart('head_hat', 'wizard_hat', '星辰法师帽', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hat_wizard_hat_${d}`, { x: 0.5, y: 0.86 })],
  }));
  addDirectionalPart('head_hat', 'hood', '游侠兜帽', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [makeFrame(`hat_hood_${d}`, { x: 0.5, y: 0.42 })],
  }));

  // 12. Weapons & Offhands
  addSharedPart('main_hand', 'broadsword', '骑士长剑', makeFrame('weapon_sword', { x: 0.34, y: 0.72 }));
  addSharedPart('main_hand', 'arcane_staff', '星辰法杖', makeFrame('weapon_staff', { x: 0.40, y: 0.68 }));
  addSharedPart('main_hand', 'battle_axe', '双刃战斧', makeFrame('weapon_axe', { x: 0.35, y: 0.72 }));
  addSharedPart('off_hand', 'kite_shield', '纹章圆盾', makeFrame('offhand_shield', { x: 0.5, y: 0.5 }));
  addSharedPart('off_hand', 'spell_tome', '魔法典籍', makeFrame('offhand_tome', { x: 0.5, y: 0.5 }));

  const pack: AssetPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: 'sticker-doll-hd',
    name: '0xsu 风极简贴纸木头人角色包 (256×256)',
    canvasSize: { width: 256, height: 256 },
    perspective: 'isometric_8',
    directions: ISOMETRIC_8_DIRECTIONS,
    slots: stickerSlots,
    zOrder: DEFAULT_ISOMETRIC_Z_ORDER,
    palettes: DEFAULT_PALETTES,
    skins: DEFAULT_SKINS,
    parts,
    animations: DEFAULT_ARPG_ANIMATIONS,
    presets: [
      {
        id: 'mannequin',
        name: '木头人',
        tag: '00·原木素体',
        skin: 'wood',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'none', back_prop: 'none',
          legs_bottom: 'bare_legs', feet_shoes: 'none', torso_top: 'none', belt_waist: 'none',
          back_arm: 'bare_arm', off_hand: 'none', head_base: 'mannequin_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'none', head_hat: 'none', front_arm: 'bare_arm', main_hand: 'none',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'cobalt', torso_top: 'cobalt', belt_waist: 'amber',
          back_arm: 'cobalt', off_hand: 'cobalt', hair_style: 'bronze', head_hat: 'cobalt', front_arm: 'cobalt', main_hand: 'cobalt',
        },
      },
      {
        id: 'prince_knight',
        name: '豆豆眼骑士',
        tag: '经典贴纸',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'mannequin_head', face_eyes: 'dot',
          face_beard: 'none', hair_style: 'hero_crown', head_hat: 'none', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'cobalt', torso_top: 'cobalt', belt_waist: 'amber',
          back_arm: 'cobalt', off_hand: 'cobalt', hair_style: 'bronze', front_arm: 'cobalt', main_hand: 'cobalt',
        },
      },
      {
        id: 'heavy_knight',
        name: '绯红铁盔',
        tag: '重装坦克',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'mannequin_head', face_eyes: 'none',
          face_beard: 'none', hair_style: 'none', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'crimson', torso_top: 'crimson', belt_waist: 'amber',
          back_arm: 'crimson', off_hand: 'crimson', head_hat: 'crimson', front_arm: 'crimson', main_hand: 'crimson',
        },
      },
      {
        id: 'archmage',
        name: '星辰法师',
        tag: '奥术元素',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'robe_skirt', feet_shoes: 'none', torso_top: 'mage_robe', belt_waist: 'none',
          back_arm: 'cloth_sleeve', off_hand: 'spell_tome', head_base: 'mannequin_head', face_eyes: 'happy',
          face_beard: 'none', hair_style: 'short', head_hat: 'wizard_hat', front_arm: 'cloth_sleeve', main_hand: 'arcane_staff',
        },
        palettes: {
          back_cape: 'violet', legs_bottom: 'violet', torso_top: 'violet',
          back_arm: 'violet', off_hand: 'crimson', hair_style: 'amber', head_hat: 'violet', front_arm: 'violet', main_hand: 'frost',
        },
      },
      {
        id: 'seraph_paladin',
        name: '炽天使',
        tag: '圣光羽翼',
        skin: 'tan',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'none', back_prop: 'wings',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'mannequin_head', face_eyes: 'sharp',
          face_beard: 'none', hair_style: 'long', head_hat: 'none', front_arm: 'armor_sleeve', main_hand: 'battle_axe',
        },
        palettes: {
          back_prop: 'ivory', legs_bottom: 'ivory', torso_top: 'ivory', belt_waist: 'amber',
          back_arm: 'ivory', off_hand: 'ivory', hair_style: 'sakura', front_arm: 'ivory', main_hand: 'amber',
        },
      },
      {
        id: 'emerald_ranger',
        name: '翡翠游侠',
        tag: '林间潜行',
        skin: 'bronze',
        slots: {
          shadow: 'oval', body_base: 'mannequin', back_cape: 'cloak_long', back_prop: 'quiver',
          legs_bottom: 'greaves', feet_shoes: 'none', torso_top: 'ranger_vest', belt_waist: 'gold_belt',
          back_arm: 'cloth_sleeve', off_hand: 'none', head_base: 'mannequin_head', face_eyes: 'dot',
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
