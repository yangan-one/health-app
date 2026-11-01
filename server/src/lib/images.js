import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiError } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** server/uploads —— 由 app.js 以 /uploads 静态托管 */
// 云平台一般只能挂一个持久卷，所以允许用 UPLOAD_DIR 把它指到同一个卷里
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '..', '..', 'uploads');

const MAX_BYTES = 8 * 1024 * 1024; // 8MB，前端会先压到 1280px 宽，通常只有 200-400KB
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * 解析前端传来的 base64 图片（data URL）。
 * 为什么不用 multipart：少一个依赖、少一层解析，express.json 已经在了；
 * 前端用 canvas 压缩后转 data URL，体量完全可控。
 */
export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new ApiError(400, '缺少图片数据（image 需要是 data:image/...;base64,... 格式）');
  }
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,([\s\S]+)$/i);
  if (!m) throw new ApiError(400, '图片格式不支持，只接受 jpg / png / webp 的 base64 data URL');

  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new ApiError(400, `图片类型 ${mime} 不支持，只接受 jpg / png / webp`);

  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length) throw new ApiError(400, '图片内容是空的');
  if (buffer.length > MAX_BYTES) {
    throw new ApiError(413, `图片太大了（${(buffer.length / 1024 / 1024).toFixed(1)}MB），请压缩到 8MB 以内`);
  }
  return { buffer, ext, mime };
}

/** 按天分目录落盘，返回可直接放到 <img src> 里的路径 */
export function saveImage(buffer, ext, recordDate) {
  const dir = path.join(UPLOAD_DIR, recordDate);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return { url: `/uploads/${recordDate}/${name}`, abs_path: path.join(dir, name) };
}

/** 删除图片：只允许删 uploads 目录内的文件，防止路径穿越 */
export function removeImage(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return false;
  const abs = path.resolve(UPLOAD_DIR, url.slice('/uploads/'.length));
  if (!abs.startsWith(UPLOAD_DIR)) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}
