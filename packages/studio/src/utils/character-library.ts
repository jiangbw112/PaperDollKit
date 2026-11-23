import {
  PaperDollCharacter,
  SCHEMA_VERSION,
  type AssetPackManifest,
  type CharacterConfig,
  type HandColorBugMode,
  type SlotId,
  type Vec2,
} from '@paperdollkit/core';

export interface SavedCharacterEntry {
  id: string;
  name: string;
  updatedAt: number;
  config: CharacterConfig;
}

export interface StudioAutosave {
  version: 1;
  packId: string;
  activePresetId: string;
  config: CharacterConfig;
  slotOffsets?: Record<SlotId, Vec2>;
  updatedAt: number;
}

export interface StudioProjectFile {
  kind: 'paperdollkit-project';
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  packId: string;
  activePresetId?: string;
  config: CharacterConfig;
  slotOffsets?: Record<SlotId, Vec2>;
  library?: SavedCharacterEntry[];
}

export interface ParsedImportResult {
  config?: CharacterConfig;
  activePresetId?: string;
  slotOffsets?: Record<SlotId, Vec2>;
  importedLibrary?: SavedCharacterEntry[];
  warnings: string[];
}

const LIBRARY_STORAGE_KEY = 'paperdollkit.v2.library';
const AUTOSAVE_STORAGE_KEY = 'paperdollkit.v2.autosave';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function cloneCharacterConfig(cfg: CharacterConfig): CharacterConfig {
  return {
    ...cfg,
    slots: { ...cfg.slots },
    palettes: { ...cfg.palettes },
    ...(cfg.hiddenSlots ? { hiddenSlots: [...cfg.hiddenSlots] } : {}),
  };
}

export function extractSlotOffsets(pack: AssetPackManifest): Record<SlotId, Vec2> {
  const offsets: Record<SlotId, Vec2> = {};
  for (const s of pack.slots) {
    offsets[s.id] = { x: s.defaultOffset.x, y: s.defaultOffset.y };
  }
  return offsets;
}

export function applySlotOffsetsToPack(
  pack: AssetPackManifest,
  offsets: Record<SlotId, Vec2>,
): AssetPackManifest {
  return {
    ...pack,
    slots: pack.slots.map((s) => {
      const ov = offsets[s.id];
      return ov ? { ...s, defaultOffset: { x: ov.x, y: ov.y } } : s;
    }),
  };
}

/**
 * Sanitizes an untrusted CharacterConfig-like object against the active AssetPackManifest,
 * keeping all valid fields and collecting warnings for unknown slots/parts/palettes.
 */
export function sanitizeCharacterConfig(
  raw: unknown,
  pack: AssetPackManifest,
): { config: CharacterConfig; warnings: string[] } {
  const warnings: string[] = [];
  const ch = new PaperDollCharacter(pack);

  if (!isRecord(raw)) {
    warnings.push('配置不是有效的 JSON 对象，已使用默认角色。');
    return { config: ch.toJSON(), warnings };
  }

  if (typeof raw.skin === 'string') {
    if (pack.skins[raw.skin]) {
      ch.setSkin(raw.skin);
    } else {
      warnings.push(`未找到肤色 "${raw.skin}"，已回退默认肤色。`);
    }
  }

  if (typeof raw.direction === 'string') {
    if (pack.directions.some((d) => d.id === raw.direction)) {
      ch.setDirection(raw.direction);
    } else {
      warnings.push(`未找到朝向 "${raw.direction}"，已回退默认朝向。`);
    }
  }

  if (typeof raw.action === 'string') {
    if (pack.animations[raw.action]) {
      ch.setAction(raw.action);
    } else {
      warnings.push(`未找到动作 "${raw.action}"，已回退默认动作。`);
    }
  }

  if (
    raw.handColorBugMode === 'none' ||
    raw.handColorBugMode === 'baked_wood' ||
    raw.handColorBugMode === 'dyed_sleeve'
  ) {
    ch.setHandColorBugMode(raw.handColorBugMode as HandColorBugMode);
  }

  if (isRecord(raw.slots)) {
    for (const [slotId, partId] of Object.entries(raw.slots)) {
      if (typeof partId !== 'string') continue;
      if (!pack.slots.some((s) => s.id === slotId)) {
        warnings.push(`忽略未知槽位 "${slotId}"。`);
        continue;
      }
      if (partId === 'none' || pack.parts[slotId]?.some((p) => p.id === partId)) {
        ch.setSlot(slotId, partId);
      } else {
        warnings.push(`槽位 "${slotId}" 中未找到部件 "${partId}"，已保留默认值。`);
      }
    }
  }

  if (isRecord(raw.palettes)) {
    for (const [slotId, paletteId] of Object.entries(raw.palettes)) {
      if (typeof paletteId !== 'string') continue;
      if (!(slotId in ch.palettes)) continue;
      if (pack.palettes[paletteId]) {
        ch.setPalette(slotId, paletteId);
      } else {
        warnings.push(`未找到色板 "${paletteId}"（槽位 ${slotId}），已保留默认值。`);
      }
    }
  }

  if (Array.isArray(raw.hiddenSlots)) {
    for (const slotId of raw.hiddenSlots) {
      if (typeof slotId === 'string' && pack.slots.some((s) => s.id === slotId)) {
        ch.setSlotVisible(slotId, false);
      }
    }
  }

  return { config: ch.toJSON(), warnings };
}

function sanitizeSlotOffsets(
  raw: unknown,
  pack: AssetPackManifest,
): Record<SlotId, Vec2> | undefined {
  if (!isRecord(raw)) return undefined;
  const result: Record<SlotId, Vec2> = {};
  let count = 0;
  for (const s of pack.slots) {
    const val = raw[s.id];
    if (isRecord(val) && typeof val.x === 'number' && typeof val.y === 'number') {
      result[s.id] = { x: val.x, y: val.y };
      count++;
    }
  }
  return count > 0 ? result : undefined;
}

/**
 * Parses an imported JSON file supporting:
 * 1. Single CharacterConfig JSON (exported via JSON button)
 * 2. Full StudioProjectFile JSON (config + slotOffsets + optional library)
 * 3. SavedCharacterEntry[] array (character library backup)
 */
export function parseImportedProjectJson(
  text: string,
  pack: AssetPackManifest,
): ParsedImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  const warnings: string[] = [];

  // Case 1: Array of SavedCharacterEntry
  if (Array.isArray(parsed)) {
    const entries: SavedCharacterEntry[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!isRecord(item) || !isRecord(item.config)) continue;
      const san = sanitizeCharacterConfig(item.config, pack);
      warnings.push(...san.warnings);
      entries.push({
        id: typeof item.id === 'string' && item.id ? item.id : `imp_${Date.now()}_${i}`,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `导入角色 ${i + 1}`,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        config: san.config,
      });
    }
    if (entries.length === 0) {
      throw new Error('数组中未找到有效的角色存档条目。');
    }
    return { importedLibrary: entries, config: entries[0]!.config, warnings };
  }

  if (!isRecord(parsed)) {
    throw new Error('文件内容必须是 JSON 对象或角色数组。');
  }

  // Case 2: StudioProjectFile
  if (parsed.kind === 'paperdollkit-project' && isRecord(parsed.config)) {
    const san = sanitizeCharacterConfig(parsed.config, pack);
    warnings.push(...san.warnings);
    const slotOffsets = sanitizeSlotOffsets(parsed.slotOffsets, pack);
    let importedLibrary: SavedCharacterEntry[] | undefined;
    if (Array.isArray(parsed.library)) {
      importedLibrary = [];
      for (let i = 0; i < parsed.library.length; i++) {
        const item = parsed.library[i];
        if (!isRecord(item) || !isRecord(item.config)) continue;
        const itemSan = sanitizeCharacterConfig(item.config, pack);
        importedLibrary.push({
          id: typeof item.id === 'string' && item.id ? item.id : `imp_${Date.now()}_${i}`,
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `导入角色 ${i + 1}`,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          config: itemSan.config,
        });
      }
    }
    return {
      config: san.config,
      activePresetId: typeof parsed.activePresetId === 'string' ? parsed.activePresetId : 'custom',
      slotOffsets,
      importedLibrary,
      warnings,
    };
  }

  // Case 3: Single CharacterConfig JSON
  if (isRecord(parsed.slots) || typeof parsed.skin === 'string') {
    const san = sanitizeCharacterConfig(parsed, pack);
    warnings.push(...san.warnings);
    return { config: san.config, activePresetId: 'custom', warnings };
  }

  throw new Error('无法识别的 JSON 格式：请导入 PaperDollKit 角色 JSON 或项目存档。');
}

export function loadSavedCharacters(): SavedCharacterEntry[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCharacterEntry =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        isRecord(item.config),
    );
  } catch {
    return [];
  }
}

export function saveSavedCharacters(entries: SavedCharacterEntry[]): void {
  try {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore quota / privacy mode errors gracefully
  }
}

export function loadStudioAutosave(packId: string): StudioAutosave | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.packId !== packId ||
      !isRecord(parsed.config)
    ) {
      return null;
    }
    return parsed as unknown as StudioAutosave;
  } catch {
    return null;
  }
}

export function saveStudioAutosave(data: StudioAutosave): void {
  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota / privacy mode errors gracefully
  }
}

export function clearStudioAutosave(): void {
  try {
    window.localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}
