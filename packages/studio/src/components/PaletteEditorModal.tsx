import type { ColorPalette } from '@paperdollkit/core';
import { Palette, Plus, X } from 'lucide-react';
import { useState } from 'react';

interface PaletteEditorModalProps {
  open: boolean;
  onClose: () => void;
  initialPalette?: ColorPalette;
  onSavePalette: (palette: ColorPalette) => void;
}

function stopHex(color: string | { r: number; g: number; b: number }): string {
  if (typeof color === 'string') return color.slice(0, 7);
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`;
}

const STOP_LABELS = ['阴影 (t=0.05)', '固有色 (t=0.38)', '亮部 (t=0.72)', '高光 (t=0.96)'];
const STOP_POSITIONS = [0.05, 0.38, 0.72, 0.96];

export function PaletteEditorModal({
  open,
  onClose,
  initialPalette,
  onSavePalette,
}: PaletteEditorModalProps) {
  const initPrimary = initialPalette?.primary.stops ?? [];
  const initSecondary = initialPalette?.secondary.stops ?? [];

  const [name, setName] = useState(
    initialPalette ? `${initialPalette.name} (自定义)` : '自定义主题色',
  );
  const [primaryStops, setPrimaryStops] = useState<string[]>([
    initPrimary[0] ? stopHex(initPrimary[0].color) : '#1e1b4b',
    initPrimary[1] ? stopHex(initPrimary[1].color) : '#4338ca',
    initPrimary[2] ? stopHex(initPrimary[2].color) : '#818cf8',
    initPrimary[3] ? stopHex(initPrimary[3].color) : '#e0e7ff',
  ]);
  const [secondaryStops, setSecondaryStops] = useState<string[]>([
    initSecondary[0] ? stopHex(initSecondary[0].color) : '#451a03',
    initSecondary[1] ? stopHex(initSecondary[1].color) : '#b45309',
    initSecondary[2] ? stopHex(initSecondary[2].color) : '#f59e0b',
    initSecondary[3] ? stopHex(initSecondary[3].color) : '#fef3c7',
  ]);

  if (!open) return null;

  const handleSave = () => {
    const cleanName = name.trim() || '自定义调色板';
    const id = `custom_${Date.now().toString(36)}`;
    const palette: ColorPalette = {
      id,
      name: cleanName,
      swatch: primaryStops[1] ?? '#6366f1',
      primary: {
        stops: STOP_POSITIONS.map((t, i) => ({ t, color: primaryStops[i] ?? '#6366f1' })),
      },
      secondary: {
        stops: STOP_POSITIONS.map((t, i) => ({ t, color: secondaryStops[i] ?? '#f59e0b' })),
      },
    };
    onSavePalette(palette);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/90 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-white">自定义 Gradient Ramp 调色板编辑器</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-300">调色板名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Primary Ramp */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-rose-300">
              <span>主色梯度（Mask R 通道）</span>
              <span className="font-mono text-[10px] text-slate-400">Row 0 · 256×4 LUT</span>
            </div>
            <div
              className="h-4 w-full rounded border border-slate-700"
              style={{
                background: `linear-gradient(90deg, ${primaryStops[0]} 5%, ${primaryStops[1]} 38%, ${primaryStops[2]} 72%, ${primaryStops[3]} 96%)`,
              }}
            />
            <div className="grid grid-cols-4 gap-2">
              {primaryStops.map((hex, i) => (
                <label key={i} className="flex flex-col items-center gap-1 text-[10px] text-slate-400">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => {
                      const next = [...primaryStops];
                      next[i] = e.target.value;
                      setPrimaryStops(next);
                    }}
                    className="h-7 w-full cursor-pointer rounded border border-slate-700 bg-transparent"
                  />
                  <span>{STOP_LABELS[i]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Secondary Ramp */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-emerald-300">
              <span>辅色梯度（Mask G 通道）</span>
              <span className="font-mono text-[10px] text-slate-400">Row 1 · 256×4 LUT</span>
            </div>
            <div
              className="h-4 w-full rounded border border-slate-700"
              style={{
                background: `linear-gradient(90deg, ${secondaryStops[0]} 5%, ${secondaryStops[1]} 38%, ${secondaryStops[2]} 72%, ${secondaryStops[3]} 96%)`,
              }}
            />
            <div className="grid grid-cols-4 gap-2">
              {secondaryStops.map((hex, i) => (
                <label key={i} className="flex flex-col items-center gap-1 text-[10px] text-slate-400">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => {
                      const next = [...secondaryStops];
                      next[i] = e.target.value;
                      setSecondaryStops(next);
                    }}
                    className="h-7 w-full cursor-pointer rounded border border-slate-700 bg-transparent"
                  />
                  <span>{STOP_LABELS[i]}</span>
                </label>
              ))}
            </div>
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
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 transition shadow"
          >
            <Plus className="h-3.5 w-3.5" />
            保存并应用到当前槽位
          </button>
        </div>
      </div>
    </div>
  );
}
