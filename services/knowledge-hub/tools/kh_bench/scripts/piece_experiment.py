"""Small pieces: return the whole row, its head, or only the piece that matched? Measured on prod data.

For each retrieval task of tasks.json, the same reads tier 1 makes (knowledge, log, entity, k=8) are
made on prod WITHOUT max_chars, so every row comes back whole. Then four ways of handing those rows to
an assistant are compared:
  whole      every row in full                       (KH without max_chars)
  head600    the first 600 characters of each row    (KH with max_chars=600 today)
  window     the one 800-character window of each row that is closest to the question
             (windows as app/chunks.py cuts them: 800 chars every 700)
  window+1   that window plus the one before and the one after
For each: bytes handed over, and the share of the task's must-have points still present in that text
(a proxy for "the answer is in the context"; the bench's tier 2 measures the real answer).

Run with the KnowledgeHub venv (it has sentence-transformers and the bundled bge-small-en-v1.5):
  <KH>/.venv/Scripts/python.exe piece_experiment.py
"""
import json, os, re, statistics, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import khbench as kb  # noqa: E402
from sentence_transformers import SentenceTransformer  # noqa: E402

MODEL = os.environ.get("KH_BENCH_EMBED_MODEL") or str(Path(__file__).resolve().parents[3] / "models" / "bge-small-en-v1.5")
SIZE, STRIDE = 800, 700


def windows(text):
    if len(text) <= SIZE:
        return [text]
    starts = list(range(0, max(len(text) - SIZE, 0) + STRIDE, STRIDE))
    return [text[s:s + SIZE] for s in starts if text[s:s + SIZE]]


def rows_for(task):
    seen, out = set(), []
    for scope in ("knowledge", "log", "entity"):
        body = {"text": task["prompt"], "scope": scope, "k": 8}
        if task["project"]:
            body["project"] = task["project"]
        s, b, *_ = kb.call("prod", "POST", "/vector/query", body)
        for h in (b.get("hits", []) if isinstance(b, dict) else []):
            if h["vector_id"] not in seen:
                seen.add(h["vector_id"])
                out.append(h.get("source_text") or "")
    return out


def coverage(task, text):
    low = text.lower()
    return sum(bool(re.search(rx, low)) for rx in task["must"].values()) / len(task["must"])


def main():
    model = SentenceTransformer(MODEL)
    enc = lambda xs: model.encode(xs, normalize_embeddings=True)
    res = []
    for t in kb.TASKS["tasks"]:
        if t["category"] == "permission":
            continue
        rows = rows_for(t)
        q = enc([t["prompt"]])[0]
        modes = {"whole": [], "head600": [], "window": [], "window+1": []}
        for r in rows:
            ws = windows(r)
            best = int(max(range(len(ws)), key=lambda i: float(enc([ws[i]])[0] @ q))) if len(ws) > 1 else 0
            modes["whole"].append(r)
            modes["head600"].append(r[:600])
            modes["window"].append(ws[best])
            modes["window+1"].append("".join(ws[max(0, best - 1):best + 2]))
        rec = {"task": t["id"], "category": t["category"], "rows": len(rows)}
        for m, parts in modes.items():
            text = "\n\n".join(parts)
            rec[m] = {"bytes": len(text.encode()), "coverage": round(coverage(t, text), 2)}
        res.append(rec)
        print(json.dumps(rec), flush=True)
    print("\nTOTALS")
    for m in ("whole", "head600", "window", "window+1"):
        b = sum(r[m]["bytes"] for r in res)
        c = statistics.mean(r[m]["coverage"] for r in res)
        print(f"{m:9s} bytes {b:>8,}  coverage {c:.2f}")
    (kb.RESULTS / "piece_experiment.json").write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
