import { packZip } from '../codec/zip.js';
import type {
  BakedExportData,
  Cocos3ExportOptions,
  Cocos3ModularExportOptions,
  ExportBundle,
  Godot4ExportOptions,
  Godot4ModularExportOptions,
  ModularExportData,
} from '../types.js';
import { exportCocos3ModularBundle } from './cocos3-modular.js';
import { exportCocos3BakedBundle } from './cocos3.js';
import { exportGodot4ModularBundle } from './godot4-modular.js';
import { exportGodot4BakedBundle } from './godot4.js';

/**
 * Exports BOTH Godot 4.x and Cocos Creator 3.x baked packages into a single
 * unified dual-engine ZIP (`godot4/...` and `cocos3/...`).
 */
export function exportDualEngineBakedBundle(
  baked: BakedExportData,
  opts: { godot4?: Godot4ExportOptions; cocos3?: Cocos3ExportOptions } = {},
): ExportBundle {
  const godot = exportGodot4BakedBundle(baked, opts.godot4);
  const cocos = exportCocos3BakedBundle(baked, opts.cocos3);

  const files: Record<string, Uint8Array | string> = {};
  for (const [path, data] of Object.entries(godot.files)) {
    files[`godot4/${path}`] = data;
  }
  for (const [path, data] of Object.entries(cocos.files)) {
    files[`cocos3/${path}`] = data;
  }

  return {
    files,
    zip: packZip(files),
    zipFilename: `${baked.characterName}_godot4_cocos3.zip`,
  };
}

/**
 * Exports BOTH Godot 4.x and Cocos Creator 3.x Mode B Modular Runtime Kits into
 * a single unified dual-engine ZIP (`godot4/...` and `cocos3/...`).
 */
export function exportDualEngineModularBundle(
  modular: ModularExportData,
  opts: { godot4?: Godot4ModularExportOptions; cocos3?: Cocos3ModularExportOptions } = {},
): ExportBundle {
  const godot = exportGodot4ModularBundle(modular, opts.godot4);
  const cocos = exportCocos3ModularBundle(modular, opts.cocos3);

  const files: Record<string, Uint8Array | string> = {};
  for (const [path, data] of Object.entries(godot.files)) {
    files[`godot4/${path}`] = data;
  }
  for (const [path, data] of Object.entries(cocos.files)) {
    files[`cocos3/${path}`] = data;
  }

  return {
    files,
    zip: packZip(files),
    zipFilename: `${modular.kitName}_godot4_cocos3_modular.zip`,
  };
}
