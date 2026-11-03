# 前端（React + Vite + Tailwind v4 + ECharts）

## 一次性准备

```bash
cd health-app/web
npm install
```

> Windows 用户注意：如果 `npm` 命令报「无法加载 npm.ps1，因为在此系统上禁止运行脚本」，请改用 `npm.cmd install`。

## 启动开发服务器

先启动后端（另开一个终端）：

```bash
cd health-app/server
npm run dev      # http://127.0.0.1:3001
```

再启动前端：

```bash
cd health-app/web
npm run dev      # http://127.0.0.1:5173
```

手机调试：让手机和电脑连同一个 Wi-Fi，用 `npm run dev -- --host` 启动，然后手机浏览器访问
`http://<电脑局域网 IP>:5173`。

## 目录结构

```
web/
├── index.html
├── vite.config.js          # 端口 5173，/api 与 /uploads 代理到 3001
└── src/
    ├── main.jsx            # 挂载 + 路由
    ├── App.jsx             # 布局（max-w-md）+ 路由表 + 底部导航
    ├── index.css           # Tailwind v4 入口
    ├── api/client.js       # 所有后端接口封装，统一错误处理
    ├── hooks/useFetch.js   # 极简请求 Hook（loading/error/reload）
    ├── lib/format.js       # 日期与数字格式化
    ├── lib/image.js        # 图片压缩（≤1280px / JPEG 0.85）转 base64
    ├── lib/cooking.js      # 烹饪方式 → 额外油/糖（必须与 server/src/lib/cooking.js 一致）
    ├── components/
    │   ├── EChart.jsx      # ECharts 按需注册 + 自适应包装
    │   ├── Card.jsx        # 卡片容器
    │   ├── Field.jsx       # 数字/文本输入框（支持高亮、提示标签）
    │   ├── Toast.jsx       # 底部轻提示（成功绿色 / 失败红色，自动消失）
    │   └── BottomNav.jsx   # 底部 6 Tab（概览 / 身体 / 饮食 / 运动 / AI / 我的）
    └── pages/
        ├── Dashboard.jsx   # 今日还可摄入、三大营养素环形图、体重趋势、今日运动
        ├── Diet.jsx        # 拍照识别 / 可编辑明细 / 今日饮食列表
        ├── BodyMetrics.jsx # 体重体脂 + 8 项围度录入 + 趋势折线
        ├── Exercise.jsx    # 运动类型/时长/距离 + 实时 METs 试算 + 今日列表
        ├── Chat.jsx        # AI 健康助手：流式对话 / 注入数据抽屉 / 历史会话
        └── Profile.jsx     # 我的：基础档案/BMR、目标热量、导出、AI 服务状态（只读）
```

## 页面说明

- **概览 `/`**：今日还可摄入（预算 = 目标 + 运动消耗）、三大营养素环形图、体重趋势、今日运动。
- **饮食 `/diet`**：拍照或从相册选图 → 后端视觉模型识别菜品、克重与烹饪方式 → 明细可改名/改克重（任何来源都即时重算热量与三大营养素，营养库命中的还会按做法补油）→ 保存进当天记录；还能展开「AI 的判断依据」看它怎么估的。卡片右上角「常见食物热量」是一个速查抽屉：可搜索 138 条营养库，点一行直接加入当前这一餐（默认 100g，可再改克重）。
- **身体 `/body`**：体重 / 体脂 / 8 项围度，同一天重复保存只覆盖本次填写的项；BMI 与腰臀比随输入实时变化。
- **运动 `/exercise`**：选类型 → 填时长（需要距离的类型会高亮距离框）→ 服务器按 METs 试算 → 保存弹 Toast。
- **AI `/chat`**：ChatGPT 式对话，逐字流式输出。每次提问后端都会把「今日预算 / 近 14 天体重围度 / 近 3 天饮食 / 近 7 天运动」重新拼进 prompt，所以它知道你今天还能吃多少。右上角「注入的数据」能把这段上下文原样展开看；「历史」里可以切换/删除会话。
- **我的 `/me`**：基础档案（昵称/性别/生日/身高 + 自动 BMR/TDEE）、目标与热量（覆盖概览页预算）、数据导出（JSON/CSV）、AI 服务状态（只读：模型/地址/Key 来源 + 一键测试连接，Key 全部写在 server/.env 里）。

## 构建产物

```bash
npm run build     # 输出到 dist/
npm run preview   # 本地预览构建结果
```

## 已知环境问题

- 本机构建时若报 `esbuild-xxxx: Access is denied`，是系统临时目录权限问题，把临时目录指到项目内即可：

  ```powershell
  $env:TEMP = "$PWD\.tmp"; $env:TMP = $env:TEMP; npm.cmd run build
  ```
