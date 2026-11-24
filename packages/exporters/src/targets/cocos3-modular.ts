import { packZip } from '../codec/zip.js';
import type {
  Cocos3ModularExportOptions,
  ExportBundle,
  ModularExportData,
} from '../types.js';

export function buildCocos3MaskRampEffect(): string {
  return `// PaperDollKit v2.0 Cross-Engine Mask + 256x4 Ramp LUT Effect (Cocos Creator 3.x)
// Matches WebGL2 Studio & Godot 4.x 1:1.

CCEffect %{
  techniques:
  - passes:
    - vert: sprite-vs:vert
      frag: sprite-fs:frag
      depthStencilState:
        depthTest: false
        depthWrite: false
      blendState:
        targets:
        - blend: true
          blendSrc: src_alpha
          blendDst: one_minus_src_alpha
          blendDstAlpha: one_minus_src_alpha
      rasterizerState:
        cullMode: none
      properties:
        alphaThreshold: { value: 0.5 }
        maskTexture:    { value: white }
        lutTexture:     { value: white }
        normalTexture:  { value: white }
        recolorParams:  { value: [1.0, 0.0, 0.0, 0.0], editor: { tooltip: "x=recolorMode(0/1/2), y=hasMask, z=flashAmount, w=outlineWidth" } }
        texelSize:      { value: [0.0009765625, 0.0009765625, 0.0, 0.0] }
        flashColor:     { value: [1.0, 1.0, 1.0, 1.0], editor: { type: color } }
        outlineColor:   { value: [0.08, 0.08, 0.12, 1.0], editor: { type: color } }
        lightDir:       { value: [0.35, 0.55, 0.75, 0.0], editor: { tooltip: "xyz=directional light vector, w=normalStrength (0=disabled)" } }
}%

CCProgram sprite-vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  #if USE_LOCAL
    #include <builtin/uniforms/cc-local>
  #endif

  in vec3 a_position;
  in vec2 a_texCoord;
  in vec4 a_color;

  out vec4 color;
  out vec2 uv0;

  vec4 vert () {
    vec4 pos = vec4(a_position, 1.0);
    #if USE_LOCAL
      pos = cc_matWorld * pos;
    #endif
    pos = cc_matViewProj * pos;
    uv0 = a_texCoord;
    color = a_color;
    return pos;
  }
}%

CCProgram sprite-fs %{
  precision highp float;
  #include <builtin/internal/embedded-alpha>
  #include <builtin/internal/alpha-test>

  in vec4 color;
  in vec2 uv0;

  #pragma builtin(local)
  layout(set = 2, binding = 12) uniform sampler2D cc_spriteTexture;

  uniform sampler2D maskTexture;
  uniform sampler2D lutTexture;
  uniform sampler2D normalTexture;

  uniform PaperDollParams {
    vec4 recolorParams; // x=mode(0=none,1=mask_ramp,2=tint), y=hasMask(0/1), z=flashAmount, w=outlineWidth
    vec4 texelSize;     // xy = 1.0 / atlasSize
    vec4 flashColor;
    vec4 outlineColor;
    vec4 lightDir;      // xyz = light direction, w = normal lighting strength (0..1)
  };

  vec4 frag () {
    vec4 albedo = CCSampleWithAlphaSeparated(cc_spriteTexture, uv0);
    float alpha = albedo.a;

    float recolorMode = recolorParams.x;
    float hasMask = recolorParams.y;
    float flashAmount = recolorParams.z;
    float outlineWidth = recolorParams.w;

    // Optional 8-neighbor outer outline on transparent border pixels
    if (outlineWidth > 0.01 && alpha < 0.1) {
      vec2 px = texelSize.xy * outlineWidth;
      float na = 0.0;
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2( px.x,  0.0)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2(-px.x,  0.0)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2( 0.0,  px.y)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2( 0.0, -px.y)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2( px.x,  px.y)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2(-px.x,  px.y)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2( px.x, -px.y)).a);
      na = max(na, CCSampleWithAlphaSeparated(cc_spriteTexture, uv0 + vec2(-px.x, -px.y)).a);
      if (na > 0.25) {
        vec3 outRgb = mix(outlineColor.rgb, flashColor.rgb, flashAmount);
        return vec4(outRgb, outlineColor.a * color.a);
      }
    }

    if (alpha < 0.004) {
      discard;
    }

    vec3 rgb = albedo.rgb;
    if (recolorMode > 0.5 && recolorMode < 1.5 && hasMask > 0.5) {
      vec4 m = texture(maskTexture, uv0);
      float lum = clamp(dot(albedo.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);

      float wPrimary = m.r;
      float wSecondary = m.g;
      float wSkin = m.b;
      float wSum = wPrimary + wSecondary + wSkin;
      if (wSum > 1.0) {
        wPrimary /= wSum;
        wSecondary /= wSum;
        wSkin /= wSum;
        wSum = 1.0;
      }
      float wResidual = max(0.0, 1.0 - wSum);

      vec3 cPrimary = texture(lutTexture, vec2(lum, 0.125)).rgb;
      vec3 cSecondary = texture(lutTexture, vec2(lum, 0.375)).rgb;
      vec3 cSkin = texture(lutTexture, vec2(lum, 0.625)).rgb;

      rgb = albedo.rgb * wResidual
          + cPrimary * wPrimary
          + cSecondary * wSecondary
          + cSkin * wSkin;
    } else if (recolorMode >= 1.5) {
      rgb = albedo.rgb * color.rgb;
    }

    // Optional 2D normal-map directional lighting
    if (lightDir.w > 0.01) {
      vec3 n = normalize(texture(normalTexture, uv0).rgb * 2.0 - 1.0);
      vec3 l = normalize(lightDir.xyz);
      float ndl = clamp(dot(n, l), 0.35, 1.15);
      rgb *= mix(1.0, ndl, clamp(lightDir.w, 0.0, 1.0));
    }

    rgb = mix(rgb, flashColor.rgb, flashAmount);
    return vec4(rgb, alpha * color.a);
  }
}%
`;
}

export function buildCocos3ModularScript(): string {
  return `import {
  _decorator,
  Color,
  Component,
  EffectAsset,
  ImageAsset,
  JsonAsset,
  Material,
  Node,
  Rect,
  Size,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
  Vec2,
  Vec4,
} from 'cc';

const { ccclass, property } = _decorator;

interface RampStop {
  t: number;
  color: string | { r: number; g: number; b: number; a?: number };
}

interface ColorRamp {
  stops: RampStop[];
}

interface SlotDef {
  id: string;
  parent?: string;
  attachSocket?: string;
  defaultOffset: { x: number; y: number };
  defaultRecolorMode?: string;
}

interface FrameRef {
  imageId: string;
  sourceRect: { x: number; y: number; width: number; height: number };
  originalSize: { width: number; height: number };
  trimOffset: { x: number; y: number };
  pivot: { x: number; y: number };
  maskImageId?: string;
  sockets?: Record<string, { x: number; y: number; rotationDeg?: number; scaleX?: number; scaleY?: number; zOffset?: number }>;
}

interface PartDef {
  id: string;
  name: string;
  slotId: string;
  recolorMode?: string;
  rules?: { hidesSlots?: string[]; overrideSlots?: Record<string, string> };
  directions: Record<string, { mode: 'rigged' | 'sequence'; frames: FrameRef[]; actionFrames?: Record<string, FrameRef[]>; fps?: number }>;
}

interface AnimEvent {
  timeMs: number;
  name: string;
  arg?: string;
}

interface AnimClip {
  id: string;
  durationMs: number;
  fps: number;
  loop: boolean;
  tracks: Array<{ slotId: string; keyframes: Array<Record<string, unknown>> }>;
  directionOverrides?: Record<string, Array<{ slotId: string; keyframes: Array<Record<string, unknown>> }>>;
  events?: AnimEvent[];
}

interface ModularManifest {
  imageFiles: Record<string, string>;
  directions: Array<{ id: string; flipX: boolean; mirrorFrom?: string }>;
  slots: SlotDef[];
  zOrder: Record<string, string[]>;
  palettes: Record<string, { primary: ColorRamp; secondary: ColorRamp; metal?: ColorRamp }>;
  skins: Record<string, { ramp: ColorRamp }>;
  parts: Record<string, PartDef[]>;
  animations: Record<string, AnimClip>;
  presets: Array<{ id: string; skin: string; slots: Record<string, string>; palettes: Record<string, string> }>;
  defaultConfig: {
    skin: string;
    direction: string;
    action: string;
    slots: Record<string, string>;
    palettes: Record<string, string>;
    hiddenSlots?: string[];
  };
}

const CLOTHING_SLOTS = [
  'back_cape', 'legs_bottom', 'feet_shoes', 'torso_top',
  'belt_waist', 'back_arm', 'front_arm', 'head_hat',
];

/**
 * PaperDollKit v2.0 — Cocos Creator 3.x Modular Runtime Component (Mode B)
 *
 * Supports real-time equipment swapping, Mask+Ramp LUT recoloring, PartRules
 * (hidesSlots / overrideSlots), 8-dir 5+3 mirroring, hybrid rig + sequence
 * animation, gameplay animation events, hit-flash, and outer outline.
 */
@ccclass('PaperDollModular')
export class PaperDollModular extends Component {
  @property(JsonAsset)
  manifestAsset: JsonAsset | null = null;

  @property(EffectAsset)
  maskRampEffect: EffectAsset | null = null;

  @property([Texture2D])
  textures: Texture2D[] = [];

  @property
  autoPlay = true;

  @property
  playbackSpeed = 1.0;

  /** Optional direct callback for animation events (also emitted as node event 'paperdoll-event'). */
  public onAnimationEvent?: (eventName: string, arg: string, actionId: string) => void;

  private manifest: ModularManifest | null = null;
  private textureById = new Map<string, Texture2D>();
  private slotDefs = new Map<string, SlotDef>();
  private slotNodes = new Map<string, Node>();
  private slotSprites = new Map<string, Sprite>();
  private slotMaterials = new Map<string, Material>();
  private spriteFrameCache = new Map<string, SpriteFrame>();
  private lutCache = new Map<string, Texture2D>();

  private currentDirection = 'SE';
  private currentAction = 'idle';
  private currentSkin = 'fair';
  private currentSlots: Record<string, string> = {};
  private currentPalettes: Record<string, string> = {};
  private hiddenSlots = new Set<string>();

  private timeMs = 0;
  private prevTimeMs = -1;
  private isPlaying = true;
  private flashTimer = 0;
  private flashDuration = 0;
  private flashColor = new Color(255, 255, 255, 255);
  private outlineWidth = 0;
  private outlineColor = new Color(20, 20, 31, 255);

  start() {
    this.isPlaying = this.autoPlay;
    if (this.manifestAsset?.json) {
      this.initializeFromManifest(this.manifestAsset.json as ModularManifest);
    }
  }

  public initializeFromManifest(manifest: ModularManifest) {
    this.manifest = manifest;
    this.textureById.clear();

    // Match bound Texture2D assets against manifest.imageFiles by filename
    for (const [imageId, relPath] of Object.entries(manifest.imageFiles)) {
      const base = relPath.split('/').pop()?.replace(/\\.png$/i, '') ?? '';
      const found = this.textures.find((t) => t && (t.name === base || t.name === imageId));
      if (found) this.textureById.set(imageId, found);
    }

    this.node.removeAllChildren();
    this.slotDefs.clear();
    this.slotNodes.clear();
    this.slotSprites.clear();
    this.slotMaterials.clear();

    for (const slot of manifest.slots) {
      this.slotDefs.set(slot.id, slot);
      const child = new Node(\`Slot_\${slot.id}\`);
      child.addComponent(UITransform);
      const sp = child.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.RAW;
      sp.trim = false;
      if (this.maskRampEffect) {
        const mat = new Material();
        mat.initialize({ effectAsset: this.maskRampEffect });
        sp.customMaterial = mat;
        this.slotMaterials.set(slot.id, mat);
      }
      this.node.addChild(child);
      this.slotNodes.set(slot.id, child);
      this.slotSprites.set(slot.id, sp);
    }

    const def = manifest.defaultConfig;
    this.currentDirection = def.direction ?? 'SE';
    this.currentAction = def.action ?? 'idle';
    this.currentSkin = def.skin ?? 'fair';
    this.currentSlots = { ...def.slots };
    this.currentPalettes = { ...def.palettes };
    this.hiddenSlots = new Set(def.hiddenSlots ?? []);

    this.rebuildAllLuts();
    this.evaluateAndApply(0);
  }

  public setSlot(slotId: string, partId: string) {
    this.currentSlots[slotId] = partId;
    this.evaluateAndApply(this.timeMs);
  }

  public setPalette(slotId: string, paletteId: string) {
    this.currentPalettes[slotId] = paletteId;
    this.updateSlotLut(slotId);
  }

  public setAllClothingPalette(paletteId: string) {
    for (const sid of CLOTHING_SLOTS) {
      if (this.slotDefs.has(sid)) {
        this.currentPalettes[sid] = paletteId;
        this.updateSlotLut(sid);
      }
    }
  }

  public setSkin(skinId: string) {
    this.currentSkin = skinId;
    this.rebuildAllLuts();
  }

  public applyPreset(presetId: string) {
    const preset = this.manifest?.presets.find((p) => p.id === presetId);
    if (!preset) return;
    this.currentSkin = preset.skin;
    this.currentSlots = { ...this.currentSlots, ...preset.slots };
    this.currentPalettes = { ...this.currentPalettes, ...preset.palettes };
    this.rebuildAllLuts();
    this.evaluateAndApply(this.timeMs);
  }

  public setDirection(dirId: string) {
    this.currentDirection = dirId;
    this.evaluateAndApply(this.timeMs);
  }

  public play(actionId: string, restart = true) {
    if (!this.manifest?.animations[actionId]) return;
    if (this.currentAction !== actionId || restart) {
      this.currentAction = actionId;
      this.timeMs = 0;
      this.prevTimeMs = -1;
    }
    this.isPlaying = true;
    this.evaluateAndApply(this.timeMs);
  }

  public triggerHitFlash(durationSec = 0.14, color = Color.WHITE) {
    this.flashDuration = Math.max(0.01, durationSec);
    this.flashTimer = this.flashDuration;
    this.flashColor = color.clone();
    this.evaluateAndApply(this.timeMs);
  }

  public setOutline(widthPx: number, color = new Color(20, 20, 31, 255)) {
    this.outlineWidth = Math.max(0, widthPx);
    this.outlineColor = color.clone();
    this.evaluateAndApply(this.timeMs);
  }

  update(dt: number) {
    if (!this.manifest) return;

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
    }

    if (this.isPlaying) {
      const clip = this.manifest.animations[this.currentAction];
      if (clip) {
        const dur = Math.max(1, clip.durationMs);
        const prev = this.timeMs;
        this.timeMs += dt * 1000 * this.playbackSpeed;
        if (clip.loop) {
          this.emitEventsBetween(clip, prev, this.timeMs, dur, true);
          this.timeMs = ((this.timeMs % dur) + dur) % dur;
        } else {
          const clamped = Math.min(this.timeMs, dur);
          this.emitEventsBetween(clip, prev, clamped, dur, false);
          this.timeMs = clamped;
          if (this.timeMs >= dur) this.isPlaying = false;
        }
      }
    }

    this.evaluateAndApply(this.timeMs);
  }

  private emitEventsBetween(clip: AnimClip, fromMs: number, toMs: number, dur: number, loop: boolean) {
    const events = clip.events;
    if (!events || events.length === 0) return;
    for (const ev of events) {
      let fired = false;
      if (this.prevTimeMs < 0 && ev.timeMs === 0) {
        fired = true;
      } else if (loop && toMs >= dur) {
        const wrapped = ((toMs % dur) + dur) % dur;
        fired = (ev.timeMs > fromMs && ev.timeMs <= dur) || (ev.timeMs >= 0 && ev.timeMs <= wrapped);
      } else {
        fired = ev.timeMs > fromMs && ev.timeMs <= toMs;
      }
      if (fired) {
        this.onAnimationEvent?.(ev.name, ev.arg ?? '', this.currentAction);
        this.node.emit('paperdoll-event', ev.name, ev.arg ?? '', this.currentAction);
      }
    }
    this.prevTimeMs = toMs;
  }

  private resolvePartRules(): Record<string, string> {
    const effective: Record<string, string> = { ...this.currentSlots };
    if (!this.manifest) return effective;

    for (const slot of this.manifest.slots) {
      if (this.hiddenSlots.has(slot.id)) continue;
      const pid = this.currentSlots[slot.id];
      if (!pid || pid === 'none') continue;
      const part = this.manifest.parts[slot.id]?.find((p) => p.id === pid);
      for (const target of part?.rules?.hidesSlots ?? []) {
        if (target !== slot.id) effective[target] = 'none';
      }
    }

    for (const slot of this.manifest.slots) {
      if (this.hiddenSlots.has(slot.id)) continue;
      const pid = effective[slot.id];
      if (!pid || pid === 'none') continue;
      const part = this.manifest.parts[slot.id]?.find((p) => p.id === pid);
      for (const [target, repl] of Object.entries(part?.rules?.overrideSlots ?? {})) {
        if (target === slot.id) continue;
        if (effective[target] && effective[target] !== 'none') {
          effective[target] = repl;
        }
      }
    }

    return effective;
  }

  private sampleTrack(clip: AnimClip | undefined, dirId: string, slotId: string, timeMs: number) {
    const res = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, alpha: 1, z: 0, frame: -1 };
    if (!clip) return res;
    const track =
      clip.directionOverrides?.[dirId]?.find((t) => t.slotId === slotId) ??
      clip.tracks.find((t) => t.slotId === slotId);
    const kfs = track?.keyframes ?? [];
    if (kfs.length === 0) return res;

    let prev = kfs[0]!;
    let next = kfs[kfs.length - 1]!;
    for (const kf of kfs) {
      if (Number(kf.timeMs ?? 0) <= timeMs) prev = kf;
      else {
        next = kf;
        break;
      }
    }
    const t0 = Number(prev.timeMs ?? 0);
    const t1 = Number(next.timeMs ?? t0);
    let u = t1 <= t0 ? 0 : Math.max(0, Math.min(1, (timeMs - t0) / (t1 - t0)));
    if (prev.easing === 'step') u = 0;
    else if (prev.easing === 'easeInOut') u = u * u * (3 - 2 * u);

    const lerp = (a: unknown, b: unknown, def: number) => {
      const av = a !== undefined ? Number(a) : def;
      const bv = b !== undefined ? Number(b) : def;
      return av + (bv - av) * u;
    };
    res.x = lerp(prev.x, next.x, 0);
    res.y = lerp(prev.y, next.y, 0);
    res.rot = lerp(prev.rotationDeg, next.rotationDeg, 0);
    res.sx = lerp(prev.scaleX, next.scaleX, 1);
    res.sy = lerp(prev.scaleY, next.scaleY, 1);
    res.alpha = lerp(prev.alpha, next.alpha, 1);
    res.z = lerp(prev.zOffset, next.zOffset, 0);
    if (prev.frameIndex !== undefined) res.frame = Number(prev.frameIndex);
    return res;
  }

  private evaluateAndApply(timeMs: number) {
    if (!this.manifest) return;
    const dirSpec =
      this.manifest.directions.find((d) => d.id === this.currentDirection) ??
      this.manifest.directions[0]!;
    const mirrorSign = dirSpec.flipX ? -1 : 1;
    const clip = this.manifest.animations[this.currentAction];
    const effective = this.resolvePartRules();
    const zOrderList = this.manifest.zOrder[dirSpec.id] ?? this.manifest.slots.map((s) => s.id);

    const activeFrames = new Map<string, { part: PartDef; frame: FrameRef; flipX: boolean }>();
    const tracks = new Map<string, ReturnType<PaperDollModular['sampleTrack']>>();

    for (const slot of this.manifest.slots) {
      const tr = this.sampleTrack(clip, dirSpec.id, slot.id, timeMs);
      tracks.set(slot.id, tr);
      if (this.hiddenSlots.has(slot.id)) continue;
      const pid = effective[slot.id];
      if (!pid || pid === 'none') continue;
      const part = this.manifest.parts[slot.id]?.find((p) => p.id === pid);
      if (!part) continue;
      let visual = part.directions[dirSpec.id];
      let flipX = dirSpec.flipX;
      if (!visual && dirSpec.mirrorFrom) {
        visual = part.directions[dirSpec.mirrorFrom];
        flipX = true;
      }
      if (!visual) continue;
      const seq = visual.actionFrames?.[this.currentAction] ?? visual.frames;
      if (!seq || seq.length === 0) continue;
      let fidx = 0;
      if (tr.frame >= 0) {
        fidx = ((Math.floor(tr.frame) % seq.length) + seq.length) % seq.length;
      } else if (visual.mode === 'sequence' && seq.length > 1) {
        const fps = visual.fps ?? clip?.fps ?? 12;
        const raw = Math.floor((timeMs / 1000) * fps);
        fidx = clip?.loop ? ((raw % seq.length) + seq.length) % seq.length : Math.max(0, Math.min(seq.length - 1, raw));
      }
      activeFrames.set(slot.id, { part, frame: seq[fidx]!, flipX });
    }

    // Solve hierarchical transforms in Y-down canvas space, then convert Y -> -Y for Cocos Y-up space
    const worldCache = new Map<string, { x: number; y: number; rot: number; sx: number; sy: number; socketZ: number }>();
    const solveWorld = (sid: string): { x: number; y: number; rot: number; sx: number; sy: number; socketZ: number } => {
      const cached = worldCache.get(sid);
      if (cached) return cached;
      const def = this.slotDefs.get(sid);
      const tr = tracks.get(sid) ?? { x: 0, y: 0, rot: 0, sx: 1, sy: 1, alpha: 1, z: 0, frame: -1 };
      let px = 0, py = 0, prot = 0, psx = 1, psy = 1;
      let socket: { x: number; y: number; rotationDeg?: number; scaleX?: number; scaleY?: number; zOffset?: number } | undefined;

      if (def?.parent) {
        const ps = solveWorld(def.parent);
        px = ps.x; py = ps.y; prot = ps.rot; psx = ps.sx; psy = ps.sy;
        if (def.attachSocket) {
          socket = activeFrames.get(def.parent)?.frame.sockets?.[def.attachSocket];
        }
      }
      const bx = socket ? socket.x : (def?.defaultOffset.x ?? 0);
      const by = socket ? socket.y : (def?.defaultOffset.y ?? 0);
      const lx = (bx + tr.x) * mirrorSign;
      const ly = by + tr.y;
      const lrot = ((socket?.rotationDeg ?? 0) + tr.rot) * mirrorSign;
      const lsx = (socket?.scaleX ?? 1) * tr.sx;
      const lsy = (socket?.scaleY ?? 1) * tr.sy;

      const rad = (prot * Math.PI) / 180;
      const rx = lx * psx;
      const ry = ly * psy;
      const solved = {
        x: px + rx * Math.cos(rad) - ry * Math.sin(rad),
        y: py + rx * Math.sin(rad) + ry * Math.cos(rad),
        rot: prot + lrot,
        sx: psx * lsx,
        sy: psy * lsy,
        socketZ: socket?.zOffset ?? 0,
      };
      worldCache.set(sid, solved);
      return solved;
    };

    const sortedOrder: Array<{ sid: string; z: number }> = [];
    const flashAmt = this.flashDuration > 0 ? this.flashTimer / this.flashDuration : 0;

    for (const [sid, node] of this.slotNodes.entries()) {
      const entry = activeFrames.get(sid);
      if (!entry) {
        node.active = false;
        continue;
      }
      const tex = this.textureById.get(entry.frame.imageId);
      if (!tex) {
        node.active = false;
        continue;
      }
      node.active = true;
      const sp = this.slotSprites.get(sid)!;
      sp.spriteFrame = this.getOrCreateSpriteFrame(tex, entry.frame);

      const ui = node.getComponent(UITransform)!;
      ui.setAnchorPoint(entry.frame.pivot.x, 1 - entry.frame.pivot.y);

      const solved = solveWorld(sid);
      node.setPosition(solved.x, -solved.y, 0);
      node.angle = -solved.rot;
      node.setScale(solved.sx * (entry.flipX ? -1 : 1), solved.sy, 1);

      const baseZ = Math.max(0, zOrderList.indexOf(sid));
      const tr = tracks.get(sid)!;
      sortedOrder.push({ sid, z: baseZ + tr.z + solved.socketZ });

      const mat = this.slotMaterials.get(sid);
      if (mat) {
        const maskTex = entry.frame.maskImageId ? this.textureById.get(entry.frame.maskImageId) : undefined;
        const modeStr = entry.part.recolorMode ?? this.slotDefs.get(sid)?.defaultRecolorMode ?? 'mask_ramp';
        const modeNum = modeStr === 'mask_ramp' ? 1 : modeStr === 'tint' ? 2 : 0;
        if (maskTex) mat.setProperty('maskTexture', maskTex);
        mat.setProperty('recolorParams', new Vec4(modeNum, maskTex ? 1 : 0, flashAmt, this.outlineWidth));
        mat.setProperty('texelSize', new Vec4(1 / Math.max(1, tex.width), 1 / Math.max(1, tex.height), 0, 0));
        mat.setProperty('flashColor', this.flashColor);
        mat.setProperty('outlineColor', this.outlineColor);
      }
    }

    sortedOrder.sort((a, b) => a.z - b.z);
    sortedOrder.forEach((item, idx) => {
      this.slotNodes.get(item.sid)?.setSiblingIndex(idx);
    });
  }

  private getOrCreateSpriteFrame(tex: Texture2D, frame: FrameRef): SpriteFrame {
    const r = frame.sourceRect;
    const key = \`\${frame.imageId}:\${r.x},\${r.y},\${r.width},\${r.height}\`;
    const cached = this.spriteFrameCache.get(key);
    if (cached) return cached;
    const sf = new SpriteFrame();
    sf.texture = tex;
    sf.rect = new Rect(r.x, r.y, r.width, r.height);
    sf.originalSize = new Size(frame.originalSize.width, frame.originalSize.height);
    sf.offset = new Vec2(
      frame.trimOffset.x + r.width * 0.5 - frame.originalSize.width * 0.5,
      frame.originalSize.height * 0.5 - (frame.trimOffset.y + r.height * 0.5),
    );
    this.spriteFrameCache.set(key, sf);
    return sf;
  }

  private rebuildAllLuts() {
    for (const sid of this.slotMaterials.keys()) {
      this.updateSlotLut(sid);
    }
  }

  private updateSlotLut(slotId: string) {
    const mat = this.slotMaterials.get(slotId);
    if (!mat || !this.manifest) return;
    const palId = this.currentPalettes[slotId] ?? 'cobalt';
    const key = \`\${palId}|\${this.currentSkin}\`;
    let lutTex = this.lutCache.get(key);
    if (!lutTex) {
      lutTex = this.generateLutTexture(palId, this.currentSkin);
      this.lutCache.set(key, lutTex);
    }
    mat.setProperty('lutTexture', lutTex);
  }

  private generateLutTexture(paletteId: string, skinId: string): Texture2D {
    const data = new Uint8Array(256 * 4 * 4);
    const pal = this.manifest?.palettes[paletteId] ?? Object.values(this.manifest?.palettes ?? {})[0];
    const skin = this.manifest?.skins[skinId] ?? Object.values(this.manifest?.skins ?? {})[0];

    const writeRow = (row: number, stops?: RampStop[]) => {
      for (let x = 0; x < 256; x++) {
        const t = x / 255;
        const c = this.sampleRamp(stops, t);
        const o = (row * 256 + x) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    };

    writeRow(0, pal?.primary?.stops);
    writeRow(1, pal?.secondary?.stops);
    writeRow(2, skin?.ramp?.stops);
    writeRow(3, pal?.metal?.stops);

    const img = new ImageAsset({
      _data: data,
      width: 256,
      height: 4,
      format: Texture2D.PixelFormat.RGBA8888,
      _compressed: false,
    });
    const tex = new Texture2D();
    tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    tex.image = img;
    return tex;
  }

  private sampleRamp(stops: RampStop[] | undefined, t: number): [number, number, number] {
    if (!stops || stops.length === 0) {
      const v = Math.round(t * 255);
      return [v, v, v];
    }
    const parse = (c: RampStop['color']): [number, number, number] => {
      if (typeof c === 'string') {
        const h = c.replace('#', '');
        return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
      }
      return [c.r, c.g, c.b];
    };
    if (t <= stops[0]!.t) return parse(stops[0]!.color);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i]!;
      const b = stops[i + 1]!;
      if (t <= b.t) {
        const u = b.t <= a.t ? 0 : (t - a.t) / (b.t - a.t);
        const ca = parse(a.color);
        const cb = parse(b.color);
        return [
          Math.round(ca[0] + (cb[0] - ca[0]) * u),
          Math.round(ca[1] + (cb[1] - ca[1]) * u),
          Math.round(ca[2] + (cb[2] - ca[2]) * u),
        ];
      }
    }
    return parse(stops[stops.length - 1]!.color);
  }
}
`;
}

function buildCocos3ModularReadme(modular: ModularExportData): string {
  return `# ${modular.kitName} — Cocos Creator 3.x Modular Runtime Kit (Mode B)

由 **PaperDollKit v2** 导出的 **Mode B 模块化实时换装包**（含 ${modular.stats.partCount} 个部件、${modular.stats.textureCount} 张源贴图、${modular.stats.animationCount} 套动画 / ${modular.stats.eventCount} 个动画事件）。

## 3 步快速集成

1. 将解压后的整个文件夹拖入 Cocos Creator 3.x 项目的 \`assets/\` 目录。
2. 在场景中新建空节点，挂载 \`scripts/PaperDollModular.ts\` 组件：
   - \`manifestAsset\` ← 拖入 \`paperdoll_manifest.json\`
   - \`maskRampEffect\` ← 拖入 \`shaders/paperdoll-mask-ramp.effect\`
   - \`textures\` ← 拖入 \`textures/\` 下的所有 PNG 贴图
3. 运行时 TypeScript 调用示例：

\`\`\`ts
const hero = this.node.getComponent(PaperDollModular)!;
hero.onAnimationEvent = (name, arg, actionId) => {
  if (name === 'hit') console.log('命中判定！', arg, actionId);
};
hero.applyPreset('knight');
hero.setSkin('tan');
hero.setAllClothingPalette('crimson');
hero.setSlot('main_hand', 'axe');
hero.setOutline(1.5);
hero.triggerHitFlash(0.14);
\`\`\`
`;
}

/**
 * Exports a complete Mode B Cocos Creator 3.x Modular Runtime Kit ZIP bundle.
 */
export function exportCocos3ModularBundle(
  modular: ModularExportData,
  opts: Cocos3ModularExportOptions = {},
): ExportBundle {
  const folder = opts.folderName ?? modular.kitName;
  const files: Record<string, Uint8Array | string> = {};

  files[`${folder}/paperdoll_manifest.json`] = JSON.stringify(modular.manifest, null, 2);
  files[`${folder}/shaders/paperdoll-mask-ramp.effect`] = buildCocos3MaskRampEffect();
  files[`${folder}/scripts/PaperDollModular.ts`] = buildCocos3ModularScript();
  files[`${folder}/README_COCOS3_MODULAR.md`] = buildCocos3ModularReadme(modular);
  if (modular.credits) {
    files[`${folder}/CREDITS.csv`] = modular.credits.csv;
    files[`${folder}/CREDITS.txt`] = modular.credits.txt;
  }

  for (const tex of modular.textures) {
    files[`${folder}/textures/${tex.filename}`] = tex.png;
  }

  for (const [lutName, lutPng] of Object.entries(modular.prebakedLuts)) {
    files[`${folder}/luts/${lutName}`] = lutPng;
  }

  const zip = packZip(files);
  return {
    files,
    zip,
    zipFilename: `${modular.kitName}_cocos3_modular.zip`,
  };
}
