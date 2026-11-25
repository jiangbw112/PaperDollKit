import { packZip } from '../codec/zip.js';
import type {
  ExportBundle,
  Godot4ModularExportOptions,
  ModularExportData,
} from '../types.js';

function buildGodotTextureImport(
  resPath: string,
  textureFilter: 'linear' | 'nearest',
  isMaskOrLut: boolean,
): string {
  return [
    '[remap]',
    '',
    'importer="texture"',
    'type="CompressedTexture2D"',
    '',
    '[deps]',
    '',
    `source_file="${resPath}"`,
    '',
    '[params]',
    '',
    'compress/mode=0',
    'compress/high_quality=false',
    'compress/lossy_quality=1.0',
    'compress/hdr_compression=1',
    'compress/normal_map=0',
    'compress/channel_pack=0',
    'mipmaps/generate=false',
    'mipmaps/limit=-1',
    'roughness/mode=0',
    'roughness/src_normal=""',
    `process/fix_alpha_border=${isMaskOrLut ? 'false' : 'true'}`,
    'process/premult_alpha=false',
    'process/normal_map_invert_y=false',
    'process/hdr_as_srgb=false',
    'process/hdr_clamp_exposure=false',
    'process/size_limit=0',
    'detect_3d/compress_to=0',
    `# Recommended Node texture_filter: ${textureFilter === 'nearest' ? 'TEXTURE_FILTER_NEAREST (1)' : 'TEXTURE_FILTER_LINEAR (2)'}`,
    '',
  ].join('\n');
}

export function buildGodot4MaskRampShader(): string {
  return `shader_type canvas_item;

// PaperDollKit v2.0 Cross-Engine Mask + 256x4 Ramp LUT Shader (Godot 4.x)
// Matches WebGL2 Studio & Cocos Creator 3.x 1:1.

uniform sampler2D u_mask_tex : filter_linear, repeat_disable;
uniform sampler2D u_lut_tex : filter_linear, repeat_disable;
uniform bool u_has_mask = false;
uniform int u_recolor_mode = 1; // 0=none, 1=mask_ramp, 2=tint
uniform vec4 u_tint_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float u_opacity : hint_range(0.0, 1.0) = 1.0;

// Runtime gameplay VFX & 2D Normal Map lighting uniforms
uniform float u_flash_amount : hint_range(0.0, 1.0) = 0.0;
uniform vec4 u_flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float u_outline_width : hint_range(0.0, 6.0) = 0.0;
uniform vec4 u_outline_color : source_color = vec4(0.08, 0.08, 0.12, 1.0);
uniform sampler2D u_normal_tex : hint_normal, filter_linear, repeat_disable;
uniform bool u_use_normal_map = false;
uniform float u_normal_depth : hint_range(0.0, 2.0) = 1.0;

void fragment() {
\tvec4 albedo = texture(TEXTURE, UV);
\tfloat alpha = albedo.a;

\t// Optional 8-neighbor outer outline on transparent border pixels
\tif (u_outline_width > 0.01 && alpha < 0.1) {
\t\tvec2 px = TEXTURE_PIXEL_SIZE * u_outline_width;
\t\tfloat neighbor_a = 0.0;
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2( px.x,  0.0)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2(-px.x,  0.0)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2( 0.0,  px.y)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2( 0.0, -px.y)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2( px.x,  px.y)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2(-px.x,  px.y)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2( px.x, -px.y)).a);
\t\tneighbor_a = max(neighbor_a, texture(TEXTURE, UV + vec2(-px.x, -px.y)).a);
\t\tif (neighbor_a > 0.25) {
\t\t\tvec3 out_rgb = mix(u_outline_color.rgb, u_flash_color.rgb, u_flash_amount);
\t\t\tCOLOR = vec4(out_rgb, u_outline_color.a * u_opacity * COLOR.a);
\t\t\treturn;
\t\t}
\t}

\tif (alpha < 0.004) {
\t\tdiscard;
\t}

\tvec3 rgb = albedo.rgb;
\tif (u_recolor_mode == 1 && u_has_mask) {
\t\tvec4 m = texture(u_mask_tex, UV);
\t\tfloat lum = clamp(dot(albedo.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);

\t\tfloat w_primary = m.r;
\t\tfloat w_secondary = m.g;
\t\tfloat w_skin = m.b;
\t\tfloat w_sum = w_primary + w_secondary + w_skin;
\t\tif (w_sum > 1.0) {
\t\t\tw_primary /= w_sum;
\t\t\tw_secondary /= w_sum;
\t\t\tw_skin /= w_sum;
\t\t\tw_sum = 1.0;
\t\t}
\t\tfloat w_residual = max(0.0, 1.0 - w_sum);

\t\tvec3 c_primary = texture(u_lut_tex, vec2(lum, 0.125)).rgb;
\t\tvec3 c_secondary = texture(u_lut_tex, vec2(lum, 0.375)).rgb;
\t\tvec3 c_skin = texture(u_lut_tex, vec2(lum, 0.625)).rgb;

\t\trgb = albedo.rgb * w_residual
\t\t\t+ c_primary * w_primary
\t\t\t+ c_secondary * w_secondary
\t\t\t+ c_skin * w_skin;
\t} else if (u_recolor_mode == 2) {
\t\trgb = albedo.rgb * u_tint_color.rgb;
\t}

\tif (u_use_normal_map) {
\t\tNORMAL_MAP = texture(u_normal_tex, UV).rgb;
\t\tNORMAL_MAP_DEPTH = u_normal_depth;
\t}

\trgb = mix(rgb, u_flash_color.rgb, u_flash_amount);
\tCOLOR = vec4(rgb, alpha * u_opacity) * COLOR;
}
`;
}

export function buildGodot4ModularScript(
  defaultManifestResPath: string,
  defaultShaderResPath: string,
  textureFilter: 'linear' | 'nearest',
): string {
  const filterEnum = textureFilter === 'nearest'
    ? 'CanvasItem.TEXTURE_FILTER_NEAREST'
    : 'CanvasItem.TEXTURE_FILTER_LINEAR';

  return `class_name PaperDollModular
extends Node2D

## PaperDollKit v2.0 — Godot 4.x Modular Runtime Controller (Mode B)
## Supports real-time equipment swap, Mask+Ramp LUT recoloring, PartRules (hidesSlots / overrideSlots),
## 8-dir 5+3 mirroring, hybrid rig + sequence animation, animation events, hit-flash, and outline.

signal animation_event(event_name: String, arg: String, action_id: String)

@export_file("*.json") var manifest_path: String = "${defaultManifestResPath}"
@export_file("*.gdshader") var shader_path: String = "${defaultShaderResPath}"
@export var auto_play: bool = true
@export var playback_speed: float = 1.0

var manifest: Dictionary = {}
var base_dir: String = ""
var current_direction: String = "SE"
var current_action: String = "idle"
var current_skin: String = "fair"
var current_slots: Dictionary = {}
var current_palettes: Dictionary = {}
var hidden_slots: Dictionary = {}

var _shader: Shader
var _textures: Dictionary = {}
var _slot_defs: Dictionary = {}
var _slot_sprites: Dictionary = {}
var _slot_materials: Dictionary = {}
var _lut_cache: Dictionary = {}
var _time_ms: float = 0.0
var _prev_time_ms: float = -1.0
var _is_playing: bool = true
var _flash_timer: float = 0.0
var _flash_duration: float = 0.0
var _flash_color: Color = Color.WHITE
var _outline_width: float = 0.0
var _outline_color: Color = Color(0.08, 0.08, 0.12, 1.0)

const CLOTHING_SLOTS := [
\t"back_cape", "legs_bottom", "feet_shoes", "torso_top",
\t"belt_waist", "back_arm", "front_arm", "head_hat"
]

func _ready() -> void:
\t_is_playing = auto_play
\tload_manifest(manifest_path)

func load_manifest(path: String) -> void:
\tif not FileAccess.file_exists(path):
\t\tpush_error("PaperDollModular: manifest not found at %s" % path)
\t\treturn
\tvar raw := FileAccess.get_file_as_string(path)
\tvar parsed = JSON.parse_string(raw)
\tif typeof(parsed) != TYPE_DICTIONARY:
\t\tpush_error("PaperDollModular: invalid JSON manifest at %s" % path)
\t\treturn

\tmanifest = parsed
\tbase_dir = path.get_base_dir()
\t_shader = load(shader_path) as Shader

\t_textures.clear()
\tvar image_files: Dictionary = manifest.get("imageFiles", {})
\tfor img_id in image_files.keys():
\t\tvar rel_path: String = image_files[img_id]
\t\tvar full_path := base_dir.path_join(rel_path)
\t\tvar tex := load(full_path) as Texture2D
\t\tif tex != null:
\t\t\t_textures[img_id] = tex

\t_slot_defs.clear()
\tfor child in get_children():
\t\tchild.queue_free()
\t_slot_sprites.clear()
\t_slot_materials.clear()

\tfor slot in manifest.get("slots", []):
\t\tvar sid: String = slot["id"]
\t\t_slot_defs[sid] = slot
\t\tvar sp := Sprite2D.new()
\t\tsp.name = "Slot_%s" % sid
\t\tsp.centered = false
\t\tsp.region_enabled = true
\t\tsp.texture_filter = ${filterEnum}
\t\tvar mat := ShaderMaterial.new()
\t\tmat.shader = _shader
\t\tsp.material = mat
\t\tadd_child(sp)
\t\t_slot_sprites[sid] = sp
\t\t_slot_materials[sid] = mat

\tvar def_cfg: Dictionary = manifest.get("defaultConfig", {})
\tcurrent_direction = def_cfg.get("direction", "SE")
\tcurrent_action = def_cfg.get("action", "idle")
\tcurrent_skin = def_cfg.get("skin", "fair")
\tcurrent_slots = def_cfg.get("slots", {}).duplicate(true)
\tcurrent_palettes = def_cfg.get("palettes", {}).duplicate(true)
\thidden_slots.clear()
\tfor hs in def_cfg.get("hiddenSlots", []):
\t\thidden_slots[hs] = true

\t_rebuild_all_luts()
\t_evaluate_and_apply(0.0)

func set_slot(slot_id: String, part_id: String) -> void:
\tcurrent_slots[slot_id] = part_id
\t_evaluate_and_apply(_time_ms)

func set_palette(slot_id: String, palette_id: String) -> void:
\tcurrent_palettes[slot_id] = palette_id
\t_update_slot_lut(slot_id)

func set_all_clothing_palette(palette_id: String) -> void:
\tfor sid in CLOTHING_SLOTS:
\t\tif _slot_defs.has(sid):
\t\t\tcurrent_palettes[sid] = palette_id
\t\t\t_update_slot_lut(sid)

func set_skin(skin_id: String) -> void:
\tcurrent_skin = skin_id
\t_rebuild_all_luts()

func apply_preset(preset_id: String) -> void:
\tfor p in manifest.get("presets", []):
\t\tif p.get("id", "") == preset_id:
\t\t\tcurrent_skin = p.get("skin", current_skin)
\t\t\tfor sid in p.get("slots", {}).keys():
\t\t\t\tcurrent_slots[sid] = p["slots"][sid]
\t\t\tfor sid in p.get("palettes", {}).keys():
\t\t\t\tcurrent_palettes[sid] = p["palettes"][sid]
\t\t\t_rebuild_all_luts()
\t\t\t_evaluate_and_apply(_time_ms)
\t\t\treturn

func set_direction(dir_id: String) -> void:
\tcurrent_direction = dir_id
\t_evaluate_and_apply(_time_ms)

func play(action_id: String, restart: bool = true) -> void:
\tif not manifest.get("animations", {}).has(action_id):
\t\treturn
\tif current_action != action_id or restart:
\t\tcurrent_action = action_id
\t\t_time_ms = 0.0
\t\t_prev_time_ms = -1.0
\t_is_playing = true
\t_evaluate_and_apply(_time_ms)

func trigger_hit_flash(duration_sec: float = 0.14, color: Color = Color.WHITE) -> void:
\t_flash_duration = max(0.01, duration_sec)
\t_flash_timer = _flash_duration
\t_flash_color = color
\t_apply_vfx_uniforms()

func set_outline(width_px: float, color: Color = Color(0.08, 0.08, 0.12, 1.0)) -> void:
\t_outline_width = max(0.0, width_px)
\t_outline_color = color
\t_apply_vfx_uniforms()

## Returns active equipment glow points (e.g. staff tip, orb, lantern) in node-local coordinates
## so you can attach PointLight2D or additive glow sprites in Godot 4.
func get_active_glow_points() -> Array:
\tvar result: Array = []
\tif manifest.is_empty():
\t\treturn result
\tvar parts_by_slot: Dictionary = manifest.get("parts", {})
\tvar palettes_map: Dictionary = manifest.get("palettes", {})
\tfor sid in current_slots.keys():
\t\tif hidden_slots.get(sid, false):
\t\t\tcontinue
\t\tvar pid: String = str(current_slots[sid])
\t\tif pid == "" or pid == "none":
\t\t\tcontinue
\t\tvar sp: Sprite2D = _slot_sprites.get(sid, null)
\t\tif sp == null or not sp.visible:
\t\t\tcontinue
\t\tfor p in parts_by_slot.get(sid, []):
\t\t\tif p.get("id", "") != pid:
\t\t\t\tcontinue
\t\t\tfor g in p.get("glows", []):
\t\t\t\tvar lx := float(g.get("x", 0.0))
\t\t\t\tif sp.flip_h:
\t\t\t\t\tlx = -lx
\t\t\t\tvar ly := float(g.get("y", 0.0))
\t\t\t\tvar local_pos := sp.transform * Vector2(lx, ly)
\t\t\t\tvar col_spec := str(g.get("color", "palette_primary"))
\t\t\t\tif col_spec == "palette_primary" or col_spec == "palette_secondary":
\t\t\t\t\tvar pal_id: String = str(current_palettes.get(sid, "royal_blue"))
\t\t\t\t\tvar pal: Dictionary = palettes_map.get(pal_id, {})
\t\t\t\t\tcol_spec = str(pal.get("swatch", "#38bdf8"))
\t\t\t\tresult.append({
\t\t\t\t\t"slot_id": sid,
\t\t\t\t\t"position": local_pos,
\t\t\t\t\t"radius": float(g.get("radius", 28.0)),
\t\t\t\t\t"color": Color.html(col_spec) if col_spec.begins_with("#") else Color(0.22, 0.74, 0.97, 1.0),
\t\t\t\t\t"intensity": float(g.get("intensity", 1.0)),
\t\t\t\t\t"star_flare": bool(g.get("starFlare", false)),
\t\t\t\t})
\treturn result

func _process(delta: float) -> void:
\tif manifest.is_empty():
\t\treturn

\tif _flash_timer > 0.0:
\t\t_flash_timer = max(0.0, _flash_timer - delta)
\t\t_apply_vfx_uniforms()

\tif not _is_playing:
\t\treturn

\tvar clip: Dictionary = manifest.get("animations", {}).get(current_action, {})
\tif clip.is_empty():
\t\treturn
\tvar duration_ms: float = max(1.0, float(clip.get("durationMs", 1000.0)))
\tvar is_loop: bool = bool(clip.get("loop", true))
\tvar prev_t := _time_ms
\t_time_ms += delta * 1000.0 * playback_speed

\tif is_loop:
\t\tvar wrapped := fposmod(_time_ms, duration_ms)
\t\t_emit_events_between(clip, prev_t, _time_ms, duration_ms, true)
\t\t_time_ms = wrapped
\telse:
\t\tvar clamped := min(_time_ms, duration_ms)
\t\t_emit_events_between(clip, prev_t, clamped, duration_ms, false)
\t\t_time_ms = clamped
\t\tif _time_ms >= duration_ms:
\t\t\t_is_playing = false

\t_evaluate_and_apply(_time_ms)

func _emit_events_between(clip: Dictionary, from_ms: float, to_ms: float, duration_ms: float, is_loop: bool) -> void:
\tvar events: Array = clip.get("events", [])
\tif events.is_empty():
\t\treturn
\tfor ev in events:
\t\tvar t: float = float(ev.get("timeMs", 0.0))
\t\tvar fired := false
\t\tif _prev_time_ms < 0.0 and t == 0.0:
\t\t\tfired = true
\t\telif is_loop and to_ms >= duration_ms:
\t\t\tvar wrapped_to := fposmod(to_ms, duration_ms)
\t\t\tfired = (t > from_ms and t <= duration_ms) or (t >= 0.0 and t <= wrapped_to)
\t\telse:
\t\t\tfired = (t > from_ms and t <= to_ms)
\t\tif fired:
\t\t\temit_signal("animation_event", str(ev.get("name", "")), str(ev.get("arg", "")), current_action)
\t_prev_time_ms = to_ms

func _apply_vfx_uniforms() -> void:
\tvar flash_amt: float = (_flash_timer / _flash_duration) if _flash_duration > 0.0 else 0.0
\tfor mat in _slot_materials.values():
\t\tmat.set_shader_parameter("u_flash_amount", flash_amt)
\t\tmat.set_shader_parameter("u_flash_color", _flash_color)
\t\tmat.set_shader_parameter("u_outline_width", _outline_width)
\t\tmat.set_shader_parameter("u_outline_color", _outline_color)

func _resolve_part_rules() -> Dictionary:
\tvar effective: Dictionary = current_slots.duplicate(true)
\tvar parts_by_slot: Dictionary = manifest.get("parts", {})
\t# Pass 1: hidesSlots
\tfor sid in _slot_defs.keys():
\t\tif hidden_slots.get(sid, false):
\t\t\tcontinue
\t\tvar pid: String = current_slots.get(sid, "none")
\t\tif pid == "" or pid == "none":
\t\t\tcontinue
\t\tvar part := _find_part(parts_by_slot, sid, pid)
\t\tif part.is_empty():
\t\t\tcontinue
\t\tvar rules: Dictionary = part.get("rules", {})
\t\tfor target_slot in rules.get("hidesSlots", []):
\t\t\tif target_slot != sid:
\t\t\t\teffective[target_slot] = "none"
\t# Pass 2: overrideSlots
\tfor sid in _slot_defs.keys():
\t\tif hidden_slots.get(sid, false):
\t\t\tcontinue
\t\tvar pid: String = effective.get(sid, "none")
\t\tif pid == "" or pid == "none":
\t\t\tcontinue
\t\tvar part := _find_part(parts_by_slot, sid, pid)
\t\tif part.is_empty():
\t\t\tcontinue
\t\tvar overrides: Dictionary = part.get("rules", {}).get("overrideSlots", {})
\t\tfor target_slot in overrides.keys():
\t\t\tif target_slot == sid:
\t\t\t\tcontinue
\t\t\tvar cur_target: String = effective.get(target_slot, "none")
\t\t\tif cur_target != "" and cur_target != "none":
\t\t\t\teffective[target_slot] = overrides[target_slot]
\treturn effective

func _find_part(parts_by_slot: Dictionary, slot_id: String, part_id: String) -> Dictionary:
\tfor p in parts_by_slot.get(slot_id, []):
\t\tif p.get("id", "") == part_id:
\t\t\treturn p
\treturn {}

func _get_direction_spec(dir_id: String) -> Dictionary:
\tvar dirs: Array = manifest.get("directions", [])
\tfor d in dirs:
\t\tif d.get("id", "") == dir_id:
\t\t\treturn d
\treturn dirs[0] if not dirs.is_empty() else {"id": "SE", "flipX": false}

func _sample_track(clip: Dictionary, dir_id: String, slot_id: String, time_ms: float) -> Dictionary:
\tvar res := {"x": 0.0, "y": 0.0, "rot": 0.0, "sx": 1.0, "sy": 1.0, "alpha": 1.0, "z": 0.0, "frame": -1}
\tvar track := {}
\tvar overrides: Dictionary = clip.get("directionOverrides", {})
\tif overrides.has(dir_id):
\t\tfor t in overrides[dir_id]:
\t\t\tif t.get("slotId", "") == slot_id:
\t\t\t\ttrack = t
\t\t\t\tbreak
\tif track.is_empty():
\t\tfor t in clip.get("tracks", []):
\t\t\tif t.get("slotId", "") == slot_id:
\t\t\t\ttrack = t
\t\t\t\tbreak
\tvar kfs: Array = track.get("keyframes", [])
\tif kfs.is_empty():
\t\treturn res
\tvar prev_kf: Dictionary = kfs[0]
\tvar next_kf: Dictionary = kfs[kfs.size() - 1]
\tfor i in range(kfs.size()):
\t\tif float(kfs[i].get("timeMs", 0.0)) <= time_ms:
\t\t\tprev_kf = kfs[i]
\t\telse:
\t\t\tnext_kf = kfs[i]
\t\t\tbreak
\tvar t0: float = float(prev_kf.get("timeMs", 0.0))
\tvar t1: float = float(next_kf.get("timeMs", t0))
\tvar u: float = 0.0 if t1 <= t0 else clamp((time_ms - t0) / (t1 - t0), 0.0, 1.0)
\tvar easing: String = prev_kf.get("easing", "linear")
\tif easing == "step":
\t\tu = 0.0
\telif easing == "easeInOut":
\t\tu = u * u * (3.0 - 2.0 * u)
\tres["x"] = lerpf(float(prev_kf.get("x", 0.0)), float(next_kf.get("x", 0.0)), u)
\tres["y"] = lerpf(float(prev_kf.get("y", 0.0)), float(next_kf.get("y", 0.0)), u)
\tres["rot"] = lerpf(float(prev_kf.get("rotationDeg", 0.0)), float(next_kf.get("rotationDeg", 0.0)), u)
\tres["sx"] = lerpf(float(prev_kf.get("scaleX", 1.0)), float(next_kf.get("scaleX", 1.0)), u)
\tres["sy"] = lerpf(float(prev_kf.get("scaleY", 1.0)), float(next_kf.get("scaleY", 1.0)), u)
\tres["alpha"] = lerpf(float(prev_kf.get("alpha", 1.0)), float(next_kf.get("alpha", 1.0)), u)
\tres["z"] = lerpf(float(prev_kf.get("zOffset", 0.0)), float(next_kf.get("zOffset", 0.0)), u)
\tif prev_kf.has("frameIndex"):
\t\tres["frame"] = int(prev_kf["frameIndex"])
\treturn res

func _evaluate_and_apply(time_ms: float) -> void:
\tif manifest.is_empty():
\t\treturn
\tvar dir_spec := _get_direction_spec(current_direction)
\tvar mirror_sign: float = -1.0 if bool(dir_spec.get("flipX", false)) else 1.0
\tvar clip: Dictionary = manifest.get("animations", {}).get(current_action, {})
\tvar effective_slots := _resolve_part_rules()
\tvar parts_by_slot: Dictionary = manifest.get("parts", {})
\tvar z_order_list: Array = manifest.get("zOrder", {}).get(current_direction, _slot_defs.keys())

\tvar active_frames: Dictionary = {}
\tvar sampled_tracks: Dictionary = {}

\tfor sid in _slot_defs.keys():
\t\tvar tr := _sample_track(clip, current_direction, sid, time_ms)
\t\tsampled_tracks[sid] = tr
\t\tif hidden_slots.get(sid, false):
\t\t\tcontinue
\t\tvar pid: String = effective_slots.get(sid, "none")
\t\tif pid == "" or pid == "none":
\t\t\tcontinue
\t\tvar part := _find_part(parts_by_slot, sid, pid)
\t\tif part.is_empty():
\t\t\tcontinue
\t\tvar dirs_map: Dictionary = part.get("directions", {})
\t\tvar visual: Dictionary = dirs_map.get(current_direction, {})
\t\tvar flip_x := bool(dir_spec.get("flipX", false))
\t\tif visual.is_empty() and dir_spec.has("mirrorFrom"):
\t\t\tvisual = dirs_map.get(dir_spec["mirrorFrom"], {})
\t\t\tflip_x = true
\t\tif visual.is_empty():
\t\t\tcontinue
\t\tvar action_frames: Dictionary = visual.get("actionFrames", {})
\t\tvar seq: Array = action_frames.get(current_action, visual.get("frames", []))
\t\tif seq.is_empty():
\t\t\tcontinue
\t\tvar fidx := 0
\t\tif int(tr["frame"]) >= 0:
\t\t\tfidx = posmod(int(tr["frame"]), seq.size())
\t\telif visual.get("mode", "rigged") == "sequence" and seq.size() > 1:
\t\t\tvar fps: float = float(visual.get("fps", clip.get("fps", 12.0)))
\t\t\tvar raw_idx := int(floor((time_ms / 1000.0) * fps))
\t\t\tfidx = posmod(raw_idx, seq.size()) if bool(clip.get("loop", true)) else clampi(raw_idx, 0, seq.size() - 1)
\t\tactive_frames[sid] = {"part": part, "frame": seq[fidx], "flipX": flip_x}

\t# Solve hierarchical world transforms (origin = (0, 0) at character foot center)
\tvar world_cache: Dictionary = {}
\tfor sid in _slot_defs.keys():
\t\t_solve_world(sid, active_frames, sampled_tracks, mirror_sign, world_cache)

\t# Apply to Sprite2D nodes
\tfor sid in _slot_sprites.keys():
\t\tvar sp: Sprite2D = _slot_sprites[sid]
\t\tvar mat: ShaderMaterial = _slot_materials[sid]
\t\tif not active_frames.has(sid):
\t\t\tsp.visible = false
\t\t\tcontinue

\t\tvar entry: Dictionary = active_frames[sid]
\t\tvar part: Dictionary = entry["part"]
\t\tvar frame: Dictionary = entry["frame"]
\t\tvar tex: Texture2D = _textures.get(frame.get("imageId", ""), null)
\t\tif tex == null:
\t\t\tsp.visible = false
\t\t\tcontinue

\t\tvar sr: Dictionary = frame["sourceRect"]
\t\tvar orig: Dictionary = frame["originalSize"]
\t\tvar piv: Dictionary = frame["pivot"]
\t\tvar trim: Dictionary = frame.get("trimOffset", {"x": 0.0, "y": 0.0})

\t\tsp.visible = true
\t\tsp.texture = tex
\t\tsp.region_rect = Rect2(float(sr["x"]), float(sr["y"]), float(sr["width"]), float(sr["height"]))
\t\tsp.offset = Vector2(
\t\t\tfloat(trim["x"]) - float(piv["x"]) * float(orig["width"]),
\t\t\tfloat(trim["y"]) - float(piv["y"]) * float(orig["height"])
\t\t)

\t\tvar solved: Dictionary = world_cache[sid]
\t\tsp.position = solved["pos"]
\t\tsp.rotation = deg_to_rad(float(solved["rot"]))
\t\tvar sx: float = float(solved["sx"]) * (-1.0 if bool(entry["flipX"]) else 1.0)
\t\tsp.scale = Vector2(sx, float(solved["sy"]))

\t\tvar z_idx: int = z_order_list.find(sid)
\t\tif z_idx < 0:
\t\t\tz_idx = 0
\t\tvar tr: Dictionary = sampled_tracks[sid]
\t\tsp.z_index = int(round((float(z_idx) + float(tr["z"]) + float(solved["socketZ"])) * 10.0))

\t\tvar mask_id: String = frame.get("maskImageId", "")
\t\tvar mask_tex: Texture2D = _textures.get(mask_id, null) if mask_id != "" else null
\t\tvar mode_str: String = part.get("recolorMode", _slot_defs[sid].get("defaultRecolorMode", "mask_ramp"))
\t\tvar mode_int := 0
\t\tif mode_str == "mask_ramp":
\t\t\tmode_int = 1
\t\telif mode_str == "tint":
\t\t\tmode_int = 2
\t\tmat.set_shader_parameter("u_has_mask", mask_tex != null)
\t\tif mask_tex != null:
\t\t\tmat.set_shader_parameter("u_mask_tex", mask_tex)
\t\tmat.set_shader_parameter("u_recolor_mode", mode_int)
\t\tmat.set_shader_parameter("u_opacity", clampf(float(tr["alpha"]), 0.0, 1.0))

func _solve_world(sid: String, active_frames: Dictionary, tracks: Dictionary, mirror_sign: float, cache: Dictionary) -> Dictionary:
\tif cache.has(sid):
\t\treturn cache[sid]
\tvar def: Dictionary = _slot_defs.get(sid, {})
\tvar tr: Dictionary = tracks.get(sid, {"x": 0.0, "y": 0.0, "rot": 0.0, "sx": 1.0, "sy": 1.0})
\tvar parent_pos := Vector2.ZERO
\tvar parent_rot := 0.0
\tvar parent_sx := 1.0
\tvar parent_sy := 1.0
\tvar socket := {}

\tif def.has("parent") and def["parent"] != null and str(def["parent"]) != "":
\t\tvar pid: String = def["parent"]
\t\tvar ps := _solve_world(pid, active_frames, tracks, mirror_sign, cache)
\t\tparent_pos = ps["pos"]
\t\tparent_rot = ps["rot"]
\t\tparent_sx = ps["sx"]
\t\tparent_sy = ps["sy"]
\t\tvar sock_name: String = str(def.get("attachSocket", ""))
\t\tif sock_name != "" and active_frames.has(pid):
\t\t\tvar pframe: Dictionary = active_frames[pid]["frame"]
\t\t\tvar socks: Dictionary = pframe.get("sockets", {})
\t\t\tif socks.has(sock_name):
\t\t\t\tsocket = socks[sock_name]

\tvar def_off: Dictionary = def.get("defaultOffset", {"x": 0.0, "y": 0.0})
\tvar bx: float = float(socket.get("x", def_off.get("x", 0.0)))
\tvar by: float = float(socket.get("y", def_off.get("y", 0.0)))
\tvar brot: float = float(socket.get("rotationDeg", 0.0))
\tvar bsx: float = float(socket.get("scaleX", 1.0))
\tvar bsy: float = float(socket.get("scaleY", 1.0))

\tvar lx: float = (bx + float(tr["x"])) * mirror_sign
\tvar ly: float = by + float(tr["y"])
\tvar lrot: float = (brot + float(tr["rot"])) * mirror_sign
\tvar lsx: float = bsx * float(tr["sx"])
\tvar lsy: float = bsy * float(tr["sy"])

\tvar rad := deg_to_rad(parent_rot)
\tvar rx := lx * parent_sx
\tvar ry := ly * parent_sy
\tvar wx := parent_pos.x + rx * cos(rad) - ry * sin(rad)
\tvar wy := parent_pos.y + rx * sin(rad) + ry * cos(rad)
\tvar res := {
\t\t"pos": Vector2(wx, wy),
\t\t"rot": parent_rot + lrot,
\t\t"sx": parent_sx * lsx,
\t\t"sy": parent_sy * lsy,
\t\t"socketZ": float(socket.get("zOffset", 0.0))
\t}
\tcache[sid] = res
\treturn res

func _rebuild_all_luts() -> void:
\tfor sid in _slot_materials.keys():
\t\t_update_slot_lut(sid)

func _update_slot_lut(slot_id: String) -> void:
\tif not _slot_materials.has(slot_id):
\t\treturn
\tvar pal_id: String = current_palettes.get(slot_id, "cobalt")
\tvar cache_key := "%s|%s" % [pal_id, current_skin]
\tvar lut_tex: ImageTexture = _lut_cache.get(cache_key, null)
\tif lut_tex == null:
\t\tlut_tex = _generate_lut_texture(pal_id, current_skin)
\t\t_lut_cache[cache_key] = lut_tex
\tvar mat: ShaderMaterial = _slot_materials[slot_id]
\tmat.set_shader_parameter("u_lut_tex", lut_tex)

func _generate_lut_texture(palette_id: String, skin_id: String) -> ImageTexture:
\tvar palettes: Dictionary = manifest.get("palettes", {})
\tvar skins: Dictionary = manifest.get("skins", {})
\tvar pal: Dictionary = palettes.get(palette_id, palettes.values()[0] if not palettes.is_empty() else {})
\tvar skin: Dictionary = skins.get(skin_id, skins.values()[0] if not skins.is_empty() else {})

\tvar img := Image.create(256, 4, false, Image.FORMAT_RGBA8)
\t_fill_ramp_row(img, 0, pal.get("primary", {}).get("stops", []))
\t_fill_ramp_row(img, 1, pal.get("secondary", {}).get("stops", []))
\t_fill_ramp_row(img, 2, skin.get("ramp", {}).get("stops", []))
\t_fill_ramp_row(img, 3, pal.get("metal", {}).get("stops", []))
\treturn ImageTexture.create_from_image(img)

func _fill_ramp_row(img: Image, row: int, stops: Array) -> void:
\tif stops.is_empty():
\t\tfor x in range(256):
\t\t\tvar v := float(x) / 255.0
\t\t\timg.set_pixel(x, row, Color(v, v, v, 1.0))
\t\treturn
\tfor x in range(256):
\t\tvar t := float(x) / 255.0
\t\tvar c := _sample_ramp(stops, t)
\t\timg.set_pixel(x, row, c)

func _sample_ramp(stops: Array, t: float) -> Color:
\tvar first: Dictionary = stops[0]
\tif t <= float(first.get("t", 0.0)):
\t\treturn _parse_stop_color(first.get("color", "#ffffff"))
\tfor i in range(stops.size() - 1):
\t\tvar a: Dictionary = stops[i]
\t\tvar b: Dictionary = stops[i + 1]
\t\tvar ta: float = float(a.get("t", 0.0))
\t\tvar tb: float = float(b.get("t", 1.0))
\t\tif t <= tb:
\t\t\tvar u: float = 0.0 if tb <= ta else (t - ta) / (tb - ta)
\t\t\treturn _parse_stop_color(a.get("color", "#000000")).lerp(_parse_stop_color(b.get("color", "#ffffff")), u)
\treturn _parse_stop_color(stops[stops.size() - 1].get("color", "#ffffff"))

func _parse_stop_color(val) -> Color:
\tif typeof(val) == TYPE_STRING:
\t\treturn Color.from_string(val, Color.WHITE)
\tif typeof(val) == TYPE_DICTIONARY:
\t\treturn Color(float(val.get("r", 255)) / 255.0, float(val.get("g", 255)) / 255.0, float(val.get("b", 255)) / 255.0, float(val.get("a", 255)) / 255.0)
\treturn Color.WHITE
`;
}

function buildGodot4ModularScene(
  kitName: string,
  scriptResPath: string,
  manifestResPath: string,
  shaderResPath: string,
): string {
  return [
    '[gd_scene load_steps=2 format=3]',
    '',
    `[ext_resource type="Script" path="${scriptResPath}" id="1_script"]`,
    '',
    `[node name="${kitName}" type="Node2D"]`,
    'script = ExtResource("1_script")',
    `manifest_path = "${manifestResPath}"`,
    `shader_path = "${shaderResPath}"`,
    'auto_play = true',
    '',
  ].join('\n');
}

function buildGodot4ModularReadme(modular: ModularExportData, resBase: string): string {
  return `# ${modular.kitName} — Godot 4.x Modular Runtime Kit (Mode B)

由 **PaperDollKit v2** 导出的 **Mode B 模块化实时换装包**（含 ${modular.stats.partCount} 个部件、${modular.stats.textureCount} 张源贴图、${modular.stats.animationCount} 套动画 / ${modular.stats.eventCount} 个动画事件）。

## 3 步快速集成

1. 将解压后的整个文件夹复制到你的 Godot 4.x 项目的 \`${resBase}\` 目录下。
2. 等待 Godot 导入纹理与着色器后，直接将 \`${modular.kitName}_modular.tscn\` 拖入主场景即可运行。
3. 通过 GDScript 实时换装、换肤、换色、监听命中/脚步事件与触发受击闪白：

\`\`\`gdscript
@onready var hero: PaperDollModular = $Hero

func _ready() -> void:
    hero.animation_event.connect(_on_anim_event)
    hero.apply_preset("knight")
    hero.set_skin("tan")
    hero.set_all_clothing_palette("crimson")
    hero.set_slot("main_hand", "axe")
    hero.set_outline(1.5, Color(0.05, 0.05, 0.1, 1.0))

func _on_anim_event(event_name: String, arg: String, action_id: String) -> void:
    if event_name == "hit":
        print("造成伤害！", arg, action_id)
    elif event_name == "footstep":
        print("播放脚步声：", arg)

func take_damage() -> void:
    hero.play("hit")
    hero.trigger_hit_flash(0.14, Color.WHITE)
\`\`\`
`;
}

/**
 * Exports a complete Mode B Godot 4.x Modular Runtime Kit ZIP bundle.
 */
export function exportGodot4ModularBundle(
  modular: ModularExportData,
  opts: Godot4ModularExportOptions = {},
): ExportBundle {
  const resBase = (opts.resBasePath ?? `res://assets/characters/${modular.kitName}`).replace(/\/+$/, '');
  const textureFilter = opts.textureFilter ?? 'linear';
  const folder = modular.kitName;

  const manifestRel = 'paperdoll_manifest.json';
  const shaderRel = 'shaders/paperdoll_mask_ramp.gdshader';
  const scriptRel = 'scripts/paperdoll_modular.gd';
  const sceneRel = `${modular.kitName}_modular.tscn`;

  const files: Record<string, Uint8Array | string> = {};

  files[`${folder}/${manifestRel}`] = JSON.stringify(modular.manifest, null, 2);
  files[`${folder}/${shaderRel}`] = buildGodot4MaskRampShader();
  files[`${folder}/${scriptRel}`] = buildGodot4ModularScript(
    `${resBase}/${manifestRel}`,
    `${resBase}/${shaderRel}`,
    textureFilter,
  );
  files[`${folder}/${sceneRel}`] = buildGodot4ModularScene(
    modular.kitName,
    `${resBase}/${scriptRel}`,
    `${resBase}/${manifestRel}`,
    `${resBase}/${shaderRel}`,
  );
  files[`${folder}/README_GODOT4_MODULAR.md`] = buildGodot4ModularReadme(modular, resBase);
  if (modular.credits) {
    files[`${folder}/CREDITS.csv`] = modular.credits.csv;
    files[`${folder}/CREDITS.txt`] = modular.credits.txt;
  }

  for (const tex of modular.textures) {
    const texRel = `textures/${tex.filename}`;
    files[`${folder}/${texRel}`] = tex.png;
    files[`${folder}/${texRel}.import`] = buildGodotTextureImport(
      `${resBase}/${texRel}`,
      textureFilter,
      tex.isMask,
    );
  }

  for (const [lutName, lutPng] of Object.entries(modular.prebakedLuts)) {
    const lutRel = `luts/${lutName}`;
    files[`${folder}/${lutRel}`] = lutPng;
    files[`${folder}/${lutRel}.import`] = buildGodotTextureImport(
      `${resBase}/${lutRel}`,
      'linear',
      true,
    );
  }

  const zip = packZip(files);
  return {
    files,
    zip,
    zipFilename: `${modular.kitName}_godot4_modular.zip`,
  };
}
