import type {
  AssetPackManifest,
  CharacterConfig,
  PartAsset,
  PartAttribution,
} from '@paperdollkit/core';

export interface CreditRow {
  slotId: string;
  partId: string;
  partName: string;
  author: string;
  license: string;
  url: string;
  notes: string;
}

export interface CreditsBundle {
  rows: CreditRow[];
  csv: string;
  txt: string;
}

const FALLBACK_ATTRIBUTION: PartAttribution = {
  author: 'PaperDollKit Built-in Assets',
  license: 'MIT',
  url: 'https://github.com/jiangbw112/PaperDollKit',
};

function escapeCsv(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Generates standardized `CREDITS.csv` and human-readable `CREDITS.txt` files
 * for either the specific parts used by one or more `CharacterConfig`s,
 * or all parts present in an `AssetPackManifest` (when `configs` is omitted).
 */
export function buildCreditsFiles(
  pack: AssetPackManifest,
  configs?: CharacterConfig[],
): CreditsBundle {
  const defaultAttr = pack.defaultAttribution ?? FALLBACK_ATTRIBUTION;
  const collected = new Map<string, PartAsset>();

  if (configs && configs.length > 0) {
    for (const cfg of configs) {
      for (const [slotId, partId] of Object.entries(cfg.slots)) {
        if (!partId || partId === 'none') continue;
        const part = pack.parts[slotId]?.find((p) => p.id === partId);
        if (part) collected.set(`${slotId}:${partId}`, part);
      }
    }
  } else {
    for (const slot of pack.slots) {
      for (const part of pack.parts[slot.id] ?? []) {
        collected.set(`${slot.id}:${part.id}`, part);
      }
    }
  }

  const rows: CreditRow[] = [];
  for (const part of collected.values()) {
    const attr = part.attribution ?? defaultAttr;
    rows.push({
      slotId: part.slotId,
      partId: part.id,
      partName: part.name,
      author: attr.author,
      license: attr.license,
      url: attr.url ?? '',
      notes: attr.notes ?? '',
    });
  }

  rows.sort((a, b) => a.slotId.localeCompare(b.slotId) || a.partId.localeCompare(b.partId));

  const csvLines = [
    'slot_id,part_id,part_name,author,license,url,notes',
    ...rows.map((r) =>
      [r.slotId, r.partId, r.partName, r.author, r.license, r.url, r.notes]
        .map(escapeCsv)
        .join(','),
    ),
  ];

  // Group authors -> licenses for concise human-readable CREDITS.txt
  const byAuthor = new Map<string, { licenses: Set<string>; parts: string[]; url: string }>();
  for (const r of rows) {
    let entry = byAuthor.get(r.author);
    if (!entry) {
      entry = { licenses: new Set(), parts: [], url: r.url };
      byAuthor.set(r.author, entry);
    }
    entry.licenses.add(r.license);
    entry.parts.push(`${r.slotId}/${r.partId}`);
    if (!entry.url && r.url) entry.url = r.url;
  }

  const txtLines = [
    `PaperDollKit Asset Credits — ${pack.name} (${pack.id})`,
    `Total credited parts: ${rows.length}`,
    '',
  ];
  for (const [author, info] of byAuthor.entries()) {
    const lic = Array.from(info.licenses).join(', ');
    txtLines.push(`- ${author} (${lic})${info.url ? ` — ${info.url}` : ''}`);
    txtLines.push(`  Parts (${info.parts.length}): ${info.parts.slice(0, 12).join(', ')}${info.parts.length > 12 ? ', ...' : ''}`);
  }
  txtLines.push('');

  return {
    rows,
    csv: `${csvLines.join('\n')}\n`,
    txt: txtLines.join('\n'),
  };
}
