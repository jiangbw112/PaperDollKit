import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

describe('@paperdollkit/cli (M5 Headless Pipeline)', () => {
  it('runs asset audit and passes on built-in HD demo pack', () => {
    const res = runCli(['audit']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.join('\n')).toContain('Schema validation: PASS');
    expect(res.stdout.join('\n')).toContain('Asset audit: PASS');
  });

  it('exports Mode B dual-engine modular kit and Mode A baked bundle with CREDITS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdk-cli-export-'));
    try {
      // Mode B modular
      const modRes = runCli([
        'export',
        '--mode', 'modular',
        '--engine', 'dual',
        '--name', 'cli_knight',
        '--seed', 'knight-99',
        '--archetype', 'knight',
        '--out', join(dir, 'modular'),
      ]);
      expect(modRes.exitCode).toBe(0);
      expect(existsSync(join(dir, 'modular', 'cli_knight_godot4_cocos3_modular.zip'))).toBe(true);
      expect(existsSync(join(dir, 'modular', 'CREDITS.csv'))).toBe(true);
      expect(existsSync(join(dir, 'modular', 'CREDITS.txt'))).toBe(true);

      // Mode A baked
      const bakedRes = runCli([
        'export',
        '--mode', 'baked',
        '--engine', 'godot4',
        '--name', 'cli_mage',
        '--seed', 'mage-7',
        '--archetype', 'mage',
        '--size', '64',
        '--dirs', 'SE,SW',
        '--actions', 'idle',
        '--out', join(dir, 'baked'),
      ]);
      expect(bakedRes.exitCode).toBe(0);
      expect(existsSync(join(dir, 'baked', 'cli_mage_godot4.zip'))).toBe(true);
      const csv = readFileSync(join(dir, 'baked', 'CREDITS.csv'), 'utf8');
      expect(csv).toContain('slot_id,part_id,part_name,author,license');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates a deterministic seeded NPC batch with index.png contact sheet, manifest.json, and CREDITS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdk-cli-batch-'));
    try {
      const res = runCli([
        'batch',
        '--count', '4',
        '--seed', 'riverford',
        '--size', '64',
        '--out', dir,
      ]);
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(dir, 'index.png'))).toBe(true);
      expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(dir, 'CREDITS.csv'))).toBe(true);
      expect(existsSync(join(dir, 'CREDITS.txt'))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
        count: number;
        seed: string;
        characters: Array<{ configPath: string; previewPath: string }>;
      };
      expect(manifest.count).toBe(4);
      expect(manifest.seed).toBe('riverford');
      expect(manifest.characters).toHaveLength(4);
      for (const ch of manifest.characters) {
        expect(existsSync(join(dir, ch.configPath))).toBe(true);
        expect(existsSync(join(dir, ch.previewPath))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles MCP JSON-RPC 2.0 initialize, tools/list, list_catalog, and natural-language design_character', async () => {
    const { handleMcpRequest } = await import('../src/mcp.js');

    const initResp = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(initResp?.result).toMatchObject({
      serverInfo: { name: 'paperdollkit-mcp' },
    });

    const listResp = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (listResp?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'list_catalog',
      'generate_character',
      'design_character',
      'export_character',
      'generate_batch',
    ]);

    const designResp = handleMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'design_character',
        arguments: { prompt: '穿红色披风的秘法法师，手持法杖' },
      },
    });
    const text = (designResp?.result as { content: Array<{ text: string }> }).content[0]!.text;
    const designed = JSON.parse(text) as {
      archetype: string;
      matchedTraits: string[];
      config: { slots: Record<string, string>; palettes: Record<string, string> };
    };
    expect(designed.archetype).toBe('mage');
    expect(designed.matchedTraits).toContain('archetype:mage');
    expect(designed.config.palettes.torso_top).toBe('crimson');
  });
});
