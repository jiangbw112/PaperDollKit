import type {
  AssetPackManifest,
  CharacterConfig,
  DirectionId,
  EvaluatedFrame,
  Rect,
} from '@paperdollkit/core';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SpritePackInput {
  id: string;
  image: RgbaImage;
  /** Optional explicit trim info when already trimmed. */
  trim?: {
    sourceSize: { width: number; height: number };
    trimOffset: { x: number; y: number };
  };
}

export interface PackedSprite {
  id: string;
  /** Tight rectangle inside the packed atlas PNG. */
  rect: Rect;
  /** Original untrimmed frame size (e.g. 256×256). */
  sourceSize: { width: number; height: number };
  /** Top-left offset of trimmed pixels inside sourceSize. */
  trimOffset: { x: number; y: number };
  rotated: false;
}

export interface PackedAtlas {
  image: RgbaImage;
  png: Uint8Array;
  sprites: PackedSprite[];
}

export interface BakedAnimationSequence {
  /** Combined key e.g. "walk_SE". */
  name: string;
  actionId: string;
  directionId: DirectionId;
  fps: number;
  loop: boolean;
  frameIds: string[];
}

export interface BakedExportData {
  characterName: string;
  frameSize: { width: number; height: number };
  /** Character foot anchor in frame pixel coordinates (default width/2, height*0.875). */
  footAnchor: { x: number; y: number };
  atlas: PackedAtlas;
  animations: BakedAnimationSequence[];
}

export interface ImageLookup {
  get(id: string): RgbaImage | undefined;
}

/**
 * Callback that rasterizes an EvaluatedFrame into a top-to-bottom RGBA8 buffer
 * of size `width × height`. In Studio this delegates to WebGL2 offscreen readback;
 * in Node CLI / tests it defaults to `bakeFrameCPU`.
 */
export type FrameRasterizer = (
  pack: AssetPackManifest,
  frame: EvaluatedFrame,
  images: ImageLookup,
  width: number,
  height: number,
) => RgbaImage;

export interface BakeSequenceOptions {
  characterName?: string;
  directions?: DirectionId[];
  actions?: string[];
  /** Output resolution per baked frame (default: pack.canvasSize). */
  frameSize?: { width: number; height: number };
  /** Optional FPS override; when omitted uses each AnimationClip.fps. */
  fpsOverride?: number;
  /** Trim transparent pixels around each baked frame (default: true). */
  trimTransparent?: boolean;
  /** Pixel padding between packed sprites in the atlas (default: 2). */
  padding?: number;
  /** Force power-of-two atlas dimensions (default: false). */
  powerOfTwo?: boolean;
  /** Maximum atlas dimension (default: 4096). */
  maxAtlasSize?: number;
  /** Custom rasterizer (e.g. WebGL2 GPU offscreen capture). Defaults to pure-TS CPU baker. */
  rasterizer?: FrameRasterizer;
  /** Optional progress callback (completedFrames, totalFrames). */
  onProgress?: (done: number, total: number) => void;
}

export interface ExportBundle {
  /** Virtual relative path -> file bytes or UTF-8 string. */
  files: Record<string, Uint8Array | string>;
  /** Ready-to-download ZIP archive containing all files. */
  zip: Uint8Array;
  /** Suggested filename (e.g. "chibi_knight_godot4.zip"). */
  zipFilename: string;
}

export interface Godot4ExportOptions {
  /** Godot res:// base path where the user will drop the exported folder. */
  resBasePath?: string;
  /** Pixel-art nearest filter vs HD linear filter (default: 'linear'). */
  textureFilter?: 'linear' | 'nearest';
}

export interface Cocos3ExportOptions {
  /** Subfolder name inside the zip (default: characterName). */
  folderName?: string;
}

export type BakeCharacterInput = {
  pack: AssetPackManifest;
  config: CharacterConfig;
  images: ImageLookup;
};
