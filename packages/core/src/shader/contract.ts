/**
 * Cross-Engine Shader Contract (WebGL2 / Godot 4 .gdshader / Cocos Creator 3.x .effect)
 *
 * All three render targets implement the exact same Mask + Gradient Ramp LUT
 * recolor math so studio preview matches in-engine rendering 1:1.
 *
 * Semantic Mask Texture (RGBA8, opaque A=255, aligned with albedo UV):
 *   - mask.r = Primary clothing weight   (samples LUT row 0)
 *   - mask.g = Secondary clothing weight (samples LUT row 1)
 *   - mask.b = Skin channel weight       (samples LUT row 2 — keeps hands in sync with body skin!)
 *   - mask.a = Always 255 (opaque so Photoshop/PNG/Canvas2D never premultiply away RGB weights)
 *   - residual = max(0.0, 1.0 - (mask.r + mask.g + mask.b)) keeps original albedo RGB (lineart, eyes, silver metal)
 *
 * LUT Texture (RGBA8, width = 256, height = 4, filter = LINEAR, wrap = CLAMP_TO_EDGE):
 *   - Row 0 (v = 0.125): Primary clothing ramp
 *   - Row 1 (v = 0.375): Secondary clothing ramp
 *   - Row 2 (v = 0.625): Skin tone ramp
 *   - Row 3 (v = 0.875): Metal / neutral accent ramp
 *
 * Luminance Formula (Rec. 709):
 *   lum = dot(albedo.rgb, vec3(0.2126, 0.7152, 0.0722))
 */

export const LUT_TEXTURE_WIDTH = 256 as const;
export const LUT_TEXTURE_HEIGHT = 4 as const;

export const LUT_ROW = {
  PRIMARY: 0,
  SECONDARY: 1,
  SKIN: 2,
  METAL: 3,
} as const;

export const LUT_ROW_V = {
  PRIMARY: (LUT_ROW.PRIMARY + 0.5) / LUT_TEXTURE_HEIGHT,
  SECONDARY: (LUT_ROW.SECONDARY + 0.5) / LUT_TEXTURE_HEIGHT,
  SKIN: (LUT_ROW.SKIN + 0.5) / LUT_TEXTURE_HEIGHT,
  METAL: (LUT_ROW.METAL + 0.5) / LUT_TEXTURE_HEIGHT,
} as const;

export const LUMINANCE_WEIGHTS = {
  r: 0.2126,
  g: 0.7152,
  b: 0.0722,
} as const;

export const SHADER_UNIFORMS = {
  ALBEDO_TEX: 'u_albedo_tex',
  MASK_TEX: 'u_mask_tex',
  LUT_TEX: 'u_lut_tex',
  RECOLOR_MODE: 'u_recolor_mode', // 0=none, 1=mask_ramp, 2=tint, 3=indexed_lut
  TINT_COLOR: 'u_tint_color',
  OPACITY: 'u_opacity',
} as const;
