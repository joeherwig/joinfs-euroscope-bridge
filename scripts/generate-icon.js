'use strict';

// Rasterizes docs/JoinFS-EuroScope-bridge-icon.svg into assets/icon.ico for
// use as the packaged .exe's icon (see build-exe.js).
//
// The ICO frames are written in the classic BMP-in-ICO format rather than
// the newer PNG-in-ICO format. rcedit's underlying resource compiler cannot
// reliably parse PNG-compressed icon frames (it was observed to hang
// indefinitely rather than error), so BMP frames are required for the icon
// to actually get embedded during the build.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'docs', 'JoinFS-EuroScope-bridge-icon.svg');
const outPath = path.join(root, 'assets', 'icon.ico');
const sizes = [16, 32, 48, 256];

function buildDib(raw, width, height) {
  const rowBytes = width * 4;
  const xor = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const srcOff = row * rowBytes;
    const dstRow = height - 1 - row; // BMP-in-ICO rows are stored bottom-up
    const dstOff = dstRow * rowBytes;
    for (let x = 0; x < width; x++) {
      const s = srcOff + x * 4;
      const d = dstOff + x * 4;
      const r = raw[s];
      const g = raw[s + 1];
      const b = raw[s + 2];
      const a = raw[s + 3];
      xor[d] = b;
      xor[d + 1] = g;
      xor[d + 2] = r;
      xor[d + 3] = a;
    }
  }

  const andRowBytes = Math.ceil(width / 32) * 4;
  const and = Buffer.alloc(andRowBytes * height, 0); // opaque; real alpha lives in xor

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(width, 4); // biWidth
  header.writeInt32LE(height * 2, 8); // biHeight (xor + and)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  return Buffer.concat([header, xor, and]);
}

async function generateIcon() {
  const dibs = [];
  for (const size of sizes) {
    const { data, info } = await sharp(svgPath, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    dibs.push({ size, data: buildDib(data, info.width, info.height) });
  }

  const headerSize = 6 + 16 * sizes.length;
  let offset = headerSize;
  const offsets = dibs.map((d) => {
    const o = offset;
    offset += d.data.length;
    return o;
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = Buffer.alloc(16 * sizes.length);
  dibs.forEach((d, i) => {
    const base = i * 16;
    const widthByte = d.size >= 256 ? 0 : d.size;
    entries.writeUInt8(widthByte, base);
    entries.writeUInt8(widthByte, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(d.data.length, base + 8);
    entries.writeUInt32LE(offsets[i], base + 12);
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat([header, entries, ...dibs.map((d) => d.data)]));
  return outPath;
}

if (require.main === module) {
  generateIcon()
    .then((p) => console.log(`Wrote ${p}`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}

module.exports = { generateIcon };
