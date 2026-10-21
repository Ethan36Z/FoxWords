# FoxWords 🦊

FoxWords is a small Chinese-English vocabulary learning web app. It combines a React/Vite frontend with an Express backend, SQLite persistence, and optional local story generation through llama.cpp's `llama-server`.

## Features

- Demo login and authenticated learning pages
- Notebook as a searchable word list with phonetics, pronunciation and expandable details
- About 10,000-word dictionary (中考 to 托福) with IPA phonetics and example sentences
- Word books by exam level (中考, 高考, 四级, 六级, 考研, 雅思, 托福); new study words come from the chosen book
- Daily word practice with 认识 / 不认识 / 太简单 answers; words you miss are tracked as unfamiliar and can be mixed back into later batches (纯新词 / 穿插 / 纯不熟悉词 in Settings); words marked 太简单 never come back
- Word and example pronunciation through the browser's built-in speech synthesis
- Settings in two drawers: Appearance (font size; day, night and eye-care themes; day/night can follow the system) and Study (daily goal up to 500, study mix, example-first)
- Static pattern practice content
- Optional story generation from recent notebook words

Story generation is the only feature that requires a running AI model. The backend sends an OpenAI-compatible request to `llama-server` and returns the generated English story and Chinese summary. Other pages can be used without making an AI generation request.

## Stack

- Frontend: React, Vite, React Router
- Backend: Node.js, Express, Axios, better-sqlite3
- Data: one SQLite database for the notebook, dictionary and settings
- Model service: llama.cpp `server-cuda` image with NVIDIA CUDA support

## Development

Requires Node.js 22 or newer. Install dependencies, import the bundled dictionary, and run the frontend and backend in separate terminals:

```bash
npm install
npm --prefix server install
npm run import:dict
npm run server
npm run dev
```

The Vite development server runs at `http://localhost:5173` and the Express backend at `http://localhost:4000`. In development, the frontend uses the backend URL directly; production uses same-origin `/api` by default.

Run the backend API tests (they use a temporary database, never your real data):

```bash
npm --prefix server test
```

The UI follows the system light/dark setting and works on phone-sized screens. Press `/` (or `Cmd/Ctrl+K`) anywhere to search the dictionary.

See [docs/STARTUP.md](docs/STARTUP.md) for local development details and the Home Server Docker deployment.

## Data sources

- Dictionary: [ECDICT](https://github.com/skywind3000/ECDICT) by skywind3000, MIT License.
- Example sentences: [Tatoeba](https://tatoeba.org), CC-BY 2.0 FR, via [manythings.org](https://www.manythings.org/anki/).
