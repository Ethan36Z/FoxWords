# FoxWords 启动说明

本文档以当前仓库中的代码和部署文件为准。

## 当前架构

本地开发时，Vite frontend 请求 Express backend；生产部署时，浏览器只访问 frontend/Nginx，Nginx 将 `/api/` 代理到 backend。需要生成故事时，backend 通过 HTTPS 调用 Corvus API v1（`server/corvusClient.js`）。浏览器不接触 Corvus 地址和密钥。

```text
Browser
  → frontend / Nginx
  → Express backend
  → Corvus API v1（https://api-corvus.foxluma.com/v1）
```

项目主要组成：

- `src/`：React/Vite frontend
- `server/index.js`：Express API、demo login、story generation 和 settings API
- `server/db.js`：SQLite 初始化及数据库连接
- `server/dictionary.json`：词典数据（约 1 万词，含音标和部分例句），由 `server/build_dictionary.py` 生成
- `server/corvusClient.js`：所有 AI 功能共用的 Corvus API v1 客户端
- `compose.yaml`：Home Server 部署（frontend + backend；llama-server 仅作为可选 profile 保留）

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
cp dictionary.json .dict-src/previous.json
python3 -I -B build_dictionary.py .dict-src/ecdict/ecdict.csv .dict-src/tatoeba/cmn.txt dictionary.json \
  --previous .dict-src/previous.json --report dictionary.build.json
python3 -I -B dictionary_audit.py .dict-src/ecdict/ecdict.csv dictionary.json .dict-src/previous.json > .dict-src/audit.json
```

收录规则、人工修正（`dictionary_overrides.json`）和覆盖率统计口径见 [DICTIONARY.md](DICTIONARY.md)。`--previous` 让已有例句保持不变；没有 Tatoeba 文件时可以用 `-` 代替 `cmn.txt`，新词就暂时没有例句。`dictionary.build.json` 记录数据源哈希、各收录原因的词数以及新增/删除的词。规则测试：`npm --prefix server run test:dict`（Python）和 `npm --prefix server test`（Node）。

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
CORVUS_API_BASE_URL=https://api-corvus.foxluma.com/v1
CORVUS_API_KEY_FILE=/path/outside/repo/corvus_api_key
CORVUS_TIMEOUT_MS=100000
CORVUS_MAX_PER_MINUTE=4
STORY_LIMIT=10
```

密钥只放在 `CORVUS_API_KEY_FILE` 指向的文件里（只含密钥，权限 0600，不在仓库内），不要写进 `.env`。未配置时故事接口返回 503，其他功能不受影响。`STORY_LIMIT` 控制故事使用的最新 notebook 单词数，范围为 1 到 30。

### 哪些功能需要模型

Story 页面调用 `POST /api/story` 时，backend 请求：

```text
${CORVUS_API_BASE_URL}/chat/completions
```

需要 notebook 中至少有一个单词，并且已配置 Corvus。Corvus 同时只处理一个请求、全局每分钟最多 6 次；忙时返回 429（带 Retry-After），不可用或超时返回 503。backend 不会自动重试。

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

Corvus 密钥文件（示例路径，由运维准备，不在仓库内）：

```text
/home/ethan/srv/secrets/foxwords/corvus_api_key
```

Compose 把它作为 secret 只读挂载到 backend 的 `/run/secrets/corvus_api_key`。

### 网络与端口

只有 frontend 发布宿主机端口：

```text
127.0.0.1:8084 → frontend container port 80
```

frontend 同时连接 `foxwords_edge` 和 `foxwords_private`；backend 连接 `foxwords_private` 和用于访问 Corvus HTTPS 的 `foxwords_egress`。`foxwords_private` 是 internal network。backend 的 4000 不发布到宿主机。Nginx 的 `/api/` 反向代理目标是 `backend:4000`，生产 frontend 使用同源 `/api`。

### 环境文件和启动

不要把部署环境文件加入 Git。复制示例并填写 Corvus 配置：

```bash
cd /home/ethan/srv/apps/foxwords
cp .env.deploy.example .env.deploy
```

至少确认：

```text
CORVUS_API_BASE_URL=https://api-corvus.foxluma.com/v1
CORVUS_API_KEY_HOST_FILE=/home/ethan/srv/secrets/foxwords/corvus_api_key
```

不要在该文件中写入密钥本身。启动前先备份 `data/foxwords.db`。启动：

```bash
docker compose --env-file .env.deploy up -d --build
```

停止或查看状态：

```bash
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs -f frontend backend
```

只检查 Compose 配置（不启动服务）：

```bash
CORVUS_API_KEY_HOST_FILE=/dev/null docker compose --env-file .env.deploy.example config -q
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
- Story 失败：确认 notebook 非空、已配置 `CORVUS_API_BASE_URL` 和密钥文件；429 表示 Corvus 正忙，按提示稍后重试；backend 日志中的 `[corvus] ... status=` 行给出上游状态（不含密钥）。
- 本地端口冲突：通过 `PORT` 修改 backend 端口；Vite 会提示可用端口。
