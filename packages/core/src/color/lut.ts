import type {
  ColorPalette,
  ColorRamp,
  HandColorBugMode,
  RGBA,
  SkinTone,
  SlotId,
} from '../schema/types.js';
import {
  LUMINANCE_WEIGHTS,
  LUT_ROW,
  LUT_TEXTURE_HEIGHT,
  LUT_TEXTURE_WIDTH,
} from '../shader/contract.js';

export const DEFAULT_METAL_RAMP: ColorRamp = {
  stops: [
    { t: 0.0, color: '#1e2430' },
    { t: 0.35, color: '#5a667a' },
    { t: 0.72, color: '#9aa8bd' },
    { t: 1.0, color: '#e2eaf5' },
  ],
};

export const WOOD_FALLBACK_RAMP: ColorRamp = {
  stops: [
    { t: 0.0, color: '#4f3319' },
    { t: 0.35, color: '#996a3b' },
    { t: 0.72, color: '#cfa06b' },
    { t: 1.0, color: '#edd0a4' },
  ],
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, or RGBA object into 0..255 RGBA. */
export function parseColor(input: string | RGBA): RGBA {
  if (typeof input !== 'string') {
    return {
      r: clampByte(input.r),
      g: clampByte(input.g),
      b: clampByte(input.b),
      a: clampByte(input.a),
    };
  }
  const hex = input.trim().replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    const a = hex.length === 4 ? parseInt(hex[3]! + hex[3]!, 16) : 255;
    return { r, g, b, a };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return { r, g, b, a };
  }
  throw new Error(`Invalid color string: "${input}"`);
}

/** Convenience helper converting a 4-step ramp [outline, dark, base, light] into a ColorRamp. */
export function rampFromFourHex(colors: readonly [string, string, string, string]): ColorRamp {
  return {
    stops: [
      { t: 0.0, color: colors[0] },
      { t: 0.35, color: colors[1] },
      { t: 0.72, color: colors[2] },
      { t: 1.0, color: colors[3] },
    ],
  };
}

/** Samples a smooth ColorRamp at normalized luminance t in [0, 1]. */
export function sampleRamp(ramp: ColorRamp, t: number): RGBA {
  const stops = ramp.stops;
  if (stops.length === 0) return { r: 255, g: 255, b: 255, a: 255 };
  const clamped = Math.max(0, Math.min(1, t));
  const sorted = stops.length > 1 ? [...stops].sort((a, b) => a.t - b.t) : stops;

  if (clamped <= sorted[0]!.t) return parseColor(sorted[0]!.color);
  const last = sorted[sorted.length - 1]!;
  if (clamped >= last.t) return parseColor(last.color);

  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i]!;
    const s1 = sorted[i + 1]!;
    if (clamped >= s0.t && clamped <= s1.t) {
      const span = s1.t - s0.t;
      const frac = span > 0 ? (clamped - s0.t) / span : 0;
      const c0 = parseColor(s0.color);
      const c1 = parseColor(s1.color);
      return {
        r: clampByte(c0.r + (c1.r - c0.r) * frac),
        g: clampByte(c0.g + (c1.g - c0.g) * frac),
        b: clampByte(c0.b + (c1.b - c0.b) * frac),
        a: clampByte(c0.a + (c1.a - c0.a) * frac),
      };
    }
  }
  return parseColor(last.color);
}

/** Bakes a single LUT row (width × 4 RGBA8 bytes). */
export function bakeRampRow(ramp: ColorRamp, width: number = LUT_TEXTURE_WIDTH): Uint8Array {
  const row = new Uint8Array(width * 4);
  const denom = Math.max(1, width - 1);
  for (let i = 0; i < width; i++) {
    const rgba = sampleRamp(ramp, i / denom);
    const offset = i * 4;
    row[offset] = rgba.r;
    row[offset + 1] = rgba.g;
    row[offset + 2] = rgba.b;
    row[offset + 3] = rgba.a;
  }
  return row;
}

export interface BakedLUTTexture {
  width: number;
  height: number;
  /** Tightly packed RGBA8 bytes (width * height * 4) ready for WebGL2 / Godot / Cocos. */
  data: Uint8Array;
}

const ARM_SLOTS = new Set<SlotId>(['front_arm', 'back_arm']);

/**
 * Bakes the 256×4 RGBA8 LUT texture defined by the cross-engine shader contract:
 *   Row 0: Primary clothing ramp
 *   Row 1: Secondary clothing ramp
 *   Row 2: Skin tone ramp (respects handColorBugMode on arm slots for QA/education)
 *   Row 3: Metal accent ramp
 */
export function bakeSlotLUTTexture(
  slotId: SlotId,
  palette: ColorPalette,
  skin: SkinTone,
  handColorBugMode: HandColorBugMode = 'none',
  width: number = LUT_TEXTURE_WIDTH,
): BakedLUTTexture {
  const height = LUT_TEXTURE_HEIGHT;
  const data = new Uint8Array(width * height * 4);

  let effectiveSkinRamp = skin.ramp;
  if (ARM_SLOTS.has(slotId)) {
    if (handColorBugMode === 'baked_wood') {
      effectiveSkinRamp = WOOD_FALLBACK_RAMP;
    } else if (handColorBugMode === 'dyed_sleeve') {
      effectiveSkinRamp = palette.primary;
    }
  }

  const rows: readonly [number, ColorRamp][] = [
    [LUT_ROW.PRIMARY, palette.primary],
    [LUT_ROW.SECONDARY, palette.secondary],
    [LUT_ROW.SKIN, effectiveSkinRamp],
    [LUT_ROW.METAL, palette.metal ?? DEFAULT_METAL_RAMP],
  ];

  for (const [rowIdx, ramp] of rows) {
    const rowBytes = bakeRampRow(ramp, width);
    data.set(rowBytes, rowIdx * width * 4);
  }

  return { width, height, data };
}

/**
 * CPU reference implementation of the Mask + Gradient Ramp LUT fragment shader.
 * Used for deterministic unit tests and headless CPU baking parity checks.
 */
export function evaluatePixelMaskRamp(
  albedo: RGBA,
  mask: RGBA,
  lut: BakedLUTTexture,
): RGBA {
  if (albedo.a === 0) return { r: 0, g: 0, b: 0, a: 0 };

  const ar = albedo.r / 255;
  const ag = albedo.g / 255;
  const ab = albedo.b / 255;

  const lum =
    ar * LUMINANCE_WEIGHTS.r +
    ag * LUMINANCE_WEIGHTS.g +
    ab * LUMINANCE_WEIGHTS.b;
  const x = Math.max(0, Math.min(lut.width - 1, Math.round(lum * (lut.width - 1))));

  const sampleRow = (rowIdx: number): [number, number, number] => {
    const o = (rowIdx * lut.width + x) * 4;
    return [lut.data[o]! / 255, lut.data[o + 1]! / 255, lut.data[o + 2]! / 255];
  };

  let wPrimary = mask.r / 255;
  let wSecondary = mask.g / 255;
  let wSkin = mask.b / 255;

  const totalMask = wPrimary + wSecondary + wSkin;
  if (totalMask > 1) {
    wPrimary /= totalMask;
    wSecondary /= totalMask;
    wSkin /= totalMask;
  }
  const wOriginal = Math.max(0, 1 - (wPrimary + wSecondary + wSkin));

  const cPrimary = sampleRow(LUT_ROW.PRIMARY);
  const cSecondary = sampleRow(LUT_ROW.SECONDARY);
  const cSkin = sampleRow(LUT_ROW.SKIN);

  const outR =
    ar * wOriginal +
    cPrimary[0] * wPrimary +
    cSecondary[0] * wSecondary +
    cSkin[0] * wSkin;
  const outG =
    ag * wOriginal +
    cPrimary[1] * wPrimary +
    cSecondary[1] * wSecondary +
    cSkin[1] * wSkin;
  const outB =
    ab * wOriginal +
    cPrimary[2] * wPrimary +
    cSecondary[2] * wSecondary +
    cSkin[2] * wSkin;

  return {
    r: clampByte(outR * 255),
    g: clampByte(outG * 255),
    b: clampByte(outB * 255),
    a: albedo.a,
  };
}
