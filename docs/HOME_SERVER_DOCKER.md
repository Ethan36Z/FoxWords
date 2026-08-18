# Home Server Docker deployment

The production stack has three services: nginx frontend, Express backend, and
CUDA `llama-server`. Only nginx publishes a host port, on `127.0.0.1:8084`.

Before starting, provide a GGUF file in `/home/ethan/srv/shared/models` and
create the deployment environment file:

```bash
cp .env.deploy.example .env.deploy
# Set LLAMA_MODEL_FILE to the GGUF filename (not an absolute path).
docker compose --env-file .env.deploy up -d --build
```

`./data` is created by Docker on first start and holds `foxwords.db` and
`settings.json`. It is intentionally ignored by Git. The model directory is
mounted read-only and this repository never downloads models.

For a fixed llama.cpp version, set `LLAMA_IMAGE` to the desired image and tag
in `.env.deploy`. Do not publish backend or llama-server ports.
