import type { EasingType, Mat2D, SlotKeyframe, Transform2D, Vec2 } from '../schema/types.js';

const DEG_TO_RAD = Math.PI / 180;

export function identityTransform(): Transform2D {
  return { x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
}

export function identityMat2D(): Mat2D {
  return [1, 0, 0, 1, 0, 0];
}

/**
 * Converts a local Transform2D into a 2D affine matrix:
 * M = Translate(x, y) * Rotate(rotationDeg) * Scale(scaleX, scaleY)
 */
export function transformToMat2D(t: Transform2D): Mat2D {
  const rad = t.rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos * t.scaleX,
    sin * t.scaleX,
    -sin * t.scaleY,
    cos * t.scaleY,
    t.x,
    t.y,
  ];
}

/** Multiplies two 2D affine matrices: parent * child. */
export function multiplyMat2D(parent: Mat2D, child: Mat2D): Mat2D {
  const [pa, pb, pc, pd, ptx, pty] = parent;
  const [ca, cb, cc, cd, ctx, cty] = child;
  return [
    pa * ca + pc * cb,
    pb * ca + pd * cb,
    pa * cc + pc * cd,
    pb * cc + pd * cd,
    pa * ctx + pc * cty + ptx,
    pb * ctx + pd * cty + pty,
  ];
}

/** Applies a 2D affine matrix to a point. */
export function applyMat2D(m: Mat2D, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

/**
 * Composes a parent world transform with a child local transform, returning
 * both the composed Transform2D and its exact affine Mat2D.
 */
export function composeTransform(parent: Transform2D, child: Transform2D): Transform2D {
  const rad = parent.rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = child.x * parent.scaleX;
  const sy = child.y * parent.scaleY;

  return {
    x: parent.x + sx * cos - sy * sin,
    y: parent.y + sx * sin + sy * cos,
    rotationDeg: parent.rotationDeg + child.rotationDeg,
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
  };
}

export function applyEasing(t: number, easing: EasingType = 'linear'): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (easing === 'step') return clamped >= 1 ? 1 : 0;
  if (easing === 'easeInOut') {
    return clamped * clamped * (3 - 2 * clamped);
  }
  return clamped;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angular interpolation in degrees. */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

export interface SampledTrackValues {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  zOffset: number;
  frameIndex?: number;
}

export function defaultSampledTrack(): SampledTrackValues {
  return {
    x: 0,
    y: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    zOffset: 0,
  };
}

/**
 * Evaluates a sorted keyframe list at timeMs with per-keyframe easing.
 * Handles looping wrap-around cleanly when loop === true and durationMs > 0.
 */
export function sampleKeyframes(
  keyframes: readonly SlotKeyframe[],
  timeMs: number,
  durationMs: number,
  loop: boolean,
): SampledTrackValues {
  const base = defaultSampledTrack();
  if (keyframes.length === 0) return base;

  const first = keyframes[0]!;
  if (keyframes.length === 1) {
    return {
      x: first.x ?? 0,
      y: first.y ?? 0,
      rotationDeg: first.rotationDeg ?? 0,
      scaleX: first.scaleX ?? 1,
      scaleY: first.scaleY ?? 1,
      alpha: first.alpha ?? 1,
      zOffset: first.zOffset ?? 0,
      frameIndex: first.frameIndex,
    };
  }

  let k0 = first;
  let k1 = keyframes[keyframes.length - 1]!;
  let localT = 0;

  if (timeMs <= first.timeMs) {
    if (loop && durationMs > 0 && k1.timeMs < durationMs) {
      const span = durationMs - k1.timeMs + first.timeMs;
      k0 = k1;
      k1 = first;
      localT = span > 0 ? (durationMs - k0.timeMs + timeMs) / span : 0;
    } else {
      k0 = first;
      k1 = first;
      localT = 0;
    }
  } else if (timeMs >= k1.timeMs) {
    if (loop && durationMs > 0 && k1.timeMs < durationMs) {
      const span = durationMs - k1.timeMs + first.timeMs;
      k0 = k1;
      k1 = first;
      localT = span > 0 ? (timeMs - k0.timeMs) / span : 0;
    } else {
      k0 = k1;
      localT = 0;
    }
  } else {
    for (let i = 0; i < keyframes.length - 1; i++) {
      const a = keyframes[i]!;
      const b = keyframes[i + 1]!;
      if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
        k0 = a;
        k1 = b;
        const span = b.timeMs - a.timeMs;
        localT = span > 0 ? (timeMs - a.timeMs) / span : 0;
        break;
      }
    }
  }

  const eased = applyEasing(localT, k0.easing ?? 'linear');
  return {
    x: lerp(k0.x ?? 0, k1.x ?? k0.x ?? 0, eased),
    y: lerp(k0.y ?? 0, k1.y ?? k0.y ?? 0, eased),
    rotationDeg: lerpAngleDeg(k0.rotationDeg ?? 0, k1.rotationDeg ?? k0.rotationDeg ?? 0, eased),
    scaleX: lerp(k0.scaleX ?? 1, k1.scaleX ?? k0.scaleX ?? 1, eased),
    scaleY: lerp(k0.scaleY ?? 1, k1.scaleY ?? k0.scaleY ?? 1, eased),
    alpha: lerp(k0.alpha ?? 1, k1.alpha ?? k0.alpha ?? 1, eased),
    zOffset: Math.round(lerp(k0.zOffset ?? 0, k1.zOffset ?? k0.zOffset ?? 0, eased)),
    frameIndex: localT >= 1 && k1.frameIndex !== undefined ? k1.frameIndex : k0.frameIndex,
  };
}
