# FoxWords 🦊

FoxWords is a small Chinese-English vocabulary learning web app. It combines a React/Vite frontend with an Express backend, SQLite persistence, and optional local story generation through llama.cpp's `llama-server`.

## Features

- Demo login and authenticated learning pages
- Notebook for saving words, translations, definitions, and timestamps
- SQLite-backed dictionary search and daily word practice
- User settings for study preferences and daily goal
- Static pattern practice content
- Optional story generation from recent notebook words

Story generation is the only feature that requires a running AI model. The backend sends an OpenAI-compatible request to `llama-server` and returns the generated English story and Chinese summary. Other pages can be used without making an AI generation request.

## Stack

- Frontend: React, Vite, React Router
- Backend: Node.js, Express, Axios, better-sqlite3
- Data: SQLite database plus a JSON settings file
- Model service: llama.cpp `server-cuda` image with NVIDIA CUDA support

## Development

Install dependencies, import the bundled dictionary, and run the frontend and backend in separate terminals:

```bash
npm install
npm --prefix server install
npm run import:dict
npm run server
npm run dev
```

The Vite development server runs at `http://localhost:5173` and the Express backend at `http://localhost:4000`. In development, the frontend uses the backend URL directly; production uses same-origin `/api` by default.

See [docs/STARTUP.md](docs/STARTUP.md) for local development details and the Home Server Docker deployment.
