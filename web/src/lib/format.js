/** 本地日期 YYYY-MM-DD（不能用 toISOString，那是 UTC） */
export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** '2026-10-30' -> '10/30' */
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** '2026-10-30' -> '10月30日 周四' */
export function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 ${WEEKDAYS[dt.getDay()]}`;
}

/** 今天/昨天/具体日期 */
export function relativeDay(iso) {
  if (!iso) return '';
  const today = todayISO();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === today) return '今天';
  if (iso === todayISO(y)) return '昨天';
  return longDate(iso);
}

export const fmt = (n, digits = 0) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  return Number(n).toFixed(digits);
};

export const signed = (n, digits = 1) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
};
