import {
  LUT_TEXTURE_HEIGHT,
  LUT_TEXTURE_WIDTH,
  bakeSlotLUTTexture,
  parseColor,
  type AssetPackManifest,
  type EvaluatedFrame,
  type EvaluatedLayer,
} from '@paperdollkit/core';
import { FRAGMENT_SHADER_SRC, VERTEX_SHADER_SRC } from './shaders.js';
import type {
  ImageLookup,
  PaperDollRenderer,
  RenderFrameOptions,
  RenderImageSource,
} from './types.js';

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL2 shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile error: ${info}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL2 program.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link error: ${info}`);
  }
  return program;
}

interface UniformLocations {
  origSize: WebGLUniformLocation | null;
  trimOffset: WebGLUniformLocation | null;
  trimSize: WebGLUniformLocation | null;
  pivot: WebGLUniformLocation | null;
  flipX: WebGLUniformLocation | null;
  worldMat: WebGLUniformLocation | null;
  canvasSize: WebGLUniformLocation | null;
  viewportSize: WebGLUniformLocation | null;
  pan: WebGLUniformLocation | null;
  zoom: WebGLUniformLocation | null;
  uvRect: WebGLUniformLocation | null;
  albedoTex: WebGLUniformLocation | null;
  maskTex: WebGLUniformLocation | null;
  lutTex: WebGLUniformLocation | null;
  normalTex: WebGLUniformLocation | null;
  recolorMode: WebGLUniformLocation | null;
  tintColor: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  debugMask: WebGLUniformLocation | null;
  highlight: WebGLUniformLocation | null;
  lightEnabled: WebGLUniformLocation | null;
  lightPos: WebGLUniformLocation | null;
  lightColor: WebGLUniformLocation | null;
  lightIntensity: WebGLUniformLocation | null;
  lightAmbient: WebGLUniformLocation | null;
  flipXFs: WebGLUniformLocation | null;
}

/**
 * Lightweight WebGL2 2D paper-doll renderer implementing the exact Mask + Gradient
 * Ramp LUT shader contract shared with Godot 4 (.gdshader) and Cocos 3.x (.effect).
 */
export class WebGL2PaperDollRenderer implements PaperDollRenderer {
  readonly backend = 'webgl2' as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly emptyMaskTex: WebGLTexture;
  private readonly flatNormalTex: WebGLTexture;
  private readonly uniforms: UniformLocations;
  private readonly imageTextures = new Map<string, { tex: WebGLTexture; src: RenderImageSource }>();
  private readonly lutTextures = new Map<string, WebGLTexture>();
  private disposed = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error('WebGL2 context is not available on this canvas.');
    }
    this.gl = gl;
    this.program = linkProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error('Failed to create WebGL2 VAO/VBO.');
    this.vao = vao;
    this.vbo = vbo;

    // Two-triangle unit quad covering [0, 1] x [0, 1]
    const quad = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // 1x1 transparent dummy mask when a layer does not provide a semantic mask
    this.emptyMaskTex = this.uploadRgbaTexture(1, 1, new Uint8Array([0, 0, 0, 0]), gl.NEAREST);
    // 1x1 flat tangent-space normal (0, 0, 1) -> (128, 128, 255, 255)
    this.flatNormalTex = this.uploadRgbaTexture(1, 1, new Uint8Array([128, 128, 255, 255]), gl.NEAREST);

    this.uniforms = {
      origSize: gl.getUniformLocation(this.program, 'u_orig_size'),
      trimOffset: gl.getUniformLocation(this.program, 'u_trim_offset'),
      trimSize: gl.getUniformLocation(this.program, 'u_trim_size'),
      pivot: gl.getUniformLocation(this.program, 'u_pivot'),
      flipX: gl.getUniformLocation(this.program, 'u_flip_x'),
      worldMat: gl.getUniformLocation(this.program, 'u_world_mat'),
      canvasSize: gl.getUniformLocation(this.program, 'u_canvas_size'),
      viewportSize: gl.getUniformLocation(this.program, 'u_viewport_size'),
      pan: gl.getUniformLocation(this.program, 'u_pan'),
      zoom: gl.getUniformLocation(this.program, 'u_zoom'),
      uvRect: gl.getUniformLocation(this.program, 'u_uv_rect'),
      albedoTex: gl.getUniformLocation(this.program, 'u_albedo_tex'),
      maskTex: gl.getUniformLocation(this.program, 'u_mask_tex'),
      lutTex: gl.getUniformLocation(this.program, 'u_lut_tex'),
      normalTex: gl.getUniformLocation(this.program, 'u_normal_tex'),
      recolorMode: gl.getUniformLocation(this.program, 'u_recolor_mode'),
      tintColor: gl.getUniformLocation(this.program, 'u_tint_color'),
      opacity: gl.getUniformLocation(this.program, 'u_opacity'),
      debugMask: gl.getUniformLocation(this.program, 'u_debug_mask'),
      highlight: gl.getUniformLocation(this.program, 'u_highlight'),
      lightEnabled: gl.getUniformLocation(this.program, 'u_light_enabled'),
      lightPos: gl.getUniformLocation(this.program, 'u_light_pos'),
      lightColor: gl.getUniformLocation(this.program, 'u_light_color'),
      lightIntensity: gl.getUniformLocation(this.program, 'u_light_intensity'),
      lightAmbient: gl.getUniformLocation(this.program, 'u_light_ambient'),
      flipXFs: gl.getUniformLocation(this.program, 'u_flip_x_fs'),
    };
  }

  private uploadRgbaTexture(
    width: number,
    height: number,
    bytes: Uint8Array | Uint8ClampedArray,
    filter: number,
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create WebGL2 texture.');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    return tex;
  }

  private getOrUploadImage(id: string, source: RenderImageSource): WebGLTexture {
    const existing = this.imageTextures.get(id);
    if (existing && existing.src === source) {
      return existing.tex;
    }
    if (existing) {
      this.gl.deleteTexture(existing.tex);
    }
    const tex = this.uploadRgbaTexture(source.width, source.height, source.data, this.gl.LINEAR);
    this.imageTextures.set(id, { tex, src: source });
    return tex;
  }

  private getOrBakeLUT(pack: AssetPackManifest, layer: EvaluatedLayer): WebGLTexture {
    const key = `${layer.slotId}::${layer.paletteId}::${layer.skinId}::${layer.handColorBugMode}`;
    const cached = this.lutTextures.get(key);
    if (cached) return cached;

    const palette = pack.palettes[layer.paletteId] ?? Object.values(pack.palettes)[0]!;
    const skin = pack.skins[layer.skinId] ?? Object.values(pack.skins)[0]!;
    const baked = bakeSlotLUTTexture(
      layer.slotId,
      palette,
      skin,
      layer.handColorBugMode,
      LUT_TEXTURE_WIDTH,
    );
    const tex = this.uploadRgbaTexture(
      LUT_TEXTURE_WIDTH,
      LUT_TEXTURE_HEIGHT,
      baked.data,
      this.gl.LINEAR,
    );
    this.lutTextures.set(key, tex);
    return tex;
  }

  clear(clearColor: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    if (this.disposed) return;
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  render(
    pack: AssetPackManifest,
    frame: EvaluatedFrame,
    images: ImageLookup,
    opts: RenderFrameOptions = {},
  ): void {
    if (this.disposed) return;
    const gl = this.gl;
    const viewW = gl.drawingBufferWidth;
    const viewH = gl.drawingBufferHeight;
    const clear = opts.clearColor ?? [0, 0, 0, 0];

    gl.viewport(0, 0, viewW, viewH);
    if (opts.clearBeforeRender !== false) {
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(this.uniforms.canvasSize, pack.canvasSize.width, pack.canvasSize.height);
    gl.uniform2f(this.uniforms.viewportSize, viewW, viewH);
    gl.uniform2f(this.uniforms.pan, opts.panX ?? 0, opts.panY ?? 0);
    gl.uniform1f(this.uniforms.zoom, opts.zoom ?? 1);
    gl.uniform1i(this.uniforms.albedoTex, 0);
    gl.uniform1i(this.uniforms.maskTex, 1);
    gl.uniform1i(this.uniforms.lutTex, 2);
    gl.uniform1i(this.uniforms.normalTex, 3);
    gl.uniform1i(this.uniforms.debugMask, opts.debugMaskView ? 1 : 0);

    const light = opts.light2D;
    const lightOn = Boolean(light?.enabled);
    gl.uniform1i(this.uniforms.lightEnabled, lightOn ? 1 : 0);
    if (lightOn && light) {
      const lc = light.color ?? [1.0, 0.94, 0.82];
      gl.uniform3f(this.uniforms.lightPos, light.x, light.y, light.z ?? 76);
      gl.uniform3f(this.uniforms.lightColor, lc[0], lc[1], lc[2]);
      gl.uniform1f(this.uniforms.lightIntensity, light.intensity ?? 1.35);
      gl.uniform1f(this.uniforms.lightAmbient, light.ambient ?? 0.36);
    }

    for (const layer of frame.layers) {
      const albedoSrc = images.get(layer.frame.imageId);
      if (!albedoSrc) continue;

      const albedoTex = this.getOrUploadImage(layer.frame.imageId, albedoSrc);
      const maskSrc = layer.frame.maskImageId ? images.get(layer.frame.maskImageId) : undefined;
      const maskTex = maskSrc
        ? this.getOrUploadImage(layer.frame.maskImageId!, maskSrc)
        : this.emptyMaskTex;
      const normalSrc = layer.frame.normalImageId ? images.get(layer.frame.normalImageId) : undefined;
      const normalTex = normalSrc
        ? this.getOrUploadImage(layer.frame.normalImageId!, normalSrc)
        : this.flatNormalTex;
      const lutTex = this.getOrBakeLUT(pack, layer);

      const { sourceRect, originalSize, trimOffset, pivot } = layer.frame;

      gl.uniform2f(this.uniforms.origSize, originalSize.width, originalSize.height);
      gl.uniform2f(this.uniforms.trimOffset, trimOffset.x, trimOffset.y);
      gl.uniform2f(this.uniforms.trimSize, sourceRect.width, sourceRect.height);
      gl.uniform2f(this.uniforms.pivot, pivot.x, pivot.y);
      gl.uniform1f(this.uniforms.flipX, layer.flipX ? 1 : 0);
      gl.uniform1f(this.uniforms.flipXFs, layer.flipX ? 1 : 0);
      gl.uniform4f(
        this.uniforms.uvRect,
        sourceRect.x / albedoSrc.width,
        sourceRect.y / albedoSrc.height,
        sourceRect.width / albedoSrc.width,
        sourceRect.height / albedoSrc.height,
      );

      // Column-major 3x3 matrix from Mat2D [a, b, c, d, tx, ty]
      const [a, b, c, d, tx, ty] = layer.worldMatrix;
      gl.uniformMatrix3fv(
        this.uniforms.worldMat,
        false,
        new Float32Array([a, b, 0, c, d, 0, tx, ty, 1]),
      );

      const effectiveMode =
        layer.recolorMode === 'mask_ramp' && maskSrc
          ? 1
          : layer.recolorMode === 'tint'
            ? 2
            : 0;
      gl.uniform1i(this.uniforms.recolorMode, effectiveMode);

      const pal = pack.palettes[layer.paletteId] ?? Object.values(pack.palettes)[0];
      const tint = pal ? parseColor(pal.swatch) : { r: 255, g: 255, b: 255, a: 255 };
      gl.uniform4f(this.uniforms.tintColor, tint.r / 255, tint.g / 255, tint.b / 255, 1);
      gl.uniform1f(this.uniforms.opacity, layer.alpha);
      gl.uniform1f(
        this.uniforms.highlight,
        opts.highlightSlotId && opts.highlightSlotId === layer.slotId ? 1 : 0,
      );

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, albedoTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, normalTex);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
  }

  /**
   * Reads back the currently rendered framebuffer as top-to-bottom RGBA8 pixels
   * (ready for PNG export and M3 SpriteSheet baking).
   */
  readPixelsTopDown(): { width: number; height: number; data: Uint8ClampedArray } {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const flipped = new Uint8ClampedArray(width * height * 4);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * rowBytes;
      flipped.set(raw.subarray(srcRow, srcRow + rowBytes), y * rowBytes);
    }
    return { width, height, data: flipped };
  }

  invalidateImage(imageId: string): void {
    const entry = this.imageTextures.get(imageId);
    if (entry) {
      this.gl.deleteTexture(entry.tex);
      this.imageTextures.delete(imageId);
    }
  }

  invalidateAll(): void {
    for (const entry of this.imageTextures.values()) {
      this.gl.deleteTexture(entry.tex);
    }
    this.imageTextures.clear();
    for (const tex of this.lutTextures.values()) {
      this.gl.deleteTexture(tex);
    }
    this.lutTextures.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateAll();
    this.gl.deleteTexture(this.emptyMaskTex);
    this.gl.deleteTexture(this.flatNormalTex);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
