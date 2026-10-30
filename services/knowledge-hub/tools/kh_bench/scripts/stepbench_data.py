"""Seed dev for the step-wise trial: ticketing-bench (prod ticketing-system rows + 8 entity cards) and
knowledge-bench (prod 'knowledge' lessons); give the test account (env KH_BENCH_TESTER) read access."""
import json, os, socket, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor
_r = socket.getaddrinfo
def _rr(*a, **k):
    for i in range(8):
        try: return _r(*a, **k)
        except socket.gaierror:
            if i == 7: raise
            time.sleep(3)
socket.getaddrinfo = _rr
from kh_prod import req, ISSUER
PROD, DEV = "https://knowledge-hub.cfapps.br10.hana.ondemand.com", "https://kh-sso.cfapps.br10.hana.ondemand.com"
TESTER = os.environ.get("KH_BENCH_TESTER") or sys.exit("set KH_BENCH_TESTER to the test account e-mail")
DROP = {"emb_dim", "emb_model", "emb_ver", "source_text", "author"}

def rows(base, scope, project):
    out, off = [], 0
    while True:
        s, r = req(base, "POST", "/vector/scroll", {"scope": scope, "project": project, "limit": 500, "offset": off})
        assert s == 200, (s, r); out += r["hits"]
        if r["count"] < 500: return out
        off += 500

def ensure(pid, descriptor):
    if req(DEV, "GET", f"/projects/{pid}")[0] == 404:
        s, b = req(DEV, "POST", "/projects", {"id": pid, "descriptor": descriptor}); print("create", pid, s, str(b)[:120])
    print("grant", pid, req(ISSUER + "/kh/", "PUT", f"projects/{pid}/members/{urllib.parse.quote(TESTER, safe='@')}", {"level": "readonly"}))

def copy(pid, scope, src_rows):
    have = {h["vector_id"] for h in rows(DEV, scope, pid)}
    todo = [h for h in src_rows if h["vector_id"] not in have]
    def add(h):
        meta = {k: v for k, v in (h["metadata"] or {}).items() if k not in DROP}; meta.update(scope=scope, project=pid)
        for i in range(4):
            s, r = req(DEV, "POST", "/vector/add", {"text": h["source_text"], "id": h["vector_id"], "scope": scope, "metadata": meta})
            if s == 200: return True
            time.sleep(2 * (i + 1))
        return h["vector_id"]
    with ThreadPoolExecutor(8) as pool:
        bad = [x for x in pool.map(add, todo) if x is not True]
    print(pid, scope, "copied", len(todo), "fails", bad[:3], flush=True)

ensure("ticketing-bench", "Benchmark copy of prod ticketing-system for the 2026-09-30 step-wise retrieval trial.")
ensure("knowledge-bench", "Benchmark copy of prod 'knowledge' lessons for the 2026-09-30 step-wise retrieval trial.")
D = json.load(open("bench_ticketing_prod.json", encoding="utf-8"))
copy("ticketing-bench", "knowledge", D["knowledge"]); copy("ticketing-bench", "log", D["log"])
lessons = rows(PROD, "knowledge", "knowledge"); print("prod lessons", len(lessons))
json.dump(lessons, open("prod_lessons.json", "w", encoding="utf-8"), ensure_ascii=False)
copy("knowledge-bench", "knowledge", lessons)
for e in json.load(open("bench_entities.json", encoding="utf-8")):
    print("card", e["name"], req(DEV, "POST", "/entities", {"project": "ticketing-bench", **e})[0])
