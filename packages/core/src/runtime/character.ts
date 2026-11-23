import {
  SCHEMA_VERSION,
  type AssetPackManifest,
  type CharacterConfig,
  type DirectionId,
  type EvaluatedFrame,
  type HandColorBugMode,
  type SlotId,
} from '../schema/types.js';
import { validateCharacterConfig } from '../schema/validate.js';
import { evaluateCharacterFrame, type EvaluateOptions } from './evaluator.js';

const CLOTHING_SLOTS: readonly SlotId[] = [
  'back_cape',
  'legs_bottom',
  'feet_shoes',
  'torso_top',
  'belt_waist',
  'back_arm',
  'front_arm',
  'head_hat',
];

export interface PaperDollCharacterInit {
  preset?: string;
  skin?: string;
  direction?: DirectionId;
  action?: string;
  handColorBugMode?: HandColorBugMode;
  slots?: Record<SlotId, string>;
  palettes?: Record<SlotId, string>;
  hiddenSlots?: SlotId[];
}

/**
 * Stateful HD 2D modular character controller backed by an AssetPackManifest.
 * Pure TypeScript / zero DOM dependencies — runs in Studio, Node CLI, and Cocos TS.
 */
export class PaperDollCharacter {
  readonly pack: AssetPackManifest;
  skin: string;
  direction: DirectionId;
  action: string;
  handColorBugMode: HandColorBugMode;
  readonly slots: Record<SlotId, string>;
  readonly palettes: Record<SlotId, string>;
  readonly hiddenSlots: Set<SlotId>;

  constructor(pack: AssetPackManifest, init: PaperDollCharacterInit = {}) {
    this.pack = pack;
    const defaultSkin = Object.keys(pack.skins)[0] ?? 'wood';
    const defaultPalette = Object.keys(pack.palettes)[0] ?? 'cobalt';
    const defaultDir = pack.directions[0]?.id ?? 'S';
    const defaultAction = Object.keys(pack.animations)[0] ?? 'idle';

    this.skin = defaultSkin;
    this.direction = defaultDir;
    this.action = defaultAction;
    this.handColorBugMode = 'none';
    this.slots = {};
    this.palettes = {};
    this.hiddenSlots = new Set<SlotId>();

    // Initialize every slot with first required part or 'none'
    for (const slot of pack.slots) {
      const partList = pack.parts[slot.id] ?? [];
      this.slots[slot.id] = slot.required && partList[0] ? partList[0].id : 'none';
      this.palettes[slot.id] = defaultPalette;
    }

    if (init.preset) {
      this.applyPreset(init.preset);
    }
    if (init.skin) this.setSkin(init.skin);
    if (init.direction) this.setDirection(init.direction);
    if (init.action) this.setAction(init.action);
    if (init.handColorBugMode) this.setHandColorBugMode(init.handColorBugMode);
    if (init.slots) {
      for (const [slotId, partId] of Object.entries(init.slots)) {
        this.setSlot(slotId, partId);
      }
    }
    if (init.palettes) {
      for (const [slotId, paletteId] of Object.entries(init.palettes)) {
        this.setPalette(slotId, paletteId);
      }
    }
    if (init.hiddenSlots) {
      for (const slotId of init.hiddenSlots) {
        this.hiddenSlots.add(slotId);
      }
    }
  }

  setSlot(slotId: SlotId, partId: string): this {
    if (!this.pack.slots.some((s) => s.id === slotId)) {
      throw new Error(`Unknown slot "${slotId}" in pack "${this.pack.id}".`);
    }
    if (partId !== 'none') {
      const valid = this.pack.parts[slotId]?.some((p) => p.id === partId);
      if (!valid) {
        throw new Error(`Unknown part "${partId}" for slot "${slotId}".`);
      }
    }
    this.slots[slotId] = partId;
    return this;
  }

  setPalette(slotId: SlotId, paletteId: string): this {
    if (!this.pack.palettes[paletteId]) {
      throw new Error(`Unknown palette "${paletteId}".`);
    }
    this.palettes[slotId] = paletteId;
    return this;
  }

  setAllClothingPalette(paletteId: string): this {
    if (!this.pack.palettes[paletteId]) {
      throw new Error(`Unknown palette "${paletteId}".`);
    }
    for (const slotId of CLOTHING_SLOTS) {
      if (slotId in this.palettes) {
        this.palettes[slotId] = paletteId;
      }
    }
    return this;
  }

  setSkin(skinId: string): this {
    if (!this.pack.skins[skinId]) {
      throw new Error(`Unknown skin "${skinId}".`);
    }
    this.skin = skinId;
    return this;
  }

  setDirection(directionId: DirectionId): this {
    if (!this.pack.directions.some((d) => d.id === directionId)) {
      throw new Error(`Unknown direction "${directionId}".`);
    }
    this.direction = directionId;
    return this;
  }

  setAction(actionId: string): this {
    if (!this.pack.animations[actionId]) {
      throw new Error(`Unknown action "${actionId}".`);
    }
    this.action = actionId;
    return this;
  }

  setHandColorBugMode(mode: HandColorBugMode): this {
    if (mode !== 'none' && mode !== 'baked_wood' && mode !== 'dyed_sleeve') {
      throw new Error(`Invalid handColorBugMode "${String(mode)}".`);
    }
    this.handColorBugMode = mode;
    return this;
  }

  setSlotVisible(slotId: SlotId, visible: boolean): this {
    if (visible) this.hiddenSlots.delete(slotId);
    else this.hiddenSlots.add(slotId);
    return this;
  }

  applyPreset(presetId: string): this {
    const preset = this.pack.presets.find((p) => p.id === presetId);
    if (!preset) {
      throw new Error(`Unknown preset "${presetId}" in pack "${this.pack.id}".`);
    }
    this.setSkin(preset.skin);
    for (const slot of this.pack.slots) {
      const partId = preset.slots[slot.id];
      if (partId !== undefined) {
        this.setSlot(slot.id, partId);
      }
      const palId = preset.palettes[slot.id];
      if (palId !== undefined) {
        this.setPalette(slot.id, palId);
      }
    }
    return this;
  }

  getActiveLayerCount(): number {
    let count = 0;
    for (const slot of this.pack.slots) {
      const partId = this.slots[slot.id];
      if (!this.hiddenSlots.has(slot.id) && partId && partId !== 'none') {
        count++;
      }
    }
    return count;
  }

  evaluate(timeMs: number = 0, opts?: EvaluateOptions): EvaluatedFrame {
    return evaluateCharacterFrame(this.pack, this.toJSON(), timeMs, opts);
  }

  toJSON(): CharacterConfig {
    return {
      schemaVersion: SCHEMA_VERSION,
      packId: this.pack.id,
      skin: this.skin,
      direction: this.direction,
      action: this.action,
      handColorBugMode: this.handColorBugMode,
      slots: { ...this.slots },
      palettes: { ...this.palettes },
      hiddenSlots: [...this.hiddenSlots],
    };
  }

  static fromJSON(pack: AssetPackManifest, data: unknown): PaperDollCharacter {
    const validated = validateCharacterConfig(data, pack);
    if (!validated.ok) {
      throw new Error(`Invalid CharacterConfig:\n- ${validated.errors.join('\n- ')}`);
    }
    return new PaperDollCharacter(pack, validated.value);
  }
}
