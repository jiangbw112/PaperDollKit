import type { AssetPackManifest, CharacterConfig, DirectionId } from '@paperdollkit/core';
import {
  bakeCharacterSequences,
  bakeFrameCPU,
  buildModularExportData,
  exportCocos3BakedBundle,
  exportCocos3ModularBundle,
  exportDualEngineBakedBundle,
  exportDualEngineModularBundle,
  exportGodot4BakedBundle,
  exportGodot4ModularBundle,
  exportUniversalAtlasBundle,
  type BakedExportData,
  type ExportBundle,
  type FrameRasterizer,
  type ModularExportData,
} from '@paperdollkit/exporters';
import type { ImportedImage } from '@paperdollkit/importers';
import { WebGL2PaperDollRenderer } from '@paperdollkit/renderer-webgl2';
import { Boxes, Check, Download, Film, Package, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type ExportMode = 'baked' | 'modular';
type ExportTarget = 'godot4' | 'cocos3' | 'dual' | 'universal';

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
  const [exportMode, setExportMode] = useState<ExportMode>('modular');
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

  // Mode B modular options
  const [includeAllParts, setIncludeAllParts] = useState(true);
  const [includePrebakedLuts, setIncludePrebakedLuts] = useState(true);

  const [isBaking, setIsBaking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [bakedResult, setBakedResult] = useState<{
    baked: BakedExportData;
    bundle: ExportBundle;
    atlasPreviewUrl: string;
    durationMs: number;
  } | null>(null);
  const [modularResult, setModularResult] = useState<{
    modular: ModularExportData;
    bundle: ExportBundle;
    durationMs: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (bakedResult?.atlasPreviewUrl) URL.revokeObjectURL(bakedResult.atlasPreviewUrl);
    };
  }, [bakedResult]);

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

  const totalPackParts = useMemo(
    () => Object.values(pack.parts).reduce((acc, list) => acc + list.length, 0),
    [pack.parts],
  );
  const totalAnimEvents = useMemo(
    () => Object.values(pack.animations).reduce((acc, c) => acc + (c.events?.length ?? 0), 0),
    [pack.animations],
  );

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

  const handleGenerate = () => {
    setErrorMsg(null);
    setIsBaking(true);

    if (exportMode === 'baked') {
      setProgress({ done: 0, total: estimatedFrames });
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
                : target === 'universal'
                  ? exportUniversalAtlasBundle(baked)
                  : exportDualEngineBakedBundle(baked, {
                      godot4: { resBasePath: godotResPath },
                    });

          const pngCopy = new Uint8Array(baked.atlas.png.byteLength);
          pngCopy.set(baked.atlas.png);
          const atlasPreviewUrl = URL.createObjectURL(
            new Blob([pngCopy], { type: 'image/png' }),
          );
          const durationMs = Math.round(performance.now() - t0);

          setBakedResult((prev) => {
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
    } else {
      window.setTimeout(() => {
        const t0 = performance.now();
        try {
          const modular = buildModularExportData(
            { pack, config, images },
            {
              kitName: characterName || 'paperdoll_modular',
              includeAllParts,
              includePrebakedLuts,
            },
          );
          const bundle =
            target === 'godot4'
              ? exportGodot4ModularBundle(modular, { resBasePath: godotResPath })
              : target === 'cocos3'
                ? exportCocos3ModularBundle(modular)
                : exportDualEngineModularBundle(modular, {
                    godot4: { resBasePath: godotResPath },
                  });
          const durationMs = Math.round(performance.now() - t0);
          setModularResult({ modular, bundle, durationMs });
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        } finally {
          setIsBaking(false);
        }
      }, 20);
    }
  };

  const activeBundle = exportMode === 'baked' ? bakedResult?.bundle : modularResult?.bundle;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                导出游戏资产包（Godot 4.x / Cocos Creator 3.x）
              </h2>
              <p className="text-[11px] text-slate-400">
                支持 Mode A 烘焙序列帧（零 Shader 依赖）与 Mode B 模块化实时换装运行时（M4）
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

        {/* Mode Switcher Bar */}
        <div className="grid grid-cols-2 gap-2 border-b border-slate-800/80 bg-slate-950/50 px-5 py-2.5">
          <button
            onClick={() => {
              setExportMode('modular');
              setErrorMsg(null);
            }}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
              exportMode === 'modular'
                ? 'border-emerald-500 bg-emerald-600/20 text-white'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <Boxes className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <div className="text-xs font-semibold">Mode B · 模块化实时换装（M4 推荐）</div>
              <div className="truncate text-[10px] text-slate-400">
                游戏内实时换装 / LUT 换色 / 互斥规则 / 动画事件 / 受击闪白与描边
              </div>
            </div>
          </button>
          <button
            onClick={() => {
              setExportMode('baked');
              setErrorMsg(null);
            }}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
              exportMode === 'baked'
                ? 'border-sky-500 bg-sky-600/20 text-white'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <Film className="h-4 w-4 shrink-0 text-sky-400" />
            <div className="min-w-0">
              <div className="text-xs font-semibold">Mode A · 烘焙序列帧（M3 静态合图）</div>
              <div className="truncate text-[10px] text-slate-400">
                WebGL2 离屏烘焙 + MaxRects 装箱，适合固定外观 NPC / 怪物
              </div>
            </div>
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
              <div className={exportMode === 'baked' ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-3 gap-1.5'}>
                {(exportMode === 'modular'
                  ? ([
                      ['godot4', 'Godot 4.x', '.gdshader + .gd'],
                      ['cocos3', 'Cocos 3.x', '.effect + .ts'],
                      ['dual', '双引擎合包', 'Godot + Cocos'],
                    ] as const)
                  : ([
                      ['godot4', 'Godot 4.x', '.tres + .tscn'],
                      ['cocos3', 'Cocos 3.x', '.plist + .anim'],
                      ['dual', '双引擎合包', 'Godot + Cocos'],
                      ['universal', '通用图集', 'Phaser/Aseprite/Unity'],
                    ] as const)
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

            {/* Character / Kit name (+ Resolution for Mode A) */}
            <div className={exportMode === 'baked' ? 'grid grid-cols-2 gap-3' : ''}>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  {exportMode === 'modular' ? '模块化资源包名' : '角色资源名'}
                </label>
                <input
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              {exportMode === 'baked' && (
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
              )}
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

            {exportMode === 'modular' ? (
              <div className="space-y-3">
                <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <div className="font-semibold text-slate-200">模块化运行时打包选项</div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAllParts}
                      onChange={(e) => setIncludeAllParts(e.target.checked)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-slate-100">
                        包含全部 {totalPackParts} 个部件 & {pack.presets.length} 套预设
                      </div>
                      <div className="text-[10px] text-slate-400">
                        勾选后可在游戏内自由切换整套衣橱与职业预设；取消则仅打包当前穿戴部件
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includePrebakedLuts}
                      onChange={(e) => setIncludePrebakedLuts(e.target.checked)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-slate-100">
                        附带默认 256×4 RGBA8 LUT 纹理参考 (`luts/*.png`)
                      </div>
                      <div className="text-[10px] text-slate-400">
                        运行时脚本会自动按 `palettes` 与 `skins` 实时生成 LUT，附带 PNG 便于美术核对
                      </div>
                    </div>
                  </label>
                </div>

                <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-3 text-[11px] text-emerald-200/90 space-y-1">
                  <div className="font-semibold text-emerald-300">内置运行时能力清单</div>
                  <div>• 1:1 跨引擎 Mask+Ramp LUT 着色器（Godot `.gdshader` / Cocos `.effect`）</div>
                  <div>• 完整执行 `PartRules`（头盔隐藏发型、兜帽收束短发、长弓禁用副手）</div>
                  <div>• 导出 {totalAnimEvents} 个动画事件（`footstep` / `hit` / `cast_release` / `hit_impact`）</div>
                  <div>• 内置受击闪白 `trigger_hit_flash` 与 8 向描边 `set_outline` Shader Uniform</div>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}

            {errorMsg && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                导出失败：{errorMsg}
              </div>
            )}
          </div>

          {/* Right Column: Preview & File Inventory */}
          <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            {exportMode === 'baked' ? (
              <>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">合图预览（MaxRects Atlas）</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    预计 {estimatedFrames} 帧
                  </span>
                </div>

                <div className="relative flex flex-1 min-h-[220px] items-center justify-center overflow-hidden rounded-lg border border-slate-800/90 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)_50%/16px_16px]">
                  {bakedResult ? (
                    <img
                      src={bakedResult.atlasPreviewUrl}
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

                {bakedResult && (
                  <div className="mt-3 space-y-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-emerald-950/50 px-2.5 py-1.5 text-emerald-200 border border-emerald-800/50">
                      <span>
                        已烘焙 {bakedResult.baked.atlas.sprites.length} 帧 · 图集{' '}
                        {bakedResult.baked.atlas.image.width}×{bakedResult.baked.atlas.image.height}
                      </span>
                      <span className="font-mono">
                        {(bakedResult.bundle.zip.byteLength / 1024).toFixed(1)} KB ·{' '}
                        {bakedResult.durationMs}ms
                      </span>
                    </div>

                    <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-900/80 p-2 font-mono text-[10px] text-slate-400">
                      {Object.keys(bakedResult.bundle.files).map((f) => (
                        <div key={f} className="truncate">
                          • {f}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    Mode B 模块化运行时包清单
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400">
                    {includeAllParts ? `${totalPackParts} 部件` : '仅当前穿戴'}
                  </span>
                </div>

                {modularResult ? (
                  <div className="flex flex-1 flex-col space-y-2.5 text-[11px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-2">
                        <div className="text-[10px] text-emerald-300/80">包含部件 / 贴图</div>
                        <div className="font-mono text-sm font-semibold text-emerald-100">
                          {modularResult.modular.stats.partCount} 部件 ·{' '}
                          {modularResult.modular.stats.textureCount} 贴图
                        </div>
                      </div>
                      <div className="rounded-lg border border-sky-500/30 bg-sky-950/30 p-2">
                        <div className="text-[10px] text-sky-300/80">ZIP 大小 / 耗时</div>
                        <div className="font-mono text-sm font-semibold text-sky-100">
                          {(modularResult.bundle.zip.byteLength / 1024).toFixed(1)} KB ·{' '}
                          {modularResult.durationMs}ms
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-60 rounded border border-slate-800 bg-slate-900/80 p-2.5 font-mono text-[10px] text-slate-300 space-y-0.5">
                      {Object.keys(modularResult.bundle.files).map((f) => (
                        <div key={f} className="truncate">
                          • {f}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-900/40 px-6 text-center text-xs text-slate-400">
                    <Boxes className="mb-2 h-8 w-8 text-emerald-500/60" />
                    <div>点击下方「生成模块化运行时包」</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      将打包源图集 + 语义遮罩 + `paperdoll_manifest.json` + 跨引擎 Shader 与控制器脚本
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/95 px-5 py-3">
          <div className="text-xs text-slate-400">
            {exportMode === 'baked'
              ? isBaking
                ? `正在烘焙帧 ${progress.done} / ${progress.total}...`
                : `包含 ${selectedActions.length} 个动作 × ${selectedDirs.length} 个朝向（共 ${estimatedFrames} 帧）`
              : isBaking
                ? '正在打包模块化纹理、Shader 与运行时脚本...'
                : `Mode B 运行时包 · ${Object.keys(pack.animations).length} 套动画 / ${totalAnimEvents} 个事件`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isBaking}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isBaking
                ? '生成中...'
                : exportMode === 'baked'
                  ? bakedResult
                    ? '重新烘焙合图'
                    : '开始 GPU 烘焙合图'
                  : modularResult
                    ? '重新生成运行时包'
                    : '生成模块化运行时包'}
            </button>

            {activeBundle && (
              <button
                onClick={() => downloadBinaryFile(activeBundle.zipFilename, activeBundle.zip)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow"
              >
                <Download className="h-3.5 w-3.5" />
                下载 {activeBundle.zipFilename}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
