import { rampFromFourHex } from '../color/lut.js';
import {
  SCHEMA_VERSION,
  type AnimationClip,
  type AssetPackManifest,
  type ColorPalette,
  type DirectionSpec,
  type PartAsset,
  type SkinTone,
  type SlotDefinition,
  type SpriteFrameRef,
  type ZOrderTable,
} from '../schema/types.js';

/**
 * Diablo-style 8-direction isometric facing table.
 * Artists only author 5 unique facings (S, SE, E, NE, N); W, SW, NW automatically
 * mirror E, SE, NE via mirrorFrom + flipX.
 */
export const ISOMETRIC_8_DIRECTIONS: DirectionSpec[] = [
  { id: 'S',  label: '正 (南)', angleDeg: 0,   facingBack: false, flipX: false, side: 0 },
  { id: 'SE', label: '右前',    angleDeg: 315, facingBack: false, flipX: false, side: 1 },
  { id: 'E',  label: '右 (东)', angleDeg: 270, facingBack: false, flipX: false, side: 2 },
  { id: 'NE', label: '右后',    angleDeg: 225, facingBack: true,  flipX: false, side: 1 },
  { id: 'N',  label: '背 (北)', angleDeg: 180, facingBack: true,  flipX: false, side: 0 },
  { id: 'NW', label: '左后',    angleDeg: 135, facingBack: true,  mirrorFrom: 'NE', flipX: true, side: -1 },
  { id: 'W',  label: '左 (西)', angleDeg: 90,  facingBack: false, mirrorFrom: 'E',  flipX: true, side: -2 },
  { id: 'SW', label: '左前',    angleDeg: 45,  facingBack: false, mirrorFrom: 'SE', flipX: true, side: -1 },
];

/** 4-direction diagonal isometric preset (only 2 unique views authored: SE, NE). */
export const ISOMETRIC_4_DIRECTIONS: DirectionSpec[] = [
  { id: 'SE', label: '右前', angleDeg: 315, facingBack: false, flipX: false, side: 1 },
  { id: 'NE', label: '右后', angleDeg: 225, facingBack: true,  flipX: false, side: 1 },
  { id: 'NW', label: '左后', angleDeg: 135, facingBack: true,  mirrorFrom: 'NE', flipX: true, side: -1 },
  { id: 'SW', label: '左前', angleDeg: 45,  facingBack: false, mirrorFrom: 'SE', flipX: true, side: -1 },
];

/** 2-direction side-scroller preset (only 1 unique view authored: E). */
export const SIDE_2_DIRECTIONS: DirectionSpec[] = [
  { id: 'E', label: '右', angleDeg: 270, facingBack: false, flipX: false, side: 2 },
  { id: 'W', label: '左', angleDeg: 90,  facingBack: false, mirrorFrom: 'E', flipX: true, side: -2 },
];

/**
 * Standard 17 paper-doll slots upgraded with hierarchical cutout rig parenting
 * and socket attachment points (canvas-space reference: 256×256, origin at foot center (128, 224)).
 */
export const STANDARD_17_SLOTS: SlotDefinition[] = [
  { id: 'shadow',      name: '脚底阴影',   category: 'base',      colorable: false, required: true,  defaultPivot: { x: 0.5, y: 0.5 }, defaultOffset: { x: 0, y: 0 },    defaultRecolorMode: 'none' },
  { id: 'body_base',   name: '基础素体',   category: 'base',      colorable: false, required: true,  defaultPivot: { x: 0.5, y: 0.85 }, defaultOffset: { x: 0, y: -12 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'back_cape',   name: '披风斗篷',   category: 'back',      colorable: true,  required: false, parent: 'body_base', attachSocket: 'back_mount', defaultPivot: { x: 0.5, y: 0.15 }, defaultOffset: { x: 0, y: -64 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'back_prop',   name: '背部挂件',   category: 'back',      colorable: true,  required: false, parent: 'body_base', attachSocket: 'back_mount', defaultPivot: { x: 0.5, y: 0.5 },  defaultOffset: { x: 0, y: -58 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'legs_bottom', name: '下装裤裙',   category: 'clothing',  colorable: true,  required: false, parent: 'body_base', defaultPivot: { x: 0.5, y: 0.2 },  defaultOffset: { x: 0, y: -32 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'feet_shoes',  name: '鞋靴',       category: 'clothing',  colorable: true,  required: false, parent: 'legs_bottom', defaultPivot: { x: 0.5, y: 0.5 }, defaultOffset: { x: 0, y: 24 },  defaultRecolorMode: 'mask_ramp' },
  { id: 'torso_top',   name: '上衣护甲',   category: 'clothing',  colorable: true,  required: false, parent: 'body_base', defaultPivot: { x: 0.5, y: 0.7 },  defaultOffset: { x: 0, y: -44 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'belt_waist',  name: '腰带饰带',   category: 'clothing',  colorable: true,  required: false, parent: 'torso_top', defaultPivot: { x: 0.5, y: 0.5 },  defaultOffset: { x: 0, y: 12 },  defaultRecolorMode: 'mask_ramp' },
  { id: 'back_arm',    name: '远侧手臂',   category: 'limb',      colorable: true,  required: true,  parent: 'body_base', attachSocket: 'shoulder_back', defaultPivot: { x: 0.5, y: 0.15 }, defaultOffset: { x: -24, y: -64 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'off_hand',    name: '副手装备',   category: 'equipment', colorable: true,  required: false, parent: 'back_arm',  attachSocket: 'hand_off',      defaultPivot: { x: 0.5, y: 0.5 },  defaultOffset: { x: 0, y: 30 },    defaultRecolorMode: 'mask_ramp' },
  { id: 'head_base',   name: '头部素体',   category: 'base',      colorable: false, required: true,  parent: 'body_base', attachSocket: 'neck',          defaultPivot: { x: 0.5, y: 0.85 }, defaultOffset: { x: 0, y: -80 },   defaultRecolorMode: 'mask_ramp' },
  { id: 'face_eyes',   name: '五官表情',   category: 'face',      colorable: false, required: false, parent: 'head_base', defaultPivot: { x: 0.5, y: 0.5 },  defaultOffset: { x: 0, y: -14 }, defaultRecolorMode: 'none' },
  { id: 'face_beard',  name: '胡须面饰',   category: 'face',      colorable: true,  required: false, parent: 'head_base', defaultPivot: { x: 0.5, y: 0.5 },  defaultOffset: { x: 0, y: -2 },  defaultRecolorMode: 'mask_ramp' },
  { id: 'hair_style',  name: '发型',       category: 'head',      colorable: true,  required: false, parent: 'head_base', attachSocket: 'head_top',      defaultPivot: { x: 0.5, y: 0.7 },  defaultOffset: { x: 0, y: -20 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'head_hat',    name: '帽子头盔',   category: 'head',      colorable: true,  required: false, parent: 'head_base', attachSocket: 'head_top',      defaultPivot: { x: 0.5, y: 0.75 }, defaultOffset: { x: 0, y: -26 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'front_arm',   name: '近侧手臂',   category: 'limb',      colorable: true,  required: true,  parent: 'body_base', attachSocket: 'shoulder_front', defaultPivot: { x: 0.5, y: 0.15 }, defaultOffset: { x: 24, y: -64 }, defaultRecolorMode: 'mask_ramp' },
  { id: 'main_hand',   name: '主手装备',   category: 'equipment', colorable: true,  required: false, parent: 'front_arm', attachSocket: 'hand_main',      defaultPivot: { x: 0.5, y: 0.8 },  defaultOffset: { x: 0, y: 30 },   defaultRecolorMode: 'mask_ramp' },
];

const FRONT_ORDER = [
  'shadow', 'back_prop', 'back_cape', 'back_arm', 'off_hand',
  'body_base', 'legs_bottom', 'feet_shoes', 'torso_top', 'belt_waist',
  'head_base', 'face_eyes', 'face_beard', 'hair_style', 'head_hat',
  'front_arm', 'main_hand',
];

const SIDE_ORDER = [
  'shadow', 'back_prop', 'back_cape', 'off_hand', 'back_arm',
  'body_base', 'legs_bottom', 'feet_shoes', 'torso_top', 'belt_waist',
  'head_base', 'face_eyes', 'face_beard', 'hair_style', 'head_hat',
  'front_arm', 'main_hand',
];

const BACK_ORDER = [
  'shadow', 'off_hand', 'main_hand', 'front_arm', 'back_arm',
  'body_base', 'legs_bottom', 'feet_shoes', 'torso_top', 'belt_waist',
  'head_base', 'hair_style', 'head_hat', 'back_cape', 'back_prop',
];

export const DEFAULT_ISOMETRIC_Z_ORDER: ZOrderTable = {
  S: [...FRONT_ORDER],
  SE: [...FRONT_ORDER],
  SW: [...FRONT_ORDER],
  E: [...SIDE_ORDER],
  W: [...SIDE_ORDER],
  N: [...BACK_ORDER],
  NE: [...BACK_ORDER],
  NW: [...BACK_ORDER],
};

export const DEFAULT_PALETTES: Record<string, ColorPalette> = {
  crimson: {
    id: 'crimson',
    name: '绯红卫士',
    swatch: '#d63e47',
    primary: rampFromFourHex(['#4a1218', '#99222b', '#d63e47', '#f47b82']),
    secondary: rampFromFourHex(['#4a3412', '#9e7020', '#dfa638', '#fae08c']),
  },
  cobalt: {
    id: 'cobalt',
    name: '钴蓝骑士',
    swatch: '#2e6bd1',
    primary: rampFromFourHex(['#10224a', '#1d4694', '#2e6bd1', '#73a7f5']),
    secondary: rampFromFourHex(['#2c3645', '#64748b', '#94a3b8', '#e2e8f0']),
  },
  emerald: {
    id: 'emerald',
    name: '翡翠游侠',
    swatch: '#29965d',
    primary: rampFromFourHex(['#0e3823', '#1b6640', '#29965d', '#68cf96']),
    secondary: rampFromFourHex(['#3d2514', '#754927', '#a66b3c', '#d49d6a']),
  },
  amber: {
    id: 'amber',
    name: '琥珀商旅',
    swatch: '#d98a1e',
    primary: rampFromFourHex(['#4a2b08', '#995b10', '#d98a1e', '#f7c15e']),
    secondary: rampFromFourHex(['#263d3b', '#3f6965', '#5d9690', '#9fd1cb']),
  },
  violet: {
    id: 'violet',
    name: '紫罗兰法',
    swatch: '#7c47d6',
    primary: rampFromFourHex(['#26124a', '#522999', '#7c47d6', '#b791f7']),
    secondary: rampFromFourHex(['#4a3412', '#a67521', '#e8b343', '#fce49d']),
  },
  obsidian: {
    id: 'obsidian',
    name: '曜石暗影',
    swatch: '#394152',
    primary: rampFromFourHex(['#11141c', '#232836', '#394152', '#64708a']),
    secondary: rampFromFourHex(['#4a1220', '#8f223b', '#cf3c5e', '#f27995']),
  },
  ivory: {
    id: 'ivory',
    name: '象牙圣殿',
    swatch: '#d9d4c7',
    primary: rampFromFourHex(['#3d3a33', '#8c8679', '#d9d4c7', '#f7f5ee']),
    secondary: rampFromFourHex(['#1c3c6e', '#2e61ad', '#4c88e0', '#96c0fa']),
  },
  bronze: {
    id: 'bronze',
    name: '青铜工匠',
    swatch: '#a8653e',
    primary: rampFromFourHex(['#3b2012', '#734125', '#a8653e', '#d69974']),
    secondary: rampFromFourHex(['#262c36', '#4c5769', '#78859c', '#b4c0d4']),
  },
  sakura: {
    id: 'sakura',
    name: '樱粉庆典',
    swatch: '#e06b98',
    primary: rampFromFourHex(['#4d1a2f', '#a33e67', '#e06b98', '#faa7c7']),
    secondary: rampFromFourHex(['#3b3629', '#8c8369', '#e3d9be', '#fcf9f0']),
  },
  frost: {
    id: 'frost',
    name: '冰霜北境',
    swatch: '#3da8c4',
    primary: rampFromFourHex(['#103542', '#226f85', '#3da8c4', '#8fe0f5']),
    secondary: rampFromFourHex(['#293342', '#526582', '#8299ba', '#cfe0f7']),
  },
};

export const DEFAULT_SKINS: Record<string, SkinTone> = {
  wood:   { id: 'wood',   name: '原木素体', swatch: '#cfa06b', ramp: rampFromFourHex(['#4f3319', '#996a3b', '#cfa06b', '#edd0a4']) },
  fair:   { id: 'fair',   name: '暖白肤色', swatch: '#f2c6a0', ramp: rampFromFourHex(['#5c3824', '#c9906b', '#f2c6a0', '#ffe3c9']) },
  tan:    { id: 'tan',    name: '小麦肤色', swatch: '#d69b6b', ramp: rampFromFourHex(['#4d2c16', '#a36b41', '#d69b6b', '#f0bf92']) },
  bronze: { id: 'bronze', name: '古铜肤色', swatch: '#a66b46', ramp: rampFromFourHex(['#3b1f0f', '#78472a', '#a66b46', '#c98e67']) },
  deep:   { id: 'deep',   name: '深棕肤色', swatch: '#6e422b', ramp: rampFromFourHex(['#261209', '#4d2b1a', '#6e422b', '#946146']) },
  elf:    { id: 'elf',    name: '月影精灵', swatch: '#9eb8d6', ramp: rampFromFourHex(['#28364a', '#6c85a6', '#9eb8d6', '#cfe1f5']) },
};

/**
 * Default ARPG isometric cutout animation clips.
 * Drives hierarchical slots smoothly at any FPS (12/24/30/60) and also aligns
 * cleanly with optional multi-frame sequence parts.
 */
export const DEFAULT_ARPG_ANIMATIONS: Record<string, AnimationClip> = {
  idle: {
    id: 'idle',
    label: '待机',
    durationMs: 1200,
    fps: 12,
    loop: true,
    tracks: [
      {
        slotId: 'body_base',
        keyframes: [
          { timeMs: 0, y: 0, scaleY: 1, easing: 'easeInOut' },
          { timeMs: 600, y: 2, scaleY: 0.985, easing: 'easeInOut' },
          { timeMs: 1200, y: 0, scaleY: 1, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'head_base',
        keyframes: [
          { timeMs: 0, y: 0, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 600, y: 1, rotationDeg: 1.5, easing: 'easeInOut' },
          { timeMs: 1200, y: 0, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'front_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 600, rotationDeg: 4, easing: 'easeInOut' },
          { timeMs: 1200, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'back_cape',
        keyframes: [
          { timeMs: 0, rotationDeg: -2, easing: 'easeInOut' },
          { timeMs: 600, rotationDeg: 3, easing: 'easeInOut' },
          { timeMs: 1200, rotationDeg: -2, easing: 'easeInOut' },
        ],
      },
    ],
  },
  walk: {
    id: 'walk',
    label: '行走',
    durationMs: 750,
    fps: 8,
    loop: true,
    tracks: [
      {
        slotId: 'shadow',
        keyframes: [
          { timeMs: 0, scaleX: 1.04, scaleY: 1.0, easing: 'easeInOut' },
          { timeMs: 188, scaleX: 0.88, scaleY: 0.90, easing: 'easeInOut' },
          { timeMs: 375, scaleX: 1.04, scaleY: 1.0, easing: 'easeInOut' },
          { timeMs: 563, scaleX: 0.88, scaleY: 0.90, easing: 'easeInOut' },
          { timeMs: 750, scaleX: 1.04, scaleY: 1.0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'body_base',
        keyframes: [
          { timeMs: 0, y: 0, rotationDeg: -2.2, easing: 'easeInOut' },
          { timeMs: 188, y: -5, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 375, y: 0, rotationDeg: 2.2, easing: 'easeInOut' },
          { timeMs: 563, y: -5, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 750, y: 0, rotationDeg: -2.2, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'head_base',
        keyframes: [
          { timeMs: 0, y: 1, rotationDeg: 2, easing: 'easeInOut' },
          { timeMs: 188, y: -2, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 375, y: 1, rotationDeg: -2, easing: 'easeInOut' },
          { timeMs: 563, y: -2, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 750, y: 1, rotationDeg: 2, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'front_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: -20, easing: 'easeInOut' },
          { timeMs: 375, rotationDeg: 20, easing: 'easeInOut' },
          { timeMs: 750, rotationDeg: -20, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'back_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: 20, easing: 'easeInOut' },
          { timeMs: 375, rotationDeg: -20, easing: 'easeInOut' },
          { timeMs: 750, rotationDeg: 20, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'back_cape',
        keyframes: [
          { timeMs: 0, rotationDeg: -9, easing: 'easeInOut' },
          { timeMs: 375, rotationDeg: 9, easing: 'easeInOut' },
          { timeMs: 750, rotationDeg: -9, easing: 'easeInOut' },
        ],
      },
    ],
  },
  attack: {
    id: 'attack',
    label: '挥击',
    durationMs: 500,
    fps: 16,
    loop: false,
    tracks: [
      {
        slotId: 'body_base',
        keyframes: [
          { timeMs: 0, x: -4, rotationDeg: -8, easing: 'easeInOut' },
          { timeMs: 150, x: -8, rotationDeg: -14, easing: 'easeInOut' },
          { timeMs: 260, x: 10, rotationDeg: 12, easing: 'linear' },
          { timeMs: 500, x: 0, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'front_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: -10, easing: 'easeInOut' },
          { timeMs: 150, rotationDeg: -65, easing: 'easeInOut' },
          { timeMs: 260, rotationDeg: 55, easing: 'linear' },
          { timeMs: 500, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'main_hand',
        keyframes: [
          { timeMs: 0, rotationDeg: 0, zOffset: 0, easing: 'linear' },
          { timeMs: 150, rotationDeg: -25, zOffset: 0, easing: 'linear' },
          { timeMs: 260, rotationDeg: 35, zOffset: 2, easing: 'linear' },
          { timeMs: 500, rotationDeg: 0, zOffset: 0, easing: 'easeInOut' },
        ],
      },
    ],
  },
  cast: {
    id: 'cast',
    label: '施法',
    durationMs: 700,
    fps: 12,
    loop: false,
    tracks: [
      {
        slotId: 'body_base',
        keyframes: [
          { timeMs: 0, y: 0, easing: 'easeInOut' },
          { timeMs: 350, y: -6, easing: 'easeInOut' },
          { timeMs: 700, y: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'front_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 300, rotationDeg: -85, easing: 'easeInOut' },
          { timeMs: 700, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
      {
        slotId: 'back_arm',
        keyframes: [
          { timeMs: 0, rotationDeg: 0, easing: 'easeInOut' },
          { timeMs: 300, rotationDeg: -75, easing: 'easeInOut' },
          { timeMs: 700, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
    ],
  },
  hit: {
    id: 'hit',
    label: '受击',
    durationMs: 320,
    fps: 16,
    loop: false,
    tracks: [
      {
        slotId: 'body_base',
        keyframes: [
          { timeMs: 0, x: 0, rotationDeg: 0, easing: 'linear' },
          { timeMs: 90, x: -10, rotationDeg: -12, easing: 'easeInOut' },
          { timeMs: 320, x: 0, rotationDeg: 0, easing: 'easeInOut' },
        ],
      },
    ],
  },
};

function makePlaceholderFrame(
  imageId: string,
  maskImageId?: string,
  sockets?: SpriteFrameRef['sockets'],
): SpriteFrameRef {
  return {
    imageId,
    sourceRect: { x: 0, y: 0, width: 256, height: 256 },
    originalSize: { width: 256, height: 256 },
    trimOffset: { x: 0, y: 0 },
    pivot: { x: 0.5, y: 0.5 },
    maskImageId,
    sockets,
  };
}

function makePart(
  slotId: string,
  id: string,
  name: string,
  mode: 'rigged' | 'sequence' = 'rigged',
  sockets?: SpriteFrameRef['sockets'],
): PartAsset {
  // Author only 5 canonical Diablo facings; W/SW/NW resolve via mirrorFrom!
  const canonicalDirs = ['S', 'SE', 'E', 'NE', 'N'];
  const directions: PartAsset['directions'] = {};
  for (const d of canonicalDirs) {
    const baseFrame = makePlaceholderFrame(`${slotId}/${id}_${d}.png`, `${slotId}/${id}_${d}_mask.png`, sockets);
    if (mode === 'sequence') {
      directions[d] = {
        mode: 'sequence',
        frames: [baseFrame],
        actionFrames: {
          walk: [0, 1, 2, 3].map((idx) =>
            makePlaceholderFrame(
              `${slotId}/${id}_${d}_walk_${idx}.png`,
              `${slotId}/${id}_${d}_walk_${idx}_mask.png`,
              sockets,
            ),
          ),
        },
        fps: 12,
      };
    } else {
      directions[d] = {
        mode: 'rigged',
        frames: [baseFrame],
      };
    }
  }
  return { id, name, slotId, directions };
}

/**
 * Builds a complete, schema-valid HD Diablo-isometric starter AssetPackManifest
 * demonstrating both rigged parts and hybrid sequence parts with socket attachment.
 */
export function createStarterIsometricPack(): AssetPackManifest {
  const parts: Record<string, PartAsset[]> = {
    shadow: [makePart('shadow', 'oval', '椭圆投影')],
    body_base: [
      makePart('body_base', 'hero_body', '标准素体', 'sequence', {
        neck: { x: 0, y: -78 },
        shoulder_front: { x: 22, y: -62 },
        shoulder_back: { x: -22, y: -62 },
        back_mount: { x: 0, y: -60 },
      }),
    ],
    back_cape: [makePart('back_cape', 'cloak_long', '长斗篷')],
    back_prop: [makePart('back_prop', 'quiver', '箭袋')],
    legs_bottom: [makePart('legs_bottom', 'greaves', '重甲护腿', 'sequence')],
    feet_shoes: [makePart('feet_shoes', 'sabaton', '铁甲靴')],
    torso_top: [makePart('torso_top', 'plate_cuirass', '板甲胸铠')],
    belt_waist: [makePart('belt_waist', 'gold_belt', '圣徽腰带')],
    back_arm: [
      makePart('back_arm', 'armor_sleeve', '臂铠护腕', 'rigged', {
        hand_off: { x: -4, y: 32, rotationDeg: 5 },
      }),
    ],
    off_hand: [makePart('off_hand', 'kite_shield', '纹章盾')],
    head_base: [
      makePart('head_base', 'hero_head', '标准头型', 'rigged', {
        head_top: { x: 0, y: -24 },
      }),
    ],
    face_eyes: [makePart('face_eyes', 'sharp', '坚毅目光')],
    face_beard: [makePart('face_beard', 'full_beard', '络腮大胡')],
    hair_style: [makePart('hair_style', 'short', '短碎发')],
    head_hat: [makePart('head_hat', 'knight_helm', '骑士头盔')],
    front_arm: [
      makePart('front_arm', 'armor_sleeve', '臂铠护腕', 'rigged', {
        hand_main: { x: 4, y: 32, rotationDeg: -10 },
      }),
    ],
    main_hand: [makePart('main_hand', 'broadsword', '骑士长剑')],
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'starter-isometric-hd',
    name: 'Diablo-Style Isometric HD Starter Pack',
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
        name: '01 · 钴蓝骑士',
        tag: '重甲坦克',
        skin: 'fair',
        slots: {
          shadow: 'oval',
          body_base: 'hero_body',
          back_cape: 'cloak_long',
          back_prop: 'none',
          legs_bottom: 'greaves',
          feet_shoes: 'sabaton',
          torso_top: 'plate_cuirass',
          belt_waist: 'gold_belt',
          back_arm: 'armor_sleeve',
          off_hand: 'kite_shield',
          head_base: 'hero_head',
          face_eyes: 'sharp',
          face_beard: 'none',
          hair_style: 'short',
          head_hat: 'knight_helm',
          front_arm: 'armor_sleeve',
          main_hand: 'broadsword',
        },
        palettes: {
          back_cape: 'crimson',
          legs_bottom: 'cobalt',
          feet_shoes: 'cobalt',
          torso_top: 'cobalt',
          belt_waist: 'amber',
          back_arm: 'cobalt',
          off_hand: 'cobalt',
          hair_style: 'amber',
          head_hat: 'cobalt',
          front_arm: 'cobalt',
          main_hand: 'frost',
        },
      },
    ],
  };
}
