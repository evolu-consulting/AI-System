"""Phase 1 bench (docs/roadmap-e-to-5-design.md 4.3): does distilled knowledge answer the questions? (G3), and
does the leak set leave no trace? (G5).

  python p1bench.py run      [--url URL] [--auth A] [--tasks tasks_p1.json] [--only W01,E05] [--distil-cut DATE]
                             one POST /context/step per question, only_tiers [entity, distilled], budget 4,000
                             chars; prints coverage per question, misses per category, and GATE G3 PASS/FAIL
  python p1bench.py leakseed [--url URL] [--auth A]          DEV ONLY: the 30 leak-set logs + entity cards into
                             the throwaway project (create it first, inside the container, as seed_docker_dev does)
  python p1bench.py leakscan [--url URL] [--auth A] [--dump f.json ...] [--offline]
                             scans items, pending rows, shared lessons, worker.run events and any dump file for
                             the planted strings and their folded variants; GATE G5 PASS/FAIL
  python p1bench.py selftest offline: grading, folding, the leak matcher and the gate on a fake KH

Targets (any KH): --url defaults to the Docker dev http://127.0.0.1:9102. --auth:
  dev-bootstrap[:container]  (default for a local URL) the static dev token of the container (default kh-dev-f),
                             read from `docker inspect` at run time, held in memory, never printed or stored
  env                        $KH_BENCH_TOKEN (a bearer token)
  account:<who>              the bench secrets (KH_BENCH_SECRETS/kh-prod-accounts.json) password grant
  helper                     the bench profile's signed-in kh-helper (run with that helper's python)
A non-local URL (prod: --url prod) is refused unless --allow-remote is given. only_tiers is maintainer-only:
use a maintainer identity (dev-bootstrap is one).

Until /context/step knows only_tiers (slice S7), the server returns every tier; the script then filters the pack
itself (entity, distilled, and knowledge rows with a dk_ id) and marks the verdict INDICATIVE (exit 2), because
the measurement must go through the production path to count (design P1).
Exit codes: 0 PASS, 1 FAIL, 2 INDICATIVE / no verdict.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS = ROOT / "results"
DEV_URL = "http://127.0.0.1:9102"
PROD_URL = "https://knowledge-hub.cfapps.br10.hana.ondemand.com"
DEV_CONTAINER = "kh-dev-f"
TIERS = ("entity", "distilled")
DISTILLED_ID = re.compile(r"^dk_")
RENAMES = {"knowledge": "lesson-learned", "ticketing-system": "simplemdg-ticketing",
           **json.loads(os.environ.get("KH_BENCH_RENAMES", "{}"))}


# ── folding and matching ─────────────────────────────────────────────────────

def fold(s: str) -> str:
    """Lowercase and strip diacritics (Vietnamese đ and Nordic ø included): what every match runs on."""
    s = (s or "").replace("đ", "d").replace("Đ", "D").replace("ø", "o").replace("Ø", "O").replace("æ", "ae")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).casefold()


def coverage(must: dict, text: str) -> tuple[float | None, list[str]]:
    """(share of must-points found, the labels missing)."""
    if not must:
        return None, []
    low = fold(text)
    missing = [label for label, rx in must.items() if not re.search(rx, low)]
    return round(1 - len(missing) / len(must), 3), missing


def forbidden_hits(forbidden: dict, text: str) -> list[str]:
    low = fold(text)
    return [label for label, rx in (forbidden or {}).items() if re.search(rx, low)]


# ── the KH client ────────────────────────────────────────────────────────────

def is_local(url: str) -> bool:
    host = urllib.parse.urlparse(url).hostname or ""
    return host in ("127.0.0.1", "localhost", "::1", "host.docker.internal")


def _dev_bootstrap_token(container: str) -> str:
    try:
        out = subprocess.run(["docker", "inspect", container, "--format", "{{json .Config.Env}}"],
                             capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.exit(f"docker inspect {container} failed: {type(e).__name__}")
    if out.returncode != 0:
        sys.exit(f"docker inspect {container} failed (is the container running?)")
    for e in json.loads(out.stdout or "[]"):
        if e.startswith("KH_DEV_BOOTSTRAP_TOKEN="):
            return "khdev." + e.split("=", 1)[1]
    sys.exit(f"{container} has no KH_DEV_BOOTSTRAP_TOKEN (is KH_DEV_BOOTSTRAP=1 set?)")


class KH:
    """A bearer-token client for one KH. The token is never printed; repr() hides it."""

    def __init__(self, url: str, token_fn, label: str):
        self.url, self._token_fn, self.label = url.rstrip("/"), token_fn, label

    def __repr__(self) -> str:
        return f"KH({self.url}, auth={self.label})"

    def call(self, method: str, path: str, body=None, params: dict | None = None, timeout: float = 120):
        """(status, parsed body or text, seconds). Network errors are retried twice, HTTP errors are not."""
        url = self.url + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={"Authorization": "Bearer " + self._token_fn(),
                                              "Content-Type": "application/json"})
        for attempt in range(3):
            t = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    raw = r.read()
                    dt = time.perf_counter() - t
                    try:
                        return r.status, (json.loads(raw) if raw else None), dt
                    except ValueError:
                        return r.status, raw.decode(errors="replace"), dt
            except urllib.error.HTTPError as e:
                return e.code, e.read()[:400].decode(errors="replace"), time.perf_counter() - t
            except (urllib.error.URLError, OSError):
                if attempt == 2:
                    raise
                time.sleep(2)


def add_target_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--url", default=os.environ.get("KH_P1_URL", DEV_URL),
                    help=f"KH base URL, or 'prod' / 'dev' (default {DEV_URL})")
    ap.add_argument("--auth", default=None, help="dev-bootstrap[:container] | env | account:<who> | helper")
    ap.add_argument("--allow-remote", action="store_true", help="allow a non-local URL (prod); off by default")


def client(a: argparse.Namespace) -> KH:
    url = {"prod": PROD_URL, "dev": DEV_URL}.get(a.url, a.url)
    if not is_local(url) and not a.allow_remote:
        sys.exit(f"refusing non-local URL {url} without --allow-remote (prod runs are a deliberate act)")
    auth = a.auth or ("dev-bootstrap" if is_local(url) else "helper")
    if auth.startswith("dev-bootstrap"):
        if not is_local(url):
            sys.exit("the dev bootstrap token is for a local dev container only")
        tok = _dev_bootstrap_token(auth.split(":", 1)[1] if ":" in auth else DEV_CONTAINER)
        return KH(url, lambda: tok, "dev-bootstrap")
    if auth == "env":
        tok = os.environ.get("KH_BENCH_TOKEN") or sys.exit("KH_BENCH_TOKEN is not set")
        return KH(url, lambda: tok, "env")
    if auth.startswith("account:"):
        sys.path.insert(0, str(HERE))
        import khbench  # noqa: E402 - reads KH_BENCH_SECRETS on first use
        who = auth.split(":", 1)[1]
        return KH(url, lambda: khbench.token(who), auth)
    if auth == "helper":
        if not os.environ.get("CLAUDE_CONFIG_DIR"):
            sys.path.insert(0, str(HERE))
            import khbench  # noqa: E402
            os.environ["CLAUDE_CONFIG_DIR"] = str(khbench.PROFILE)
        try:
            from kh_helper.session import Session  # the bench profile's kh-helper python
        except ImportError:
            sys.exit("--auth helper needs the bench profile's kh-helper python (KH_BENCH_PROFILE/kh-helper)")
        s = Session(url)
        return KH(url, s._access_token, "helper")
    sys.exit(f"unknown --auth {auth}")


# ── G3: the question run ─────────────────────────────────────────────────────

def load_tasks(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    for old, new in RENAMES.items():
        raw = raw.replace(f'"project": "{old}"', f'"project": "{new}"').replace(f"ent__{old}__", f"ent__{new}__")
    return json.loads(raw)


def keep_item(it: dict) -> bool:
    """Distilled knowledge = entity cards + distilled items (design P1)."""
    return it.get("tier") in TIERS or (it.get("tier") == "knowledge" and bool(DISTILLED_ID.match(str(it.get("id")))))


def ask(kh: KH, q: dict, budget: int) -> dict:
    body = {"text": q["prompt"], "budget_chars": budget, "only_tiers": list(TIERS)}
    if q.get("project"):
        body["project"] = q["project"]
    for k in ("action", "context", "entities"):
        if q.get(k):
            body[k] = q[k]
    st, out, dt = kh.call("POST", "/context/step", body)
    if st != 200 or not isinstance(out, dict):
        return {"status": st, "error": str(out)[:200], "latency_s": round(dt, 3)}
    items = out.get("items") or []
    server_filtered = all(it.get("tier") in TIERS for it in items)
    kept = [it for it in items if keep_item(it)]
    text = "\n".join(it.get("text") or "" for it in kept)
    used = out.get("used_chars") if server_filtered and out.get("used_chars") is not None else len(text)
    return {"status": st, "latency_s": round(dt, 3), "server_filtered": server_filtered,
            "tiers": sorted({it.get("tier") for it in items}), "kept_ids": [it.get("id") for it in kept],
            "dropped": len(items) - len(kept), "pack_chars": used, "text": text}


def grade(tasks: dict, answers: dict, distil_cut: str | None = None) -> dict:
    g = tasks.get("grading", {})
    at, gate = g.get("answered_at", 0.8), g.get("gate", {})
    fall = tasks.get("forbidden_all") or {}
    rows, per_cat, warnings = [], {}, []
    for q in tasks["questions"]:
        a = answers.get(q["id"]) or {"status": None, "error": "not asked"}
        text = a.get("text") or ""
        cov, missing = coverage(q.get("must") or {}, text)
        bad = forbidden_hits({**fall, **(q.get("forbidden") or {})}, text)
        ok = a.get("status") == 200 and cov is not None and cov >= at and not bad
        if distil_cut and q.get("category") == "known-error" and (q.get("source_date") or "") >= distil_cut:
            warnings.append(f"{q['id']}: source_date {q.get('source_date')} is not before the distil cut {distil_cut}")
        rows.append({"id": q["id"], "category": q["category"], "project": q.get("project"), "status": a.get("status"),
                     "coverage": cov, "missing": missing, "forbidden": bad, "answered": ok,
                     "pack_chars": a.get("pack_chars"), "latency_s": a.get("latency_s"),
                     "server_filtered": a.get("server_filtered"), "error": a.get("error"), "kept_ids": a.get("kept_ids")})
        c = per_cat.setdefault(q["category"], {"n": 0, "answered": 0, "misses": []})
        c["n"] += 1
        c["answered"] += ok
        if not ok:
            c["misses"].append(q["id"])
    n = len(rows)
    answered = sum(r["answered"] for r in rows)
    share = answered / n if n else 0.0
    max_chars = max((r["pack_chars"] or 0 for r in rows), default=0)
    leaks = [r["id"] for r in rows if r["forbidden"]]
    checks = {
        "questions": (n >= gate.get("min_questions", 40), f"{n} questions (>= {gate.get('min_questions', 40)})"),
        "answered": (share >= gate.get("min_answered_share", 0.8),
                     f"{answered}/{n} answered = {share:.1%} (>= {gate.get('min_answered_share', 0.8):.0%})"),
        "pack_size": (max_chars <= gate.get("max_pack_chars", 4000),
                      f"largest pack {max_chars} chars (<= {gate.get('max_pack_chars', 4000)})"),
        "no_forbidden": (not leaks, f"forbidden strings in {len(leaks)} packs {leaks[:5]}"),
    }
    errors = [r["id"] for r in rows if r["status"] != 200]
    production_path = all(r["server_filtered"] for r in rows if r["status"] == 200) and not errors
    passed = all(ok for ok, _ in checks.values())
    verdict = ("PASS" if passed else "FAIL") if production_path else "INDICATIVE"
    return {"gate": "G3", "verdict": verdict, "passed_numbers": passed, "production_path": production_path,
            "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()}, "per_category": per_cat,
            "errors": errors, "warnings": warnings, "rows": rows}


def print_g3(rep: dict, header: str) -> None:
    print(header)
    for r in rep["rows"]:
        mark = "ok  " if r["answered"] else "MISS"
        extra = f" missing={r['missing']}" if r["missing"] else ""
        extra += f" FORBIDDEN={r['forbidden']}" if r["forbidden"] else ""
        extra += f" status={r['status']} {r['error'] or ''}" if r["status"] != 200 else ""
        print(f"  {mark} {r['id']:<7} {r['category']:<11} cov={r['coverage']} chars={r['pack_chars']}{extra}")
    print("per category (misses become the next distil priorities):")
    for cat, c in rep["per_category"].items():
        print(f"  {cat:<11} {c['answered']}/{c['n']}  misses: {', '.join(c['misses']) or '-'}")
    for w in rep["warnings"]:
        print("  warning:", w)
    for k, c in rep["checks"].items():
        print(f"  [{'pass' if c['ok'] else 'FAIL'}] {k}: {c['detail']}")
    if not rep["production_path"]:
        print("  note: the server did not apply only_tiers (or calls failed); the pack was filtered client-side, "
              "so the numbers are indicative only (design P1 needs the production path)")
    print(f"GATE G3: {rep['verdict']}")


def cmd_run(a) -> int:
    tasks = load_tasks(Path(a.tasks))
    if a.only:
        want = {x if x.startswith("P1-") else "P1-" + x for x in a.only.split(",")}
        tasks["questions"] = [q for q in tasks["questions"] if q["id"] in want]
    kh = client(a)
    budget = tasks.get("grading", {}).get("budget_chars", 4000)
    answers = {}
    for q in tasks["questions"]:
        answers[q["id"]] = ask(kh, q, budget)
    rep = grade(tasks, answers, a.distil_cut)
    rep.update({"url": kh.url, "auth": kh.label, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "tasks": str(a.tasks), "label": a.label})
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"p1bench-{time.strftime('%Y%m%d-%H%M%S')}{'-' + a.label if a.label else ''}.json"
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print_g3(rep, f"p1bench {kh!r}, {len(rep['rows'])} questions -> {out}")
    return {"PASS": 0, "FAIL": 1}.get(rep["verdict"], 2)


# ── G5: the leak set ─────────────────────────────────────────────────────────

def load_leakset(path: Path | None = None) -> dict:
    return json.loads((path or ROOT / "leakset.json").read_text(encoding="utf-8"))


def leak_needles(ls: dict, shared: bool = True) -> list[tuple[str, str]]:
    """(planted id, folded needle): every value as written and folded (one needle covers both, since every
    haystack is folded too), plus the value with its separators collapsed (Okonkwo Vance, okonkwovance)."""
    out = []
    for p in ls["planted"]:
        if p.get("refused_in") == "share" and not shared:
            continue
        v = fold(p["value"])
        variants = {v, re.sub(r"[\s\-_.]+", " ", v).strip()}
        if p["kind"] in ("person", "person-alias", "org"):
            variants.add(re.sub(r"[\s\-_.]+", "", v))
        out += [(p["id"], x) for x in variants if len(x) >= 4]
    return out


def leak_hits(text: str, needles: list[tuple[str, str]]) -> list[str]:
    low = fold(text)
    squashed = re.sub(r"[\s\-_.]+", " ", low)
    return sorted({pid for pid, n in needles if n in low or n in squashed or n in low.replace(" ", "")})


def _walk_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_strings(v, f"{path}[{i}]")


def scan_object(name: str, obj, needles, skip_keys=("source_ids", "sources")) -> list[dict]:
    hits = []
    for path, s in _walk_strings(obj):
        if any(f".{k}" in path for k in skip_keys):
            continue
        for pid in leak_hits(s, needles):
            hits.append({"where": name, "path": path, "planted": pid})
    return hits


def cmd_leakseed(a) -> int:
    kh = client(a)
    if not is_local(kh.url):
        sys.exit("leakseed writes synthetic leaks: dev only")
    ls = load_leakset()
    proj = ls["project"]["id"]
    st, out, _ = kh.call("GET", f"/projects/{proj}")
    if st != 200:
        sys.exit(f"project {proj} not found ({st}); create it inside the container first (as seed_docker_dev.py "
                 f"does) and add {proj} to KH_DISTILL_PROJECTS, never to KH_DISTILL_OWN_PROJECTS")
    for e in ls["entities"]:
        st, out, _ = kh.call("POST", "/entities", {"project": proj, "name": e["name"], "kind": e["kind"],
                                                    "aliases": e["aliases"], "summary": f"synthetic {e['kind']} (leak test)"})
        print(f"  entity {e['kind']:<6} -> {st}")
    for lg in ls["logs"]:
        body = {"text": lg["text"], "scope": "log", "id": f"{proj}-{lg['id']}",
                "metadata": {"scope": "log", "project": proj, "topic": lg["topic"], "subject": lg["topic"],
                             "ts": lg["ts"], "source": "leakset"}}
        st, out, _ = kh.call("POST", "/vector/add", body)
        print(f"  log {lg['id']} -> {st}")
    st, out, _ = kh.call("POST", "/vector/scroll", {"scope": "log", "project": proj, "limit": 100})
    n = out.get("matched") if isinstance(out, dict) else None
    print(f"read back: {n} log rows in {proj} (expect {len(ls['logs'])})")
    return 0 if n == len(ls["logs"]) else 1


def _scroll(kh: KH, body: dict) -> list[dict]:
    rows, off = [], 0
    while True:
        st, out, _ = kh.call("POST", "/vector/scroll", {**body, "limit": 500, "offset": off})
        if st != 200 or not isinstance(out, dict):
            return rows
        rows += out.get("hits") or []
        off += out.get("count") or 0
        if not out.get("count") or off >= (out.get("matched") or 0):
            return rows


def leak_report(sources: list[tuple[str, object, bool]], ls: dict) -> dict:
    """sources: (name, object, shared?) - a shared source is also scanned for the share-only strings."""
    hits = []
    for name, obj, shared in sources:
        hits += scan_object(name, obj, leak_needles(ls, shared=shared))
    gate = ls.get("gate", {})
    n_planted, n_logs = len(ls["planted"]), len(ls["logs"])
    checks = {"planted": (n_planted >= gate.get("min_planted", 50), f"{n_planted} planted strings"),
              "logs": (n_logs >= gate.get("min_logs", 30), f"{n_logs} synthetic logs"),
              "hits": (len(hits) <= gate.get("max_hits", 0), f"{len(hits)} hits")}
    return {"gate": "G5", "verdict": "PASS" if all(ok for ok, _ in checks.values()) else "FAIL",
            "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in checks.items()}, "hits": hits,
            "scanned": [n for n, _, _ in sources]}


def cmd_leakscan(a) -> int:
    ls = load_leakset()
    proj = ls["project"]["id"]
    sources = []
    for f in a.dump or []:
        sources.append((f, json.loads(Path(f).read_text(encoding="utf-8")), True))
    if not a.offline:
        kh = client(a)
        sources.append((f"{proj} knowledge", _scroll(kh, {"scope": "knowledge", "project": proj}), False))
        st, out, _ = kh.call("GET", "/distill/pending", params={"project": proj})
        sources.append((f"{proj} pending", out if st == 200 else [], False))
        shared = _scroll(kh, {"scope": "knowledge", "project": "lesson-learned"})
        sources.append(("lesson-learned knowledge", shared, True))
        for kind in ("worker.run", "worker.cost_usd"):
            st, out, _ = kh.call("GET", "/v1/kh_people/events", params={"kind": kind, "limit": 500})
            if st == 200:
                # kh_people is maintainer-only, not a shared store: a run summary naming its own project id is
                # not a leak (dev check 2026-10-11: project-1 hit on worker.run body.projects[0]); every other
                # planted string (names, e-mails, hosts, secrets) is still scanned here
                sources.append((f"kh_people events {kind}", out, False))
            else:
                print(f"  note: kh_people events {kind} not readable here ({st}); scan an export with --dump")
    rep = leak_report(sources, ls)
    for h in rep["hits"][:50]:
        print(f"  HIT {h['planted']:<12} in {h['where']} {h['path']}")
    for k, c in rep["checks"].items():
        print(f"  [{'pass' if c['ok'] else 'FAIL'}] {k}: {c['detail']}")
    print(f"scanned: {', '.join(rep['scanned']) or 'nothing'}")
    print(f"GATE G5: {rep['verdict']}")
    return 0 if rep["verdict"] == "PASS" else 1


# ── offline self-test ────────────────────────────────────────────────────────

class FakeKH(KH):
    """Serves packs built from the question's own must regexes (as literal-ish text), so the grading is
    exercised end to end without a server. ``mode`` picks the server behaviour."""

    def __init__(self, tasks: dict, mode: str = "filtered", miss: set | None = None, big: set | None = None,
                 leak: set | None = None):
        super().__init__("http://127.0.0.1:1", lambda: "x", "fake")
        self.by_prompt = {q["prompt"]: q for q in tasks["questions"]}
        self.mode, self.miss, self.big, self.leak = mode, miss or set(), big or set(), leak or set()
        self.seen_bodies = []

    @staticmethod
    def _sample(rx: str) -> str:
        """A string the regex matches: first alternative, escapes and anchors removed."""
        alt = rx.split("|")[0]
        alt = re.sub(r"\\b|\(\?:|[()^$]", "", alt).replace("\\.", ".").replace("\\", "")
        alt = re.sub(r"(.)\?", r"\1", alt).replace(".? ", " ").replace(" .?", " ")
        alt = re.sub(r"\[([^\]])[^\]]*\]", r"\1", alt)
        return alt.replace(".?", "").replace("-?", "-").replace("s?", "s").replace("#?", "#")

    def call(self, method, path, body=None, params=None, timeout=120):
        self.seen_bodies.append(body)
        q = self.by_prompt[body["text"]]
        must = list((q.get("must") or {}).values())
        if q["id"] in self.miss:
            must = must[:1]
        text = " ; ".join(self._sample(rx) for rx in must)
        if q["id"] in self.leak:
            text += " contact someone@example.com"
        items = [{"tier": "entity", "id": "ent__x__y", "text": text + (" x" * 2100 if q["id"] in self.big else "")}]
        if self.mode == "unfiltered":
            items.append({"tier": "log", "id": "vec_1", "text": "raw log row"})
            items.append({"tier": "knowledge", "id": "dk_abc", "text": "a distilled item"})
        used = sum(len(i["text"]) for i in items)
        return 200, {"items": items, "used_chars": used}, 0.01


def cmd_selftest(a) -> int:
    fails = []

    def check(cond, msg):
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            fails.append(msg)

    tasks = load_tasks(ROOT / "tasks_p1.json")
    qs = tasks["questions"]
    cats = {c: sum(q["category"] == c for q in qs) for c in ("who", "what", "known-error")}
    check(len(qs) >= 40, f"question set has {len(qs)} questions (>= 40)")
    check(cats == tasks["categories"], f"category counts {cats} match the header")
    check(cats["who"] >= 15 and cats["what"] >= 15 and cats["known-error"] >= 10, "15 who, 15 what, 10 known-error at least")
    check(len({q["id"] for q in qs}) == len(qs), "question ids are unique")
    folded = {q.get("folded_from") for q in qs}
    want = {"W1", "W2", "W3", "X2", "M1", "M2", "M3", "H1", "H2", "H3", "H4", "H5", "H6"}
    check(want <= folded, f"W1-W3, X2, M1-M3, H1-H6 folded in (missing {sorted(want - folded)})")
    for q in qs:
        for rx in list(q["must"].values()) + list(tasks["forbidden_all"].values()):
            re.compile(rx)
        sample = " ; ".join(FakeKH._sample(rx) for rx in q["must"].values())
        cov, miss = coverage(q["must"], sample)
        if cov != 1.0:
            fails.append(f"{q['id']} self-sample misses {miss}")
    check(not [f for f in fails if "self-sample" in f], "every must regex compiles and matches its own sample")
    check(fold("Trần Thị Bích Ngọc ĐẶNG Øvergaard") == "tran thi bich ngoc dang overgaard", "diacritic + case fold")

    # the whole run on a fake KH: server applies only_tiers, everything answered -> PASS
    fk = FakeKH(tasks)
    rep = grade(tasks, {q["id"]: ask(fk, q, 4000) for q in qs})
    check(rep["verdict"] == "PASS", f"all answered on a filtering server -> {rep['verdict']}")
    check(all(b.get("only_tiers") == ["entity", "distilled"] and b.get("budget_chars") == 4000
              for b in fk.seen_bodies), "requests carry only_tiers and budget_chars 4000")
    # 9 misses of 42 -> 33/42 = 78.6% -> FAIL, misses listed per category
    miss = {q["id"] for q in qs[:9]}
    rep = grade(tasks, {q["id"]: ask(FakeKH(tasks, miss=miss), q, 4000) for q in qs})
    check(rep["verdict"] == "FAIL" and not rep["checks"]["answered"]["ok"], "9 misses -> FAIL on answered share")
    check(sorted(sum((c["misses"] for c in rep["per_category"].values()), [])) == sorted(miss), "misses listed per category")
    # 8 misses -> 34/42 = 81% -> PASS
    rep = grade(tasks, {q["id"]: ask(FakeKH(tasks, miss={q["id"] for q in qs[:8]}), q, 4000) for q in qs})
    check(rep["verdict"] == "PASS", "8 misses (81%) -> PASS")
    # an oversize pack fails the gate
    rep = grade(tasks, {q["id"]: ask(FakeKH(tasks, big={qs[0]["id"]}), q, 4000) for q in qs})
    check(not rep["checks"]["pack_size"]["ok"] and rep["verdict"] == "FAIL", "a pack over 4,000 chars -> FAIL")
    # an e-mail in a pack fails the question and the gate
    rep = grade(tasks, {q["id"]: ask(FakeKH(tasks, leak={qs[1]["id"]}), q, 4000) for q in qs})
    check(rep["rows"][1]["forbidden"] and rep["verdict"] == "FAIL", "an e-mail in a pack -> forbidden -> FAIL")
    # a server that ignores only_tiers: client filter keeps entity + dk_, verdict INDICATIVE
    fk = FakeKH(tasks, mode="unfiltered")
    ans = ask(fk, qs[0], 4000)
    check(not ans["server_filtered"] and ans["kept_ids"] == ["ent__x__y", "dk_abc"] and ans["dropped"] == 1,
          "unfiltered server: log row dropped, dk_ knowledge kept")
    rep = grade(tasks, {q["id"]: ask(fk, q, 4000) for q in qs})
    check(rep["verdict"] == "INDICATIVE", "unfiltered server -> INDICATIVE, not PASS")
    check(grade(tasks, {}, "2026-09-01")["warnings"] != [], "distil cut warns about known-error questions dated after it")

    # the leak set
    ls = load_leakset()
    kinds = {p["kind"] for p in ls["planted"]}
    check(len(ls["planted"]) >= 50 and len(ls["logs"]) >= 30, f"{len(ls['planted'])} planted, {len(ls['logs'])} logs")
    check({"person", "person-alias", "org", "email", "secret", "key", "jwt", "host", "ip", "project-id"} <= kinds,
          "every row of the D leak table is planted")
    vals = {p["id"]: p["value"] for p in ls["planted"]}
    check(all(all(vals[i] in lg["text"] for i in lg["planted"]) for lg in ls["logs"]), "every log holds its planted strings")
    used = {i for lg in ls["logs"] for i in lg["planted"]}
    check(used == set(vals), "every planted string appears in some log")
    needles = leak_needles(ls)
    every = leak_hits("\n".join(lg["text"] for lg in ls["logs"]), needles)
    check(set(every) == set(vals), f"the matcher finds all {len(vals)} planted strings in the raw logs")
    check(leak_hits("met tran thi bich ngoc today", needles) == ["alias-2-1", "person-2"],
          "folded name and its alias (no diacritics) are caught")
    check("person-1" in leak_hits("MARISOL OKONKWO VANCE", needles), "case and separator variant is caught")
    check(leak_hits("Pin the host key in known_hosts; read replicas lag.", needles) == [], "clean lesson text -> 0 hits")
    check(leak_hits("Feature flags for kh-leaktest live in the config service", leak_needles(ls, shared=False)) == [],
          "project id is allowed in a project-private item")
    check(leak_hits("Feature flags for kh-leaktest", leak_needles(ls, shared=True)) == ["project-1"],
          "project id is refused in a shared item")
    # KH's own leak patterns (app/config.py defaults) must refuse every secret/key/jwt/e-mail planted
    try:
        sys.path.insert(0, str(ROOT.parent.parent))
        from app import config as khcfg  # noqa: E402
        pats = [re.compile(p) for p in khcfg.DISTILL_LEAK_PATTERNS]
        share = [re.compile(p) for p in khcfg.DISTILL_SHARE_LEAK_PATTERNS]
        need = [p for p in ls["planted"] if p["kind"] in ("email", "secret", "key", "jwt")]
        missed = [p["id"] for p in need if not any(x.search(p["value"]) for x in pats)]
        check(not missed, f"KH's leak patterns refuse every planted e-mail/secret/key/JWT (missed {missed})")
        net = [p for p in ls["planted"] if p["kind"] in ("host", "ip")]
        missed = [p["id"] for p in net if not any(x.search(p["value"]) for x in share)]
        check(not missed, f"KH's share patterns refuse every planted host/IP (missed {missed})")
    except ImportError as e:
        print(f"  skip KH pattern check ({e})")
    clean = {"items": [{"text": "Always pin the host key."}], "sources": ["leak-log-01 marisol.vance@x"]}
    check(leak_report([("x", clean, True)], ls)["verdict"] == "PASS", "a clean dump passes (source ids are skipped)")
    run_ev = {"events": [{"kind": "worker.run", "body": {"job": "distil", "projects": [ls["project"]["id"]]}}]}
    check(leak_report([("kh_people events worker.run", run_ev, False)], ls)["verdict"] == "PASS",
          "a worker.run summary naming its own project id is not a leak (kh_people is not shared)")
    dirty = {"events": [{"payload": {"text": "rotated " + vals["key-3"]}}]}
    rep = leak_report([("x", dirty, True)], ls)
    check(rep["verdict"] == "FAIL" and rep["hits"][0]["planted"] == "key-3", "a key in an event payload -> G5 FAIL")
    check(not is_local(PROD_URL) and is_local(DEV_URL), "prod is treated as remote, dev as local")
    print(f"selftest: {'PASS' if not fails else 'FAIL'} ({len(fails)} failures)")
    return 0 if not fails else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    add_target_args(r)
    r.add_argument("--tasks", default=str(ROOT / "tasks_p1.json"))
    r.add_argument("--only", help="comma list of question ids (W01 or P1-W01)")
    r.add_argument("--distil-cut", help="YYYY-MM-DD: warn on known-error questions dated on or after it")
    r.add_argument("--label", default="", help="suffix of the result file (e.g. manual, worker, flags-on)")
    s = sub.add_parser("leakseed")
    add_target_args(s)
    s = sub.add_parser("leakscan")
    add_target_args(s)
    s.add_argument("--dump", action="append", help="a JSON export to scan too (daily rows, metrics, worker output)")
    s.add_argument("--offline", action="store_true", help="scan only the --dump files")
    sub.add_parser("selftest")
    a = ap.parse_args()
    return {"run": cmd_run, "leakseed": cmd_leakseed, "leakscan": cmd_leakscan, "selftest": cmd_selftest}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
