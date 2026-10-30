# 部署到云端（手机在外面也能用）

本机跑通了，但手机用流量就打不开——局域网 IP 在公网不可达。这份文档把「推到 GitHub → 部署到 Zeabur → 拿到一个免费网址 → 手机加桌面」走完。

代码这边已经替你改好了，不需要你再写代码：

| 改动 | 文件 | 作用 |
| --- | --- | --- |
| 同源托管前端 | `server/src/app.js` | 一个进程同时提供页面和接口，省掉 CORS / 双端口 |
| 口令登录 | `server/src/lib/auth.js`、`routes/auth.js`、`web/src/pages/Login.jsx` | 打开网页先输口令，7 天免登录；不设口令就没鉴权 |
| PWA | `web/public/manifest.webmanifest`、`sw.js`、图标 | 手机「添加到主屏幕」后全屏像原生 App |
| 备份/导入 | `scripts/backup-db.js`、`scripts/import-json.js`、`routes/admin.js` | 命令行 + 网页按钮两条路，换机器不丢数据 |
| 容器化 | `Dockerfile`、`.dockerignore` | 云平台直接按 Dockerfile 构建，不用配 Node 环境 |

---

## 0. 部署前先确认（本机）

```powershell
cd health-app\server
npm.cmd start
```

看到下面几行就算正常（`登录已开启` 说明口令生效）：

```
数据库: ...\health-app\server\data\health.db
登录口令: 已开启（打开网页需要输入口令）
前端:    已托管 ...\health-app\web\dist
```

浏览器打开 `http://127.0.0.1:3001/`，出现登录页，输口令能进 → 可以开始部署了。

> 口令在 `health-app/server/.env` 的 `APP_PASSWORD`，现在是 `xWNnnLGAYEPCv7EQ`（我随机生成的）。
> 想换成自己的，改这一行再重启后端即可；`SESSION_SECRET` 不用动。

---

## 1. 推到 GitHub

云平台是通过 GitHub 拉代码来构建的，所以先有个仓库。

### 1.1 只把 `health-app` 目录做成仓库（推荐）

这样仓库根目录就是 `Dockerfile` 所在目录，云平台零配置就能识别。

```powershell
cd health-app

git init
git add .
git commit -m "个人健康管理应用：饮食识别 / 运动 / 体成分 / AI 问答"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

第一次 `git push` 会弹浏览器让你登录 GitHub（或让你填 Personal Access Token）。

`.gitignore` 已经排除了这些东西，不会被推上去：

- `server/data/`（数据库）、`server/uploads/`（饭照片）、`server/backups/`
- 两个 `node_modules`、`dist`、`.tmp-*`
- **`server/.env`（里面有你的 API Key 和口令）** ← 这个最重要

> 如果 `git` 报「命令不存在」，装一个 Git for Windows：<https://git-scm.com/download/win>，然后重开终端。

### 1.2 不想用命令行？

在 GitHub 网页上 New repository → 创建后点「uploading an existing file」，把 `health-app` 目录里的文件拖进去（**不要**拖 `node_modules`、`data`、`uploads`、`.env`）。文件多、体验一般，能用但也容易漏。

---

## 2. 在 Zeabur 部署

Zeabur 支持 GitHub 登录、按 Dockerfile 构建、挂持久卷、送免费二级域名，符合你选的路子。

1. 打开 <https://zeabur.com> → **Sign in with GitHub**（首次会要求授权读仓库）。
2. 新建 Project（选一个区域，日本/新加坡对国内延迟较低）。
3. **Add Service → Git → 选你刚推的仓库**。
4. Zeabur 会自动检测到根目录有 `Dockerfile`，直接用它构建（不是 Node.js 预设，别手动改成 npm start）。

> 其他同类平台（Render、Railway、Fly.io）也能用同一个 `Dockerfile`，区别只是菜单位置。

### 2.1 环境变量（必填）

在服务的 **Environment Variables / 变量** 里加下面这些（**不要**把 `.env` 文件上传上去）：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `APP_PASSWORD` | `xWNnnLGAYEPCv7EQ` | 登录口令，务必设置 |
| `SESSION_SECRET` | `8a77cfa72951013045969befeceb745b26f56833b114362df62fd1c7795d52f8` | Cookie 签名密钥 |
| `NODE_ENV` | `production` | 关掉开发用 CORS，Cookie 走 Secure |
| `TZ` | `Asia/Shanghai` | 让「今天」按北京时间切日 |
| `AI_VISION_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 拍照识别（智谱） |
| `AI_VISION_MODEL` | `glm-4v-flash` | |
| `AI_VISION_API_KEY` | 你的智谱 Key | |
| `AI_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | AI 问答用同一家即可 |
| `AI_MODEL` | `glm-4-flash` | 不填会自动按 base 猜 |

`PORT` 一般由平台注入，不用自己设（服务端已经读 `process.env.PORT`）。

### 2.2 持久卷（关键，否则重新部署数据全丢）

容器的文件系统是临时的。给这三个目录挂上卷（Volume / 持久化存储）：

| 容器内路径 | 存什么 |
| --- | --- |
| `/app/server/data` | SQLite 数据库 `health.db` |
| `/app/server/uploads` | 饭的照片 |
| `/app/server/backups` | `npm run backup` 生成的快照 |

只挂 `data` 也能用，但照片会丢、备份没地方放。卷大小选最小档（1GB 足够，一张照片约 300KB）。

> 首次启动时 `schema.sql` 会自动建表并写入默认用户、58 条食物营养库、11 种运动类型，不用手动初始化。

### 2.3 生成网址

服务页 → **Networking / 网络 → Generate Domain**，会得到一个 `xxx.zeabur.app` 的免费 HTTPS 域名。
手机浏览器打开它 → 输口令 → 进应用 → 浏览器菜单「添加到主屏幕」，之后就像 App 一样全屏打开。

---

## 3. 把本机数据搬上去（可选）

云端是空库，两个办法：

**A. 网页导入（推荐，不用碰命令行）**

1. 本机打开 `http://127.0.0.1:3001/me` → 「数据导出」→ **导出全部数据（JSON）**，存到电脑。
2. 打开云端网址 → 我的 → 「数据导出」卡片底部 → **从备份导入（JSON）** → 选那个文件 → 确认。
3. 成功提示形如：`已导入：身体 14 条、运动 7 条、饮食 0 餐`。

规则：同一天的体测按日期覆盖；完全相同的运动和饮食记录会跳过，所以重复导入不会翻倍。
（图片不会跟着 JSON 走，历史饮食的缩略图会显示不出来，不影响数值。）

**B. 命令行**

```powershell
cd health-app\server
npm.cmd run db:import -- C:\path\to\health-data-2026-10-30.json
```

---

## 4. 日常维护

### 改代码后怎么更新

```powershell
cd health-app
git add .
git commit -m "改了什么"
git push
```

Zeabur 会自动重新构建部署（1-3 分钟）。数据库在卷里，**重新部署不会丢数据**。

### 备份

- 网页：我的 → 「数据导出」，或直接访问 `https://你的域名/api/admin/backup`（已登录状态下会下载一个 `.db` 快照）。
- 命令行（本机）：`cd health-app\server && npm.cmd run backup`，保留最近 14 份，在 `server/backups/`。
- 体检：`https://你的域名/api/admin/health-check` 返回 `integrity: ok` 和各表条数。

### 免费额度与休眠

Zeabur 免费档的实例可能在你不用时休眠，第一次打开会慢 10-30 秒（等它启动）。介意的话把它挂到「always on」或换付费档。

---

## 5. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 打开网址 502 / 一直转圈 | 构建失败。看平台 Build Logs；本地先验证 `docker build -t health-app .` 能过 |
| 页面白屏、控制台 404 `assets/...` | `web/dist` 没进镜像。确认 Dockerfile 里 `COPY --from=web-build /app/web/dist /app/web/dist` 那步成功 |
| 输口令一直提示「密码不对」 | 平台变量 `APP_PASSWORD` 有空格/换行；或后端没重启。变量改完要让服务重启一次 |
| 登录后立刻被踢回登录页 | 反代没传 `X-Forwarded-Proto`，Cookie 拿不到 Secure。服务端已 `trust proxy`，确认平台是 HTTPS 入口 |
| 拍照识别报 401 / 400 | 视觉 Key 或模型名不对。先在「我的 → AI 服务状态 → 检测连接」看视觉那行报什么 |
| 重新部署后数据没了 | 卷没挂到 `/app/server/data`，检查挂载路径 |
| 手机加桌面后仍是浏览器壳 | 用 HTTPS 域名访问（`manifest` + `sw.js` 只在安全上下文注册），且 `web/dist` 里要有 `manifest.webmanifest` |

---

## 6. 安全检查清单

- [ ] `APP_PASSWORD` 已设置且不是弱口令（当前是 20 位随机串）
- [ ] `server/.env` **没有**被推到 GitHub（`.gitignore` 已排除，推之前 `git status` 看一眼）
- [ ] 云端变量里 `NODE_ENV=production`
- [ ] 已挂持久卷 `/app/server/data`、`/app/server/uploads`
- [ ] 通过 `https://` 访问（平台的免费域名自带证书）
- [ ] 在「我的」页点过「检测连接」，视觉模型是绿的
