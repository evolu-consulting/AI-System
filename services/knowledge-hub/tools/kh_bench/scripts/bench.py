"""Benchmark KH before (prod, project ticketing-system) vs after (dev, same rows as ticketing-bench).

Usage: python bench.py copy | entities | run
Every read is timed and sized exactly as an assistant following that deployment's hooks would do it.
"""
import json, socket, statistics, sys, time
from concurrent.futures import ThreadPoolExecutor

_r = socket.getaddrinfo


def _rr(*a, **k):
    for i in range(8):
        try:
            return _r(*a, **k)
        except socket.gaierror:
            if i == 7:
                raise
            time.sleep(3)


socket.getaddrinfo = _rr
from kh_prod import req  # noqa: E402

PROD, DEV = "https://knowledge-hub.cfapps.br10.hana.ondemand.com", "https://kh-sso.cfapps.br10.hana.ondemand.com"
P_PROD, P_DEV, TOPIC = "ticketing-system", "ticketing-bench", "ticketing-system"
DATA = json.load(open("bench_ticketing_prod.json", encoding="utf-8"))
DROP = {"emb_dim", "emb_model", "emb_ver", "source_text", "author"}


def call(base, method, path, body=None):
    t = time.time()
    s, b = req(base, method, path, body)
    return s, b, time.time() - t, len(json.dumps(b, ensure_ascii=False).encode()) if not isinstance(b, str) else len(b)


cmd = sys.argv[1]
if cmd == "copy":
    s, b = req(DEV, "GET", f"/projects/{P_DEV}")
    if s == 404:
        s, b = req(DEV, "POST", "/projects", {"id": P_DEV, "descriptor": "Benchmark copy of ticketing-system (prod) for the 2026-09-30 before/after comparison."})
        print("create", s, str(b)[:120])
        assert s == 200, b

    def add(args):
        sc, row = args
        meta = {k: v for k, v in (row["metadata"] or {}).items() if k not in DROP}
        meta.update(scope=sc, project=P_DEV)
        for i in range(4):
            s, r = req(DEV, "POST", "/vector/add", {"text": row["source_text"], "id": row["vector_id"], "scope": sc, "metadata": meta})
            if s == 200:
                return True
            time.sleep(2 * (i + 1))
        return (row["vector_id"], s, str(r)[:150])

    have = set()
    for sc in ("knowledge", "log"):
        s, r = req(DEV, "POST", "/vector/scroll", {"scope": sc, "project": P_DEV, "limit": 5000})
        have |= {h["vector_id"] for h in r.get("hits", [])}
    todo = [(sc, row) for sc in ("knowledge", "log") for row in DATA[sc] if row["vector_id"] not in have]
    print("todo", len(todo), flush=True)
    with ThreadPoolExecutor(8) as pool:
        res = list(pool.map(add, todo))
    print("fails", [x for x in res if x is not True][:5])

elif cmd == "entities":
    for e in json.load(open("bench_entities.json", encoding="utf-8")):
        s, r = req(DEV, "POST", "/entities", {"project": P_DEV, **e})
        print(s, e["name"], (r.get("id"), r.get("updated")) if isinstance(r, dict) else str(r)[:200])

elif cmd == "meaning":
    # Passages from the START and from the END of long rows; the target row must come back in the top 5.
    longs = [h for h in DATA["log"] if len(h["source_text"]) > 4000][:20]
    qs = []
    for h in longs:
        w = h["source_text"].split()
        qs.append(("start", " ".join(w[20:45]), h["vector_id"]))
        qs.append(("end", " ".join(w[-40:-15]), h["vector_id"]))
    res = {}
    for label, base, project in (("before", PROD, P_PROD), ("after", DEV, P_DEV)):
        found = {"start": 0, "end": 0}; top1 = {"start": 0, "end": 0}; lat = []; nbytes = 0
        for part, text, vid in qs:
            body = {"text": text, "scope": "log", "project": project, "k": 5}
            if label == "after":
                body["max_chars"] = 600
            s, r, t, n = call(base, "POST", "/vector/query", body)
            lat.append(t); nbytes += n
            ids = [x["vector_id"] for x in r["hits"]]
            found[part] += vid in ids; top1[part] += bool(ids) and ids[0] == vid
        res[label] = {"found_top5": found, "top1": top1, "n_per_part": len(longs),
                      "median_latency_s": round(statistics.median(lat), 2), "bytes": nbytes}
        print(label, res[label], flush=True)
    json.dump(res, open("bench_meaning.json", "w", encoding="utf-8"), indent=1)

elif cmd == "run":
    out = {"tasks": []}
    newest = max(DATA["log"], key=lambda h: h["metadata"]["ts"] if h["metadata"].get("topic") == TOPIC else "")
    topic_rows = sorted([h for h in DATA["log"] if h["metadata"].get("topic") == TOPIC], key=lambda h: h["metadata"]["ts"], reverse=True)
    since = topic_rows[9]["metadata"]["ts"]
    want_since = {h["vector_id"] for h in topic_rows[:10]}

    def best_of(fn, n=3):
        runs = [fn() for _ in range(n)]
        return {"bytes": runs[0]["bytes"], "calls": runs[0]["calls"], "correct": runs[0]["correct"],
                "detail": runs[0].get("detail", ""), "latency_s": round(statistics.median(r["lat"] for r in runs), 2)}

    # A. latest entry on a subject
    def a_before():
        rows, b, lat, calls, off = [], 0, 0, 0, 0
        while True:
            s, r, t, n = call(PROD, "POST", "/vector/scroll", {"scope": "log", "project": P_PROD, "where": {"topic": {"$eq": TOPIC}}, "limit": 500, "offset": off})
            rows += r["hits"]; b += n; lat += t; calls += 1
            if r["count"] < 500:
                break
            off += 500
        top = max(rows, key=lambda h: h["metadata"].get("ts", ""))
        return {"bytes": b, "lat": lat, "calls": calls, "correct": top["vector_id"] == newest["vector_id"]}

    def a_after():
        s, r, t, n = call(DEV, "GET", f"/log/recent?project={P_DEV}&topic={TOPIC}&limit=1&max_chars=400")
        return {"bytes": n, "lat": t, "calls": 1, "correct": r["hits"][0]["vector_id"] == newest["vector_id"]}

    out["tasks"].append({"task": "Latest entry on a subject", "before": best_of(a_before), "after": best_of(a_after)})

    # B. Stop check: is this turn already logged? (read the newest row)
    def b_before():
        s, r, t, n = call(PROD, "POST", "/vector/scroll", {"scope": "log", "project": P_PROD, "where": {"topic": {"$eq": TOPIC}}, "limit": 50})
        top = max(r["hits"], key=lambda h: h["metadata"].get("ts", ""))
        return {"bytes": n, "lat": t, "calls": 1, "correct": top["vector_id"] == newest["vector_id"],
                "detail": f"{len(r['hits'])} of {r['matched']} rows read"}

    def b_after():
        s, r, t, n = call(DEV, "GET", f"/log/recent?project={P_DEV}&topic={TOPIC}&limit=1&max_chars=400")
        return {"bytes": n, "lat": t, "calls": 1, "correct": r["hits"][0]["vector_id"] == newest["vector_id"]}

    out["tasks"].append({"task": "Stop check (newest row)", "before": best_of(b_before), "after": best_of(b_after)})

    # C. everything since a moment (the 10 newest rows of the subject)
    def c_before():
        s, r, t, n = call(PROD, "POST", "/vector/scroll", {"scope": "log", "project": P_PROD, "where": {"topic": {"$eq": TOPIC}}, "limit": 500})
        got = {h["vector_id"] for h in r["hits"] if h["metadata"].get("ts", "") >= since}
        return {"bytes": n, "lat": t, "calls": 1, "correct": got == want_since}

    def c_after():
        s, r, t, n = call(DEV, "GET", f"/log/recent?project={P_DEV}&topic={TOPIC}&since={since}&limit=50&max_chars=600")
        got = {h["vector_id"] for h in r["hits"]}
        return {"bytes": n, "lat": t, "calls": 1, "correct": got == want_since}

    out["tasks"].append({"task": "Everything since a moment (10 rows)", "before": best_of(c_before), "after": best_of(c_after)})

    # D. meaning questions: a passage from a known row must bring that row back in the top 5
    targets = [DATA["log"][i] for i in range(0, len(DATA["log"]), 40)] + DATA["knowledge"][:3]
    qs = []
    for h in targets:
        words = h["source_text"].split()
        qs.append((" ".join(words[20:45]) or h["source_text"][:200], h["vector_id"], "knowledge" if h in DATA["knowledge"] else "log"))

    def d_run(base, project, snip):
        hits, total_b, total_t, calls, ranks = 0, 0, 0.0, 0, []
        for text, vid, sc in qs:
            body = {"text": text, "scope": sc, "project": project, "k": 5}
            if snip:
                body["max_chars"] = 600
            s, r, t, n = call(base, "POST", "/vector/query", body)
            total_b += n; total_t += t; calls += 1
            ids = [x["vector_id"] for x in r["hits"]]
            ranks.append(ids.index(vid) + 1 if vid in ids else None)
            if snip and ids:        # read the one hit actually used in full
                s2, r2, t2, n2 = call(base, "POST", "/vector/scroll", {"scope": sc, "project": project, "ids": ids[:1]})
                total_b += n2; total_t += t2; calls += 1
        found = sum(1 for x in ranks if x)
        return {"bytes": total_b, "lat": total_t / len(qs), "calls": calls, "correct": f"{found}/{len(qs)}",
                "detail": f"top-1 {sum(1 for x in ranks if x == 1)}/{len(qs)}, ranks {ranks}"}

    out["tasks"].append({"task": f"Meaning questions ({len(qs)} queries, k=5)",
                         "before": best_of(lambda: d_run(PROD, P_PROD, False), 1),
                         "after": best_of(lambda: d_run(DEV, P_DEV, True), 1)})

    # E. who is <entity>
    names = json.load(open("bench_entities.json", encoding="utf-8"))
    def e_before():
        b, t, calls, ok = 0, 0.0, 0, 0
        for e in names:
            s, r, lat, n = call(PROD, "POST", "/vector/query", {"text": f"who is {e['name']} and what is their role", "scope": "log", "project": P_PROD, "k": 5})
            b += n; t += lat; calls += 1
            ok += any(e["name"].lower() in x["source_text"].lower() for x in r["hits"])
        return {"bytes": b, "lat": t / len(names), "calls": calls, "correct": f"{ok}/{len(names)} answers mention the entity"}

    def e_after():
        b, t, calls, ok = 0, 0.0, 0, 0
        for e in names:
            s, r, lat, n = call(DEV, "GET", f"/entities/match?text=who+is+{e['name'].replace(' ', '+')}&project={P_DEV}")
            b += n; t += lat; calls += 1
            ok += any(c["name"] == e["name"] for c in r.get("cards", []))
        return {"bytes": b, "lat": t / len(names), "calls": calls, "correct": f"{ok}/{len(names)} cards found"}

    out["tasks"].append({"task": f"Who is <entity> ({len(names)} names)", "before": best_of(e_before, 1), "after": best_of(e_after, 1)})

    # F. fixed rule text per session / per prompt
    def hook_bytes(base):
        tot = {}
        for ht in ("SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"):
            s, r = req(base, "GET", f"/hooks/list?hook_type={ht}")
            tot[ht] = sum(len(x["content"].encode()) for x in r["rules"] if x.get("enabled", 1))
        return tot
    out["hooks"] = {"before": hook_bytes(PROD), "after": hook_bytes(DEV)}
    out["sizes"] = {"logs": len(DATA["log"]), "topic_rows": len(topic_rows), "knowledge": len(DATA["knowledge"]),
                    "median_row_bytes": statistics.median(len(h["source_text"].encode()) for h in DATA["log"])}
    json.dump(out, open("bench_result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for t in out["tasks"]:
        print(t["task"], "| before", t["before"], "| after", t["after"])
    print(out["hooks"])
