import type { DirectionId, SlotId } from '@paperdollkit/core';
import type { ParsedLayerMeta } from './types.js';

const DIRECTION_TOKENS = new Set<DirectionId>(['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']);

const ACTION_TOKENS = new Set<string>([
  'idle',
  'walk',
  'run',
  'attack',
  'cast',
  'hit',
  'die',
  'cheer',
]);

/** Bidirectional English + Chinese aliases mapped to the 17 standard paper-doll slots. */
const SLOT_ALIAS_MAP: Record<string, SlotId> = {
  // Exact 17 slot IDs
  shadow: 'shadow',
  back_cape: 'back_cape',
  back_prop: 'back_prop',
  body_base: 'body_base',
  legs_bottom: 'legs_bottom',
  feet_shoes: 'feet_shoes',
  torso_top: 'torso_top',
  belt_waist: 'belt_waist',
  back_arm: 'back_arm',
  off_hand: 'off_hand',
  head_base: 'head_base',
  face_eyes: 'face_eyes',
  face_beard: 'face_beard',
  hair_style: 'hair_style',
  head_hat: 'head_hat',
  front_arm: 'front_arm',
  main_hand: 'main_hand',

  // Common English artist aliases
  cape: 'back_cape',
  cloak: 'back_cape',
  scarf: 'back_cape',
  wings: 'back_prop',
  quiver: 'back_prop',
  backpack: 'back_prop',
  body: 'body_base',
  mannequin: 'body_base',
  legs: 'legs_bottom',
  pants: 'legs_bottom',
  greaves: 'legs_bottom',
  skirt: 'legs_bottom',
  feet: 'feet_shoes',
  shoes: 'feet_shoes',
  boots: 'feet_shoes',
  torso: 'torso_top',
  chest: 'torso_top',
  armor: 'torso_top',
  top: 'torso_top',
  shirt: 'torso_top',
  belt: 'belt_waist',
  waist: 'belt_waist',
  sash: 'belt_waist',
  arm_back: 'back_arm',
  left_arm: 'back_arm',
  offhand: 'off_hand',
  shield: 'off_hand',
  head: 'head_base',
  eyes: 'face_eyes',
  face: 'face_eyes',
  beard: 'face_beard',
  hair: 'hair_style',
  hat: 'head_hat',
  helmet: 'head_hat',
  helm: 'head_hat',
  hood: 'head_hat',
  crown: 'head_hat',
  arm_front: 'front_arm',
  right_arm: 'front_arm',
  arm: 'front_arm',
  mainhand: 'main_hand',
  weapon: 'main_hand',
  sword: 'main_hand',
  staff: 'main_hand',
  axe: 'main_hand',
  bow: 'main_hand',

  // Common Chinese artist layer/group aliases
  阴影: 'shadow',
  脚底阴影: 'shadow',
  披风: 'back_cape',
  斗篷: 'back_cape',
  披风斗篷: 'back_cape',
  背饰: 'back_prop',
  背部挂件: 'back_prop',
  素体: 'body_base',
  身体: 'body_base',
  基础素体: 'body_base',
  下装: 'legs_bottom',
  裤子: 'legs_bottom',
  下装裤裙: 'legs_bottom',
  鞋子: 'feet_shoes',
  鞋靴: 'feet_shoes',
  上衣: 'torso_top',
  胸甲: 'torso_top',
  护甲: 'torso_top',
  上衣护甲: 'torso_top',
  腰带: 'belt_waist',
  腰带饰带: 'belt_waist',
  远侧手臂: 'back_arm',
  后手: 'back_arm',
  左臂: 'back_arm',
  副手: 'off_hand',
  盾牌: 'off_hand',
  副手装备: 'off_hand',
  头部: 'head_base',
  头: 'head_base',
  头部素体: 'head_base',
  五官: 'face_eyes',
  眼睛: 'face_eyes',
  五官表情: 'face_eyes',
  胡须: 'face_beard',
  胡须面饰: 'face_beard',
  发型: 'hair_style',
  头发: 'hair_style',
  帽子: 'head_hat',
  头盔: 'head_hat',
  帽子头盔: 'head_hat',
  近侧手臂: 'front_arm',
  前手: 'front_arm',
  右臂: 'front_arm',
  主手: 'main_hand',
  武器: 'main_hand',
  主手装备: 'main_hand',
};

function sanitizeId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'custom_part';
}

function matchSlotAlias(token: string, knownSlots?: Set<SlotId>): SlotId | null {
  const lower = token.trim().toLowerCase();
  if (knownSlots?.has(lower)) return lower;
  const direct = SLOT_ALIAS_MAP[lower] ?? SLOT_ALIAS_MAP[token.trim()];
  if (direct && (!knownSlots || knownSlots.has(direct))) {
    return direct;
  }
  return null;
}

/**
 * Parses a file path or PSD group/layer hierarchy into structured paper-doll metadata.
 *
 * Examples supported:
 *  - "torso_top/plate_SE.png"             -> slot=torso_top, part=plate, dir=SE
 *  - "torso_top/plate_SE_mask.png"        -> slot=torso_top, part=plate, dir=SE, isMask=true
 *  - "SE/front_arm/armor_sleeve.png"      -> slot=front_arm, part=armor_sleeve, dir=SE
 *  - "body_base/hero_SE_walk_02.png"      -> slot=body_base, part=hero, dir=SE, action=walk, frame=2
 *  - "上衣护甲/板甲_SE_遮罩"                -> slot=torso_top, part=板甲, dir=SE, isMask=true
 */
export function parseLayerPath(
  rawPath: string,
  defaultDirection: DirectionId = 'SE',
  knownSlots?: Set<SlotId>,
): ParsedLayerMeta {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const withoutExt = normalized.replace(/\.(png|webp|jpg|jpeg|psd|tga)$/i, '');
  const segments = withoutExt.split('/').filter(Boolean);

  let slotId: SlotId | null = null;
  let directionId: DirectionId = defaultDirection;
  let actionId: string | undefined;
  let frameIndex: number | undefined;
  let isMask = false;

  const remainingForPart: string[] = [];

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx]!;
    const upperSeg = seg.toUpperCase();
    const lowerSeg = seg.toLowerCase();

    if (lowerSeg === 'mask' || lowerSeg === 'masks' || seg === '遮罩') {
      isMask = true;
      continue;
    }

    if (DIRECTION_TOKENS.has(upperSeg)) {
      directionId = upperSeg;
      continue;
    }

    const segSlot = matchSlotAlias(seg, knownSlots);
    if (segSlot && slotId === null) {
      slotId = segSlot;
      continue;
    }

    // Split leaf or multi-token segment on "__", "_", "-", or spaces
    // First check if a known multi-word slot prefix like "torso_top_" leads the segment
    let working = seg;
    if (slotId === null) {
      const sortedAliases = Object.keys(SLOT_ALIAS_MAP).sort((a, b) => b.length - a.length);
      for (const alias of sortedAliases) {
        const lowerWork = working.toLowerCase();
        if (
          lowerWork === alias ||
          lowerWork.startsWith(`${alias}_`) ||
          lowerWork.startsWith(`${alias}-`) ||
          lowerWork.startsWith(`${alias} `)
        ) {
          const matched = matchSlotAlias(alias, knownSlots);
          if (matched) {
            slotId = matched;
            working = working.slice(alias.length).replace(/^[-_\s]+/, '');
            break;
          }
        }
      }
    }

    const tokens = working.split(/[-_\s]+/).filter(Boolean);
    const keptTokens: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const lower = tok.toLowerCase();
      const upper = tok.toUpperCase();

      if (lower === 'mask' || tok === '遮罩') {
        isMask = true;
        continue;
      }

      if (DIRECTION_TOKENS.has(upper)) {
        directionId = upper;
        continue;
      }

      if (ACTION_TOKENS.has(lower)) {
        actionId = lower;
        continue;
      }

      if (/^f?\d{1,3}$/i.test(tok) && (actionId !== undefined || i === tokens.length - 1)) {
        const num = parseInt(tok.replace(/^f/i, ''), 10);
        if (!Number.isNaN(num)) {
          frameIndex = num;
          continue;
        }
      }

      if (slotId === null) {
        const tokSlot = matchSlotAlias(tok, knownSlots);
        if (tokSlot) {
          slotId = tokSlot;
          continue;
        }
      }

      keptTokens.push(tok);
    }

    // Prefer leaf tokens for part name
    if (keptTokens.length > 0 && sIdx === segments.length - 1) {
      remainingForPart.push(...keptTokens);
    } else if (keptTokens.length > 0 && segments.length === 1) {
      remainingForPart.push(...keptTokens);
    }
  }

  const rawPartName = remainingForPart.join(' ').trim() || (slotId ? `${slotId}_custom` : 'custom');
  const partId = sanitizeId(rawPartName);

  return {
    slotId,
    partId,
    partName: rawPartName,
    directionId,
    actionId,
    frameIndex,
    isMask,
  };
}
