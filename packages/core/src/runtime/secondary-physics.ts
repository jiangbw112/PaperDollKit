import { multiplyMat2D, transformToMat2D } from '../math/transform.js';
import type { EvaluatedFrame, EvaluatedLayer, SlotId } from '../schema/types.js';

export interface SecondarySlotSpec {
  slotId: SlotId;
  /** Spring stiffness (higher = snappier return). */
  stiffness: number;
  /** Damping coefficient (higher = less overshoot). */
  damping: number;
  /** Maximum horizontal/vertical lag displacement in canvas pixels. */
  maxOffsetPx: number;
  /** Maximum angular sway in degrees. */
  maxAngleDeg: number;
  /** Multiplier on incoming motion / wind impulses. */
  response: number;
}

export interface SecondaryPhysicsInput {
  /** World-space horizontal velocity (px/s, positive = moving right). */
  vx?: number;
  /** World-space vertical velocity (px/s, positive = moving down). */
  vy?: number;
  /** Optional lateral impulse (e.g. from attack swing or stride). */
  impulseX?: number;
  /** Optional vertical impulse (e.g. from jump, step bounce, or arcane cast updraft). */
  impulseY?: number;
  /** Optional ambient wind strength in [-1..1] (default 0.15 gentle breeze). */
  wind?: number;
}

export interface SlotSpringState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angleDeg: number;
  vAngle: number;
}

export const DEFAULT_SECONDARY_SLOTS: readonly SecondarySlotSpec[] = [
  {
    slotId: 'back_cloak',
    stiffness: 62,
    damping: 8.5,
    maxOffsetPx: 14,
    maxAngleDeg: 18,
    response: 1.0,
  },
  {
    slotId: 'back_hair',
    stiffness: 84,
    damping: 10.5,
    maxOffsetPx: 10,
    maxAngleDeg: 14,
    response: 0.78,
  },
  {
    slotId: 'front_hair',
    stiffness: 115,
    damping: 13.0,
    maxOffsetPx: 5,
    maxAngleDeg: 7.5,
    response: 0.42,
  },
];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Lightweight 2nd-order spring-damper secondary motion rig for 2.5D paper-doll
 * cloaks, long hair, and flowing accessories. Deterministic & unconditionally
 * stable under variable frame rates via dt clamping.
 */
export class SecondaryPhysicsRig {
  private readonly specs: readonly SecondarySlotSpec[];
  private readonly states = new Map<SlotId, SlotSpringState>();
  private clockSec = 0;

  constructor(specs: readonly SecondarySlotSpec[] = DEFAULT_SECONDARY_SLOTS) {
    this.specs = specs;
    this.reset();
  }

  reset(): void {
    this.clockSec = 0;
    this.states.clear();
    for (const spec of this.specs) {
      this.states.set(spec.slotId, {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angleDeg: 0,
        vAngle: 0,
      });
    }
  }

  getState(slotId: SlotId): Readonly<SlotSpringState> | undefined {
    return this.states.get(slotId);
  }

  /**
   * Advances all tracked secondary springs by `dtSec` seconds.
   */
  step(dtSec: number, input: SecondaryPhysicsInput = {}): void {
    const dt = clamp(dtSec, 0, 0.05);
    if (dt <= 0) return;
    this.clockSec += dt;

    const worldVx = input.vx ?? 0;
    const worldVy = input.vy ?? 0;
    const impX = input.impulseX ?? 0;
    const impY = input.impulseY ?? 0;
    const wind = input.wind ?? 0.12;

    for (let i = 0; i < this.specs.length; i++) {
      const spec = this.specs[i]!;
      const st = this.states.get(spec.slotId);
      if (!st) continue;

      // Subtle phase-shifted ambient breeze so cloaks/hair feel alive even during idle
      const breeze =
        Math.sin(this.clockSec * (2.2 + i * 0.45) + i * 1.3) * wind * 6.5 * spec.response;

      // Target displacement trails OPPOSITE to world velocity (inertia lag)
      const targetX = clamp(
        (-worldVx * 0.065 + impX) * spec.response + breeze,
        -spec.maxOffsetPx,
        spec.maxOffsetPx,
      );
      const targetY = clamp(
        (-worldVy * 0.045 + impY) * spec.response + Math.abs(breeze) * 0.18,
        -spec.maxOffsetPx * 0.75,
        spec.maxOffsetPx * 0.75,
      );
      const targetAngle = clamp(
        (-worldVx * 0.09 + impX * 1.15) * spec.response + breeze * 1.25,
        -spec.maxAngleDeg,
        spec.maxAngleDeg,
      );

      // Semi-implicit Euler damped harmonic oscillator
      const ax = (targetX - st.x) * spec.stiffness - st.vx * spec.damping;
      const ay = (targetY - st.y) * spec.stiffness - st.vy * spec.damping;
      const aAng = (targetAngle - st.angleDeg) * spec.stiffness - st.vAngle * spec.damping;

      st.vx += ax * dt;
      st.vy += ay * dt;
      st.vAngle += aAng * dt;

      st.x = clamp(st.x + st.vx * dt, -spec.maxOffsetPx, spec.maxOffsetPx);
      st.y = clamp(st.y + st.vy * dt, -spec.maxOffsetPx, spec.maxOffsetPx);
      st.angleDeg = clamp(st.angleDeg + st.vAngle * dt, -spec.maxAngleDeg, spec.maxAngleDeg);
    }
  }

  /**
   * Returns a shallow-cloned EvaluatedFrame with spring offsets & rotations
   * applied to tracked secondary slots (back_cloak, back_hair, front_hair).
   */
  applyToEvaluatedFrame(frame: EvaluatedFrame, strength = 1.0): EvaluatedFrame {
    if (strength <= 0.001) return frame;

    const nextLayers: EvaluatedLayer[] = frame.layers.map((layer) => {
      const st = this.states.get(layer.slotId);
      if (!st) return layer;

      const dx = st.x * strength;
      const dy = st.y * strength;
      const dRot = st.angleDeg * strength;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(dRot) < 0.01) {
        return layer;
      }

      const localDelta = transformToMat2D({
        x: dx,
        y: dy,
        rotationDeg: dRot,
        scaleX: 1,
        scaleY: 1,
      });
      return {
        ...layer,
        worldTransform: {
          ...layer.worldTransform,
          x: layer.worldTransform.x + dx,
          y: layer.worldTransform.y + dy,
          rotationDeg: layer.worldTransform.rotationDeg + dRot,
        },
        worldMatrix: multiplyMat2D(layer.worldMatrix, localDelta),
      };
    });

    return {
      ...frame,
      layers: nextLayers,
    };
  }
}
