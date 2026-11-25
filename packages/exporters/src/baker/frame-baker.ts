import {
  LUT_TEXTURE_WIDTH,
  PaperDollCharacter,
  bakeSlotLUTTexture,
  evaluatePixelMaskRamp,
  parseColor,
  type AssetPackManifest,
  type EvaluatedFrame,
} from '@paperdollkit/core';
import { packSpritesToAtlas } from '../atlas/maxrects.js';
import type {
  BakeCharacterInput,
  BakeSequenceOptions,
  BakedAnimationSequence,
  BakedExportData,
  ImageLookup,
  RgbaImage,
  SpritePackInput,
} from '../types.js';

function sampleBilinear(img: RgbaImage, u: number, v: number): [number, number, number, number] {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;

  const sample = (x: number, y: number): [number, number, number, number] => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
    const i = (y * img.width + x) * 4;
    return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
  };

  const c00 = sample(x0, y0);
  const c10 = sample(x0 + 1, y0);
  const c01 = sample(x0, y0 + 1);
  const c11 = sample(x0 + 1, y0 + 1);

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  return [
    Math.round(c00[0] * w00 + c10[0] * w10 + c01[0] * w01 + c11[0] * w11),
    Math.round(c00[1] * w00 + c10[1] * w10 + c01[1] * w01 + c11[1] * w11),
    Math.round(c00[2] * w00 + c10[2] * w10 + c01[2] * w01 + c11[2] * w11),
    Math.round(c00[3] * w00 + c10[3] * w10 + c01[3] * w01 + c11[3] * w11),
  ];
}

/**
 * Pure-TypeScript CPU software frame rasterizer (zero DOM / GPU dependency).
 * Evaluates full 2D affine transforms, flipX mirroring, Mask+Ramp LUT recoloring,
 * and straight-alpha compositing — ideal for Node CLI batch baking & tests.
 */
export function bakeFrameCPU(
  pack: AssetPackManifest,
  frame: EvaluatedFrame,
  images: ImageLookup,
  width: number,
  height: number,
): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const scaleX = width / pack.canvasSize.width;
  const scaleY = height / pack.canvasSize.height;

  for (const layer of frame.layers) {
    const albedo = images.get(layer.frame.imageId);
    if (!albedo) continue;
    const mask = layer.frame.maskImageId ? images.get(layer.frame.maskImageId) : undefined;

    const pal = pack.palettes[layer.paletteId] ?? Object.values(pack.palettes)[0]!;
    const skin = pack.skins[layer.skinId] ?? Object.values(pack.skins)[0]!;
    const lut = bakeSlotLUTTexture(
      layer.slotId,
      pal,
      skin,
      layer.handColorBugMode,
      LUT_TEXTURE_WIDTH,
    );
    const tint = parseColor(pal.swatch);

    // Build full world affine transform (canvas -> output pixels)
    const [a0, b0, c0, d0, tx0, ty0] = layer.worldMatrix;
    const a = a0 * scaleX;
    const b = b0 * scaleY;
    const c = c0 * scaleX;
    const d = d0 * scaleY;
    const tx = tx0 * scaleX;
    const ty = ty0 * scaleY;

    const det = a * d - b * c;
    if (Math.abs(det) < 1e-6) continue;
    const invDet = 1 / det;

    const { sourceRect, originalSize, trimOffset, pivot } = layer.frame;
    const xMinLocal = trimOffset.x - pivot.x * originalSize.width;
    const yMinLocal = trimOffset.y - pivot.y * originalSize.height;
    const xMaxLocal = xMinLocal + sourceRect.width;
    const yMaxLocal = yMinLocal + sourceRect.height;

    const corners: [number, number][] = [
      [layer.flipX ? -xMinLocal : xMinLocal, yMinLocal],
      [layer.flipX ? -xMaxLocal : xMaxLocal, yMinLocal],
      [layer.flipX ? -xMinLocal : xMinLocal, yMaxLocal],
      [layer.flipX ? -xMaxLocal : xMaxLocal, yMaxLocal],
    ];

    let minOutX = width;
    let maxOutX = -1;
    let minOutY = height;
    let maxOutY = -1;
    for (const [lx, ly] of corners) {
      const ox = a * lx + c * ly + tx;
      const oy = b * lx + d * ly + ty;
      if (ox < minOutX) minOutX = ox;
      if (ox > maxOutX) maxOutX = ox;
      if (oy < minOutY) minOutY = oy;
      if (oy > maxOutY) maxOutY = oy;
    }

    const px0 = Math.max(0, Math.floor(minOutX));
    const px1 = Math.min(width - 1, Math.ceil(maxOutX));
    const py0 = Math.max(0, Math.floor(minOutY));
    const py1 = Math.min(height - 1, Math.ceil(maxOutY));

    for (let oy = py0; oy <= py1; oy++) {
      for (let ox = px0; ox <= px1; ox++) {
        const rx = ox + 0.5 - tx;
        const ry = oy + 0.5 - ty;
        let lx = (d * rx - c * ry) * invDet;
        const ly = (-b * rx + a * ry) * invDet;
        if (layer.flipX) lx = -lx;

        const sx = lx - xMinLocal;
        const sy = ly - yMinLocal;
        if (sx < 0 || sy < 0 || sx >= sourceRect.width || sy >= sourceRect.height) continue;

        const [ar, ag, ab, aa] = sampleBilinear(albedo, sourceRect.x + sx - 0.5, sourceRect.y + sy - 0.5);
        if (aa <= 1) continue;

        let fr = ar;
        let fg = ag;
        let fb = ab;
        if (layer.recolorMode === 'mask_ramp' && mask) {
          const mRect = layer.frame.maskRect ?? sourceRect;
          const mx = Math.max(0, Math.min(mask.width - 1, Math.floor(mRect.x + sx)));
          const my = Math.max(0, Math.min(mask.height - 1, Math.floor(mRect.y + sy)));
          const mi = (my * mask.width + mx) * 4;
          const recolored = evaluatePixelMaskRamp(
            { r: ar, g: ag, b: ab, a: aa },
            { r: mask.data[mi]!, g: mask.data[mi + 1]!, b: mask.data[mi + 2]!, a: mask.data[mi + 3]! },
            lut,
          );
          fr = recolored.r;
          fg = recolored.g;
          fb = recolored.b;
        } else if (layer.recolorMode === 'tint') {
          fr = Math.round((ar * tint.r) / 255);
          fg = Math.round((ag * tint.g) / 255);
          fb = Math.round((ab * tint.b) / 255);
        }

        const srcA = (aa / 255) * layer.alpha;
        const oi = (oy * width + ox) * 4;
        const dstA = out[oi + 3]! / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0.001) continue;

        out[oi] = Math.round((fr * srcA + out[oi]! * dstA * (1 - srcA)) / outA);
        out[oi + 1] = Math.round((fg * srcA + out[oi + 1]! * dstA * (1 - srcA)) / outA);
        out[oi + 2] = Math.round((fb * srcA + out[oi + 2]! * dstA * (1 - srcA)) / outA);
        out[oi + 3] = Math.round(outA * 255);
      }
    }
  }

  // Additive pass for equipment glow points (staff tip gem, orb, lantern flame, halo)
  if (frame.glows && frame.glows.length > 0) {
    const radiusScale = (scaleX + scaleY) * 0.5;
    for (const glow of frame.glows) {
      if (glow.intensity <= 0.001 || glow.radius <= 0) continue;
      const cx = glow.x * scaleX;
      const cy = glow.y * scaleY;
      const rPx = glow.radius * radiusScale;
      const col = parseColor(glow.color);

      const gx0 = Math.max(0, Math.floor(cx - rPx));
      const gx1 = Math.min(width - 1, Math.ceil(cx + rPx));
      const gy0 = Math.max(0, Math.floor(cy - rPx));
      const gy1 = Math.min(height - 1, Math.ceil(cy + rPx));

      for (let oy = gy0; oy <= gy1; oy++) {
        const ny = (oy + 0.5 - cy) / rPx;
        const ny2 = ny * ny;
        for (let ox = gx0; ox <= gx1; ox++) {
          const nx = (ox + 0.5 - cx) / rPx;
          const dist2 = nx * nx + ny2;
          if (dist2 >= 1) continue;
          const dist = Math.sqrt(dist2);

          const core = Math.exp(-dist2 * 14);
          const halo = Math.pow(Math.max(0, 1 - dist), 2.4) * 0.65;
          let flare = 0;
          if (glow.starFlare) {
            const ax = Math.exp(-Math.abs(nx) * 14) * Math.exp(-Math.abs(ny) * 2.4);
            const ay = Math.exp(-Math.abs(ny) * 14) * Math.exp(-Math.abs(nx) * 2.4);
            flare = (ax + ay) * 0.55;
          }

          const energy = Math.min(1, Math.max(0, (core + halo + flare) * glow.intensity));
          if (energy <= 0.002) continue;

          const whiteMix = Math.min(0.85, core * 0.72);
          const gr = col.r + (255 - col.r) * whiteMix;
          const gg = col.g + (255 - col.g) * whiteMix;
          const gb = col.b + (255 - col.b) * whiteMix;

          const oi = (oy * width + ox) * 4;
          out[oi] = Math.min(255, Math.round(out[oi]! + gr * energy));
          out[oi + 1] = Math.min(255, Math.round(out[oi + 1]! + gg * energy));
          out[oi + 2] = Math.min(255, Math.round(out[oi + 2]! + gb * energy));
          out[oi + 3] = Math.min(255, Math.round(out[oi + 3]! + energy * 255));
        }
      }
    }
  }

  return { width, height, data: out };
}

/**
 * Bakes all requested (actions × directions × frames) of a PaperDollCharacter
 * into a single tightly-packed MaxRects Texture Atlas + animation metadata.
 */
export function bakeCharacterSequences(
  input: BakeCharacterInput,
  opts: BakeSequenceOptions = {},
): BakedExportData {
  const { pack, config, images } = input;
  const characterName = (opts.characterName || 'paperdoll_hero')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_') || 'paperdoll_hero';

  const directions = opts.directions && opts.directions.length > 0
    ? opts.directions
    : pack.directions.map((d) => d.id);
  const actions = opts.actions && opts.actions.length > 0
    ? opts.actions
    : Object.keys(pack.animations);

  const frameSize = opts.frameSize ?? { ...pack.canvasSize };
  const rasterizer = opts.rasterizer ?? bakeFrameCPU;

  // Pre-calculate total frames for progress reporting
  const jobs: Array<{
    actionId: string;
    directionId: string;
    fps: number;
    loop: boolean;
    frameCount: number;
    durationMs: number;
  }> = [];
  let totalFrames = 0;

  for (const actionId of actions) {
    const clip = pack.animations[actionId];
    if (!clip) continue;
    const fps = opts.fpsOverride ?? clip.fps;
    const frameCount = Math.max(1, Math.round((clip.durationMs / 1000) * fps));
    for (const directionId of directions) {
      if (!pack.directions.some((d) => d.id === directionId)) continue;
      jobs.push({
        actionId,
        directionId,
        fps,
        loop: clip.loop,
        frameCount,
        durationMs: clip.durationMs,
      });
      totalFrames += frameCount;
    }
  }

  const spriteInputs: SpritePackInput[] = [];
  const animations: BakedAnimationSequence[] = [];
  const character = new PaperDollCharacter(pack, config);
  let completed = 0;

  for (const job of jobs) {
    character.setDirection(job.directionId).setAction(job.actionId);
    const animName = `${job.actionId}_${job.directionId}`;
    const frameIds: string[] = [];

    for (let f = 0; f < job.frameCount; f++) {
      const timeMs = (f / job.fps) * 1000;
      const evaluated = character.evaluate(timeMs);
      const image = rasterizer(pack, evaluated, images, frameSize.width, frameSize.height);
      const frameId = `${characterName}_${animName}_${String(f).padStart(2, '0')}.png`;
      frameIds.push(frameId);
      spriteInputs.push({ id: frameId, image });

      completed++;
      opts.onProgress?.(completed, totalFrames);
    }

    animations.push({
      name: animName,
      actionId: job.actionId,
      directionId: job.directionId,
      fps: job.fps,
      loop: job.loop,
      frameIds,
    });
  }

  const atlas = packSpritesToAtlas(spriteInputs, {
    padding: opts.padding ?? 2,
    maxSize: opts.maxAtlasSize ?? 4096,
    powerOfTwo: opts.powerOfTwo ?? false,
    trimTransparent: opts.trimTransparent ?? true,
  });

  return {
    characterName,
    frameSize,
    footAnchor: {
      x: frameSize.width * 0.5,
      y: frameSize.height * 0.875,
    },
    atlas,
    animations,
  };
}
