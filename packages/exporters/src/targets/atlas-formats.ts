import { packZip } from '../codec/zip.js';
import type { BakedExportData, ExportBundle } from '../types.js';

/**
 * Generates TexturePacker / PixiJS / Phaser 3 JSON Hash atlas metadata
 * with a ready-to-use `animations` map.
 */
export function buildTexturePackerJsonHash(
  baked: BakedExportData,
  atlasFilename: string,
): string {
  const frames: Record<string, unknown> = {};
  for (const sp of baked.atlas.sprites) {
    frames[sp.id] = {
      frame: { x: sp.rect.x, y: sp.rect.y, w: sp.rect.width, h: sp.rect.height },
      rotated: false,
      trimmed:
        sp.rect.width !== sp.sourceSize.width ||
        sp.rect.height !== sp.sourceSize.height,
      spriteSourceSize: {
        x: sp.trimOffset.x,
        y: sp.trimOffset.y,
        w: sp.rect.width,
        h: sp.rect.height,
      },
      sourceSize: { w: sp.sourceSize.width, h: sp.sourceSize.height },
      pivot: {
        x: Number((baked.footAnchor.x / Math.max(1, baked.frameSize.width)).toFixed(4)),
        y: Number((baked.footAnchor.y / Math.max(1, baked.frameSize.height)).toFixed(4)),
      },
    };
  }

  const animations: Record<string, string[]> = {};
  for (const anim of baked.animations) {
    animations[anim.name] = [...anim.frameIds];
  }

  return JSON.stringify(
    {
      frames,
      animations,
      meta: {
        app: 'PaperDollKit v2',
        version: '2.0.0',
        image: atlasFilename,
        format: 'RGBA8888',
        size: { w: baked.atlas.image.width, h: baked.atlas.image.height },
        scale: '1',
      },
    },
    null,
    2,
  );
}

/**
 * Generates an Aseprite-compatible JSON Hash atlas with `meta.frameTags`
 * mapping each `<action>_<dir>` sequence to its exact frame index range and duration.
 */
export function buildAsepriteJson(
  baked: BakedExportData,
  atlasFilename: string,
): string {
  const spriteById = new Map(baked.atlas.sprites.map((s) => [s.id, s]));
  const frames: Record<string, unknown> = {};
  const frameTags: Array<{
    name: string;
    from: number;
    to: number;
    direction: 'forward';
  }> = [];

  let cursor = 0;
  for (const anim of baked.animations) {
    const startIdx = cursor;
    const frameDurationMs = Math.round(1000 / Math.max(1, anim.fps));
    for (let i = 0; i < anim.frameIds.length; i++) {
      const fid = anim.frameIds[i]!;
      const sp = spriteById.get(fid);
      if (!sp) continue;
      const key = `${baked.characterName}_${anim.name} ${i}.aseprite`;
      frames[key] = {
        frame: { x: sp.rect.x, y: sp.rect.y, w: sp.rect.width, h: sp.rect.height },
        rotated: false,
        trimmed:
          sp.rect.width !== sp.sourceSize.width ||
          sp.rect.height !== sp.sourceSize.height,
        spriteSourceSize: {
          x: sp.trimOffset.x,
          y: sp.trimOffset.y,
          w: sp.rect.width,
          h: sp.rect.height,
        },
        sourceSize: { w: sp.sourceSize.width, h: sp.sourceSize.height },
        duration: frameDurationMs,
      };
      cursor++;
    }
    if (cursor > startIdx) {
      frameTags.push({
        name: anim.name,
        from: startIdx,
        to: cursor - 1,
        direction: 'forward',
      });
    }
  }

  return JSON.stringify(
    {
      frames,
      meta: {
        app: 'PaperDollKit v2',
        version: '2.0.0',
        image: atlasFilename,
        format: 'RGBA8888',
        size: { w: baked.atlas.image.width, h: baked.atlas.image.height },
        scale: '1',
        frameTags,
      },
    },
    null,
    2,
  );
}

function deterministicHex32(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${part(h1)}${part(h2)}${part(h1 ^ 0xa5a5a5a5)}${part(h2 ^ 0x5a5a5a5a)}`;
}

/**
 * Generates a Unity 2D pre-sliced `.png.meta` YAML file (`spriteMode: 2`)
 * with Y-up sprite rectangles and foot-aligned pivots ready to drop into Unity `Assets/`.
 */
export function buildUnityPngMeta(
  baked: BakedExportData,
  atlasFilename: string,
  pixelsPerUnit = 100,
): string {
  const atlasH = baked.atlas.image.height;
  const guid = deterministicHex32(`unity-atlas:${baked.characterName}:${atlasFilename}`);

  const spriteBlocks = baked.atlas.sprites.map((sp) => {
    const name = sp.id.replace(/\.png$/i, '');
    // Unity sprite rect uses bottom-left Y-up coordinates
    const unityY = atlasH - sp.rect.y - sp.rect.height;
    // Foot anchor expressed relative to trimmed sprite rect (0..1, bottom-left origin)
    const footLocalX = baked.footAnchor.x - sp.trimOffset.x;
    const footLocalYFromBottom = sp.rect.height - (baked.footAnchor.y - sp.trimOffset.y);
    const pivotX = Number((footLocalX / Math.max(1, sp.rect.width)).toFixed(4));
    const pivotY = Number((footLocalYFromBottom / Math.max(1, sp.rect.height)).toFixed(4));
    const spriteId = deterministicHex32(`unity-sprite:${name}`);

    return [
      '    - serializedVersion: 2',
      `      name: ${name}`,
      '      rect:',
      '        serializedVersion: 2',
      `        x: ${sp.rect.x}`,
      `        y: ${unityY}`,
      `        width: ${sp.rect.width}`,
      `        height: ${sp.rect.height}`,
      '      alignment: 9',
      `      pivot: {x: ${pivotX}, y: ${pivotY}}`,
      '      border: {x: 0, y: 0, z: 0, w: 0}',
      '      outline: []',
      '      physicsShape: []',
      '      tessellationDetail: 0',
      '      bones: []',
      `      spriteID: ${spriteId}`,
      '      internalID: 0',
      '      vertices: []',
      '      indices: ',
      '      edges: []',
      '      weights: []',
    ].join('\n');
  });

  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'TextureImporter:',
    '  internalIDToNameTable: []',
    '  externalObjects: {}',
    '  serializedVersion: 12',
    '  mipmaps:',
    '    enableMipMap: 0',
    '  textureType: 8',
    '  spriteMode: 2',
    `  spritePixelsToUnits: ${pixelsPerUnit}`,
    '  alphaIsTransparency: 1',
    '  filterMode: 1',
    '  textureCompression: 0',
    '  spriteSheet:',
    '    serializedVersion: 2',
    '    sprites:',
    spriteBlocks.join('\n'),
    '',
  ].join('\n');
}

/**
 * Exports a universal multi-engine atlas ZIP bundle containing:
 * - `{name}_atlas.png`
 * - `{name}_atlas.png.meta` (Unity 2D pre-sliced SpriteSheet)
 * - `{name}_texturepacker.json` (Phaser 3 / PixiJS / TexturePacker JSON Hash)
 * - `{name}_aseprite.json` (Aseprite JSON with `frameTags`)
 */
export function exportUniversalAtlasBundle(
  baked: BakedExportData,
  opts: { pixelsPerUnit?: number } = {},
): ExportBundle {
  const folder = baked.characterName;
  const atlasFilename = `${baked.characterName}_atlas.png`;
  const files: Record<string, Uint8Array | string> = {
    [`${folder}/${atlasFilename}`]: baked.atlas.png,
    [`${folder}/${atlasFilename}.meta`]: buildUnityPngMeta(
      baked,
      atlasFilename,
      opts.pixelsPerUnit ?? 100,
    ),
    [`${folder}/${baked.characterName}_texturepacker.json`]: buildTexturePackerJsonHash(
      baked,
      atlasFilename,
    ),
    [`${folder}/${baked.characterName}_aseprite.json`]: buildAsepriteJson(
      baked,
      atlasFilename,
    ),
    [`${folder}/README_UNIVERSAL_ATLAS.md`]: `# ${baked.characterName} — Universal Multi-Engine Atlas

由 **PaperDollKit v2** 导出的通用图集包（${baked.atlas.sprites.length} 帧，${baked.atlas.image.width}×${baked.atlas.image.height}）：

- **Unity 2D**：将 \`${atlasFilename}\` 与 \`${atlasFilename}.meta\` 一起拖入 \`Assets/\`，已预切分多精灵并对齐脚底 Pivot。
- **Phaser 3 / PixiJS / TexturePacker**：加载 \`${baked.characterName}_texturepacker.json\`（含 \`animations\` 帧序列）。
- **Aseprite / Godot Aseprite 插件**：加载 \`${baked.characterName}_aseprite.json\`（含 \`meta.frameTags\` 动画标签）。
`,
  };

  return {
    files,
    zip: packZip(files),
    zipFilename: `${baked.characterName}_universal_atlas.zip`,
  };
}
