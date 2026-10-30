/**
 * 烹饪方式的用油/用糖表 —— 必须与 server/src/lib/cooking.js 保持一致。
 *
 * 前端为什么也要有一份：用户在识别结果里改了「克重」甚至改了「菜名」时，
 * 需要立刻在本地重算，不能每次都等网络。数值口径和服务器一致，所以两边算出来一样。
 */

export const COOKING_METHODS = [
  '水煮',
  '蒸',
  '白灼',
  '凉拌',
  '清炒',
  '炒',
  '煎',
  '炸',
  '烤',
  '红烧',
  '糖醋',
  '卤',
  '生食',
  '未知',
];

/** 每 100g 菜品额外加入的油 / 糖（克） */
export const COOKING_PROFILES = {
  水煮: { oil_g: 0, sugar_g: 0 },
  蒸: { oil_g: 0, sugar_g: 0 },
  白灼: { oil_g: 0, sugar_g: 0 },
  生食: { oil_g: 0, sugar_g: 0 },
  凉拌: { oil_g: 4, sugar_g: 0 },
  清炒: { oil_g: 7, sugar_g: 0 },
  炒: { oil_g: 7, sugar_g: 0 },
  烤: { oil_g: 3, sugar_g: 0 },
  煎: { oil_g: 10, sugar_g: 0 },
  炸: { oil_g: 14, sugar_g: 0 },
  红烧: { oil_g: 7, sugar_g: 5 },
  糖醋: { oil_g: 7, sugar_g: 10 },
  卤: { oil_g: 2, sugar_g: 0 },
  未知: { oil_g: 0, sugar_g: 0 },
};

/** 菜名本身已含做法的成品菜，营养库里已算过油，不能再加一次 */
const SELF_COOKED = /油条|炸|汉堡|披萨|蛋糕|饼干|奶茶|香肠|培根|蛋挞|薯条|红烧|糖醋|卤|沙拉|月饼/;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 计算每 100g 菜品因做法额外增加的油糖。
 * @returns {{ applied: boolean, oil_g: number, sugar_g: number, extra_calories: number }}
 */
export function cookingExtraPer100(method, foodName = '') {
  const none = { applied: false, oil_g: 0, sugar_g: 0, extra_calories: 0 };
  const p = COOKING_PROFILES[method];
  if (!p || (!p.oil_g && !p.sugar_g)) return none;
  if (SELF_COOKED.test(String(foodName))) return none;

  const oil_g = p.oil_g;
  const sugar_g = p.sugar_g;
  return {
    applied: true,
    oil_g,
    sugar_g,
    extra_calories: Math.round(oil_g * 9 + sugar_g * 4),
  };
}

/** 把营养库的「生重/水煮」基准值，按做法修正成这道菜实际的每 100g 营养 */
export function applyCookingToPer100(base, method, foodName = '') {
  const adj = cookingExtraPer100(method, foodName);
  if (!adj.applied) return { ...base, cooking: adj };
  return {
    calories: round1(Number(base.calories ?? 0) + adj.extra_calories),
    protein: Number(base.protein ?? 0),
    fat: round1(Number(base.fat ?? 0) + adj.oil_g),
    carbs: round1(Number(base.carbs ?? 0) + adj.sugar_g),
    cooking: adj,
  };
}
