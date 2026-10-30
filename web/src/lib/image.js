/**
 * 手机照片动辄 5-10MB，直接上传会让识别请求变慢、也更容易被接口拒。
 * 这里在浏览器里先缩放到 1280px 以内并转成 JPEG，通常能压到 300KB 左右。
 * 顺带把 EXIF 方向问题也解决了（canvas 绘制用的是已经旋转好的像素）。
 */

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片打不开，换一张试试'));
    };
    img.src = url;
  });
}

/**
 * @returns {Promise<{ dataUrl: string, width: number, height: number, kb: number }>}
 */
export async function fileToDataUrl(file, { maxWidth = 1280, quality = 0.85 } = {}) {
  if (!file) throw new Error('没有拿到图片');
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件（jpg / png / webp）');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('图片超过 25MB，建议先在相册里裁剪一下');

  const img = await loadImage(file);
  const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // 白底：PNG 透明区域转 JPEG 会变黑，垫一层白底更接近真实餐盘
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const kb = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 / 1024);
  return { dataUrl, width, height, kb };
}
