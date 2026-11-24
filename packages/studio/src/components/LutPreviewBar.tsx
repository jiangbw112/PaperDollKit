import {
  LUT_TEXTURE_HEIGHT,
  LUT_TEXTURE_WIDTH,
  bakeSlotLUTTexture,
  type ColorPalette,
  type SkinTone,
  type SlotId,
} from '@paperdollkit/core';
import { useEffect, useRef } from 'react';

interface LutPreviewBarProps {
  slotId: SlotId;
  palette: ColorPalette;
  skin: SkinTone;
}

const ROW_LABELS = [
  { ch: 'R', name: '主色', color: 'text-rose-400' },
  { ch: 'G', name: '辅色', color: 'text-emerald-400' },
  { ch: 'B', name: '肤色', color: 'text-sky-400' },
  { ch: 'A', name: '金属', color: 'text-slate-300' },
];

export function LutPreviewBar({
  slotId,
  palette,
  skin,
}: LutPreviewBarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const baked = bakeSlotLUTTexture(slotId, palette, skin, 'none', LUT_TEXTURE_WIDTH);
    const imgData = ctx.createImageData(LUT_TEXTURE_WIDTH, LUT_TEXTURE_HEIGHT);
    imgData.data.set(baked.data);
    ctx.putImageData(imgData, 0, 0);
  }, [slotId, palette, skin]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>GPU LUT 纹理 (256×4 RGBA)</span>
        <span className="font-mono text-[10px] text-slate-500">WebGL2 / Godot / Cocos</span>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-0.5 text-[10px] font-medium leading-none">
          {ROW_LABELS.map((r) => (
            <div key={r.ch} className="flex items-center gap-1">
              <span className={`font-mono font-bold ${r.color}`}>{r.ch}</span>
              <span className="text-slate-400">{r.name}</span>
            </div>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          width={LUT_TEXTURE_WIDTH}
          height={LUT_TEXTURE_HEIGHT}
          className="h-14 min-w-0 flex-1 rounded border border-slate-700/80"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}
