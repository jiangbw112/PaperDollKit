import {
  PaperDollCharacter,
  createStarterIsometricPack,
  type AssetPackManifest,
  type DirectionId,
  type HandColorBugMode,
  type SlotId,
} from '@paperdollkit/core';
import type { ImportReport, ImportedImage } from '@paperdollkit/importers';
import {
  Bug,
  Dices,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FolderUp,
  Grid2x2,
  Layers,
  Package,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportModal } from './components/ExportModal.tsx';
import { LutPreviewBar } from './components/LutPreviewBar.tsx';
import { PlaygroundStage } from './components/PlaygroundStage.tsx';
import { ViewportCanvas } from './components/ViewportCanvas.tsx';
import { downloadTextFile, importBrowserFiles } from './utils/browser-import.ts';
import { loadStickerHDPack } from './utils/sticker-pack-loader.ts';

const COMPASS_GRID: (DirectionId | null)[][] = [
  ['NW', 'N', 'NE'],
  ['W', null, 'E'],
  ['SW', 'S', 'SE'],
];

export default function App() {
  const initialShell = useMemo(() => createStarterIsometricPack(), []);

  const [workspaceMode, setWorkspaceMode] = useState<'editor' | 'playground'>('editor');
  const [pack, setPack] = useState<AssetPackManifest>(initialShell);
  const [images, setImages] = useState<Map<string, ImportedImage>>(() => new Map());
  const [imagesVersion, setImagesVersion] = useState(0);

  const [config, setConfig] = useState(() => {
    const ch = new PaperDollCharacter(initialShell, {
      preset: 'knight',
      direction: 'SE',
      action: 'idle',
    });
    return ch.toJSON();
  });

  const [selectedSlotId, setSelectedSlotId] = useState<SlotId>('front_arm');
  const [activePresetId, setActivePresetId] = useState<string>('paladin');
  const [presetWallOpen, setPresetWallOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [timeMs, setTimeMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1.9);
  const [explodeSpread, setExplodeSpread] = useState(0);
  const [showGizmos, setShowGizmos] = useState(false);
  const [debugMaskView, setDebugMaskView] = useState(false);
  const [backend, setBackend] = useState<'webgl2' | 'canvas2d'>('webgl2');
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importToast, setImportToast] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<ImportReport | null>(null);

  const applyDefaultPack = useCallback(async () => {
    try {
      const sticker = await loadStickerHDPack();
      setPack(sticker.pack);
      setImages(sticker.images);
      setImagesVersion((v) => v + 1);
      const ch = new PaperDollCharacter(sticker.pack, {
        preset: 'paladin',
        direction: 'SE',
        action: 'idle',
      });
      setActivePresetId('paladin');
      setConfig(ch.toJSON());
    } catch (err) {
      setImportToast(`资源包加载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    void applyDefaultPack();
  }, [applyDefaultPack]);

  const globalFileInputRef = useRef<HTMLInputElement | null>(null);
  const slotAlbedoInputRef = useRef<HTMLInputElement | null>(null);
  const slotMaskInputRef = useRef<HTMLInputElement | null>(null);
  const canvasExportRef = useRef<HTMLCanvasElement | null>(null);

  const activeClip = pack.animations[config.action] ?? Object.values(pack.animations)[0]!;

  // Smooth requestAnimationFrame clock
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let lastTs = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTs) * speed;
      lastTs = now;
      setTimeMs((prev) => {
        const next = prev + dt;
        return activeClip.loop
          ? next % Math.max(1, activeClip.durationMs)
          : next > activeClip.durationMs
            ? 0
            : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, speed, activeClip.durationMs, activeClip.loop]);

  // Evaluate current character frame
  const evaluatedFrame = useMemo(() => {
    const ch = new PaperDollCharacter(pack, config);
    return ch.evaluate(timeMs, { explodeSpread });
  }, [pack, config, timeMs, explodeSpread]);

  const mutateCharacter = useCallback(
    (mutator: (ch: PaperDollCharacter) => void) => {
      setConfig((prev) => {
        const ch = new PaperDollCharacter(pack, prev);
        mutator(ch);
        return ch.toJSON();
      });
    },
    [pack],
  );

  const showToast = useCallback((msg: string) => {
    setImportToast(msg);
    window.setTimeout(() => {
      setImportToast((cur) => (cur === msg ? null : cur));
    }, 4500);
  }, []);

  const handleGlobalImport = useCallback(
    async (files: File[]) => {
      try {
        const res = await importBrowserFiles(files, pack, images);
        setPack(res.pack);
        setImages(res.images);
        setImagesVersion((v) => v + 1);
        setLastReport(res.report);

        // Automatically equip newly imported parts so user sees them immediately!
        setConfig((prev) => {
          const ch = new PaperDollCharacter(res.pack, prev);
          for (const slot of res.pack.slots) {
            const oldCount = pack.parts[slot.id]?.length ?? 0;
            const newParts = res.pack.parts[slot.id] ?? [];
            if (newParts.length > oldCount) {
              const latest = newParts[newParts.length - 1]!;
              ch.setSlot(slot.id, latest.id);
              setSelectedSlotId(slot.id);
            }
          }
          return ch.toJSON();
        });

        showToast(
          `已导入 ${res.report.importedParts} 个部件 / ${res.report.importedImages} 张贴图（配对遮罩 ${res.report.pairedMasks} 张）`,
        );
      } catch (err) {
        showToast(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [pack, images, showToast],
  );

  const handleSlotDirectUpload = useCallback(
    async (files: File[], isMask: boolean) => {
      if (files.length === 0) return;
      try {
        const currentPartId = config.slots[selectedSlotId];
        const partId =
          isMask && currentPartId && currentPartId !== 'none'
            ? currentPartId
            : files[0]!.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_');

        const activeDirSpec = pack.directions.find((d) => d.id === config.direction);
        const canonicalDir = activeDirSpec?.mirrorFrom ?? config.direction;

        const res = await importBrowserFiles(files, pack, images, {
          slotId: selectedSlotId,
          partId,
          partName: partId,
          directionId: canonicalDir,
          isMask,
        });
        setPack(res.pack);
        setImages(res.images);
        setImagesVersion((v) => v + 1);
        setLastReport(res.report);

        if (!isMask) {
          setConfig((prev) => {
            const ch = new PaperDollCharacter(res.pack, prev);
            ch.setSlot(selectedSlotId, partId);
            return ch.toJSON();
          });
        }
        showToast(
          isMask
            ? `已为 ${selectedSlotId}/${partId} 绑定语义遮罩图`
            : `已为槽位 ${selectedSlotId} 导入高清部件 "${partId}"`,
        );
      } catch (err) {
        showToast(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [config, selectedSlotId, pack, images, showToast],
  );

  const handleDragSlotOffset = useCallback((slotId: SlotId, dx: number, dy: number) => {
    setPack((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.id === slotId
          ? {
              ...s,
              defaultOffset: {
                x: Math.round((s.defaultOffset.x + dx) * 10) / 10,
                y: Math.round((s.defaultOffset.y + dy) * 10) / 10,
              },
            }
          : s,
      ),
    }));
  }, []);

  const updateSelectedSlotOffset = (axis: 'x' | 'y', value: number) => {
    setPack((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.id === selectedSlotId
          ? { ...s, defaultOffset: { ...s.defaultOffset, [axis]: value } }
          : s,
      ),
    }));
  };

  const handleExportCurrentPng = () => {
    const canvas = canvasExportRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `paperdoll_${config.direction}_${config.action}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const selectedSlotDef = pack.slots.find((s) => s.id === selectedSlotId) ?? pack.slots[0]!;
  const selectedPalette =
    pack.palettes[config.palettes[selectedSlotId] ?? 'cobalt'] ?? Object.values(pack.palettes)[0]!;
  const selectedSkin = pack.skins[config.skin] ?? Object.values(pack.skins)[0]!;
  const hiddenSet = new Set(config.hiddenSlots ?? []);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100">
      {/* Hidden file pickers */}
      <input
        ref={globalFileInputRef}
        type="file"
        multiple
        accept=".psd,.png,.webp,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length > 0) void handleGlobalImport(list);
          e.target.value = '';
        }}
      />
      <input
        ref={slotAlbedoInputRef}
        type="file"
        accept=".png,.webp,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length > 0) void handleSlotDirectUpload(list, false);
          e.target.value = '';
        }}
      />
      <input
        ref={slotMaskInputRef}
        type="file"
        accept=".png,.webp"
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length > 0) void handleSlotDirectUpload(list, true);
          e.target.value = '';
        }}
      />

      {/* Top Studio Toolbar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800/90 bg-slate-900/95 px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold shadow">
            PD
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-white">
              PaperDollKit v2
            </span>
            {/* Workspace Mode Switcher: Single-Actor Studio vs Multi-Actor Playground */}
            <div className="flex items-center rounded-lg border border-slate-700/80 bg-slate-950/80 p-0.5 text-xs">
              <button
                onClick={() => setWorkspaceMode('editor')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 font-semibold transition ${
                  workspaceMode === 'editor'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                角色编辑器
              </button>
              <button
                onClick={() => {
                  setPresetWallOpen(false);
                  setWorkspaceMode('playground');
                }}
                className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 font-semibold transition ${
                  workspaceMode === 'playground'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                多人 Playground
              </button>
            </div>
            <span className="hidden lg:inline rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
              {backend === 'webgl2' ? 'WebGL2 LUT' : 'Canvas2D'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 whitespace-nowrap">
          {workspaceMode === 'editor' && (
          <>
          {/* 1 Mannequin + 16 Presets Gallery Trigger + Randomize */}
          <div className="relative flex items-center gap-1 mr-1 border-r border-slate-800 pr-2">
            <button
              onClick={() => {
                setActivePresetId('mannequin');
                mutateCharacter((ch) => ch.applyPreset('mannequin'));
              }}
              className={`rounded px-2 py-1 text-xs font-medium border transition ${
                activePresetId === 'mannequin'
                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-200'
                  : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white'
              }`}
              title="还原 00 · 原木木头人素体"
            >
              木头人
            </button>

            <button
              onClick={() => setPresetWallOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold border transition ${
                presetWallOpen
                  ? 'border-sky-400 bg-sky-600/30 text-white'
                  : 'border-slate-700 bg-slate-800 text-sky-200 hover:border-sky-500/60 hover:text-white'
              }`}
            >
              <Grid2x2 className="h-3.5 w-3.5 text-sky-400" />
              <span>
                {pack.presets.find((p) => p.id === activePresetId)?.name ?? '16 角色预设墙'}
              </span>
              <span className="rounded bg-slate-900/90 px-1 py-0.2 font-mono text-[10px] text-slate-400">
                {pack.presets.length}
              </span>
            </button>

            <button
              onClick={() => {
                const palKeys = Object.keys(pack.palettes);
                const skinKeys = Object.keys(pack.skins).filter((k) => k !== 'wood');
                const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
                const mainPal = pick(palKeys);
                const accentPal = pick(palKeys);
                setActivePresetId('custom');
                mutateCharacter((ch) => {
                  ch.setSkin(pick(skinKeys));
                  for (const s of pack.slots) {
                    const list = pack.parts[s.id] ?? [];
                    if (list.length === 0) continue;
                    const choices = s.required ? list.map((p) => p.id) : ['none', ...list.map((p) => p.id)];
                    ch.setSlot(s.id, pick(choices));
                    ch.setPalette(s.id, Math.random() < 0.65 ? mainPal : accentPal);
                  }
                  ch.setSlot('back_arm', ch.slots.front_arm ?? 'bare');
                  ch.setPalette('back_arm', ch.palettes.front_arm ?? mainPal);
                });
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition"
              title="随机拼装一个角色"
            >
              <Dices className="h-3.5 w-3.5 text-amber-400" />
              随机
            </button>

            {/* 17-Preset Gallery Popover */}
            {presetWallOpen && (
              <div className="absolute right-0 top-10 z-40 w-[560px] rounded-xl border border-slate-700/90 bg-slate-900/98 p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    1 个木头人 → 16 个完整角色预设墙（0xsu 风格）
                  </span>
                  <span className="text-[11px] text-slate-400">点击即刻换装</span>
                </div>
                <div className="grid max-h-[380px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
                  {pack.presets.map((p) => {
                    const isCurrent = activePresetId === p.id;
                    const swatchColor =
                      p.id === 'mannequin'
                        ? pack.skins.wood?.swatch ?? '#cfa06b'
                        : pack.palettes[p.palettes.torso_top ?? 'cobalt']?.swatch ?? '#2e6bd1';
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setActivePresetId(p.id);
                          mutateCharacter((ch) => ch.applyPreset(p.id));
                          setPresetWallOpen(false);
                        }}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                          isCurrent
                            ? 'border-sky-400 bg-sky-600/25 text-white'
                            : 'border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-600 hover:bg-slate-800/80'
                        }`}
                      >
                        <span
                          className="h-6 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: swatchColor }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold">{p.name}</div>
                          <div className="truncate text-[9px] text-slate-400">{p.tag}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setDebugMaskView((v) => !v)}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium border transition ${
              debugMaskView
                ? 'border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white'
            }`}
            title="切换 RGBA 语义遮罩通道预览（R主色 / G辅色 / B肤色 / A金属）"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Mask 视图
          </button>

          <button
            onClick={() => setShowGizmos((v) => !v)}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium border transition ${
              showGizmos
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white'
            }`}
            title="显示骨骼层级与可拖拽槽位轴心"
          >
            <Sliders className="h-3.5 w-3.5" />
            骨架 Gizmo
          </button>

          <button
            onClick={() => globalFileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-600/20 px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-600/35 transition"
          >
            <FolderUp className="h-3.5 w-3.5" />
            导入 PSD/PNG
          </button>

          <button
            onClick={() => setExportModalOpen(true)}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
            title="一键烘焙合图并导出 Godot 4.x / Cocos Creator 3.x 资源包"
          >
            <Package className="h-3.5 w-3.5" />
            导出 Godot/Cocos
          </button>

          <button
            onClick={() => downloadTextFile('character-v2.json', JSON.stringify(config, null, 2))}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition"
            title="导出当前角色 JSON 配置"
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </button>

          <button
            onClick={handleExportCurrentPng}
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition"
            title="导出当前渲染帧 PNG"
          >
            <FileImage className="h-3.5 w-3.5" />
            PNG
          </button>
          </>
          )}
          {workspaceMode === 'playground' && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="hidden md:inline">
                空白场景多人同屏测试 · 支持 Y 轴遮挡、拖拽排位与 AI 漫游
              </span>
              <button
                onClick={() => setExportModalOpen(true)}
                className="flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
              >
                <Package className="h-3.5 w-3.5" />
                导出 Godot/Cocos
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Multi-Character Blank-Scene Playground (kept mounted so placed actors persist across tab switches) */}
      <div className={workspaceMode === 'playground' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <PlaygroundStage
          active={workspaceMode === 'playground'}
          pack={pack}
          images={images}
          imagesVersion={imagesVersion}
          currentEditorConfig={config}
          currentEditorPresetName={
            pack.presets.find((p) => p.id === activePresetId)?.name ?? '自定义角色'
          }
          debugMaskView={debugMaskView}
          onToggleDebugMask={() => setDebugMaskView((v) => !v)}
          onEditActorInStudio={(actorCfg) => {
            setConfig({
              ...actorCfg,
              slots: { ...actorCfg.slots },
              palettes: { ...actorCfg.palettes },
            });
            setActivePresetId('custom');
            setWorkspaceMode('editor');
            showToast('已将该角色载入编辑器，修改后可再次添加到多人场景');
          }}
          onToast={showToast}
        />
      </div>

      {/* Main 3-Pane Studio Workspace */}
      <div className={workspaceMode === 'editor' ? 'flex min-h-0 flex-1' : 'hidden'}>
        {/* LEFT PANEL: 17-Slot Hierarchy & Part Switcher */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800/90 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Layers className="h-3.5 w-3.5 text-sky-400" />
              <span>17 槽位装配 ({evaluatedFrame.layers.length} 活跃)</span>
            </div>
            <button
              onClick={() => {
                void applyDefaultPack().then(() => showToast('已重置为 0xsu 风贴纸木头人角色包'));
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="重置默认 0xsu 风贴纸角色资产"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {pack.slots.map((slot) => {
              const partList = pack.parts[slot.id] ?? [];
              const currentPart = config.slots[slot.id] ?? 'none';
              const isHidden = hiddenSet.has(slot.id);
              const isSelected = selectedSlotId === slot.id;
              const zIdx = evaluatedFrame.layers.findIndex((l) => l.slotId === slot.id);

              return (
                <div
                  key={slot.id}
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`rounded-md border px-2 py-1.5 transition cursor-pointer ${
                    isSelected
                      ? 'border-sky-500/70 bg-sky-950/40'
                      : 'border-slate-800/70 bg-slate-900/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          mutateCharacter((ch) => ch.setSlotVisible(slot.id, isHidden));
                        }}
                        className="text-slate-400 hover:text-white"
                        title={isHidden ? '显示图层' : '隐藏图层'}
                      >
                        {isHidden ? <EyeOff className="h-3.5 w-3.5 text-slate-600" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <span className="truncate text-xs font-medium text-slate-200">
                        {slot.name}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">
                      {zIdx >= 0 ? `Z${zIdx}` : '--'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <select
                      value={currentPart}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        mutateCharacter((ch) => ch.setSlot(slot.id, e.target.value))
                      }
                      className="w-full rounded border border-slate-700/80 bg-slate-950/90 px-1.5 py-0.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      {!slot.required && <option value="none">无</option>}
                      {partList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* CENTER: WebGL2 Isometric Viewport + Bottom Playback Timeline */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <ViewportCanvas
            pack={pack}
            frame={evaluatedFrame}
            images={images}
            imagesVersion={imagesVersion}
            selectedSlotId={selectedSlotId}
            onSelectSlot={setSelectedSlotId}
            onDragSlotOffset={handleDragSlotOffset}
            onDropFiles={(files) => void handleGlobalImport(files)}
            debugMaskView={debugMaskView}
            showGizmos={showGizmos}
            zoom={zoom}
            onZoomChange={setZoom}
            onBackendReady={setBackend}
            canvasExportRef={canvasExportRef}
          />

          {/* Floating import toast */}
          {importToast && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-sky-500/40 bg-slate-900/95 px-3.5 py-2 text-xs font-medium text-sky-200 shadow-lg backdrop-blur">
              {importToast}
            </div>
          )}

          {/* Bottom Animation & Explode Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/90 bg-slate-900/95 px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying((p) => !p)}
                className="flex h-7 w-7 items-center justify-center rounded bg-sky-600 text-white hover:bg-sky-500 transition"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>

              <div className="flex items-center gap-1 rounded bg-slate-950 p-0.5 border border-slate-800">
                {Object.values(pack.animations).map((clip) => (
                  <button
                    key={clip.id}
                    onClick={() => {
                      mutateCharacter((ch) => ch.setAction(clip.id));
                      setTimeMs(0);
                    }}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                      config.action === clip.id
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {clip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline scrubber */}
            <div className="flex flex-1 items-center gap-2 min-w-[180px] max-w-md">
              <input
                type="range"
                min={0}
                max={activeClip.durationMs}
                step={5}
                value={Math.round(timeMs)}
                onChange={(e) => {
                  setIsPlaying(false);
                  setTimeMs(Number(e.target.value));
                }}
                className="w-full accent-sky-500"
              />
              <span className="w-20 text-right font-mono text-[11px] text-slate-400">
                {Math.round(timeMs)}/{activeClip.durationMs}ms
              </span>
            </div>

            {/* Speed & Layer Explode */}
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <span>速度</span>
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-200"
                >
                  <option value={0.25}>0.25×</option>
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1.0×</option>
                  <option value={1.5}>1.5×</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span>爆炸展开</span>
                <input
                  type="range"
                  min={0}
                  max={44}
                  value={explodeSpread}
                  onChange={(e) => setExplodeSpread(Number(e.target.value))}
                  className="w-20 accent-sky-500"
                />
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL: Direction Compass, LUT Palette, Skin & Slot Inspector */}
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-800/90 bg-slate-900/60 p-3 space-y-4">
          {/* 8-Direction Diablo Isometric Compass */}
          <section>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>暗黑 8 向朝向（5 原始 + 3 镜像）</span>
              <span className="font-mono text-[11px] text-sky-400">{config.direction}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {COMPASS_GRID.flat().map((dirId, idx) => {
                if (!dirId) {
                  return (
                    <div
                      key={`center-${idx}`}
                      className="flex items-center justify-center rounded border border-slate-800/80 bg-slate-950/60 text-[10px] font-mono text-slate-500"
                    >
                      ISO 2.5D
                    </div>
                  );
                }
                const spec = pack.directions.find((d) => d.id === dirId);
                const active = config.direction === dirId;
                return (
                  <button
                    key={dirId}
                    onClick={() => mutateCharacter((ch) => ch.setDirection(dirId))}
                    className={`flex flex-col items-center rounded border py-1.5 text-xs transition ${
                      active
                        ? 'border-sky-500 bg-sky-600/25 text-white font-semibold'
                        : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span>{dirId}</span>
                    <span className="text-[9px] text-slate-400">
                      {spec?.mirrorFrom ? `镜像 ${spec.mirrorFrom}` : spec?.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Skin Tone & Hand Color Sync Diagnostic */}
          <section className="space-y-2 border-t border-slate-800/80 pt-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>角色肤色（Mask B 通道同步）</span>
              <span className="text-[11px] text-slate-400">{selectedSkin.name}</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {Object.values(pack.skins).map((skin) => (
                <button
                  key={skin.id}
                  onClick={() => mutateCharacter((ch) => ch.setSkin(skin.id))}
                  title={skin.name}
                  className={`h-7 rounded-md border-2 transition ${
                    config.skin === skin.id
                      ? 'border-white scale-105 shadow'
                      : 'border-slate-800 hover:border-slate-500'
                  }`}
                  style={{ backgroundColor: skin.swatch }}
                />
              ))}
            </div>

            {/* Hand Color Bug Mode QA toggle */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <Bug className="h-3.5 w-3.5 text-amber-400" />
                <span>手部肤色通道诊断（手臂 Mask B 验证）</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ['none', '正常同步'],
                    ['baked_wood', '原木写死坑'],
                    ['dyed_sleeve', '袖色误染坑'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() =>
                      mutateCharacter((ch) =>
                        ch.setHandColorBugMode(mode as HandColorBugMode),
                      )
                    }
                    className={`rounded px-1.5 py-1 text-[10px] font-medium transition ${
                      config.handColorBugMode === mode
                        ? mode === 'none'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-amber-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Palette & GPU LUT Preview */}
          <section className="space-y-2.5 border-t border-slate-800/80 pt-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5 text-sky-400" />
                色板：{selectedSlotDef.name}
              </span>
              <button
                onClick={() =>
                  mutateCharacter((ch) => ch.setAllClothingPalette(selectedPalette.id))
                }
                className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-slate-700"
              >
                应用到整套服装
              </button>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {Object.values(pack.palettes).map((pal) => {
                const active = config.palettes[selectedSlotId] === pal.id;
                return (
                  <button
                    key={pal.id}
                    onClick={() =>
                      mutateCharacter((ch) => ch.setPalette(selectedSlotId, pal.id))
                    }
                    title={pal.name}
                    className={`flex flex-col items-center gap-1 rounded border p-1 transition ${
                      active
                        ? 'border-sky-400 bg-sky-950/50'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <span
                      className="h-4 w-full rounded-sm"
                      style={{ backgroundColor: pal.swatch }}
                    />
                    <span className="truncate w-full text-center text-[9px] text-slate-300">
                      {pal.name.slice(0, 4)}
                    </span>
                  </button>
                );
              })}
            </div>

            <LutPreviewBar
              slotId={selectedSlotId}
              palette={selectedPalette}
              skin={selectedSkin}
              handColorBugMode={config.handColorBugMode}
            />
          </section>

          {/* Selected Slot Direct PNG/Mask Replacement & Offset Inspector */}
          <section className="space-y-2.5 border-t border-slate-800/80 pt-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>槽位资产与挂点微调</span>
              <span className="font-mono text-[10px] text-slate-400">{selectedSlotId}</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => slotAlbedoInputRef.current?.click()}
                className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/90 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                <Upload className="h-3 w-3 text-sky-400" />
                替换底图 PNG
              </button>
              <button
                onClick={() => slotMaskInputRef.current?.click()}
                className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/90 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition"
              >
                <Sparkles className="h-3 w-3 text-fuchsia-400" />
                绑定遮罩 Mask
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[11px]">
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Offset X</span>
                <input
                  type="range"
                  min={-120}
                  max={120}
                  step={1}
                  value={selectedSlotDef.defaultOffset.x}
                  onChange={(e) => updateSelectedSlotOffset('x', Number(e.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-9 text-right font-mono text-slate-200">
                  {selectedSlotDef.defaultOffset.x}
                </span>
              </label>

              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Offset Y</span>
                <input
                  type="range"
                  min={-150}
                  max={120}
                  step={1}
                  value={selectedSlotDef.defaultOffset.y}
                  onChange={(e) => updateSelectedSlotOffset('y', Number(e.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-9 text-right font-mono text-slate-200">
                  {selectedSlotDef.defaultOffset.y}
                </span>
              </label>
            </div>

            {lastReport && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-slate-400 space-y-0.5">
                <div className="font-medium text-slate-200">最近导入报告</div>
                <div>
                  导入部件: {lastReport.importedParts} · 贴图: {lastReport.importedImages} · 遮罩配对:{' '}
                  {lastReport.pairedMasks}
                </div>
                {lastReport.unmatchedPaths.length > 0 && (
                  <div className="text-amber-400">
                    未识别路径 ({lastReport.unmatchedPaths.length}):{' '}
                    {lastReport.unmatchedPaths.slice(0, 2).join(', ')}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>

      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        pack={pack}
        config={config}
        images={images}
      />
    </div>
  );
}
