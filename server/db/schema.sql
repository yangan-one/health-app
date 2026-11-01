-- ============================================================
-- 个人健康管理应用 · 数据库结构（SQLite 3）  v0.7
-- 变更记录：
--   v0.1  初版
--   v0.2  单用户免登录：password_hash 允许为空，并预置 id=1 的默认用户
--         身体围度扩展为 8 项：颈围/肩围/胸围/臂围/腰围/臀围/大腿围/小腿围
--   v0.3  新增 users.goal_type（减脂/增肌/保持），新增 app_settings 表存 AI 配置
--   v0.4  食物营养库扩充到 58 条并补别名（配合拍照识别做名称匹配）
--   v0.7  多账号：users.username 唯一（大小写不敏感，索引在 db.js 的 migrate 里建），
--          password_hash 改存 scrypt 哈希（scrypt$N$r$p$salt$hash），每人数据按 user_id 隔离
--
-- 约定：
--  1) 业务日期统一存“用户本地日期”文本 'YYYY-MM-DD'，避免 UTC 偏移跨天。
--  2) 单位：热量 kcal / 三大营养素 g / 食物重量 g / 围度 cm / 体重 kg / 时长 min。
--  3) 汇总表保留冗余字段，看板与 AI 上下文一次查询即可。
--  4) 运动记录对体重做快照，历史消耗不因以后改体重而被重算。
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. 用户（当前单用户模式，不做登录；字段预留，后续直接启用）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  username           TEXT    NOT NULL UNIQUE,
  password_hash      TEXT,                                     -- 暂不做登录，可空
  nickname           TEXT,
  gender             TEXT    CHECK (gender IN ('male', 'female', 'other')),
  birth_date         TEXT,                                     -- 'YYYY-MM-DD'
  height_cm          REAL    CHECK (height_cm > 0 AND height_cm < 300),
  activity_level     TEXT    NOT NULL DEFAULT 'light'
                     CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  goal_type          TEXT    NOT NULL DEFAULT 'maintain'
                     CHECK (goal_type IN ('lose_fat', 'gain_muscle', 'maintain')),  -- 减脂/增肌/保持健康
  daily_calorie_goal INTEGER CHECK (daily_calorie_goal > 0),
  target_weight_kg   REAL    CHECK (target_weight_kg > 0),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at         TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = datetime('now', 'localtime') WHERE id = OLD.id;
END;

-- ------------------------------------------------------------
-- 1.1 应用设置（键值对）：AI 的 API Key / Base URL / 模型名等
--     敏感信息只存本地 SQLite，接口读取时一律脱敏返回
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (user_id, key)
);

-- ------------------------------------------------------------
-- 2. 身体维度记录（每天一条，重复提交走 UPSERT）
--    围度 8 项：颈 / 肩 / 胸 / 臂 / 腰 / 臀 / 大腿 / 小腿
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS body_metrics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date  TEXT    NOT NULL,
  weight_kg    REAL    CHECK (weight_kg > 0 AND weight_kg < 500),
  body_fat_pct REAL    CHECK (body_fat_pct >= 0 AND body_fat_pct <= 100),
  neck_cm      REAL    CHECK (neck_cm > 0),        -- 颈围
  shoulder_cm  REAL    CHECK (shoulder_cm > 0),    -- 肩围
  chest_cm     REAL    CHECK (chest_cm > 0),       -- 胸围
  arm_cm       REAL    CHECK (arm_cm > 0),         -- 臂围（上臂）
  waist_cm     REAL    CHECK (waist_cm > 0),       -- 腰围
  hip_cm       REAL    CHECK (hip_cm > 0),         -- 臀围
  thigh_cm     REAL    CHECK (thigh_cm > 0),       -- 大腿围
  calf_cm      REAL    CHECK (calf_cm > 0),        -- 小腿围
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (user_id, record_date)
);

-- ------------------------------------------------------------
-- 3. 运动类型字典（METs）
--    消耗(kcal) = MET × 3.5 × 体重(kg) / 200 × 时长(min)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercise_types (
  code         TEXT PRIMARY KEY,          -- 'running_8' / 'jump_rope'
  name         TEXT    NOT NULL,
  met          REAL    NOT NULL CHECK (met > 0),
  category     TEXT,                      -- 有氧 / 无氧 / 柔韧 / 球类
  has_distance INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- 4. 运动记录
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercise_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date        TEXT    NOT NULL,
  exercise_type_code TEXT    REFERENCES exercise_types(code) ON DELETE SET NULL,
  exercise_type_name TEXT    NOT NULL,      -- 冗余快照
  met                REAL    NOT NULL CHECK (met > 0),
  duration_min       REAL    NOT NULL CHECK (duration_min > 0),
  distance_km        REAL    CHECK (distance_km >= 0),
  weight_kg          REAL    NOT NULL,      -- 计算时快照体重
  calories_burned    REAL    NOT NULL CHECK (calories_burned >= 0),
  note               TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- 5. 食物营养库
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS foods (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL UNIQUE,
  alias             TEXT,
  category          TEXT,
  calories_per_100g REAL    NOT NULL CHECK (calories_per_100g >= 0),
  protein_per_100g  REAL    NOT NULL DEFAULT 0,
  fat_per_100g      REAL    NOT NULL DEFAULT 0,
  carbs_per_100g    REAL    NOT NULL DEFAULT 0,
  is_verified       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- 6. 饮食记录
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diet_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date     TEXT    NOT NULL,
  meal_type       TEXT    NOT NULL
                  CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  image_path      TEXT,
  source          TEXT    NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'ai_image')),
  status          TEXT    NOT NULL DEFAULT 'done'
                  CHECK (status IN ('pending', 'done', 'failed')),
  ai_raw_response TEXT,
  total_calories  REAL    NOT NULL DEFAULT 0,
  total_protein   REAL    NOT NULL DEFAULT 0,
  total_fat       REAL    NOT NULL DEFAULT 0,
  total_carbs     REAL    NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS diet_record_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  diet_record_id     INTEGER NOT NULL REFERENCES diet_records(id) ON DELETE CASCADE,
  food_id            INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  food_name          TEXT    NOT NULL,
  estimated_weight_g REAL    NOT NULL CHECK (estimated_weight_g > 0),
  calories           REAL    NOT NULL DEFAULT 0,
  protein            REAL    NOT NULL DEFAULT 0,
  fat                REAL    NOT NULL DEFAULT 0,
  carbs              REAL    NOT NULL DEFAULT 0,
  confidence         REAL    CHECK (confidence >= 0 AND confidence <= 1),
  is_manual          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- 7. AI 问答
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content         TEXT    NOT NULL,
  tokens          INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ------------------------------------------------------------
-- 8. 索引
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_body_user_date     ON body_metrics (user_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_ex_user_date       ON exercise_records (user_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_diet_user_date     ON diet_records (user_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_diet_items_record  ON diet_record_items (diet_record_id);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv        ON ai_messages (conversation_id, id);

-- ------------------------------------------------------------
-- 9. 每日汇总视图（看板 + AI 上下文共用）
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_daily_summary;
CREATE VIEW v_daily_summary AS
WITH dates AS (
  SELECT user_id, record_date FROM diet_records
  UNION
  SELECT user_id, record_date FROM exercise_records
),
intake AS (
  SELECT user_id, record_date,
         SUM(total_calories) AS calories,
         SUM(total_protein)  AS protein,
         SUM(total_fat)      AS fat,
         SUM(total_carbs)    AS carbs
  FROM diet_records
  WHERE status = 'done'
  GROUP BY user_id, record_date
),
burn AS (
  SELECT user_id, record_date, SUM(calories_burned) AS calories
  FROM exercise_records
  GROUP BY user_id, record_date
)
SELECT
  d.user_id,
  d.record_date,
  COALESCE(i.calories, 0) AS intake_calories,
  COALESCE(i.protein, 0)  AS intake_protein,
  COALESCE(i.fat, 0)      AS intake_fat,
  COALESCE(i.carbs, 0)    AS intake_carbs,
  COALESCE(b.calories, 0) AS burn_calories,
  COALESCE(i.calories, 0) - COALESCE(b.calories, 0) AS net_calories
FROM dates d
LEFT JOIN intake i ON i.user_id = d.user_id AND i.record_date = d.record_date
LEFT JOIN burn   b ON b.user_id = d.user_id AND b.record_date = d.record_date;

-- ------------------------------------------------------------
-- 10. 种子数据
--     10.1 默认用户（单用户免登录模式）
--     10.2 运动 METs 字典
--     10.3 常见食物营养（示例数据）
-- ------------------------------------------------------------
INSERT OR IGNORE INTO users (id, username, nickname, gender, height_cm, activity_level, daily_calorie_goal)
VALUES (1, 'me', '我', 'male', 175, 'light', 1800);

INSERT OR IGNORE INTO exercise_types (code, name, met, category, has_distance, sort_order) VALUES
  ('walking_5',   '快走（5km/h）',      4.3,  '有氧', 1, 10),
  ('running_8',   '跑步（8km/h）',      8.3,  '有氧', 1, 20),
  ('running_10',  '跑步（10km/h）',     9.8,  '有氧', 1, 30),
  ('cycling_16',  '骑行（16-19km/h）',  6.8,  '有氧', 1, 40),
  ('jump_rope',   '跳绳（中速）',      12.3,  '有氧', 0, 50),
  ('swimming',    '游泳（自由泳）',     8.0,  '有氧', 1, 60),
  ('strength',    '力量训练',           5.0,  '无氧', 0, 70),
  ('hiit',        'HIIT 间歇训练',      8.0,  '无氧', 0, 80),
  ('yoga',        '瑜伽',               2.5,  '柔韧', 0, 90),
  ('basketball',  '篮球',               6.5,  '球类', 0, 100),
  ('badminton',   '羽毛球',             5.5,  '球类', 0, 110);

INSERT OR IGNORE INTO foods
  (name, category, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, is_verified) VALUES
  ('米饭',     '主食', 116, 2.6,  0.3, 25.9, 1),
  ('全麦面包', '主食', 247, 9.0,  3.3, 46.0, 1),
  ('燕麦片',   '主食', 367, 15.0, 6.7, 61.0, 1),
  ('鸡胸肉',   '肉蛋', 133, 19.4, 5.0,  2.5, 1),
  ('鸡蛋',     '肉蛋', 144, 13.3, 8.8,  2.8, 1),
  ('三文鱼',   '肉蛋', 139, 17.2, 7.8,  0.0, 1),
  ('牛奶',     '乳品',  54,  3.0, 3.2,  3.4, 1),
  ('豆腐',     '豆类',  82,  8.1, 3.7,  4.2, 1),
  ('西兰花',   '蔬菜',  34,  4.1, 0.6,  4.3, 1),
  ('香蕉',     '水果',  93,  1.4, 0.2, 22.0, 1),
  ('苹果',     '水果',  52,  0.2, 0.2, 13.5, 1),
  ('牛油果',   '水果', 160,  2.0, 14.7, 8.5, 1);

-- v0.4：拍照识别会返回各种菜名，营养库太薄会导致大量项目只能信模型。
-- 这里补齐中式餐桌上最常见的食材/主食/饮品（数值取中国食物成分表的常见值，单位为每 100g）。
INSERT OR IGNORE INTO foods
  (name, alias, category, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, is_verified) VALUES
  ('馒头',   '白馒头,花卷',        '主食', 223,  7.0,  1.1, 47.0, 1),
  ('面条',   '拉面,挂面,汤面,面',  '主食', 110,  4.5,  0.5, 23.0, 1),
  ('米粉',   '米线,河粉,粉',      '主食',  96,  1.8,  0.2, 21.0, 1),
  ('包子',   '肉包,菜包,小笼包',  '主食', 227,  8.0,  8.0, 30.0, 1),
  ('饺子',   '水饺,煎饺,锅贴',    '主食', 240,  9.0, 10.0, 28.0, 1),
  ('油条',   '油炸鬼',            '主食', 388,  6.9, 17.6, 51.0, 1),
  ('粥',     '白粥,稀饭,米粥',    '主食',  46,  1.1,  0.3,  9.9, 1),
  ('玉米',   '玉米棒,甜玉米',      '主食', 106,  4.0,  1.2, 22.8, 1),
  ('红薯',   '地瓜,番薯',          '主食',  99,  1.1,  0.2, 24.7, 1),
  ('猪肉',   '瘦肉,猪肉丝,里脊,肉丝', '肉蛋', 143, 20.3, 6.2, 1.5, 1),
  ('五花肉', '肥肉,红烧肉',        '肉蛋', 518,  7.7, 53.0,  2.4, 1),
  ('牛肉',   '牛肉片,瘦牛肉,牛腩', '肉蛋', 106, 20.2,  2.3,  1.2, 1),
  ('羊肉',   '羊肉片,羊排',        '肉蛋', 203, 19.0, 14.0,  0.0, 1),
  ('鸡腿',   '鸡腿肉,鸡翅根',      '肉蛋', 181, 16.0, 13.0,  0.0, 1),
  ('虾',     '虾仁,基围虾,大虾',   '肉蛋',  93, 18.6,  0.8,  2.8, 1),
  ('鱼',     '鱼肉,草鱼,清蒸鱼',   '肉蛋', 113, 16.6,  5.2,  0.0, 1),
  ('香肠',   '火腿肠,腊肠',        '肉蛋', 508, 24.1, 40.7, 11.2, 1),
  ('豆腐干', '豆干,香干',          '豆类', 140, 16.2,  3.6, 11.5, 1),
  ('豆浆',   '豆奶',              '豆类',  31,  3.0,  1.6,  1.2, 1),
  ('酸奶',   '原味酸奶,发酵乳',    '乳品',  72,  3.2,  3.5,  9.0, 1),
  ('奶酪',   '芝士,起司',          '乳品', 328, 25.7, 23.5,  3.5, 1),
  ('番茄',   '西红柿',            '蔬菜',  20,  0.9,  0.2,  4.0, 1),
  ('黄瓜',   '青瓜',              '蔬菜',  16,  0.8,  0.2,  2.9, 1),
  ('土豆',   '马铃薯,土豆丝',      '蔬菜',  77,  2.0,  0.2, 17.2, 1),
  ('胡萝卜', '红萝卜',            '蔬菜',  39,  1.0,  0.2,  8.8, 1),
  ('生菜',   '球生菜,油麦菜',      '蔬菜',  15,  1.3,  0.3,  2.0, 1),
  ('白菜',   '大白菜,娃娃菜',      '蔬菜',  17,  1.5,  0.1,  3.2, 1),
  ('茄子',   '长茄,紫茄',          '蔬菜',  23,  1.1,  0.2,  4.9, 1),
  ('青椒',   '尖椒,彩椒',          '蔬菜',  22,  1.4,  0.3,  5.4, 1),
  ('蘑菇',   '香菇,平菇,菌菇',     '蔬菜',  20,  2.7,  0.1,  4.1, 1),
  ('南瓜',   '倭瓜',              '蔬菜',  23,  0.7,  0.1,  5.3, 1),
  ('西瓜',   '瓜',                '水果',  26,  0.6,  0.1,  6.8, 1),
  ('橙子',   '橙,柑橘',            '水果',  48,  0.8,  0.2, 11.1, 1),
  ('葡萄',   '提子',              '水果',  44,  0.5,  0.2, 10.3, 1),
  ('花生',   '花生米,花生仁',      '坚果', 574, 24.8, 44.3, 21.7, 1),
  ('坚果',   '核桃,杏仁,腰果,混合坚果', '坚果', 600, 20.0, 50.0, 20.0, 1),
  ('巧克力', '黑巧克力,牛奶巧克力', '零食', 546,  4.9, 31.0, 61.4, 1),
  ('蛋糕',   '奶油蛋糕,面包胚',    '零食', 347,  8.6, 15.1, 47.2, 1),
  ('冰淇淋', '雪糕,冰激凌',        '零食', 207,  3.5, 11.0, 24.0, 1),
  ('可乐',   '汽水,碳酸饮料',      '饮品',  43,  0.0,  0.0, 10.8, 1),
  ('奶茶',   '珍珠奶茶,奶盖茶',    '饮品',  90,  1.5,  3.0, 15.0, 1),
  ('啤酒',   '听装啤酒',          '饮品',  43,  0.4,  0.0,  3.6, 1),
  ('炸鸡',   '鸡块,鸡翅,炸鸡腿',   '快餐', 279, 20.0, 18.0,  9.0, 1),
  ('汉堡',   '汉堡包,牛肉堡',      '快餐', 295, 15.0, 12.0, 30.0, 1),
  ('披萨',   '比萨,匹萨',          '快餐', 266, 11.0, 10.0, 33.0, 1),
  ('沙拉',   '蔬菜沙拉,轻食沙拉',  '快餐',  50,  2.0,  2.0,  5.0, 1);

-- 给 v0.1 就有的老条目补别名（只在为空时补，不覆盖用户改过的值）
UPDATE foods SET alias = '白米饭,白饭,大米饭' WHERE name = '米饭'   AND alias IS NULL;
UPDATE foods SET alias = '面包,吐司'          WHERE name = '全麦面包' AND alias IS NULL;
UPDATE foods SET alias = '燕麦,麦片'          WHERE name = '燕麦片'   AND alias IS NULL;
UPDATE foods SET alias = '鸡胸,鸡肉,鸡胸脯肉'  WHERE name = '鸡胸肉'   AND alias IS NULL;
UPDATE foods SET alias = '水煮蛋,煎蛋,荷包蛋'  WHERE name = '鸡蛋'     AND alias IS NULL;
UPDATE foods SET alias = '鲑鱼'              WHERE name = '三文鱼'   AND alias IS NULL;
UPDATE foods SET alias = '纯牛奶,鲜奶'        WHERE name = '牛奶'     AND alias IS NULL;
UPDATE foods SET alias = '老豆腐,嫩豆腐'      WHERE name = '豆腐'     AND alias IS NULL;
UPDATE foods SET alias = '绿花菜,西蓝花'      WHERE name = '西兰花'   AND alias IS NULL;
UPDATE foods SET alias = '香蕉果'            WHERE name = '香蕉'     AND alias IS NULL;
UPDATE foods SET alias = '红富士,苹果果'      WHERE name = '苹果'     AND alias IS NULL;
UPDATE foods SET alias = '鳄梨'              WHERE name = '牛油果'   AND alias IS NULL;

