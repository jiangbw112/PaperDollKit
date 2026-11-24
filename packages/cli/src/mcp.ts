import * as readline from 'node:readline';
import {
  designCharacterFromPrompt,
  generateSeededCharacter,
  type AssetPackManifest,
  type CharacterArchetypeId,
  type DirectionId,
} from '@paperdollkit/core';
import { createDemoHDPackWithImages } from '@paperdollkit/importers';
import { runCli } from './index.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const MCP_TOOLS = [
  {
    name: 'list_catalog',
    description:
      'Lists all available 17-slot parts, color palettes, and presets in the PaperDollKit asset pack.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'generate_character',
    description:
      'Deterministically generates a PaperDollKit CharacterConfig from a seed and archetype.',
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'string', description: 'Deterministic seed string (e.g. "hero-42")' },
        archetype: {
          type: 'string',
          enum: ['any', 'knight', 'mage', 'ranger', 'rogue', 'noble', 'civilian'],
          description: 'Character archetype',
        },
        direction: {
          type: 'string',
          enum: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
          description: 'Facing direction',
        },
      },
    },
  },
  {
    name: 'design_character',
    description:
      'Designs a CharacterConfig from a natural-language prompt (Chinese or English), matching archetype, color palette, skin tone, and weapon/headgear keywords.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural language description, e.g. "穿红色披风的金色圣骑士" or "emerald forest ranger with hood"',
        },
        seed: { type: 'string', description: 'Optional seed override' },
      },
    },
  },
  {
    name: 'export_character',
    description:
      'Exports a character bundle (Mode A baked or Mode B modular) for Godot 4, Cocos Creator 3, dual-engine, or universal atlas.',
    inputSchema: {
      type: 'object',
      required: ['outDir'],
      properties: {
        outDir: { type: 'string', description: 'Output directory path' },
        mode: { type: 'string', enum: ['baked', 'modular'], default: 'modular' },
        engine: {
          type: 'string',
          enum: ['godot4', 'cocos3', 'dual', 'universal'],
          default: 'dual',
        },
        name: { type: 'string', default: 'hero' },
        seed: { type: 'string' },
        archetype: { type: 'string', default: 'any' },
        size: { type: 'number', default: 128 },
      },
    },
  },
  {
    name: 'generate_batch',
    description:
      'Batch-generates N deterministic NPC characters with an index.png contact sheet, manifest.json, and CREDITS.',
    inputSchema: {
      type: 'object',
      required: ['outDir', 'count'],
      properties: {
        outDir: { type: 'string', description: 'Output directory path' },
        count: { type: 'number', description: 'Number of characters to generate (1-100)' },
        seed: { type: 'string', default: 'npc-batch' },
        archetype: { type: 'string', default: 'any' },
        size: { type: 'number', default: 128 },
      },
    },
  },
];

export { designCharacterFromPrompt } from '@paperdollkit/core';

/**
 * Pure JSON-RPC 2.0 request handler for the PaperDollKit MCP server.
 * Exported directly so tests and host integrations can invoke it in-process or over stdio.
 */
export function handleMcpRequest(
  req: JsonRpcRequest,
  pack?: AssetPackManifest,
): JsonRpcResponse | null {
  const id = req.id ?? null;

  // Notifications have no id and expect no response
  if (req.method === 'notifications/initialized' || req.method === 'notifications/cancelled') {
    return null;
  }

  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'paperdollkit-mcp',
          version: '2.0.0',
        },
      },
    };
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS,
      },
    };
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const toolName = String(params.name ?? '');
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const activePack = pack ?? createDemoHDPackWithImages().pack;

    try {
      let payload: unknown;

      if (toolName === 'list_catalog') {
        const partsBySlot: Record<string, Array<{ id: string; name: string }>> = {};
        for (const slot of activePack.slots) {
          partsBySlot[slot.id] = (activePack.parts[slot.id] ?? []).map((p) => ({
            id: p.id,
            name: p.name,
          }));
        }
        payload = {
          packId: activePack.id,
          canvasSize: activePack.canvasSize,
          palettes: Object.entries(activePack.palettes).map(([pid, pal]) => ({
            id: pid,
            name: pal.name,
            swatch: pal.swatch,
          })),
          presets: activePack.presets.map((p) => ({ id: p.id, name: p.name })),
          partsBySlot,
        };
      } else if (toolName === 'generate_character') {
        const seed = typeof args.seed === 'string' ? args.seed : `seed-${Date.now()}`;
        const archetype = (args.archetype as CharacterArchetypeId) ?? 'any';
        const direction = (args.direction as DirectionId) ?? 'SE';
        const res = generateSeededCharacter(activePack, {
          seed,
          archetype,
          direction,
          action: 'idle',
        });
        payload = {
          seed,
          archetype: res.archetype,
          config: res.config,
        };
      } else if (toolName === 'design_character') {
        const prompt = String(args.prompt ?? '').trim();
        if (!prompt) throw new Error('design_character requires a non-empty prompt.');
        const seed = typeof args.seed === 'string' ? args.seed : undefined;
        payload = designCharacterFromPrompt(activePack, prompt, seed);
      } else if (toolName === 'export_character') {
        const outDir = String(args.outDir ?? '');
        if (!outDir) throw new Error('export_character requires outDir.');
        const cliArgs = [
          'export',
          '--out', outDir,
          '--mode', String(args.mode ?? 'modular'),
          '--engine', String(args.engine ?? 'dual'),
          '--name', String(args.name ?? 'hero'),
          '--size', String(args.size ?? 128),
        ];
        if (typeof args.seed === 'string') cliArgs.push('--seed', args.seed);
        if (typeof args.archetype === 'string') cliArgs.push('--archetype', args.archetype);
        const res = runCli(cliArgs);
        if (res.exitCode !== 0) {
          throw new Error(res.stderr.join('\n') || 'export failed');
        }
        payload = { ok: true, outDir, log: res.stdout };
      } else if (toolName === 'generate_batch') {
        const outDir = String(args.outDir ?? '');
        const count = Number(args.count ?? 4);
        if (!outDir) throw new Error('generate_batch requires outDir.');
        const cliArgs = [
          'batch',
          '--out', outDir,
          '--count', String(Math.max(1, Math.min(100, count))),
          '--seed', String(args.seed ?? 'npc-batch'),
          '--archetype', String(args.archetype ?? 'any'),
          '--size', String(args.size ?? 128),
        ];
        const res = runCli(cliArgs);
        if (res.exitCode !== 0) {
          throw new Error(res.stderr.join('\n') || 'batch generation failed');
        }
        payload = { ok: true, outDir, count, log: res.stdout };
      } else {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : String(err),
            },
          ],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}

/**
 * Starts the PaperDollKit stdio JSON-RPC 2.0 MCP server (newline-delimited JSON).
 */
export function startMcpStdioServer(): void {
  const activePack = createDemoHDPackWithImages().pack;
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const resp = handleMcpRequest(req, activePack);
      if (resp) {
        process.stdout.write(`${JSON.stringify(resp)}\n`);
      }
    } catch (err) {
      const errResp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: err instanceof Error ? err.message : 'Parse error',
        },
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
    }
  });
}
