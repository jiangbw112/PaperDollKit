/**
 * PaperDollKit v2.0 Canonical Intermediate Representation (IR)
 *
 * Designed for high-resolution 2D modular paper-doll characters (Isometric 2.5D
 * isometric 8-dir/4-dir and side-scrolling 2-dir) with hybrid animation
 * (hierarchical cutout rig + per-part frame sequences) and Mask+Ramp LUT
 * semantic recoloring targeting WebGL2, Godot 4.x, and Cocos Creator 3.x.
 */

export const SCHEMA_VERSION = '2.0.0' as const;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalized or 0..255 RGBA color; stored internally as 0..255 integers. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Transform2D {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

/** 2D affine matrix [a, b, c, d, tx, ty] mapping (x, y) -> (a*x + c*y + tx, b*x + d*y + ty). */
export type Mat2D = readonly [number, number, number, number, number, number];

export type EasingType = 'step' | 'linear' | 'easeInOut';

export type PerspectivePreset = 'isometric_8' | 'isometric_4' | 'side_2' | 'custom';

export type DirectionId = string;

export interface DirectionSpec {
  id: DirectionId;
  label: string;
  /** Clockwise angle in degrees where 0 = South (facing camera). */
  angleDeg: number;
  /** True for back-facing angles (N, NE, NW) where cape/back props draw over torso. */
  facingBack: boolean;
  /**
   * Optional canonical source direction to mirror when art is only authored for
   * one lateral side (e.g. SW mirrors SE, W mirrors E, NW mirrors NE).
   */
  mirrorFrom?: DirectionId;
  /** True when horizontal mirror should be applied during rendering. */
  flipX: boolean;
  /** Lateral facing index: 0 = front/back, ±1 = diagonal isometric, ±2 = pure profile. */
  side: number;
}

export type SlotId = string;

export type SlotCategory = 'base' | 'back' | 'clothing' | 'limb' | 'face' | 'head' | 'equipment';

/**
 * How a part's pixels are recolored at runtime & during offscreen baking:
 * - 'mask_ramp': HD albedo RGBA + RGBA semantic mask (R=primary, G=secondary, B=skin)
 *                evaluated against a smooth 256×4 RGBA Gradient Ramp LUT.
 * - 'tint':      Simple multiply tint using the primary base color (unmasked HD art).
 * - 'indexed_lut': Legacy discrete palette index mode (for pixel-art packs).
 * - 'none':      Draw albedo as-is without recoloring.
 */
export type RecolorMode = 'mask_ramp' | 'tint' | 'indexed_lut' | 'none';

/**
 * Educational & QA diagnostic mode verifying semantic skin-channel synchronization
 * on arm/hand slots:
 * - 'none':        Normal mode — B mask channel samples current character skin ramp.
 * - 'baked_wood':  Simulates unlinked hand art baked to default wood/base tone.
 * - 'dyed_sleeve': Simulates hands mistakenly painted into the R (primary clothing) mask.
 */
export type HandColorBugMode = 'none' | 'baked_wood' | 'dyed_sleeve';

export interface SlotDefinition {
  id: SlotId;
  name: string;
  category: SlotCategory;
  colorable: boolean;
  required: boolean;
  /** Parent slot in the cutout rig hierarchy (undefined = root space). */
  parent?: SlotId;
  /** Optional named socket on the parent slot's active frame to attach to. */
  attachSocket?: string;
  /** Normalized pivot inside the slot's sprite frame (0..1, default 0.5, 0.5). */
  defaultPivot: Vec2;
  /** Default local offset in canvas pixels relative to parent origin. */
  defaultOffset: Vec2;
  /** Default recolor mode for parts assigned to this slot. */
  defaultRecolorMode: RecolorMode;
}

export interface RampStop {
  /** Luminance position in [0, 1] (0 = darkest outline/shadow, 1 = brightest highlight). */
  t: number;
  /** Hex string (#rrggbb or #rrggbbaa) or RGBA object. */
  color: string | RGBA;
}

export interface ColorRamp {
  stops: RampStop[];
}

export interface ColorPalette {
  id: string;
  name: string;
  swatch: string;
  primary: ColorRamp;
  secondary: ColorRamp;
  /** Optional override for metallic accents (defaults to standard steel ramp). */
  metal?: ColorRamp;
}

export interface SkinTone {
  id: string;
  name: string;
  swatch: string;
  ramp: ColorRamp;
}

/** Named anchor point authored in frame-local pixel coordinates (relative to frame pivot). */
export interface SocketTransform {
  x: number;
  y: number;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  zOffset?: number;
}

export interface SpriteFrameRef {
  /** Logical image asset identifier (resolved by renderer / exporter atlas). */
  imageId: string;
  /** Source rectangle within imageId (in pixels). */
  sourceRect: Rect;
  /** Untrimmed logical frame size (in pixels). */
  originalSize: { width: number; height: number };
  /** Offset of trimmed pixels inside originalSize (in pixels). */
  trimOffset: Vec2;
  /** Normalized pivot point (0..1) relative to originalSize. */
  pivot: Vec2;
  /** Optional semantic mask image (R=primary, G=secondary, B=skin) aligned with albedo. */
  maskImageId?: string;
  /** Optional source rectangle in maskImageId (defaults to sourceRect if omitted). */
  maskRect?: Rect;
  /** Optional tangent-space 2D normal map image aligned with albedo (RGB -> XYZ). */
  normalImageId?: string;
  /** Optional source rectangle in normalImageId (defaults to sourceRect if omitted). */
  normalRect?: Rect;
  /** Optional per-frame sockets for attaching child equipment (e.g. hand_main, head_top). */
  sockets?: Record<string, SocketTransform>;
}

export interface PartDirectionVisual {
  /**
   * - 'rigged':   Single HD sprite driven by hierarchical bone/slot transform tracks.
   * - 'sequence': Pre-rendered or hand-drawn multi-frame sequence per action (classic isometric ARPG style),
   *               which can still emit per-frame sockets for attached weapons/shields.
   */
  mode: 'rigged' | 'sequence';
  /** Default frames used when no action-specific sequence exists. */
  frames: SpriteFrameRef[];
  /** Optional per-action sprite frame sequences (used in 'sequence' or hybrid mode). */
  actionFrames?: Record<string, SpriteFrameRef[]>;
  /** Optional playback FPS override for sequence frames. */
  fps?: number;
}

export interface PartRules {
  /**
   * Equipping this part automatically suppresses rendering of these target slots
   * (e.g. a full helmet hides `hair_style`, or a two-handed bow hides `off_hand`).
   * The user's underlying slot selection is preserved and restored once this part is unequipped.
   */
  hidesSlots?: SlotId[];
  /**
   * Conditional part substitution when this part is equipped:
   * maps target `slotId -> replacement partId` (or `'none'` to hide).
   * Only applies when the target slot currently has a non-`'none'` part equipped.
   */
  overrideSlots?: Record<SlotId, string>;
}

export interface PartAttribution {
  /** Author or studio name credited for this artwork. */
  author: string;
  /** License identifier (e.g. 'MIT', 'CC0', 'CC-BY-4.0', 'Commercial'). */
  license: string;
  /** Optional source or portfolio URL. */
  url?: string;
  /** Optional extra attribution notes. */
  notes?: string;
}

export interface PartGlowSpec {
  /** Local X offset in pixels relative to the part frame's pivot. */
  x: number;
  /** Local Y offset in pixels relative to the part frame's pivot. */
  y: number;
  /** Glow halo radius in character canvas pixels (default 28). */
  radius: number;
  /** Hex color ('#38bdf8') or 'palette_primary' / 'palette_secondary' to follow slot palette. */
  color: string;
  /** Base intensity in [0..2] (default 0.95). */
  intensity?: number;
  /** Breathing pulse frequency in Hz (default 1.5, 0 = steady). */
  pulseSpeed?: number;
  /** Render a crisp 4-point star flare inside the radial halo (default true). */
  starFlare?: boolean;
  /** Extra radius/intensity multiplier during 'cast' action (default 1.45). */
  castBoost?: number;
}

export interface PartAsset {
  id: string;
  name: string;
  slotId: SlotId;
  recolorMode?: RecolorMode;
  /** Visual definitions keyed by DirectionId (mirrored directions fall back via DirectionSpec.mirrorFrom). */
  directions: Record<DirectionId, PartDirectionVisual>;
  /** Optional slot visibility/substitution rules evaluated when this part is equipped. */
  rules?: PartRules;
  /** Optional additive glow points (e.g. magic staff tip, orb, lantern flame, halo). */
  glows?: PartGlowSpec[];
  /** Optional author/license attribution metadata (falls back to AssetPackManifest.defaultAttribution). */
  attribution?: PartAttribution;
  tags?: string[];
}

export interface SlotKeyframe {
  timeMs: number;
  x?: number;
  y?: number;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  zOffset?: number;
  /** Optional explicit sprite frame index override (e.g. blink / open hand / attack smear). */
  frameIndex?: number;
  easing?: EasingType;
}

export interface SlotTrack {
  slotId: SlotId;
  keyframes: SlotKeyframe[];
}

export interface AnimationEvent {
  /** Timestamp in milliseconds within the clip's durationMs. */
  timeMs: number;
  /** Event identifier emitted at runtime (e.g. 'footstep', 'hit', 'cast_release'). */
  name: string;
  /** Optional string argument (e.g. 'left', 'right', 'melee_slash'). */
  arg?: string;
}

export interface AnimationClip {
  id: string;
  label: string;
  durationMs: number;
  fps: number;
  loop: boolean;
  /** Base transform/frame tracks shared across directions. */
  tracks: SlotTrack[];
  /** Optional per-direction track overrides (e.g. back-facing weapon arc or profile stride). */
  directionOverrides?: Record<DirectionId, SlotTrack[]>;
  /** Optional gameplay/audio/VFX event markers fired at specific timestamps. */
  events?: AnimationEvent[];
}

export type ZOrderTable = Record<DirectionId, SlotId[]>;

export interface CharacterPreset {
  id: string;
  name: string;
  tag?: string;
  skin: string;
  slots: Record<SlotId, string>;
  palettes: Record<SlotId, string>;
}

export interface AssetPackManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  /** Reference authoring canvas size in pixels (e.g. 256×256 or 512×512 for HD 2D). */
  canvasSize: { width: number; height: number };
  perspective: PerspectivePreset;
  directions: DirectionSpec[];
  slots: SlotDefinition[];
  zOrder: ZOrderTable;
  palettes: Record<string, ColorPalette>;
  skins: Record<string, SkinTone>;
  /** Available parts keyed by SlotId. */
  parts: Record<SlotId, PartAsset[]>;
  animations: Record<string, AnimationClip>;
  presets: CharacterPreset[];
  /** Default author/license attribution applied to parts without an explicit attribution field. */
  defaultAttribution?: PartAttribution;
}

export interface CharacterConfig {
  schemaVersion?: typeof SCHEMA_VERSION;
  packId?: string;
  preset?: string;
  skin: string;
  direction: DirectionId;
  action: string;
  handColorBugMode: HandColorBugMode;
  slots: Record<SlotId, string>;
  palettes: Record<SlotId, string>;
  hiddenSlots?: SlotId[];
}

export interface EvaluatedLayer {
  slotId: SlotId;
  partId: string;
  recolorMode: RecolorMode;
  frame: SpriteFrameRef;
  frameIndex: number;
  /** Local transform relative to parent slot/socket. */
  localTransform: Transform2D;
  /** Resolved world transform in character canvas coordinates. */
  worldTransform: Transform2D;
  /** World affine matrix ready for Canvas 2D / WebGL2 / Exporter. */
  worldMatrix: Mat2D;
  /** True if the visual should be horizontally mirrored (resolved from direction + mirrorFrom). */
  flipX: boolean;
  alpha: number;
  /** Effective sort key (base Z-Order index + animated zOffset). */
  zOrder: number;
  paletteId: string;
  skinId: string;
  handColorBugMode: HandColorBugMode;
}

export interface SuppressedSlotInfo {
  bySlotId: SlotId;
  byPartId: string;
  byPartName: string;
  reason: 'hidden' | 'overridden';
  overridePartId?: string;
  overridePartName?: string;
}

export interface EvaluatedGlow {
  slotId: SlotId;
  partId: string;
  /** World-space position in character canvas pixels. */
  x: number;
  y: number;
  radius: number;
  /** Resolved hex color string (e.g. '#38bdf8'). */
  color: string;
  /** Effective animated intensity (includes breathing pulse & cast boost). */
  intensity: number;
  starFlare: boolean;
  zOrder: number;
}

export interface EvaluatedFrame {
  direction: DirectionSpec;
  actionId: string;
  timeMs: number;
  normalizedTime: number;
  discreteFrameIndex: number;
  /** Sorted back-to-front ready for drawing or exporting. */
  layers: EvaluatedLayer[];
  /** Optional additive glow points resolved into character canvas world coordinates. */
  glows?: EvaluatedGlow[];
  /** Slots automatically hidden or substituted by equipped parts' `PartRules`. */
  suppressedSlots?: Record<SlotId, SuppressedSlotInfo>;
}
