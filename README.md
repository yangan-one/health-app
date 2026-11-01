# 个人健康管理 Web 应用

移动端优先的个人健康工具：拍张照片记饮食、按 METs 算运动消耗、追身体围度趋势，
再让 AI 结合你自己的数据给出建议。单用户本地版，数据只存在这一台机器的 SQLite 里。

## 功能

| 页面 | 路径 | 能做什么 |
| --- | --- | --- |
| 概览 | `/` | 今日还可摄入多少、摄入/消耗/运动分钟、三大营养素环形图、体重趋势、今日运动 |
| 身体 | `/body` | 体重、体脂率、8 项围度（颈肩胸臂腰臀腿小腿），BMI / 腰臀比实时算，7 个指标的趋势图 |
| 饮食 | `/diet` | 拍照或从相册选图 → 视觉模型识别菜品、克重、烹饪方式 → 可逐行改克重并即时重算 → 保存 |
| 运动 | `/exercise` | 11 种运动类型、按 METs 实时试算消耗、当日列表与合计 |
| AI | `/chat` | 类似 ChatGPT 的对话，每次提问自动注入你最近的身体/饮食/运动数据 |
| 我的 | `/me` | 基础档案（BMR/TDEE 自动算）、目标与热量预算、数据导出（JSON/CSV）、AI 服务状态 |

## 技术栈

- **前端**：React 19 + Vite 6 + Tailwind CSS v4 + ECharts 5 + React Router 7
- **后端**：Node.js 24 + Express 4
- **数据库**：SQLite（优先 better-sqlite3，没有则自动回退到 Node 内置 `node:sqlite`，无需编译）
- **AI**：任何 OpenAI 兼容接口（文本模型 + 视觉模型，分别配置）

## 快速开始

需要 Node.js ≥ 22.13（`node:sqlite` 从 22.5 起可用，本项目按 24 验证）。

**最省事：双击 `health-app/start.cmd`** —— 自动装依赖（首次）、开两个窗口分别跑后端和前端，并打开浏览器。

手动启动：

**0. 首次准备**

```bash
cd health-app/server && npm install
cd ../web && npm install
```

**1. 填 API Key**（只改这一个文件，见下节）

```bash
health-app/server/.env
```

**2. 启动后端**

```bash
cd health-app/server
npm start            # http://127.0.0.1:3001
```

**3. 启动前端**（另开一个终端）

```bash
cd health-app/web
npm run dev          # http://127.0.0.1:5173
```

浏览器打开 <http://127.0.0.1:5173>。

**用手机打开**：手机和电脑连同一个 Wi-Fi，然后在手机浏览器输入启动日志里 `Network:` 那一行的地址，形如 `http://192.168.43.116:5173`。Vite 已经监听 `0.0.0.0`，后端 3001 不用暴露（前端会转发 `/api`）。手机点「拍一张」会直接调起相机。

> Windows 上如果 `npm` 报「无法加载 npm.ps1，因为在此系统上禁止运行脚本」，把命令换成 `npm.cmd`。

**只跑一个端口（生产模式 / 部署）**：先 `cd health-app/web && npm run build`，再 `cd ../server && npm start`，然后直接开 <http://127.0.0.1:3001/>。后端会自动托管 `web/dist`，页面和接口同源，不需要再开 Vite。

**要出门也能用**：见 [`DEPLOY.md`](DEPLOY.md)（推 GitHub → Action 自动构建镜像 → ClawCloud Run 跑容器 → 免费 HTTPS 域名 + 手机添加到主屏幕）。

## 登录口令（部署到公网必读）

`server/.env` 里有三项控制登录：

```ini
APP_PASSWORD=xWNnnLGAYEPCv7EQ                  # 留空 = 关闭登录（只适合本机）
SESSION_SECRET=8a77cfa72951013045969befeceb745b26f56833b114362df62fd1c7795d52f8
NODE_ENV=development                            # 云端改 production
```

- 打开网页先输一次口令，之后 7 天免登录（签名 Cookie，不需要用户表）。
- 连着输错 8 次会锁 10 分钟，防止别人在公网上暴力试。
- 页面外壳（HTML/JS/图标）是公开的，**数据和照片都要先登录**：`/api/*`、`/uploads/*` 未登录一律 401。
- 改了 `APP_PASSWORD` 之后已登录的设备会全部掉线（`SESSION_SECRET` 不变也会掉，因为密钥默认从口令派生；想避免就单独设一个固定的 `SESSION_SECRET`）。


## 配置 AI（`health-app/server/.env`）

`.env` 里有两组配置，**改完必须重启后端**才生效：

```ini
# 文本模型：AI 问答用
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=
AI_MODEL=deepseek-chat

# 视觉模型：拍照识别用
AI_VISION_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_VISION_MODEL=glm-4v-flash
AI_VISION_API_KEY=
```

**注意：DeepSeek 官方 API 目前只有文本模型（`deepseek-chat`），没有视觉模型。**
所以拍照识别必须指向别的多模态服务，都是 OpenAI 兼容格式、改两行即可：

| 服务 | `AI_VISION_BASE_URL` | `AI_VISION_MODEL` | 备注 |
| --- | --- | --- | --- |
| 智谱（推荐） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash` | 有免费额度，中文菜识别准 |
| 通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | 识别细 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 需海外网络 |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5vl:7b` | 免费，Key 随便填；建议同时设 `AI_VISION_TIMEOUT=180000` |

- 只配一个 Key 也能用：文本模型会**自动复用**视觉 Key，并把模型名纠正成对应厂商的文本模型（智谱 → `glm-4-flash`）。状态在「我的 → AI 服务状态」里可见。
- 不想花钱：`.env` 里设 `VISION_FAKE=1`，拍任何照片都返回固定的演示结果（页面上会标注是演示数据）。
- 视觉接口的 `max_tokens` 智谱上限 1024，默认就是 1024；换成别的厂商想放宽可设 `AI_VISION_MAX_TOKENS`。

## 目录结构

```
health-app/
├── DEPLOY.md                  # 部署到云端（GitHub Actions + ClawCloud Run）的完整步骤
├── Dockerfile                 # 云平台按这个构建（内含前端 build）
├── start.cmd                  # 本机一键启动（后端 + 前端 + 打开浏览器）
├── server/                    # 后端
│   ├── .env                   # ← 你要填 API Key / 口令的地方（已被 git 忽略）
│   ├── db/schema.sql          # 建表 + 种子数据（幂等，每次启动自动执行）
│   ├── data/health.db         # SQLite 数据库文件
│   ├── uploads/               # 拍照识别上传的图片（按日期分目录）
│   ├── backups/               # npm run backup 生成的快照（保留 14 份）
│   ├── scripts/               # reset-db / seed-demo / smoke* / clean-uploads
│   │                          # · backup-db / import-json
│   └── src/
│       ├── server.js          # 启动入口（打印局域网地址、登录状态）
│       ├── app.js             # Express 应用：登录闸门 / 路由 / 同源托管 dist
│       ├── db.js              # 数据库连接 + 轻量迁移 + 当前用户
│       ├── lib/               # sqlite 适配 / METs 公式 / BMI·BMR / 视觉调用 /
│       │                      # 营养库匹配 / 烹饪油糖修正 / 健康上下文 / 提示词
│       │                      # / auth（签名 Cookie）/ dataTransfer（导入）
│       └── routes/            # profile · bodyMetrics · exercises · diet · dashboard
│                              # · settings · export · chat · auth · admin
└── web/                       # 前端
    ├── public/                # manifest.webmanifest · sw.js · icons/（PWA）
    └── src/
        ├── api/client.js      # 所有接口封装（含 SSE 流式对话）
        ├── components/        # EChart / Card / Field / Toast / BottomNav
        ├── lib/              # 格式化 / 图片压缩 / 烹饪油糖表（与服务端一致）
        └── pages/             # Login · Dashboard · BodyMetrics · Diet · Exercise
                               # · Chat · Profile
```

## 算法说明

**运动消耗**（ACSM 代谢当量）：

```
kcal/min = MET × 3.5 × 体重(kg) / 200
```

体重默认取最近一次体测，并把当时的体重**快照**写进记录 —— 以后体重变了，历史消耗不会被改写。

**拍照识别**：模型只负责「是什么菜 + 多重 + 怎么做的」，营养素尽量以本地营养库（58 条常见中餐，带别名）为准：

```
热量 = per_100g × 克重 + 烹饪额外油糖
```

烹饪方式会额外加油糖（每 100g 菜品）：水煮/蒸/白灼 0、凉拌 4g 油、清炒/炒/红烧 7g、
煎 10g、炸 14g、糖醋 7g 油 + 10g 糖。同样 150g 鸡胸：水煮约 200 kcal，煎完约 335 kcal。
菜名本身含做法（红烧肉、油条、炸鸡）时不重复加油。

**AI 问答**：每次提问重新拼一段约 800 字的结构化上下文（档案 / 最近体测 / 近 14 天变化 /
今天摄入与消耗 / 近 3 天饮食 / 近 7 天运动 / 缺失项），放在 system 里，所以回答能引用你的真实数字。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（版本、SQLite 驱动、今天） |
| GET/PUT | `/api/profile` | 用户基本信息、目标、BMR/TDEE |
| GET | `/api/body-metrics/fields` | 表单字段定义 |
| POST | `/api/body-metrics` | 录入身体数据（同日合并，未提交的字段保持原值） |
| GET | `/api/body-metrics/latest` `?from=&to=` `/trend?days=` | 最近一次 / 列表 / 趋势 |
| DELETE | `/api/body-metrics/:id` | 删除记录 |
| GET | `/api/exercise-types` | 运动类型字典（含 MET） |
| POST | `/api/exercises/calc` | 只试算，不落库 |
| POST | `/api/exercises` | 新增运动记录（卡路里由服务端算） |
| GET | `/api/exercises?date=` | 当日列表 + 合计 |
| DELETE | `/api/exercises/:id` | 删除运动记录 |
| POST | `/api/diet/analyze` | 传图片（base64 data URL）→ 识别，不入库 |
| POST | `/api/diet/records` | 保存一餐（营养素服务端重算） |
| GET | `/api/diet/records?date=` | 当日饮食 + 合计（按餐次） |
| DELETE | `/api/diet/records/:id` | 删除一餐（连带删图片） |
| GET | `/api/diet/foods?q=` | 营养库搜索（返回命中的菜名） |
| GET | `/api/diet/meal-types` | 餐次字典 + 当前建议餐次 |
| GET | `/api/dashboard?date=` | 首页聚合数据 |
| GET | `/api/chat/context` | 即将注入 AI 的上下文原文（前端可展开看） |
| GET/POST | `/api/chat/conversations` | 会话列表 / 新建 |
| PATCH/DELETE | `/api/chat/conversations/:id` | 改标题 / 删会话 |
| GET | `/api/chat/conversations/:id/messages` | 历史消息 |
| POST | `/api/chat/conversations/:id/messages` | 提问（`stream:true` 走 SSE） |
| GET/PUT | `/api/settings` `/api/settings/ai` | AI 配置（Key 永远脱敏返回） |
| POST | `/api/settings/ai/test` | 分别检测文本模型与视觉模型 |
| GET | `/api/export?format=json` | 全量导出 |
| GET | `/api/export?format=csv&table=body\|exercise\|diet` | 分表 CSV（带 BOM，Excel 直接开） |
| GET | `/api/export/summary` | 各表条数 |
| POST | `/api/admin/import` | 导入导出的 JSON（网页「从备份导入」用的是它） |
| GET | `/api/admin/backup` | 下载一个 `.db` 快照（VACUUM INTO） |
| GET | `/api/admin/health-check` | 数据库体检（integrity + 各表条数） |
| GET | `/api/auth/status` | 是否需要登录 / 当前是否已登录 |
| POST | `/api/auth/login` `/logout` | 登录（带限速）/ 退出 |

统一响应：成功 `{ ok: true, data }`，失败 `{ ok: false, message, details }`。

## 常用脚本

后端（`health-app/server`）：

```bash
npm run dev            # 开发（--watch 自动重启）
npm start              # 生产（改代码需手动重启）
npm run db:reset       # 删库重建 + 种子数据
npm run seed:demo      # 生成 14 天演示数据（可重复执行）
npm run smoke          # 19 项：基础接口
npm run smoke:diet     # 16 项：拍照识别 + 保存 + 看板联动
npm run smoke:chat     # 22 项：AI 问答 + SSE（-- --no-ai 跳过真实调用省 token）
npm run selftest:vision # 18 项：纯离线，识别结果解析与营养匹配
npm run uploads:clean  # 清理没人引用的上传图片（加 -- --delete 才真删）
npm run backup         # 备份数据库到 server/backups/（保留 14 份）
npm run db:import -- <文件.json> [--replace]   # 导入导出的 JSON
```

前端（`health-app/web`）：`npm run dev` / `npm run build` / `npm run preview`。

## 常见问题

- **改了 `.env` 没生效**：`npm start` 不带热重启，改完要 Ctrl+C 再启动。
- **端口被占用**：`Get-NetTCPConnection -LocalPort 3001 -State Listen` 找 PID 后 `Stop-Process -Id <pid> -Force`。
- **页面显示「无法连接后端服务」**：后端没起，或不在 3001。
- **识别报 401**：Key 不对（智谱的 Key 很长、中间含点号，别只复制一半）。
- **识别报 400「图片输入格式/解析错误」**：图片太小或格式不支持，拍正常的餐盘照即可。
- **识别报 `max_tokens参数非法`**：该厂商上限更低，设 `AI_VISION_MAX_TOKENS=1024`。
- **手机拍照上传失败**：前端会把图压到 1280px / JPEG 0.85，若原图 >25MB 会提示先裁剪。
