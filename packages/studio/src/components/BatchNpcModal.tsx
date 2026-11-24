import {
  PaperDollCharacter,
  generateCharacterBatch,
  type AssetPackManifest,
  type CharacterArchetypeId,
  type CharacterConfig,
  type GeneratedCharacterResult,
} from '@paperdollkit/core';
import {
  bakeFrameCPU,
  buildCreditsFiles,
  encodePngRGBA,
  packZip,
  type RgbaImage,
} from '@paperdollkit/exporters';
import type { ImportedImage } from '@paperdollkit/importers';
import { Dices, Download, Edit3, RefreshCw, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface BatchNpcModalProps {
  open: boolean;
  onClose: () => void;
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
  onLoadCharacter: (config: CharacterConfig, label: string) => void;
  onToast: (msg: string) => void;
}

interface BatchNpcCard {
  index: number;
  generated: GeneratedCharacterResult;
  rgba: RgbaImage;
  dataUrl: string;
}

const ARCHETYPE_OPTIONS: Array<{ id: CharacterArchetypeId; label: string }> = [
  { id: 'any', label: '全职业混编 (any)' },
  { id: 'knight', label: '骑士重甲 (knight)' },
  { id: 'mage', label: '秘法法师 (mage)' },
  { id: 'ranger', label: '森林游侠 (ranger)' },
  { id: 'rogue', label: '暗影刺客 (rogue)' },
  { id: 'noble', label: '皇家贵族 (noble)' },
  { id: 'civilian', label: '城镇村民 (civilian)' },
];

function rgbaToDataUrl(img: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function buildContactSheet(cards: BatchNpcCard[], cellSize: number, columns = 4): RgbaImage {
  const cols = Math.max(1, Math.min(columns, cards.length));
  const rows = Math.max(1, Math.ceil(cards.length / cols));
  const pad = 8;
  const width = cols * cellSize + (cols + 1) * pad;
  const height = rows * cellSize + (rows + 1) * pad;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 15;
    data[i + 1] = 23;
    data[i + 2] = 42;
    data[i + 3] = 255;
  }

  cards.forEach((card, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = pad + col * (cellSize + pad);
    const oy = pad + row * (cellSize + pad);
    const src = card.rgba;
    const cw = Math.min(cellSize, src.width);
    const ch = Math.min(cellSize, src.height);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const si = (y * src.width + x) * 4;
        const sa = src.data[si + 3]! / 255;
        if (sa <= 0) continue;
        const di = ((oy + y) * width + (ox + x)) * 4;
        const inv = 1 - sa;
        data[di] = Math.round(src.data[si]! * sa + data[di]! * inv);
        data[di + 1] = Math.round(src.data[si + 1]! * sa + data[di + 1]! * inv);
        data[di + 2] = Math.round(src.data[si + 2]! * sa + data[di + 2]! * inv);
        data[di + 3] = 255;
      }
    }
  });

  return { width, height, data };
}

export function BatchNpcModal({
  open,
  onClose,
  pack,
  images,
  onLoadCharacter,
  onToast,
}: BatchNpcModalProps) {
  const [count, setCount] = useState(8);
  const [seed, setSeed] = useState('riverford');
  const [archetype, setArchetype] = useState<CharacterArchetypeId>('any');
  const [previewSize, setPreviewSize] = useState(96);
  const [cards, setCards] = useState<BatchNpcCard[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const runGeneration = useCallback(() => {
    setIsGenerating(true);
    // Yield one frame so the loading state paints smoothly
    requestAnimationFrame(() => {
      try {
        const batch = generateCharacterBatch(pack, {
          count,
          seed: seed.trim() || 'npc-batch',
          archetype,
          randomDirection: true,
        });
        const built: BatchNpcCard[] = batch.map((generated, idx) => {
          const ch = new PaperDollCharacter(pack, generated.config);
          const frame = ch.evaluate(0);
          const rgba = bakeFrameCPU(pack, frame, images, previewSize, previewSize);
          return {
            index: idx,
            generated,
            rgba,
            dataUrl: rgbaToDataUrl(rgba),
          };
        });
        setCards(built);
      } finally {
        setIsGenerating(false);
      }
    });
  }, [pack, images, count, seed, archetype, previewSize]);

  useEffect(() => {
    if (open && cards.length === 0) {
      runGeneration();
    }
  }, [open, cards.length, runGeneration]);

  if (!open) return null;

  const handleDownloadZip = () => {
    if (cards.length === 0) return;
    const files: Record<string, Uint8Array | string> = {};
    const manifestChars: Array<{
      id: string;
      seed: string;
      archetype: string;
      configPath: string;
      previewPath: string;
    }> = [];

    for (const card of cards) {
      const id = `npc_${String(card.index + 1).padStart(2, '0')}`;
      const configPath = `characters/${id}.json`;
      const previewPath = `previews/${id}.png`;
      files[configPath] = JSON.stringify(card.generated.config, null, 2);
      files[previewPath] = encodePngRGBA(card.rgba.width, card.rgba.height, card.rgba.data);
      manifestChars.push({
        id,
        seed: card.generated.seed,
        archetype: card.generated.archetype,
        configPath,
        previewPath,
      });
    }

    const sheet = buildContactSheet(cards, previewSize, 4);
    files['index.png'] = encodePngRGBA(sheet.width, sheet.height, sheet.data);

    const credits = buildCreditsFiles(pack);
    files['CREDITS.csv'] = credits.csv;
    files['CREDITS.txt'] = credits.txt;

    files['manifest.json'] = JSON.stringify(
      {
        seed: seed.trim() || 'npc-batch',
        archetype,
        count: cards.length,
        previewSize,
        contactSheet: 'index.png',
        credits: { csv: 'CREDITS.csv', txt: 'CREDITS.txt' },
        characters: manifestChars,
      },
      null,
      2,
    );

    const zipBytes = packZip(files);
    const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paperdollkit-batch-${seed.trim() || 'npc'}-${cards.length}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    onToast(`已打包下载 ${cards.length} 名 NPC 军团 ZIP（含 index.png 接触图 + JSON + CREDITS）`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700/90 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">
              批量 NPC 军团生成器（确定性种子 + 接触图 ZIP）
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-800/80 bg-slate-950/60 px-4 py-3 text-xs">
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">数量</span>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="block rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              {[4, 8, 12, 16, 24].map((n) => (
                <option key={n} value={n}>
                  {n} 名角色
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">确定性种子 (Seed)</span>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-36 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSeed(`town-${Math.random().toString(36).slice(2, 7)}`)}
                className="rounded border border-slate-700 bg-slate-800 p-1.5 text-amber-300 hover:bg-slate-700 transition"
                title="随机换一个种子"
              >
                <Dices className="h-3.5 w-3.5" />
              </button>
            </div>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">职业风格</span>
            <select
              value={archetype}
              onChange={(e) => setArchetype(e.target.value as CharacterArchetypeId)}
              className="block rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              {ARCHETYPE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">预览分辨率</span>
            <select
              value={previewSize}
              onChange={(e) => setPreviewSize(Number(e.target.value))}
              className="block rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
            >
              <option value={96}>96×96</option>
              <option value={128}>128×128</option>
            </select>
          </label>

          <button
            type="button"
            onClick={runGeneration}
            disabled={isGenerating}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? '生成中...' : '生成预览'}
          </button>
        </div>

        {/* Live Contact Sheet Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {cards.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">正在生成批量角色...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {cards.map((card) => (
                <div
                  key={card.index}
                  className="group flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 hover:border-sky-500/60 transition"
                >
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-900/90">
                    <img
                      src={card.dataUrl}
                      alt={card.generated.seed}
                      className="h-24 w-24 object-contain"
                    />
                  </div>
                  <div className="mt-2 flex w-full items-center justify-between text-[11px]">
                    <span className="font-mono text-slate-300">
                      #{String(card.index + 1).padStart(2, '0')}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-300">
                      {card.generated.archetypeLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onLoadCharacter(
                        card.generated.config,
                        `批量 NPC #${card.index + 1} (${card.generated.archetypeLabel})`,
                      );
                      onClose();
                    }}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/80 py-1 text-[10px] text-slate-200 hover:border-sky-400 hover:bg-sky-600/20 hover:text-white transition"
                  >
                    <Edit3 className="h-3 w-3" />
                    载入编辑器微调
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-2.5 text-xs">
          <span className="text-slate-400">
            ZIP 包含：<code className="text-slate-300">index.png</code> 接触图 ·{' '}
            <code className="text-slate-300">manifest.json</code> · 全部角色 JSON & 透明 PNG ·{' '}
            <code className="text-slate-300">CREDITS.csv/txt</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 transition"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={cards.length === 0 || isGenerating}
              onClick={handleDownloadZip}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition shadow"
            >
              <Download className="h-3.5 w-3.5" />
              打包下载 {cards.length} 名 NPC (.zip)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
