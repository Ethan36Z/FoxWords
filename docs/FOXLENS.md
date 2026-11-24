# FoxWords Lens sentences

[FoxWords Lens](https://github.com/Ethan36Z/foxwords-lens) is a desktop
companion that captures English sentences (selected text, screen OCR,
desktop audio, subtitles), and local Corvus explains them. FoxWords imports
its sentences; it never opens the Lens database or calls Corvus for this.

## Import

1. In Lens: **Library** → **Export** (a version-1 JSON array).
2. In FoxWords: **生词本** → **句子 · FoxLens** → **选择文件**.
3. Check the preview (new / already imported / not recognised), then click
   **导入**.

Entries are matched by Lens id and by sentence text, so importing the same or
a newer export again only adds new sentences. Deleting a sentence in FoxWords
does not touch Lens.

## What is shown

- **Sentence list:** source (屏幕截图, 字幕, 音频, 选中文字 …), capture date, the
  captured sentence, Lens's Chinese meaning, caution, and up to five
  expressions. Corvus's new examples are labelled "Corvus 新例句", separate
  from the captured wording.
- **句中的词:** the dictionary headwords in the sentence, with simple
  inflections mapped back (stairs → stair, studied → study; irregular forms
  such as made → make are not). Common function words are left out. One click
  adds a word to the notebook, which puts it into study and stories.
- **Study cards:** when a card's word appears in an imported sentence, the
  final answer shows up to two of them under "你见过的句子". This happens only
  on the final reveal, never in the quick recognition step.

## Adding words from Lens directly

Lens (branch `feature/foxwords-notebook` of foxwords-lens) has a
**加入生词本 FoxWords** button next to **Save sentence**. It asks FoxWords
which words of the sentence are in the dictionary (`POST /api/lens/lookup`),
lets you pick some, adds them to the notebook (`POST /api/notebook`), and
stores the sentence too (`POST /api/lens/import`, same id as a Lens export,
so a later export import skips it).

Lens only talks to a FoxWords on the same computer, over loopback HTTP:
`LENS_FOXWORDS_URL`, by default `http://127.0.0.1:8084` (the deployed
frontend, which forwards `/api`). The public site stays behind FoxGate.

## Storage and API

Table `lens_sentences` (`server/db.js`):
- `sentence`, `meaning`, `expressions` (JSON), `caution`;
- `sourceKind`, `sourceLabel`, `capturedAt`, `importedAt`;
- `payload`: the original export entry, kept unchanged.

The notebook, dictionary and learning progress tables are not changed by an
import.

| Route | Purpose |
| --- | --- |
| `POST /api/lens/preview` | body: the export array; counts, no writes |
| `POST /api/lens/import` | body: the export array; inserts new sentences |
| `GET /api/lens?q=&limit=&offset=` | list / search |
| `GET /api/lens/:id/words` | dictionary words in a sentence |
| `POST /api/lens/lookup` | body `{ sentence }`: dictionary words, for Lens |
| `DELETE /api/lens/:id` | remove one imported sentence |

Exports up to 10 MB and 5,000 entries are accepted; other versions are
reported as not recognised.
