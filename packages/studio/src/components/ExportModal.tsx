import type { AssetPackManifest, CharacterConfig, DirectionId } from '@paperdollkit/core';
import {
  bakeCharacterSequences,
  bakeFrameCPU,
  exportCocos3BakedBundle,
  exportDualEngineBakedBundle,
  exportGodot4BakedBundle,
  type BakedExportData,
  type ExportBundle,
  type FrameRasterizer,
} from '@paperdollkit/exporters';
import type { ImportedImage } from '@paperdollkit/importers';
import { WebGL2PaperDollRenderer } from '@paperdollkit/renderer-webgl2';
import { Check, Download, Package, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type ExportTarget = 'godot4' | 'cocos3' | 'dual';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  pack: AssetPackManifest;
  config: CharacterConfig;
  images: Map<string, ImportedImage>;
}

function downloadBinaryFile(filename: string, bytes: Uint8Array, mime = 'application/zip') {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Creates a reusable offscreen WebGL2 rasterizer for instant GPU sequence baking. */
function createGpuFrameRasterizer(width: number, height: number): {
  rasterizer: FrameRasterizer;
  dispose: () => void;
} {
  try {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const renderer = new WebGL2PaperDollRenderer(offCanvas);
    return {
      rasterizer: (pack, frame, imgs, w, h) => {
        if (offCanvas.width !== w || offCanvas.height !== h) {
          offCanvas.width = w;
          offCanvas.height = h;
        }
        const zoom = Math.min(w / pack.canvasSize.width, h / pack.canvasSize.height);
        renderer.render(pack, frame, imgs, {
          clearColor: [0, 0, 0, 0],
          zoom,
          panX: 0,
          panY: 0,
        });
        return renderer.readPixelsTopDown();
      },
      dispose: () => renderer.dispose(),
    };
  } catch {
    return {
      rasterizer: bakeFrameCPU,
      dispose: () => {},
    };
  }
}

export function ExportModal({
  open,
  onClose,
  pack,
  config,
  images,
}: ExportModalProps) {
  const [target, setTarget] = useState<ExportTarget>('dual');
  const [characterName, setCharacterName] = useState('chibi_knight');
  const [frameResolution, setFrameResolution] = useState<number>(256);
  const [selectedDirs, setSelectedDirs] = useState<DirectionId[]>(() =>
    pack.directions.map((d) => d.id),
  );
  const [selectedActions, setSelectedActions] = useState<string[]>(['idle', 'walk', 'attack']);
  const [trimTransparent, setTrimTransparent] = useState(true);
  const [powerOfTwo, setPowerOfTwo] = useState(false);
  const [padding, setPadding] = useState(2);
  const [godotResPath, setGodotResPath] = useState('res://assets/characters/chibi_knight');

  const [isBaking, setIsBaking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    baked: BakedExportData;
    bundle: ExportBundle;
    atlasPreviewUrl: string;
    durationMs: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (result?.atlasPreviewUrl) URL.revokeObjectURL(result.atlasPreviewUrl);
    };
  }, [result]);

  useEffect(() => {
    setGodotResPath(`res://assets/characters/${characterName || 'hero'}`);
  }, [characterName]);

  const estimatedFrames = useMemo(() => {
    let perDir = 0;
    for (const actId of selectedActions) {
      const clip = pack.animations[actId];
      if (!clip) continue;
      perDir += Math.max(1, Math.round((clip.durationMs / 1000) * clip.fps));
    }
    return perDir * selectedDirs.length;
  }, [pack.animations, selectedActions, selectedDirs]);

  if (!open) return null;

  const toggleDir = (id: DirectionId) => {
    setSelectedDirs((prev) =>
      prev.includes(id)
        ? prev.length > 1
          ? prev.filter((d) => d !== id)
          : prev
        : [...prev, id],
    );
  };

  const toggleAction = (id: string) => {
    setSelectedActions((prev) =>
      prev.includes(id)
        ? prev.length > 1
          ? prev.filter((a) => a !== id)
          : prev
        : [...prev, id],
    );
  };

  const handleBake = () => {
    setErrorMsg(null);
    setIsBaking(true);
    setProgress({ done: 0, total: estimatedFrames });

    // Defer by one tick so React paints the baking indicator cleanly
    window.setTimeout(() => {
      const t0 = performance.now();
      const gpu = createGpuFrameRasterizer(frameResolution, frameResolution);
      try {
        const baked = bakeCharacterSequences(
          { pack, config, images },
          {
            characterName,
            directions: selectedDirs,
            actions: selectedActions,
            frameSize: { width: frameResolution, height: frameResolution },
            trimTransparent,
            padding,
            powerOfTwo,
            rasterizer: gpu.rasterizer,
            onProgress: (done, total) => setProgress({ done, total }),
          },
        );

        const bundle =
          target === 'godot4'
            ? exportGodot4BakedBundle(baked, { resBasePath: godotResPath })
            : target === 'cocos3'
              ? exportCocos3BakedBundle(baked)
              : exportDualEngineBakedBundle(baked, {
                  godot4: { resBasePath: godotResPath },
                });

        const pngCopy = new Uint8Array(baked.atlas.png.byteLength);
        pngCopy.set(baked.atlas.png);
        const atlasPreviewUrl = URL.createObjectURL(
          new Blob([pngCopy], { type: 'image/png' }),
        );
        const durationMs = Math.round(performance.now() - t0);

        setResult((prev) => {
          if (prev?.atlasPreviewUrl) URL.revokeObjectURL(prev.atlasPreviewUrl);
          return { baked, bundle, atlasPreviewUrl, durationMs };
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        gpu.dispose();
        setIsBaking(false);
      }
    }, 30);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                导出游戏资产包（M3 · 烘焙序列帧 Mode A）
              </h2>
              <p className="text-[11px] text-slate-400">
                WebGL2 GPU 离屏烘焙 + MaxRects 紧密装箱 → 直接拖入 Godot 4.x / Cocos Creator 3.x
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          {/* Left Column: Export Settings */}
          <div className="space-y-4">
            {/* Engine target */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                目标引擎格式
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['godot4', 'Godot 4.x', '.tres + .tscn'],
                    ['cocos3', 'Cocos 3.x', '.plist + .anim'],
                    ['dual', '双引擎合包', 'Godot + Cocos'],
                  ] as const
                ).map(([id, title, sub]) => (
                  <button
                    key={id}
                    onClick={() => setTarget(id)}
                    className={`rounded-lg border p-2 text-left transition ${
                      target === id
                        ? 'border-sky-500 bg-sky-600/20 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{title}</div>
                    <div className="font-mono text-[10px] text-slate-400">{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Character name + resolution */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  角色资源名
                </label>
                <input
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  单帧分辨率
                </label>
                <select
                  value={frameResolution}
                  onChange={(e) => setFrameResolution(Number(e.target.value))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
                >
                  <option value={128}>128 × 128</option>
                  <option value={256}>256 × 256 (推荐)</option>
                  <option value={384}>384 × 384 (高清)</option>
                  <option value={512}>512 × 512 (超清)</option>
                </select>
              </div>
            </div>

            {target !== 'cocos3' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Godot 4 导入路径 (`res://`)
                </label>
                <input
                  value={godotResPath}
                  onChange={(e) => setGodotResPath(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>
            )}

            {/* Directions */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  烘焙朝向 ({selectedDirs.length})
                </span>
                <div className="flex gap-1.5 text-[10px]">
                  <button
                    onClick={() => setSelectedDirs(pack.directions.map((d) => d.id))}
                    className="rounded bg-slate-800 px-1.5 py-0.5 text-sky-300 hover:bg-slate-700"
                  >
                    全部 8 向
                  </button>
                  <button
                    onClick={() => setSelectedDirs(['SE', 'SW', 'NE', 'NW'])}
                    className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700"
                  >
                    4 斜向
                  </button>
                  <button
                    onClick={() => setSelectedDirs([config.direction])}
                    className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700"
                  >
                    仅当前({config.direction})
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {pack.directions.map((d) => {
                  const active = selectedDirs.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => toggleDir(d.id)}
                      className={`rounded border px-2 py-1 text-xs font-mono transition ${
                        active
                          ? 'border-sky-500 bg-sky-600/20 text-white'
                          : 'border-slate-800 bg-slate-950/60 text-slate-500'
                      }`}
                    >
                      {d.id}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-300">
                烘焙动作 ({selectedActions.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(pack.animations).map((clip) => {
                  const active = selectedActions.includes(clip.id);
                  const frames = Math.max(1, Math.round((clip.durationMs / 1000) * clip.fps));
                  return (
                    <button
                      key={clip.id}
                      onClick={() => toggleAction(clip.id)}
                      className={`flex items-center gap-1 rounded border px-2.5 py-1 text-xs transition ${
                        active
                          ? 'border-sky-500 bg-sky-600/20 text-white'
                          : 'border-slate-800 bg-slate-950/60 text-slate-400'
                      }`}
                    >
                      {active && <Check className="h-3 w-3 text-sky-400" />}
                      <span>{clip.label}</span>
                      <span className="font-mono text-[10px] text-slate-400">({frames}f)</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Atlas options */}
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs text-slate-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trimTransparent}
                  onChange={(e) => setTrimTransparent(e.target.checked)}
                  className="accent-sky-500"
                />
                <span>自动裁边 (Trim)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={powerOfTwo}
                  onChange={(e) => setPowerOfTwo(e.target.checked)}
                  className="accent-sky-500"
                />
                <span>2 的幂次尺寸 (POT)</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span>间距</span>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={padding}
                  onChange={(e) => setPadding(Math.max(0, Math.min(8, Number(e.target.value))))}
                  className="w-12 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-xs"
                />
                <span className="text-slate-500">px</span>
              </label>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                烘焙失败：{errorMsg}
              </div>
            )}
          </div>

          {/* Right Column: Live Atlas Preview & File Inventory */}
          <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">合图预览（MaxRects Atlas）</span>
              <span className="font-mono text-[11px] text-slate-400">
                预计 {estimatedFrames} 帧
              </span>
            </div>

            <div className="relative flex flex-1 min-h-[220px] items-center justify-center overflow-hidden rounded-lg border border-slate-800/90 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)_50%/16px_16px]">
              {result ? (
                <img
                  src={result.atlasPreviewUrl}
                  alt="Baked Texture Atlas"
                  className="max-h-64 max-w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-xs text-slate-400">
                  <Sparkles className="mx-auto mb-2 h-7 w-7 text-slate-600" />
                  点击下方「开始 GPU 烘焙合图」生成合图预览与引擎配置文件
                </div>
              )}
            </div>

            {result && (
              <div className="mt-3 space-y-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-emerald-950/50 px-2.5 py-1.5 text-emerald-200 border border-emerald-800/50">
                  <span>
                    已烘焙 {result.baked.atlas.sprites.length} 帧 · 图集{' '}
                    {result.baked.atlas.image.width}×{result.baked.atlas.image.height}
                  </span>
                  <span className="font-mono">
                    {(result.bundle.zip.byteLength / 1024).toFixed(1)} KB · {result.durationMs}ms
                  </span>
                </div>

                <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-900/80 p-2 font-mono text-[10px] text-slate-400">
                  {Object.keys(result.bundle.files).map((f) => (
                    <div key={f} className="truncate">
                      • {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/95 px-5 py-3">
          <div className="text-xs text-slate-400">
            {isBaking
              ? `正在烘焙帧 ${progress.done} / ${progress.total}...`
              : `包含 ${selectedActions.length} 个动作 × ${selectedDirs.length} 个朝向（共 ${estimatedFrames} 帧）`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBake}
              disabled={isBaking}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isBaking ? '烘焙中...' : result ? '重新烘焙合图' : '开始 GPU 烘焙合图'}
            </button>

            {result && (
              <button
                onClick={() =>
                  downloadBinaryFile(result.bundle.zipFilename, result.bundle.zip)
                }
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow"
              >
                <Download className="h-3.5 w-3.5" />
                下载 {result.bundle.zipFilename}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
