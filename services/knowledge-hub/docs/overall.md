---
name: knowledgehub
description: How an AI agent ingests knowledge into, and retrieves knowledge from, the KnowledgeHub service (ATTR property-graph + vector RAG, with Florence-2 UI grounding). Use whenever you need to STORE facts/rules for later recall, ANSWER a question from stored knowledge, or LOCATE a UI element in a screenshot.
metadata:
  type: reference
---

# KnowledgeHub — Agent Usage Guide (v5)

KnowledgeHub is a self-hosted **knowledge service** combining a property graph
(ATTR model), a vector store (ChromaDB), and a vision model (Florence-2).

- Base URL: `http://localhost:8000`
- Interactive API docs (Swagger): `http://localhost:8000/docs`
- Liveness: `GET /health` → `{"status":"ok","model":"paraphrase-multilingual-MiniLM-L12-v2"}`
- No local LLM dependency since v6: the Graph · LLM endpoints and the LLMHub settings were removed
  (the calling agent is the reasoning layer). Sections 3 and 9 below keep their old text for history only.
- **Multilingual**: the embedding model is multilingual; Vietnamese (and other languages)
  are first-class. Stored text keeps the original language.

---

## 1. Tier overview — which endpoint do I call?

| Tier | Needs LLM? | Endpoints | Use for |
|------|:----------:|-----------|---------|
| **Vector · Fast** | ❌ | `/vector/add`, `/vector/query`, `/vector/chunk` | Simple facts, notes, similarity search — lowest latency |
| **Graph · LLM** | ✅ | `/graph/text/add`, `/graph/text/query`, `/graph/text/ask` | Extract entities/edges from raw text, multi-hop Q&A |
| **Graph · Direct** | ❌ | `/graph/add`, `/graph/query` | Insert or query pre-built structured entities/edges |
| **Vision** | ❌ | `/vision/locate-ui` | Find UI elements in screenshots |
| **Management** | ❌ | `DELETE /knowledge`, `DELETE /knowledge/orphans` | Delete stored knowledge, GC |

**Quick decision guide:**
- Storing a **simple fact / note / preference** → `/vector/add` (no LLM, fastest).
- Storing a **process / rule with conditions and branching** → `/graph/text/add` (LLM extracts the graph).
- You already have **structured entities/edges** → `/graph/add` (no LLM, direct insert).
- Answering a question with a **prose answer** → `/graph/text/ask`.
- Need **raw graph data** to post-process yourself → `/graph/text/query` or `/graph/query`.
- Just checking **"did I store this?"** → `/vector/query`.

---

## 2. Vector · Fast endpoints (No LLM)

### 2.1 `POST /vector/add` — store text as a vector

Single-call text → embed → store. Replaces the old two-step flow of
`/vectorlize-text` + `/add-vector`.

**Request**
```json
{
  "text": "Khi viết API, luôn handle ký tự đặc biệt trong params để tránh làm hỏng JSON.",
  "id": "rule_api_special_chars",
  "metadata": {"topic": "api"}
}
```
- `text` **(required)** — any string, multilingual.
- `id` *(optional)* — stable entry ID. If omitted → `vec_<sha256(text)[:12]>`; same text → same ID (idempotent).
- `metadata` *(optional)* — extra metadata. Entry is tagged `knowledge_type="quick"` by default
  so it is retrievable via `/vector/query`, `/graph/text/ask`, and `/graph/text/query`.

**Response**
```json
{ "status": "ok", "vector_id": "rule_api_special_chars", "dimension": 384 }
```

---

### 2.2 `POST /vector/query` — semantic similarity search

**Request**
```json
{ "text": "API params special characters", "k": 3 }
```
- `k` — number of hits to return (default `1`, max `50`).

**Response**
```json
{
  "hits": [
    {
      "vector_id": "rule_api_special_chars",
      "score": 0.82,
      "source_text": "Khi viết API, luôn handle ký tự đặc biệt...",
      "summary": ""
    }
  ]
}
```

Long query text (> 200 words) is auto-chunked; results are merged by best score per entry.

---

### 2.3 `POST /vector/chunk` — semantic chunking (no storage)

Split text into semantically coherent segments with one 384-dim embedding per chunk.
`c` controls boundary sensitivity (default `1.0`; lower → more chunks). No storage.

```json
{ "text": "...", "c": 1.0 }
```

Returns: `[{"chunk_text": "...", "embedding": [...]}, ...]`

---

### 2.4 `POST /vector/delete` — remove rows by exact id

The only way a stored row leaves. Added 2026-09-22; before it, a wrong or outdated entry
could only be superseded by a second row saying the first was wrong, and both then loaded
forever.

```json
{ "ids": ["vec_c81778d3fc07"], "dry_run": true }
```

Returns `{status, deleted, found: {id: collection}, not_found, searched, dry_run}`.

- **By id only, never by filter** — max 100 per call. Find the ids with `/vector/query` or
  `/vector/scroll` first. There is deliberately no filter-delete: a wrong `where` would
  empty a partition in one unrecoverable call.
- **`dry_run: true` answers "where does this row actually live"** and deletes nothing. It
  is the sane first call.
- **Omit `scope` to SWEEP every collection.** An id does not say which collection holds
  it, and the rows most needing removal are the ones that landed somewhere unexpected — a
  row written with `scope` only inside `metadata` goes to the DEFAULT scope's collection
  while its metadata claims another, so every scoped read misses it. Passing `scope`
  (optionally with `project`) restricts the search to that scope's lanes instead.
- **Absent ids are not an error**: they come back under `not_found`, and deleting twice is
  a no-op.

---

## 3. Graph · LLM endpoints (REMOVED in v6; kept for history)

All three endpoints return **503 `{"detail":"LLM not available"}`** when LLMHub is offline.

### 3.1 `POST /graph/text/add` — extract ATTR graph from text

**Request**
```json
{
  "text": "When importing an Article, the system must check the Barcode. If duplicated, notify Admin. If Admin rejects, Block; if Admin approves, Merge."
}
```

**Pipeline**
1. LLM (qwen2.5:3b) extracts **nodes** + **edges** in the ATTR ontology (§5).
   Long text (> ~200 words) is auto-chunked, each chunk extracted independently, then merged.
2. Each entity's `source_text` is embedded (384-dim) → ChromaDB, keyed by `core_id`.
3. Graph nodes + edges persisted to graph DB (Kùzu / SAP HANA).

**Response**
```json
{
  "status": "ok",
  "summary": "Extracted 6 entities: Import, Article, Check_Barcode, ...",
  "entities": [
    {"core_id": "check_barcode", "label": "Check_Barcode", "type": "Action", "attributes": {}, "source_text": "check the Barcode"}
  ],
  "edges": [
    {"source_core_id": "import", "relation": "REQUIRES", "target_core_id": "check_barcode"}
  ],
  "vectors_generated": 6
}
```

---

### 3.2 `POST /graph/text/query` — query graph from text (raw data)

LLM extracts entities from query text → resolve to `core_id`s → fetch graph → return raw data.

**Request**
```json
{ "question": "What happens when a barcode is duplicated?" }
```

**Response**
```json
{
  "matched_terms": ["Barcode", "Duplicate"],
  "sources": ["barcode", "duplicated_barcode"],
  "nodes": [...],
  "edges": [...],
  "quick_knowledge": ["original text of any matching vector entries"]
}
```

Use `/graph/text/ask` instead if you want a synthesized prose answer.
Use `/graph/query` instead if you already have the `core_id`s (avoids LLM call).

---

### 3.3 `POST /graph/text/ask` — ask a question, get a synthesized answer

**Request**
```json
{ "question": "What happens if the barcode is duplicated?" }
```

**Pipeline:** extract entities → resolve → fetch graph + vector entries → LLM synthesizes answer.

**Response**
```json
{
  "status": "synthesized",
  "answer": "If the barcode is duplicated, the system notifies Admin for review...",
  "sources": ["duplicated_barcode", "notify", "admin"],
  "graph_data": [...],
  "edges": [...]
}
```

**`status` values an agent must handle:**
- `synthesized` — full LLM answer in `answer`. Use it.
- `raw_data` — knowledge found but LLM couldn't synthesise; read `graph_data`/`edges` directly.
- `not_found` — nothing relevant stored.

---

## 4. Graph · Direct endpoints (No LLM)

### 4.1 `POST /graph/add` — insert pre-built entities and edges

Use when you already have structured entities/edges (e.g. from a `/graph/text/add` response,
or produced by an external extraction pipeline).

**Request**
```json
{
  "entities": [
    {
      "core_id": "check_barcode",
      "label": "Check Barcode",
      "type": "Action",
      "attributes": {},
      "source_text": "check the barcode for duplicates"
    }
  ],
  "edges": [
    {
      "source_core_id": "import_article",
      "relation": "REQUIRES",
      "target_core_id": "check_barcode"
    }
  ]
}
```

- `entities` **(required, ≥1)** — each needs `core_id`, `label`, `type`, `source_text`.
  `source_text` is embedded → ChromaDB for semantic retrieval.
  Duplicate `core_id` → **overwritten** (upsert).
- `edges` *(optional)* — duplicate (src, relation, tgt) triples are silently skipped.

**Response**
```json
{ "status": "ok", "entities_inserted": 1, "edges_inserted": 1, "vectors_generated": 1 }
```

---

### 4.2 `POST /graph/query` — fetch graph by core_ids

Direct graph lookup — no LLM, no entity extraction.

**Request**
```json
{ "core_ids": ["check_barcode", "import_article"] }
```

**Pipeline:**
1. Ontology expansion: follow hierarchy edges (IS_PART_OF, BELONGS_TO, SUBCLASS_OF) in reverse
   up to `ONTOLOGY_HOPS` levels to discover sub-concepts.
2. 1-hop edge fetch over the full expanded set.
3. Return nodes + edges.

**Response**
```json
{
  "status": "ok",
  "nodes": [...],
  "edges": [...]
}
```

**Typical flow:**
```
/vector/query   →  take vector_id (= core_id for graph entities)  →  /graph/query
/graph/text/query  →  take sources (= core_ids)  →  /graph/query
```

---

## 5. The ATTR ontology (what the graph stores)

**Node types** (exactly 5; anything else is coerced to `Artifact`):

| Type | Meaning | Examples |
|------|---------|----------|
| `Action` | a task/step/operation | Import, Check, Notify, Block |
| `Artifact` | something produced/consumed/evaluated | Article, Barcode, Price |
| `System` | software platform/tool/environment | GitHub, ERP, Database |
| `State` | condition/outcome driving branching | Passed, Failed, Duplicated_Barcode |
| `Actor` | human role / named agent | Admin, Manager, Reviewer |

**Edge labels:**
- Logic flow: `TRIGGERS_NEXT`, `EVALUATES`, `TRIGGERS_ACTION`, `BLOCKS_ACTION`,
  `FOLLOWED_BY`, `TARGETS`, `REQUIRES`, `PROVIDES_STATE`, `CAN_HAVE_STATE`
- Hierarchy (child → parent): `IS_PART_OF`, `BELONGS_TO`, `SUBCLASS_OF`

**`source_text`** is a verbatim substring of the input in its original language —
it is what gets embedded, so retrieval matches the *phrasing* of stored knowledge.

---

## 6. Vision endpoint

### `POST /vision/locate-ui` — find a UI element in a screenshot

`multipart/form-data`:
- `image`: screenshot file (PNG/JPG/WebP)
- `query`: natural-language description, e.g. `"Login button"`

**Response**
```json
{
  "status": "success",
  "query": "Login button",
  "center_coordinates": {"x": 640, "y": 360},
  "bounding_box": {"x1": 600, "y1": 340, "x2": 680, "y2": 380}
}
```

Coordinates are in **actual image pixels**. Returns `404` if not found. No LLM required.

---

## 7. Management endpoints

### `DELETE /knowledge` — delete stored knowledge

```json
{ "ids": ["rule_api_special_chars", "check_barcode"], "scope": "all" }
```

- `scope`: `all` (default), `vector`, or `graph`
- `purge_orphan_documents`: `true` to also GC source documents with no remaining nodes
- Idempotent: missing IDs reported in `not_found`, never errored. No LLM required.

### `DELETE /knowledge/orphans` — GC orphaned source documents

No body. Removes `KH_DOCUMENTS` rows no longer referenced by any node. Idempotent.

---

## 8. Storage model

```
                 /graph/text/add            /vector/add         /graph/add
                       │                        │                    │
        ┌──────────────┴───────────────┐         │          ┌────────┴────────┐
        ▼                              ▼         ▼          ▼                 ▼
   ChromaDB (vectors)            Graph DB (topology)    ChromaDB          Graph DB
   collection: knowledge_hub_vectors    Kùzu (default)   (vector)         (nodes+edges)
   - graph entities keyed by core_id   └→ SAP HANA
     (vector = encode(source_text))    KH_DOCUMENTS
   - quick entries keyed by vec_<hash> KH_GRAPH_NODES
     (vector = encode(text))           KH_GRAPH_EDGES
```

- Worklogs (`scope=log`) are written to the shared **hot log window** first and
  spilled into `kh_log_<project>` as it fills — see `docs/hot-log-window.md`.
- **The project registry is a TABLE, not a file** (2026-09-22). One row per project in
  `projects` inside `hooks.db`, beside `hook_rules` and the policy action table;
  `GET /projects` reports where it lives under `store`. It used to be
  `projects_manifest.json`, rewritten whole on every change, which is why a crash
  mid-write could take the whole registry with it. An existing manifest is imported once
  on startup and renamed to `projects_manifest.json.migrated-<utc>`; a project directory
  still carries its own `bundle.json`, so a bundle explains itself without the registry.
- Vector similarity = cosine on L2-normalised 384-dim embeddings.
- Retrieval acceptance threshold: `VECTOR_SCORE_THRESHOLD` (default `0.35`).
- Ontology expansion follows hierarchy edges up to `ONTOLOGY_HOPS` (default `3`) hops.

---

## 9. Errors an agent should expect

| HTTP | When | Agent action |
|------|------|--------------|
| `422` | Request body fails validation | Fix payload |
| `503` | `"LLM not available"` — LLMHub/Ollama unreachable | Use a no-LLM endpoint, or start LLMHub on :8001 |
| `504` | LLMHub timed out | Retry / shorten input |
| `502` | LLMHub HTTP error or unparsable LLM output | Retry |
| `404` | `/vision/locate-ui` found no element | Refine query / screenshot |
| `500` | Internal vector-store / vision / graph error | Inspect server logs |

**No-LLM fallback:** if LLMHub is offline, these endpoints still work:
`/vector/add`, `/vector/query`, `/vector/chunk`, `/vector/delete`, `/graph/add`,
`/graph/query`, `DELETE /knowledge`, `DELETE /knowledge/orphans`, `/vision/locate-ui`.

---

## 10. Configuration (`.env`)

> A cloud copy runs every store in HANA (`KH_STORE_BACKEND`, `KH_VECTOR_BACKEND`,
> `GRAPH_BACKEND=hana`) behind an API key (`KH_API_KEY`). See
> [cloud-deployment.md](cloud-deployment.md). With `KH_AUTH_ISSUER` set, the API key is replaced by
> SSO sign-in with per-project permissions; see [sign-in-and-access.md](sign-in-and-access.md).

| Var | Default | Purpose |
|-----|---------|---------|
| `CHROMA_PATH` | `./chroma_data` | vector store location |
| `KUZU_PATH` | `./kuzu_data` | Kùzu DB location (fallback backend) |
| `HANA_HOST` / `HANA_PORT` | `localhost` / `39041` | primary graph backend |
| `VECTOR_SCORE_THRESHOLD` | `0.35` | min cosine score to accept a hit |
| `ONTOLOGY_HOPS` | `3` | hierarchy expansion depth |
| `CHUNK_WORD_THRESHOLD` | `200` | word count that triggers chunking |
| `KH_EMBEDDING_MODEL` | `bge-small-en-v1.5` | embedding model (registry key) |
| `KH_EMBEDDER` | `local` | where vectors are computed: `local`, `remote` (embed service only) or `auto` (service, local fallback); see cloud-deployment.md |
| `KH_EMBED_URL` / `KH_EMBED_TOKEN` | none | embed service base URL and shared bearer secret (remote / auto only) |

---

## 11. Quick recipes

**Store a simple fact (no LLM):**
```bash
curl -s localhost:8000/vector/add \
  -H "Content-Type: application/json" \
  -d '{"text": "Prod DB backups run at 02:00 UTC daily.", "id": "ops_backup_schedule"}'
```

**Recall it:**
```bash
curl -s localhost:8000/vector/query \
  -H "Content-Type: application/json" \
  -d '{"text": "when do backups run?", "k": 3}'
```

**Store a rule as a graph (LLM extracts structure):**
```bash
curl -s localhost:8000/graph/text/add \
  -H "Content-Type: application/json" \
  -d '{"text": "When importing an Article, check the Barcode. If duplicated, notify Admin."}'
```

**Ask a question:**
```bash
curl -s localhost:8000/graph/text/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is checked when importing an article?"}'
```

**Insert pre-built entities/edges (no LLM):**
```python
import requests
B = "http://localhost:8000"
requests.post(f"{B}/graph/add", json={
    "entities": [
        {"core_id": "backup_job", "label": "Backup Job", "type": "Action",
         "attributes": {"schedule": "02:00 UTC"}, "source_text": "DB backups run at 02:00 UTC"},
    ],
    "edges": []
})
```

**Fetch a subgraph by core_ids (no LLM):**
```python
result = requests.post(f"{B}/graph/query", json={"core_ids": ["backup_job"]}).json()
print(result["nodes"], result["edges"])
```

**Locate a button in a screenshot:**
```python
with open("screen.png", "rb") as f:
    r = requests.post(f"{B}/vision/locate-ui", files={"image": f}, data={"query": "Login button"})
print(r.json()["center_coordinates"])
```
