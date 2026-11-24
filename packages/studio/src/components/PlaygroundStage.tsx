import {
  PaperDollCharacter,
  generateSeededCharacter,
  type AssetPackManifest,
  type CharacterConfig,
  type DirectionId,
} from '@paperdollkit/core';
import type { ImportedImage } from '@paperdollkit/importers';
import {
  createPaperDollRenderer,
  type PaperDollRenderer,
} from '@paperdollkit/renderer-webgl2';
import {
  Copy,
  Dices,
  Edit3,
  Footprints,
  Gamepad2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Swords,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedCharacterEntry } from '../utils/character-library.ts';

export interface PlaygroundActor {
  id: string;
  label: string;
  presetId: string;
  config: CharacterConfig;
  /** World X coordinate of the character's foot origin (stage center = 0). */
  x: number;
  /** World Y coordinate of the character's foot origin (used for isometric Y-sorting!). */
  y: number;
  scale: number;
  /** Per-actor animation phase offset so crowds don't march in robotic lockstep. */
  timeOffsetMs: number;
  /** Simulation timestamp (ms) when the current action started (needed for attack/cast/hit clips). */
  actionStartedAtMs: number;
  /** Active movement waypoint (for double-click move or AI roam). */
  targetX: number | null;
  targetY: number | null;
  /** AI roam cooldown timer (ms) before picking next waypoint. */
  aiWaitMs: number;
}

type StageBackdrop = 'blank_dark' | 'blank_light' | 'iso_grid' | 'meadow';

interface PlaygroundStageProps {
  active: boolean;
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
  imagesVersion: number;
  currentEditorConfig: CharacterConfig;
  currentEditorPresetName: string;
  savedCharacters?: SavedCharacterEntry[];
  debugMaskView: boolean;
  onToggleDebugMask: () => void;
  onEditActorInStudio: (config: CharacterConfig) => void;
  onToast: (msg: string) => void;
}

const DIRECTION_COMPASS_GRID: Array<DirectionId | null> = [
  'NW', 'N', 'NE',
  'W',  null, 'E',
  'SW', 'S', 'SE',
];

const ACTION_OPTIONS = [
  { id: 'idle', label: '待机' },
  { id: 'walk', label: '行走' },
  { id: 'attack', label: '挥击' },
  { id: 'cast', label: '施法' },
  { id: 'hit', label: '受击' },
];

function cloneConfig(cfg: CharacterConfig): CharacterConfig {
  return {
    ...cfg,
    slots: { ...cfg.slots },
    palettes: { ...cfg.palettes },
  };
}

function vectorToDirection8(dx: number, dy: number): DirectionId {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= -22.5 && deg < 22.5) return 'E';
  if (deg >= 22.5 && deg < 67.5) return 'SE';
  if (deg >= 67.5 && deg < 112.5) return 'S';
  if (deg >= 112.5 && deg < 157.5) return 'SW';
  if (deg >= 157.5 || deg < -157.5) return 'W';
  if (deg >= -157.5 && deg < -112.5) return 'NW';
  if (deg >= -112.5 && deg < -67.5) return 'N';
  return 'NE';
}

function directionToAngleRad(dir: DirectionId): number {
  const map: Record<DirectionId, number> = {
    E: 0,
    SE: Math.PI * 0.25,
    S: Math.PI * 0.5,
    SW: Math.PI * 0.75,
    W: Math.PI,
    NW: -Math.PI * 0.75,
    N: -Math.PI * 0.5,
    NE: -Math.PI * 0.25,
  };
  return map[dir] ?? 0;
}

interface StageVfx {
  id: string;
  type: 'slash' | 'cast';
  x: number;
  y: number;
  angleRad: number;
  createdAtMs: number;
  durationMs: number;
  hitCount: number;
  comboStep?: number;
}

function createRandomConfig(pack: AssetPackManifest): CharacterConfig {
  return generateSeededCharacter(pack, {
    archetype: 'any',
    randomDirection: true,
    action: 'idle',
  }).config;
}

export function PlaygroundStage({
  active,
  pack,
  images,
  imagesVersion,
  currentEditorConfig,
  currentEditorPresetName,
  savedCharacters = [],
  debugMaskView,
  onToggleDebugMask,
  onEditActorInStudio,
  onToast,
}: PlaygroundStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PaperDollRenderer | null>(null);

  const [actors, setActors] = useState<PlaygroundActor[]>([]);
  const actorsRef = useRef<PlaygroundActor[]>([]);
  actorsRef.current = actors;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const [backdrop, setBackdrop] = useState<StageBackdrop>('blank_dark');
  const [stageZoom, setStageZoom] = useState(0.85);
  const [stagePan, setStagePan] = useState({ x: 0, y: 18 });
  const stageZoomRef = useRef(stageZoom);
  stageZoomRef.current = stageZoom;
  const stagePanRef = useRef(stagePan);
  stagePanRef.current = stagePan;

  const [size, setSize] = useState({ width: 820, height: 600 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [isPlaying, setIsPlaying] = useState(true);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const [speed, setSpeed] = useState(1.0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const [roamEnabled, setRoamEnabled] = useState(false);
  const roamRef = useRef(roamEnabled);
  roamRef.current = roamEnabled;

  const [wasdEnabled, setWasdEnabled] = useState(false);
  const wasdRef = useRef(wasdEnabled);
  wasdRef.current = wasdEnabled;
  const keysPressedRef = useRef<Set<string>>(new Set());
  const heroActionLockUntilRef = useRef(0);

  const [vfxList, setVfxList] = useState<StageVfx[]>([]);
  const vfxListRef = useRef<StageVfx[]>([]);
  vfxListRef.current = vfxList;

  const [activeBatchAction, setActiveBatchAction] = useState<string | null>('idle');
  const [showLabels, setShowLabels] = useState(true);
  const [fps, setFps] = useState(60);
  const [frameTimeMs, setFrameTimeMs] = useState(16.7);
  const [totalLayersDrawn, setTotalLayersDrawn] = useState(0);

  const nextActorSeqRef = useRef(1);
  const spawnCounterRef = useRef(0);
  const simTimeRef = useRef(0);
  const debugMaskRef = useRef(debugMaskView);
  debugMaskRef.current = debugMaskView;

  const dragRef = useRef<
    | { mode: 'actor'; actorId: string; offsetX: number; offsetY: number }
    | { mode: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
    | null
  >(null);

  // Initialize dedicated WebGL2 / Canvas2D renderer for the multi-character stage
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createPaperDollRenderer(canvas, 'webgl2');
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.invalidateAll();
  }, [imagesVersion]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const syncSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({
          width: Math.max(240, Math.floor(rect.width)),
          height: Math.max(240, Math.floor(rect.height)),
        });
      }
    };
    if (active) syncSize();
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      setSize({
        width: Math.max(240, Math.floor(rect.width)),
        height: Math.max(240, Math.floor(rect.height)),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  // Compute non-overlapping golden-angle spiral spawn position near stage center
  const getNextSpawnPos = useCallback(() => {
    const idx = spawnCounterRef.current++;
    if (idx === 0) return { x: 0, y: 18 };
    const angle = idx * 2.3999632; // golden angle
    const radius = 92 + Math.min(280, Math.sqrt(idx) * 76);
    return {
      x: Math.round(Math.cos(angle) * radius * 1.35),
      y: Math.round(Math.sin(angle) * radius * 0.72),
    };
  }, []);

  const spawnActorFromConfig = useCallback(
    (
      cfg: CharacterConfig,
      label: string,
      presetId: string,
      pos?: { x: number; y: number },
      scale = 1,
    ): PlaygroundActor => {
      const id = `actor_${nextActorSeqRef.current++}`;
      const p = pos ?? getNextSpawnPos();
      return {
        id,
        label,
        presetId,
        config: cloneConfig(cfg),
        x: p.x,
        y: p.y,
        scale,
        timeOffsetMs: Math.floor(Math.random() * 600),
        actionStartedAtMs: simTimeRef.current,
        targetX: null,
        targetY: null,
        aiWaitMs: 300 + Math.random() * 1200,
      };
    },
    [getNextSpawnPos],
  );

  const handleAddPreset = useCallback(
    (presetId: string) => {
      const preset = pack.presets.find((p) => p.id === presetId);
      if (!preset) return;
      const ch = new PaperDollCharacter(pack);
      ch.applyPreset(preset.id);
      const dirs: DirectionId[] = ['SE', 'S', 'SW'];
      ch.setDirection(dirs[spawnCounterRef.current % dirs.length]!);
      ch.setAction('idle');
      const actor = spawnActorFromConfig(ch.toJSON(), preset.name.replace(/^\d+\s*·\s*/, ''), preset.id);
      setActors((prev) => [...prev, actor]);
      setSelectedId(actor.id);
    },
    [pack, spawnActorFromConfig],
  );

  const handleAddCurrentEditor = useCallback(() => {
    const label = currentEditorPresetName.replace(/^\d+\s*·\s*/, '') || '当前编辑角色';
    const actor = spawnActorFromConfig(currentEditorConfig, `${label} (自定义)`, 'custom');
    setActors((prev) => [...prev, actor]);
    setSelectedId(actor.id);
    onToast(`已将「${label}」添加到多人场景`);
  }, [currentEditorConfig, currentEditorPresetName, spawnActorFromConfig, onToast]);

  const handleAddSavedCharacter = useCallback(
    (entry: SavedCharacterEntry) => {
      const actor = spawnActorFromConfig(entry.config, entry.name, `saved:${entry.id}`);
      setActors((prev) => [...prev, actor]);
      setSelectedId(actor.id);
      onToast(`已从角色库投放「${entry.name}」`);
    },
    [spawnActorFromConfig, onToast],
  );

  const handleAddRandom = useCallback(() => {
    const cfg = createRandomConfig(pack);
    const actor = spawnActorFromConfig(cfg, `随机勇者 #${nextActorSeqRef.current}`, 'random');
    setActors((prev) => [...prev, actor]);
    setSelectedId(actor.id);
  }, [pack, spawnActorFromConfig]);

  const handleSpawnParty5 = useCallback(() => {
    const partyIds = ['knight', 'paladin', 'mage', 'ranger', 'assassin'];
    const formation: Array<{ x: number; y: number; dir: DirectionId }> = [
      { x: 0, y: 95, dir: 'SE' },
      { x: -165, y: 20, dir: 'SE' },
      { x: 165, y: 20, dir: 'SW' },
      { x: -100, y: -80, dir: 'SE' },
      { x: 100, y: -80, dir: 'SW' },
    ];
    const spawned: PlaygroundActor[] = [];
    partyIds.forEach((pid, i) => {
      const preset = pack.presets.find((p) => p.id === pid) ?? pack.presets[i % pack.presets.length];
      if (!preset) return;
      const ch = new PaperDollCharacter(pack);
      ch.applyPreset(preset.id);
      ch.setDirection(formation[i]!.dir);
      ch.setAction('idle');
      spawned.push(
        spawnActorFromConfig(
          ch.toJSON(),
          preset.name.replace(/^\d+\s*·\s*/, ''),
          preset.id,
          { x: formation[i]!.x, y: formation[i]!.y },
        ),
      );
    });
    setActors((prev) => [...prev, ...spawned]);
    if (spawned[0]) setSelectedId(spawned[0].id);
    onToast('已生成 5 人冒险小队阵型');
  }, [pack, spawnActorFromConfig, onToast]);

  const handleSpawnCrowd10 = useCallback(() => {
    const pool = pack.presets.filter((p) => p.id !== 'mannequin');
    const dirs: DirectionId[] = ['S', 'SE', 'SW', 'E', 'W'];
    const spawned: PlaygroundActor[] = [];
    for (let i = 0; i < 10; i++) {
      const preset = pool[Math.floor(Math.random() * pool.length)] ?? pack.presets[0];
      if (!preset) continue;
      const ch = new PaperDollCharacter(pack);
      ch.applyPreset(preset.id);
      ch.setDirection(dirs[Math.floor(Math.random() * dirs.length)]!);
      ch.setAction('idle');
      const pos = {
        x: Math.round((Math.random() - 0.5) * 460),
        y: Math.round((Math.random() - 0.5) * 260),
      };
      spawned.push(
        spawnActorFromConfig(ch.toJSON(), preset.name.replace(/^\d+\s*·\s*/, ''), preset.id, pos),
      );
    }
    setActors((prev) => [...prev, ...spawned]);
    onToast('已批量添加 10 名角色，可开启「自由漫游」测试多人遮挡与帧率');
  }, [pack, spawnActorFromConfig, onToast]);

  const handleSpawnCrowd25 = useCallback(() => {
    const pool = pack.presets.filter((p) => p.id !== 'mannequin');
    const dirs: DirectionId[] = ['S', 'SE', 'SW', 'E', 'W', 'NE', 'NW'];
    const spawned: PlaygroundActor[] = [];
    for (let i = 0; i < 25; i++) {
      const preset = pool[Math.floor(Math.random() * pool.length)] ?? pack.presets[0];
      if (!preset) continue;
      const ch = new PaperDollCharacter(pack);
      ch.applyPreset(preset.id);
      ch.setDirection(dirs[Math.floor(Math.random() * dirs.length)]!);
      ch.setAction('idle');
      const pos = {
        x: Math.round((Math.random() - 0.5) * 620),
        y: Math.round((Math.random() - 0.5) * 340),
      };
      spawned.push(
        spawnActorFromConfig(ch.toJSON(), preset.name.replace(/^\d+\s*·\s*/, ''), preset.id, pos),
      );
    }
    setActors((prev) => [...prev, ...spawned]);
    onToast('已投放 +25 极限压测角色群，请观察右上角 FPS 与帧耗时');
  }, [pack, spawnActorFromConfig, onToast]);

  const handleClearAll = useCallback(() => {
    setActors([]);
    setSelectedId(null);
    spawnCounterRef.current = 0;
    onToast('已清空多人场景');
  }, [onToast]);

  const handleBatchAction = useCallback((actionId: string) => {
    setRoamEnabled(false);
    setActiveBatchAction(actionId);
    setIsPlaying(true);
    const nowSim = simTimeRef.current;
    setActors((prev) =>
      prev.map((a, idx) => ({
        ...a,
        targetX: null,
        targetY: null,
        actionStartedAtMs: nowSim,
        timeOffsetMs: (idx % 6) * 55,
        config: { ...a.config, action: actionId },
      })),
    );
  }, []);

  const updateSelectedActor = useCallback(
    (updater: (actor: PlaygroundActor) => PlaygroundActor) => {
      setActors((prev) => prev.map((a) => (a.id === selectedId ? updater(a) : a)));
    },
    [selectedId],
  );

  const handleDuplicateSelected = useCallback(() => {
    const src = actors.find((a) => a.id === selectedId);
    if (!src) return;
    const dup = spawnActorFromConfig(
      src.config,
      `${src.label} 副本`,
      src.presetId,
      { x: src.x + 48, y: src.y + 18 },
      src.scale,
    );
    setActors((prev) => [...prev, dup]);
    setSelectedId(dup.id);
  }, [actors, selectedId, spawnActorFromConfig]);

  const handleDeleteActor = useCallback((id: string) => {
    setActors((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const heroComboRef = useRef({ step: 0, lastAtMs: 0 });

  // Keyboard listener for Playable Hero WASD + Space/J (3-Hit Combo Attack + Hitbox) + K (Cast VFX)
  useEffect(() => {
    if (!active || !wasdEnabled) {
      keysPressedRef.current.clear();
      return;
    }

    const triggerHeroSkill = (skill: 'attack' | 'cast') => {
      const list = actorsRef.current;
      const hero = list.find((a) => a.id === selectedIdRef.current) ?? list[0];
      if (!hero) return;
      if (!selectedIdRef.current) setSelectedId(hero.id);

      const nowSim = simTimeRef.current;
      const nowPerf = performance.now();
      let comboStep = 1;
      if (skill === 'attack') {
        const prev = heroComboRef.current;
        comboStep = nowPerf - prev.lastAtMs <= 1100 ? (prev.step % 3) + 1 : 1;
        heroComboRef.current = { step: comboStep, lastAtMs: nowPerf };
      }

      hero.config.action = skill;
      hero.actionStartedAtMs = nowSim;
      hero.timeOffsetMs = 0;
      hero.targetX = null;
      hero.targetY = null;
      heroActionLockUntilRef.current = nowSim + (skill === 'attack' ? (comboStep === 3 ? 480 : 380) : 540);

      const angleRad = directionToAngleRad(hero.config.direction);
      const hitCenterX = hero.x + Math.cos(angleRad) * (comboStep === 3 ? 64 : 56);
      const hitCenterY = hero.y + Math.sin(angleRad) * (comboStep === 3 ? 44 : 38);
      const hitRadius = comboStep === 3 ? 125 : 95;
      let hitCount = 0;

      if (skill === 'attack') {
        for (const other of list) {
          if (other.id === hero.id) continue;
          const dist = Math.hypot(other.x - hitCenterX, (other.y - hitCenterY) * 1.35);
          if (dist <= hitRadius) {
            other.config.action = 'hit';
            other.actionStartedAtMs = nowSim;
            other.timeOffsetMs = 0;
            other.targetX = null;
            other.targetY = null;
            hitCount++;
          }
        }
      }

      const newVfx: StageVfx = {
        id: `vfx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: skill === 'attack' ? 'slash' : 'cast',
        x: skill === 'attack' ? hitCenterX : hero.x,
        y: skill === 'attack' ? hitCenterY : hero.y,
        angleRad,
        createdAtMs: nowPerf,
        durationMs: skill === 'attack' ? (comboStep === 3 ? 420 : 320) : 520,
        hitCount,
        comboStep: skill === 'attack' ? comboStep : undefined,
      };
      setVfxList((prev) => [...prev.slice(-10), newVfx]);
      setActors((prev) => [...prev]);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const code = e.code;
      if (
        code === 'KeyW' ||
        code === 'KeyA' ||
        code === 'KeyS' ||
        code === 'KeyD' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight'
      ) {
        e.preventDefault();
        keysPressedRef.current.add(code);
      } else if (code === 'Space' || code === 'KeyJ') {
        e.preventDefault();
        if (!e.repeat) triggerHeroSkill('attack');
      } else if (code === 'KeyK') {
        e.preventDefault();
        if (!e.repeat) triggerHeroSkill('cast');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current.delete(e.code);
    };

    const onBlur = () => {
      keysPressedRef.current.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, wasdEnabled]);

  // Main 60FPS animation + AI roaming + Y-sorted multi-character WebGL2 render loop
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lastTs = performance.now();
    let fpsFrames = 0;
    let fpsAccum = 0;
    let uiSyncAccum = 0;

    const tick = (now: number) => {
      const dtMs = Math.min(50, Math.max(0, now - lastTs));
      lastTs = now;

      fpsFrames++;
      fpsAccum += dtMs;
      if (fpsAccum >= 450) {
        setFps(Math.round((fpsFrames * 1000) / fpsAccum));
        setFrameTimeMs(Math.round((fpsAccum / fpsFrames) * 10) / 10);
        fpsFrames = 0;
        fpsAccum = 0;
      }

      // Expire finished slash / cast VFX
      if (vfxListRef.current.length > 0) {
        const alive = vfxListRef.current.filter((v) => now - v.createdAtMs < v.durationMs);
        if (alive.length !== vfxListRef.current.length) {
          setVfxList(alive);
        }
      }

      if (isPlayingRef.current) {
        const scaledDt = dtMs * speedRef.current;
        simTimeRef.current += scaledDt;

        // Update locomotion / WASD hero / AI roaming directly on actor objects for smooth 60FPS motion
        const list = actorsRef.current;
        const roam = roamRef.current;
        const walkSpeedPxPerSec = 82;
        const moveStep = (walkSpeedPxPerSec * scaledDt) / 1000;
        const halfW = Math.max(180, (sizeRef.current.width * 0.42) / stageZoomRef.current);
        const halfH = Math.max(110, (sizeRef.current.height * 0.36) / stageZoomRef.current);
        let movedAny = false;

        // Controlled hero WASD input
        const controlledHeroId =
          wasdRef.current && list.length > 0
            ? (list.find((a) => a.id === selectedIdRef.current)?.id ?? list[0]!.id)
            : null;
        const keys = keysPressedRef.current;
        const vx =
          (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
          (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        const vy =
          (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
          (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);

        for (const actor of list) {
          if (dragRef.current?.mode === 'actor' && dragRef.current.actorId === actor.id) {
            continue;
          }

          if (controlledHeroId && actor.id === controlledHeroId) {
            const locked = simTimeRef.current < heroActionLockUntilRef.current;
            if (vx !== 0 || vy !== 0) {
              const len = Math.hypot(vx, vy) || 1;
              const heroStep = (145 * scaledDt) / 1000;
              actor.x += (vx / len) * heroStep;
              actor.y += (vy / len) * heroStep * 0.75; // isometric Y compression
              actor.config.direction = vectorToDirection8(vx, vy);
              actor.targetX = null;
              actor.targetY = null;
              if (!locked) {
                actor.config.action = 'walk';
              }
              movedAny = true;
            } else if (!locked && actor.config.action !== 'idle') {
              actor.config.action = 'idle';
              movedAny = true;
            }
            continue;
          }

          if (actor.targetX !== null && actor.targetY !== null) {
            const dx = actor.targetX - actor.x;
            const dy = actor.targetY - actor.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= Math.max(3, moveStep)) {
              actor.x = actor.targetX;
              actor.y = actor.targetY;
              actor.targetX = null;
              actor.targetY = null;
              actor.config.action = roam && Math.random() < 0.25 ? 'attack' : 'idle';
              actor.actionStartedAtMs = simTimeRef.current;
              actor.aiWaitMs = 500 + Math.random() * 1400;
              movedAny = true;
            } else {
              actor.x += (dx / dist) * moveStep;
              actor.y += (dy / dist) * moveStep;
              actor.config.direction = vectorToDirection8(dx, dy);
              actor.config.action = 'walk';
              movedAny = true;
            }
          } else if (roam) {
            actor.aiWaitMs -= scaledDt;
            if (actor.aiWaitMs <= 0) {
              actor.targetX = Math.round((Math.random() * 2 - 1) * halfW);
              actor.targetY = Math.round((Math.random() * 2 - 1) * halfH);
              movedAny = true;
            }
          }
        }

        // Periodically sync overlay badges / coordinates smoothly without spamming React state every frame
        uiSyncAccum += dtMs;
        if (movedAny && uiSyncAccum >= 66) {
          uiSyncAccum = 0;
          setActors((prev) => [...prev]);
        }
      }

      // Render all characters in strict Y-sorted isometric depth order on one WebGL2 canvas
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (canvas && renderer) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const targetW = Math.floor(sizeRef.current.width * dpr);
        const targetH = Math.floor(sizeRef.current.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        renderer.clear([0, 0, 0, 0]);

        const sorted = [...actorsRef.current].sort((a, b) => a.y - b.y);
        const z = stageZoomRef.current;
        const p = stagePanRef.current;
        const canvasH = pack.canvasSize.height;
        let layerSum = 0;

        for (const actor of sorted) {
          const ch = new PaperDollCharacter(pack, actor.config);
          const clip = pack.animations[actor.config.action];
          const durationMs = Math.max(1, clip?.durationMs ?? 1000);
          const elapsedMs = Math.max(0, simTimeRef.current - actor.actionStartedAtMs + actor.timeOffsetMs);
          // Wrap modulo clip duration so non-looping clips (attack/cast/hit) repeat cleanly in Playground preview
          const localTimeMs = elapsedMs % durationMs;
          const frame = ch.evaluate(localTimeMs);
          layerSum += frame.layers.length;

          const panXCss = p.x + actor.x * z;
          const panYCss = p.y + actor.y * z - 0.375 * canvasH * actor.scale * z;

          const hitElapsed = simTimeRef.current - actor.actionStartedAtMs;
          const hitFlash =
            actor.config.action === 'hit' && hitElapsed >= 0 && hitElapsed < 240
              ? Math.max(0, 1 - hitElapsed / 240)
              : 0;

          renderer.render(pack, frame, images, {
            clearBeforeRender: false,
            zoom: z * actor.scale * dpr,
            panX: panXCss * dpr,
            panY: panYCss * dpr,
            debugMaskView: debugMaskRef.current,
            vfx: hitFlash > 0.01 ? { flashAmount: hitFlash, flashColor: [1, 1, 1] } : undefined,
          });
        }

        if (fpsFrames === 1) {
          setTotalLayersDrawn(layerSum);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, pack, images]);

  // Coordinate helpers between stage world (foot origin) and viewport CSS pixels
  const worldToScreen = (wx: number, wy: number) => ({
    x: size.width * 0.5 + stagePan.x + wx * stageZoom,
    y: size.height * 0.5 + stagePan.y + wy * stageZoom,
  });

  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - size.width * 0.5 - stagePan.x) / stageZoom,
    y: (sy - size.height * 0.5 - stagePan.y) / stageZoom,
  });

  const hitTestActor = (sx: number, sy: number): PlaygroundActor | null => {
    // Check front-most (largest Y) actors first
    const sortedFrontFirst = [...actorsRef.current].sort((a, b) => b.y - a.y);
    for (const actor of sortedFrontFirst) {
      const foot = worldToScreen(actor.x, actor.y);
      const halfW = 42 * actor.scale * stageZoom;
      const topH = 128 * actor.scale * stageZoom;
      const botH = 14 * actor.scale * stageZoom;
      if (
        sx >= foot.x - halfW &&
        sx <= foot.x + halfW &&
        sy >= foot.y - topH &&
        sy <= foot.y + botH
      ) {
        return actor;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Right-click commands selected actor to walk to clicked point
    if (e.button === 2) {
      e.preventDefault();
      if (selectedIdRef.current) {
        const pt = screenToWorld(sx, sy);
        setActors((prev) =>
          prev.map((a) =>
            a.id === selectedIdRef.current
              ? { ...a, targetX: Math.round(pt.x), targetY: Math.round(pt.y) }
              : a,
          ),
        );
      }
      return;
    }

    if (e.button === 0) {
      const hit = hitTestActor(sx, sy);
      if (hit) {
        setSelectedId(hit.id);
        const worldPt = screenToWorld(sx, sy);
        // Cancel active walk target while manually dragging
        hit.targetX = null;
        hit.targetY = null;
        dragRef.current = {
          mode: 'actor',
          actorId: hit.id,
          offsetX: hit.x - worldPt.x,
          offsetY: hit.y - worldPt.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      // Clicked blank background -> deselect & pan stage
      setSelectedId(null);
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: stagePan.x,
        origPanY: stagePan.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (e.button === 1) {
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: stagePan.x,
        origPanY: stagePan.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setStagePan({
        x: d.origPanX + (e.clientX - d.startX),
        y: d.origPanY + (e.clientY - d.startY),
      });
    } else if (d.mode === 'actor') {
      const rect = e.currentTarget.getBoundingClientRect();
      const pt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const nx = Math.round(pt.x + d.offsetX);
      const ny = Math.round(pt.y + d.offsetY);
      setActors((prev) => prev.map((a) => (a.id === d.actorId ? { ...a, x: nx, y: ny } : a)));
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedIdRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    setActors((prev) =>
      prev.map((a) =>
        a.id === selectedIdRef.current
          ? { ...a, targetX: Math.round(pt.x), targetY: Math.round(pt.y) }
          : a,
      ),
    );
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setStageZoom((z) => Math.max(0.4, Math.min(3.0, Number((z * factor).toFixed(2)))));
  };

  const selectedActor = actors.find((a) => a.id === selectedId) ?? null;

  // Backdrop visual styles
  const backdropStyle: Record<StageBackdrop, string> = {
    blank_dark: 'bg-[#0b1020]',
    blank_light: 'bg-[#f4f6fa]',
    iso_grid: 'bg-[#0c1222]',
    meadow: 'bg-[#253629]',
  };
  const isLightBackdrop = backdrop === 'blank_light';

  // Optional subtle isometric floor grid
  const origin = worldToScreen(0, 0);
  const isoLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (backdrop === 'iso_grid' || backdrop === 'meadow') {
    const tileW = 64 * stageZoom;
    const tileH = 32 * stageZoom;
    const radius = 8;
    for (let i = -radius; i <= radius; i++) {
      isoLines.push({
        x1: origin.x + (i - radius) * tileW * 0.5,
        y1: origin.y + (i + radius) * tileH * 0.5,
        x2: origin.x + (i + radius) * tileW * 0.5,
        y2: origin.y + (i - radius) * tileH * 0.5,
      });
      isoLines.push({
        x1: origin.x + (-radius - i) * tileW * 0.5,
        y1: origin.y + (-radius + i) * tileH * 0.5,
        x2: origin.x + (radius - i) * tileW * 0.5,
        y2: origin.y + (radius + i) * tileH * 0.5,
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left Panel: Spawn & Add Characters to Blank Scene */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800/90 bg-slate-900/60">
        <div className="border-b border-slate-800 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">添加纸片人到场景</span>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
              场上 {actors.length} 人
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            点击任意预设即可投放到空白场景中，支持拖拽排位与 Y 轴深度遮挡。
          </p>

          <button
            onClick={handleAddCurrentEditor}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-500 transition"
          >
            <UserPlus className="h-3.5 w-3.5" />
            添加当前编辑器角色
          </button>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={handleAddRandom}
              className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Dices className="h-3.5 w-3.5 text-amber-400" />
              随机 +1
            </button>
            <button
              onClick={handleSpawnParty5}
              className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Users className="h-3.5 w-3.5 text-emerald-400" />
              5 人小队
            </button>
            <button
              onClick={handleSpawnCrowd10}
              className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              +10 压测
            </button>
            <button
              onClick={handleSpawnCrowd25}
              className="flex items-center justify-center gap-1 rounded border border-amber-500/35 bg-amber-950/35 px-2 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50 transition"
              title="一次性投放 25 名角色进行同屏合批极限性能压测"
            >
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              +25 极限压测
            </button>
            <button
              onClick={handleClearAll}
              disabled={actors.length === 0}
              className="col-span-2 flex items-center justify-center gap-1 rounded border border-rose-500/30 bg-rose-950/40 px-2 py-1.5 text-[11px] font-medium text-rose-200 hover:bg-rose-900/50 disabled:opacity-40 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空场景
            </button>
          </div>
        </div>

        {/* Saved Character Library + 1 + 16 Presets Spawn Palette */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {savedCharacters.length > 0 && (
            <div className="mb-2 space-y-1 border-b border-slate-800/80 pb-2">
              <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                本地角色库 ({savedCharacters.length})
              </div>
              {savedCharacters.map((entry) => {
                const swatch =
                  pack.palettes[entry.config.palettes.torso_top ?? 'cobalt']?.swatch ?? '#10b981';
                return (
                  <button
                    key={entry.id}
                    onClick={() => handleAddSavedCharacter(entry)}
                    className="group flex w-full items-center justify-between rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-1.5 text-left hover:border-emerald-400/60 hover:bg-emerald-950/40 transition"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-5 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: swatch }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-emerald-100">
                          {entry.name}
                        </div>
                        <div className="truncate text-[9px] text-emerald-400/70">已保存自定义</div>
                      </div>
                    </div>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-emerald-500/70 group-hover:text-emerald-300 transition" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            点击投放预设角色 ({pack.presets.length})
          </div>
          {pack.presets.map((p) => {
            const swatch =
              p.id === 'mannequin'
                ? pack.skins.wood?.swatch ?? '#cfa06b'
                : pack.palettes[p.palettes.torso_top ?? 'cobalt']?.swatch ?? '#2e6bd1';
            return (
              <button
                key={p.id}
                onClick={() => handleAddPreset(p.id)}
                className="group flex w-full items-center justify-between rounded-lg border border-slate-800/90 bg-slate-950/60 px-2.5 py-1.5 text-left hover:border-sky-500/60 hover:bg-slate-800/70 transition"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-5 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: swatch }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-100">
                      {p.name}
                    </div>
                    <div className="truncate text-[9px] text-slate-400">{p.tag}</div>
                  </div>
                </div>
                <Plus className="h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-sky-400 transition" />
              </button>
            );
          })}
        </div>
      </aside>

      {/* Center Blank Stage + Bottom Crowd Controls */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top Stage Utility Bar */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/75 px-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">场景底图:</span>
            {(
              [
                ['blank_dark', '深色空白'],
                ['blank_light', '纯白画布'],
                ['iso_grid', '等距网格'],
                ['meadow', '草地沙盘'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setBackdrop(id)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  backdrop === id
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setWasdEnabled((prev) => {
                  const next = !prev;
                  if (next) {
                    setIsPlaying(true);
                    if (!selectedIdRef.current && actorsRef.current[0]) {
                      setSelectedId(actorsRef.current[0].id);
                    }
                    onToast('已开启 WASD 操控：WASD/方向键移动，Space/J 挥击(带命中判定)，K 施法');
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border transition ${
                wasdEnabled
                  ? 'border-emerald-400/70 bg-emerald-500/25 text-emerald-200 shadow-sm'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
              title="使用键盘 WASD/方向键操控选中角色行走，Space/J 攻击挥砍(触发受击)，K 施放法术环"
            >
              <Gamepad2 className="h-3 w-3" />
              WASD 操控
            </button>
            <button
              onClick={() => setShowLabels((v) => !v)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] border transition ${
                showLabels
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              <Tag className="h-3 w-3" />
              名牌
            </button>
            <button
              onClick={onToggleDebugMask}
              className={`rounded px-2 py-0.5 text-[11px] border transition ${
                debugMaskView
                  ? 'border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-200'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              Mask 视图
            </button>
            <button
              onClick={() => {
                setStageZoom(0.85);
                setStagePan({ x: 0, y: 18 });
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white transition"
              title="重置视角"
            >
              <RotateCcw className="h-3 w-3" />
              重置视角
            </button>
          </div>
        </div>

        {/* Interactive Multi-Actor Canvas */}
        <div
          ref={containerRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
          className={`relative flex-1 overflow-hidden select-none cursor-grab active:cursor-grabbing ${backdropStyle[backdrop]}`}
        >
          {/* Optional Isometric Floor Grid */}
          {isoLines.length > 0 && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <g
                stroke={backdrop === 'meadow' ? 'rgba(187, 247, 208, 0.14)' : 'rgba(148, 163, 184, 0.14)'}
                strokeWidth="1"
              >
                {isoLines.map((l, idx) => (
                  <line key={idx} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
                ))}
              </g>
            </svg>
          )}

          {/* Selection Foot Ring & Waypoint Indicators (rendered under WebGL characters) */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {actors.map((actor) => {
              const isSel = actor.id === selectedId;
              const foot = worldToScreen(actor.x, actor.y);
              const rx = 28 * actor.scale * stageZoom;
              const ry = 13 * actor.scale * stageZoom;
              const target =
                actor.targetX !== null && actor.targetY !== null
                  ? worldToScreen(actor.targetX, actor.targetY)
                  : null;
              return (
                <g key={actor.id}>
                  {isSel && (
                    <>
                      <ellipse
                        cx={foot.x}
                        cy={foot.y}
                        rx={rx}
                        ry={ry}
                        fill="rgba(56, 189, 248, 0.16)"
                        stroke="#38bdf8"
                        strokeWidth="2"
                        strokeDasharray="5 3"
                      />
                      {target && (
                        <>
                          <line
                            x1={foot.x}
                            y1={foot.y}
                            x2={target.x}
                            y2={target.y}
                            stroke="#38bdf8"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                            opacity="0.7"
                          />
                          <circle cx={target.x} cy={target.y} r="4.5" fill="#38bdf8" opacity="0.85" />
                        </>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Single Shared WebGL2 / Canvas2D Multi-Actor Render Target */}
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ width: size.width, height: size.height }}
          />

          {/* Combat Slash Hitbox & Cast Arcane Ring VFX Overlay */}
          {vfxList.length > 0 && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {vfxList.map((vfx) => {
                const pt = worldToScreen(vfx.x, vfx.y);
                const r = 46 * stageZoom;
                if (vfx.type === 'slash') {
                  const deg = (vfx.angleRad * 180) / Math.PI;
                  const step = vfx.comboStep ?? 1;
                  const isCrit = step === 3;
                  const strokeCol = isCrit ? '#fb7185' : step === 2 ? '#fb923c' : '#fde047';
                  const arcR = r * (isCrit ? 1.28 : step === 2 ? 1.12 : 1.0);
                  const badgeText =
                    isCrit
                      ? vfx.hitCount > 0
                        ? `3-HIT CRIT ×${vfx.hitCount}!`
                        : '3-HIT FINISHER!'
                      : step === 2
                        ? vfx.hitCount > 0
                          ? `2-HIT COMBO ×${vfx.hitCount}!`
                          : '2-HIT COMBO!'
                        : vfx.hitCount > 0
                          ? `HIT ×${vfx.hitCount}!`
                          : '';
                  return (
                    <g key={vfx.id} transform={`translate(${pt.x}, ${pt.y - 36 * stageZoom})`}>
                      {/* Melee hitbox indicator */}
                      <ellipse
                        cx={0}
                        cy={28 * stageZoom}
                        rx={(isCrit ? 74 : 58) * stageZoom}
                        ry={(isCrit ? 38 : 30) * stageZoom}
                        fill={isCrit ? 'rgba(244, 63, 94, 0.22)' : 'rgba(244, 63, 94, 0.14)'}
                        stroke={isCrit ? '#fda4af' : 'rgba(251, 113, 133, 0.85)'}
                        strokeWidth={isCrit ? '2.2' : '1.5'}
                        strokeDasharray="4 3"
                      />
                      {/* Primary glowing slash arc */}
                      <path
                        d={`M ${-arcR * 0.7} ${-arcR * 0.7} Q ${arcR * 0.95} 0 ${-arcR * 0.7} ${arcR * 0.7}`}
                        fill="none"
                        stroke={strokeCol}
                        strokeWidth={Math.max(3, (isCrit ? 7 : 5) * stageZoom)}
                        strokeLinecap="round"
                        transform={`rotate(${deg})`}
                        opacity="0.95"
                      />
                      {/* Secondary inner arc on 2-hit & 3-hit combo */}
                      {step >= 2 && (
                        <path
                          d={`M ${-arcR * 0.52} ${-arcR * 0.52} Q ${arcR * 0.72} 0 ${-arcR * 0.52} ${arcR * 0.52}`}
                          fill="none"
                          stroke="#fef08a"
                          strokeWidth={Math.max(2, 3 * stageZoom)}
                          strokeLinecap="round"
                          transform={`rotate(${deg + (isCrit ? -12 : 10)})`}
                          opacity="0.9"
                        />
                      )}
                      {badgeText && (
                        <text
                          x={0}
                          y={-arcR * 0.78}
                          textAnchor="middle"
                          fill={isCrit ? '#fde047' : '#fda4af'}
                          fontSize={isCrit ? '14' : '12'}
                          fontWeight="bold"
                        >
                          {badgeText}
                        </text>
                      )}
                    </g>
                  );
                }
                return (
                  <g key={vfx.id} transform={`translate(${pt.x}, ${pt.y})`}>
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={72 * stageZoom}
                      ry={36 * stageZoom}
                      fill="rgba(168, 85, 247, 0.16)"
                      stroke="#c084fc"
                      strokeWidth="2.2"
                      strokeDasharray="6 4"
                    />
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={48 * stageZoom}
                      ry={24 * stageZoom}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* Floating Character Name Badges */}
          {showLabels &&
            actors.map((actor) => {
              const foot = worldToScreen(actor.x, actor.y);
              const isSel = actor.id === selectedId;
              return (
                <div
                  key={actor.id}
                  style={{
                    left: foot.x,
                    top: foot.y - 182 * actor.scale * stageZoom,
                    transform: 'translate(-50%, -100%)',
                  }}
                  className={`pointer-events-none absolute whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium shadow ${
                    isSel
                      ? 'bg-sky-500 text-white ring-2 ring-sky-300/60'
                      : isLightBackdrop
                        ? 'bg-slate-900/80 text-white'
                        : 'bg-slate-900/75 text-slate-200 border border-slate-700/80'
                  }`}
                >
                  {actor.label}
                </div>
              );
            })}

          {/* Empty Stage Welcome Hint */}
          {actors.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`max-w-md rounded-2xl border border-dashed px-6 py-5 text-center ${
                  isLightBackdrop
                    ? 'border-slate-300 bg-white/80 text-slate-600'
                    : 'border-slate-700/80 bg-slate-900/50 text-slate-300'
                }`}
              >
                <Users className="mx-auto h-8 w-8 text-sky-400" />
                <div
                  className={`mt-2 text-sm font-semibold ${isLightBackdrop ? 'text-slate-800' : 'text-white'}`}
                >
                  多人同屏空白场景（Playground）
                </div>
                <p className="mt-1.5 text-xs leading-relaxed opacity-80">
                  从左侧点击任意角色即可投放进场景；支持自由拖拽排位、自动 Y 轴前后遮挡、双击/右键指挥行走，或开启「WASD 操控」亲自体验移动挥击与施法。
                </p>
              </div>
            </div>
          )}

          {/* Top-Right Performance & Depth-Sort HUD */}
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/85 px-2.5 py-1 font-mono text-[10px] text-slate-200 backdrop-blur">
            <span className={fps >= 50 ? 'text-emerald-400' : 'text-amber-400'}>{fps} FPS</span>
            <span className="text-slate-600">|</span>
            <span className="text-cyan-300">{frameTimeMs.toFixed(1)} ms</span>
            <span className="text-slate-600">|</span>
            <span>角色: {actors.length}</span>
            <span className="text-slate-600">|</span>
            <span>图层: {totalLayersDrawn}</span>
            <span className="text-slate-600">|</span>
            <span className="text-sky-300">Y-Sort ON</span>
          </div>

          {/* Bottom-Left Interaction Tip */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur">
            {wasdEnabled
              ? 'WASD 操控中：WASD/方向键移动 · Space/J 挥击(命中附近角色触发受击) · K 施法'
              : `滚轮缩放 (${Math.round(stageZoom * 100)}%) · 拖拽角色排位 · 选中后双击/右键地面行走`}
          </div>
        </div>

        {/* Bottom Crowd Animation & AI Roaming Bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-slate-800/90 bg-slate-900/90 px-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsPlaying((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white hover:bg-sky-500 transition"
              title={isPlaying ? '暂停场景动画' : '播放场景动画'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>

            <button
              onClick={() => {
                setActiveBatchAction(null);
                setRoamEnabled((v) => !v);
              }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
                roamEnabled
                  ? 'border-emerald-400 bg-emerald-600/30 text-emerald-200 shadow-sm'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-emerald-500/50'
              }`}
            >
              <Footprints className="h-3.5 w-3.5" />
              {roamEnabled ? '自由漫游中 (AI)' : '开启自由漫游'}
            </button>

            <div className="mx-1 h-5 w-px bg-slate-800" />

            <span className="text-[11px] text-slate-400">全员动作:</span>
            {ACTION_OPTIONS.map((a) => {
              const isBatchActive = !roamEnabled && activeBatchAction === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => handleBatchAction(a.id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition ${
                    isBatchActive
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>速度</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1.0×</option>
              <option value={1.5}>1.5×</option>
              <option value={2}>2.0×</option>
            </select>
          </div>
        </div>
      </main>

      {/* Right Panel: Selected Actor Inspector + Scene Actor List */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800/90 bg-slate-900/60 overflow-y-auto p-3 space-y-3">
        {selectedActor ? (
          <>
            <div className="rounded-lg border border-sky-500/40 bg-sky-950/20 p-2.5">
              <div className="flex items-center justify-between">
                <div className="truncate text-xs font-semibold text-white">
                  {selectedActor.label}
                </div>
                <span className="font-mono text-[10px] text-sky-300">
                  ({Math.round(selectedActor.x)}, {Math.round(selectedActor.y)})
                </span>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1">
                <button
                  onClick={handleDuplicateSelected}
                  className="flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[10px] text-slate-200 hover:bg-slate-700"
                >
                  <Copy className="h-3 w-3" />
                  复制
                </button>
                <button
                  onClick={() => onEditActorInStudio(selectedActor.config)}
                  className="flex items-center justify-center gap-1 rounded border border-sky-500/40 bg-sky-600/20 px-1.5 py-1 text-[10px] text-sky-200 hover:bg-sky-600/35"
                >
                  <Edit3 className="h-3 w-3" />
                  进编辑器
                </button>
                <button
                  onClick={() => handleDeleteActor(selectedActor.id)}
                  className="flex items-center justify-center gap-1 rounded border border-rose-500/40 bg-rose-950/40 px-1.5 py-1 text-[10px] text-rose-200 hover:bg-rose-900/50"
                >
                  <Trash2 className="h-3 w-3" />
                  移除
                </button>
              </div>
            </div>

            {/* 8-Direction Compass for Selected Actor */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>选中角色朝向</span>
                <span className="font-mono text-[11px] text-sky-400">
                  {selectedActor.config.direction}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {DIRECTION_COMPASS_GRID.map((dir, i) => {
                  if (!dir) {
                    return (
                      <div
                        key={`center-${i}`}
                        className="flex items-center justify-center rounded border border-slate-800 bg-slate-950/60 text-[10px] font-mono text-slate-500"
                      >
                        8 向
                      </div>
                    );
                  }
                  const active = selectedActor.config.direction === dir;
                  return (
                    <button
                      key={dir}
                      onClick={() =>
                        updateSelectedActor((a) => ({
                          ...a,
                          config: { ...a.config, direction: dir },
                        }))
                      }
                      className={`rounded border py-1 text-[11px] font-mono font-semibold transition ${
                        active
                          ? 'border-sky-400 bg-sky-600/30 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {dir}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action for Selected Actor */}
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-300">
                <Swords className="h-3.5 w-3.5 text-amber-400" />
                <span>选中角色动作</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {ACTION_OPTIONS.map((a) => {
                  const active = selectedActor.config.action === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        setActiveBatchAction(null);
                        setIsPlaying(true);
                        updateSelectedActor((actor) => ({
                          ...actor,
                          targetX: null,
                          targetY: null,
                          actionStartedAtMs: simTimeRef.current,
                          timeOffsetMs: 0,
                          config: { ...actor.config, action: a.id },
                        }));
                      }}
                      className={`rounded border py-1 text-[11px] font-medium transition ${
                        active
                          ? 'border-sky-400 bg-sky-600/30 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scale Slider (test Boss vs Minion sizing!) */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                <span className="font-semibold">体型缩放</span>
                <span className="font-mono text-[11px] text-sky-400">
                  {selectedActor.scale.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.05}
                value={selectedActor.scale}
                onChange={(e) => {
                  const sc = Number(e.target.value);
                  updateSelectedActor((a) => ({ ...a, scale: sc }));
                }}
                className="w-full accent-sky-500"
              />
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-center text-[11px] text-slate-400">
            点击场景中的任意纸片人，即可调整它的朝向、动作、体型缩放，或双击地面让它走过去。
          </div>
        )}

        {/* Active Actors Roster */}
        <div className="flex-1 border-t border-slate-800 pt-2.5">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>场景内角色列表</span>
            <span className="font-mono text-[10px] text-slate-500">{actors.length}</span>
          </div>
          {actors.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-slate-500">当前场景为空</div>
          ) : (
            <div className="space-y-1">
              {actors.map((a) => {
                const isSel = a.id === selectedId;
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`flex cursor-pointer items-center justify-between rounded-md border px-2 py-1 text-xs transition ${
                      isSel
                        ? 'border-sky-400 bg-sky-600/20 text-white'
                        : 'border-slate-800/80 bg-slate-950/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium">{a.label}</div>
                      <div className="font-mono text-[9px] text-slate-400">
                        {a.config.direction} · {a.config.action} · Y={Math.round(a.y)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteActor(a.id);
                      }}
                      className="rounded p-1 text-slate-500 hover:bg-rose-950/60 hover:text-rose-300"
                      title="移除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
