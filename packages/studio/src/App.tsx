import {
  PaperDollCharacter,
  SCHEMA_VERSION,
  auditAssetPack,
  createStarterIsometricPack,
  generateSeededCharacter,
  type AssetAuditReport,
  type AssetPackManifest,
  type CharacterConfig,
  type DirectionId,
  type HandColorBugMode,
  type SlotId,
  type Vec2,
} from '@paperdollkit/core';
import type { ImportReport, ImportedImage } from '@paperdollkit/importers';
import {
  Bookmark,
  Bug,
  Dices,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileJson,
  FolderUp,
  Grid2x2,
  Layers,
  Package,
  Palette,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportModal } from './components/ExportModal.tsx';
import { LutPreviewBar } from './components/LutPreviewBar.tsx';
import { PlaygroundStage } from './components/PlaygroundStage.tsx';
import { ViewportCanvas } from './components/ViewportCanvas.tsx';
import { downloadTextFile, importBrowserFiles } from './utils/browser-import.ts';
import {
  applySlotOffsetsToPack,
  clearStudioAutosave,
  cloneCharacterConfig,
  extractSlotOffsets,
  loadSavedCharacters,
  loadStudioAutosave,
  parseImportedProjectJson,
  sanitizeCharacterConfig,
  saveSavedCharacters,
  saveStudioAutosave,
  type SavedCharacterEntry,
  type StudioProjectFile,
} from './utils/character-library.ts';
import { loadStickerHDPack } from './utils/sticker-pack-loader.ts';

const COMPASS_GRID: (DirectionId | null)[][] = [
  ['NW', 'N', 'NE'],
  ['W', null, 'E'],
  ['SW', 'S', 'SE'],
];

interface HistorySnapshot {
  config: CharacterConfig;
  activePresetId: string;
  slotOffsets: Record<SlotId, Vec2>;
}

const MAX_HISTORY = 50;

export default function App() {
  const initialShell = useMemo(() => createStarterIsometricPack(), []);

  const [workspaceMode, setWorkspaceMode] = useState<'editor' | 'playground'>('editor');
  const [pack, setPack] = useState<AssetPackManifest>(initialShell);
  const [images, setImages] = useState<Map<string, ImportedImage>>(() => new Map());
  const [imagesVersion, setImagesVersion] = useState(0);

  const [config, setConfig] = useState<CharacterConfig>(() => {
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedCharacters, setSavedCharacters] = useState<SavedCharacterEntry[]>(() =>
    loadSavedCharacters(),
  );
  const [saveNameDraft, setSaveNameDraft] = useState('');
  const [historyPast, setHistoryPast] = useState<HistorySnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistorySnapshot[]>([]);

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
  const [lastAudit, setLastAudit] = useState<AssetAuditReport | null>(null);

  const packReadyRef = useRef(false);
  const packRef = useRef(pack);
  packRef.current = pack;
  const configRef = useRef(config);
  configRef.current = config;
  const activePresetIdRef = useRef(activePresetId);
  activePresetIdRef.current = activePresetId;
  const lastCoalesceRef = useRef<{ key: string; ts: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setImportToast(msg);
    window.setTimeout(() => {
      setImportToast((cur) => (cur === msg ? null : cur));
    }, 4500);
  }, []);

  const captureSnapshot = useCallback((): HistorySnapshot => {
    return {
      config: cloneCharacterConfig(configRef.current),
      activePresetId: activePresetIdRef.current,
      slotOffsets: extractSlotOffsets(packRef.current),
    };
  }, []);

  const pushHistory = useCallback(
    (coalesceKey?: string) => {
      const now = performance.now();
      if (
        coalesceKey &&
        lastCoalesceRef.current &&
        lastCoalesceRef.current.key === coalesceKey &&
        now - lastCoalesceRef.current.ts < 400
      ) {
        lastCoalesceRef.current.ts = now;
        return;
      }
      lastCoalesceRef.current = coalesceKey ? { key: coalesceKey, ts: now } : null;
      const snap = captureSnapshot();
      setHistoryPast((prev) => {
        const next = [...prev, snap];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      setHistoryFuture([]);
    },
    [captureSnapshot],
  );

  const handleUndo = useCallback(() => {
    setHistoryPast((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1]!;
      const currentSnap = captureSnapshot();
      setHistoryFuture((f) => [currentSnap, ...f].slice(0, MAX_HISTORY));
      setConfig(cloneCharacterConfig(target.config));
      setActivePresetId(target.activePresetId);
      setPack((p) => applySlotOffsetsToPack(p, target.slotOffsets));
      lastCoalesceRef.current = null;
      return prev.slice(0, -1);
    });
  }, [captureSnapshot]);

  const handleRedo = useCallback(() => {
    setHistoryFuture((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[0]!;
      const currentSnap = captureSnapshot();
      setHistoryPast((p) => [...p, currentSnap].slice(-MAX_HISTORY));
      setConfig(cloneCharacterConfig(target.config));
      setActivePresetId(target.activePresetId);
      setPack((p) => applySlotOffsetsToPack(p, target.slotOffsets));
      lastCoalesceRef.current = null;
      return prev.slice(1);
    });
  }, [captureSnapshot]);

  // Global keyboard shortcuts for Undo / Redo in editor mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (workspaceMode !== 'editor') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceMode, handleUndo, handleRedo]);

  // Persist local character library whenever it changes
  useEffect(() => {
    saveSavedCharacters(savedCharacters);
  }, [savedCharacters]);

  const applyDefaultPack = useCallback(
    async (ignoreAutosave = false) => {
      try {
        const sticker = await loadStickerHDPack();
        let nextPack = sticker.pack;
        let nextConfig: CharacterConfig;
        let nextPresetId = 'paladin';

        const autosave = ignoreAutosave ? null : loadStudioAutosave(sticker.pack.id);
        if (autosave) {
          const san = sanitizeCharacterConfig(autosave.config, sticker.pack);
          nextConfig = san.config;
          nextPresetId = autosave.activePresetId || 'custom';
          if (autosave.slotOffsets) {
            nextPack = applySlotOffsetsToPack(nextPack, autosave.slotOffsets);
          }
        } else {
          if (ignoreAutosave) clearStudioAutosave();
          const ch = new PaperDollCharacter(sticker.pack, {
            preset: 'paladin',
            direction: 'SE',
            action: 'idle',
          });
          nextConfig = ch.toJSON();
        }

        setPack(nextPack);
        setImages(sticker.images);
        setImagesVersion((v) => v + 1);
        setActivePresetId(nextPresetId);
        setConfig(nextConfig);
        setHistoryPast([]);
        setHistoryFuture([]);
        packReadyRef.current = true;
      } catch (err) {
        showToast(`资源包加载失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [showToast],
  );

  useEffect(() => {
    void applyDefaultPack(false);
  }, [applyDefaultPack]);

  // Debounced autosave of current editor character & slot offsets to localStorage
  useEffect(() => {
    if (!packReadyRef.current) return;
    const timer = window.setTimeout(() => {
      saveStudioAutosave({
        version: 1,
        packId: pack.id,
        activePresetId,
        config,
        slotOffsets: extractSlotOffsets(pack),
        updatedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [pack, config, activePresetId]);

  const globalFileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonImportInputRef = useRef<HTMLInputElement | null>(null);
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
    (mutator: (ch: PaperDollCharacter) => void, recordUndo = true) => {
      if (recordUndo) pushHistory();
      setConfig((prev) => {
        const ch = new PaperDollCharacter(pack, prev);
        mutator(ch);
        return ch.toJSON();
      });
    },
    [pack, pushHistory],
  );

  const handleSaveToLibrary = useCallback(() => {
    const presetLabel =
      pack.presets.find((p) => p.id === activePresetId)?.name.replace(/^\d+\s*·\s*/, '') ??
      '自定义角色';
    const trimmed = saveNameDraft.trim() || `${presetLabel} #${savedCharacters.length + 1}`;
    const existingIdx = savedCharacters.findIndex((c) => c.name === trimmed);
    const entry: SavedCharacterEntry = {
      id: existingIdx >= 0 ? savedCharacters[existingIdx]!.id : `char_${Date.now()}`,
      name: trimmed,
      updatedAt: Date.now(),
      config: cloneCharacterConfig(config),
    };
    setSavedCharacters((prev) => {
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = entry;
        return next;
      }
      return [entry, ...prev];
    });
    setSaveNameDraft('');
    showToast(existingIdx >= 0 ? `已覆盖角色库存档「${trimmed}」` : `已保存「${trimmed}」到本地角色库`);
  }, [pack.presets, activePresetId, saveNameDraft, savedCharacters, config, showToast]);

  const handleLoadFromLibrary = useCallback(
    (entry: SavedCharacterEntry) => {
      pushHistory();
      const san = sanitizeCharacterConfig(entry.config, pack);
      setConfig(san.config);
      setActivePresetId('custom');
      setLibraryOpen(false);
      showToast(`已载入角色「${entry.name}」`);
    },
    [pack, pushHistory, showToast],
  );

  const handleDeleteFromLibrary = useCallback(
    (entry: SavedCharacterEntry) => {
      setSavedCharacters((prev) => prev.filter((c) => c.id !== entry.id));
      showToast(`已删除角色「${entry.name}」`);
    },
    [showToast],
  );

  const handleExportProjectJson = useCallback(() => {
    const projectFile: StudioProjectFile = {
      kind: 'paperdollkit-project',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      packId: pack.id,
      activePresetId,
      config: cloneCharacterConfig(config),
      slotOffsets: extractSlotOffsets(pack),
      library: savedCharacters,
    };
    downloadTextFile('paperdoll-project.pdk.json', JSON.stringify(projectFile, null, 2));
    showToast(`已导出项目存档（含 ${savedCharacters.length} 个角色库条目与挂点偏移）`);
  }, [pack, activePresetId, config, savedCharacters, showToast]);

  const handleImportJsonFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const result = parseImportedProjectJson(text, pack);
        pushHistory();
        if (result.slotOffsets) {
          setPack((prev) => applySlotOffsetsToPack(prev, result.slotOffsets!));
        }
        if (result.config) {
          setConfig(result.config);
          setActivePresetId(result.activePresetId ?? 'custom');
        }
        if (result.importedLibrary && result.importedLibrary.length > 0) {
          setSavedCharacters((prev) => {
            const byId = new Map(prev.map((e) => [e.id, e]));
            for (const entry of result.importedLibrary!) {
              byId.set(entry.id, entry);
            }
            return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
          });
        }
        setLibraryOpen(false);
        const libNote = result.importedLibrary?.length
          ? `，合并 ${result.importedLibrary.length} 个角色库条目`
          : '';
        const warnNote = result.warnings.length > 0 ? `（${result.warnings.length} 条兼容提示）` : '';
        showToast(`已导入 "${file.name}"${libNote}${warnNote}`);
      } catch (err) {
        showToast(`JSON 导入失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [pack, pushHistory, showToast],
  );

  const handleGlobalImport = useCallback(
    async (files: File[]) => {
      try {
        const res = await importBrowserFiles(files, pack, images);
        pushHistory();
        setPack(res.pack);
        setImages(res.images);
        setImagesVersion((v) => v + 1);
        setLastReport(res.report);
        setLastAudit(auditAssetPack(res.pack, res.images));

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
    [pack, images, pushHistory, showToast],
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
        pushHistory();
        setPack(res.pack);
        setImages(res.images);
        setImagesVersion((v) => v + 1);
        setLastReport(res.report);
        setLastAudit(auditAssetPack(res.pack, res.images));

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
    [config, selectedSlotId, pack, images, pushHistory, showToast],
  );

  const handleDragSlotOffset = useCallback(
    (slotId: SlotId, dx: number, dy: number) => {
      pushHistory(`offset:${slotId}`);
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
    },
    [pushHistory],
  );

  const updateSelectedSlotOffset = (axis: 'x' | 'y', value: number) => {
    pushHistory(`offset:${selectedSlotId}:${axis}`);
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
        ref={jsonImportInputRef}
        type="file"
        accept=".json,.pdk.json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportJsonFile(file);
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
                  setLibraryOpen(false);
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
          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5 mr-0.5 border-r border-slate-800 pr-1.5">
            <button
              onClick={handleUndo}
              disabled={historyPast.length === 0}
              className="rounded border border-slate-700/80 bg-slate-800/80 p-1 text-slate-200 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition"
              title={`撤销 (Ctrl+Z) · 可撤销 ${historyPast.length} 步`}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyFuture.length === 0}
              className="rounded border border-slate-700/80 bg-slate-800/80 p-1 text-slate-200 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition"
              title={`重做 (Ctrl+Shift+Z) · 可重做 ${historyFuture.length} 步`}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

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
              onClick={() => {
                setLibraryOpen(false);
                setPresetWallOpen((v) => !v);
              }}
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
                pushHistory();
                const gen = generateSeededCharacter(pack, {
                  archetype: 'any',
                  direction: config.direction,
                  action: config.action,
                });
                setActivePresetId('custom');
                setConfig(gen.config);
                showToast(`已生成「${gen.archetypeLabel}」（种子: ${gen.seed}）`);
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition"
              title="按职业模板与协调配色规则随机生成角色"
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

          {/* Character Library & JSON Save/Load Popover */}
          <div className="relative">
            <button
              onClick={() => {
                setPresetWallOpen(false);
                setLibraryOpen((v) => !v);
              }}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition ${
                libraryOpen
                  ? 'border-emerald-400 bg-emerald-600/25 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title="本地角色库、自动保存与 JSON 项目存档导入/导出"
            >
              <Bookmark className="h-3.5 w-3.5 text-emerald-400" />
              <span>角色库</span>
              {savedCharacters.length > 0 && (
                <span className="rounded bg-emerald-500/20 px-1 font-mono text-[10px] text-emerald-300">
                  {savedCharacters.length}
                </span>
              )}
            </button>

            {libraryOpen && (
              <div className="absolute right-0 top-10 z-40 w-[360px] rounded-xl border border-slate-700/90 bg-slate-900/98 p-3 shadow-2xl backdrop-blur whitespace-normal">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">本地角色库 & 存档读写</span>
                  <span className="text-[10px] text-emerald-400/90">已开启自动保存</span>
                </div>

                {/* Save current character to library */}
                <div className="mb-2.5 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={saveNameDraft}
                    onChange={(e) => setSaveNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveToLibrary();
                    }}
                    placeholder="输入角色名称（留空自动命名）"
                    className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    onClick={handleSaveToLibrary}
                    className="flex shrink-0 items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                  >
                    <Save className="h-3 w-3" />
                    保存
                  </button>
                </div>

                {/* Saved characters list */}
                <div className="mb-2.5 max-h-[220px] space-y-1 overflow-y-auto pr-0.5">
                  {savedCharacters.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/50 py-4 text-center text-[11px] text-slate-500">
                      暂无已保存角色 · 点击上方「保存」可存入本地库并投放到 Playground
                    </div>
                  ) : (
                    savedCharacters.map((entry) => {
                      const swatch =
                        pack.palettes[entry.config.palettes.torso_top ?? 'cobalt']?.swatch ??
                        '#10b981';
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1.5 hover:border-slate-700"
                        >
                          <button
                            onClick={() => handleLoadFromLibrary(entry)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            title="点击载入编辑器"
                          >
                            <span
                              className="h-5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: swatch }}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-slate-100">
                                {entry.name}
                              </div>
                              <div className="text-[9px] text-slate-500">
                                {new Date(entry.updatedAt).toLocaleString('zh-CN', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() =>
                                downloadTextFile(
                                  `${entry.name}.json`,
                                  JSON.stringify(entry.config, null, 2),
                                )
                              }
                              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                              title="导出该角色 JSON"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteFromLibrary(entry)}
                              className="rounded p-1 text-slate-400 hover:bg-rose-950/60 hover:text-rose-300"
                              title="删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* JSON Import / Export footer */}
                <div className="grid grid-cols-3 gap-1.5 border-t border-slate-800 pt-2">
                  <button
                    onClick={() => jsonImportInputRef.current?.click()}
                    className="flex items-center justify-center gap-1 rounded border border-sky-500/40 bg-sky-600/20 px-2 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-600/35 transition"
                    title="导入单角色 JSON 或项目存档 .pdk.json"
                  >
                    <Upload className="h-3 w-3" />
                    导入 JSON
                  </button>
                  <button
                    onClick={() =>
                      downloadTextFile('character-v2.json', JSON.stringify(config, null, 2))
                    }
                    className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-200 hover:bg-slate-700 transition"
                    title="仅导出当前角色 JSON"
                  >
                    <FileJson className="h-3 w-3" />
                    导出角色
                  </button>
                  <button
                    onClick={handleExportProjectJson}
                    className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-200 hover:bg-slate-700 transition"
                    title="导出完整项目存档（含当前角色、挂点偏移和整个角色库）"
                  >
                    <Download className="h-3 w-3" />
                    项目存档
                  </button>
                </div>
              </div>
            )}
          </div>

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
          savedCharacters={savedCharacters}
          debugMaskView={debugMaskView}
          onToggleDebugMask={() => setDebugMaskView((v) => !v)}
          onEditActorInStudio={(actorCfg) => {
            pushHistory();
            setConfig(cloneCharacterConfig(actorCfg));
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
                void applyDefaultPack(true).then(() => showToast('已重置为默认角色并清除自动存档'));
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="重置默认 0xsu 风贴纸角色资产（清除自动存档）"
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
              const suppressed = evaluatedFrame.suppressedSlots?.[slot.id];

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
                      className={`w-full rounded border border-slate-700/80 bg-slate-950/90 px-1.5 py-0.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none ${
                        suppressed?.reason === 'hidden' ? 'opacity-55' : ''
                      }`}
                    >
                      {!slot.required && <option value="none">无</option>}
                      {partList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {suppressed && (
                    <div
                      className={`mt-1 truncate rounded px-1.5 py-0.5 text-[10px] ${
                        suppressed.reason === 'hidden'
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      }`}
                      title={
                        suppressed.reason === 'hidden'
                          ? `当前被「${suppressed.byPartName}」自动隐藏，摘下后自动恢复`
                          : `当前被「${suppressed.byPartName}」自动切换为「${suppressed.overridePartName}」，摘下后恢复原选择`
                      }
                    >
                      {suppressed.reason === 'hidden'
                        ? `规则：被「${suppressed.byPartName}」自动隐藏`
                        : `规则：被「${suppressed.byPartName}」收束为「${suppressed.overridePartName}」`}
                    </div>
                  )}
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
          {/* 8-Direction Isometric Compass */}
          <section>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>等距 8 向朝向（5 原始 + 3 镜像）</span>
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
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-slate-400 space-y-1">
                <div className="font-medium text-slate-200">最近导入与质检报告</div>
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
                {lastAudit && (
                  <div
                    className={`rounded border px-1.5 py-1 text-[10px] space-y-0.5 ${
                      lastAudit.errorCount > 0
                        ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                        : lastAudit.warningCount > 0
                          ? 'border-amber-500/40 bg-amber-950/25 text-amber-200'
                          : 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300'
                    }`}
                  >
                    <div className="font-semibold">
                      资产质检：{lastAudit.errorCount === 0 ? '通过' : `${lastAudit.errorCount} 项错误`}
                      {lastAudit.warningCount > 0 ? ` · ${lastAudit.warningCount} 项提示` : ''}
                    </div>
                    {lastAudit.issues.slice(0, 3).map((iss, idx) => (
                      <div key={idx} className="truncate">
                        • [{iss.slotId}/{iss.partId}] {iss.message}
                      </div>
                    ))}
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
