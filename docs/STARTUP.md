# FoxWords 项目启动小抄

## 当前技术栈

前端：

- React 19
- Vite 7
- react-router-dom 7
- axios

后端：

- Node.js
- Express 5
- better-sqlite3
- SQLite
- cors
- dotenv
- axios

AI story：

- 后端调用 Ollama
- 默认地址：`http://localhost:11434`
- 默认模型：`qwen3:4b`

## 当前目录结构简表

```text
FoxWords/
  package.json              # 根目录前端 scripts，也代理 server scripts
  vite.config.js            # Vite 配置
  .env                      # 前端生产 API 地址 VITE_API_BASE_URL
  src/
    App.jsx                 # 路由、顶部导航、登录保护
    HomePage.jsx
    PatternsPage.jsx        # Patterns 页面
    data/pattern_seed.json  # 静态句型库数据
    apiBase.js              # DEV 下 API_BASE = http://localhost:4000
  server/
    package.json            # 后端 scripts
    index.js                # Express API、Ollama story、demo login
    db.js                   # SQLite 初始化
    import_dictionary.js    # 导入 server/dictionary.json
    dictionary.json
```

## 根目录 scripts

以当前根目录 `package.json` 为准：

```bash
npm run dev          # vite
npm run server       # npm --prefix server run dev
npm run import:dict  # npm --prefix server run import:dict
npm run build        # vite build
npm run lint         # eslint .
npm run preview      # vite preview
```

## server 目录 scripts

以当前 `server/package.json` 为准：

```bash
npm run start        # node index.js
npm run dev          # node index.js
npm run import:dict  # node import_dictionary.js
npm run test         # 当前只是占位，会退出 1
```

## 第一次启动需要做什么

在项目根目录依次执行：

```bash
npm install
npm --prefix server install
npm run import:dict
npm run server
npm run dev
```

说明：

- 不需要手动 `cd server`，根目录已经提供了代理脚本。
- `npm run import:dict` 会把 `server/dictionary.json` 导入 SQLite。
- 导入脚本使用 `INSERT OR IGNORE`，重复执行通常不会重复插入。
- 全新数据库建议先导入字典，否则 Study / Search / Dictionary 相关功能可能没有词库数据。

## 每次开发启动流程

开两个终端：

终端 1，启动后端：

```bash
npm run server
```

终端 2，启动前端：

```bash
npm run dev
```

然后打开前端地址：

```text
http://localhost:5173
```

## 前端启动命令

```bash
npm run dev
```

## 后端启动命令

```bash
npm run server
```

根目录脚本实际执行的是：

```bash
npm --prefix server run dev
```

所以不需要手动 `cd server`。

## 字典导入命令

```bash
npm run import:dict
```

根目录脚本实际执行的是：

```bash
npm --prefix server run import:dict
```

所以也不需要手动 `cd server`。

## 默认端口

前端 Vite 默认：

```text
http://localhost:5173
```

后端 Express 默认：

```text
http://localhost:4000
```

前端开发环境中，`src/apiBase.js` 固定请求：

```text
http://localhost:4000
```

生产构建时前端使用根目录 `.env` 里的：

```text
VITE_API_BASE_URL=https://foxwords-api.onrender.com
```

## 后端环境变量

后端使用 `dotenv`，可以在 `server/.env` 中配置：

```text
PORT=4000
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b
STORY_LIMIT=10
```

含义：

- `PORT`：后端服务端口，默认 `4000`
- `OLLAMA_URL`：Ollama 服务地址，默认 `http://localhost:11434`
- `OLLAMA_MODEL`：Story 使用的模型，默认 `qwen3:4b`
- `STORY_LIMIT`：Story 从 notebook 取多少个最新单词，默认 `10`，代码中限制为 `1` 到 `30`

## demo 登录账号

```text
Email: test@example.com
Password: 123456
```

登录接口在后端 `/api/login`，成功后返回 demo token。

## Ollama / AI story 功能需要什么

不需要 Ollama 才能打开项目、登录、访问 Home / Books / Study / Notebook / Patterns / Settings。

只有 Story 生成功能需要 Ollama。后端 `/api/story` 会：

- 从 notebook 里取最新单词
- 请求 `OLLAMA_URL/api/generate`
- 使用 `OLLAMA_MODEL` 指定的模型

如果要使用 Story，通常需要：

```bash
ollama serve
ollama pull qwen3:4b
```

如果 Ollama 已经作为后台服务运行，不需要重复执行 `ollama serve`。

## Patterns 页面怎么访问

`/patterns` 已经加入：

- 顶部导航按钮：`Patterns`
- 受 `RequireAuth` 保护的 route：`/patterns`
- 首页入口卡片：`Patterns`

访问方式：

```text
http://localhost:5173/patterns
```

需要先登录。Patterns 是纯静态页面，数据来自：

```text
src/data/pattern_seed.json
```

不需要后端、不需要数据库、不需要 Ollama。

## 常见启动问题和解决方式

`npm run dev` 打开后登录失败：

通常是后端没启动。先跑：

```bash
npm run server
```

Study / 搜索没有词：

可能没导入字典。跑一次：

```bash
npm run import:dict
```

Story 生成失败：

通常是 Ollama 没启动、模型没下载、notebook 为空，或模型名不匹配。检查：

```bash
ollama serve
ollama pull qwen3:4b
```

如果 Ollama 已经在后台运行，只需要确认模型存在即可：

```bash
ollama pull qwen3:4b
```

PowerShell 提示 `npm.ps1` 被禁止运行：

这是 Windows execution policy 问题，可以改用：

```bash
cmd /c npm run dev
cmd /c npm run server
cmd /c npm run import:dict
```

端口冲突：

- 前端 Vite 会提示换端口。
- 后端默认 `4000`，如果被占用，可以在 `server/.env` 设置 `PORT`。

## 最短启动版

每天开发通常只需要两个终端：

```bash
npm run server
```

```bash
npm run dev
```

第一次或词库为空时，再跑一次：

```bash
npm run import:dict
```
