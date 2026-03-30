

# FoxWords 🦊

FoxWords is a small vocabulary(CHinese-English) notebook web app I built as my first full-stack project.  
It has a React frontend and a Node.js + Express backend.  
Words are saved to local JSON files, and a local LLM (Ollama) can generate short stories using selected words in the notbook.

> This project is a learning project. The code is simple on purpose, so I can understand every part from front to back.

---

## Features

- **Login page**
  - Demo login with fixed email / password:
    - Email: `test@example.com`
    - Password: `123456`
  - On success, the backend returns a fake token and the frontend stores it in `localStorage`.

- **Notebook (new words list)**
  - Fetch all saved words from the backend: `GET /api/notebook`
  - Add a new word with translation / definition: `POST /api/notebook`
  - Backend stores words in a local file: `notebook.json`
  - Each word is saved with a `createdAt` timestamp.

- **Story generator (LLM)**
  - Choose some words from the notebook and send them to the backend.
  - Backend reads `notebook.json`, send all words(current version), builds a prompt, and calls a local LLM with **Ollama**.
  - Currently using model: `qwen3:4b` 
  - Returns an English story (with words highlighted) + a short Chinese summary.

- **Settings page**
  - User settings:
    - `exampleFirst` (boolean)
    - `dailyGoal` (number)
  - Frontend: `GET /api/settings` to load, `PUT /api/settings` to save.
  - Backend stores settings in `settings.json` (using async `fs/promises` API).

- **Dictionary**
  - Frontend can load a small demo dictionary from `dictionary.json` through `GET /api/dictionary`.

- **Health check**
  - Simple endpoint: `GET /api/health`  
  - Returns `{ status: "ok", time: "<ISO string>" }`, used to check if the backend is running.

---

## Tech Stack

**Frontend**

- React
- JavaScript
- Fetch API for HTTP requests

**Backend**

- Node.js
- Express
- CORS middleware
- `fs` and `fs/promises` for local JSON file storage
- `axios` to call Ollama (local LLM)

**LLM**

- [Ollama](https://ollama.com/) running locally
- Model: `qwen3:4b`
---

## Project Structure

FOXWORDS/
  src/                 # React frontend (Vite)
    main.jsx           # Entry: renders App into #root
    App.jsx            # Simple view router + shared layout
    LoginPage.jsx      # Login UI + calls backend
    WordPracticePage.jsx
    StoryReviewPage.jsx
    SettingsPage.jsx
    App.css
    index.css
  server/              # Express backend
    index.js           # API routes
    dictionary.json    # Demo dictionary data
    notebook.json      # Saved words (simple JSON storage)
    settings.json      # User settings (simple JSON storage)
