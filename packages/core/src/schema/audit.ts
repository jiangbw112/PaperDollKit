import type {
  AssetPackManifest,
  PartAsset,
  SlotId,
  SpriteFrameRef,
} from './types.js';

export interface AuditImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface AuditImageLookup {
  get(id: string): AuditImageLike | undefined;
}

export type AuditSeverity = 'error' | 'warning';

export interface AssetAuditIssue {
  severity: AuditSeverity;
  code:
    | 'MISSING_DIRECTION'
    | 'EMPTY_FRAMES'
    | 'INVALID_RECT'
    | 'OVERSIZED_FRAME'
    | 'MISSING_IMAGE'
    | 'MASK_ALPHA_NOT_OPAQUE'
    | 'MASK_EMPTY_WEIGHTS'
    | 'INVALID_RULE_TARGET';
  slotId: SlotId;
  partId: string;
  message: string;
}

export interface AssetAuditReport {
  /** True when zero 'error' issues were found (warnings do not fail). */
  ok: boolean;
  checkedParts: number;
  errorCount: number;
  warningCount: number;
  issues: AssetAuditIssue[];
}

function inspectMaskPixels(
  img: AuditImageLike,
  rect: { x: number; y: number; width: number; height: number },
): { hasTransparentWeight: boolean; hasAnyWeight: boolean } {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  // Stride for fast auditing on large HD textures while remaining thorough on 256x256
  const step = area > 65536 ? 2 : 1;

  let hasTransparentWeight = false;
  let hasAnyWeight = false;

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i] ?? 0;
      const g = img.data[i + 1] ?? 0;
      const b = img.data[i + 2] ?? 0;
      const a = img.data[i + 3] ?? 255;
      if (r > 4 || g > 4 || b > 4) {
        hasAnyWeight = true;
        if (a < 250) {
          hasTransparentWeight = true;
          return { hasTransparentWeight, hasAnyWeight };
        }
      }
    }
  }
  return { hasTransparentWeight, hasAnyWeight };
}

function auditFrame(
  frame: SpriteFrameRef,
  part: PartAsset,
  pack: AssetPackManifest,
  images: AuditImageLookup | undefined,
  issues: AssetAuditIssue[],
  checkedMaskKeys: Set<string>,
): void {
  const { sourceRect, originalSize } = frame;
  if (sourceRect.width <= 0 || sourceRect.height <= 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_RECT',
      slotId: part.slotId,
      partId: part.id,
      message: `帧 "${frame.imageId}" 的 sourceRect 宽高必须大于 0。`,
    });
    return;
  }

  if (
    originalSize.width > pack.canvasSize.width * 2 ||
    originalSize.height > pack.canvasSize.height * 2
  ) {
    issues.push({
      severity: 'warning',
      code: 'OVERSIZED_FRAME',
      slotId: part.slotId,
      partId: part.id,
      message: `帧尺寸 ${originalSize.width}×${originalSize.height} 超过基准画布 (${pack.canvasSize.width}×${pack.canvasSize.height}) 的 2 倍。`,
    });
  }

  if (!images) return;

  const albedo = images.get(frame.imageId);
  if (!albedo) {
    issues.push({
      severity: 'error',
      code: 'MISSING_IMAGE',
      slotId: part.slotId,
      partId: part.id,
      message: `找不到底图资源 "${frame.imageId}"。`,
    });
  } else if (
    sourceRect.x < 0 ||
    sourceRect.y < 0 ||
    sourceRect.x + sourceRect.width > albedo.width ||
    sourceRect.y + sourceRect.height > albedo.height
  ) {
    issues.push({
      severity: 'error',
      code: 'INVALID_RECT',
      slotId: part.slotId,
      partId: part.id,
      message: `底图 "${frame.imageId}" 的裁切区域超出图片边界 (${albedo.width}×${albedo.height})。`,
    });
  }

  if (frame.maskImageId) {
    const maskImg = images.get(frame.maskImageId);
    const mRect = frame.maskRect ?? sourceRect;
    if (!maskImg) {
      issues.push({
        severity: 'error',
        code: 'MISSING_IMAGE',
        slotId: part.slotId,
        partId: part.id,
        message: `找不到语义遮罩图 "${frame.maskImageId}"。`,
      });
    } else if (
      mRect.x < 0 ||
      mRect.y < 0 ||
      mRect.x + mRect.width > maskImg.width ||
      mRect.y + mRect.height > maskImg.height
    ) {
      issues.push({
        severity: 'error',
        code: 'INVALID_RECT',
        slotId: part.slotId,
        partId: part.id,
        message: `遮罩图 "${frame.maskImageId}" 的裁切区域超出图片边界 (${maskImg.width}×${maskImg.height})。`,
      });
    } else {
      const cacheKey = `${frame.maskImageId}:${mRect.x},${mRect.y},${mRect.width},${mRect.height}`;
      if (!checkedMaskKeys.has(cacheKey)) {
        checkedMaskKeys.add(cacheKey);
        const { hasTransparentWeight, hasAnyWeight } = inspectMaskPixels(maskImg, mRect);
        if (hasTransparentWeight) {
          issues.push({
            severity: 'error',
            code: 'MASK_ALPHA_NOT_OPAQUE',
            slotId: part.slotId,
            partId: part.id,
            message: `遮罩 "${frame.maskImageId}" 含有半透明 Alpha (<250) 的 RGB 权重像素，可能被预乘破坏，请将 Mask 存为不透明 (A=255)。`,
          });
        } else if (!hasAnyWeight && (part.recolorMode ?? 'mask_ramp') === 'mask_ramp') {
          issues.push({
            severity: 'warning',
            code: 'MASK_EMPTY_WEIGHTS',
            slotId: part.slotId,
            partId: part.id,
            message: `遮罩 "${frame.maskImageId}" 的 R/G/B 通道全为空，换色将不会生效。`,
          });
        }
      }
    }
  }
}

/**
 * Audits a single PartAsset against canonical PaperDollKit v2 art/technical constraints:
 * 1. Canonical non-mirrored direction coverage (e.g. S/SE/E/NE/N)
 * 2. Frame dimensions & sourceRect bounds
 * 3. Mask PNG opaque-alpha (A=255) contract & non-empty RGB weights
 * 4. PartRules target slot/part existence
 */
export function auditPartAsset(
  part: PartAsset,
  pack: AssetPackManifest,
  images?: AuditImageLookup,
): AssetAuditIssue[] {
  const issues: AssetAuditIssue[] = [];
  const checkedMaskKeys = new Set<string>();

  const canonicalDirs = pack.directions.filter((d) => !d.mirrorFrom);
  const missingDirs: string[] = [];

  for (const dir of canonicalDirs) {
    const visual = part.directions[dir.id];
    if (!visual) {
      missingDirs.push(dir.id);
      continue;
    }
    if (visual.frames.length === 0) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_FRAMES',
        slotId: part.slotId,
        partId: part.id,
        message: `朝向 "${dir.id}" 的 frames 数组为空。`,
      });
      continue;
    }
    for (const f of visual.frames) {
      auditFrame(f, part, pack, images, issues, checkedMaskKeys);
    }
    if (visual.actionFrames) {
      for (const seq of Object.values(visual.actionFrames)) {
        for (const f of seq) {
          auditFrame(f, part, pack, images, issues, checkedMaskKeys);
        }
      }
    }
  }

  if (missingDirs.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_DIRECTION',
      slotId: part.slotId,
      partId: part.id,
      message: `缺少 ${missingDirs.length} 个标准朝向（${missingDirs.join('/')}），转向这些角度时该部件不会显示。`,
    });
  }

  // Validate PartRules targets
  const slotIds = new Set(pack.slots.map((s) => s.id));
  for (const targetSlot of part.rules?.hidesSlots ?? []) {
    if (!slotIds.has(targetSlot) || targetSlot === part.slotId) {
      issues.push({
        severity: 'error',
        code: 'INVALID_RULE_TARGET',
        slotId: part.slotId,
        partId: part.id,
        message: `rules.hidesSlots 目标槽位 "${targetSlot}" 无效。`,
      });
    }
  }
  for (const [targetSlot, replId] of Object.entries(part.rules?.overrideSlots ?? {})) {
    if (!slotIds.has(targetSlot) || targetSlot === part.slotId) {
      issues.push({
        severity: 'error',
        code: 'INVALID_RULE_TARGET',
        slotId: part.slotId,
        partId: part.id,
        message: `rules.overrideSlots 目标槽位 "${targetSlot}" 无效。`,
      });
    } else if (replId !== 'none' && !pack.parts[targetSlot]?.some((p) => p.id === replId)) {
      issues.push({
        severity: 'warning',
        code: 'INVALID_RULE_TARGET',
        slotId: part.slotId,
        partId: part.id,
        message: `rules.overrideSlots["${targetSlot}"] 指向的替换部件 "${replId}" 不存在。`,
      });
    }
  }

  return issues;
}

/**
 * Audits all parts in an AssetPackManifest and returns a structured report.
 */
export function auditAssetPack(
  pack: AssetPackManifest,
  images?: AuditImageLookup,
): AssetAuditReport {
  const issues: AssetAuditIssue[] = [];
  let checkedParts = 0;

  for (const slot of pack.slots) {
    const list = pack.parts[slot.id] ?? [];
    for (const part of list) {
      checkedParts++;
      issues.push(...auditPartAsset(part, pack, images));
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount++;
    else warningCount++;
  }

  return {
    ok: errorCount === 0,
    checkedParts,
    errorCount,
    warningCount,
    issues,
  };
}
