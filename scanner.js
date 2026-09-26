'use strict';
const fs = require('fs');
const path = require('path');

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'SYSTEM VOLUME INFORMATION', 'NODE_MODULES', '.GIT']);

/** 递归收集目录下所有图片文件路径 */
function walkImages(root) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toUpperCase())) continue;
        walk(p, depth + 1);
      } else if (e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push(p);
      }
    }
  })(root, 0);
  return out;
}

/** 从 JPEG 头部字节中解析 EXIF DateTimeOriginal / DateTime（仅需前 256KB） */
function extractExifDate(buf) {
  try {
    if (buf.length < 12 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let off = 2;
    while (off + 4 < buf.length) {
      if (buf[off] !== 0xFF) { off++; continue; }
      const marker = buf[off + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      const len = buf.readUInt16BE(off + 2);
      if (marker === 0xE1 && buf.slice(off + 4, off + 10).toString('latin1') === 'Exif\u0000') {
        const tiff = off + 10;
        const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
        const r16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const r32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        function readIFD(o) {
          const n = r16(o);
          const entries = [];
          for (let i = 0; i < n; i++) {
            const eo = o + 2 + i * 12;
            entries.push({ tag: r16(eo), valOff: eo + 8 });
          }
          return entries;
        }
        const ifd0 = tiff + r32(tiff + 4);
        const ifds = [readIFD(ifd0)];
        const exifPtr = ifds[0].find(e => e.tag === 0x8769);
        if (exifPtr) {
          try { ifds.push(readIFD(tiff + r32(exifPtr.valOff))); } catch { /* ignore */ }
        }
        for (const tag of [0x9003, 0x9004, 0x0132]) {
          for (const ifd of ifds) {
            const e = ifd.find(x => x.tag === tag);
            if (!e) continue;
            let po = e.valOff;
            if (r16(e.valOff - 8 + 4) > 4) po = tiff + r32(e.valOff);
            const s = buf.toString('latin1', po, po + 19);
            const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
            if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
          }
        }
        return null;
      }
      off += 2 + len;
    }
  } catch { /* ignore */ }
  return null;
}

/** 用 Electron nativeImage 计算 64 位 dHash 感知哈希（16 位 hex） */
function computePhash(img) {
  try {
    const w = 9, h = 8;
    const r = img.resize({ width: w, height: h });
    const b = r.toBitmap();
    const gray = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * b[i * 4 + 2] + 0.587 * b[i * 4 + 1] + 0.114 * b[i * 4];
    }
    let bits = 0n;
    let idx = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        if (gray[y * w + x + 1] > gray[y * w + x]) bits |= (1n << BigInt(idx));
        idx++;
      }
    }
    return bits.toString(16).padStart(16, '0');
  } catch { return null; }
}

module.exports = { walkImages, extractExifDate, computePhash };
