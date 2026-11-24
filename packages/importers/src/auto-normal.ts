import type { ImportedImage } from './types.js';

export interface AutoNormalMapOptions {
  /** Gradient slope strength multiplier (default 2.4). Higher = deeper relief. */
  strength?: number;
  /** Invert Y channel for DirectX-style normal maps (default false = OpenGL/Godot/Cocos). */
  invertY?: boolean;
}

/**
 * Generates a tangent-space 2D normal map (RGBA8, flat default = 128,128,255,255)
 * from an albedo sprite using a 3×3 Sobel height/luminance gradient filter.
 * Transparent pixels emit flat neutral normals so borders stay artifact-free under 2D lights.
 */
export function generateAutoNormalMap(
  albedo: ImportedImage,
  opts: AutoNormalMapOptions = {},
): ImportedImage {
  const { width, height, data } = albedo;
  const strength = opts.strength ?? 2.4;
  const ySign = opts.invertY ? -1 : 1;

  // Build scalar height buffer from alpha-weighted perceptual luminance
  const heightMap = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = (data[o + 3] ?? 0) / 255;
    if (a <= 0.02) {
      heightMap[i] = 0;
    } else {
      const lum =
        (0.2126 * (data[o] ?? 0) +
          0.7152 * (data[o + 1] ?? 0) +
          0.0722 * (data[o + 2] ?? 0)) /
        255;
      heightMap[i] = lum * a;
    }
  }

  const sample = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return heightMap[cy * width + cx]!;
  };

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3] ?? 0;

      if (alpha < 8) {
        out[idx] = 128;
        out[idx + 1] = 128;
        out[idx + 2] = 255;
        out[idx + 3] = 255;
        continue;
      }

      // 3×3 Sobel operator
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dx * strength;
      let ny = -dy * strength * ySign;
      let nz = 1.0;

      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      out[idx] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round((nz * 0.5 + 0.5) * 255)));
      out[idx + 3] = 255;
    }
  }

  return {
    id: albedo.id.replace(/\.png$/i, '') + '_normal.png',
    width,
    height,
    data: out,
  };
}
