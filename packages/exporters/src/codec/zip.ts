import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * Packages a flat map of relative file paths -> bytes/UTF-8 text into a ZIP archive.
 */
export function packZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, content] of Object.entries(files)) {
    const cleanPath = path.replace(/^\/+/, '');
    if (typeof content === 'string') {
      zippable[cleanPath] = [strToU8(content), { level: 6 }];
    } else {
      // PNGs are already zlib-compressed; store them at level 0 for speed
      const isAlreadyCompressed = /\.(png|jpg|jpeg|webp)$/i.test(cleanPath);
      zippable[cleanPath] = [content, { level: isAlreadyCompressed ? 0 : 6 }];
    }
  }
  return zipSync(zippable);
}

/**
 * Unpacks a ZIP archive into a flat map of relative file paths -> raw Uint8Array bytes.
 */
export function unpackZip(zipBytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(zipBytes);
}
