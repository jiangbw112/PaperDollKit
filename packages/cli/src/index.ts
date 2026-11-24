import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PaperDollCharacter,
  auditAssetPack,
  generateCharacterBatch,
  generateSeededCharacter,
  validateAssetPack,
  type AssetPackManifest,
  type CharacterArchetypeId,
  type CharacterConfig,
} from '@paperdollkit/core';
import {
  bakeCharacterSequences,
  bakeFrameCPU,
  buildCreditsFiles,
  buildModularExportData,
  encodePngRGBA,
  exportCocos3BakedBundle,
  exportCocos3ModularBundle,
  exportDualEngineBakedBundle,
  exportDualEngineModularBundle,
  exportGodot4BakedBundle,
  exportGodot4ModularBundle,
  exportUniversalAtlasBundle,
  type RgbaImage,
} from '@paperdollkit/exporters';
import {
  createDemoHDPackWithImages,
  importPsdBuffer,
  type ImportedImage,
} from '@paperdollkit/importers';

export interface CliResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

function loadPackWithOptionalPsd(psdPath?: string): {
  pack: AssetPackManifest;
  images: Map<string, ImportedImage>;
} {
  const base = createDemoHDPackWithImages();
  if (!psdPath) return base;

  const buf = readFileSync(resolve(psdPath));
  const merged = importPsdBuffer(new Uint8Array(buf), {
    basePack: base.pack,
  });
  const combinedImages = new Map<string, ImportedImage>([...base.images, ...merged.images]);
  return { pack: merged.pack, images: combinedImages };
}

function renderContactSheet(
  previews: RgbaImage[],
  cellSize: number,
  columns = 4,
): RgbaImage {
  const cols = Math.max(1, Math.min(columns, previews.length));
  const rows = Math.max(1, Math.ceil(previews.length / cols));
  const pad = 8;
  const width = cols * cellSize + (cols + 1) * pad;
  const height = rows * cellSize + (rows + 1) * pad;
  const data = new Uint8ClampedArray(width * height * 4);

  // Subtle dark slate background so transparent stickers read clearly in contact sheets
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 15;
    data[i + 1] = 23;
    data[i + 2] = 42;
    data[i + 3] = 255;
  }

  previews.forEach((img, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = pad + col * (cellSize + pad);
    const oy = pad + row * (cellSize + pad);

    const copyW = Math.min(cellSize, img.width);
    const copyH = Math.min(cellSize, img.height);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        const si = (y * img.width + x) * 4;
        const sa = img.data[si + 3]! / 255;
        if (sa <= 0) continue;
        const di = ((oy + y) * width + (ox + x)) * 4;
        const inv = 1 - sa;
        data[di] = Math.round(img.data[si]! * sa + data[di]! * inv);
        data[di + 1] = Math.round(img.data[si + 1]! * sa + data[di + 1]! * inv);
        data[di + 2] = Math.round(img.data[si + 2]! * sa + data[di + 2]! * inv);
        data[di + 3] = 255;
      }
    }
  });

  return { width, height, data };
}

function getHelpText(): string {
  return [
    'PaperDollKit v2 Headless CLI',
    '',
    'Usage:',
    '  paperdollkit audit [--psd <file.psd>]',
    '  paperdollkit export --out <dir> [--mode baked|modular] [--engine godot4|cocos3|dual]',
    '                      [--name <hero>] [--preset <id> | --seed <seed> --archetype <type>]',
    '                      [--size <128>] [--dirs SE,SW,N] [--actions idle,walk] [--psd <file.psd>]',
    '  paperdollkit batch  --out <dir> --count <N> --seed <seed> [--archetype any|knight|mage|ranger|rogue|noble|civilian]',
    '                      [--size <128>] [--psd <file.psd>]',
    '',
    'Examples:',
    '  pnpm cli audit',
    '  pnpm cli export --mode modular --engine dual --name knight_kit --out ./out/kit',
    '  pnpm cli export --mode baked --engine godot4 --seed hero-42 --archetype mage --out ./out/mage',
    '  pnpm cli batch --count 8 --seed riverford --out ./out/village',
  ].join('\n');
}

/**
 * Programmatic entry point for `@paperdollkit/cli`.
 * Pure Node.js (zero browser dependency), testable directly in Vitest.
 */
export function runCli(argv: string[]): CliResult {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    stdout.push(getHelpText());
    return { exitCode: 0, stdout, stderr };
  }

  try {
    if (cmd === 'audit') {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          psd: { type: 'string' },
        },
        strict: true,
      });

      const { pack, images } = loadPackWithOptionalPsd(values.psd);
      const schemaRes = validateAssetPack(pack);
      const audit = auditAssetPack(pack, images);

      stdout.push(`Pack: ${pack.name} (${pack.id})`);
      stdout.push(`Schema validation: ${schemaRes.ok ? 'PASS' : 'FAIL'}`);
      if (!schemaRes.ok) {
        for (const err of schemaRes.errors) stderr.push(`  [SCHEMA ERROR] ${err}`);
      }
      stdout.push(
        `Asset audit: ${audit.ok ? 'PASS' : 'FAIL'} (${audit.checkedParts} parts, ${audit.errorCount} errors, ${audit.warningCount} warnings)`,
      );
      for (const issue of audit.issues) {
        const line = `  [${issue.severity.toUpperCase()}][${issue.code}] ${issue.slotId}/${issue.partId}: ${issue.message}`;
        if (issue.severity === 'error') stderr.push(line);
        else stdout.push(line);
      }

      return {
        exitCode: schemaRes.ok && audit.ok ? 0 : 1,
        stdout,
        stderr,
      };
    }

    if (cmd === 'export') {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          out: { type: 'string', default: './paperdoll-out' },
          mode: { type: 'string', default: 'modular' },
          engine: { type: 'string', default: 'dual' },
          name: { type: 'string', default: 'hero' },
          preset: { type: 'string' },
          seed: { type: 'string' },
          archetype: { type: 'string', default: 'any' },
          size: { type: 'string', default: '128' },
          dirs: { type: 'string', default: 'SE,SW,NE,NW' },
          actions: { type: 'string', default: 'idle,walk' },
          psd: { type: 'string' },
        },
        strict: true,
      });

      const { pack, images } = loadPackWithOptionalPsd(values.psd);
      const outDir = resolve(values.out!);
      mkdirSync(outDir, { recursive: true });

      let config: CharacterConfig;
      if (values.seed) {
        const gen = generateSeededCharacter(pack, {
          seed: values.seed,
          archetype: values.archetype as CharacterArchetypeId,
        });
        config = gen.config;
        stdout.push(`Generated character from seed "${gen.seed}" (${gen.archetypeLabel})`);
      } else {
        const presetId = values.preset ?? pack.presets[0]?.id;
        const ch = new PaperDollCharacter(pack, presetId ? { preset: presetId } : {});
        config = ch.toJSON();
      }

      const mode = values.mode;
      const engine = values.engine;
      const name = values.name!;

      if (mode === 'modular') {
        const modular = buildModularExportData(
          { pack, config, images },
          { kitName: name, includeAllParts: true, includePrebakedLuts: true },
        );
        const bundle =
          engine === 'godot4'
            ? exportGodot4ModularBundle(modular)
            : engine === 'cocos3'
              ? exportCocos3ModularBundle(modular)
              : exportDualEngineModularBundle(modular);

        const zipPath = join(outDir, bundle.zipFilename);
        writeFileSync(zipPath, bundle.zip);
        if (modular.credits) {
          writeFileSync(join(outDir, 'CREDITS.csv'), modular.credits.csv, 'utf8');
          writeFileSync(join(outDir, 'CREDITS.txt'), modular.credits.txt, 'utf8');
        }
        stdout.push(
          `Exported Mode B (${engine}) -> ${zipPath} (${(bundle.zip.byteLength / 1024).toFixed(1)} KB, ${modular.stats.partCount} parts, ${modular.stats.eventCount} anim events)`,
        );
        return { exitCode: 0, stdout, stderr };
      }

      if (mode === 'baked') {
        const framePx = Math.max(32, Math.min(512, Number(values.size) || 128));
        const directions = String(values.dirs ?? 'SE,SW,NE,NW')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const actions = String(values.actions ?? 'idle,walk')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);

        const baked = bakeCharacterSequences(
          { pack, config, images },
          {
            characterName: name,
            directions,
            actions,
            frameSize: { width: framePx, height: framePx },
          },
        );
        const bundle =
          engine === 'godot4'
            ? exportGodot4BakedBundle(baked)
            : engine === 'cocos3'
              ? exportCocos3BakedBundle(baked)
              : engine === 'universal'
                ? exportUniversalAtlasBundle(baked)
                : exportDualEngineBakedBundle(baked);

        const credits = buildCreditsFiles(pack, [config]);
        const zipPath = join(outDir, bundle.zipFilename);
        writeFileSync(zipPath, bundle.zip);
        writeFileSync(join(outDir, 'CREDITS.csv'), credits.csv, 'utf8');
        writeFileSync(join(outDir, 'CREDITS.txt'), credits.txt, 'utf8');
        stdout.push(
          `Exported Mode A (${engine}) -> ${zipPath} (${baked.atlas.sprites.length} frames, ${baked.atlas.image.width}x${baked.atlas.image.height}, ${(bundle.zip.byteLength / 1024).toFixed(1)} KB)`,
        );
        return { exitCode: 0, stdout, stderr };
      }

      stderr.push(`Unknown --mode "${mode}". Expected "baked" or "modular".`);
      return { exitCode: 1, stdout, stderr };
    }

    if (cmd === 'batch') {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          out: { type: 'string', default: './paperdoll-batch' },
          count: { type: 'string', default: '6' },
          seed: { type: 'string', default: 'village' },
          archetype: { type: 'string', default: 'any' },
          size: { type: 'string', default: '128' },
          psd: { type: 'string' },
        },
        strict: true,
      });

      const { pack, images } = loadPackWithOptionalPsd(values.psd);
      const outDir = resolve(values.out!);
      mkdirSync(outDir, { recursive: true });

      const count = Math.max(1, Math.min(64, Number(values.count) || 6));
      const size = Math.max(48, Math.min(256, Number(values.size) || 128));
      const batch = generateCharacterBatch(pack, {
        count,
        seed: values.seed!,
        archetype: values.archetype as CharacterArchetypeId,
        randomDirection: true,
      });

      const previews: RgbaImage[] = [];
      const manifestEntries: Array<{
        index: number;
        id: string;
        seed: string;
        archetype: string;
        archetypeLabel: string;
        direction: string;
        configPath: string;
        previewPath: string;
      }> = [];

      batch.forEach((item, idx) => {
        const id = `${String(idx + 1).padStart(2, '0')}_${item.archetype}`;
        const charDir = join(outDir, id);
        mkdirSync(charDir, { recursive: true });

        const ch = new PaperDollCharacter(pack, item.config);
        const frame = ch.evaluate(0);
        const rgba = bakeFrameCPU(pack, frame, images, size, size);
        previews.push(rgba);

        const png = encodePngRGBA(rgba.width, rgba.height, rgba.data);
        writeFileSync(join(charDir, 'preview.png'), png);
        writeFileSync(join(charDir, 'config.json'), JSON.stringify(item.config, null, 2), 'utf8');

        manifestEntries.push({
          index: idx + 1,
          id,
          seed: item.seed,
          archetype: item.archetype,
          archetypeLabel: item.archetypeLabel,
          direction: item.config.direction,
          configPath: `${id}/config.json`,
          previewPath: `${id}/preview.png`,
        });
      });

      const contactSheet = renderContactSheet(previews, size, Math.min(4, count));
      writeFileSync(
        join(outDir, 'index.png'),
        encodePngRGBA(contactSheet.width, contactSheet.height, contactSheet.data),
      );

      const credits = buildCreditsFiles(
        pack,
        batch.map((b) => b.config),
      );
      writeFileSync(join(outDir, 'CREDITS.csv'), credits.csv, 'utf8');
      writeFileSync(join(outDir, 'CREDITS.txt'), credits.txt, 'utf8');

      writeFileSync(
        join(outDir, 'manifest.json'),
        JSON.stringify(
          {
            seed: values.seed,
            archetype: values.archetype,
            count,
            previewSize: size,
            contactSheet: 'index.png',
            credits: { csv: 'CREDITS.csv', txt: 'CREDITS.txt' },
            characters: manifestEntries,
          },
          null,
          2,
        ),
        'utf8',
      );

      stdout.push(
        `Generated batch of ${count} characters (seed="${values.seed}") -> ${outDir}`,
      );
      stdout.push(`  Contact sheet: ${join(outDir, 'index.png')} (${contactSheet.width}x${contactSheet.height})`);
      stdout.push(`  Manifest & Credits: manifest.json, CREDITS.csv, CREDITS.txt`);
      return { exitCode: 0, stdout, stderr };
    }

    stderr.push(`Unknown command "${cmd}". Run "paperdollkit help" for usage.`);
    return { exitCode: 1, stdout, stderr };
  } catch (err) {
    stderr.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1, stdout, stderr };
  }
}
