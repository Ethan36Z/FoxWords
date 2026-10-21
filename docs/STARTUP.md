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
- `server/dictionary.json`：词典数据（约 1 万词，含音标和部分例句），由 `server/build_dictionary.py` 生成
- `compose.yaml`：Home Server 三服务部署

## 本地开发

首次准备：

```bash
npm install
npm --prefix server install
npm run import:dict
```

需要 Node.js 22 或更新版本。

`npm run import:dict` 将 `server/dictionary.json` 导入 SQLite，词典表会和文件完全一致（文件里没有的词会被删掉，生词本和学习记录不受影响）。backend 启动时如果发现 `dictionary.json` 有变化，也会自动导入，所以平时不需要手动运行。

### 重新生成词典

`server/dictionary.json` 来自两个开源数据集，原始文件不提交到 Git：

- [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）：单词、音标、中英释义、考试标签、词频
- [Tatoeba](https://tatoeba.org) 中英句对（CC-BY 2.0 FR，下载自 [manythings.org](https://www.manythings.org/anki/)）：例句及中文翻译

```bash
cd server
mkdir -p .dict-src/ecdict .dict-src/tatoeba
curl -L -o .dict-src/ecdict/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
curl -L -o .dict-src/tatoeba/cmn-eng.zip https://www.manythings.org/anki/cmn-eng.zip
unzip -o .dict-src/tatoeba/cmn-eng.zip -d .dict-src/tatoeba
python3 -I build_dictionary.py .dict-src/ecdict/ecdict.csv .dict-src/tatoeba/cmn.txt dictionary.json
```

脚本会收录带考试标签（中考、高考、四级、六级、考研、雅思、托福）的全部单词，去掉 went、apples 这类变形词，按难度和词频排序。每个词配一条 5–14 个词的例句，只用有简体中文翻译的句子。目前约 31% 的词有例句，其余可以以后用 AI 生成。

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
npm --prefix server test
```

`npm --prefix server test` 运行后端 API 测试，每次使用临时数据库，不会碰到真实数据。

### 本地运行时文件

如果没有设置环境变量，backend 使用：

- SQLite：`server/foxwords.db`（生词本、词典和用户设置都在这里）

这是运行时文件，不应提交到 Git。backend 支持通过 `DB_FILE` 指定其他路径。

旧版本把设置存在 `settings.json`。新版本第一次启动时会把这个文件里的设置导入数据库（路径可用 `SETTINGS_FILE` 指定），之后只使用数据库；旧文件会保留，确认无误后可以删除。

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

- SQLite：`/data/foxwords.db`（生词本、词典和用户设置）
- `/data/settings.json`：仅用于第一次启动时导入旧版设置

因此重建 container 不会丢失 notebook、dictionary 数据或用户 settings。`data/`、数据库文件、settings 文件、`.env.deploy` 和模型文件均已加入 Git 忽略规则。

## 常见问题

- 登录或 API 请求失败：确认 backend 已启动，并检查 `GET /api/health`。
- Study / 搜索没有词：运行 `npm run import:dict`。
- 单词发音没有声音：发音用的是浏览器自带的语音合成，请确认系统里装了英文语音（macOS：系统设置 → 辅助功能 → 朗读内容）。
- Story 失败：确认 notebook 非空、`LLAMA_SERVER_URL` 可访问、`LLAMA_MODEL` 与 llama-server 的 model alias 一致，并等待模型完成加载。
- 本地端口冲突：通过 `PORT` 修改 backend 端口；Vite 会提示可用端口。
