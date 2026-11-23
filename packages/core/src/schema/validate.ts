import {
  SCHEMA_VERSION,
  type AssetPackManifest,
  type CharacterConfig,
  type HandColorBugMode,
} from './types.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const VALID_BUG_MODES = new Set<HandColorBugMode>(['none', 'baked_wood', 'dyed_sleeve']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an AssetPackManifest for structural integrity and cross-references
 * (parent slots, direction mirror targets, Z-Order slot names, palettes/skins).
 */
export function validateAssetPack(input: unknown): ValidationResult<AssetPackManifest> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['AssetPackManifest must be a plain object.'] };
  }

  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion "${String(input.schemaVersion)}"; expected "${SCHEMA_VERSION}".`);
  }
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    errors.push('AssetPackManifest.id must be a non-empty string.');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('AssetPackManifest.name must be a non-empty string.');
  }

  if (
    !isRecord(input.canvasSize) ||
    typeof input.canvasSize.width !== 'number' ||
    typeof input.canvasSize.height !== 'number' ||
    input.canvasSize.width <= 0 ||
    input.canvasSize.height <= 0
  ) {
    errors.push('AssetPackManifest.canvasSize must have positive numeric width and height.');
  }

  if (!Array.isArray(input.directions) || input.directions.length === 0) {
    errors.push('AssetPackManifest.directions must be a non-empty array.');
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    errors.push('AssetPackManifest.slots must be a non-empty array.');
  }

  const directionIds = new Set<string>();
  if (Array.isArray(input.directions)) {
    for (const dir of input.directions) {
      if (!isRecord(dir) || typeof dir.id !== 'string' || dir.id.length === 0) {
        errors.push('Each direction must have a non-empty string id.');
        continue;
      }
      if (directionIds.has(dir.id)) {
        errors.push(`Duplicate direction id "${dir.id}".`);
      }
      directionIds.add(dir.id);
    }
    for (const dir of input.directions) {
      if (isRecord(dir) && typeof dir.mirrorFrom === 'string') {
        if (!directionIds.has(dir.mirrorFrom)) {
          errors.push(`Direction "${String(dir.id)}" references unknown mirrorFrom "${dir.mirrorFrom}".`);
        }
        if (dir.mirrorFrom === dir.id) {
          errors.push(`Direction "${String(dir.id)}" cannot mirrorFrom itself.`);
        }
      }
    }
  }

  const slotIds = new Set<string>();
  const parentMap = new Map<string, string>();
  if (Array.isArray(input.slots)) {
    for (const slot of input.slots) {
      if (!isRecord(slot) || typeof slot.id !== 'string' || slot.id.length === 0) {
        errors.push('Each slot must have a non-empty string id.');
        continue;
      }
      if (slotIds.has(slot.id)) {
        errors.push(`Duplicate slot id "${slot.id}".`);
      }
      slotIds.add(slot.id);
      if (typeof slot.parent === 'string') {
        parentMap.set(slot.id, slot.parent);
      }
    }
    // Check parent existence and cycle freedom
    for (const [child, parent] of parentMap.entries()) {
      if (!slotIds.has(parent)) {
        errors.push(`Slot "${child}" references unknown parent slot "${parent}".`);
        continue;
      }
      const visited = new Set<string>([child]);
      let cur: string | undefined = parent;
      while (cur !== undefined) {
        if (visited.has(cur)) {
          errors.push(`Cycle detected in slot hierarchy involving "${child}".`);
          break;
        }
        visited.add(cur);
        cur = parentMap.get(cur);
      }
    }
  }

  if (!isRecord(input.zOrder)) {
    errors.push('AssetPackManifest.zOrder must be an object keyed by direction id.');
  } else {
    for (const dirId of directionIds) {
      const order = input.zOrder[dirId];
      if (!Array.isArray(order) || order.length === 0) {
        errors.push(`Missing zOrder array for direction "${dirId}".`);
      } else {
        for (const slotId of order) {
          if (typeof slotId !== 'string' || !slotIds.has(slotId)) {
            errors.push(`zOrder["${dirId}"] references unknown slot "${String(slotId)}".`);
          }
        }
      }
    }
  }

  if (!isRecord(input.palettes) || Object.keys(input.palettes).length === 0) {
    errors.push('AssetPackManifest.palettes must define at least one palette.');
  }
  if (!isRecord(input.skins) || Object.keys(input.skins).length === 0) {
    errors.push('AssetPackManifest.skins must define at least one skin tone.');
  }
  if (!isRecord(input.parts)) {
    errors.push('AssetPackManifest.parts must be an object keyed by slot id.');
  }
  if (!isRecord(input.animations) || Object.keys(input.animations).length === 0) {
    errors.push('AssetPackManifest.animations must define at least one animation clip.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as unknown as AssetPackManifest };
}

/**
 * Validates a CharacterConfig against a loaded AssetPackManifest.
 */
export function validateCharacterConfig(
  input: unknown,
  pack: AssetPackManifest,
): ValidationResult<CharacterConfig> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['CharacterConfig must be a plain object.'] };
  }

  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Unsupported character schemaVersion "${String(input.schemaVersion)}".`);
  }

  if (typeof input.skin !== 'string' || !pack.skins[input.skin]) {
    errors.push(`Unknown skin "${String(input.skin)}".`);
  }

  if (
    typeof input.direction !== 'string' ||
    !pack.directions.some((d) => d.id === input.direction)
  ) {
    errors.push(`Unknown direction "${String(input.direction)}".`);
  }

  if (typeof input.action !== 'string' || !pack.animations[input.action]) {
    errors.push(`Unknown action "${String(input.action)}".`);
  }

  const bugMode = (input.handColorBugMode ?? 'none') as HandColorBugMode;
  if (!VALID_BUG_MODES.has(bugMode)) {
    errors.push(`Invalid handColorBugMode "${String(input.handColorBugMode)}".`);
  }

  if (!isRecord(input.slots)) {
    errors.push('CharacterConfig.slots must be an object.');
  } else {
    for (const [slotId, partId] of Object.entries(input.slots)) {
      if (typeof partId !== 'string') {
        errors.push(`Slot "${slotId}" partId must be a string.`);
        continue;
      }
      if (partId === 'none') continue;
      const available = pack.parts[slotId];
      if (!available || !available.some((p) => p.id === partId)) {
        errors.push(`Unknown part "${partId}" for slot "${slotId}".`);
      }
    }
  }

  if (!isRecord(input.palettes)) {
    errors.push('CharacterConfig.palettes must be an object.');
  } else {
    for (const [slotId, paletteId] of Object.entries(input.palettes)) {
      if (typeof paletteId !== 'string' || !pack.palettes[paletteId]) {
        errors.push(`Unknown palette "${String(paletteId)}" for slot "${slotId}".`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as unknown as CharacterConfig };
}
