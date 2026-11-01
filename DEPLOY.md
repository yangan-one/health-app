# 部署到云端（手机用流量也能打开）

本机能跑，但手机在外面连不上——局域网 IP 在公网不可达。这份文档把「GitHub 自动构建镜像 → ClawCloud Run 跑容器 → 拿到免费 HTTPS 网址 → 手机添加到主屏幕」走完。

> Zeabur 已停止运营，所以换成了 ClawCloud Run（新加坡，对注册 180 天以上的 GitHub 账号每月送 $5 额度，不用绑卡）。

## 0. 为什么是这个组合

ClawCloud Run 只能部署**镜像**，不能直接读取 GitHub 仓库来构建。所以链路是两段：

```
GitHub 仓库 --(push 触发 Action)--> ghcr.io 镜像 --> ClawCloud 拉取运行
```

对应两个文件：

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/docker-publish.yml` | 推 main 后自动构建镜像并推到 GitHub Container Registry |
| `Dockerfile` | 两阶段构建：先 `npm ci && npm run build` 出 `web/dist`，再装后端依赖，单进程同时提供页面和接口 |

## 1. 环境变量（部署时要填的一整张表）

先抄好，第 4 步一次性粘贴进去。

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 关掉 CORS、开启同源托管与 `Secure` Cookie |
| `PORT` | `3001` | 容器端口，必须和 Network 里填的一致 |
| `TZ` | `Asia/Shanghai` | 否则「今天」会按 UTC 算，跨零点记录会错位 |
| `OWNER_USERNAME` | `me` | 主账号用户名（历史数据都挂在它下面） |
| `OWNER_PASSWORD` | 自己定，**≥12 位** | 主账号密码；云端首次启动时自动写入数据库 |
| `REGISTER_CODE` | 自己定一串 | 别人注册时要填的邀请码；**留空 = 任何人都能注册** |
| `SESSION_SECRET` | 64 位随机十六进制 | Cookie 签名密钥，换掉可强制所有设备重新登录 |
| `DB_PATH` | `/app/server/data/health.db` | 放在持久卷里 |
| `UPLOAD_DIR` | `/app/server/data/uploads` | 饭的照片也进同一个卷 |
| `BACKUP_DIR` | `/app/server/data/backups` | `npm run backup` 的落点 |
| `DEFAULT_USER_ID` | `1` | 历史数据的归属 id（主账号） |
| `AI_VISION_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 智谱（也可换通义/OpenAI） |
| `AI_VISION_MODEL` | `glm-4v-flash` | 拍照识别用的视觉模型 |
| `AI_VISION_API_KEY` | 你的智谱 Key | 与本地 `.env` 里那个相同 |
| `AI_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 文本模型（AI 问答） |
| `AI_MODEL` | `glm-4-flash` | 文本模型名；也可不填，后端会按 base 自动挑 |
| `AI_VISION_MAX_TOKENS` | `1024` | 可选。智谱上限 1024，用 gpt-4o-mini 时可调大 |

> 生成长口令（本地 PowerShell 跑一行）：
> `-join ((48..57)+(97..122)+(65..90) | Get-Random -Count 20 | % {[char]$_})`
> 生成 `SESSION_SECRET`：`-join ((1..64) | % { '{0:x}' -f (Get-Random -Max 16) })`

## 2. 让 GitHub 构建镜像

仓库里已经有 workflow 了，推一次 main 就会自动跑：

1. 打开 `https://github.com/yangan-one/health-app/actions`
2. 看到 `build-and-push` 在跑（约 3-5 分钟）
3. 绿色勾之后，镜像已经在 `ghcr.io/yangan-one/health-app:latest`

如果 Actions 没动静：`Actions` 页点 `I understand my workflows, go ahead`（首次需要授权一次），或到 `workflow_dispatch` 手动 Run workflow。

## 3. 把镜像设为公开（否则 ClawCloud 拉不下来）

1. `https://github.com/users/yangan-one/packages/container/health-app/settings`
2. 最下面 `Danger Zone` → `Change visibility` → `Public` → 输入包名确认

或者不公开，改用私有仓库凭据：ClawCloud 的 Image 支持 `registry 用户名 + token`，但公开更省事。

## 4. 在 ClawCloud Run 建应用

1. 打开 <https://console.run.claw.cloud/signin>，用 **GitHub 登录**（账号需满 180 天才有每月 $5；不够则只有首月 $5）
2. 选区域：日本 / 新加坡（离你近，延迟低）
3. 左侧 `App Launchpad` → `Create App`，按下表填：

| 字段 | 填什么 |
| --- | --- |
| Application Name | `health-app` |
| Image | `ghcr.io/yangan-one/health-app:latest` |
| Usage → CPU | `0.2`（够用；想快点给 0.5） |
| Usage → Memory | `512M` |
| Network → Container Port | `3001` |
| Network → Enable Internet Access | **勾上**（不勾就没有公网地址） |
| Local Storage → Add → Mount Path | `/app/server/data` |
| Environment Variables | 把第 1 步那张表整段粘进去 |

点 `Deploy Application`，等 `Pod List` 的 `STATUS` 变成 `Active`（首次拉镜像 1-2 分钟）。

> 只有**一个**持久卷就够了：数据库、照片、备份都放 `/app/server/data` 下面。
> 如果界面只允许填挂载路径而不让填容量，填 1GB 即可，SQLite 加照片一年也用不到 200MB。

## 5. 打开网址、验收入口

1. 在 `Network` 那一栏点 `Public Address`，形如 `https://xxxxxx.ap-northeast-1.clawcloudrun.com`
2. 应该看到登录页「我的健康档案」→ 用 `OWNER_USERNAME` / `OWNER_PASSWORD` 登录（新用户点「注册」，填 `REGISTER_CODE`）
3. 进来后确认三件事：
   - 概览页「今日还可摄入」有数字（说明数据库写通了）
   - `我的 → AI 服务状态` 显示「已配置」、视觉模型 `glm-4v-flash`
   - `饮食 → 拍一张` 能出结果（真机拍一张试；第一次会慢 3-6 秒）

命令行快速自检（任选）：

```powershell
Invoke-WebRequest https://你的域名/api/health -UseBasicParsing | Select-Object -Expand Content
# 期望：{"ok":true,...,"version":"0.6.0","auth_enabled":true,"web_dist":true,...}
```

`auth_enabled: true` 且 `auth_mode: "multi-user"` 说明账号系统已生效；未登录时 `/api/dashboard` 应返回 401。

## 6. 把本地数据搬上去

云端是一套全新的空数据库，本地那 14 条体测 + 7 条运动要手动搬一次：

1. 本机后端启动后，浏览器打开 `http://127.0.0.1:3001/` → 登录 → `我的`
2. `数据导出` 卡点「导出全部数据（JSON）」，得到一个 `health-data-YYYY-MM-DD.json`
3. 云端网页同一位置 → `从备份导入（JSON）` → 选这个文件 → 确认
4. 回概览页，体重/运动记录应该都回来了（重复条目会自动跳过）

## 7. 手机安装成 App（PWA）

- **iPhone / Safari**：打开网址 → 底部「分享」→「添加到主屏幕」
- **Android / Chrome**：右上角菜单 →「添加到主屏幕」/「安装应用」

装好后是全屏无地址栏，图标是绿底心率线。拍照按钮会直接调起相机。

## 8. 钱和限制（免费层）

| 项 | 免费层 |
| --- | --- |
| 额度 | 每月 $5（GitHub 账号满 180 天才有，不用绑卡） |
| 流量 | 每月 10GB 免费，超出 $0.05/GB，从额度里扣 |
| 容器数 | 4 个（我们只用 1 个） |
| 资源上限 | 4 核 / 8GB 内存 / 10GB 磁盘 |

按 `0.2 核 + 512M` 跑，一天大约 $0.01-0.03，一个月不到 $1 —— $5 额度绰绰有余，剩下的流量费也在这 $5 里扣。

**但要知道代价**：额度用完或长期没人访问，容器会被停（`STATUS` 变 `Stopped`），网页就打不开，去控制台点 `Start` 即可；数据在持久卷里，重启不会丢。

## 9. 之后怎么更新版本

```powershell
cd health-app
git add -A
git commit -m "改了什么"
git push
```

push 后 Action 自动重建镜像（tag 仍是 `:latest`）。回到 ClawCloud：`App Launchpad` → 应用 → `Restart`（部分版本是 `Redeploy`），几十秒后新版本生效。

数据库结构变更无需手动迁移：`server/src/db.js` 里有 `migrate()`，启动时按 `pragma_table_info` 补齐缺失列。

## 10. 备份（强烈建议）

容器虽然带持久卷，但平台侧出问题就只能靠备份。两条路：

- **随手备份**：`我的 → 导出全部数据（JSON）`，存到网盘/微信文件传输
- **命令行备份**（本机或容器内）：

```powershell
cd health-app\server
npm.cmd run backup          # 生成 backups/health-YYYYMMDDHHmmss.db，保留最近 14 份
npm.cmd run db:import -- ..\health-data-2026-10-31.json
```

## 11. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 打开是 502 / 一直转圈 | 容器没起来。看 `Logs`；常见是 `Image` 私有导致拉取失败，或端口填的跟 `PORT` 不一致 |
| 页面能开但提示「无法连接后端」 | 前端被 SPA fallback 正常返回了，接口 401/500。多半是 Cookie 过期，重新登录即可 |
| `/api/health` 里 `web_dist:false` | 镜像里没有 `web/dist`，说明 Dockerfile 第二阶段没复制成功——重新构建 |
| 拍照识别报「还没有配置视觉模型的 API Key」 | 环境变量 `AI_VISION_API_KEY` 没存进去，改完必须 `Restart` |
| 拍照识别报「模型名不存在 / 404」 | `AI_VISION_MODEL` 和 `AI_VISION_BASE_URL` 不是同一家的模型 |
| 记录都在，但照片全 404 | 持久卷没挂到 `/app/server/data`，或没设 `UPLOAD_DIR` |
| 时间差 8 小时 / 记录跑到前一天 | 少了 `TZ=Asia/Shanghai` |
| 容器过一会就 `Stopped` | 免费额度用完或长时间无流量，控制台点 `Start` |

## 12. 安全清单（公网必看）

- `OWNER_PASSWORD` 必须是长口令，**不要**用本地那个 `1234`；`REGISTER_CODE` 一定要设，否则谁都能注册
- `SESSION_SECRET` 用随机 64 位，不要留默认
- 不要把自己 `.env` 推到 GitHub（`.gitignore` 已挡住；上传数据库这种事只用页面里的导入功能）
- 泄露过 Key 就去控制台重置：智谱 Key 在智谱后台、GitHub PAT 在 GitHub 后台
