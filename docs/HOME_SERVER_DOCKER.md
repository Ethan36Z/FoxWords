# Home Server Docker deployment

The production stack has two services: nginx frontend and Express backend. Only
nginx publishes a host port, on `127.0.0.1:8084`, which FoxGate serves as
`foxwords.foxluma.com` behind its login. Story generation calls the Corvus API
v1 over HTTPS from the backend (network `foxwords_egress`).

Before starting, put the FoxWords Corvus key in a private file outside the
repository (only the key, mode 0600) and create the deployment environment file:

```bash
cp .env.deploy.example .env.deploy
# Set CORVUS_API_BASE_URL and CORVUS_API_KEY_HOST_FILE.
docker compose --env-file .env.deploy up -d --build
```

The key file is mounted read-only as a Compose secret at
`/run/secrets/corvus_api_key` and re-read on every request, so replacing the file
rotates the key without a restart. Without a key, story generation returns 503
and the rest of FoxWords works.

`./data` is created by Docker on first start and holds `foxwords.db`, which
stores the notebook, dictionary and settings. An older `settings.json` there is
imported into the database once on first start. It is intentionally ignored by Git. Back it up before deploying a new
version: the first start of a new version may migrate it.

The old CUDA `llama-server` service is kept only as an opt-in profile
(`--profile local-llm`); the backend no longer uses it. Do not publish backend
or llama-server ports.
