// utils/imageDimensions.js
// 纯 JS 解析常见图片格式的尺寸（只读前几个字节，不依赖第三方库）
// 支持 JPEG / PNG / GIF / WebP
//
// 用法：const { width, height } = getImageDimensions(filePath);
//
// 失败返回 null（调用方应回退到默认占位）

const fs = require('fs');

function readU16BE(buf, off) { return (buf[off] << 8) | buf[off + 1]; }
function readU16LE(buf, off) { return buf[off] | (buf[off + 1] << 8); }
function readU32BE(buf, off) { return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]; }

// 解析 JPEG：找 SOF 段，段内即宽高
function parseJPEG(buf) {
  // SOI: 0xFF 0xD8
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let off = 2;
  while (off < buf.length) {
    // 跳过填充 0xFF
    while (off < buf.length && buf[off] !== 0xFF) off++;
    while (off < buf.length && buf[off] === 0xFF) off++;
    if (off >= buf.length) return null;
    const marker = buf[off];
    off++;
    // SOF0-SOF3 / SOF5-SOF7 / SOF9-SOF11 / SOF13-SOF15 都包含尺寸
    const isSOF = (marker >= 0xC0 && marker <= 0xC3) ||
                  (marker >= 0xC5 && marker <= 0xC7) ||
                  (marker >= 0xC9 && marker <= 0xCB) ||
                  (marker >= 0xCD && marker <= 0xCF);
    if (isSOF && off + 7 <= buf.length) {
      const h = readU16BE(buf, off + 3);
      const w = readU16BE(buf, off + 5);
      return { width: w, height: h };
    }
    // DHT / DQT / DRI / APPx / COM 等段：2 字节长度（不含 marker 字节）
    if (off + 2 > buf.length) return null;
    const segLen = readU16BE(buf, off);
    off += segLen;
  }
  return null;
}

// 解析 PNG：固定位置 IHDR
function parsePNG(buf) {
  if (buf.length < 24) return null;
  const sig = buf.slice(0, 8);
  if (sig[0] !== 0x89 || sig[1] !== 0x50 || sig[2] !== 0x4E || sig[3] !== 0x47) return null;
  const w = readU32BE(buf, 16);
  const h = readU32BE(buf, 20);
  return { width: w, height: h };
}

// 解析 GIF：固定位置 LSD
function parseGIF(buf) {
  if (buf.length < 10) return null;
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null;
  const w = readU16LE(buf, 6);
  const h = readU16LE(buf, 8);
  return { width: w, height: h };
}

// 解析 WebP
function parseWebP(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // VP8 简单格式：4 字节宽高 + 标志位
    const w = readU16LE(buf, 26) & 0x3FFF;
    const h = readU16LE(buf, 28) & 0x3FFF;
    return { width: w, height: h };
  }
  if (chunk === 'VP8L') {
    // VP8L: 14-bit 宽高
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    const w = 1 + (((b1 & 0x3F) << 8) | b0);
    const h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
    return { width: w, height: h };
  }
  if (chunk === 'VP8X') {
    // 带 alpha/exif 等，24-26 为宽-1，27-29 为高-1
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  return null;
}

/**
 * 从文件路径读取尺寸，只读必要字节
 * @param {string} filePath
 * @returns {{width:number,height:number}|null}
 */
function getImageDimensions(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    // 读 256KB 头：大部分 JPEG 的 EXIF/APPx 段不会超过这个，SOF 段几乎都在前 100KB
    const buf = Buffer.alloc(262144);
    const bytesRead = fs.readSync(fd, buf, 0, 262144, 0);
    const head = buf.slice(0, bytesRead);

    // 按 magic bytes 路由
    if (head[0] === 0xFF && head[1] === 0xD8) return parseJPEG(head);
    if (head[0] === 0x89 && head[1] === 0x50) return parsePNG(head);
    if (head[0] === 0x47 && head[1] === 0x49) return parseGIF(head);
    if (head.toString('ascii', 0, 4) === 'RIFF') return parseWebP(head);
    return null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
    }
  }
}

module.exports = { getImageDimensions };
