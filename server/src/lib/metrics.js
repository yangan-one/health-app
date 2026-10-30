/**
 * 身体数据字段白名单。
 * 只允许这些字段进数据库，前端多传别的键会被忽略，也避免动态 SQL 注入。
 * min/max 是“明显填错”的兜底校验，不是医学判断。
 */
export const METRIC_RULES = {
  weight_kg: { label: '体重(kg)', min: 10, max: 400 },
  body_fat_pct: { label: '体脂率(%)', min: 0, max: 100 },
  neck_cm: { label: '颈围(cm)', min: 10, max: 150 },
  shoulder_cm: { label: '肩围(cm)', min: 20, max: 250 },
  chest_cm: { label: '胸围(cm)', min: 20, max: 250 },
  arm_cm: { label: '臂围(cm)', min: 10, max: 150 },
  waist_cm: { label: '腰围(cm)', min: 20, max: 250 },
  hip_cm: { label: '臀围(cm)', min: 20, max: 250 },
  thigh_cm: { label: '大腿围(cm)', min: 10, max: 150 },
  calf_cm: { label: '小腿围(cm)', min: 10, max: 150 },
};

export const METRIC_FIELDS = Object.keys(METRIC_RULES);

/** 给前端渲染表单用的元数据 */
export const METRIC_META = Object.entries(METRIC_RULES).map(([field, rule]) => ({
  field,
  label: rule.label,
  min: rule.min,
  max: rule.max,
  unit: field.endsWith('_cm') ? 'cm' : field === 'weight_kg' ? 'kg' : '%',
}));
