/**
 * API Key 清洗层。
 *
 * 为什么需要这一层：云平台（Sealos / Railway / Render…）的环境变量是手填的，
 * 很容易把说明文字、全角括号、中文占位符一起粘进去，例如
 *   AI_VISION_API_KEY=【本机 server/.env 里那行 49 字符的 Key】
 * 这种字符串一旦拼进 HTTP 头 `Authorization: Bearer <key>`，fetch 会抛：
 *   Cannot convert argument to a ByteString because the character at index 7
 *   has a value of 12304 which is greater than 255.
 * index 7 正好是 `Bearer `（7 个字符）之后的第一个字符，也就是 Key 的首字符，
 * 用户完全看不出是 Key 的问题。所以在「读配置」这一层就把它拦下来，
 * 换成一句人话告诉用户哪里错了、怎么改。
 */

/** 合法 Key 的字符集：可见 ASCII（! 到 ~），不含空格、制表符、全角字符、中文 */
const VALID_KEY = /^[\x21-\x7E]+$/;

/** 单项字符是否合法（用于定位第一个坏字符） */
const BAD_CHAR = /[^\x21-\x7E]/;

/**
 * 清洗一个 Key 值。
 * @returns {{value: string, reason: null|'empty'|'invalid_char'|'too_short', char?: string, code?: number, position?: number, length?: number}}
 *   value 为 '' 时表示「不可用」，reason 说明原因；可用时 value 是去掉首尾空白/引号后的干净 Key。
 */
export function sanitizeApiKey(raw) {
  if (raw === null || raw === undefined) return { value: '', reason: 'empty' };

  // 去掉 BOM（Windows 记事本保存的 .env 有时带），首尾空白，以及被一起粘进来的引号
  let text = String(raw).replace(/^\uFEFF/, '').trim();
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  if (!text) return { value: '', reason: 'empty' };

  if (!VALID_KEY.test(text)) {
    const chars = [...text];
    const index = chars.findIndex((ch) => BAD_CHAR.test(ch));
    const char = chars[index];
    return {
      value: '',
      reason: 'invalid_char',
      char,
      code: char.codePointAt(0),
      // 从 1 开始数，方便和日志里「第 N 个字符」对上
      position: index + 1,
    };
  }

  if (text.length < 8) return { value: '', reason: 'too_short', length: text.length };

  return { value: text, reason: null };
}

/**
 * 把清洗结果翻译成用户能看懂的中文提示（不可用时才调用）。
 * @param {ReturnType<typeof sanitizeApiKey>} result
 * @param {{name?: string}} options name 用变量名，例如 AI_VISION_API_KEY
 */
export function describeKeyProblem(result, { name = 'AI API Key' } = {}) {
  switch (result?.reason) {
    case 'invalid_char':
      return (
        `${name} 的值不是有效的 Key：从第 ${result.position} 个字符起出现了「${result.char}」。` +
        'Key 只能是英文字母、数字和符号，不能有中文、全角括号或空格。' +
        '常见原因是把占位说明文字原样粘了进去，请改成真实的 Key，或者直接删掉这个变量。'
      );
    case 'too_short':
      return (
        `${name} 只有 ${result.length} 个字符，看起来没复制完整。` +
        '常见 Key 长度在 32～64 个字符之间，请重新复制一次。'
      );
    case 'empty':
    default:
      return `${name} 为空。`;
  }
}

/** 便捷判断：这个环境变量里到底是不是一个能用的 Key */
export function isUsableApiKey(raw) {
  return Boolean(sanitizeApiKey(raw).value);
}
