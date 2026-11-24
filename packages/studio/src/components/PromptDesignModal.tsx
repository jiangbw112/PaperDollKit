import {
  designCharacterFromPrompt,
  type AssetPackManifest,
  type CharacterConfig,
} from '@paperdollkit/core';
import { Check, Copy, Sparkles, Terminal, X } from 'lucide-react';
import { useState } from 'react';

interface PromptDesignModalProps {
  open: boolean;
  onClose: () => void;
  pack: AssetPackManifest;
  onApplyConfig: (config: CharacterConfig, summary: string) => void;
}

const SAMPLE_PROMPTS = [
  '穿红色披风的秘法法师，手持法杖',
  '金色圣骑士，身披重甲手持长剑',
  '翡翠森林游侠，背斗篷拿长弓',
  '玄黑潜行刺客，手持短匕首',
  '海蓝皇家贵族，雪白肤色',
  'crimson flame mage with staff and cloak',
];

const MCP_SNIPPET = `{
  "mcpServers": {
    "paperdollkit": {
      "command": "node",
      "args": ["packages/cli/dist/bin.js", "mcp"]
    }
  }
}`;

export function PromptDesignModal({
  open,
  onClose,
  pack,
  onApplyConfig,
}: PromptDesignModalProps) {
  const [prompt, setPrompt] = useState('穿红色披风的秘法法师，手持法杖');
  const [lastTraits, setLastTraits] = useState<string[]>([]);
  const [copiedMcp, setCopiedMcp] = useState(false);

  if (!open) return null;

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const res = designCharacterFromPrompt(pack, trimmed);
    setLastTraits(res.matchedTraits);
    onApplyConfig(res.config, `AI 描述生成：${res.archetypeLabel}（${res.matchedTraits.join(', ') || '默认搭配'}）`);
    onClose();
  };

  const handleCopyMcp = () => {
    void navigator.clipboard?.writeText(MCP_SNIPPET);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700/90 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">AI 自然语言一键设计角色</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              输入角色描述（支持中英文：职业 / 配色 / 肤色 / 武器 / 披风）
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="例如：穿翡翠披风的森林游侠，手持长弓..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-400">快捷灵感示例</div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setPrompt(sample)}
                  className="rounded-full border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-300 hover:border-violet-500/60 hover:text-violet-200 transition"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          {lastTraits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {lastTraits.map((t) => (
                <span
                  key={t}
                  className="rounded bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* MCP Integration Snippet */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                在外部 AI Agent 中调用（MCP Server）
              </span>
              <button
                type="button"
                onClick={handleCopyMcp}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white transition"
              >
                {copiedMcp ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copiedMcp ? '已复制' : '复制配置'}
              </button>
            </div>
            <pre className="overflow-x-auto font-mono text-[10px] text-slate-400 leading-relaxed">
              {MCP_SNIPPET}
            </pre>
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
            onClick={handleGenerate}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 transition shadow"
          >
            <Sparkles className="h-3.5 w-3.5" />
            立即生成并装配
          </button>
        </div>
      </div>
    </div>
  );
}
