extends Node2D

## PaperDollKit v2.0 — Godot 4.x Interactive Modular Demo Controller
## Controls:
##   WASD / Arrow Keys : Move & auto-update 8-direction isometric facing + walk/idle
##   Space / J         : Trigger attack animation
##   K                 : Trigger cast animation
##   1 / 2 / 3         : Hot-swap primary armor palette (cobalt / crimson / emerald)
##   H                 : Trigger hit-flash shader effect
##   L                 : Toggle 2D PointLight2D normal-map illumination

@export var move_speed: float = 180.0
@onready var doll: Node2D = $PaperDollModular
@onready var torch_light: PointLight2D = $TorchLight2D

var _palettes := ["cobalt", "crimson", "emerald", "gold", "violet"]
var _pal_idx: int = 0

func _ready() -> void:
	if doll and doll.has_signal("animation_event"):
		doll.connect("animation_event", Callable(self, "_on_animation_event"))

func _physics_process(delta: float) -> void:
	if not doll:
		return

	var input_vec := Vector2(
		Input.get_action_strength("ui_right") - Input.get_action_strength("ui_left"),
		Input.get_action_strength("ui_down") - Input.get_action_strength("ui_up")
	)
	if input_vec.length_squared() > 0.01:
		var dir := input_vec.normalized()
		doll.position += Vector2(dir.x, dir.y * 0.65) * move_speed * delta
		if doll.has_method("set_direction_from_vector"):
			doll.call("set_direction_from_vector", dir)
		if doll.has_method("play_action"):
			doll.call("play_action", "walk")
	else:
		if doll.has_method("play_action"):
			doll.call("play_action", "idle")

	# Keep torch light orbiting smoothly near the mouse cursor
	if torch_light and torch_light.visible:
		torch_light.global_position = get_global_mouse_position()

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_SPACE, KEY_J:
			if doll and doll.has_method("play_action"):
				doll.call("play_action", "attack", true)
		KEY_K:
			if doll and doll.has_method("play_action"):
				doll.call("play_action", "cast", true)
		KEY_H:
			if doll and doll.has_method("trigger_hit_flash"):
				doll.call("trigger_hit_flash", Color.WHITE, 0.16)
		KEY_1, KEY_2, KEY_3:
			_pal_idx = (_pal_idx + 1) % _palettes.size()
			var pal_id: String = _palettes[_pal_idx]
			if doll and doll.has_method("set_palette"):
				doll.call("set_palette", "torso_top", pal_id)
				doll.call("set_palette", "back_cloak", pal_id)
				doll.call("set_palette", "front_arm", pal_id)
		KEY_L:
			if torch_light:
				torch_light.visible = not torch_light.visible

func _on_animation_event(event_name: String, arg: String) -> void:
	print("[PaperDollKit] Animation Event fired: %s (%s)" % [event_name, arg])
