require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const db = require("./db");
const { importDictionaryIfChanged } = require("./import_dictionary");

const app = express();

// Environment config
const PORT = Number(process.env.PORT || 4000);
const LLAMA_SERVER_URL = (process.env.LLAMA_SERVER_URL || "http://llama-server:8080").replace(/\/$/, "");
const LLAMA_MODEL = process.env.LLAMA_MODEL || "foxwords";
const LLAMA_TIMEOUT_MS = Math.max(1000, Number(process.env.LLAMA_TIMEOUT_MS || 120000));
const STORY_LIMIT = Math.max(1, Math.min(Number(process.env.STORY_LIMIT || 10), 30));

app.use(cors());
app.use(express.json());

// -------------------- health --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// -------------------- notebook (SQLite) --------------------
// GET /api/notebook?limit=20&offset=0
app.get("/api/notebook", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    const total = db.prepare("SELECT COUNT(*) AS c FROM notebook").get().c;

    const items = db
      .prepare(
        `SELECT n.id, n.word, n.translation, n.definition, n.createdAt,
                COALESCE(d.phonetic, '') AS phonetic
         FROM notebook n LEFT JOIN dictionary d ON d.word = n.word
         ORDER BY n.id DESC LIMIT ? OFFSET ?`
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

// -------------------- story (Latest N notebook -> llama-server) --------------------
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

    const llamaResponse = await axios.post(
      `${LLAMA_SERVER_URL}/v1/chat/completions`,
      {
        model: LLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      },
      { timeout: LLAMA_TIMEOUT_MS }
    );

    const storyText = llamaResponse.data?.choices?.[0]?.message?.content || "";
    if (!storyText.trim()) {
      return res.status(500).json({ error: "LLM returned empty story" });
    }

    res.json({ story: storyText });
  } catch (err) {
    console.error("Failed to create story with LLM:", err);
    if (axios.isAxiosError(err)) {
      const upstreamStatus = err.response?.status;
      if (upstreamStatus === 400 || upstreamStatus === 404 || upstreamStatus === 503) {
        return res.status(503).json({ error: "LLM is unavailable or still loading" });
      }
      if (err.code === "ECONNABORTED" || !err.response) {
        return res.status(503).json({ error: "LLM service is unavailable" });
      }
    }
    res.status(500).json({ error: "failed to create story" });
  }
});

// -------------------- settings (SQLite) --------------------
const MAX_DAILY_GOAL = 500;
const STUDY_MIXES = ["new", "mixed", "review"];

// Word books are the exam vocabularies tagged in ECDICT. Lists overlap: a
// CET-4 word is usually also a 考研 word.
const BOOKS = [
  { id: "zk", title: "中考", desc: "初中阶段核心词汇" },
  { id: "gk", title: "高考", desc: "高中阶段核心词汇" },
  { id: "cet4", title: "大学英语四级", desc: "CET-4 考试词汇" },
  { id: "cet6", title: "大学英语六级", desc: "CET-6 考试词汇" },
  { id: "ky", title: "考研", desc: "研究生入学考试词汇" },
  { id: "ielts", title: "雅思", desc: "IELTS 考试词汇" },
  { id: "toefl", title: "托福", desc: "TOEFL 考试词汇" },
];
const BOOK_IDS = BOOKS.map((b) => b.id);
// SQL condition: the dictionary row d belongs to the book bound as ?
const IN_BOOK = "(? = '' OR (' ' || d.tags || ' ') LIKE '% ' || ? || ' %')";

function readSettings() {
  const row = db
    .prepare("SELECT exampleFirst, dailyGoal, studyMix, book FROM settings WHERE id = 1")
    .get();
  return {
    exampleFirst: Boolean(row.exampleFirst),
    dailyGoal: row.dailyGoal,
    studyMix: STUDY_MIXES.includes(row.studyMix) ? row.studyMix : "mixed",
    book: BOOK_IDS.includes(row.book) ? row.book : "",
  };
}

app.get("/api/settings", (req, res) => {
  try {
    res.json(readSettings());
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

app.put("/api/settings", (req, res) => {
  try {
    const incoming = req.body || {};
    const current = readSettings();
    const exampleFirst =
      typeof incoming.exampleFirst === "boolean" ? incoming.exampleFirst : current.exampleFirst;
    const goal = Number(incoming.dailyGoal);
    const dailyGoal = Number.isFinite(goal)
      ? Math.min(MAX_DAILY_GOAL, Math.max(1, Math.round(goal)))
      : current.dailyGoal;
    const studyMix = STUDY_MIXES.includes(incoming.studyMix) ? incoming.studyMix : current.studyMix;
    const book =
      incoming.book === "" || BOOK_IDS.includes(incoming.book) ? incoming.book : current.book;

    db.prepare(
      "UPDATE settings SET exampleFirst = ?, dailyGoal = ?, studyMix = ?, book = ? WHERE id = 1"
    ).run(exampleFirst ? 1 : 0, dailyGoal, studyMix, book);
    res.json({ ok: true, exampleFirst, dailyGoal, studyMix, book });
  } catch (err) {
    console.error("Failed to save settings:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// -------------------- dictionary search (SQLite) --------------------
const WORD_COLUMNS = "id, word, phonetic, translation, definition, example, exampleZh, level";

app.get("/api/dictionary", (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

    if (!q) return res.json([]);

    const rows = db
      .prepare(
        `
        SELECT ${WORD_COLUMNS}
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

// -------------------- study batches --------------------
// A word is "unfamiliar" while the learner has answered 不认识 more often
// than 认识. Answering 认识 enough times moves it out of the review pool.
const UNFAMILIAR = "s.unknownCount > s.knownCount AND s.tooEasy = 0";
// Share of review words in a "mixed" batch
const MIXED_REVIEW_SHARE = 0.3;

// New = never answered (and so never marked 太简单), from the chosen book
function pickNewWords(limit, book) {
  return db
    .prepare(
      `SELECT ${WORD_COLUMNS} FROM dictionary d
       WHERE NOT EXISTS (SELECT 1 FROM word_stats s WHERE s.word = d.word)
         AND ${IN_BOOK}
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(book, book, limit);
}

function pickReviewWords(limit) {
  // Most-missed words first, then the ones not seen for the longest time
  return db
    .prepare(
      `SELECT ${WORD_COLUMNS.split(", ").map((c) => "d." + c).join(", ")},
              s.unknownCount, s.knownCount
       FROM word_stats s JOIN dictionary d ON d.word = s.word
       WHERE ${UNFAMILIAR}
       ORDER BY (s.unknownCount - s.knownCount) DESC, s.lastSeenAt ASC, RANDOM()
       LIMIT ?`
    )
    .all(limit)
    .map((w) => ({ ...w, isReview: true }));
}

// Spread review words evenly through the batch instead of bunching them up
function interleave(newWords, reviewWords) {
  const total = newWords.length + reviewWords.length;
  // e.g. 3 review words in 10 slots go to positions 2, 5 and 9
  const reviewSlots = new Set(
    reviewWords.map((_, i) => Math.floor(((i + 1) * total) / reviewWords.length) - 1)
  );
  const out = [];
  let r = 0;
  let n = 0;
  for (let i = 0; i < total; i++) {
    out.push(reviewSlots.has(i) ? reviewWords[r++] : newWords[n++]);
  }
  return out;
}

// Review words come from every book: an unfamiliar word stays worth reviewing
function buildBatch(limit, mix, book) {
  if (mix === "new") return pickNewWords(limit, book);
  if (mix === "review") return pickReviewWords(limit);

  const review = pickReviewWords(Math.round(limit * MIXED_REVIEW_SHARE));
  const fresh = pickNewWords(limit - review.length, book);
  return interleave(fresh, review);
}

let todayCache = { key: "", rows: [] };
function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

app.get("/api/words/today", (req, res) => {
  try {
    const { dailyGoal, studyMix, book } = readSettings();

    const qLimit = parseInt(String(req.query.limit || "0"), 10);
    const want = qLimit > 0 ? qLimit : dailyGoal;
    const limit = Math.min(MAX_DAILY_GOAL, Math.max(1, want));

    // refresh=1 skips the cache and picks a new batch
    const refresh = String(req.query.refresh || "") === "1";
    const key = `${getDayKey()}|${limit}|${studyMix}|${book}`;

    if (!refresh && todayCache.key === key) {
      // Drop words marked 太简单 since the batch was built
      const easy = new Set(
        db.prepare("SELECT word FROM word_stats WHERE tooEasy = 1").all().map((r) => r.word)
      );
      todayCache.rows = todayCache.rows.filter((w) => !easy.has(w.word));
      return res.json(todayCache.rows);
    }

    const rows = buildBatch(limit, studyMix, book);
    // Always cache the latest batch so the next normal load reuses it
    todayCache = { key, rows };

    res.json(rows);
  } catch (err) {
    console.error("GET /api/words/today error:", err);
    res.status(500).json({ error: "Failed to load today's words" });
  }
});

// Record one answer on a study card:
// { word, result: "known" | "unknown" | "easy" }  ("easy" = 太简单, never show again)
app.post("/api/words/review", (req, res) => {
  try {
    const word = String(req.body?.word || "").trim();
    const result = req.body?.result;
    if (!word || !["known", "unknown", "easy"].includes(result)) {
      return res.status(400).json({ error: "word and result (known|unknown|easy) are required" });
    }

    // 太简单 only sets the flag; it doesn't count as a 认识 answer
    const known = result === "known" ? 1 : 0;
    const unknown = result === "unknown" ? 1 : 0;
    const easy = result === "easy" ? 1 : 0;
    db.prepare(
      `INSERT INTO word_stats (word, knownCount, unknownCount, lastResult, lastSeenAt, tooEasy)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET
         knownCount = knownCount + excluded.knownCount,
         unknownCount = unknownCount + excluded.unknownCount,
         lastResult = excluded.lastResult,
         lastSeenAt = excluded.lastSeenAt,
         tooEasy = MAX(tooEasy, excluded.tooEasy)`
    ).run(word, known, unknown, result, new Date().toISOString(), easy);

    const stats = db
      .prepare("SELECT word, knownCount, unknownCount, tooEasy FROM word_stats WHERE word = ?")
      .get(word);
    res.json({
      word: stats.word,
      knownCount: stats.knownCount,
      unknownCount: stats.unknownCount,
      tooEasy: Boolean(stats.tooEasy),
      unfamiliar: !stats.tooEasy && stats.unknownCount > stats.knownCount,
    });
  } catch (err) {
    console.error("POST /api/words/review error:", err);
    res.status(500).json({ error: "Failed to save review" });
  }
});

// Undo 太简单 for one word, e.g. from a future "easy words" list
app.delete("/api/words/easy/:word", (req, res) => {
  try {
    const info = db.prepare("UPDATE word_stats SET tooEasy = 0 WHERE word = ?").run(req.params.word);
    res.json({ ok: true, changed: info.changes });
  } catch (err) {
    console.error("DELETE /api/words/easy error:", err);
    res.status(500).json({ error: "Failed to update word" });
  }
});

// Word books with size and progress
app.get("/api/books", (req, res) => {
  try {
    const count = db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN s.word IS NOT NULL THEN 1 ELSE 0 END), 0) AS seen,
              COALESCE(SUM(CASE WHEN s.tooEasy = 1 THEN 1 ELSE 0 END), 0) AS tooEasy
       FROM dictionary d LEFT JOIN word_stats s ON s.word = d.word
       WHERE ${IN_BOOK}`
    );
    const { book } = readSettings();
    const books = [{ id: "", title: "全部单词", desc: "词典里的所有单词，难度随机" }, ...BOOKS].map(
      (b) => ({ ...b, ...count.get(b.id, b.id), selected: b.id === book })
    );
    res.json(books);
  } catch (err) {
    console.error("GET /api/books error:", err);
    res.status(500).json({ error: "Failed to load books" });
  }
});

// Totals for the home page
app.get("/api/words/stats", (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS seen,
                COALESCE(SUM(CASE WHEN ${UNFAMILIAR} THEN 1 ELSE 0 END), 0) AS unfamiliar,
                COALESCE(SUM(s.tooEasy), 0) AS tooEasy
         FROM word_stats s`
      )
      .get();
    const total = db.prepare("SELECT COUNT(*) AS c FROM dictionary").get().c;
    res.json({ ...row, dictionary: total });
  } catch (err) {
    console.error("GET /api/words/stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

if (require.main === module) {
  const imported = importDictionaryIfChanged();
  if (imported !== null) console.log("dictionary.json changed, imported words:", imported);

  app.listen(PORT, () => {
    console.log(`FoxWords backend running on port ${PORT}`);
    console.log("LLAMA_SERVER_URL:", LLAMA_SERVER_URL);
    console.log("LLAMA_MODEL:", LLAMA_MODEL);
    console.log("STORY_LIMIT:", STORY_LIMIT);
  });
}

module.exports = app;
