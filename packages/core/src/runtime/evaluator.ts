import {
  composeTransform,
  defaultSampledTrack,
  identityTransform,
  sampleKeyframes,
  transformToMat2D,
  type SampledTrackValues,
} from '../math/transform.js';
import type {
  AnimationClip,
  AssetPackManifest,
  CharacterConfig,
  DirectionSpec,
  EvaluatedFrame,
  EvaluatedLayer,
  PartAsset,
  PartDirectionVisual,
  SlotDefinition,
  SlotId,
  SocketTransform,
  SpriteFrameRef,
  Transform2D,
} from '../schema/types.js';

export interface EvaluateOptions {
  /** Override continuous time with a discrete frame index (useful for sprite-sheet baking). */
  frameIndex?: number;
  /** Optional horizontal spread per layer (in pixels) for exploded layer inspection. */
  explodeSpread?: number;
}

export interface ResolvedPartVisual {
  visual: PartDirectionVisual;
  flipX: boolean;
  sourceDirectionId: string;
}

/**
 * Resolves the directional visual for a part, automatically falling back to
 * `direction.mirrorFrom` when an isometric lateral facing shares mirrored art.
 */
export function resolvePartDirectionVisual(
  part: PartAsset,
  direction: DirectionSpec,
): ResolvedPartVisual | null {
  const direct = part.directions[direction.id];
  if (direct && direct.frames.length > 0) {
    return { visual: direct, flipX: direction.flipX, sourceDirectionId: direction.id };
  }
  if (direction.mirrorFrom) {
    const mirrored = part.directions[direction.mirrorFrom];
    if (mirrored && mirrored.frames.length > 0) {
      return { visual: mirrored, flipX: true, sourceDirectionId: direction.mirrorFrom };
    }
  }
  return null;
}

function selectActiveFrame(
  visual: PartDirectionVisual,
  actionId: string,
  timeMs: number,
  clip: AnimationClip,
  trackFrameOverride?: number,
): { frame: SpriteFrameRef; frameIndex: number } {
  const seq = visual.actionFrames?.[actionId] ?? visual.frames;
  if (seq.length === 0) {
    throw new Error(`PartDirectionVisual has no frames for action "${actionId}".`);
  }
  if (trackFrameOverride !== undefined) {
    const idx = ((Math.floor(trackFrameOverride) % seq.length) + seq.length) % seq.length;
    return { frame: seq[idx]!, frameIndex: idx };
  }
  if (visual.mode === 'sequence' && seq.length > 1) {
    const fps = visual.fps ?? clip.fps;
    const rawIdx = Math.floor((timeMs / 1000) * fps);
    const idx = clip.loop
      ? ((rawIdx % seq.length) + seq.length) % seq.length
      : Math.max(0, Math.min(seq.length - 1, rawIdx));
    return { frame: seq[idx]!, frameIndex: idx };
  }
  return { frame: seq[0]!, frameIndex: 0 };
}

function getMergedTrack(
  clip: AnimationClip,
  directionId: string,
  slotId: SlotId,
) {
  const overrideTrack = clip.directionOverrides?.[directionId]?.find((t) => t.slotId === slotId);
  if (overrideTrack) return overrideTrack;
  return clip.tracks.find((t) => t.slotId === slotId);
}

/**
 * Evaluates a complete character frame at `timeMs`, solving:
 * 1. Animation time normalization & discrete frame index
 * 2. Direction lookup & isometric mirror fallback (`mirrorFrom`)
 * 3. Hybrid visual selection (rigged single sprite vs. multi-frame sequence)
 * 4. Parent -> child hierarchical transform + per-frame socket attachment
 * 5. Dynamic Z-Order sorting with optional per-keyframe zOffset overrides
 */
export function evaluateCharacterFrame(
  pack: AssetPackManifest,
  config: CharacterConfig,
  timeMs: number = 0,
  opts: EvaluateOptions = {},
): EvaluatedFrame {
  const direction =
    pack.directions.find((d) => d.id === config.direction) ?? pack.directions[0];
  if (!direction) {
    throw new Error(`AssetPack "${pack.id}" defines no directions.`);
  }

  const clip = pack.animations[config.action] ?? Object.values(pack.animations)[0];
  if (!clip) {
    throw new Error(`AssetPack "${pack.id}" defines no animations.`);
  }

  const durationMs = Math.max(1, clip.durationMs);
  const effectiveTimeMs =
    opts.frameIndex !== undefined
      ? (opts.frameIndex / Math.max(1, clip.fps)) * 1000
      : clip.loop
        ? ((timeMs % durationMs) + durationMs) % durationMs
        : Math.max(0, Math.min(durationMs, timeMs));

  const normalizedTime = effectiveTimeMs / durationMs;
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * clip.fps));
  const discreteFrameIndex =
    opts.frameIndex !== undefined
      ? opts.frameIndex
      : clip.loop
        ? Math.floor((effectiveTimeMs / 1000) * clip.fps) % totalFrames
        : Math.min(totalFrames - 1, Math.floor((effectiveTimeMs / 1000) * clip.fps));

  const slotDefMap = new Map<SlotId, SlotDefinition>();
  for (const s of pack.slots) {
    slotDefMap.set(s.id, s);
  }

  const hidden = new Set<SlotId>(config.hiddenSlots ?? []);
  const zOrderList = pack.zOrder[direction.id] ?? pack.slots.map((s) => s.id);
  const baseZMap = new Map<SlotId, number>();
  zOrderList.forEach((slotId, index) => baseZMap.set(slotId, index));

  // Sample all slot animation tracks once
  const sampledTracks = new Map<SlotId, SampledTrackValues>();
  for (const slot of pack.slots) {
    const track = getMergedTrack(clip, direction.id, slot.id);
    sampledTracks.set(
      slot.id,
      track
        ? sampleKeyframes(track.keyframes, effectiveTimeMs, durationMs, clip.loop)
        : defaultSampledTrack(),
    );
  }

  // Resolve active part frames first so parent frames can provide sockets to children
  const activeFrames = new Map<
    SlotId,
    { part: PartAsset; frame: SpriteFrameRef; frameIndex: number; flipX: boolean }
  >();

  for (const slot of pack.slots) {
    const partId = config.slots[slot.id];
    if (!partId || partId === 'none') continue;
    const part = pack.parts[slot.id]?.find((p) => p.id === partId);
    if (!part) continue;
    const resolved = resolvePartDirectionVisual(part, direction);
    if (!resolved) continue;
    const trackSample = sampledTracks.get(slot.id) ?? defaultSampledTrack();
    const { frame, frameIndex } = selectActiveFrame(
      resolved.visual,
      clip.id,
      effectiveTimeMs,
      clip,
      trackSample.frameIndex,
    );
    activeFrames.set(slot.id, { part, frame, frameIndex, flipX: resolved.flipX });
  }

  // Mirror sign flips horizontal translation and rotation cleanly in rig space
  const mirrorSign = direction.flipX ? -1 : 1;

  // Root origin sits at character foot center (canvasWidth / 2, canvasHeight * 0.875)
  const rootTransform: Transform2D = {
    x: pack.canvasSize.width * 0.5,
    y: pack.canvasSize.height * 0.875,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
  };

  // Memoized recursive world-transform solver (guaranteed acyclic by schema validator)
  const worldTransforms = new Map<SlotId, { local: Transform2D; world: Transform2D; socketZOffset: number }>();

  const solveSlotTransform = (slotId: SlotId): { local: Transform2D; world: Transform2D; socketZOffset: number } => {
    const cached = worldTransforms.get(slotId);
    if (cached) return cached;

    const def = slotDefMap.get(slotId);
    const track = sampledTracks.get(slotId) ?? defaultSampledTrack();

    let parentWorld = rootTransform;
    let socket: SocketTransform | undefined;

    if (def?.parent) {
      const parentSolved = solveSlotTransform(def.parent);
      parentWorld = parentSolved.world;
      if (def.attachSocket) {
        socket = activeFrames.get(def.parent)?.frame.sockets?.[def.attachSocket];
      }
    }

    const baseOffsetX = socket ? socket.x : (def?.defaultOffset.x ?? 0);
    const baseOffsetY = socket ? socket.y : (def?.defaultOffset.y ?? 0);
    const baseRot = socket?.rotationDeg ?? 0;
    const baseScaleX = socket?.scaleX ?? 1;
    const baseScaleY = socket?.scaleY ?? 1;

    const local: Transform2D = {
      x: (baseOffsetX + track.x) * mirrorSign,
      y: baseOffsetY + track.y,
      rotationDeg: (baseRot + track.rotationDeg) * mirrorSign,
      scaleX: baseScaleX * track.scaleX,
      scaleY: baseScaleY * track.scaleY,
    };

    const world = composeTransform(parentWorld, local);
    const result = { local, world, socketZOffset: socket?.zOffset ?? 0 };
    worldTransforms.set(slotId, result);
    return result;
  };

  const layers: EvaluatedLayer[] = [];

  for (const slotId of zOrderList) {
    if (hidden.has(slotId)) continue;
    const active = activeFrames.get(slotId);
    if (!active) continue;

    const def = slotDefMap.get(slotId);
    const track = sampledTracks.get(slotId) ?? defaultSampledTrack();
    const solved = solveSlotTransform(slotId);

    const baseZ = baseZMap.get(slotId) ?? 0;
    const effectiveZ = baseZ + track.zOffset + solved.socketZOffset;

    const paletteId = config.palettes[slotId] ?? Object.keys(pack.palettes)[0] ?? 'cobalt';
    const recolorMode = active.part.recolorMode ?? def?.defaultRecolorMode ?? 'mask_ramp';

    layers.push({
      slotId,
      partId: active.part.id,
      recolorMode,
      frame: active.frame,
      frameIndex: active.frameIndex,
      localTransform: solved.local,
      worldTransform: solved.world,
      worldMatrix: transformToMat2D(solved.world),
      flipX: active.flipX,
      alpha: Math.max(0, Math.min(1, track.alpha)),
      zOrder: effectiveZ,
      paletteId,
      skinId: config.skin,
      handColorBugMode: config.handColorBugMode,
    });
  }

  // Stable sort by effective zOrder
  layers.sort((a, b) => a.zOrder - b.zOrder);

  // Apply optional exploded spread for visual debugging
  if (opts.explodeSpread && opts.explodeSpread !== 0 && layers.length > 1) {
    const mid = (layers.length - 1) / 2;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      const dx = (i - mid) * opts.explodeSpread;
      const spreadWorld: Transform2D = {
        ...layer.worldTransform,
        x: layer.worldTransform.x + dx,
      };
      layer.worldTransform = spreadWorld;
      layer.worldMatrix = transformToMat2D(spreadWorld);
    }
  }

  return {
    direction,
    actionId: clip.id,
    timeMs: effectiveTimeMs,
    normalizedTime,
    discreteFrameIndex,
    layers,
  };
}
