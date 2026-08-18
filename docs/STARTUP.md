# FoxWords 启动说明

本文档以当前仓库中的代码和部署文件为准。

## 当前架构

本地开发时，Vite frontend 请求 Express backend；生产部署时，浏览器只访问 frontend/Nginx，Nginx 将 `/api/` 代理到 backend。需要生成故事时，backend 再通过 OpenAI-compatible API 请求 `llama-server`，由 NVIDIA GPU 执行推理。

```text
Browser
  → frontend / Nginx
  → Express backend
  → llama-server
  → NVIDIA GPU
```

项目主要组成：

- `src/`：React/Vite frontend
- `server/index.js`：Express API、demo login、story generation 和 settings API
- `server/db.js`：SQLite 初始化及数据库连接
- `server/dictionary.json`：可导入 SQLite 的词典源数据
- `compose.yaml`：Home Server 三服务部署

## 本地开发

首次准备：

```bash
npm install
npm --prefix server install
npm run import:dict
```

`npm run import:dict` 将 `server/dictionary.json` 导入 SQLite；使用 `INSERT OR IGNORE`，重复执行不会重复插入已有词条。

启动两个终端：

```bash
# 终端 1：Express backend
npm run server

# 终端 2：Vite frontend
npm run dev
```

打开 `http://localhost:5173`。开发 frontend 默认请求 `http://localhost:4000`；Express 默认监听 4000，也可以通过 `PORT` 修改。

根目录 scripts：

```bash
npm run dev
npm run server
npm run import:dict
npm run build
npm run lint
npm run preview
```

server scripts：

```bash
npm --prefix server run start
npm --prefix server run dev
npm --prefix server run import:dict
```

### 本地运行时文件

如果没有设置环境变量，backend 使用：

- SQLite：`server/foxwords.db`
- settings：`server/settings.json`

这些是运行时文件，不应提交到 Git。backend 也支持通过 `DB_FILE` 和 `SETTINGS_FILE` 指定其他路径。

### backend 环境变量

可在 `server/.env` 中配置本地开发值：

```text
PORT=4000
LLAMA_SERVER_URL=http://localhost:8080
LLAMA_MODEL=foxwords
LLAMA_TIMEOUT_MS=120000
STORY_LIMIT=10
```

`LLAMA_SERVER_URL` 默认值是容器网络中的 `http://llama-server:8080`，因此本地直接运行 backend 时，如果本机另有 llama-server，应明确设置本地地址。`LLAMA_MODEL` 用于 OpenAI-compatible 请求中的 model 字段；`STORY_LIMIT` 控制故事使用的最新 notebook 单词数，范围为 1 到 30。

### 哪些功能需要模型

Story 页面调用 `POST /api/story` 时，backend 请求：

```text
${LLAMA_SERVER_URL}/v1/chat/completions
```

需要 notebook 中至少有一个单词，并且 llama-server 已启动且已加载模型。模型未启动、仍在加载、连接失败或超时，backend 会返回错误响应。

登录、Home、Books、Study、Notebook、Patterns、Settings 和字典搜索不需要实际生成请求；Study / Search 仍需要 SQLite 中已有词典数据。

Demo 登录账号：

```text
Email: test@example.com
Password: 123456
```

## Home Server Docker 部署

部署目录：

```text
/home/ethan/srv/apps/foxwords
```

模型目录：

```text
/home/ethan/srv/shared/models/
```

当前示例模型文件名为 `Qwen3-8B-Q4_K_M.gguf`。文件由部署者准备；本项目不会下载模型。Compose 将模型目录只读挂载到 llama-server 容器的 `/models`。

### 网络与端口

只有 frontend 发布宿主机端口：

```text
127.0.0.1:8084 → frontend container port 80
```

frontend 同时连接 `foxwords_edge` 和 `foxwords_private`；backend 和 llama-server 只连接 `foxwords_private`。`foxwords_private` 是 internal network。backend 的 4000 和 llama-server 的 8080 均不发布到宿主机。Nginx 的 `/api/` 反向代理目标是 `backend:4000`，生产 frontend 使用同源 `/api`。

### 环境文件和启动

不要把部署环境文件加入 Git。复制示例并填写实际 GGUF 文件名：

```bash
cd /home/ethan/srv/apps/foxwords
cp .env.deploy.example .env.deploy
```

至少确认：

```text
LLAMA_MODEL_FILE=Qwen3-8B-Q4_K_M.gguf
LLAMA_MODEL=foxwords
```

`LLAMA_IMAGE` 可用于固定 llama.cpp image/tag；GPU offload、context、并行数和 timeout 也可以通过示例中的环境变量调整。不要在该文件中写入 secrets。

模型准备好后启动：

```bash
docker compose --env-file .env.deploy up -d --build
```

停止或查看状态：

```bash
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs -f frontend backend llama-server
```

本阶段没有模型时，不要启动完整推理服务；只可先检查 Compose 配置：

```bash
LLAMA_MODEL_FILE=validation-placeholder.gguf \
  docker compose --env-file .env.deploy.example config
```

### Docker 持久化

Compose 将项目目录下的 `./data` 挂载到 backend 的 `/data`：

- SQLite：`/data/foxwords.db`
- settings：`/data/settings.json`

因此重建 container 不会丢失 notebook、dictionary 数据或用户 settings。`data/`、数据库文件、settings 文件、`.env.deploy` 和模型文件均已加入 Git 忽略规则。

## 常见问题

- 登录或 API 请求失败：确认 backend 已启动，并检查 `GET /api/health`。
- Study / 搜索没有词：运行 `npm run import:dict`。
- Story 失败：确认 notebook 非空、`LLAMA_SERVER_URL` 可访问、`LLAMA_MODEL` 与 llama-server 的 model alias 一致，并等待模型完成加载。
- 本地端口冲突：通过 `PORT` 修改 backend 端口；Vite 会提示可用端口。
