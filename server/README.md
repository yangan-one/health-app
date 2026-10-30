# 个人健康管理 · 后端

Node.js + Express + SQLite。单用户免登录，所有请求默认归属 `users.id = 1`。

## 目录结构

```
server/
├─ package.json
├─ .env.example              # 复制成 .env 后按需修改
├─ db/
│  └─ schema.sql             # 全部建表语句 + 种子数据（幂等，可重复执行）
├─ data/
│  └─ health.db              # SQLite 文件，首次启动自动生成
├─ uploads/                  # 拍照识别的原图（按日期分目录），删记录时同步删除
├─ scripts/
│  ├─ reset-db.js            # npm run db:reset
│  ├─ seed-demo.js           # npm run seed:demo
│  ├─ smoke.js               # 基础接口冒烟测试
│  ├─ diet-smoke.js          # 饮食链路端到端（离线演示模式）
│  ├─ vision-selftest.js     # 视觉响应解析 / 菜名匹配纯离线自测
│  └─ chat-smoke.js          # AI 问答端到端（22 项，可 --no-ai 跳过真实调用）
└─ src/
   ├─ server.js              # 启动入口
   ├─ app.js                 # express 装配 / 日志 / 统一错误处理
   ├─ db.js                  # 连接 + 自动建表 + 轻量迁移 + 当前用户
   ├─ lib/
   │  ├─ util.js             # ApiError、本地日期、数值校验
   │  ├─ body.js             # BMI / 腰臀比 / BMR / TDEE / 目标热量建议
   │  ├─ met.js              # METs 卡路里公式
   │  ├─ metrics.js          # 身体数据字段白名单
   │  ├─ ai.js               # AI 配置读写（Key 脱敏）+ 连通性检测 + 流式对话
   │  ├─ images.js           # data URL 解析 / 落盘 / 安全删除
   │  ├─ vision.js           # 视觉 Prompt + 调用 + 响应解析容错
   │  ├─ foods.js            # 营养库匹配与营养素换算
   │  ├─ cooking.js          # 烹饪方式 → 额外油/糖（清炒/煎/炸/红烧…）
   │  ├─ healthContext.js    # 把近期健康数据压成注入给 AI 的上下文文本
   │  └─ chatPrompt.js       # 教练 system prompt / 消息拼装 / 推荐问题
   └─ routes/
      ├─ profile.js          # 用户资料 / 目标类型
      ├─ bodyMetrics.js      # 身体维度录入 / 趋势
      ├─ exercises.js        # 运动类型 / 试算 / 记录
      ├─ dashboard.js        # 首页聚合（摄入 / 消耗 / 目标）
      ├─ diet.js             # 拍照识别 / 饮食记录 / 食物库
      ├─ chat.js             # AI 问答：上下文 / 会话 / 消息（含 SSE）
      ├─ settings.js         # AI 配置读写 + 测试连接
      └─ export.js           # 导出 JSON / CSV
```

## 启动

```bash
cd server
npm install
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
npm run dev              # 开发模式（改代码自动重启，Node 原生 --watch）
```

打开 <http://127.0.0.1:3001/api/health> 看到 `{"ok":true,...}` 即成功。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查，返回数据库路径与今日日期 |
| GET | `/api/profile` | 用户资料 + BMI / BMR / TDEE |
| PUT | `/api/profile` | 局部更新资料（身高、目标热量等） |
| GET | `/api/body-metrics/fields` | 身体数据字段定义（前端渲染表单用） |
| POST | `/api/body-metrics` | 录入/覆盖某天身体数据 |
| GET | `/api/body-metrics?from=&to=&limit=` | 历史列表（倒序） |
| GET | `/api/body-metrics/latest` | 最近一条 |
| GET | `/api/body-metrics/trend?days=30` | 折线图数据（升序） |
| DELETE | `/api/body-metrics/:id` | 删除 |
| GET | `/api/exercise-types` | 运动类型 + MET 值 |
| POST | `/api/exercises/calc` | 只试算消耗，不落库 |
| POST | `/api/exercises` | 新增运动记录（服务端算卡路里） |
| GET | `/api/exercises?date=YYYY-MM-DD` | 列表 + 合计 |
| DELETE | `/api/exercises/:id` | 删除 |
| GET | `/api/dashboard?date=YYYY-MM-DD` | 首页聚合：目标 / 摄入 / 消耗 / 运动明细 / 最近体测 |
| POST | `/api/diet/analyze` | 传图片（base64 data URL）让视觉模型识别菜品与重量，**只识别不落库** |
| POST | `/api/diet/records` | 保存一餐（营养素由服务端按营养库重算） |
| GET | `/api/diet/records?date=YYYY-MM-DD` | 当天饮食列表 + 合计（按餐次） |
| DELETE | `/api/diet/records/:id` | 删除一餐（连图片文件一起删） |
| GET | `/api/diet/foods?q=` | 营养库搜索（58 条，支持菜名归一匹配） |
| GET | `/api/diet/meal-types` | 早/午/晚/加餐 + 按服务器时间给出的建议餐次 |
| GET | `/api/settings` | AI 配置（Key 一律脱敏） |
| PUT | `/api/settings/ai` | 保存 `api_key` / `base_url` / `model`；`api_key: ""` = 清除 |
| POST | `/api/settings/ai/test` | 真实请求 `GET {base_url}/models` 检测连通性（8s 超时） |
| GET | `/api/export?format=json` | 导出全部数据（含饮食明细） |
| GET | `/api/export?format=csv&table=body\|exercise\|diet` | 导出单表 CSV（带 UTF-8 BOM，Excel 直接打开） |
| GET | `/api/export/summary` | 各表记录条数 |
| GET | `/api/chat/context?date=` | 这次会注入给 AI 的健康数据快照（纯文本）+ 推荐问题 |
| GET | `/api/chat/conversations` | 会话列表（带消息数、最后一句） |
| POST | `/api/chat/conversations` | 新建会话 |
| PATCH | `/api/chat/conversations/:id` | 改标题 |
| DELETE | `/api/chat/conversations/:id` | 删除会话（消息级联删除） |
| GET | `/api/chat/conversations/:id/messages` | 会话历史 |
| POST | `/api/chat/conversations/:id/messages` | 提问；`stream:true` 走 SSE 逐字返回 |

## SQLite 驱动（重要）

`src/lib/sqlite.js` 是驱动适配层：**装了 `better-sqlite3` 就用它，没装就退回 Node 内置的 `node:sqlite`**。

这样做的原因：`better-sqlite3` 在部分 Node 版本上没有预编译包，会回退到源码编译，需要本机装 Python + VS 生成工具链；内置 `node:sqlite` 零原生依赖，`npm install` 只装 express + cors 两个包。两者 API 一致（`prepare/get/all/run/exec`），业务代码无需区分。

```bash
# 想让 /api/health 里的 sqlite_driver 变成 better-sqlite3（可选，需要构建工具）
npm install better-sqlite3
```

要求 **Node >= 22.13**（`node:sqlite` 在此版本起无需 flag）。

## 演示数据

```bash
npm run seed:demo          # 生成近 14 天身体 + 运动示例数据（note='demo'，可重复执行）
npm run seed:demo -- 30    # 或指定天数
```

## 自测

```bash
# 终端 1
npm run dev

# 终端 2
npm run smoke
```

冒烟脚本覆盖 19 项断言：BMI/腰臀比计算、同日覆盖更新、非法数据拦截、METs 试算与落库一致性等。

```bash
# 饮食链路端到端（16 项，自动开/关离线演示模式，不消耗 token）
npm run smoke:diet

# 视觉解析纯离线自测（18 项：JSON 容错、菜名匹配、营养库换算）
npm run selftest:vision

# AI 问答端到端（22 项，会真实调用大模型两次左右，约 1-2k tokens）
npm run smoke:chat
npm run smoke:chat -- --no-ai   # 只看上下文/会话 CRUD，不烧 token
```

## 手动 curl 示例

```bash
# 录入身体数据（同一天重复提交 = 覆盖本次提交的字段）
curl -X POST http://127.0.0.1:3001/api/body-metrics \
  -H "Content-Type: application/json" \
  -d '{"weight_kg":72.4,"body_fat_pct":18.6,"neck_cm":38,"chest_cm":98,"waist_cm":82,"hip_cm":96,"thigh_cm":56,"calf_cm":37,"arm_cm":33}'

# 试算跑步 30 分钟消耗（体重自动取最近一次体测）
curl -X POST http://127.0.0.1:3001/api/exercises/calc \
  -H "Content-Type: application/json" \
  -d '{"type_code":"running_8","duration_min":30}'

# 记录运动
curl -X POST http://127.0.0.1:3001/api/exercises \
  -H "Content-Type: application/json" \
  -d '{"type_code":"jump_rope","duration_min":15,"note":"晚间跳绳"}'

# 近 30 天身体趋势
curl "http://127.0.0.1:3001/api/body-metrics/trend?days=30"
```

## AI Key 怎么存（只认 .env，前端不再让填）

这是个人自用项目，Key 直接写在 **`health-app/server/.env`** 里，改完重启后端即可，网页上不会再有任何填 Key 的输入框：

```bash
# 文本模型（第五步 AI 问答用）
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=sk-xxx
AI_MODEL=deepseek-chat

# 视觉模型（拍照识别食物）
AI_VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_VISION_MODEL=glm-4v-flash
AI_VISION_API_KEY=你的智谱key   # 留空则复用 AI_API_KEY
```

启动参数带 `--env-file-if-exists=.env`，所以不用装 dotenv。优先级：数据库里的设置（`app_settings`，只有老版本留下过）> `.env` 的 `AI_VISION_*` > `.env` 的 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`。

安全约定：`GET /api/settings` **只返回脱敏后的 Key**（`sk-ab****wxyz`）和 `key_source`（`env` / `env:vision` / `db` / `none`），明文永不出后端；导出数据里也不含明文 Key。

```bash
# 测试连通性（不消耗 token，只探测 /models；后端读自己的 .env）
curl -X POST http://127.0.0.1:3001/api/settings/ai/test -H "Content-Type: application/json" -d '{}'
```

## 拍照识别食物（第四步）

**DeepSeek 官方 API 目前没有视觉模型**，所以拍照识别要另配一个 OpenAI 兼容的多模态接口（Key 可复用同一个，也可换厂商）：

| 厂商 | Base URL | 模型 | 备注 |
|---|---|---|---|
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash` | 有免费额度，中文食物识别好 |
| 通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | 中文菜系稳 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 西餐更准 |
| 自定义 | 任意 | 任意 | 支持 `/chat/completions` + `image_url` 即可 |

在 `server/.env` 里填 `AI_VISION_MODEL` / `AI_VISION_BASE_URL` / `AI_VISION_API_KEY` 即可（不用重启换页面操作，改完重启后端）。

**没有 Key 也能先把链路跑通**：在 `.env` 里设 `VISION_FAKE=1`（或调用接口 `PUT /api/settings/ai {"vision_fake":true}`），`analyze` 会返回固定的 3 项示例（米饭 150g / 鸡胸肉 120g / 西兰花 80g），响应里 `meta.mode = "fake"` 明确标注。

核心约定：

- **Prompt 强制四步推演**：①识别菜名（混合菜拆成主要食材）→ ②用参照物估克重 → ③判断烹饪方式 → ④按油糖表修正。响应里每项带 `cooking_method`，顶层 `reasoning` 是这三步的结论（前端可展开给用户看）。
- **模型只回答「是什么 + 多重 + 怎么做」**。营养素优先按本地 `foods` 营养库重算（响应里 `source: "food_db"`），菜名对不上才用模型给的数值（`source: "ai"`）。
- **烹饪方式会改热量**：营养库是「生重/水煮」基准，`src/lib/cooking.js` 按做法补油糖（每 100g 菜品：清炒/炒 +7g 油、煎 +10g、炸 +14g、红烧 +7g 油 +5g 糖、糖醋 +7g 油 +10g 糖，油 9 kcal/g、糖 4 kcal/g）。同样 150g 鸡胸，水煮约 200 kcal，煎完约 335 kcal。
- **不重复加油**：菜名本身已是成品（红烧肉、炸鸡、油条、汉堡…）时不再加，因为营养库里那一条已经算过油。
- **接口返回 `per_100g`（不含烹饪用油）**，前端改克重时用它 × 克重 + 油糖修正，本地即时重算，结果与服务端一致（不对的话对账会差 1 kcal，取整顺序已对齐）。
- **两阶段**：`/api/diet/analyze` 只识别（用户还能改克重），确认后才 `POST /api/diet/records` 落库；前端把 `cooking_method` 一起传回来，服务端复算。
- **不装 multer**：图片由前端压到 ≤1280px 的 JPEG 后转 base64 上传（`express.json({limit:'12mb'})`），少一个依赖、少一处安全面。

```bash
# 识别一张图（data URL 太长，这里只示意结构）
curl -X POST http://127.0.0.1:3001/api/diet/analyze \
  -H "Content-Type: application/json" \
  -d '{"image":"data:image/jpeg;base64,....","meal_type":"lunch"}'

# 保存这一餐
curl -X POST http://127.0.0.1:3001/api/diet/records \
  -H "Content-Type: application/json" \
  -d '{"record_date":"2026-10-30","meal_type":"lunch","source":"ai_image","items":[{"food_name":"米饭","estimated_weight_g":150}]}'
```

## AI 智能问答（第五步）

一个「会看你数据」的教练，而不是通用 ChatGPT：每次提问都会把最近的身体/饮食/运动数据重新拼成一段文本注入 system prompt。

```bash
# 看看这次到底注入了什么（前端「注入的数据」抽屉就是显示它）
curl "http://127.0.0.1:3001/api/chat/context"

# 提问（非流式）
curl -X POST http://127.0.0.1:3001/api/chat/conversations/1/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"我今天还剩多少热量可以吃？"}'

# 流式（SSE）
curl -N -X POST http://127.0.0.1:3001/api/chat/conversations/1/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"晚餐怎么安排？","stream":true}'
```

上下文注入策略（`src/lib/healthContext.js`）：

- 只给「结论级」数据，不给原始 JSON：用户档案 + 最近体测（8 项围度、腰臀比）+ 近 14 天体重/腰围/体脂首末变化 + 今天的目标与摄入明细 + 近 3 天饮食 + 近 7 天运动汇总。省 token，模型也不会被冗余字段带偏。
- **今日额度写死一行**「今日还可摄入 X kcal（预算 = 目标 G + 运动 B − 已摄入 I）」。这一行不是装饰：第一版没有它，模型把「摄入 0、消耗 317」答成「还能吃 317」，漏了每日目标。
- 数据缺失显式写出来（「今天还没有饮食记录，所以已摄入记为 0，不是没吃东西」），避免模型把 0 当成事实。
- 每次提问现算，刚记完一餐再去问，回答里立刻有新数据。

SSE 协议：`data: {"type":"delta","content":"..."}` 逐字推送 → `data: {"type":"done","message":{...},"meta":{model,usage,context_chars}}`；出错时 `{"type":"error","message":"..."}`。用户消息**先落库再调模型**，模型挂了也不会丢掉已输入的问题。

模型名自动纠正：`.env` 里 `AI_MODEL` 和 `AI_BASE_URL` 不是同一家时（例如配了智谱的 base 却留着 `deepseek-chat`），`pickTextModel()` 会按 base 推断该家的文本模型（智谱 → `glm-4-flash`、通义 → `qwen-plus`…），否则必然 404。只配了视觉 Key 时会自动复用（响应里 `derived_from_vision: true`）。

## 数据导出

```bash
curl -o health.json "http://127.0.0.1:3001/api/export?format=json"
curl -o body.csv    "http://127.0.0.1:3001/api/export?format=csv&table=body"
```

CSV 输出带 `\uFEFF` BOM，Excel 打开中文不乱码；字段含逗号/引号/换行时按 RFC 4180 双引号转义。

## 关键设计

- **卡路里只信服务端**：`exercises` 接口从不读取前端传来的 `calories_burned`，一律按 `MET × 3.5 × 体重 / 200 × 时长` 重算。
- **体重快照**：`exercise_records.weight_kg` 存计算当时的体重，以后改体重不会篡改历史消耗。
- **同日覆盖 = PATCH**：`ON CONFLICT (user_id, record_date) DO UPDATE SET` 只更新本次提交的列，避免“只称了体重却把腰围清空”。
- **目标热量全局生效**：`users.daily_calorie_goal` 是唯一来源，「我的」页改完，`/api/dashboard` 的 `goal.calories` 立刻跟着变（`goal.source` 会告诉你是 `user` 还是 `suggested`）。
- **轻量迁移**：`schema.sql` 只能 `CREATE TABLE IF NOT EXISTS`，旧库新增列由 `src/db.js` 的 `migrate()` 用 `pragma_table_info` 判断后 `ALTER TABLE ADD COLUMN`。
- **幂等建表**：`schema.sql` 全是 `IF NOT EXISTS` + `INSERT OR IGNORE`，每次启动执行一遍即可，删库后重启自动恢复。
- **图片落盘而非入库**：原图存 `server/uploads/<日期>/`，库里只存 `/uploads/...` 路径；删除记录时同步删文件（路径做了目录白名单校验，防路径穿越）。
- **视觉 Prompt 用参照物估重**：手掌宽 8–9cm、筷子 25cm、饭碗口径 11–12cm 等，比单纯让模型「看一眼」准得多；并强制先想清烹饪方式再换算热量。
- **解析容错**：模型常把 JSON 包在 ```json 里、或把重量写成「约150g」，`parseVisionResponse` 会剥壳、抽数字、做区间 clamp，实在解析不了才报 502。
- **AI 只拿浓缩上下文**：`healthContext.js` 把数据库里的数据压成 800 字左右的自然语言（当天预算、近 14 天变化、近 3 天饮食），而不是丢原始 JSON 给模型——省 token，也避免它对着字段名瞎猜。
- **SSE 用 `res.on('close')` 判中断**：监听 `req.on('close')` 会在 `express.json()` 读完 body 后立刻触发，把每个请求都 abort 掉（表现为 47ms 内 `This operation was aborted`）。
