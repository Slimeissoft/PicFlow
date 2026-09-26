// 用 Node 内置 zlib 生成 256x256 PNG，并包成 ICO（PNG-in-ICO，Win Vista+ 支持）
const zlib = require('zlib');
const fs = require('fs');

const W = 256, H = 256;
const raw = Buffer.alloc((W * 4 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // PNG filter: none
  for (let x = 0; x < W; x++) {
    let r = 31, g = 35, b = 40, a = 255; // 深色背景 #1f2328
    const inSq = ((x >= 72 && x < 116) || (x >= 140 && x < 184)) && ((y >= 72 && y < 116) || (y >= 140 && y < 184));
    if (inSq) { r = 255; g = 255; b = 255; } // 白色 4 格
    raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
  }
}
const idat = zlib.deflateSync(raw);

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([head, entry, png]);

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.ico', ico);
console.log('icon generated:', ico.length, 'bytes');
