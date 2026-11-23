import {
  LUT_TEXTURE_WIDTH,
  bakeSlotLUTTexture,
  evaluatePixelMaskRamp,
  parseColor,
  type AssetPackManifest,
  type EvaluatedFrame,
  type EvaluatedLayer,
} from '@paperdollkit/core';
import type {
  ImageLookup,
  PaperDollRenderer,
  RenderFrameOptions,
  RenderImageSource,
} from './types.js';

/**
 * Software Canvas 2D fallback renderer with cached CPU Mask+Ramp LUT baking.
 * Guarantees pixel-identical recoloring even in headless or non-WebGL2 browsers.
 */
export class Canvas2DPaperDollRenderer implements PaperDollRenderer {
  readonly backend = 'canvas2d' as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spriteCache = new Map<string, HTMLCanvasElement>();

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available.');
    }
    this.canvas = canvas;
    this.ctx = ctx;
  }

  private getRecoloredCanvas(
    pack: AssetPackManifest,
    layer: EvaluatedLayer,
    albedo: RenderImageSource,
    mask: RenderImageSource | undefined,
    debugMaskView: boolean,
  ): HTMLCanvasElement {
    const key = [
      layer.frame.imageId,
      layer.frame.maskImageId ?? '-',
      layer.slotId,
      layer.paletteId,
      layer.skinId,
      layer.handColorBugMode,
      layer.recolorMode,
      debugMaskView ? 'dbg' : 'nor',
    ].join('::');

    const cached = this.spriteCache.get(key);
    if (cached) return cached;

    const off = document.createElement('canvas');
    off.width = albedo.width;
    off.height = albedo.height;
    const octx = off.getContext('2d')!;
    const out = octx.createImageData(albedo.width, albedo.height);

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

    const pixelCount = albedo.width * albedo.height;
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      const a = albedo.data[o + 3]!;
      if (a === 0) continue;

      const r = albedo.data[o]!;
      const g = albedo.data[o + 1]!;
      const b = albedo.data[o + 2]!;

      if (debugMaskView && mask) {
        const mr = mask.data[o]!;
        const mg = mask.data[o + 1]!;
        const mb = mask.data[o + 2]!;
        const ma = mask.data[o + 3]!;
        out.data[o] = Math.min(255, mr + Math.round(ma * 0.65));
        out.data[o + 1] = Math.min(255, mg + Math.round(ma * 0.65));
        out.data[o + 2] = Math.min(255, mb + Math.round(ma * 0.65));
        out.data[o + 3] = a;
        continue;
      }

      if (layer.recolorMode === 'mask_ramp' && mask) {
        const px = evaluatePixelMaskRamp(
          { r, g, b, a },
          {
            r: mask.data[o]!,
            g: mask.data[o + 1]!,
            b: mask.data[o + 2]!,
            a: mask.data[o + 3]!,
          },
          lut,
        );
        out.data[o] = px.r;
        out.data[o + 1] = px.g;
        out.data[o + 2] = px.b;
        out.data[o + 3] = px.a;
      } else if (layer.recolorMode === 'tint') {
        out.data[o] = Math.round((r * tint.r) / 255);
        out.data[o + 1] = Math.round((g * tint.g) / 255);
        out.data[o + 2] = Math.round((b * tint.b) / 255);
        out.data[o + 3] = a;
      } else {
        out.data[o] = r;
        out.data[o + 1] = g;
        out.data[o + 2] = b;
        out.data[o + 3] = a;
      }
    }

    octx.putImageData(out, 0, 0);
    this.spriteCache.set(key, off);
    return off;
  }

  render(
    pack: AssetPackManifest,
    frame: EvaluatedFrame,
    images: ImageLookup,
    opts: RenderFrameOptions = {},
  ): void {
    const ctx = this.ctx;
    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    const zoom = opts.zoom ?? 1;
    const panX = opts.panX ?? 0;
    const panY = opts.panY ?? 0;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    if (opts.clearColor && opts.clearColor[3] > 0) {
      const [r, g, b, a] = opts.clearColor;
      ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.translate(viewW * 0.5 + panX, viewH * 0.5 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pack.canvasSize.width * 0.5, -pack.canvasSize.height * 0.5);

    for (const layer of frame.layers) {
      const albedo = images.get(layer.frame.imageId);
      if (!albedo) continue;
      const mask = layer.frame.maskImageId ? images.get(layer.frame.maskImageId) : undefined;
      const sprite = this.getRecoloredCanvas(pack, layer, albedo, mask, Boolean(opts.debugMaskView));

      const [a, b, c, d, tx, ty] = layer.worldMatrix;
      const { sourceRect, originalSize, trimOffset, pivot } = layer.frame;

      ctx.save();
      ctx.globalAlpha = layer.alpha;
      ctx.transform(a, b, c, d, tx, ty);
      if (layer.flipX) {
        ctx.scale(-1, 1);
      }

      const drawX = trimOffset.x - pivot.x * originalSize.width;
      const drawY = trimOffset.y - pivot.y * originalSize.height;
      ctx.drawImage(
        sprite,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        drawX,
        drawY,
        sourceRect.width,
        sourceRect.height,
      );
      ctx.restore();
    }

    ctx.restore();
  }

  invalidateImage(imageId: string): void {
    for (const key of this.spriteCache.keys()) {
      if (key.includes(imageId)) {
        this.spriteCache.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.spriteCache.clear();
  }

  dispose(): void {
    this.spriteCache.clear();
  }
}
