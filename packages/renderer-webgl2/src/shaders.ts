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
out vec2 v_world_pos;

void main() {
  // Position in untrimmed sprite local coordinates relative to pivot
  vec2 localPos = (u_trim_offset + a_unit_pos * u_trim_size) - (u_pivot * u_orig_size);
  if (u_flip_x > 0.5) {
    localPos.x = -localPos.x;
  }

  // Transform to character canvas coordinates (Y-down)
  vec3 worldPos = u_world_mat * vec3(localPos, 1.0);
  v_world_pos = worldPos.xy;

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
 * Mask + Gradient Ramp LUT contract (1:1 parity with Godot 4 .gdshader & Cocos 3.x .effect),
 * plus optional real-time 2D Normal Map point-light preview.
 */
export const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec2 v_world_pos;

uniform sampler2D u_albedo_tex;
uniform sampler2D u_mask_tex;
uniform sampler2D u_lut_tex;
uniform sampler2D u_normal_tex;
uniform int u_recolor_mode;   // 0=none, 1=mask_ramp, 2=tint
uniform vec4 u_tint_color;
uniform float u_opacity;
uniform int u_debug_mask;     // 0=normal, 1=visualize semantic mask channels
uniform float u_highlight;    // 0..1 subtle selection flash
uniform int u_light_enabled;  // 0=off, 1=2D point light with normal map
uniform vec3 u_light_pos;     // canvas-space (x, y, z)
uniform vec3 u_light_color;
uniform float u_light_intensity;
uniform float u_light_ambient;
uniform float u_flip_x_fs;
uniform float u_flash_amount;
uniform vec3 u_flash_color;
uniform float u_outline_width;
uniform vec4 u_outline_color;
uniform vec2 u_texel_size;
uniform int u_status_mode;     // 0=none, 1=frozen, 2=poison, 3=burn, 4=stealth, 5=petrify
uniform float u_status_intensity;

out vec4 outColor;

void main() {
  vec4 albedo = texture(u_albedo_tex, v_uv);

  // Optional 8-neighbor outer outline on transparent border pixels (1:1 with Godot 4 & Cocos 3)
  if (u_outline_width > 0.01 && albedo.a < 0.1) {
    vec2 px = u_texel_size * u_outline_width;
    float na = 0.0;
    na = max(na, texture(u_albedo_tex, v_uv + vec2( px.x,  0.0)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2(-px.x,  0.0)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2( 0.0,  px.y)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2( 0.0, -px.y)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2( px.x,  px.y)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2(-px.x,  px.y)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2( px.x, -px.y)).a);
    na = max(na, texture(u_albedo_tex, v_uv + vec2(-px.x, -px.y)).a);
    if (na > 0.25) {
      vec3 outRgb = mix(u_outline_color.rgb, u_flash_color, u_flash_amount);
      float outAlpha = u_outline_color.a * u_opacity * (u_status_mode == 4 ? mix(1.0, 0.42, u_status_intensity) : 1.0);
      outColor = vec4(outRgb, outAlpha);
      return;
    }
  }

  if (albedo.a <= 0.004) discard;

  vec4 mask = texture(u_mask_tex, v_uv);

  if (u_debug_mask == 1) {
    // Visualizes R(primary), G(secondary), B(skin)
    float sum = mask.r + mask.g + mask.b;
    vec3 base = mix(albedo.rgb * 0.35, mask.rgb, clamp(sum, 0.0, 1.0));
    outColor = vec4(base, albedo.a * u_opacity);
    return;
  }

  vec3 finalRgb = albedo.rgb;

  if (u_recolor_mode == 1) {
    float lum = dot(albedo.rgb, vec3(${LUMINANCE_WEIGHTS.r}, ${LUMINANCE_WEIGHTS.g}, ${LUMINANCE_WEIGHTS.b}));
    vec3 cPrimary   = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.PRIMARY})).rgb;
    vec3 cSecondary = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.SECONDARY})).rgb;
    vec3 cSkin      = texture(u_lut_tex, vec2(lum, ${LUT_ROW_V.SKIN})).rgb;

    vec3 w = mask.rgb;
    float wSum = w.r + w.g + w.b;
    if (wSum > 1.0) {
      w /= wSum;
    }
    float wOrig = max(0.0, 1.0 - (w.r + w.g + w.b));

    finalRgb = albedo.rgb * wOrig
             + cPrimary * w.r
             + cSecondary * w.g
             + cSkin * w.b;
  } else if (u_recolor_mode == 2) {
    finalRgb = albedo.rgb * u_tint_color.rgb;
  }

  if (u_light_enabled == 1) {
    vec3 n = normalize(texture(u_normal_tex, v_uv).rgb * 2.0 - 1.0);
    if (u_flip_x_fs > 0.5) {
      n.x = -n.x;
    }
    vec3 lightDelta = vec3(u_light_pos.x - v_world_pos.x, -(u_light_pos.y - v_world_pos.y), u_light_pos.z);
    float dist = length(lightDelta);
    vec3 L = lightDelta / max(dist, 0.001);
    float atten = 1.0 / (1.0 + 0.000035 * dist * dist);
    float ndl = max(dot(n, L), 0.0);
    vec3 halfVec = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, halfVec), 0.0), 18.0) * 0.22;
    vec3 lit = vec3(u_light_ambient) + u_light_color * (ndl * u_light_intensity * atten);
    finalRgb = finalRgb * lit + u_light_color * (spec * u_light_intensity * atten);
  }

  float finalAlpha = albedo.a * u_opacity;

  // Combat status effect filters
  if (u_status_mode > 0 && u_status_intensity > 0.001) {
    float g = dot(finalRgb, vec3(0.299, 0.587, 0.114));
    vec3 fx = finalRgb;
    if (u_status_mode == 1) {
      // Frozen: crisp glacier cyan-blue tint + frost lift
      fx = mix(vec3(g * 0.55, g * 0.92, min(1.0, g * 1.25 + 0.14)), vec3(0.55, 0.92, 1.0), 0.22);
    } else if (u_status_mode == 2) {
      // Poison: toxic emerald-chartreuse tint
      fx = vec3(finalRgb.r * 0.62 + g * 0.15, min(1.0, finalRgb.g * 1.12 + 0.12), finalRgb.b * 0.68 + 0.08);
    } else if (u_status_mode == 3) {
      // Burn: warm ember orange-crimson boost
      fx = vec3(min(1.0, finalRgb.r * 1.28 + 0.16), min(1.0, finalRgb.g * 0.88 + 0.06), finalRgb.b * 0.52);
    } else if (u_status_mode == 4) {
      // Stealth: cool shadow ghost translucency
      fx = mix(finalRgb, vec3(g * 0.55, g * 0.72, g * 1.05), 0.65);
      finalAlpha *= mix(1.0, 0.42, u_status_intensity);
    } else if (u_status_mode == 5) {
      // Petrify: stone slate grayscale with contrast
      float stone = clamp((g - 0.5) * 1.15 + 0.5, 0.0, 1.0);
      fx = vec3(stone * 0.92, stone * 0.94, stone * 0.98);
    }
    finalRgb = mix(finalRgb, fx, u_status_intensity);
  }

  if (u_flash_amount > 0.001) {
    finalRgb = mix(finalRgb, u_flash_color, clamp(u_flash_amount, 0.0, 1.0));
  }

  if (u_highlight > 0.0) {
    finalRgb = mix(finalRgb, vec3(0.45, 0.85, 1.0), u_highlight * 0.35);
  }

  outColor = vec4(finalRgb, finalAlpha);
}
`;

/**
 * Lightweight GLSL ES 3.00 Vertex Shader for additive equipment glow halos
 * (e.g. magic staff tip gem, floating orb, lantern flame, halo).
 */
export const GLOW_VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unit_pos;

uniform vec2 u_glow_pos;       // World position in character canvas pixels (Y-down)
uniform float u_glow_radius;   // Radius in character canvas pixels
uniform vec2 u_canvas_size;
uniform vec2 u_viewport_size;
uniform vec2 u_pan;
uniform float u_zoom;

out vec2 v_local; // [-1, 1] centered on glow

void main() {
  v_local = a_unit_pos * 2.0 - 1.0;
  vec2 worldPos = u_glow_pos + v_local * u_glow_radius;
  vec2 centered = (worldPos - u_canvas_size * 0.5) * u_zoom + u_viewport_size * 0.5 + u_pan;
  vec2 ndc = (centered / u_viewport_size) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

/**
 * Lightweight GLSL ES 3.00 Fragment Shader rendering a soft radial glow halo
 * with an optional crisp 4-point star flare (blended with SRC_ALPHA, ONE).
 */
export const GLOW_FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_local;

uniform vec3 u_glow_color;
uniform float u_glow_intensity;
uniform int u_star_flare;

out vec4 outColor;

void main() {
  float r = length(v_local);
  if (r >= 1.0) discard;

  // Soft exponential core + wide atmospheric falloff
  float core = exp(-r * r * 14.0);
  float halo = pow(max(0.0, 1.0 - r), 2.4) * 0.65;
  float flare = 0.0;
  if (u_star_flare == 1) {
    float ax = exp(-abs(v_local.x) * 14.0) * exp(-abs(v_local.y) * 2.4);
    float ay = exp(-abs(v_local.y) * 14.0) * exp(-abs(v_local.x) * 2.4);
    flare = (ax + ay) * 0.55;
  }

  float energy = clamp((core + halo + flare) * u_glow_intensity, 0.0, 1.5);
  // White-hot center blending smoothly into colored halo
  vec3 rgb = mix(u_glow_color, vec3(1.0), clamp(core * 0.72, 0.0, 0.85));
  outColor = vec4(rgb, clamp(energy, 0.0, 1.0));
}
`;
