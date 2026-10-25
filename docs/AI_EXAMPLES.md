# AI example sentences

Example sentences for words that have no human (Tatoeba) example are written
by Corvus API v1. They are generated offline, checked automatically, reviewed
by a person, and only then served. Flashcards never wait for AI: the app reads
reviewed examples from its database.

## Flow

```text
dictionary.json ──plan──▶ job (frozen word list)
                          │ run: Corvus API v1, batches, resumable log
                          ▼
                     candidates ──review.tsv──▶ human decision
                                                  │ accept / edit / reject
                                                  ▼
                                    server/ai_examples.json (committed)
                                                  │ loaded on start
                                                  ▼
                                    ai_examples table ──▶ API field aiExample
```

Commands (inside `server/`; `npm run ai:examples -- <command>` also works):

```bash
node aiExamples/cli.js plan   --job pilot-zk                 # 中考 words without examples
node aiExamples/cli.js plan   --job eval-b4 --eval           # the 39-word evaluation set
node aiExamples/cli.js run    --job pilot-zk --batch 4 --confirm-real-calls [--max-requests 5]
node aiExamples/cli.js status --job pilot-zk
node aiExamples/cli.js review --job pilot-zk                 # writes .ai-work/jobs/pilot-zk/review.tsv
node aiExamples/cli.js accept --job pilot-zk --reviewer NAME [--replace]
```

`run` needs `CORVUS_API_BASE_URL` and `CORVUS_API_KEY_FILE`, and only sends
requests with `--confirm-real-calls`.

## Which words

A word is generated only if all of these hold:

- it has no human example;
- it has a core meaning backed by evidence (one part of speech, WordNet or
  Tatoeba, or a reviewed override);
- it is not labelled vulgar or offensive.

Words whose core meaning is only ECDICT's order are held back for meaning
review: an example would cement a meaning nobody has checked.

| Set | Eligible | Held back |
| --- | --- | --- |
| 中考 without examples (pilot) | 122 | 25 |
| Whole dictionary | 7,696 | 1,569 |

## Generation

Each request asks for one JSON object with one item per word:

- a 6–14 word sentence using the word in its core meaning;
- a Simplified Chinese translation;
- `meaning_ok`: the model's own check that the meaning is a common one.

Batches are at most 8 words, so the answer stays under Corvus' 1024-token
limit.

The job log (`.ai-work/jobs/<job>/log.jsonl`, not committed) records every
request, answer and item, and is written to disk after each line. Every run
recomputes the state from the log, so:

- a stopped or crashed run resumes where it left off;
- words already done are never asked again;
- retries go one word at a time, fewest attempts first;
- a lock file stops two runs of the same job;
- a plan cannot be changed after the job is created.

Corvus limits are respected:

- at most 4 requests a minute (the client caps at 6);
- one request at a time;
- a 429 waits for `Retry-After` and costs no attempt;
- three "unavailable" errors in a row pause the run;
- nothing is retried automatically inside a request;
- each word gets at most 3 attempts.

## Automatic checks

| Result | Meaning | Examples |
| --- | --- | --- |
| `invalid` | Hard failure; the word is retried alone | not JSON or cut off, wrong word, no Chinese, too short or long, several sentences, unsafe word, duplicate sentence |
| `needs_review` | Usable, but a person must look closely | core meaning not visible in the translation, model doubts the meaning, Traditional characters, word form not found (irregular verb?) |
| `candidate` | All checks passed | still reviewed |

## Review

`review.tsv` has one row per generated example. Fill in `decision`:

- `accept`
- `edit`: put corrections in `sentence_fix` / `translation_fix`
- `reject`
- empty: decide later

`accept`:

- checks edited text again;
- refuses an example if the word's core meaning changed since generation;
- replaces an accepted example only with `--replace`.

Every entry in `ai_examples.json` records: word, sentence, translation,
meaning, model, prompt version, job, generation time, reviewer, review time,
and whether it was edited.

Review checklist for each item:

1. **Meaning** — does the sentence use the word in the shown core meaning
   (and part of speech)? If the core meaning itself looks wrong, reject and
   note it: the dictionary needs fixing first.
2. **Natural** — would a native speaker say this? No odd collocations, no
   textbook stiffness.
3. **Level** — are the other words easier than the target word?
4. **Translation** — faithful, Simplified Chinese, translates the target word
   with the shown meaning.
5. **Safe** — no real people, brands, violence, sexual or political content.

## Serving and dictionary rebuilds

`ai_examples.json` is loaded into the `ai_examples` table on start (only when
the file changed; entries without a reviewer are ignored). The words API adds
`aiExample` when:

- the word has no human example, and
- its current core meaning equals the meaning the example was written for.

So after a dictionary rebuild:

- a new Tatoeba example wins over the AI example;
- a changed meaning hides the AI example until it is regenerated;
- a removed word simply has no card.

The dictionary import never touches the table.

The flashcard UI does not show `aiExample` yet. Showing it, labelled
"Corvus · AI 生成", is a separate UI decision.

## Workload

Requests at 4 per minute, before retries (expect 10–20% more):

| Words | Batch 1 | Batch 4 | Batch 8 |
| --- | --- | --- | --- |
| Evaluation set (39) | 39 req, 10 min | 10 req, 3 min | 5 req, 2 min |
| Pilot (122) | 122 req, 31 min | 31 req, 8 min | 16 req, 4 min |
| Whole dictionary (7,696) | 7,696 req, 32 h | 1,924 req, 8 h | 962 req, 4 h |

These times assume each request finishes within 15 s. Real Qwen latency for 4
or 8 items is measured in the evaluation run.

## First real-model run (acceptance plan)

Staged: each stage needs its own approval.

1. **Key (operator).**
   - Create the FoxWords key with `aiExamples/ops/corvus_key.py`:
     `create` as yourself, then `add --check` and `add` with sudo.
   - The tool checks the allowlist exactly as Corvus does, backs it up,
     never overwrites a key file or removes another key, and verifies the
     result.
   - Revoke with `remove`.
2. **Endpoint.** On this host use `CORVUS_API_BASE_URL=http://127.0.0.1:18120/v1`.
   - Plain HTTP is accepted only for the loopback addresses 127.0.0.1 and ::1,
     and not when Node may use a proxy.
   - Everything else needs HTTPS, and redirects are never followed.
3. **Smoke test.** At most 2 requests:

   ```bash
   node aiExamples/cli.js run --job eval-common-b1 --batch 1 --max-requests 2 --confirm-real-calls
   ```

   Check it with `metrics` and the log. Stop and report.
4. **Comparison (approved separately).**
   - The common subset (16 words, `--eval common`) runs at batch sizes 1, 4
     and 8: 16 + 4 + 2 requests, so quality and latency compare word for word.
   - The 7 diagnostic words (`--eval diagnostic`) run once at batch size 1 and
     are reported separately.
   - 29 requests including the smoke test, plus retries.
   - Evaluation jobs cannot be accepted (`accept` refuses them).
5. **Review.** Export the review files and score every item with the
   checklist. Latency, tokens per word and invalid share come from `metrics`.
6. **Pass criteria for a batch size** (on the 16 common words):
   - at least 90% correct on both meaning and translation;
   - 0 unsafe items;
   - at most 10% invalid or truncated;
   - no duplicates.

   Diagnostic words are judged on whether the problem is visible: flagged by
   `meaning_ok`, or a sentence that shows the mismatch. They are never
   accepted. `meaning_ok` is a hint, not a quality judgment.
7. **Batch size.** Pick the largest batch size that passes, with quality within
   5 points of batch 1.
8. **Pilot.** The 122-word pilot needs its own approval.
