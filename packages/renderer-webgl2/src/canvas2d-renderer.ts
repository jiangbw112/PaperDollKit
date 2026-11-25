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
    const sr = layer.frame.sourceRect;
    const mr = layer.frame.maskRect ?? sr;
    const key = [
      layer.frame.imageId,
      `${sr.x},${sr.y},${sr.width},${sr.height}`,
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

    const w = Math.max(1, sr.width);
    const h = Math.max(1, sr.height);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    const out = octx.createImageData(w, h);

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

    for (let y = 0; y < h; y++) {
      const sy = sr.y + y;
      const my = mr.y + y;
      for (let x = 0; x < w; x++) {
        const sx = sr.x + x;
        const so = (sy * albedo.width + sx) * 4;
        const a = albedo.data[so + 3]!;
        if (a === 0) continue;

        const r = albedo.data[so]!;
        const g = albedo.data[so + 1]!;
        const b = albedo.data[so + 2]!;
        const dst = (y * w + x) * 4;

        if (debugMaskView && mask) {
          const mo = (my * mask.width + (mr.x + x)) * 4;
          out.data[dst] = mask.data[mo]!;
          out.data[dst + 1] = mask.data[mo + 1]!;
          out.data[dst + 2] = mask.data[mo + 2]!;
          out.data[dst + 3] = a;
          continue;
        }

        if (layer.recolorMode === 'mask_ramp' && mask) {
          const mo = (my * mask.width + (mr.x + x)) * 4;
          const px = evaluatePixelMaskRamp(
            { r, g, b, a },
            {
              r: mask.data[mo]!,
              g: mask.data[mo + 1]!,
              b: mask.data[mo + 2]!,
              a: mask.data[mo + 3]!,
            },
            lut,
          );
          out.data[dst] = px.r;
          out.data[dst + 1] = px.g;
          out.data[dst + 2] = px.b;
          out.data[dst + 3] = px.a;
        } else if (layer.recolorMode === 'tint') {
          out.data[dst] = Math.round((r * tint.r) / 255);
          out.data[dst + 1] = Math.round((g * tint.g) / 255);
          out.data[dst + 2] = Math.round((b * tint.b) / 255);
          out.data[dst + 3] = a;
        } else {
          out.data[dst] = r;
          out.data[dst + 1] = g;
          out.data[dst + 2] = b;
          out.data[dst + 3] = a;
        }
      }
    }

    octx.putImageData(out, 0, 0);
    this.spriteCache.set(key, off);
    return off;
  }

  clear(clearColor?: readonly [number, number, number, number]): void {
    const ctx = this.ctx;
    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    if (clearColor && clearColor[3] > 0) {
      const [r, g, b, a] = clearColor;
      ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    ctx.restore();
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
    if (opts.clearBeforeRender !== false) {
      ctx.clearRect(0, 0, viewW, viewH);
      if (opts.clearColor && opts.clearColor[3] > 0) {
        const [r, g, b, a] = opts.clearColor;
        ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        ctx.fillRect(0, 0, viewW, viewH);
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.translate(viewW * 0.5 + panX, viewH * 0.5 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-pack.canvasSize.width * 0.5, -pack.canvasSize.height * 0.5);

    const glowsBySlot = new Map<string, NonNullable<EvaluatedFrame['glows']>>();
    if (frame.glows && frame.glows.length > 0 && !opts.debugMaskView) {
      for (const g of frame.glows) {
        if (g.intensity <= 0.001 || g.radius <= 0) continue;
        const list = glowsBySlot.get(g.slotId) ?? [];
        list.push(g);
        glowsBySlot.set(g.slotId, list);
      }
    }

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
      ctx.drawImage(sprite, 0, 0, sourceRect.width, sourceRect.height, drawX, drawY, sourceRect.width, sourceRect.height);
      ctx.restore();

      const slotGlows = glowsBySlot.get(layer.slotId);
      if (slotGlows && slotGlows.length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const glow of slotGlows) {
          const col = parseColor(glow.color);
          const alpha = Math.min(1, glow.intensity);
          const grad = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
          grad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(1, alpha * 0.9)})`);
          grad.addColorStop(0.32, `rgba(${col.r}, ${col.g}, ${col.b}, ${Math.min(1, alpha * 0.72)})`);
          grad.addColorStop(1, `rgba(${col.r}, ${col.g}, ${col.b}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(glow.x, glow.y, glow.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
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
