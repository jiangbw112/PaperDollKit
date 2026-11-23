import { LUMINANCE_WEIGHTS, LUT_ROW_V } from '@paperdollkit/core';

/**
 * GLSL ES 3.00 Vertex Shader for HD 2D Paper-Doll layers.
 * Maps unit quad [0, 1] x [0, 1] through sprite trim/pivot, optional flipX,
 * world 2D affine matrix, viewport zoom/pan, into clip space.
 */
export const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unit_pos;

uniform vec2 u_orig_size;
uniform vec2 u_trim_offset;
uniform vec2 u_trim_size;
uniform vec2 u_pivot;
uniform float u_flip_x;
uniform mat3 u_world_mat;
uniform vec2 u_canvas_size;
uniform vec2 u_viewport_size;
uniform vec2 u_pan;
uniform float u_zoom;
uniform vec4 u_uv_rect; // (u0, v0, uWidth, vHeight)

out vec2 v_uv;

void main() {
  // Position in untrimmed sprite local coordinates relative to pivot
  vec2 localPos = (u_trim_offset + a_unit_pos * u_trim_size) - (u_pivot * u_orig_size);
  if (u_flip_x > 0.5) {
    localPos.x = -localPos.x;
  }

  // Transform to character canvas coordinates (Y-down)
  vec3 worldPos = u_world_mat * vec3(localPos, 1.0);

  // Center character canvas in viewport with zoom + pan
  vec2 centered = (worldPos.xy - u_canvas_size * 0.5) * u_zoom + u_viewport_size * 0.5 + u_pan;

  // Convert pixel space (Y-down) to WebGL NDC [-1, 1] (Y-up)
  vec2 ndc = (centered / u_viewport_size) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);

  v_uv = u_uv_rect.xy + a_unit_pos * u_uv_rect.zw;
}
`;

/**
 * GLSL ES 3.00 Fragment Shader implementing the canonical PaperDollKit v2.0
 * Mask + Gradient Ramp LUT contract (1:1 parity with Godot 4 .gdshader & Cocos 3.x .effect).
 */
export const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_albedo_tex;
uniform sampler2D u_mask_tex;
uniform sampler2D u_lut_tex;
uniform int u_recolor_mode;   // 0=none, 1=mask_ramp, 2=tint
uniform vec4 u_tint_color;
uniform float u_opacity;
uniform int u_debug_mask;     // 0=normal, 1=visualize semantic mask channels
uniform float u_highlight;    // 0..1 subtle selection flash

out vec4 outColor;

void main() {
  vec4 albedo = texture(u_albedo_tex, v_uv);
  if (albedo.a <= 0.004) discard;

  vec4 mask = texture(u_mask_tex, v_uv);

  if (u_debug_mask == 1) {
    // Visualizes R(primary), G(secondary), B(skin), A(metal as cyan-white)
    vec3 dbg = mask.rgb + vec3(mask.a * 0.65);
    float sum = mask.r + mask.g + mask.b + mask.a;
    vec3 base = mix(albedo.rgb * 0.35, dbg, clamp(sum, 0.0, 1.0));
    outColor = vec4(base, albedo.a * u_opacity);
    return;
  }

  vec3 finalRgb = albedo.rgb;

  if (u_recolor_mode == 1) {
    float lum = dot(albedo.rgb, vec3(${LUMINANCE_WEIGHTS.r}, ${LUMINANCE_WEIGHTS.g}, ${LUMINANCE_WEIGHTS.b}));
    vec3 cPrimary   = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.PRIMARY})).rgb;
    vec3 cSecondary = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.SECONDARY})).rgb;
    vec3 cSkin      = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.SKIN})).rgb;
    vec3 cMetal     = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.METAL})).rgb;

    vec4 w = mask;
    float wSum = w.r + w.g + w.b + w.a;
    if (wSum > 1.0) {
      w /= wSum;
    }
    float wOrig = max(0.0, 1.0 - (w.r + w.g + w.b + w.a));

    finalRgb = albedo.rgb * wOrig
             + cPrimary * w.r
             + cSecondary * w.g
             + cSkin * w.b
             + cMetal * w.a;
  } else if (u_recolor_mode == 2) {
    finalRgb = albedo.rgb * u_tint_color.rgb;
  }

  if (u_highlight > 0.0) {
    finalRgb = mix(finalRgb, vec3(0.45, 0.85, 1.0), u_highlight * 0.35);
  }

  outColor = vec4(finalRgb, albedo.a * u_opacity);
}
`;
