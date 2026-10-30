/**
 * 生成 PWA 图标（PNG）：npm run icons
 *
 * 不装任何图像库，用 zlib + 手写 PNG 分块直接画：翡翠绿底 + 白色心率折线。
 * 产物写到 web/public/icons/，被 manifest.webmanifest 和 index.html 引用。
 */
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'icons');

const BG = [5, 150, 105, 255]; // emerald-600
const FG = [255, 255, 255, 255];

// 心率折线（相对坐标 0~1）
const PULSE = [
  [0.14, 0.54], [0.33, 0.54], [0.41, 0.28], [0.52, 0.76], [0.60, 0.40], [0.65, 0.54], [0.86, 0.54],
];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 画一条有宽度的线段（对每像素算到线段的距离） */
function drawLine(rgba, size, x0, y0, x1, y1, w) {
  const half = w / 2;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + w));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + w));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      let t = (px * dx + py * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ddx = px - t * dx;
      const ddy = py - t * dy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= half) {
        const i = (y * size + x) * 4;
        rgba[i] = FG[0];
        rgba[i + 1] = FG[1];
        rgba[i + 2] = FG[2];
        rgba[i + 3] = FG[3];
      }
    }
  }
}

function makeIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = BG[3];
  }
  const scale = 1 - padding * 2; // 内容区缩放（maskable 要留安全边距）
  const offset = padding;
  const pts = PULSE.map(([x, y]) => [(offset + x * scale) * size, (offset + y * scale) * size]);
  const w = Math.max(2, size * 0.052 * scale);
  for (let i = 0; i < pts.length - 1; i += 1) {
    drawLine(rgba, size, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w);
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { padding: 0.1 }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, opts] of targets) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, makeIcon(size, opts));
  console.log(`✓ ${name} (${size}×${size}) ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}
