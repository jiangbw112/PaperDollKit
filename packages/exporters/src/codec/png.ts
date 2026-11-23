import { zlibSync } from 'fflate';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Precomputed IEEE 802.3 CRC32 lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

/**
 * Pure TypeScript lossless 8-bit RGBA PNG encoder (works in Browser & Node.js).
 * Uses PNG Sub scanline filter + zlib deflate for compact game texture atlases.
 */
export function encodePngRGBA(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`RGBA buffer too small: got ${rgba.length}, expected ${expected}`);
  }

  // IHDR: width(4), height(4), bitDepth(1)=8, colorType(1)=6(RGBA), comp(1)=0, filter(1)=0, interlace(1)=0
  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, width);
  writeUint32BE(ihdrData, 4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // Build filtered scanlines using Filter Type 1 (Sub) for crisp sprite compression
  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstRow = y * (rowBytes + 1);
    const srcRow = y * rowBytes;
    raw[dstRow] = 1; // Sub filter
    for (let x = 0; x < rowBytes; x++) {
      const cur = rgba[srcRow + x]!;
      const left = x >= 4 ? rgba[srcRow + x - 4]! : 0;
      raw[dstRow + 1 + x] = (cur - left) & 0xff;
    }
  }

  const compressed = zlibSync(raw, { level: 6 });

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length,
  );
  let offset = 0;
  out.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  out.set(ihdr, offset);
  offset += ihdr.length;
  out.set(idat, offset);
  offset += idat.length;
  out.set(iend, offset);
  return out;
}
