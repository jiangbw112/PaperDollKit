import {
  DEFAULT_ARPG_ANIMATIONS,
  DEFAULT_ISOMETRIC_Z_ORDER,
  DEFAULT_PALETTES,
  DEFAULT_SKINS,
  ISOMETRIC_8_DIRECTIONS,
  SCHEMA_VERSION,
  STANDARD_17_SLOTS,
  type AssetPackManifest,
  type CharacterPreset,
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

const BASE_MANNEQUIN_SLOTS: Record<string, string> = {
  shadow: 'oval',
  back_cape: 'none',
  back_prop: 'none',
  body_base: 'mannequin',
  legs_bottom: 'bare_legs',
  feet_shoes: 'none',
  torso_top: 'none',
  belt_waist: 'none',
  back_arm: 'bare',
  head_base: 'mannequin_head',
  face_eyes: 'none',
  face_beard: 'none',
  hair_style: 'none',
  head_hat: 'none',
  front_arm: 'bare',
  main_hand: 'none',
  off_hand: 'none',
};

const BASE_MANNEQUIN_PALETTES: Record<string, string> = {
  back_cape: 'crimson',
  back_prop: 'bronze',
  legs_bottom: 'obsidian',
  feet_shoes: 'bronze',
  torso_top: 'cobalt',
  belt_waist: 'amber',
  back_arm: 'cobalt',
  face_beard: 'bronze',
  hair_style: 'bronze',
  head_hat: 'cobalt',
  front_arm: 'cobalt',
  main_hand: 'cobalt',
  off_hand: 'cobalt',
};

function makePreset(
  id: string,
  name: string,
  tag: string,
  skin: string,
  slots: Record<string, string>,
  palettes: Record<string, string>,
): CharacterPreset {
  return {
    id,
    name,
    tag,
    skin,
    slots: { ...BASE_MANNEQUIN_SLOTS, ...slots },
    palettes: { ...BASE_MANNEQUIN_PALETTES, ...palettes },
  };
}

/** All 1 + 16 presets ported faithfully from legacy/v1/paperdoll.js */
const PRESETS_17: CharacterPreset[] = [
  makePreset('mannequin', '00 · 原木木头人', '基础素体', 'wood', {}, {}),
  makePreset(
    'knight', '01 · 钴蓝骑士', '重甲坦克', 'fair',
    { back_cape: 'short_cape', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'gold_belt', back_arm: 'armor_sleeve', face_eyes: 'sharp', hair_style: 'short', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'sword', off_hand: 'shield' },
    { back_cape: 'crimson', legs_bottom: 'cobalt', feet_shoes: 'cobalt', torso_top: 'cobalt', belt_waist: 'amber', back_arm: 'cobalt', hair_style: 'amber', head_hat: 'cobalt', front_arm: 'cobalt', main_hand: 'frost', off_hand: 'cobalt' },
  ),
  makePreset(
    'mage', '02 · 紫罗兰大法师', '元素法术', 'fair',
    { back_cape: 'long_cloak', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'visor_glow', face_beard: 'full_beard', hair_style: 'long', head_hat: 'wizard_hat', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'book' },
    { back_cape: 'violet', legs_bottom: 'violet', feet_shoes: 'obsidian', torso_top: 'violet', belt_waist: 'amber', back_arm: 'violet', face_beard: 'ivory', hair_style: 'ivory', head_hat: 'violet', front_arm: 'violet', main_hand: 'amber', off_hand: 'crimson' },
  ),
  makePreset(
    'ranger', '03 · 翡翠游侠', '远程猎手', 'tan',
    { back_cape: 'short_cape', back_prop: 'quiver', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'sharp', hair_style: 'ponytail', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'bow' },
    { back_cape: 'emerald', back_prop: 'bronze', legs_bottom: 'bronze', feet_shoes: 'bronze', torso_top: 'emerald', belt_waist: 'bronze', back_arm: 'emerald', hair_style: 'amber', head_hat: 'emerald', front_arm: 'emerald', main_hand: 'bronze' },
  ),
  makePreset(
    'paladin', '04 · 圣殿炽天使', '圣光守护', 'fair',
    { back_cape: 'long_cloak', back_prop: 'wings', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'gold_belt', back_arm: 'armor_sleeve', face_eyes: 'dot', hair_style: 'long', head_hat: 'crown', front_arm: 'armor_sleeve', main_hand: 'hammer', off_hand: 'shield' },
    { back_cape: 'ivory', back_prop: 'ivory', legs_bottom: 'ivory', feet_shoes: 'amber', torso_top: 'ivory', belt_waist: 'amber', back_arm: 'ivory', hair_style: 'amber', head_hat: 'amber', front_arm: 'ivory', main_hand: 'amber', off_hand: 'ivory' },
  ),
  makePreset(
    'assassin', '05 · 曜石刺客', '潜行双刃', 'tan',
    { back_cape: 'scarf', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'visor_glow', face_beard: 'mask', hair_style: 'spiky', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'dagger', off_hand: 'dagger_off' },
    { back_cape: 'crimson', legs_bottom: 'obsidian', feet_shoes: 'obsidian', torso_top: 'obsidian', belt_waist: 'crimson', back_arm: 'obsidian', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'obsidian', front_arm: 'obsidian', main_hand: 'frost', off_hand: 'frost' },
  ),
  makePreset(
    'pirate', '06 · 绯红海盗长', '航海冒险', 'bronze',
    { legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'goatee', hair_style: 'long', head_hat: 'pirate_hat', front_arm: 'long_sleeve', main_hand: 'sword', off_hand: 'lantern' },
    { legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'crimson', belt_waist: 'amber', back_arm: 'ivory', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'obsidian', front_arm: 'ivory', main_hand: 'cobalt', off_hand: 'amber' },
  ),
  makePreset(
    'blacksmith', '07 · 青铜锻造师', '工坊大师', 'deep',
    { back_prop: 'backpack', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'bare', face_eyes: 'sharp', face_beard: 'full_beard', hair_style: 'short', head_hat: 'bandana', front_arm: 'bare', main_hand: 'hammer' },
    { back_prop: 'bronze', legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'bronze', belt_waist: 'amber', back_arm: 'bronze', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'crimson', front_arm: 'bronze', main_hand: 'obsidian' },
  ),
  makePreset(
    'frostguard', '08 · 北境冰霜卫', '极地重步', 'elf',
    { back_cape: 'long_cloak', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'leather_belt', back_arm: 'armor_sleeve', face_eyes: 'visor_glow', hair_style: 'spiky', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'axe', off_hand: 'shield' },
    { back_cape: 'frost', legs_bottom: 'frost', feet_shoes: 'cobalt', torso_top: 'frost', belt_waist: 'obsidian', back_arm: 'frost', hair_style: 'ivory', head_hat: 'frost', front_arm: 'frost', main_hand: 'frost', off_hand: 'cobalt' },
  ),
  makePreset(
    'scholar', '09 · 皇家炼金学者', '典籍研习', 'fair',
    { back_prop: 'backpack', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'glasses', face_beard: 'goatee', hair_style: 'short', front_arm: 'long_sleeve', main_hand: 'lantern', off_hand: 'book' },
    { back_prop: 'amber', legs_bottom: 'amber', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'bronze', back_arm: 'ivory', face_beard: 'bronze', hair_style: 'bronze', front_arm: 'ivory', main_hand: 'amber', off_hand: 'emerald' },
  ),
  makePreset(
    'sakura_blade', '10 · 樱庭剑客', '轻灵剑舞', 'fair',
    { back_cape: 'scarf', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'dot', hair_style: 'bun', front_arm: 'long_sleeve', main_hand: 'sword' },
    { back_cape: 'sakura', legs_bottom: 'obsidian', feet_shoes: 'ivory', torso_top: 'sakura', belt_waist: 'crimson', back_arm: 'sakura', hair_style: 'obsidian', front_arm: 'sakura', main_hand: 'sakura' },
  ),
  makePreset(
    'viking', '11 · 狂怒维京战斧', '近战狂战', 'tan',
    { back_cape: 'short_cape', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'bare', face_eyes: 'sharp', face_beard: 'full_beard', hair_style: 'spiky', head_hat: 'bandana', front_arm: 'bare', main_hand: 'axe', off_hand: 'shield' },
    { back_cape: 'bronze', legs_bottom: 'bronze', feet_shoes: 'obsidian', torso_top: 'crimson', belt_waist: 'bronze', back_arm: 'bronze', face_beard: 'amber', hair_style: 'amber', head_hat: 'crimson', front_arm: 'bronze', main_hand: 'obsidian', off_hand: 'crimson' },
  ),
  makePreset(
    'desert_nomad', '12 · 琥珀沙海行者', '商路护卫', 'bronze',
    { back_cape: 'scarf', back_prop: 'quiver', legs_bottom: 'pants', feet_shoes: 'sandals', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'mask', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'bow' },
    { back_cape: 'amber', back_prop: 'bronze', legs_bottom: 'ivory', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'crimson', back_arm: 'ivory', face_beard: 'amber', head_hat: 'ivory', front_arm: 'ivory', main_hand: 'bronze' },
  ),
  makePreset(
    'elf_druid', '13 · 月影德鲁伊', '自然召唤', 'elf',
    { back_cape: 'long_cloak', back_prop: 'wings', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'dot', hair_style: 'long', head_hat: 'crown', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'lantern' },
    { back_cape: 'emerald', back_prop: 'frost', legs_bottom: 'emerald', feet_shoes: 'bronze', torso_top: 'emerald', belt_waist: 'amber', back_arm: 'emerald', hair_style: 'frost', head_hat: 'emerald', front_arm: 'emerald', main_hand: 'emerald', off_hand: 'frost' },
  ),
  makePreset(
    'royal_prince', '14 · 绯红王储', '王室仪仗', 'deep',
    { back_cape: 'long_cloak', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'tunic', belt_waist: 'gold_belt', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'goatee', hair_style: 'short', head_hat: 'crown', front_arm: 'long_sleeve', main_hand: 'sword' },
    { back_cape: 'crimson', legs_bottom: 'ivory', feet_shoes: 'obsidian', torso_top: 'crimson', belt_waist: 'amber', back_arm: 'crimson', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'amber', front_arm: 'crimson', main_hand: 'amber' },
  ),
  makePreset(
    'night_witch', '15 · 暮色星辰巫女', '暗夜秘术', 'fair',
    { back_cape: 'short_cape', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'glasses', hair_style: 'ponytail', head_hat: 'wizard_hat', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'book' },
    { back_cape: 'obsidian', legs_bottom: 'obsidian', feet_shoes: 'sakura', torso_top: 'obsidian', belt_waist: 'sakura', back_arm: 'obsidian', hair_style: 'sakura', head_hat: 'obsidian', front_arm: 'obsidian', main_hand: 'sakura', off_hand: 'violet' },
  ),
  makePreset(
    'explorer', '16 · 极光探险家', '遗迹寻宝', 'tan',
    { back_cape: 'scarf', back_prop: 'backpack', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'dot', hair_style: 'spiky', head_hat: 'pirate_hat', front_arm: 'long_sleeve', main_hand: 'dagger', off_hand: 'lantern' },
    { back_cape: 'frost', back_prop: 'bronze', legs_bottom: 'cobalt', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'bronze', back_arm: 'ivory', hair_style: 'bronze', head_hat: 'bronze', front_arm: 'ivory', main_hand: 'frost', off_hand: 'amber' },
  ),
  makePreset(
    'ronin', '17 · 浪客太刀侠', '东方剑豪', 'fair',
    { back_cape: 'scarf', back_prop: 'banner', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'samurai_armor', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'sharp', hair_style: 'ponytail', head_hat: 'straw_hat', front_arm: 'long_sleeve', main_hand: 'katana' },
    { back_cape: 'crimson', back_prop: 'crimson', legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'crimson', belt_waist: 'amber', back_arm: 'obsidian', hair_style: 'obsidian', head_hat: 'amber', front_arm: 'obsidian', main_hand: 'crimson' },
  ),
  makePreset(
    'seraph_priest', '18 · 光环圣祭司', '神圣治愈', 'fair',
    { back_cape: 'long_cloak', back_prop: 'wings', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'noble_coat', belt_waist: 'gold_belt', back_arm: 'long_sleeve', face_eyes: 'happy', hair_style: 'bob', head_hat: 'halo', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'orb' },
    { back_cape: 'ivory', back_prop: 'ivory', legs_bottom: 'ivory', feet_shoes: 'amber', torso_top: 'ivory', belt_waist: 'amber', back_arm: 'ivory', hair_style: 'amber', head_hat: 'amber', front_arm: 'ivory', main_hand: 'amber', off_hand: 'frost' },
  ),
  makePreset(
    'demon_knight', '19 · 蝠翼重剑魔骑', '霸主重装', 'elf',
    { back_cape: 'long_cloak', back_prop: 'demon_wings', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'gold_belt', back_arm: 'armor_sleeve', face_eyes: 'visor_glow', hair_style: 'spiky', head_hat: 'viking_helm', front_arm: 'armor_sleeve', main_hand: 'greatsword' },
    { back_cape: 'crimson', back_prop: 'obsidian', legs_bottom: 'obsidian', feet_shoes: 'obsidian', torso_top: 'obsidian', belt_waist: 'crimson', back_arm: 'obsidian', hair_style: 'ivory', head_hat: 'obsidian', front_arm: 'obsidian', main_hand: 'crimson' },
  ),
  makePreset(
    'neko_alchemist', '20 · 猫耳炼金少女', '魔药工坊', 'fair',
    { back_cape: 'short_cape', back_prop: 'backpack', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'noble_coat', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'happy', hair_style: 'twintails', head_hat: 'cat_ears', front_arm: 'long_sleeve', main_hand: 'crossbow', off_hand: 'potion' },
    { back_cape: 'sakura', back_prop: 'bronze', legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'violet', belt_waist: 'amber', back_arm: 'violet', hair_style: 'sakura', head_hat: 'obsidian', front_arm: 'violet', main_hand: 'amber', off_hand: 'emerald' },
  ),
];

/**
 * Loads the Ultra-Q paper-sticker / wooden-doll character pack
 * with ALL 17 slots, 75 parts, and 1 + 20 character presets from just 3 atlas files.
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

  // Ultra-Q 1.75-head-tall slot hierarchy (256x256 canvas, foot origin at (128, 224))
  const stickerSlots: SlotDefinition[] = STANDARD_17_SLOTS.map((s) => {
    const overrides: Partial<Record<string, Partial<SlotDefinition>>> = {
      shadow:      { defaultOffset: { x: 0, y: 0 } },
      body_base:   { defaultOffset: { x: 0, y: -26 }, defaultPivot: { x: 0.5, y: 0.85 } },
      legs_bottom: { defaultOffset: { x: 0, y: -8 },  defaultPivot: { x: 0.5, y: 0.25 } },
      feet_shoes:  { defaultOffset: { x: 0, y: 0 },   defaultPivot: { x: 0.5, y: 0.25 } },
      torso_top:   { defaultOffset: { x: 0, y: -20 }, defaultPivot: { x: 0.5, y: 0.58 } },
      belt_waist:  { defaultOffset: { x: 0, y: 15 },  defaultPivot: { x: 0.5, y: 0.50 } },
      back_cape:   { defaultOffset: { x: -2, y: -42 }, defaultPivot: { x: 0.5, y: 0.18 } },
      back_prop:   { defaultOffset: { x: 0, y: -34 }, defaultPivot: { x: 0.5, y: 0.50 } },
      front_arm:   { defaultOffset: { x: 23, y: -36 }, defaultPivot: { x: 0.5, y: 0.20 } },
      main_hand:   { defaultOffset: { x: 4, y: 34 },  defaultPivot: { x: 0.35, y: 0.71 } },
      back_arm:    { defaultOffset: { x: -23, y: -36 }, defaultPivot: { x: 0.5, y: 0.20 } },
      off_hand:    { defaultOffset: { x: -8, y: 30 }, defaultPivot: { x: 0.5, y: 0.50 } },
      head_base:   { defaultOffset: { x: 0, y: -50 }, defaultPivot: { x: 0.5, y: 0.80 } },
      face_eyes:   { defaultOffset: { x: 0, y: -26 }, defaultPivot: { x: 0.5, y: 0.50 } },
      face_beard:  { defaultOffset: { x: 0, y: -14 }, defaultPivot: { x: 0.5, y: 0.45 } },
      hair_style:  { defaultOffset: { x: 0, y: -36 }, defaultPivot: { x: 0.5, y: 0.50 } },
      head_hat:    { defaultOffset: { x: 0, y: -38 }, defaultPivot: { x: 0.5, y: 0.52 } },
    };
    const ov = overrides[s.id];
    return ov ? { ...s, ...ov } : { ...s };
  });

  const parts: Record<string, PartAsset[]> = {};
  for (const s of stickerSlots) {
    parts[s.id] = [];
  }

  const PART_TAGS: Record<string, string[]> = {
    // Legs
    'legs_bottom:bare_legs': ['civilian'],
    'legs_bottom:pants': ['light', 'ranged', 'stealth', 'civilian', 'noble'],
    'legs_bottom:greaves': ['heavy', 'armor', 'melee'],
    'legs_bottom:robe_skirt': ['magic', 'robe', 'arcane', 'noble'],
    // Shoes
    'feet_shoes:boots': ['light', 'ranged', 'stealth', 'civilian', 'noble'],
    'feet_shoes:sabaton': ['heavy', 'armor', 'melee'],
    'feet_shoes:sandals': ['magic', 'nature', 'civilian'],
    // Torso
    'torso_top:tunic': ['light', 'civilian', 'noble'],
    'torso_top:plate': ['heavy', 'armor', 'melee'],
    'torso_top:robe': ['magic', 'robe', 'arcane'],
    'torso_top:vest': ['light', 'ranged', 'stealth', 'civilian'],
    'torso_top:samurai_armor': ['heavy', 'armor', 'melee', 'noble'],
    'torso_top:noble_coat': ['noble', 'magic', 'light'],
    // Belt
    'belt_waist:leather_belt': ['light', 'ranged', 'civilian', 'heavy'],
    'belt_waist:sash': ['magic', 'robe', 'stealth', 'noble'],
    'belt_waist:gold_belt': ['heavy', 'noble', 'armor'],
    // Cape
    'back_cape:short_cape': ['heavy', 'ranged', 'melee'],
    'back_cape:long_cloak': ['magic', 'noble', 'robe'],
    'back_cape:scarf': ['stealth', 'agility', 'light'],
    // Back Props
    'back_prop:quiver': ['ranged', 'nature'],
    'back_prop:backpack': ['civilian', 'light'],
    'back_prop:wings': ['noble', 'magic', 'arcane'],
    'back_prop:demon_wings': ['heavy', 'stealth', 'magic'],
    'back_prop:banner': ['heavy', 'melee', 'noble'],
    // Arms
    'front_arm:bare': ['civilian', 'light'],
    'front_arm:long_sleeve': ['magic', 'robe', 'ranged', 'stealth', 'noble'],
    'front_arm:armor_sleeve': ['heavy', 'armor', 'melee'],
    'back_arm:bare': ['civilian', 'light'],
    'back_arm:long_sleeve': ['magic', 'robe', 'ranged', 'stealth', 'noble'],
    'back_arm:armor_sleeve': ['heavy', 'armor', 'melee'],
    // Eyes & Beard
    'face_eyes:dot': ['civilian', 'light', 'noble'],
    'face_eyes:sharp': ['melee', 'heavy', 'ranged', 'noble'],
    'face_eyes:visor_glow': ['heavy', 'magic', 'stealth'],
    'face_eyes:glasses': ['magic', 'arcane', 'civilian'],
    'face_eyes:happy': ['civilian', 'light', 'noble', 'magic'],
    'face_eyes:eyepatch': ['stealth', 'melee', 'ranged'],
    'face_beard:goatee': ['noble', 'civilian', 'magic'],
    'face_beard:full_beard': ['heavy', 'magic', 'civilian'],
    'face_beard:mask': ['stealth', 'agility', 'ranged'],
    // Hair
    'hair_style:short': ['heavy', 'civilian', 'noble'],
    'hair_style:spiky': ['stealth', 'melee', 'ranged'],
    'hair_style:long': ['magic', 'noble', 'robe'],
    'hair_style:ponytail': ['ranged', 'agility', 'light'],
    'hair_style:bun': ['noble', 'magic', 'light'],
    'hair_style:twintails': ['magic', 'light', 'civilian'],
    'hair_style:bob': ['noble', 'civilian', 'magic'],
    // Hats
    'head_hat:knight_helm': ['heavy', 'armor', 'melee'],
    'head_hat:wizard_hat': ['magic', 'robe', 'arcane'],
    'head_hat:hood': ['ranged', 'stealth', 'nature'],
    'head_hat:pirate_hat': ['light', 'noble'],
    'head_hat:crown': ['noble'],
    'head_hat:bandana': ['civilian', 'melee', 'light'],
    'head_hat:viking_helm': ['heavy', 'armor', 'melee'],
    'head_hat:straw_hat': ['melee', 'ranged', 'stealth', 'nature'],
    'head_hat:cat_ears': ['light', 'civilian', 'magic'],
    'head_hat:bard_hat': ['noble', 'light', 'ranged'],
    'head_hat:halo': ['noble', 'magic', 'arcane'],
    // Main Hand Weapons
    'main_hand:sword': ['heavy', 'melee', 'noble'],
    'main_hand:staff': ['magic', 'robe', 'arcane'],
    'main_hand:bow': ['ranged', 'nature'],
    'main_hand:axe': ['heavy', 'melee'],
    'main_hand:dagger': ['stealth', 'agility'],
    'main_hand:hammer': ['heavy', 'melee', 'civilian'],
    'main_hand:lantern': ['civilian', 'magic'],
    'main_hand:spear': ['heavy', 'melee', 'noble'],
    'main_hand:greatsword': ['heavy', 'melee'],
    'main_hand:katana': ['melee', 'stealth', 'noble'],
    'main_hand:crossbow': ['ranged', 'stealth', 'civilian'],
    // Off Hand
    'off_hand:shield': ['heavy', 'armor', 'melee'],
    'off_hand:book': ['magic', 'robe', 'arcane'],
    'off_hand:lantern': ['civilian', 'noble', 'magic'],
    'off_hand:dagger_off': ['stealth', 'agility'],
    'off_hand:tower_shield': ['heavy', 'armor', 'melee'],
    'off_hand:orb': ['magic', 'arcane', 'noble'],
    'off_hand:potion': ['civilian', 'magic', 'light'],
  };

  const addDirPart = (
    slotId: string,
    id: string,
    name: string,
    recolorMode: PartAsset['recolorMode'],
    builder: (dir: string) => PartAsset['directions'][string],
    rules?: PartAsset['rules'],
  ) => {
    const directions: PartAsset['directions'] = {};
    for (const d of CANONICAL_DIRS) {
      directions[d] = builder(d);
    }
    const tags = PART_TAGS[`${slotId}:${id}`];
    parts[slotId]!.push({
      id,
      name,
      slotId,
      recolorMode,
      directions,
      ...(rules ? { rules } : {}),
      ...(tags ? { tags } : {}),
    });
  };

  const addSharedPart = (
    slotId: string,
    id: string,
    name: string,
    frame: SpriteFrameRef,
    recolorMode: PartAsset['recolorMode'] = 'mask_ramp',
    rules?: PartAsset['rules'],
  ) => {
    addDirPart(slotId, id, name, recolorMode, () => ({ mode: 'rigged', frames: [frame] }), rules);
  };

  // 1. Shadow
  addSharedPart('shadow', 'oval', '椭圆投影', makeFrame('shadow_oval', { x: 0.5, y: 0.5 }, false), 'none');

  // 2. Body Base
  addDirPart('body_base', 'mannequin', '标准木头人', 'mask_ramp', (d) => {
    const sx = d === 'E' ? 0.80 : d === 'SE' || d === 'NE' ? 0.94 : 1.0;
    const sockets: SpriteFrameRef['sockets'] = {
      neck: { x: 0, y: -48 },
      shoulder_front: { x: 23 * sx, y: -36 },
      shoulder_back: { x: -23 * sx, y: -36 },
      back_mount: { x: -2 * sx, y: -42 },
    };
    return {
      mode: 'rigged',
      frames: [makeFrame(`body_base_${d}`, { x: 0.5, y: 0.85 }, true, sockets)],
    };
  });

  // 3. Legs Bottom (all 4 styles with 6-frame bouncy walk!)
  const addWalkSeqPart = (slotId: string, id: string, name: string, prefix: string) => {
    addDirPart(slotId, id, name, 'mask_ramp', (d) => ({
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
  addWalkSeqPart('legs_bottom', 'bare_legs', '素体木头腿', 'legs_bare_legs');
  addWalkSeqPart('legs_bottom', 'pants', '长裤', 'legs_pants');
  addWalkSeqPart('legs_bottom', 'greaves', '重甲护腿', 'legs_greaves');
  addWalkSeqPart('legs_bottom', 'robe_skirt', '法袍下摆', 'legs_robe_skirt');

  // 4. Feet Shoes (all 3 styles synchronized with the exact same 6-frame walk!)
  addWalkSeqPart('feet_shoes', 'boots', '皮靴', 'shoes_boots');
  addWalkSeqPart('feet_shoes', 'sabaton', '铁甲靴', 'shoes_sabaton');
  addWalkSeqPart('feet_shoes', 'sandals', '绑带凉鞋', 'shoes_sandals');

  // 5. Torso Top (6 styles)
  for (const [id, name] of [
    ['tunic', '布衣短衫'],
    ['plate', '板甲胸铠'],
    ['robe', '长袍外衣'],
    ['vest', '皮甲马甲'],
    ['samurai_armor', '东方武士铠'],
    ['noble_coat', '贵族礼服'],
  ] as const) {
    addDirPart('torso_top', id, name, 'mask_ramp', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`torso_${id}_${d}`, { x: 0.5, y: 0.58 })],
    }));
  }

  // 6. Belt Waist (3 styles)
  for (const [id, name] of [
    ['leather_belt', '扣带皮腰带'],
    ['sash', '布艺束带'],
    ['gold_belt', '圣徽腰带'],
  ] as const) {
    addDirPart('belt_waist', id, name, 'mask_ramp', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`belt_${id}_${d}`, { x: 0.5, y: 0.50 })],
    }));
  }

  // 7. Back Cape (3 styles)
  for (const [id, name] of [
    ['short_cape', '短披风'],
    ['long_cloak', '长斗篷'],
    ['scarf', '飘逸围巾'],
  ] as const) {
    addDirPart('back_cape', id, name, 'mask_ramp', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`cape_${id}_${d}`, { x: 0.5, y: 0.18 })],
    }));
  }

  // 8. Back Props (5 styles)
  addSharedPart('back_prop', 'quiver', '箭袋', makeFrame('prop_quiver', { x: 0.5, y: 0.50 }));
  addSharedPart('back_prop', 'backpack', '行囊', makeFrame('prop_backpack', { x: 0.5, y: 0.50 }));
  addSharedPart('back_prop', 'wings', '羽翼', makeFrame('prop_wings', { x: 0.5, y: 0.50 }));
  addSharedPart('back_prop', 'demon_wings', '恶魔蝠翼', makeFrame('prop_demon_wings', { x: 0.5, y: 0.50 }));
  addSharedPart('back_prop', 'banner', '战阵背旗', makeFrame('prop_banner', { x: 0.5, y: 0.72 }));

  // 9. Arms (front & back, 3 styles each, hand palm ALWAYS on Mask B = Skin!)
  const makeArms = (slotId: 'front_arm' | 'back_arm') => {
    const socketName = slotId === 'front_arm' ? 'hand_main' : 'hand_off';
    const handSocket: SpriteFrameRef['sockets'] = {
      [socketName]: slotId === 'front_arm'
        ? { x: 5, y: 34, rotationDeg: 4 }
        : { x: -9, y: 31, rotationDeg: -4 },
    };
    addSharedPart(slotId, 'bare', '素体短袖', makeFrame('arm_bare', { x: 0.5, y: 0.20 }, true, handSocket));
    addSharedPart(slotId, 'long_sleeve', '长袖上衣', makeFrame('arm_long_sleeve', { x: 0.5, y: 0.20 }, true, handSocket));
    addSharedPart(slotId, 'armor_sleeve', '臂铠护腕', makeFrame('arm_armor_sleeve', { x: 0.5, y: 0.20 }, true, handSocket));
  };
  makeArms('front_arm');
  makeArms('back_arm');

  // 10. Head Base
  addDirPart('head_base', 'mannequin_head', '标准圆头', 'mask_ramp', (d) => ({
    mode: 'rigged',
    frames: [
      makeFrame(`head_base_${d}`, { x: 0.5, y: 0.80 }, true, {
        head_top: { x: 0, y: -38 },
      }),
    ],
  }));

  // 11. Face Eyes (6 sticker styles)
  for (const [id, name] of [
    ['dot', '豆豆眼'],
    ['sharp', '坚毅目光'],
    ['visor_glow', '发光战瞳'],
    ['glasses', '学者眼镜'],
    ['happy', '眯眯笑眼'],
    ['eyepatch', '海盗独眼罩'],
  ] as const) {
    addDirPart('face_eyes', id, name, 'none', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`face_${id}_${d}`, { x: 0.5, y: 0.50 }, false)],
    }));
  }

  // 12. Face Beard / Mask (3 styles)
  for (const [id, name] of [
    ['goatee', '山羊胡'],
    ['full_beard', '络腮大胡'],
    ['mask', '暗影面罩'],
  ] as const) {
    addDirPart('face_beard', id, name, 'mask_ramp', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`beard_${id}_${d}`, { x: 0.5, y: 0.45 })],
    }));
  }

  // 13. Hair Style (7 styles)
  for (const [id, name, py] of [
    ['short', '短碎发', 0.50],
    ['spiky', '刺猬发', 0.50],
    ['long', '披肩长发', 0.50],
    ['ponytail', '高马尾', 0.50],
    ['bun', '发髻', 0.54],
    ['twintails', '双马尾', 0.50],
    ['bob', '齐耳波波头', 0.50],
  ] as const) {
    addDirPart('hair_style', id, name, 'mask_ramp', (d) => ({
      mode: 'rigged',
      frames: [makeFrame(`hair_${id}_${d}`, { x: 0.5, y: py })],
    }));
  }

  // 14. Head Hat (11 styles with carefully tuned Q-version vertical pivots & conflict rules)
  const hatDefs: ReadonlyArray<readonly [string, string, number, PartAsset['rules']?]> = [
    ['knight_helm', '骑士头盔', 0.54, { hidesSlots: ['hair_style'] }],
    ['wizard_hat', '尖顶法师帽', 0.84],
    ['hood', '游侠兜帽', 0.46, { overrideSlots: { hair_style: 'short' } }],
    ['pirate_hat', '海盗三角帽', 0.78],
    ['crown', '黄金王冠', 0.88],
    ['bandana', '头巾', 0.68],
    ['viking_helm', '维京角盔', 0.60, { hidesSlots: ['hair_style'] }],
    ['straw_hat', '东方斗笠', 0.72],
    ['cat_ears', '猫耳发箍', 0.68],
    ['bard_hat', '羽饰诗人帽', 0.76],
    ['halo', '圣光光环', 0.88],
  ];
  for (const [id, name, py, rules] of hatDefs) {
    addDirPart(
      'head_hat',
      id,
      name,
      'mask_ramp',
      (d) => ({
        mode: 'rigged',
        frames: [makeFrame(`hat_${id}_${d}`, { x: 0.5, y: py })],
      }),
      rules,
    );
  }

  // 15. Main Hand Weapons (11 styles held on forward +X hand, pointing 斜前方!)
  addSharedPart('main_hand', 'sword', '骑士长剑', makeFrame('weapon_sword', { x: 0.35, y: 0.71 }));
  addSharedPart('main_hand', 'staff', '秘法长杖', makeFrame('weapon_staff', { x: 0.36, y: 0.69 }));
  addSharedPart('main_hand', 'bow', '猎手长弓', makeFrame('weapon_bow', { x: 0.48, y: 0.50 }), 'mask_ramp', {
    hidesSlots: ['off_hand'],
  });
  addSharedPart('main_hand', 'axe', '战斧', makeFrame('weapon_axe', { x: 0.35, y: 0.72 }));
  addSharedPart('main_hand', 'dagger', '短刃', makeFrame('weapon_dagger', { x: 0.36, y: 0.67 }));
  addSharedPart('main_hand', 'hammer', '锻造铁锤', makeFrame('weapon_hammer', { x: 0.35, y: 0.72 }));
  addSharedPart('main_hand', 'lantern', '提灯', makeFrame('weapon_lantern', { x: 0.50, y: 0.28 }));
  addSharedPart('main_hand', 'spear', '骑士长矛', makeFrame('weapon_spear', { x: 0.34, y: 0.73 }));
  addSharedPart('main_hand', 'greatsword', '双手巨剑', makeFrame('weapon_greatsword', { x: 0.33, y: 0.71 }), 'mask_ramp', {
    hidesSlots: ['off_hand'],
  });
  addSharedPart('main_hand', 'katana', '武士太刀', makeFrame('weapon_katana', { x: 0.33, y: 0.73 }));
  addSharedPart('main_hand', 'crossbow', '手弩', makeFrame('weapon_crossbow', { x: 0.35, y: 0.56 }));

  // 16. Off Hand Equipment (7 styles held on rear -X hand)
  addSharedPart('off_hand', 'shield', '纹章圆盾', makeFrame('offhand_shield', { x: 0.50, y: 0.50 }));
  addSharedPart('off_hand', 'book', '魔法典籍', makeFrame('offhand_book', { x: 0.50, y: 0.50 }));
  addSharedPart('off_hand', 'lantern', '提灯', makeFrame('offhand_lantern', { x: 0.50, y: 0.28 }));
  addSharedPart('off_hand', 'dagger_off', '副手短刃', makeFrame('offhand_dagger_off', { x: 0.64, y: 0.67 }));
  addSharedPart('off_hand', 'tower_shield', '重装塔盾', makeFrame('offhand_tower_shield', { x: 0.50, y: 0.50 }));
  addSharedPart('off_hand', 'orb', '悬浮法球', makeFrame('offhand_orb', { x: 0.50, y: 0.50 }));
  addSharedPart('off_hand', 'potion', '炼金药瓶', makeFrame('offhand_potion', { x: 0.50, y: 0.52 }));

  const pack: AssetPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: 'sticker-doll-16',
    name: '超Q纸片贴纸木头人角色包 (256×256)',
    canvasSize: { width: 256, height: 256 },
    perspective: 'isometric_8',
    directions: ISOMETRIC_8_DIRECTIONS,
    slots: stickerSlots,
    zOrder: DEFAULT_ISOMETRIC_Z_ORDER,
    palettes: DEFAULT_PALETTES,
    skins: DEFAULT_SKINS,
    parts,
    animations: DEFAULT_ARPG_ANIMATIONS,
    presets: PRESETS_17,
  };

  return { pack, images };
}
