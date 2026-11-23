import { Canvas2DPaperDollRenderer } from './canvas2d-renderer.js';
import type { PaperDollRenderer } from './types.js';
import { WebGL2PaperDollRenderer } from './webgl2-renderer.js';

export function createPaperDollRenderer(
  canvas: HTMLCanvasElement,
  preferBackend: 'webgl2' | 'canvas2d' = 'webgl2',
): PaperDollRenderer {
  if (preferBackend === 'webgl2') {
    try {
      return new WebGL2PaperDollRenderer(canvas);
    } catch {
      return new Canvas2DPaperDollRenderer(canvas);
    }
  }
  return new Canvas2DPaperDollRenderer(canvas);
}
