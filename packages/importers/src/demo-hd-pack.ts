import {
  DEFAULT_ARPG_ANIMATIONS,
  DEFAULT_ISOMETRIC_Z_ORDER,
  DEFAULT_PALETTES,
  DEFAULT_SKINS,
  ISOMETRIC_8_DIRECTIONS,
  SCHEMA_VERSION,
  STANDARD_17_SLOTS,
  type AssetPackManifest,
  type PartAsset,
  type SpriteFrameRef,
} from '@paperdollkit/core';
import type { ImportedImage } from './types.js';

type MaskChannel = 'primary' | 'secondary' | 'skin' | 'metal' | 'none';

interface PaintSurface {
  width: number;
  height: number;
  albedo: Uint8ClampedArray;
  mask: Uint8ClampedArray;
}

function createSurface(width: number, height: number): PaintSurface {
  const mask = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < mask.length; i += 4) {
    mask[i] = 255;
  }
  return {
    width,
    height,
    albedo: new Uint8ClampedArray(width * height * 4),
    mask,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Alpha-over blends a smooth SDF shape with directional 2.5D shading + dark anti-aliased outline + semantic mask. */
function paintSdfShape(
  surf: PaintSurface,
  sdf: (x: number, y: number) => number,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  opts: {
    channel: MaskChannel;
    centerX: number;
    centerY: number;
    radius: number;
    outlineWidth?: number;
    fixedColor?: [number, number, number, number];
    baseLum?: number;
    contrast?: number;
  },
): void {
  const outlineW = opts.outlineWidth ?? 2.2;
  const baseLum = opts.baseLum ?? 0.64;
  const contrast = opts.contrast ?? 0.32;
  const { width, height, albedo, mask } = surf;

  const minX = Math.max(0, Math.floor(bounds.x0 - outlineW - 2));
  const maxX = Math.min(width - 1, Math.ceil(bounds.x1 + outlineW + 2));
  const minY = Math.max(0, Math.floor(bounds.y0 - outlineW - 2));
  const maxY = Math.min(height - 1, Math.ceil(bounds.y1 + outlineW + 2));

  const maskVec: [number, number, number, number] =
    opts.channel === 'primary'
      ? [255, 0, 0, 0]
      : opts.channel === 'secondary'
        ? [0, 255, 0, 0]
        : opts.channel === 'skin'
          ? [0, 0, 255, 0]
          : opts.channel === 'metal'
            ? [0, 0, 0, 255]
            : [0, 0, 0, 0];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      if (d > outlineW + 1.2) continue;

      // Outer anti-aliased alpha coverage
      const cov = 1 - smoothstep(outlineW - 0.8, outlineW + 0.9, d);
      if (cov <= 0.004) continue;

      // Inner fill vs crisp dark outline transition
      const inner = 1 - smoothstep(-0.7, 0.7, d);

      // Compute smooth directional 2.5D shading (top-left warm key light + subtle rim)
      const nx = (x - opts.centerX) / Math.max(1, opts.radius);
      const ny = (y - opts.centerY) / Math.max(1, opts.radius);
      const lightDot = Math.max(-1, Math.min(1, -nx * 0.6 - ny * 0.72));
      const spec = Math.pow(Math.max(0, lightDot), 3.5) * 0.24;
      const lum = Math.max(0.08, Math.min(0.98, baseLum + lightDot * contrast + spec));

      let sr: number;
      let sg: number;
      let sb: number;
      let sa: number;
      let mr = maskVec[0];
      let mg = maskVec[1];
      let mb = maskVec[2];
      let ma = maskVec[3];

      if (opts.fixedColor) {
        const shade = 0.72 + lum * 0.45;
        sr = Math.min(255, opts.fixedColor[0] * shade);
        sg = Math.min(255, opts.fixedColor[1] * shade);
        sb = Math.min(255, opts.fixedColor[2] * shade);
        sa = (opts.fixedColor[3] / 255) * cov;
        // Blend into dark outline
        sr = sr * inner + 22 * (1 - inner);
        sg = sg * inner + 24 * (1 - inner);
        sb = sb * inner + 32 * (1 - inner);
      } else {
        // Dark lineart at outline edge uses low luminance AND drops mask weight slightly for crisp contour
        const gray = (lum * inner + 0.08 * (1 - inner)) * 255;
        sr = gray;
        sg = gray;
        sb = gray;
        sa = cov;
        mr = Math.round(mr * inner);
        mg = Math.round(mg * inner);
        mb = Math.round(mb * inner);
        ma = Math.round(ma * inner);
      }

      const idx = (y * width + x) * 4;
      const dstA = albedo[idx + 3]! / 255;
      const outA = sa + dstA * (1 - sa);
      if (outA <= 0.001) continue;

      albedo[idx] = Math.round((sr * sa + albedo[idx]! * dstA * (1 - sa)) / outA);
      albedo[idx + 1] = Math.round((sg * sa + albedo[idx + 1]! * dstA * (1 - sa)) / outA);
      albedo[idx + 2] = Math.round((sb * sa + albedo[idx + 2]! * dstA * (1 - sa)) / outA);
      albedo[idx + 3] = Math.round(outA * 255);

      // Blend mask RGB channels with anti-aliased coverage while keeping A=255 opaque
      mask[idx] = Math.round((mr * sa + mask[idx]! * dstA * (1 - sa)) / outA);
      mask[idx + 1] = Math.round((mg * sa + mask[idx + 1]! * dstA * (1 - sa)) / outA);
      mask[idx + 2] = Math.round((mb * sa + mask[idx + 2]! * dstA * (1 - sa)) / outA);
      mask[idx + 3] = 255;
    }
  }
}

function sdCircle(x: number, y: number, cx: number, cy: number, r: number): number {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
}

function sdRoundBox(
  x: number,
  y: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  r: number,
): number {
  const qx = Math.abs(x - cx) - (hx - r);
  const qy = Math.abs(y - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCapsule(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): number {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / Math.max(0.0001, bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function registerSurface(
  images: Map<string, ImportedImage>,
  id: string,
  surf: PaintSurface,
  pivot: { x: number; y: number },
  sockets?: SpriteFrameRef['sockets'],
): SpriteFrameRef {
  const albedoId = `${id}.png`;
  const maskId = `${id}_mask.png`;
  images.set(albedoId, { id: albedoId, width: surf.width, height: surf.height, data: surf.albedo });
  images.set(maskId, { id: maskId, width: surf.width, height: surf.height, data: surf.mask });
  return {
    imageId: albedoId,
    sourceRect: { x: 0, y: 0, width: surf.width, height: surf.height },
    originalSize: { width: surf.width, height: surf.height },
    trimOffset: { x: 0, y: 0 },
    pivot,
    maskImageId: maskId,
    maskRect: { x: 0, y: 0, width: surf.width, height: surf.height },
    sockets,
  };
}

const CANONICAL_DIRS = ['S', 'SE', 'E', 'NE', 'N'] as const;

function dirSideScale(dir: string): number {
  if (dir === 'E') return 0.76;
  if (dir === 'SE' || dir === 'NE') return 0.88;
  return 1.0;
}

function isBackDir(dir: string): boolean {
  return dir === 'N' || dir === 'NE';
}

/**
 * Generates an out-of-the-box high-resolution (256×256) anti-aliased painted
 * Isometric 2.5D starter AssetPack with matching RGBA Semantic Masks.
 *
 * Allows immediate visual inspection of WebGL2 Mask+Ramp LUT recoloring, smooth
 * hand skin synchronization, 8-dir isometric mirroring, and cutout animations
 * before the user imports their own external PSD or PNG assets.
 */
export function createDemoHDPackWithImages(): {
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
} {
  const images = new Map<string, ImportedImage>();
  const parts: Record<string, PartAsset[]> = {};
  for (const s of STANDARD_17_SLOTS) {
    parts[s.id] = [];
  }

  const addPart = (
    slotId: string,
    id: string,
    name: string,
    recolorMode: PartAsset['recolorMode'],
    builder: (dir: string) => SpriteFrameRef,
  ) => {
    const directions: PartAsset['directions'] = {};
    for (const d of CANONICAL_DIRS) {
      directions[d] = { mode: 'rigged', frames: [builder(d)] };
    }
    parts[slotId]!.push({ id, name, slotId, recolorMode, directions });
  };

  // 1. Shadow (soft anti-aliased isometric ground shadow)
  addPart('shadow', 'oval', '柔光椭圆投影', 'none', (dir) => {
    const s = createSurface(128, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = (x - 64) / 44;
        const dy = (y - 32) / 16;
        const r = Math.hypot(dx, dy);
        const alpha = (1 - smoothstep(0.35, 1.0, r)) * 0.42;
        if (alpha > 0.005) {
          const i = (y * 128 + x) * 4;
          s.albedo[i] = 10;
          s.albedo[i + 1] = 14;
          s.albedo[i + 2] = 26;
          s.albedo[i + 3] = Math.round(alpha * 255);
        }
      }
    }
    return registerSurface(images, `shadow/oval_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  // 2. Body Base (smooth shaded torso + legs mannequin, B=skin)
  addPart('body_base', 'hero_body', '高清基础素体', 'mask_ramp', (dir) => {
    const s = createSurface(128, 144);
    const sx = dirSideScale(dir);
    // Legs
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 64 - 12 * sx, 84, 64 - 13 * sx, 126, 9 * sx), { x0: 36, y0: 72, x1: 68, y1: 138 }, { channel: 'skin', centerX: 52, centerY: 102, radius: 22 });
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 64 + 12 * sx, 84, 64 + 13 * sx, 126, 9 * sx), { x0: 58, y0: 72, x1: 92, y1: 138 }, { channel: 'skin', centerX: 74, centerY: 102, radius: 22 });
    // Torso
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 62, 23 * sx, 28, 10), { x0: 32, y0: 28, x1: 96, y1: 96 }, { channel: 'skin', centerX: 60, centerY: 54, radius: 34 });
    // Neck
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 30, 8 * sx, 10, 4), { x0: 50, y0: 16, x1: 78, y1: 42 }, { channel: 'skin', centerX: 62, centerY: 28, radius: 14 });
    return registerSurface(images, `body_base/hero_body_${dir}`, s, { x: 0.5, y: 0.88 }, {
      neck: { x: 0, y: -92 },
      shoulder_front: { x: 24 * sx, y: -74 },
      shoulder_back: { x: -24 * sx, y: -74 },
      back_mount: { x: -4 * sx, y: -76 },
    });
  });

  // 3. Back Cape (cloak_long + scarf)
  addPart('back_cape', 'cloak_long', '骑士长斗篷', 'mask_ramp', (dir) => {
    const s = createSurface(144, 144);
    const sx = dirSideScale(dir);
    paintSdfShape(
      s,
      (x, y) => {
        const taper = 1 + Math.max(0, (y - 24) / 100) * 0.45;
        return sdRoundBox(x, y, 72, 74, 28 * sx * taper, 54, 12);
      },
      { x0: 16, y0: 14, x1: 128, y1: 136 },
      { channel: 'primary', centerX: 64, centerY: 58, radius: 64 },
    );
    // Gold/secondary trim at bottom
    paintSdfShape(
      s,
      (x, y) => sdRoundBox(x, y, 72, 121, 37 * sx, 5, 3),
      { x0: 20, y0: 112, x1: 124, y1: 132 },
      { channel: 'secondary', centerX: 72, centerY: 120, radius: 34, outlineWidth: 1.5 },
    );
    return registerSurface(images, `back_cape/cloak_long_${dir}`, s, { x: 0.5, y: 0.16 });
  });

  addPart('back_cape', 'scarf', '飘逸围巾', 'mask_ramp', (dir) => {
    const s = createSurface(128, 128);
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 64, 24, 40, 88, 10), { x0: 22, y0: 10, x1: 82, y1: 104 }, { channel: 'primary', centerX: 52, centerY: 52, radius: 42 });
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 68, 28, 86, 76, 8), { x0: 54, y0: 14, x1: 102, y1: 92 }, { channel: 'secondary', centerX: 74, centerY: 50, radius: 34 });
    return registerSurface(images, `back_cape/scarf_${dir}`, s, { x: 0.5, y: 0.18 });
  });

  // 4. Back Prop (quiver + wings)
  addPart('back_prop', 'quiver', '游侠箭袋', 'mask_ramp', (dir) => {
    const s = createSurface(112, 112);
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 42, 24, 68, 84, 11), { x0: 24, y0: 10, x1: 86, y1: 98 }, { channel: 'secondary', centerX: 54, centerY: 54, radius: 36 });
    paintSdfShape(s, (x, y) => sdCircle(x, y, 38, 18, 8), { x0: 26, y0: 6, x1: 52, y1: 30 }, { channel: 'primary', centerX: 38, centerY: 16, radius: 12 });
    return registerSurface(images, `back_prop/quiver_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  addPart('back_prop', 'wings', '炽天使羽翼', 'mask_ramp', (dir) => {
    const s = createSurface(192, 144);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 96 - 42 * sx, 64, 38 * sx, 22), { x0: 8, y0: 28, x1: 100, y1: 104 }, { channel: 'primary', centerX: 54, centerY: 56, radius: 42, baseLum: 0.78 });
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 96 + 42 * sx, 64, 38 * sx, 22), { x0: 92, y0: 28, x1: 184, y1: 104 }, { channel: 'primary', centerX: 132, centerY: 56, radius: 42, baseLum: 0.78 });
    return registerSurface(images, `back_prop/wings_${dir}`, s, { x: 0.5, y: 0.55 });
  });

  // 5. Legs Bottom (greaves + robe_skirt)
  addPart('legs_bottom', 'greaves', '重甲护腿', 'mask_ramp', (dir) => {
    const s = createSurface(112, 96);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 56 - 12 * sx, 22, 56 - 13 * sx, 64, 11 * sx), { x0: 24, y0: 8, x1: 62, y1: 80 }, { channel: 'primary', centerX: 44, centerY: 42, radius: 28 });
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 56 + 12 * sx, 22, 56 + 13 * sx, 64, 11 * sx), { x0: 50, y0: 8, x1: 88, y1: 80 }, { channel: 'primary', centerX: 68, centerY: 42, radius: 28 });
    // Metallic knee guards
    paintSdfShape(s, (x, y) => sdCircle(x, y, 56 - 12 * sx, 44, 7 * sx), { x0: 32, y0: 34, x1: 58, y1: 56 }, { channel: 'metal', centerX: 44, centerY: 42, radius: 10, outlineWidth: 1.5 });
    paintSdfShape(s, (x, y) => sdCircle(x, y, 56 + 12 * sx, 44, 7 * sx), { x0: 54, y0: 34, x1: 80, y1: 56 }, { channel: 'metal', centerX: 68, centerY: 42, radius: 10, outlineWidth: 1.5 });
    return registerSurface(images, `legs_bottom/greaves_${dir}`, s, { x: 0.5, y: 0.2 });
  });

  addPart('legs_bottom', 'robe_skirt', '法袍长裙', 'mask_ramp', (dir) => {
    const s = createSurface(128, 104);
    const sx = dirSideScale(dir);
    paintSdfShape(
      s,
      (x, y) => {
        const flare = 1 + Math.max(0, (y - 16) / 76) * 0.35;
        return sdRoundBox(x, y, 64, 50, 23 * sx * flare, 34, 8);
      },
      { x0: 20, y0: 10, x1: 108, y1: 92 },
      { channel: 'primary', centerX: 60, centerY: 42, radius: 44 },
    );
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 52, 7 * sx, 30, 3), { x0: 50, y0: 18, x1: 78, y1: 88 }, { channel: 'secondary', centerX: 64, centerY: 48, radius: 24, outlineWidth: 1.4 });
    return registerSurface(images, `legs_bottom/robe_skirt_${dir}`, s, { x: 0.5, y: 0.2 });
  });

  // 6. Feet Shoes (sabaton)
  addPart('feet_shoes', 'sabaton', '铁甲战靴', 'mask_ramp', (dir) => {
    const s = createSurface(112, 56);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 56 - 13 * sx, 30, 12 * sx, 11, 5), { x0: 22, y0: 14, x1: 60, y1: 46 }, { channel: 'metal', centerX: 42, centerY: 26, radius: 16 });
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 56 + 13 * sx, 30, 12 * sx, 11, 5), { x0: 52, y0: 14, x1: 90, y1: 46 }, { channel: 'metal', centerX: 68, centerY: 26, radius: 16 });
    return registerSurface(images, `feet_shoes/sabaton_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  // 7. Torso Top (plate_cuirass + mage_robe + ranger_vest)
  addPart('torso_top', 'plate_cuirass', '重装板甲胸铠', 'mask_ramp', (dir) => {
    const s = createSurface(128, 112);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 58, 28 * sx, 30, 11), { x0: 26, y0: 22, x1: 102, y1: 94 }, { channel: 'primary', centerX: 58, centerY: 48, radius: 38 });
    // Shoulder pauldrons
    paintSdfShape(s, (x, y) => sdCircle(x, y, 64 - 24 * sx, 38, 13 * sx), { x0: 18, y0: 20, x1: 62, y1: 58 }, { channel: 'metal', centerX: 40, centerY: 34, radius: 16 });
    paintSdfShape(s, (x, y) => sdCircle(x, y, 64 + 24 * sx, 38, 13 * sx), { x0: 66, y0: 20, x1: 110, y1: 58 }, { channel: 'metal', centerX: 86, centerY: 34, radius: 16 });
    // Chest crest (hidden on back)
    if (!isBackDir(dir)) {
      paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 54, 10 * sx, 12, 4), { x0: 48, y0: 38, x1: 80, y1: 72 }, { channel: 'secondary', centerX: 62, centerY: 50, radius: 16, outlineWidth: 1.5 });
    }
    return registerSurface(images, `torso_top/plate_cuirass_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  addPart('torso_top', 'mage_robe', '奥术长袍上衣', 'mask_ramp', (dir) => {
    const s = createSurface(128, 112);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 58, 26 * sx, 31, 10), { x0: 28, y0: 22, x1: 100, y1: 94 }, { channel: 'primary', centerX: 58, centerY: 48, radius: 38 });
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 58, 7 * sx, 28, 3), { x0: 50, y0: 26, x1: 78, y1: 90 }, { channel: 'secondary', centerX: 64, centerY: 50, radius: 22, outlineWidth: 1.4 });
    return registerSurface(images, `torso_top/mage_robe_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  addPart('torso_top', 'ranger_vest', '游侠皮甲马甲', 'mask_ramp', (dir) => {
    const s = createSurface(128, 112);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 58, 25 * sx, 29, 9), { x0: 30, y0: 24, x1: 98, y1: 92 }, { channel: 'primary', centerX: 60, centerY: 50, radius: 36 });
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 64 - 16 * sx, 34, 64 + 16 * sx, 80, 5), { x0: 36, y0: 26, x1: 92, y1: 88 }, { channel: 'secondary', centerX: 64, centerY: 54, radius: 26, outlineWidth: 1.4 });
    return registerSurface(images, `torso_top/ranger_vest_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  // 8. Belt Waist (gold_belt)
  addPart('belt_waist', 'gold_belt', '圣徽战带', 'mask_ramp', (dir) => {
    const s = createSurface(112, 48);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 56, 24, 27 * sx, 7, 3), { x0: 22, y0: 12, x1: 90, y1: 36 }, { channel: 'secondary', centerX: 54, centerY: 22, radius: 24 });
    if (!isBackDir(dir)) {
      paintSdfShape(s, (x, y) => sdRoundBox(x, y, 56, 24, 7 * sx, 8, 2), { x0: 44, y0: 12, x1: 68, y1: 36 }, { channel: 'metal', centerX: 54, centerY: 22, radius: 10, outlineWidth: 1.4 });
    }
    return registerSurface(images, `belt_waist/gold_belt_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  // 9 & 16. Arms (front_arm & back_arm) — SHOWCASE OF SEMANTIC MASK R(sleeve) + A(bracer) + B(hand palm skin!)
  const makeArmPart = (slotId: 'front_arm' | 'back_arm', partId: string, name: string, style: 'armor' | 'cloth' | 'bare') => {
    addPart(slotId, partId, name, 'mask_ramp', (dir) => {
      const s = createSurface(80, 104);
      const isFront = slotId === 'front_arm';
      const socketKey = isFront ? 'hand_main' : 'hand_off';
      // Upper arm / sleeve
      paintSdfShape(
        s,
        (x, y) => sdCapsule(x, y, 40, 22, 40, 56, 11),
        { x0: 22, y0: 6, x1: 58, y1: 72 },
        { channel: style === 'bare' ? 'skin' : 'primary', centerX: 36, centerY: 36, radius: 24 },
      );
      // Forearm / bracer
      if (style === 'armor') {
        paintSdfShape(s, (x, y) => sdRoundBox(x, y, 40, 58, 10, 10, 4), { x0: 24, y0: 44, x1: 56, y1: 74 }, { channel: 'metal', centerX: 36, centerY: 54, radius: 14, outlineWidth: 1.6 });
      } else if (style === 'cloth') {
        paintSdfShape(s, (x, y) => sdRoundBox(x, y, 40, 60, 11, 8, 4), { x0: 24, y0: 48, x1: 56, y1: 74 }, { channel: 'secondary', centerX: 36, centerY: 58, radius: 14, outlineWidth: 1.6 });
      }
      // Hand palm + thumb — ALWAYS painted on Mask B (Skin channel) so hand syncs with character skin!
      paintSdfShape(
        s,
        (x, y) => sdCircle(x, y, 40, 74, 10),
        { x0: 24, y0: 58, x1: 56, y1: 90 },
        { channel: 'skin', centerX: 37, centerY: 70, radius: 13, outlineWidth: 1.8 },
      );
      return registerSurface(images, `${slotId}/${partId}_${dir}`, s, { x: 0.5, y: 0.2 }, {
        [socketKey]: { x: isFront ? 3 : -3, y: 54, rotationDeg: isFront ? -8 : 6 },
      });
    });
  };

  makeArmPart('front_arm', 'armor_sleeve', '臂铠护腕', 'armor');
  makeArmPart('front_arm', 'cloth_sleeve', '长袖布衣', 'cloth');
  makeArmPart('front_arm', 'bare_arm', '素体裸臂', 'bare');
  makeArmPart('back_arm', 'armor_sleeve', '臂铠护腕', 'armor');
  makeArmPart('back_arm', 'cloth_sleeve', '长袖布衣', 'cloth');
  makeArmPart('back_arm', 'bare_arm', '素体裸臂', 'bare');

  // 10. Head Base (smooth shaded head on B=skin)
  addPart('head_base', 'hero_head', '标准头型', 'mask_ramp', (dir) => {
    const s = createSurface(104, 104);
    const sx = dirSideScale(dir);
    paintSdfShape(
      s,
      (x, y) => sdEllipse(x, y, 52, 54, 24 * sx, 26),
      { x0: 20, y0: 20, x1: 84, y1: 88 },
      { channel: 'skin', centerX: 46, centerY: 46, radius: 30 },
    );
    return registerSurface(images, `head_base/hero_head_${dir}`, s, { x: 0.5, y: 0.78 }, {
      head_top: { x: 0, y: -24 },
    });
  });

  // 11. Face Eyes (crisp unmasked eyes — hidden on back views)
  addPart('face_eyes', 'sharp', '坚毅目光', 'none', (dir) => {
    const s = createSurface(80, 48);
    if (!isBackDir(dir)) {
      const shiftX = dir === 'E' ? 10 : dir === 'SE' ? 6 : 0;
      const spacing = dir === 'E' ? 7 : 10;
      paintSdfShape(s, (x, y) => sdEllipse(x, y, 40 - spacing + shiftX, 24, 4.5, 5.2), { x0: 20, y0: 12, x1: 60, y1: 36 }, { channel: 'none', centerX: 32, centerY: 22, radius: 8, fixedColor: [245, 248, 255, 255], outlineWidth: 1.2 });
      paintSdfShape(s, (x, y) => sdCircle(x, y, 40 - spacing + shiftX + 1, 24, 2.3), { x0: 20, y0: 12, x1: 60, y1: 36 }, { channel: 'none', centerX: 32, centerY: 22, radius: 4, fixedColor: [24, 34, 54, 255], outlineWidth: 0.6 });
      if (dir !== 'E') {
        paintSdfShape(s, (x, y) => sdEllipse(x, y, 40 + spacing + shiftX, 24, 4.5, 5.2), { x0: 32, y0: 12, x1: 72, y1: 36 }, { channel: 'none', centerX: 48, centerY: 22, radius: 8, fixedColor: [245, 248, 255, 255], outlineWidth: 1.2 });
        paintSdfShape(s, (x, y) => sdCircle(x, y, 40 + spacing + shiftX + 1, 24, 2.3), { x0: 32, y0: 12, x1: 72, y1: 36 }, { channel: 'none', centerX: 48, centerY: 22, radius: 4, fixedColor: [24, 34, 54, 255], outlineWidth: 0.6 });
      }
    }
    return registerSurface(images, `face_eyes/sharp_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  addPart('face_eyes', 'arcane_glow', '奥术发光瞳', 'none', (dir) => {
    const s = createSurface(80, 48);
    if (!isBackDir(dir)) {
      const shiftX = dir === 'E' ? 10 : dir === 'SE' ? 6 : 0;
      const spacing = dir === 'E' ? 7 : 10;
      paintSdfShape(s, (x, y) => sdEllipse(x, y, 40 - spacing + shiftX, 24, 5, 3.2), { x0: 20, y0: 14, x1: 60, y1: 34 }, { channel: 'none', centerX: 32, centerY: 22, radius: 6, fixedColor: [110, 231, 255, 255], outlineWidth: 1.0 });
      if (dir !== 'E') {
        paintSdfShape(s, (x, y) => sdEllipse(x, y, 40 + spacing + shiftX, 24, 5, 3.2), { x0: 32, y0: 14, x1: 72, y1: 34 }, { channel: 'none', centerX: 48, centerY: 22, radius: 6, fixedColor: [110, 231, 255, 255], outlineWidth: 1.0 });
      }
    }
    return registerSurface(images, `face_eyes/arcane_glow_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  // 12. Face Beard
  addPart('face_beard', 'full_beard', '大法师长须', 'mask_ramp', (dir) => {
    const s = createSurface(80, 64);
    if (!isBackDir(dir)) {
      const shiftX = dir === 'E' ? 8 : dir === 'SE' ? 4 : 0;
      paintSdfShape(s, (x, y) => sdEllipse(x, y, 40 + shiftX, 34, 15, 20), { x0: 18, y0: 10, x1: 66, y1: 60 }, { channel: 'primary', centerX: 38, centerY: 28, radius: 22 });
    }
    return registerSurface(images, `face_beard/full_beard_${dir}`, s, { x: 0.5, y: 0.25 });
  });

  // 13. Hair Style (short + long)
  addPart('hair_style', 'short', '短碎发', 'mask_ramp', (dir) => {
    const s = createSurface(112, 96);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 56, 36, 27 * sx, 19), { x0: 20, y0: 10, x1: 92, y1: 62 }, { channel: 'primary', centerX: 50, centerY: 28, radius: 28 });
    return registerSurface(images, `hair_style/short_${dir}`, s, { x: 0.5, y: 0.65 });
  });

  addPart('hair_style', 'long', '披肩长发', 'mask_ramp', (dir) => {
    const s = createSurface(112, 112);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 56, 56, 28 * sx, 34, 14), { x0: 18, y0: 14, x1: 94, y1: 98 }, { channel: 'primary', centerX: 50, centerY: 42, radius: 38 });
    return registerSurface(images, `hair_style/long_${dir}`, s, { x: 0.5, y: 0.45 });
  });

  // 14. Head Hat (knight_helm + wizard_hat + hood)
  addPart('head_hat', 'knight_helm', '骑士羽饰头盔', 'mask_ramp', (dir) => {
    const s = createSurface(128, 112);
    const sx = dirSideScale(dir);
    // Plume crest
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 64, 24, 52, 42, 9), { x0: 36, y0: 8, x1: 80, y1: 56 }, { channel: 'secondary', centerX: 58, centerY: 24, radius: 18 });
    // Helmet dome
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 64, 56, 28 * sx, 25), { x0: 26, y0: 24, x1: 102, y1: 88 }, { channel: 'primary', centerX: 56, centerY: 46, radius: 32 });
    // Metallic visor band
    if (!isBackDir(dir)) {
      paintSdfShape(s, (x, y) => sdRoundBox(x, y, 64, 62, 20 * sx, 6, 3), { x0: 36, y0: 50, x1: 92, y1: 74 }, { channel: 'metal', centerX: 60, centerY: 60, radius: 18, outlineWidth: 1.5 });
    }
    return registerSurface(images, `head_hat/knight_helm_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  addPart('head_hat', 'wizard_hat', '尖顶大法师帽', 'mask_ramp', (dir) => {
    const s = createSurface(144, 128);
    const sx = dirSideScale(dir);
    // Wide brim
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 72, 82, 46 * sx, 13), { x0: 16, y0: 62, x1: 128, y1: 102 }, { channel: 'primary', centerX: 64, centerY: 78, radius: 42 });
    // Pointed cone
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 72, 74, 64, 22, Math.max(4, (y - 16) * 0.34)), { x0: 38, y0: 12, x1: 106, y1: 86 }, { channel: 'primary', centerX: 66, centerY: 48, radius: 34 });
    // Gold hatband
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 72, 75, 22 * sx, 5, 2), { x0: 42, y0: 66, x1: 102, y1: 84 }, { channel: 'secondary', centerX: 70, centerY: 74, radius: 20, outlineWidth: 1.4 });
    return registerSurface(images, `head_hat/wizard_hat_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  addPart('head_hat', 'hood', '暗影游侠兜帽', 'mask_ramp', (dir) => {
    const s = createSurface(120, 112);
    const sx = dirSideScale(dir);
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 60, 56, 30 * sx, 28), { x0: 22, y0: 20, x1: 98, y1: 92 }, { channel: 'primary', centerX: 52, centerY: 46, radius: 34 });
    return registerSurface(images, `head_hat/hood_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  // 15. Main Hand Weapons (broadsword + arcane_staff + battle_axe)
  addPart('main_hand', 'broadsword', '圣殿骑士长剑', 'mask_ramp', (dir) => {
    const s = createSurface(96, 144);
    // Blade (metal)
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 48, 22, 48, 92, 6), { x0: 34, y0: 10, x1: 62, y1: 102 }, { channel: 'metal', centerX: 44, centerY: 48, radius: 32, baseLum: 0.75 });
    // Crossguard (secondary gold)
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 48, 94, 18, 4.5, 2), { x0: 24, y0: 84, x1: 72, y1: 104 }, { channel: 'secondary', centerX: 46, centerY: 92, radius: 16, outlineWidth: 1.5 });
    // Grip & pommel
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 48, 98, 48, 120, 4), { x0: 38, y0: 92, x1: 58, y1: 128 }, { channel: 'primary', centerX: 48, centerY: 110, radius: 14, outlineWidth: 1.5 });
    paintSdfShape(s, (x, y) => sdCircle(x, y, 48, 123, 5.5), { x0: 38, y0: 114, x1: 58, y1: 134 }, { channel: 'secondary', centerX: 46, centerY: 121, radius: 8, outlineWidth: 1.4 });
    return registerSurface(images, `main_hand/broadsword_${dir}`, s, { x: 0.5, y: 0.74 });
  });

  addPart('main_hand', 'arcane_staff', '秘法水晶长杖', 'mask_ramp', (dir) => {
    const s = createSurface(96, 152);
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 48, 34, 48, 136, 4.5), { x0: 36, y0: 26, x1: 60, y1: 144 }, { channel: 'secondary', centerX: 46, centerY: 80, radius: 42 });
    // Glowing arcane orb (primary)
    paintSdfShape(s, (x, y) => sdCircle(x, y, 48, 24, 13), { x0: 28, y0: 4, x1: 68, y1: 44 }, { channel: 'primary', centerX: 43, centerY: 19, radius: 15, baseLum: 0.78 });
    return registerSurface(images, `main_hand/arcane_staff_${dir}`, s, { x: 0.5, y: 0.65 });
  });

  addPart('main_hand', 'battle_axe', '狂战士双刃战斧', 'mask_ramp', (dir) => {
    const s = createSurface(112, 144);
    paintSdfShape(s, (x, y) => sdCapsule(x, y, 56, 26, 56, 126, 4.5), { x0: 44, y0: 18, x1: 68, y1: 136 }, { channel: 'secondary', centerX: 54, centerY: 76, radius: 40 });
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 36, 42, 18, 22), { x0: 12, y0: 14, x1: 60, y1: 72 }, { channel: 'metal', centerX: 34, centerY: 36, radius: 22 });
    paintSdfShape(s, (x, y) => sdEllipse(x, y, 76, 42, 18, 22), { x0: 52, y0: 14, x1: 100, y1: 72 }, { channel: 'metal', centerX: 74, centerY: 36, radius: 22 });
    return registerSurface(images, `main_hand/battle_axe_${dir}`, s, { x: 0.5, y: 0.72 });
  });

  // 17. Off Hand (kite_shield + spell_tome)
  addPart('off_hand', 'kite_shield', '纹章重盾', 'mask_ramp', (dir) => {
    const s = createSurface(96, 112);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 48, 56, 24, 32, 12), { x0: 16, y0: 16, x1: 80, y1: 96 }, { channel: 'primary', centerX: 42, centerY: 48, radius: 34 });
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 48, 56, 15, 22, 6), { x0: 26, y0: 26, x1: 70, y1: 86 }, { channel: 'secondary', centerX: 44, centerY: 50, radius: 24, outlineWidth: 1.5 });
    paintSdfShape(s, (x, y) => sdCircle(x, y, 48, 54, 7), { x0: 36, y0: 42, x1: 60, y1: 66 }, { channel: 'metal', centerX: 46, centerY: 52, radius: 10, outlineWidth: 1.4 });
    return registerSurface(images, `off_hand/kite_shield_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  addPart('off_hand', 'spell_tome', '禁忌魔法典籍', 'mask_ramp', (dir) => {
    const s = createSurface(80, 88);
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 40, 44, 18, 24, 4), { x0: 16, y0: 14, x1: 64, y1: 74 }, { channel: 'primary', centerX: 36, centerY: 38, radius: 26 });
    paintSdfShape(s, (x, y) => sdRoundBox(x, y, 40, 44, 9, 12, 2), { x0: 26, y0: 26, x1: 54, y1: 62 }, { channel: 'secondary', centerX: 38, centerY: 40, radius: 14, outlineWidth: 1.3 });
    return registerSurface(images, `off_hand/spell_tome_${dir}`, s, { x: 0.5, y: 0.5 });
  });

  const pack: AssetPackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: 'demo-isometric-hd',
    name: '2.5D 等距俯视高清示例资产包 (256×256)',
    canvasSize: { width: 256, height: 256 },
    perspective: 'isometric_8',
    directions: ISOMETRIC_8_DIRECTIONS,
    slots: STANDARD_17_SLOTS,
    zOrder: DEFAULT_ISOMETRIC_Z_ORDER,
    palettes: DEFAULT_PALETTES,
    skins: DEFAULT_SKINS,
    parts,
    animations: DEFAULT_ARPG_ANIMATIONS,
    presets: [
      {
        id: 'knight',
        name: '钴蓝重甲骑士',
        tag: '重甲坦克',
        skin: 'fair',
        slots: {
          shadow: 'oval', body_base: 'hero_body', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'hero_head', face_eyes: 'sharp',
          face_beard: 'none', hair_style: 'short', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson', legs_bottom: 'cobalt', feet_shoes: 'cobalt', torso_top: 'cobalt',
          belt_waist: 'amber', back_arm: 'cobalt', off_hand: 'cobalt', hair_style: 'amber',
          head_hat: 'cobalt', front_arm: 'cobalt', main_hand: 'frost',
        },
      },
      {
        id: 'mage',
        name: '紫罗兰大法师',
        tag: '元素奥术',
        skin: 'tan',
        slots: {
          shadow: 'oval', body_base: 'hero_body', back_cape: 'cloak_long', back_prop: 'none',
          legs_bottom: 'robe_skirt', feet_shoes: 'sabaton', torso_top: 'mage_robe', belt_waist: 'gold_belt',
          back_arm: 'cloth_sleeve', off_hand: 'spell_tome', head_base: 'hero_head', face_eyes: 'arcane_glow',
          face_beard: 'full_beard', hair_style: 'long', head_hat: 'wizard_hat', front_arm: 'cloth_sleeve', main_hand: 'arcane_staff',
        },
        palettes: {
          back_cape: 'violet', legs_bottom: 'violet', feet_shoes: 'obsidian', torso_top: 'violet',
          belt_waist: 'amber', back_arm: 'violet', off_hand: 'crimson', face_beard: 'ivory',
          hair_style: 'ivory', head_hat: 'violet', front_arm: 'violet', main_hand: 'frost',
        },
      },
      {
        id: 'ranger',
        name: '翡翠暗影游侠',
        tag: '敏捷游击',
        skin: 'bronze',
        slots: {
          shadow: 'oval', body_base: 'hero_body', back_cape: 'scarf', back_prop: 'quiver',
          legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'ranger_vest', belt_waist: 'gold_belt',
          back_arm: 'cloth_sleeve', off_hand: 'none', head_base: 'hero_head', face_eyes: 'sharp',
          face_beard: 'none', hair_style: 'short', head_hat: 'hood', front_arm: 'cloth_sleeve', main_hand: 'battle_axe',
        },
        palettes: {
          back_cape: 'crimson', back_prop: 'bronze', legs_bottom: 'obsidian', feet_shoes: 'bronze',
          torso_top: 'emerald', belt_waist: 'bronze', back_arm: 'emerald', hair_style: 'amber',
          head_hat: 'emerald', front_arm: 'emerald', main_hand: 'bronze',
        },
      },
      {
        id: 'paladin',
        name: '圣殿炽天使',
        tag: '圣光守护',
        skin: 'deep',
        slots: {
          shadow: 'oval', body_base: 'hero_body', back_cape: 'cloak_long', back_prop: 'wings',
          legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate_cuirass', belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve', off_hand: 'kite_shield', head_base: 'hero_head', face_eyes: 'arcane_glow',
          face_beard: 'none', hair_style: 'long', head_hat: 'none', front_arm: 'armor_sleeve', main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'ivory', back_prop: 'ivory', legs_bottom: 'ivory', feet_shoes: 'amber',
          torso_top: 'ivory', belt_waist: 'amber', back_arm: 'ivory', off_hand: 'ivory',
          hair_style: 'amber', front_arm: 'ivory', main_hand: 'amber',
        },
      },
    ],
  };

  return { pack, images };
}
