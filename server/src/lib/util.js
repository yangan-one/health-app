/** 统一的可预期业务异常，由 errorHandler 转成 JSON 响应 */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** 取“本地日期” YYYY-MM-DD（不要用 toISOString，那是 UTC，凌晨会错天） */
export function todayLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 校验 YYYY-MM-DD 且是真实存在的日期 */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

export const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * 把请求体里的数值字段解析成 number。
 * @returns {{ value: number|null, error: string|null }}
 */
export function parseNumber(raw, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return { value: null, error: null };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { value: null, error: `${label} 必须是数字` };
  if (integer && !Number.isInteger(n)) return { value: null, error: `${label} 必须是整数` };
  if (n < min) return { value: null, error: `${label} 不能小于 ${min}` };
  if (n > max) return { value: null, error: `${label} 不能大于 ${max}` };
  return { value: n, error: null };
}

/** 取请求体里的日期字段，缺省用今天 */
export function parseDate(raw, field = 'record_date') {
  if (raw === undefined || raw === null || raw === '') return todayLocal();
  if (!isValidDateStr(raw)) throw new ApiError(400, `${field} 格式应为 YYYY-MM-DD`);
  return raw;
}

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, '请求体必须是 JSON 对象');
  }
  return body;
}
