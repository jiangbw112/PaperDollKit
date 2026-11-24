import type { ImportedImage } from './types.js';

export interface AutoMaskOptions {
  /** Target slotId (enables automatic skin-region detection on body/head/arm/leg slots). */
  slotId?: string;
  /** Output imageId for the generated mask (defaults to `${albedo.id}_automask.png`). */
  maskImageId?: string;
  /** Optional sub-rectangle within albedo to analyze/generate (defaults to full image). */
  rect?: { x: number; y: number; width: number; height: number };
  /** Rec.709 luminance below which low-saturation pixels are preserved as dark lineart (default: 0.19). */
  lineartLuminance?: number;
  /** Explicitly enable/disable skin tone detection into the B channel (auto-enabled for limb/body/head slots). */
  detectSkin?: boolean;
  /** Enable secondary (G) color cluster extraction in addition to primary (R) (default: true). */
  detectSecondary?: boolean;
}

export interface AutoMaskStats {
  totalOpaquePixels: number;
  primaryPixels: number;
  secondaryPixels: number;
  skinPixels: number;
  preservedPixels: number;
}

export interface AutoMaskResult {
  mask: ImportedImage;
  stats: AutoMaskStats;
}

const SKIN_ELIGIBLE_SLOTS = new Set([
  'body_base',
  'head_base',
  'front_arm',
  'back_arm',
  'legs_bottom',
]);

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  const s = max <= 1e-5 ? 0 : d / max;
  return [h, s, max];
}

function isLikelySkin(r: number, g: number, b: number, h: number, s: number, v: number): boolean {
  // Warm peach / tan / brown skin hue band with R > G > B ordering
  return (
    h >= 8 &&
    h <= 46 &&
    s >= 0.14 &&
    s <= 0.72 &&
    v >= 0.28 &&
    v <= 0.98 &&
    r > g &&
    g >= b - 8
  );
}

/**
 * Generates an opaque-safe (`A=255`) PaperDollKit semantic Mask PNG directly from
 * a regular colored PNG albedo image:
 * - Dark lineart & pure specular highlights -> (0, 0, 0, 255) (preserved untouched)
 * - Skin-toned pixels (on limb/body/head slots) -> B channel (synced with character skin LUT)
 * - Dominant color region -> R channel (primary clothing ramp)
 * - Distinct secondary accent region (via chromatic 2-means clustering) -> G channel
 */
export function generateAutoMaskFromImage(
  albedo: ImportedImage,
  opts: AutoMaskOptions = {},
): AutoMaskResult {
  const { width, height, data } = albedo;
  const maskData = new Uint8ClampedArray(width * height * 4);
  // Pre-fill opaque black (0, 0, 0, 255) so EVERY pixel obeys the opaque-mask contract
  for (let i = 3; i < maskData.length; i += 4) {
    maskData[i] = 255;
  }

  const rx0 = Math.max(0, Math.floor(opts.rect?.x ?? 0));
  const ry0 = Math.max(0, Math.floor(opts.rect?.y ?? 0));
  const rx1 = Math.min(width, Math.ceil((opts.rect?.x ?? 0) + (opts.rect?.width ?? width)));
  const ry1 = Math.min(height, Math.ceil((opts.rect?.y ?? 0) + (opts.rect?.height ?? height)));

  const lineartLum = opts.lineartLuminance ?? 0.19;
  const detectSkin =
    opts.detectSkin ?? (opts.slotId ? SKIN_ELIGIBLE_SLOTS.has(opts.slotId) : false);
  const detectSecondary = opts.detectSecondary ?? true;

  // Pass 1: classify opaque pixels into preserved / skin / colorable candidates
  // Store normalized chromatic coordinates (cosH*S, sinH*S, S) for hue-based clustering
  const candidateIndices: number[] = [];
  const candX: number[] = [];
  const candY: number[] = [];
  const candL: number[] = [];

  let totalOpaquePixels = 0;
  let skinPixels = 0;
  let preservedPixels = 0;

  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] ?? 0;
      if (a < 24) continue;
      totalOpaquePixels++;

      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const [h, s, v] = rgbToHsv(r, g, b);

      // Preserve crisp dark lineart & extreme near-white specular highlights
      if (lum < lineartLum && s < 0.45) {
        preservedPixels++;
        continue;
      }
      if (lum > 0.96 && s < 0.06) {
        preservedPixels++;
        continue;
      }

      if (detectSkin && isLikelySkin(r, g, b, h, s, v)) {
        maskData[idx] = 0;
        maskData[idx + 1] = 0;
        maskData[idx + 2] = 255;
        maskData[idx + 3] = 255;
        skinPixels++;
        continue;
      }

      const rad = (h * Math.PI) / 180;
      candidateIndices.push(idx);
      candX.push(Math.cos(rad) * s);
      candY.push(Math.sin(rad) * s);
      candL.push(lum);
    }
  }

  let primaryPixels = 0;
  let secondaryPixels = 0;

  if (candidateIndices.length > 0) {
    // Check if there are two genuinely distinct chromatic clusters (Primary R vs Secondary G)
    let useTwoClusters = false;
    let c0x = 0;
    let c0y = 0;
    let c1x = 0;
    let c1y = 0;

    if (detectSecondary && candidateIndices.length >= 16) {
      // Seed cluster 0 at mean chromatic point, cluster 1 at farthest chromatic point
      let meanX = 0;
      let meanY = 0;
      for (let i = 0; i < candidateIndices.length; i++) {
        meanX += candX[i]!;
        meanY += candY[i]!;
      }
      meanX /= candidateIndices.length;
      meanY /= candidateIndices.length;

      let farIdx = 0;
      let maxDistSq = -1;
      for (let i = 0; i < candidateIndices.length; i++) {
        const dx = candX[i]! - meanX;
        const dy = candY[i]! - meanY;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDistSq) {
          maxDistSq = d2;
          farIdx = i;
        }
      }

      // Seed cluster 0 at farthest point from cluster 1 for clean separation
      c1x = candX[farIdx]!;
      c1y = candY[farIdx]!;
      let oppIdx = 0;
      let maxOppSq = -1;
      for (let i = 0; i < candidateIndices.length; i++) {
        const dx = candX[i]! - c1x;
        const dy = candY[i]! - c1y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxOppSq) {
          maxOppSq = d2;
          oppIdx = i;
        }
      }
      c0x = candX[oppIdx]!;
      c0y = candY[oppIdx]!;

      // Run 6 fast 2-means iterations on chromatic coordinates (hue + saturation, invariant to shading luminance!)
      const assign = new Uint8Array(candidateIndices.length);
      for (let iter = 0; iter < 6; iter++) {
        let sx0 = 0, sy0 = 0, n0 = 0;
        let sx1 = 0, sy1 = 0, n1 = 0;
        for (let i = 0; i < candidateIndices.length; i++) {
          const x = candX[i]!;
          const y = candY[i]!;
          const d0 = (x - c0x) * (x - c0x) + (y - c0y) * (y - c0y);
          const d1 = (x - c1x) * (x - c1x) + (y - c1y) * (y - c1y);
          if (d0 <= d1) {
            assign[i] = 0;
            sx0 += x;
            sy0 += y;
            n0++;
          } else {
            assign[i] = 1;
            sx1 += x;
            sy1 += y;
            n1++;
          }
        }
        if (n0 > 0) {
          c0x = sx0 / n0;
          c0y = sy0 / n0;
        }
        if (n1 > 0) {
          c1x = sx1 / n1;
          c1y = sy1 / n1;
        }
      }

      // Measure chromatic distance between the two centroids & minority cluster ratio
      const sepDist = Math.hypot(c0x - c1x, c0y - c1y);
      let count0 = 0;
      let count1 = 0;
      for (let i = 0; i < assign.length; i++) {
        if (assign[i] === 0) count0++;
        else count1++;
      }
      const minRatio = Math.min(count0, count1) / candidateIndices.length;

      // Only split into Primary (R) + Secondary (G) if the two colors are genuinely distinct
      if (sepDist >= 0.28 && minRatio >= 0.05) {
        useTwoClusters = true;
        // Larger cluster becomes Primary (R), smaller accent cluster becomes Secondary (G)
        const primaryCluster = count0 >= count1 ? 0 : 1;
        for (let i = 0; i < candidateIndices.length; i++) {
          const idx = candidateIndices[i]!;
          if (assign[i] === primaryCluster) {
            maskData[idx] = 255;
            maskData[idx + 1] = 0;
            maskData[idx + 2] = 0;
            maskData[idx + 3] = 255;
            primaryPixels++;
          } else {
            maskData[idx] = 0;
            maskData[idx + 1] = 255;
            maskData[idx + 2] = 0;
            maskData[idx + 3] = 255;
            secondaryPixels++;
          }
        }
      }
    }

    if (!useTwoClusters) {
      for (let i = 0; i < candidateIndices.length; i++) {
        const idx = candidateIndices[i]!;
        maskData[idx] = 255;
        maskData[idx + 1] = 0;
        maskData[idx + 2] = 0;
        maskData[idx + 3] = 255;
        primaryPixels++;
      }
    }
  }

  return {
    mask: {
      id: opts.maskImageId ?? `${albedo.id.replace(/\.png$/i, '')}_automask.png`,
      width,
      height,
      data: maskData,
    },
    stats: {
      totalOpaquePixels,
      primaryPixels,
      secondaryPixels,
      skinPixels,
      preservedPixels,
    },
  };
}
