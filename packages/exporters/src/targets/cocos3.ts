import { packZip } from '../codec/zip.js';
import type {
  BakedAnimationSequence,
  BakedExportData,
  Cocos3ExportOptions,
  ExportBundle,
} from '../types.js';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a TexturePacker / Cocos2d Format-2 XML `.plist` natively imported
 * by Cocos Creator 3.x as a `SpriteAtlas` with trimmed `SpriteFrame` offsets.
 */
export function buildCocosPlist(baked: BakedExportData, atlasFilename: string): string {
  const frameEntries = baked.atlas.sprites.map((sp) => {
    const { x, y, width, height } = sp.rect;
    const { x: trimX, y: trimY } = sp.trimOffset;
    const { width: origW, height: origH } = sp.sourceSize;

    // Cocos2d uses Y-up offset from untrimmed frame center to trimmed sprite center
    const offsetX = Math.round((trimX + width * 0.5 - origW * 0.5) * 100) / 100;
    const offsetY = Math.round((origH * 0.5 - (trimY + height * 0.5)) * 100) / 100;

    return [
      `      <key>${escapeXml(sp.id)}</key>`,
      '      <dict>',
      '        <key>frame</key>',
      `        <string>{{${x},${y}},{${width},${height}}}</string>`,
      '        <key>offset</key>',
      `        <string>{${offsetX},${offsetY}}</string>`,
      '        <key>rotated</key>',
      '        <false/>',
      '        <key>sourceColorRect</key>',
      `        <string>{{${trimX},${trimY}},{${width},${height}}}</string>`,
      '        <key>sourceSize</key>',
      `        <string>{${origW},${origH}}</string>`,
      '      </dict>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    '    <key>frames</key>',
    '    <dict>',
    frameEntries.join('\n'),
    '    </dict>',
    '    <key>metadata</key>',
    '    <dict>',
    '      <key>format</key>',
    '      <integer>2</integer>',
    '      <key>realTextureFileName</key>',
    `      <string>${escapeXml(atlasFilename)}</string>`,
    '      <key>size</key>',
    `      <string>{${baked.atlas.image.width},${baked.atlas.image.height}}</string>`,
    '      <key>smartupdate</key>',
    '      <string>$PaperDollKit:v2.0.0$</string>',
    '      <key>textureFileName</key>',
    `      <string>${escapeXml(atlasFilename)}</string>`,
    '    </dict>',
    '  </dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * Generates a Cocos Creator 3.x `cc.AnimationClip` JSON file for an individual
 * animation sequence, preserving exact sample rate, wrapMode, and frame timestamps.
 */
function buildCocosAnimClipJson(
  characterName: string,
  anim: BakedAnimationSequence,
): string {
  const duration = Number((anim.frameIds.length / Math.max(1, anim.fps)).toFixed(4));
  const times = anim.frameIds.map((_, idx) =>
    Number((idx / Math.max(1, anim.fps)).toFixed(4)),
  );
  // Cocos AnimationClip wrapMode: 1 = Normal, 2 = Loop
  const wrapMode = anim.loop ? 2 : 1;

  const clipPayload = [
    {
      __type__: 'cc.AnimationClip',
      _name: `${characterName}_${anim.name}`,
      _objFlags: 0,
      _native: '',
      sample: anim.fps,
      speed: 1,
      wrapMode,
      enableTrsBlending: false,
      _duration: duration,
      _hash: 0,
      _tracks: [{ __id__: 1 }],
      _exoticAnimation: null,
      _events: [],
    },
    {
      __type__: 'cc.animation.ObjectTrack',
      _binding: {
        __type__: 'cc.animation.TrackBinding',
        path: { __id__: 2 },
      },
      _channel: { __id__: 3 },
    },
    {
      __type__: 'cc.animation.TrackPath',
      _paths: [
        { __type__: 'cc.animation.ComponentPath', component: 'cc.Sprite' },
        'spriteFrame',
      ],
    },
    {
      __type__: 'cc.animation.Channel',
      _curve: { __id__: 4 },
    },
    {
      __type__: 'cc.ObjectCurve',
      _times: times,
      // Frame keys match SpriteFrame names inside the companion `.plist` SpriteAtlas
      _values: anim.frameIds.map((fid) => ({
        __paperdoll_frame__: fid.replace(/\.png$/i, ''),
      })),
    },
  ];

  return JSON.stringify(clipPayload, null, 2);
}

function buildCocosManifestJson(baked: BakedExportData, atlasBase: string): string {
  const anchorY = Number(
    (1 - baked.footAnchor.y / Math.max(1, baked.frameSize.height)).toFixed(4),
  );
  return JSON.stringify(
    {
      schemaVersion: '2.0.0',
      engine: 'cocos-creator-3.x',
      characterName: baked.characterName,
      atlas: `${atlasBase}.plist`,
      texture: `${atlasBase}.png`,
      frameSize: baked.frameSize,
      recommendedAnchor: { x: 0.5, y: anchorY },
      animations: Object.fromEntries(
        baked.animations.map((a) => [
          a.name,
          {
            action: a.actionId,
            direction: a.directionId,
            fps: a.fps,
            loop: a.loop,
            frames: a.frameIds.map((fid) => fid.replace(/\.png$/i, '')),
          },
        ]),
      ),
    },
    null,
    2,
  );
}

function buildCocosRuntimePlayerTs(baked: BakedExportData): string {
  const first = baked.animations[0];
  return `import { _decorator, Component, JsonAsset, Sprite, SpriteAtlas } from 'cc';
const { ccclass, property, requireComponent } = _decorator;

interface BakedAnimEntry {
  action: string;
  direction: string;
  fps: number;
  loop: boolean;
  frames: string[];
}

interface BakedManifest {
  recommendedAnchor?: { x: number; y: number };
  animations: Record<string, BakedAnimEntry>;
}

/**
 * Drop-in Cocos Creator 3.x Baked Paper-Doll Player.
 * Bind the exported \`.plist\` SpriteAtlas and \`_manifest.json\` JsonAsset in the Inspector,
 * then call \`player.play('walk', 'SE')\`.
 */
@ccclass('PaperDollBakedPlayer')
@requireComponent(Sprite)
export class PaperDollBakedPlayer extends Component {
  @property(SpriteAtlas)
  atlas: SpriteAtlas | null = null;

  @property(JsonAsset)
  manifestAsset: JsonAsset | null = null;

  @property
  defaultAction = '${first?.actionId ?? 'idle'}';

  @property
  defaultDirection = '${first?.directionId ?? 'SE'}';

  private sprite: Sprite | null = null;
  private manifest: BakedManifest | null = null;
  private currentAnim: BakedAnimEntry | null = null;
  private elapsed = 0;
  private lastFrameIdx = -1;

  onLoad() {
    this.sprite = this.getComponent(Sprite);
    if (this.manifestAsset?.json) {
      this.manifest = this.manifestAsset.json as BakedManifest;
    }
    this.play(this.defaultAction, this.defaultDirection);
  }

  play(action: string, direction: string) {
    if (!this.manifest) return;
    const key = \`\${action}_\${direction}\`;
    const next = this.manifest.animations[key];
    if (!next || this.currentAnim === next) return;
    this.currentAnim = next;
    this.elapsed = 0;
    this.lastFrameIdx = -1;
    this.applyFrame(0);
  }

  update(dt: number) {
    if (!this.currentAnim || this.currentAnim.frames.length === 0) return;
    this.elapsed += dt;
    const rawIdx = Math.floor(this.elapsed * Math.max(1, this.currentAnim.fps));
    const idx = this.currentAnim.loop
      ? rawIdx % this.currentAnim.frames.length
      : Math.min(this.currentAnim.frames.length - 1, rawIdx);
    if (idx !== this.lastFrameIdx) {
      this.applyFrame(idx);
    }
  }

  private applyFrame(idx: number) {
    if (!this.sprite || !this.atlas || !this.currentAnim) return;
    const frameName = this.currentAnim.frames[idx];
    if (!frameName) return;
    const sf = this.atlas.getSpriteFrame(frameName);
    if (sf) {
      this.sprite.spriteFrame = sf;
      this.lastFrameIdx = idx;
    }
  }
}
`;
}

function buildCocosReadme(baked: BakedExportData): string {
  const animList = baked.animations.map((a) => `- \`${a.name}\` (${a.frameIds.length} frames @ ${a.fps} fps, loop=${a.loop})`).join('\n');
  return `# ${baked.characterName} — Cocos Creator 3.x Baked SpriteAtlas Export

Generated by **PaperDollKit v2** (Mode A: High-Performance Single-Sprite Baked Atlas).

## Quick Import (3 Steps)
1. Drag this folder into \`assets/characters/\` inside Cocos Creator 3.x.
2. Cocos automatically parses \`${baked.characterName}_atlas.plist\` into a \`SpriteAtlas\` containing all trimmed \`SpriteFrame\`s.
3. Attach \`PaperDollBakedPlayer.ts\` to a Node with \`cc.Sprite\`, assign \`atlas\` (\`${baked.characterName}_atlas.plist\`) and \`manifestAsset\` (\`${baked.characterName}_manifest.json\`), and call:
   \`\`\`ts
   player.play('walk', 'SE');
   \`\`\`

> Note: \`animations/*.anim\` clip blueprints are also included for Animation Editor inspection.

## Included Animations (${baked.animations.length})
${animList}
`;
}

/**
 * Generates a complete Cocos Creator 3.x Baked SpriteAtlas bundle (`.png`, `.plist`,
 * `_manifest.json`, `animations/*.anim`, `PaperDollBakedPlayer.ts`, `README_COCOS3.md`)
 * and packages it into a ZIP archive.
 */
export function exportCocos3BakedBundle(
  baked: BakedExportData,
  opts: Cocos3ExportOptions = {},
): ExportBundle {
  const name = baked.characterName;
  const folder = opts.folderName ?? name;
  const atlasBase = `${name}_atlas`;

  const files: Record<string, Uint8Array | string> = {
    [`${folder}/${atlasBase}.png`]: baked.atlas.png,
    [`${folder}/${atlasBase}.plist`]: buildCocosPlist(baked, `${atlasBase}.png`),
    [`${folder}/${name}_manifest.json`]: buildCocosManifestJson(baked, atlasBase),
    [`${folder}/PaperDollBakedPlayer.ts`]: buildCocosRuntimePlayerTs(baked),
    [`${folder}/README_COCOS3.md`]: buildCocosReadme(baked),
  };

  for (const anim of baked.animations) {
    files[`${folder}/animations/${name}_${anim.name}.anim`] = buildCocosAnimClipJson(name, anim);
  }

  return {
    files,
    zip: packZip(files),
    zipFilename: `${name}_cocos3.zip`,
  };
}
