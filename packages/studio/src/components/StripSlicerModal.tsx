import type { AssetPackManifest, DirectionId, SlotId } from '@paperdollkit/core';
import {
  buildAssetPackFromEntries,
  sliceSpriteStrip,
  type ImportResult,
  type ImportedImage,
} from '@paperdollkit/importers';
import { Grid3x3, Scissors, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { decodeImageFile } from '../utils/browser-import.ts';

interface StripSlicerModalProps {
  open: boolean;
  onClose: () => void;
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
  defaultSlotId: SlotId;
  defaultDirection: DirectionId;
  onImportComplete: (res: ImportResult, partId: string, slotId: SlotId) => void;
}

export function StripSlicerModal({
  open,
  onClose,
  pack,
  images,
  defaultSlotId,
  defaultDirection,
  onImportComplete,
}: StripSlicerModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [decoded, setDecoded] = useState<{
    filename: string;
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null>(null);
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(1);
  const [slotId, setSlotId] = useState<SlotId>(defaultSlotId);
  const [direction, setDirection] = useState<DirectionId>(defaultDirection);
  const [actionId, setActionId] = useState('walk');
  const [partId, setPartId] = useState('custom_strip');

  useEffect(() => {
    if (!decoded || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    ctx.putImageData(imgData, 0, 0);

    // Draw slice grid lines
    const safeCols = Math.max(1, cols);
    const safeRows = Math.max(1, rows);
    const fw = decoded.width / safeCols;
    const fh = decoded.height / safeRows;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = Math.max(1, decoded.width / 256);
    for (let c = 1; c < safeCols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * fw, 0);
      ctx.lineTo(c * fw, decoded.height);
      ctx.stroke();
    }
    for (let r = 1; r < safeRows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * fh);
      ctx.lineTo(decoded.width, r * fh);
      ctx.stroke();
    }
  }, [decoded, cols, rows]);

  if (!open) return null;

  const handleFileChange = async (file: File) => {
    const img = await decodeImageFile(file);
    setDecoded({ filename: file.name, ...img });
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    setPartId(base || 'custom_strip');
    // Auto-guess horizontal strip column count
    if (img.width > img.height) {
      const guessed = Math.max(1, Math.min(16, Math.round(img.width / img.height)));
      setCols(guessed);
      setRows(1);
    } else {
      setCols(4);
      setRows(1);
    }
  };

  const handleImport = () => {
    if (!decoded) return;
    const cleanPart = partId.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom_strip';
    const entries = sliceSpriteStrip(
      {
        id: decoded.filename,
        width: decoded.width,
        height: decoded.height,
        data: decoded.data,
      },
      {
        columns: Math.max(1, cols),
        rows: Math.max(1, rows),
        pathPrefix: `${slotId}/${cleanPart}_${direction}_${actionId}`,
      },
    );
    if (entries.length === 0) return;

    const res = buildAssetPackFromEntries(entries, {
      basePack: pack,
      baseImages: images,
      defaultDirection: direction,
      duplicateSingleDirection: true,
    });
    onImportComplete(res, cleanPart, slotId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700/90 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">序列帧 Sprite Sheet 可视化切分向导</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".png,.webp,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileChange(f);
            e.target.value = '';
          }}
        />

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-600/35 transition"
            >
              <Upload className="h-3.5 w-3.5" />
              {decoded ? `更换图片 (${decoded.filename})` : '选择横条 / 网格 PNG'}
            </button>
            {decoded && (
              <span className="font-mono text-[11px] text-slate-400">
                {decoded.width}×{decoded.height}px · 单帧 {Math.floor(decoded.width / Math.max(1, cols))}×
                {Math.floor(decoded.height / Math.max(1, rows))}px
              </span>
            )}
          </div>

          {/* Grid Preview */}
          <div className="flex h-44 items-center justify-center overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
            {decoded ? (
              <canvas
                ref={previewCanvasRef}
                className="max-h-full max-w-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="text-center text-xs text-slate-500 space-y-1">
                <Grid3x3 className="mx-auto h-7 w-7 text-slate-600" />
                <div>请选择外部序列帧横条或精灵表 PNG，自动跳过空白帧并绑定到动作轨</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-400">列数 (Columns)</span>
              <input
                type="number"
                min={1}
                max={32}
                value={cols}
                onChange={(e) => setCols(Math.max(1, Number(e.target.value)))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">行数 (Rows)</span>
              <input
                type="number"
                min={1}
                max={16}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Number(e.target.value)))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">目标槽位</span>
              <select
                value={slotId}
                onChange={(e) => setSlotId(e.target.value as SlotId)}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              >
                {pack.slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-400">绑定动作 / 朝向</span>
              <div className="flex gap-1.5">
                <select
                  value={actionId}
                  onChange={(e) => setActionId(e.target.value)}
                  className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                >
                  {Object.values(pack.animations).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({a.id})
                    </option>
                  ))}
                </select>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as DirectionId)}
                  className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-100"
                >
                  {(['S', 'SE', 'E', 'NE', 'N'] as const).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-slate-400">部件 ID</span>
              <input
                type="text"
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1 font-mono text-slate-100"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/60 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!decoded}
            onClick={handleImport}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40 transition shadow"
          >
            <Scissors className="h-3.5 w-3.5" />
            切分并导入到当前角色包
          </button>
        </div>
      </div>
    </div>
  );
}
