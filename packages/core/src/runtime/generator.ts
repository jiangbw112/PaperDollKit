import {
  PaperDollCharacter,
} from './character.js';
import type {
  AssetPackManifest,
  CharacterConfig,
  DirectionId,
  PartAsset,
  SlotId,
} from '../schema/types.js';

export type CharacterArchetypeId =
  | 'any'
  | 'knight'
  | 'mage'
  | 'ranger'
  | 'rogue'
  | 'noble'
  | 'civilian';

export interface CharacterArchetypeSpec {
  id: CharacterArchetypeId;
  label: string;
  /** Preferred part tags boosted during weighted selection. */
  preferredTags: string[];
  /** Tags penalized (still allowed as fallback if no preferred parts exist). */
  avoidTags?: string[];
  /** Preferred main clothing palette IDs. */
  preferredPalettes: string[];
  /** Probability [0..1] of equipping optional decorative/equipment slots. */
  slotEquipChance?: Partial<Record<SlotId, number>>;
}

export const CHARACTER_ARCHETYPES: Record<CharacterArchetypeId, CharacterArchetypeSpec> = {
  any: {
    id: 'any',
    label: '全风格冒险者',
    preferredTags: [],
    preferredPalettes: ['cobalt', 'crimson', 'emerald', 'violet', 'amber', 'obsidian', 'frost', 'ivory', 'bronze', 'sakura'],
    slotEquipChance: {
      back_cape: 0.65,
      back_prop: 0.35,
      belt_waist: 0.85,
      face_beard: 0.25,
      hair_style: 0.9,
      head_hat: 0.65,
      main_hand: 0.9,
      off_hand: 0.5,
    },
  },
  knight: {
    id: 'knight',
    label: '重甲骑士',
    preferredTags: ['heavy', 'melee', 'armor'],
    avoidTags: ['magic', 'stealth', 'civilian'],
    preferredPalettes: ['cobalt', 'ivory', 'frost', 'crimson', 'obsidian'],
    slotEquipChance: {
      back_cape: 0.85,
      back_prop: 0.2,
      belt_waist: 0.95,
      face_beard: 0.3,
      hair_style: 0.85,
      head_hat: 0.9,
      main_hand: 1.0,
      off_hand: 0.85,
    },
  },
  mage: {
    id: 'mage',
    label: '奥术法师',
    preferredTags: ['magic', 'robe', 'arcane'],
    avoidTags: ['heavy', 'stealth'],
    preferredPalettes: ['violet', 'cobalt', 'frost', 'obsidian', 'sakura', 'emerald'],
    slotEquipChance: {
      back_cape: 0.85,
      back_prop: 0.25,
      belt_waist: 0.9,
      face_beard: 0.35,
      hair_style: 0.9,
      head_hat: 0.85,
      main_hand: 1.0,
      off_hand: 0.75,
    },
  },
  ranger: {
    id: 'ranger',
    label: '荒野游侠',
    preferredTags: ['ranged', 'light', 'nature'],
    avoidTags: ['heavy', 'noble'],
    preferredPalettes: ['emerald', 'bronze', 'amber', 'obsidian'],
    slotEquipChance: {
      back_cape: 0.75,
      back_prop: 0.85,
      belt_waist: 0.9,
      face_beard: 0.2,
      hair_style: 0.9,
      head_hat: 0.75,
      main_hand: 1.0,
      off_hand: 0.15,
    },
  },
  rogue: {
    id: 'rogue',
    label: '暗影刺客',
    preferredTags: ['stealth', 'light', 'agility'],
    avoidTags: ['heavy', 'robe', 'noble'],
    preferredPalettes: ['obsidian', 'crimson', 'violet', 'bronze'],
    slotEquipChance: {
      back_cape: 0.7,
      back_prop: 0.15,
      belt_waist: 0.85,
      face_beard: 0.6,
      hair_style: 0.85,
      head_hat: 0.8,
      main_hand: 1.0,
      off_hand: 0.75,
    },
  },
  noble: {
    id: 'noble',
    label: '王室仪仗',
    preferredTags: ['noble', 'light', 'melee'],
    avoidTags: ['stealth', 'civilian'],
    preferredPalettes: ['crimson', 'ivory', 'amber', 'cobalt', 'sakura'],
    slotEquipChance: {
      back_cape: 0.9,
      back_prop: 0.3,
      belt_waist: 0.95,
      face_beard: 0.25,
      hair_style: 0.95,
      head_hat: 0.8,
      main_hand: 0.85,
      off_hand: 0.35,
    },
  },
  civilian: {
    id: 'civilian',
    label: '城镇工匠',
    preferredTags: ['civilian', 'light'],
    avoidTags: ['heavy', 'magic', 'noble'],
    preferredPalettes: ['bronze', 'amber', 'emerald', 'ivory', 'cobalt'],
    slotEquipChance: {
      back_cape: 0.2,
      back_prop: 0.55,
      belt_waist: 0.8,
      face_beard: 0.35,
      hair_style: 0.95,
      head_hat: 0.45,
      main_hand: 0.55,
      off_hand: 0.2,
    },
  },
};

/** Harmonious accent palette pairings keyed by primary palette ID. */
const PALETTE_HARMONY: Record<string, string[]> = {
  cobalt:   ['amber', 'ivory', 'frost', 'obsidian'],
  crimson:  ['amber', 'obsidian', 'ivory', 'bronze'],
  emerald:  ['bronze', 'amber', 'ivory', 'obsidian'],
  violet:   ['amber', 'ivory', 'sakura', 'obsidian'],
  amber:    ['bronze', 'obsidian', 'crimson', 'ivory'],
  obsidian: ['crimson', 'frost', 'amber', 'sakura'],
  frost:    ['cobalt', 'ivory', 'obsidian', 'amber'],
  ivory:    ['amber', 'cobalt', 'crimson', 'emerald'],
  bronze:   ['amber', 'emerald', 'obsidian', 'ivory'],
  sakura:   ['ivory', 'obsidian', 'crimson', 'violet'],
};

/** FNV-1a 32-bit string hash -> uint32 seed. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (Math.floor(seed) >>> 0) || 0x9e3779b9;
  }
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 0x9e3779b9;
}

/** Deterministic Mulberry32 PRNG returning floats in [0, 1). */
export function createSeededRng(seed: string | number): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(items: Array<{ value: T; weight: number }>, rng: () => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, item.weight);
  if (total <= 0) return items[0]!.value;
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, item.weight);
    if (r <= 0) return item.value;
  }
  return items[items.length - 1]!.value;
}

function scorePartForArchetype(part: PartAsset, arch: CharacterArchetypeSpec): number {
  const tags = part.tags ?? [];
  if (arch.preferredTags.length === 0) return 1.0;

  let weight = 1.0;
  for (const t of tags) {
    if (arch.preferredTags.includes(t)) weight += 3.5;
    if (arch.avoidTags?.includes(t)) weight *= 0.18;
  }
  return Math.max(0.08, weight);
}

export interface GenerateCharacterOptions {
  /** Deterministic seed (string or number). Same seed + archetype -> identical character. */
  seed?: string | number;
  /** Optional style/class archetype (default: 'any', which picks a coherent archetype from the seed). */
  archetype?: CharacterArchetypeId;
  /** Override facing direction (default: 'SE' or random front-facing when `randomDirection` is true). */
  direction?: DirectionId;
  /** Pick a random front-facing direction (S/SE/SW/E/W) from the seed. */
  randomDirection?: boolean;
  /** Initial action (default: 'idle'). */
  action?: string;
  /** Exclude 'wood' mannequin skin tone (default: true). */
  excludeWoodSkin?: boolean;
}

export interface GeneratedCharacterResult {
  seed: string;
  archetype: CharacterArchetypeId;
  archetypeLabel: string;
  config: CharacterConfig;
}

const COHERENT_ARCHETYPES: CharacterArchetypeId[] = [
  'knight',
  'mage',
  'ranger',
  'rogue',
  'noble',
  'civilian',
];

/**
 * Generates a stylistically coherent, deterministic modular character using
 * archetype tag weights, harmonious color palettes, arm symmetry, and PartRules awareness.
 */
export function generateSeededCharacter(
  pack: AssetPackManifest,
  opts: GenerateCharacterOptions = {},
): GeneratedCharacterResult {
  const seedStr =
    opts.seed !== undefined
      ? String(opts.seed)
      : `pdk-${Math.random().toString(36).slice(2, 8)}`;
  const rng = createSeededRng(seedStr);

  // When 'any' is requested, deterministically pick a coherent archetype so the output looks curated
  const requestedArch = opts.archetype ?? 'any';
  const resolvedArchId: CharacterArchetypeId =
    requestedArch === 'any'
      ? COHERENT_ARCHETYPES[Math.floor(rng() * COHERENT_ARCHETYPES.length)]!
      : requestedArch;
  const arch = CHARACTER_ARCHETYPES[resolvedArchId] ?? CHARACTER_ARCHETYPES.any;

  const ch = new PaperDollCharacter(pack);

  // 1. Skin selection
  const allSkins = Object.keys(pack.skins);
  const skinPool =
    opts.excludeWoodSkin !== false
      ? allSkins.filter((k) => k !== 'wood')
      : allSkins;
  const chosenSkin =
    (skinPool.length > 0 ? skinPool : allSkins)[
      Math.floor(rng() * (skinPool.length > 0 ? skinPool.length : allSkins.length))
    ] ?? ch.skin;
  ch.setSkin(chosenSkin);

  // 2. Harmonious palette trio (primary, accent, hair/leather)
  const availablePalettes = Object.keys(pack.palettes);
  const archPals = arch.preferredPalettes.filter((p) => p in pack.palettes);
  const primaryPalPool = archPals.length > 0 ? archPals : availablePalettes;
  const mainPal = primaryPalPool[Math.floor(rng() * primaryPalPool.length)] ?? availablePalettes[0]!;

  const harmonyCandidates = (PALETTE_HARMONY[mainPal] ?? availablePalettes).filter(
    (p) => p in pack.palettes && p !== mainPal,
  );
  const accentPal =
    harmonyCandidates.length > 0
      ? harmonyCandidates[Math.floor(rng() * harmonyCandidates.length)]!
      : mainPal;

  const hairPals = ['obsidian', 'bronze', 'amber', 'ivory', 'frost', 'sakura', 'crimson'].filter(
    (p) => p in pack.palettes,
  );
  const hairPal = hairPals.length > 0 ? hairPals[Math.floor(rng() * hairPals.length)]! : accentPal;

  const leatherPals = ['bronze', 'obsidian', 'amber'].filter((p) => p in pack.palettes);
  const leatherPal =
    leatherPals.length > 0 ? leatherPals[Math.floor(rng() * leatherPals.length)]! : accentPal;

  // 3. Weighted part selection per slot
  for (const slot of pack.slots) {
    const partList = pack.parts[slot.id] ?? [];
    if (partList.length === 0) continue;

    // back_arm mirrors front_arm right after the loop
    if (slot.id === 'back_arm') continue;

    if (!slot.required) {
      const equipChance = arch.slotEquipChance?.[slot.id] ?? 0.7;
      // Always equip torso_top, feet_shoes, face_eyes for complete characters
      const effectiveChance =
        slot.id === 'torso_top' || slot.id === 'feet_shoes' || slot.id === 'face_eyes'
          ? 1.0
          : equipChance;
      if (rng() > effectiveChance) {
        ch.setSlot(slot.id, 'none');
        continue;
      }
    }

    const weighted = partList.map((part) => ({
      value: part,
      weight: scorePartForArchetype(part, arch),
    }));
    const picked = pickWeighted(weighted, rng);
    ch.setSlot(slot.id, picked.id);

    // Assign harmonious palette based on slot role
    if (slot.id === 'hair_style' || slot.id === 'face_beard') {
      ch.setPalette(slot.id, hairPal);
    } else if (slot.id === 'belt_waist' || slot.id === 'back_prop' || slot.id === 'feet_shoes') {
      ch.setPalette(slot.id, rng() < 0.65 ? leatherPal : accentPal);
    } else if (slot.id === 'back_cape' || slot.id === 'main_hand' || slot.id === 'off_hand') {
      ch.setPalette(slot.id, rng() < 0.65 ? accentPal : mainPal);
    } else {
      ch.setPalette(slot.id, rng() < 0.8 ? mainPal : accentPal);
    }
  }

  // 4. Mirror arm sleeves symmetrically & keep beard color synced with hair
  if ('back_arm' in ch.slots && 'front_arm' in ch.slots) {
    ch.setSlot('back_arm', ch.slots.front_arm ?? 'bare');
    ch.setPalette('back_arm', ch.palettes.front_arm ?? mainPal);
  }
  if ('face_beard' in ch.palettes && 'hair_style' in ch.palettes) {
    ch.setPalette('face_beard', ch.palettes.hair_style ?? hairPal);
  }

  // 5. Respect two-handed main_hand hidesSlots rule so off_hand isn't pointlessly equipped
  const mainHandPart = pack.parts.main_hand?.find((p) => p.id === ch.slots.main_hand);
  if (mainHandPart?.rules?.hidesSlots?.includes('off_hand') && 'off_hand' in ch.slots) {
    ch.setSlot('off_hand', 'none');
  }

  // 6. Direction & action
  if (opts.direction && pack.directions.some((d) => d.id === opts.direction)) {
    ch.setDirection(opts.direction);
  } else if (opts.randomDirection) {
    const frontDirs = ['S', 'SE', 'SW', 'E', 'W'].filter((id) =>
      pack.directions.some((d) => d.id === id),
    );
    if (frontDirs.length > 0) {
      ch.setDirection(frontDirs[Math.floor(rng() * frontDirs.length)]!);
    }
  } else if (pack.directions.some((d) => d.id === 'SE')) {
    ch.setDirection('SE');
  }

  const action = opts.action ?? 'idle';
  if (pack.animations[action]) {
    ch.setAction(action);
  }

  return {
    seed: seedStr,
    archetype: resolvedArchId,
    archetypeLabel: arch.label,
    config: ch.toJSON(),
  };
}

/**
 * Generates a deterministic batch of N characters from a single base seed
 * (e.g. populating an entire village or party reproducibly).
 */
export function generateCharacterBatch(
  pack: AssetPackManifest,
  opts: {
    count: number;
    seed: string | number;
    archetype?: CharacterArchetypeId;
    randomDirection?: boolean;
  },
): GeneratedCharacterResult[] {
  const results: GeneratedCharacterResult[] = [];
  const count = Math.max(1, Math.floor(opts.count));
  for (let i = 0; i < count; i++) {
    results.push(
      generateSeededCharacter(pack, {
        seed: `${opts.seed}#${i + 1}`,
        archetype: opts.archetype ?? 'any',
        randomDirection: opts.randomDirection ?? true,
      }),
    );
  }
  return results;
}
