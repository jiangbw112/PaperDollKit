import type {
  AssetPackManifest,
  EvaluatedFrame,
  SlotId,
} from '@paperdollkit/core';
import type { ImportedImage } from '@paperdollkit/importers';
import {
  createPaperDollRenderer,
  type PaperDollRenderer,
  type PointLight2DOptions,
} from '@paperdollkit/renderer-webgl2';
import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ViewportCanvasProps {
  pack: AssetPackManifest;
  frame: EvaluatedFrame;
  images: Map<string, ImportedImage>;
  imagesVersion: number;
  selectedSlotId: SlotId;
  onSelectSlot: (slotId: SlotId) => void;
  onDragSlotOffset: (slotId: SlotId, dx: number, dy: number) => void;
  onDropFiles: (files: File[]) => void;
  debugMaskView: boolean;
  showGizmos: boolean;
  light2D?: PointLight2DOptions;
  onMoveLight2D?: (x: number, y: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onBackendReady: (backend: 'webgl2' | 'canvas2d') => void;
  canvasExportRef: React.MutableRefObject<HTMLCanvasElement | null>;
}

export function ViewportCanvas({
  pack,
  frame,
  images,
  imagesVersion,
  selectedSlotId,
  onSelectSlot,
  onDragSlotOffset,
  onDropFiles,
  debugMaskView,
  showGizmos,
  light2D,
  onMoveLight2D,
  zoom,
  onZoomChange,
  onBackendReady,
  canvasExportRef,
}: ViewportCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PaperDollRenderer | null>(null);

  const [size, setSize] = useState({ width: 640, height: 520 });
  const [pan, setPan] = useState({ x: 0, y: 12 });
  const [isDragOver, setIsDragOver] = useState(false);

  const dragStateRef = useRef<
    | { mode: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
    | { mode: 'gizmo'; slotId: SlotId; lastX: number; lastY: number }
    | { mode: 'light'; lastX: number; lastY: number; wx: number; wy: number }
    | null
  >(null);

  // Initialize WebGL2 (with Canvas2D fallback) renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvasExportRef.current = canvas;
    const renderer = createPaperDollRenderer(canvas, 'webgl2');
    rendererRef.current = renderer;
    onBackendReady(renderer.backend);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
      canvasExportRef.current = null;
    };
  }, [onBackendReady, canvasExportRef]);

  // Invalidate GPU textures when external assets change
  useEffect(() => {
    rendererRef.current?.invalidateAll();
  }, [imagesVersion]);

  // Keep canvas crisp with container ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({
        width: Math.max(200, Math.floor(rect.width)),
        height: Math.max(200, Math.floor(rect.height)),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render whenever evaluated frame, zoom, pan, or view flags change
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.floor(size.width * dpr);
    const targetH = Math.floor(size.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    renderer.render(pack, frame, images, {
      clearColor: [0, 0, 0, 0],
      zoom: zoom * dpr,
      panX: pan.x * dpr,
      panY: pan.y * dpr,
      debugMaskView,
      highlightSlotId: showGizmos ? selectedSlotId : null,
      light2D,
    });
  }, [pack, frame, images, size, zoom, pan, debugMaskView, showGizmos, selectedSlotId, light2D]);

  // Convert character-canvas coordinate (worldX, worldY) -> viewport CSS pixels
  const toScreen = (wx: number, wy: number) => ({
    x: (wx - pack.canvasSize.width * 0.5) * zoom + size.width * 0.5 + pan.x,
    y: (wy - pack.canvasSize.height * 0.5) * zoom + size.height * 0.5 + pan.y,
  });

  // Isometric ground origin sits at foot center (width/2, height * 0.875)
  const footCenter = toScreen(pack.canvasSize.width * 0.5, pack.canvasSize.height * 0.875);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    onZoomChange(Math.max(0.5, Math.min(4.5, Number((zoom * factor).toFixed(2)))));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 0) {
      dragStateRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        origPanX: pan.x,
        origPanY: pan.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragStateRef.current;
    if (!st) return;
    if (st.mode === 'pan') {
      setPan({
        x: st.origPanX + (e.clientX - st.startX),
        y: st.origPanY + (e.clientY - st.startY),
      });
    } else if (st.mode === 'gizmo') {
      const mirrorSign = frame.direction.flipX ? -1 : 1;
      const dx = ((e.clientX - st.lastX) / zoom) * mirrorSign;
      const dy = (e.clientY - st.lastY) / zoom;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      onDragSlotOffset(st.slotId, dx, dy);
    } else if (st.mode === 'light') {
      const dx = (e.clientX - st.lastX) / zoom;
      const dy = (e.clientY - st.lastY) / zoom;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      st.wx += dx;
      st.wy += dy;
      onMoveLight2D?.(Math.round(st.wx), Math.round(st.wy));
    }
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  const layerPosMap = new Map(
    frame.layers.map((l) => [l.slotId, toScreen(l.worldTransform.x, l.worldTransform.y)]),
  );

  // Build isometric 2:1 diamond floor tiles around character feet
  const tileW = 48 * zoom;
  const tileH = 24 * zoom;
  const isoLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const gridRadius = 4;
  for (let i = -gridRadius; i <= gridRadius; i++) {
    // Axis A
    isoLines.push({
      x1: footCenter.x + (i - gridRadius) * tileW * 0.5,
      y1: footCenter.y + (i + gridRadius) * tileH * 0.5,
      x2: footCenter.x + (i + gridRadius) * tileW * 0.5,
      y2: footCenter.y + (i - gridRadius) * tileH * 0.5,
    });
    // Axis B
    isoLines.push({
      x1: footCenter.x + (-gridRadius - i) * tileW * 0.5,
      y1: footCenter.y + (-gridRadius + i) * tileH * 0.5,
      x2: footCenter.x + (gridRadius - i) * tileW * 0.5,
      y2: footCenter.y + (gridRadius + i) * tileH * 0.5,
    });
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onDropFiles(files);
      }}
      className="relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(30,41,59,0.72),rgba(2,6,23,1))] select-none cursor-grab active:cursor-grabbing"
    >
      {/* Isometric 2:1 ground grid */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        width={size.width}
        height={size.height}
      >
        <g stroke="rgba(148,163,184,0.13)" strokeWidth="1">
          {isoLines.map((ln, idx) => (
            <line key={idx} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
          ))}
        </g>
        <circle
          cx={footCenter.x}
          cy={footCenter.y}
          r={4}
          fill="rgba(56,189,248,0.45)"
          stroke="rgba(56,189,248,0.85)"
        />
      </svg>

      {/* Main WebGL2 / Canvas2D render target */}
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        className="absolute inset-0 block"
      />

      {/* Interactive Bone / Pivot Gizmo Overlay */}
      {showGizmos && (
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          width={size.width}
          height={size.height}
        >
          {/* Parent -> Child bone connectors */}
          {pack.slots.map((slot) => {
            if (!slot.parent) return null;
            const p0 = layerPosMap.get(slot.parent);
            const p1 = layerPosMap.get(slot.id);
            if (!p0 || !p1) return null;
            const isActive = slot.id === selectedSlotId || slot.parent === selectedSlotId;
            return (
              <line
                key={`bone-${slot.id}`}
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                stroke={isActive ? 'rgba(56,189,248,0.85)' : 'rgba(148,163,184,0.35)'}
                strokeWidth={isActive ? 1.8 : 1}
                strokeDasharray={isActive ? undefined : '3 3'}
              />
            );
          })}

          {/* Draggable slot pivot handles */}
          {frame.layers.map((layer) => {
            const p = toScreen(layer.worldTransform.x, layer.worldTransform.y);
            const selected = layer.slotId === selectedSlotId;
            return (
              <g
                key={`gizmo-${layer.slotId}`}
                className="pointer-events-auto cursor-move"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectSlot(layer.slotId);
                  dragStateRef.current = {
                    mode: 'gizmo',
                    slotId: layer.slotId,
                    lastX: e.clientX,
                    lastY: e.clientY,
                  };
                  (e.currentTarget as unknown as Element).setPointerCapture?.(e.pointerId);
                }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={selected ? 7 : 4.5}
                  fill={selected ? 'rgba(14,165,233,0.92)' : 'rgba(15,23,42,0.85)'}
                  stroke={selected ? '#e0f2fe' : 'rgba(148,163,184,0.8)'}
                  strokeWidth={selected ? 2 : 1.2}
                />
                {selected && (
                  <text
                    x={p.x + 11}
                    y={p.y + 4}
                    fill="#e0f2fe"
                    fontSize="11"
                    fontFamily="ui-monospace, monospace"
                    className="select-none"
                  >
                    {layer.slotId}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Draggable 2D Point Light Handle */}
      {light2D?.enabled && (() => {
        const lp = toScreen(light2D.x, light2D.y);
        const rgb = light2D.color ?? [1, 0.94, 0.82];
        const cssRgb = `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
        return (
          <svg
            className="absolute inset-0 h-full w-full pointer-events-none"
            width={size.width}
            height={size.height}
          >
            <g
              className="pointer-events-auto cursor-move"
              onPointerDown={(e) => {
                e.stopPropagation();
                dragStateRef.current = {
                  mode: 'light',
                  lastX: e.clientX,
                  lastY: e.clientY,
                  wx: light2D.x,
                  wy: light2D.y,
                };
                containerRef.current?.setPointerCapture(e.pointerId);
              }}
            >
              <circle cx={lp.x} cy={lp.y} r={22} fill={cssRgb} opacity={0.18} />
              <circle
                cx={lp.x}
                cy={lp.y}
                r={10}
                fill={cssRgb}
                stroke="#ffffff"
                strokeWidth={2}
              />
              <text
                x={lp.x + 15}
                y={lp.y + 4}
                fill="#fef08a"
                fontSize="11"
                fontFamily="ui-monospace, monospace"
                className="select-none"
              >
                2D Light ({Math.round(light2D.x)}, {Math.round(light2D.y)})
              </text>
            </g>
          </svg>
        );
      })()}

      {/* Viewport HUD hints */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-slate-400">
        <span className="rounded bg-slate-900/80 px-2 py-1 border border-slate-800">
          滚轮缩放 ({Math.round(zoom * 100)}%) · 拖拽平移
        </span>
        {showGizmos && (
          <span className="rounded bg-sky-950/80 px-2 py-1 border border-sky-800/60 text-sky-300">
            Gizmo 模式：拖动圆点实时微调槽位偏移
          </span>
        )}
        {frame.direction.mirrorFrom && (
          <span className="rounded bg-amber-950/80 px-2 py-1 border border-amber-700/50 text-amber-300">
            镜像朝向：{frame.direction.id} ← {frame.direction.mirrorFrom} (flipX)
          </span>
        )}
      </div>

      {/* Drag & Drop External PSD / PNG Overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-sky-950/60 backdrop-blur-xs">
          <Upload className="mb-2 h-10 w-10 text-sky-300" />
          <p className="text-base font-semibold text-white">松开导入外部高清素材</p>
          <p className="mt-1 text-xs text-sky-200/80">
            支持分层 .psd 文件，或成对 .png + _mask.png（自动按中英文图层名匹配 17 槽位）
          </p>
        </div>
      )}
    </div>
  );
}
