/* eslint-disable no-undef */
/* eslint-env node */

const path = require("path");
const fsp = require("fs/promises");
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const db = require("./db");

const app = express();

// ✅ env 配置
const PORT = Number(process.env.PORT || 4000);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
const STORY_LIMIT = Math.max(1, Math.min(Number(process.env.STORY_LIMIT || 10), 30));

app.use(cors());
app.use(express.json());

const SETTINGS_FILE = path.join(__dirname, "settings.json");

// -------------------- health --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// -------------------- notebook (SQLite) --------------------
// GET notebook (paginated)
// GET notebook (paged)  /api/notebook?limit=20&offset=0
app.get("/api/notebook", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    const total = db.prepare("SELECT COUNT(*) AS c FROM notebook").get().c;

    // ✅ 注意：这里把 translation 也带上（如果你表里没有 translation 列，先看下面第 1.5 步）
    const items = db
      .prepare(
        "SELECT id, word, translation, definition, createdAt FROM notebook ORDER BY id DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);

    res.json({ items, total, limit, offset });
  } catch (err) {
    console.error("DB GET /api/notebook error:", err);
    res.status(500).json({ error: "Failed to load notebook" });
  }
});

app.post("/api/notebook", (req, res) => {
  try {
    const { word, definition, translation } = req.body || {};
    if (!word || typeof word !== "string" || !word.trim()) {
      return res.status(400).json({ error: "word is required" });
    }

    const createdAt = new Date().toISOString();

    const info = db
      .prepare(
        "INSERT INTO notebook (word, translation, definition, createdAt) VALUES (?, ?, ?, ?)"
      )
      .run(
        word.trim(),
        String(translation || "").trim(),
        String(definition || "").trim(),
        createdAt
      );

    res.json({
      id: info.lastInsertRowid,
      word: word.trim(),
      translation: String(translation || "").trim(),
      definition: String(definition || "").trim(),
      createdAt,
    });
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      return res.status(409).json({ error: "word already exists" });
    }
    console.error("DB POST /api/notebook error:", err);
    res.status(500).json({ error: "Failed to save word" });
  }
});

// DELETE remove one word by id
app.delete("/api/notebook/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const info = db.prepare("DELETE FROM notebook WHERE id = ?").run(id);

    if (info.changes === 0) {
      return res.status(404).json({ error: "not found" });
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error("DB DELETE /api/notebook error:", err);
    res.status(500).json({ error: "Failed to delete word" });
  }
});

// -------------------- story (Latest N notebook -> Ollama) --------------------
app.post("/api/story", async (req, res) => {
  try {
    // ✅ 不依赖前端 words，直接取 notebook 最新 N 个
    const selected = db
    .prepare(
      `
      SELECT word, translation, definition
      FROM notebook
      ORDER BY id DESC
      LIMIT ?
      `
    )
    .all(STORY_LIMIT);

    if (!selected || selected.length === 0) {
      return res.status(400).json({ error: "notebook is empty" });
    }

    const vocabLines = selected
      .map((item, idx) => `${idx + 1}. ${item.word} - ${item.definition || ""}`)
      .join("\n");

    const prompt = `
You are an English tutor.
The student is learning the following vocabulary words:

${vocabLines}

Please write a short, simple story in English that naturally uses ALL of these words.
The story should be around 100-150 words.
Highlight these words in the story like: *apple*.
After the English story, also give a brief Chinese summary (1-2 sentences).
`;

    const ollamaResponse = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      },
      { timeout: 120000 }
    );

    const storyText = ollamaResponse.data?.response || "";
    if (!storyText.trim()) {
      return res.status(500).json({ error: "LLM returned empty story" });
    }

    res.json({ story: storyText });
  } catch (err) {
    console.error("Failed to create story with LLM:", err);
    res.status(500).json({ error: "failed to create story" });
  }
});

// -------------------- settings (JSON) --------------------
async function readSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, "utf-8");
    if (!raw.trim()) return { exampleFirst: true, dailyGoal: 20 };
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return { exampleFirst: true, dailyGoal: 20 };
    console.error("Failed to read settings:", err);
    throw err;
  }
}

async function writeSettings(settings) {
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

app.get("/api/settings", async (req, res) => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const incoming = req.body || {};
    const settings = {
      exampleFirst: typeof incoming.exampleFirst === "boolean" ? incoming.exampleFirst : true,
      dailyGoal: typeof incoming.dailyGoal === "number" ? incoming.dailyGoal : 20,
    };
    await writeSettings(settings);
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to save settings:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// -------------------- dictionary search (SQLite) --------------------
app.get("/api/dictionary", (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    if (!q) return res.json([]);

    const rows = db
      .prepare(
        `
        SELECT id, word, translation, definition, example
        FROM dictionary
        WHERE lower(word) LIKE ? OR lower(word) LIKE ?
        ORDER BY
          CASE WHEN lower(word) LIKE ? THEN 0 ELSE 1 END,
          length(word),
          word
        LIMIT ? OFFSET ?
      `
      )
      .all(`${q}%`, `%${q}%`, `${q}%`, limit, offset);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/dictionary error:", err);
    res.status(500).json({ error: "Failed to load dictionary" });
  }
});

// -------------------- login (demo) --------------------
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const demoEmail = "test@example.com";
  const demoPassword = "123456";

  if (email === demoEmail && password === demoPassword) {
    return res.json({ ok: true, email, token: "foxwords-demo-token-123" });
  }

  return res.status(401).json({ error: "Invalid email or password" });
});

// -------------------- words/today --------------------
let todayCache = { dayKey: "", limit: 0, rows: [] };
function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

app.get("/api/words/today", async (req, res) => {
  try {
    const hardMax = 50;

    let dailyGoal = 20;
    try {
      const s = await readSettings();
      if (typeof s.dailyGoal === "number" && s.dailyGoal > 0) dailyGoal = s.dailyGoal;
    } catch (err) {
      console.error("readSettings failed in /api/words/today:", err);
    }

    const qLimit = parseInt(String(req.query.limit || "0"), 10);
    const want = qLimit > 0 ? qLimit : dailyGoal;
    const limit = Math.min(hardMax, Math.max(1, want));

    // ✅ 新增：refresh=1 时强制换一批（跳过缓存）
    const refresh = String(req.query.refresh || "") === "1";

    const dayKey = getDayKey();

    // ✅ 只有在不 refresh 时才走缓存
    if (!refresh && todayCache.dayKey === dayKey && todayCache.limit === limit) {
      return res.json(todayCache.rows);
    }

    const rows = db
      .prepare(
        `
        SELECT id, word, translation, definition, example
        FROM dictionary
        ORDER BY RANDOM()
        LIMIT ?
      `
      )
      .all(limit);

    // ✅ 无论 refresh 与否，都更新缓存（这样下一次不 refresh 会复用最新这批）
    todayCache = { dayKey, limit, rows };

    res.json(rows);
  } catch (err) {
    console.error("GET /api/words/today error:", err);
    res.status(500).json({ error: "Failed to load today's words" });
  }
});

app.listen(PORT, () => {
  console.log(`FoxWords backend running on http://localhost:${PORT}`);
  console.log("SETTINGS_FILE:", SETTINGS_FILE);
  console.log("OLLAMA_URL:", OLLAMA_URL);
  console.log("OLLAMA_MODEL:", OLLAMA_MODEL);
  console.log("STORY_LIMIT:", STORY_LIMIT);
});