import { packZip } from '../codec/zip.js';
import type {
  BakedExportData,
  Cocos3ExportOptions,
  ExportBundle,
  Godot4ExportOptions,
} from '../types.js';
import { exportCocos3BakedBundle } from './cocos3.js';
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
