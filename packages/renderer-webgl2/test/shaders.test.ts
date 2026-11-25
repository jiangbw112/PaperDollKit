import { LUMINANCE_WEIGHTS, LUT_ROW_V, SHADER_UNIFORMS } from '@paperdollkit/core';
import { describe, expect, it } from 'vitest';
import {
  FRAGMENT_SHADER_SRC,
  GLOW_FRAGMENT_SHADER_SRC,
  GLOW_VERTEX_SHADER_SRC,
  VERTEX_SHADER_SRC,
} from '../src/index.js';

describe('@paperdollkit/renderer-webgl2 shader contract', () => {
  it('embeds exact Rec. 709 luminance weights and 256×4 LUT row V coordinates', () => {
    expect(FRAGMENT_SHADER_SRC).toContain('#version 300 es');
    expect(VERTEX_SHADER_SRC).toContain('#version 300 es');
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUMINANCE_WEIGHTS.r));
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUMINANCE_WEIGHTS.g));
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUMINANCE_WEIGHTS.b));
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUT_ROW_V.PRIMARY));
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUT_ROW_V.SECONDARY));
    expect(FRAGMENT_SHADER_SRC).toContain(String(LUT_ROW_V.SKIN));
  });

  it('declares all required canonical shader uniforms', () => {
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.ALBEDO_TEX);
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.MASK_TEX);
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.LUT_TEX);
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.RECOLOR_MODE);
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.TINT_COLOR);
    expect(FRAGMENT_SHADER_SRC).toContain(SHADER_UNIFORMS.OPACITY);
  });

  it('supports combat VFX (hit flash, 8-neighbor outline, status filters) and 2D normal lighting', () => {
    expect(FRAGMENT_SHADER_SRC).toContain('u_flash_amount');
    expect(FRAGMENT_SHADER_SRC).toContain('u_flash_color');
    expect(FRAGMENT_SHADER_SRC).toContain('u_outline_width');
    expect(FRAGMENT_SHADER_SRC).toContain('u_outline_color');
    expect(FRAGMENT_SHADER_SRC).toContain('u_status_mode');
    expect(FRAGMENT_SHADER_SRC).toContain('u_normal_tex');
  });

  it('provides GLSL ES 3.00 additive glow shaders with star flare support', () => {
    expect(GLOW_VERTEX_SHADER_SRC).toContain('#version 300 es');
    expect(GLOW_VERTEX_SHADER_SRC).toContain('u_glow_pos');
    expect(GLOW_VERTEX_SHADER_SRC).toContain('u_glow_radius');
    expect(GLOW_FRAGMENT_SHADER_SRC).toContain('#version 300 es');
    expect(GLOW_FRAGMENT_SHADER_SRC).toContain('u_glow_color');
    expect(GLOW_FRAGMENT_SHADER_SRC).toContain('u_glow_intensity');
    expect(GLOW_FRAGMENT_SHADER_SRC).toContain('u_star_flare');
  });
});
