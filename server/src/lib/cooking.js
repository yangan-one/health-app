/**
 * 烹饪方式的用油/用糖修正表。
 *
 * 为什么需要它：营养库里的数值是「生重 / 水煮 / 蒸」基准。同样 150g 鸡胸肉，
 * 水煮约 200 kcal，油炸接近 400 kcal —— 差距几乎全在油上。如果只看食材不看做法，
 * 一顿家常炒菜会被系统性低估 20%-40%。
 *
 * 这张表刻意做得「朴素且可解释」：按每 100g 菜品额外加多少克油、多少克糖来算，
 * 油 9 kcal/g、糖 4 kcal/g。数值是常见家庭/餐馆做法的一个折中值，不做精确化学分析。
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
  水煮: { oil_g: 0, sugar_g: 0, note: '水煮不加额外油糖' },
  蒸: { oil_g: 0, sugar_g: 0, note: '蒸制不加额外油糖' },
  白灼: { oil_g: 0, sugar_g: 0, note: '白灼几乎无油' },
  生食: { oil_g: 0, sugar_g: 0, note: '生食不加额外油糖' },
  凉拌: { oil_g: 4, sugar_g: 0, note: '凉拌有香油/辣椒油' },
  清炒: { oil_g: 7, sugar_g: 0, note: '家常炒菜约 7g 油/100g' },
  炒: { oil_g: 7, sugar_g: 0, note: '家常炒菜约 7g 油/100g' },
  烤: { oil_g: 3, sugar_g: 0, note: '烤制表面刷油' },
  煎: { oil_g: 10, sugar_g: 0, note: '煎制吸油较多' },
  炸: { oil_g: 14, sugar_g: 0, note: '油炸裹粉吸油最多' },
  红烧: { oil_g: 7, sugar_g: 5, note: '红烧有油 + 糖色' },
  糖醋: { oil_g: 7, sugar_g: 10, note: '糖醋汁含糖最高' },
  卤: { oil_g: 2, sugar_g: 0, note: '卤味用油较少' },
  未知: { oil_g: 0, sugar_g: 0, note: '未判断出烹饪方式，按基础值计' },
};

/**
 * 这个名字本身就把做法写进菜名的成品菜（油条、炸鸡、汉堡…），
 * 营养库里给的值已经包含了油，不能再加一遍。
 */
const SELF_COOKED = /油条|炸|汉堡|披萨|蛋糕|饼干|奶茶|香肠|培根|蛋挞|薯条|红烧|糖醋|卤|沙拉|月饼/;

/** 把模型可能写歪的烹饪方式收敛到白名单 */
export function normalizeCookingMethod(raw) {
  const s = String(raw ?? '').replace(/[\s。·、]/g, '');
  if (!s) return null;
  // 先判「糖醋/红烧」这类组合词，再判单字
  if (/糖醋|拔丝|酸甜|蜜汁/.test(s)) return '糖醋';
  if (/卤/.test(s) && !/红烧/.test(s)) return '卤';
  if (/红烧|酱烧|焖|酱爆/.test(s)) return '红烧';
  if (/油炸|炸|天妇罗|油爆|干锅/.test(s)) return '炸';
  if (/煎/.test(s)) return '煎';
  if (/清炒|快炒|小炒|爆炒|炒|干煸|煸|烩/.test(s)) return '清炒';
  if (/烤|烘|焗|空气炸/.test(s)) return '烤';
  if (/凉拌|拌|沙拉|刺身/.test(s)) return '凉拌';
  if (/蒸/.test(s)) return '蒸';
  if (/白灼|汆|焯|灼/.test(s)) return '白灼';
  if (/水煮|煮|炖|汤|涮|焖煮/.test(s)) return '水煮';
  if (/生|鲜食|生腌/.test(s)) return '生食';
  return null;
}

/**
 * 计算一份菜因烹饪方式额外增加的油、糖与热量。
 * @param {string|null} method 归一化后的做法
 * @param {number} weightG 这份菜的实际重量
 * @param {{ foodName?: string }} [opts] 成品菜名会跳过修正，避免重复加一次油
 * @returns {{ applied: boolean, method: string|null, oil_g: number, sugar_g: number,
 *             extra_calories: number, note: string|null }}
 */
export function cookingAdjustment(method, weightG, { foodName = '' } = {}) {
  const nothing = {
    applied: false,
    method: method ?? null,
    oil_g: 0,
    sugar_g: 0,
    extra_calories: 0,
    note: null,
  };

  if (!method || method === '未知') return nothing;
  const profile = COOKING_PROFILES[method];
  if (!profile) return nothing;
  if (!(profile.oil_g || profile.sugar_g)) {
    return { ...nothing, method, note: profile.note };
  }
  if (SELF_COOKED.test(String(foodName))) {
    return { ...nothing, method, note: '该食物本身是成品，热量已包含烹饪用油' };
  }

  const weight = Number(weightG);
  if (!Number.isFinite(weight) || weight <= 0) return { ...nothing, method };

  const k = weight / 100;
  const oil_g = Math.round(profile.oil_g * k * 10) / 10;
  const sugar_g = Math.round(profile.sugar_g * k * 10) / 10;
  return {
    applied: true,
    method,
    oil_g,
    sugar_g,
    extra_calories: Math.round(oil_g * 9 + sugar_g * 4),
    note: profile.note,
  };
}
