"""Dev helper: attach a namespace for the SDLC line on the local dev RAG System, then run live checks.

    cd Slaves/SDLC
    python e2e/rag_dev_setup.py [setup] [unit] [base] [outage] [all_on]   (default: setup unit base outage)

  setup   attach (or rotate the client of) namespace RAG_DEV_NS, write the local wire config
          (~/.line/rag.local.json: url, ns, project; no secrets), apply the line's manifest
  unit    LINE_RAG_LIVE=1 line.tests.test_rag_resilient + test_rag_http in this process
  base    the dry pipeline (fake model) with LINE_RAG=http; every local event read back from the remote
  outage  same through a toggling local TCP proxy that goes down when building starts (the container is
          never touched): rag.degraded, outbox, then replay after the proxy is back; read back, no gaps
  all_on  the dry all_on variant (every wave 4 flag) with LINE_RAG=http, rag_leases and rag_records on;
          reports the remote events / records of the run and what is missing

Dev only. RAG_DEV_URL (required: base URL of the dev RAG System), RAG_DEV_NS (line_dev),
RAG_DEV_PROJECT (sdlc-line). Admin token, one of:
  RAG_DEV_BOOTSTRAP_TOKEN      the dev admin/bootstrap token itself, or
  RAG_DEV_CONTAINER            a dev container whose env holds a *_DEV_BOOTSTRAP_TOKEN (read via docker inspect)
  RAG_DEV_TOKEN_PREFIX         optional prefix the RAG System expects on that token (default none)

Secrets: the admin token is read at runtime and kept in memory; the namespace client id/secret go to
os.environ (LINE_RAG_CLIENT_ID/SECRET) of THIS process only. Nothing secret is printed or written.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

SDLC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SDLC)
os.chdir(SDLC)

BASE = os.environ.get("RAG_DEV_URL", "").rstrip("/")
CONTAINER = os.environ.get("RAG_DEV_CONTAINER", "")
TOKEN_PREFIX = os.environ.get("RAG_DEV_TOKEN_PREFIX", "")
NS = os.environ.get("RAG_DEV_NS", "line_dev")
PROJECT = os.environ.get("RAG_DEV_PROJECT", "sdlc-line")
LOCAL_JSON = os.path.join(os.path.expanduser("~"), ".line", "rag.local.json")


def _prefixed(v: str) -> str:
    return v if not TOKEN_PREFIX or v.startswith(TOKEN_PREFIX) else TOKEN_PREFIX + v


def _bootstrap() -> str:
    if os.environ.get("RAG_DEV_BOOTSTRAP_TOKEN"):
        return _prefixed(os.environ["RAG_DEV_BOOTSTRAP_TOKEN"])
    if not CONTAINER:
        raise SystemExit("set RAG_DEV_BOOTSTRAP_TOKEN or RAG_DEV_CONTAINER")
    out = subprocess.run(["docker", "inspect", CONTAINER, "--format", "{{json .Config.Env}}"],
                         capture_output=True, text=True, check=True).stdout
    for kv in json.loads(out):
        k, _, v = kv.partition("=")
        if k.endswith("_DEV_BOOTSTRAP_TOKEN"):
            return _prefixed(v)
    raise SystemExit("no dev bootstrap token in the container env")


def _req(method, path, body=None, token=""):
    data = None if body is None else json.dumps(body).encode()
    h = {"Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    if token:
        h["Authorization"] = "Bearer " + token
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        t = e.read()
        try:
            return e.code, json.loads(t or b"null")
        except ValueError:
            return e.code, {"text": t[:200].decode("utf-8", "replace")}


def _safe(d):
    if isinstance(d, dict):
        return {k: ("<hidden>" if "secret" in k or "token" in k else _safe(v)) for k, v in d.items()}
    return d


def setup() -> None:
    tok = _bootstrap()
    st, b = _req("GET", "/v1/admin/ns/" + NS, token=tok)
    print("ns %s: GET %s state=%s" % (NS, st, (b or {}).get("state")))
    if st == 200 and b.get("state") in ("active", "suspended"):
        st, client = _req("POST", "/v1/admin/ns/%s:client" % NS, {}, token=tok)
        print("rotate client:", st)
    else:
        st, b = _req("PUT", "/v1/admin/ns/" + NS, {"projects": [PROJECT], "display": "SDLC line (dev)"}, token=tok)
        print("attach:", st, _safe({k: v for k, v in (b or {}).items() if k in ("state", "error", "detail")}))
        client = (b or {}).get("client") or {}
    if not client.get("client_secret"):
        raise SystemExit("no client secret returned: %s" % _safe(client))
    os.environ["LINE_RAG_CLIENT_ID"] = client["client_id"]
    os.environ["LINE_RAG_CLIENT_SECRET"] = client["client_secret"]
    # local wire config (no secrets)
    os.makedirs(os.path.dirname(LOCAL_JSON), exist_ok=True)
    cur = {}
    if os.path.isfile(LOCAL_JSON):
        with open(LOCAL_JSON, encoding="utf-8") as fh:
            cur = json.load(fh)
    cur.update({"rag_url": BASE, "rag_ns": NS, "project": PROJECT})
    with open(LOCAL_JSON, "w", encoding="utf-8") as fh:
        json.dump(cur, fh, indent=2)
    from line.config import load_config
    from line.rag.http_adapter import HttpRagAdapter
    cfg = load_config(rag="http")
    http = HttpRagAdapter.from_config(cfg)
    print("capabilities:", http.capabilities())
    res = http.apply_manifest()
    print("manifest applied:", {k: res.get(k) for k in ("manifest_rev", "changed")})


# ------------------------------------------------------------------ live unit tests

def unit() -> bool:
    os.environ["LINE_RAG_LIVE"] = "1"
    suite = unittest.defaultTestLoader.loadTestsFromNames(["line.tests.test_rag_resilient", "line.tests.test_rag_http"])
    r = unittest.TextTestRunner(verbosity=1).run(suite)
    print("live unittest: ran=%d failures=%d errors=%d skipped=%d" % (r.testsRun, len(r.failures), len(r.errors),
                                                                       len(r.skipped)))
    return r.wasSuccessful()


# ------------------------------------------------------------------ remote readback

def remote_events(http, after=0):
    out, cur = [], after
    while True:
        evs = http.events_after(cur, 1000)
        out += evs
        if len(evs) < 1000:
            return out
        cur = evs[-1]["seq"]


def top_seq(http):
    evs = remote_events(http, 0)
    return evs[-1]["seq"] if evs else 0


def check_remote(http, store, start_seq, label):
    """Every local event of this store is on the remote exactly once, in order."""
    local = store.events_after(0, limit=10 ** 6)
    want = [http.to_wire_event(_todict(e))["id"] for e in local]
    rem = remote_events(http, start_seq)          # only ids of local events are looked up below
    by_id = {}
    for e in rem:
        by_id.setdefault(e["id"], []).append(e)
    missing = [i for i in want if i not in by_id]
    dup = [i for i in want if len(by_id.get(i, [])) > 1]
    order = [by_id[i][0]["seq"] for i in want if i in by_id]
    lseq = [(by_id[i][0].get("body") or {}).get("line_seq") for i in want if i in by_id]
    ok = not missing and not dup and order == sorted(order) and lseq == [e.seq for e in local]
    print("%s remote readback: local=%d remote_matched=%d missing=%d dup=%d in_order=%s line_seq_ok=%s" % (
        label, len(local), len(want) - len(missing), len(missing), len(dup), order == sorted(order),
        lseq == [e.seq for e in local]))
    if missing:
        print("   first missing:", missing[:5])
    return ok, len(want) - len(missing)


def _todict(e):
    from line.contracts import to_dict
    return to_dict(e)


# ------------------------------------------------------------------ pipeline variants

class Proxy:
    """Toggling TCP proxy: up -> forwards to the target; down -> resets every connection."""

    def __init__(self, target_port):
        self.target = ("127.0.0.1", target_port)
        self.down = False
        self.ls = socket.socket()
        self.ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.ls.bind(("127.0.0.1", 0))
        self.ls.listen(64)
        self.port = self.ls.getsockname()[1]
        self.conns = []
        self.lock = threading.Lock()
        threading.Thread(target=self._accept, daemon=True).start()

    def set_down(self, v):
        self.down = v
        if v:
            with self.lock:
                for s in self.conns:
                    try:
                        s.close()
                    except OSError:
                        pass
                self.conns = []

    def _accept(self):
        while True:
            try:
                c, _ = self.ls.accept()
            except OSError:
                return
            if self.down:
                c.close()
                continue
            try:
                u = socket.create_connection(self.target, timeout=5)
            except OSError:
                c.close()
                continue
            with self.lock:
                self.conns += [c, u]
            for a, b in ((c, u), (u, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    def _pipe(self, a, b):
        try:
            while True:
                d = a.recv(65536)
                if not d:
                    break
                b.sendall(d)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.close()
                except OSError:
                    pass


def run_pipeline(variant: str) -> bool:
    from line import codes
    from line.config import load_config
    from line.contracts import E_RUN
    from line.e2e import run_line_e2e as E
    from line.pipeline import Pipeline, init_target
    from line.rag import make_rag
    from line.rag.http_adapter import HttpRagAdapter
    from line.store import SqliteStore

    work = tempfile.mkdtemp(prefix="line-live-%s-" % variant)
    proxy = Proxy(int(BASE.rsplit(":", 1)[1])) if variant == "outage" else None
    url = "http://127.0.0.1:%d" % proxy.port if proxy else BASE
    cfg = load_config(workroot=os.path.join(work, "work"), db=os.path.join(work, "line.db"), llm="fake",
                      rag="http", rag_url=url, dry_pack=E.PACK, max_parallel_units=3, qas_repeats=3,
                      deploy_windows=[])
    reader = HttpRagAdapter.from_config(load_config(rag="http"))   # direct, not through the proxy
    start = top_seq(reader)
    store = SqliteStore(cfg.db)
    target = init_target(os.path.join(work, "target"))
    rag = make_rag(cfg, store, probe_interval_s=0 if proxy else 30.0, apply_manifest=True)
    kw = {"rag": rag, "log": lambda m: None}
    if proxy:
        def outage(run, stage):
            if stage == "building":
                proxy.set_down(True)
                print("   proxy DOWN at stage building")
        kw["on_stage"] = outage
    t0 = time.monotonic()
    p = Pipeline(store, cfg, **kw)
    run = p.admit(E.PACK, target)
    p.drive(run)
    secs = round(time.monotonic() - t0, 1)
    res = E.Result(variant)
    res.run, res.work = run, work
    row = store.get(E_RUN, run) or {}
    print("%s: run %s state=%s in %ss rag_lease_authority=%s" % (variant, run, row.get("state"), secs,
                                                               (row.get("detail") or {}).get("rag_lease_authority")))
    E.check_common(res, store, cfg, run)
    if variant == "base":
        E.check_base(res, store, run)
    evs = store.events_after(0, limit=10 ** 6)
    deg = [e for e in evs if e.kind == codes.RAG_DEGRADED_KIND]
    ok = res.ok
    if proxy:
        queued = len(store.outbox_peek(100000))
        print("   degraded events=%d (caps %s) outbox during outage=%d" % (
            len(deg), sorted({e.body.get("capability") for e in deg}), queued))
        ok = ok and bool(deg) and queued > 0
        proxy.set_down(False)
        print("   proxy UP")
        rag.probe()
        while rag.sync_events():
            pass
        left = len(store.outbox_peek(100000))
        restored = [e for e in store.events_after(0, limit=10 ** 6) if e.kind == codes.RAG_RESTORED]
        print("   after restore: outbox=%d restored events=%d degraded now=%s" % (left, len(restored), rag.degraded()))
        ok = ok and left == 0 and bool(restored)
        while rag.sync_events():
            pass
    else:
        print("   degraded events=%d %s" % (len(deg), [(e.body.get("capability"), e.body.get("error", "")[:160])
                                                     for e in deg][:6]))
        ok = ok and not deg
        while rag.sync_events():
            pass
    unsynced = len(store.unsynced(100000))
    rok, matched = check_remote(reader, store, start, variant)
    print("   unsynced local=%d  e2e checks: %s" % (unsynced, res.line()))
    store.close()
    return ok and rok and unsynced == 0


def run_all_on() -> bool:
    """The dry all_on variant (every feature flag on) with LINE_RAG=http, RAG-backed leases and record mirror:
    the line's checks, then what the remote holds for the run (events, records, metrics delivery)."""
    from line import codes
    from line.config import load_config
    from line.e2e import run_line_e2e as E
    from line.rag import make_rag
    from line.rag.http_adapter import HttpRagAdapter
    from line.rag_state import ENTITY_TYPES, record_id
    from line.store import SqliteStore

    reader = HttpRagAdapter.from_config(load_config(rag="http"))
    start = top_seq(reader)
    t0 = time.monotonic()
    def factory(cfg, store):
        return make_rag(cfg, store, probe_interval_s=30.0, apply_manifest=True)

    over = {"rag": "http", "rag_url": BASE, "rag_leases": True, "rag_records": True}
    res = E.run_variant("all_on", cfg_over=over, rag_factory=factory)
    print("all_on (live RAG): %s in %.1fs" % (res.line(), time.monotonic() - t0))
    run = res.run
    store = SqliteStore(os.path.join(res.work, "line.db"))
    try:
        rag = make_rag(load_config(rag="http", rag_url=BASE, db=os.path.join(res.work, "line.db")), store,
                       probe_interval_s=30.0)          # anything the finished run left unsynced
        rag.probe()
        while rag.sync_events():
            pass
        row = store.get("run", run) or {}
        auth = (row.get("detail") or {}).get("rag_lease_authority")
        local = store.events_after(0, limit=10 ** 6)
        mine = [e for e in local if e.env.run == run or (e.env.run == "_line" and (e.body or {}).get("run") == run)]
        rem = remote_events(reader, start)
        rem_run = [e for e in rem if e.get("run_id") == run or (e.get("run_id") == "_line"
                                                                and (e.get("body") or {}).get("run") == run)]
        want = {reader.to_wire_event(_todict(e))["id"] for e in local}
        got = {e.get("id") for e in rem}
        print("   lease authority=%s  local events=%d (run %d)  remote events for the run=%d  missing on remote=%d"
              % (auth, len(local), len(mine), len(rem_run), len(want - got)))
        kinds = {}
        for e in rem_run:
            kinds[e.get("kind")] = kinds.get(e.get("kind"), 0) + 1
        w4 = {k: v for k, v in sorted(kinds.items()) if k in codes.W4_KINDS}
        print("   remote wave-4 kinds: %s" % w4)
        recs = {}
        for entity, rtype in ENTITY_TYPES.items():
            with store._read() as c:
                ids = [r["id"] for r in c.execute("SELECT id FROM record WHERE entity=? AND (run=? OR id=?)",
                                                  (entity, run, run))]
            found = 0
            for i in ids:
                try:
                    if reader.get_record(rtype, record_id(i)):
                        found += 1
                except Exception as ex:   # noqa: BLE001
                    print("   record %s/%s: %s" % (rtype, i, ex))
            recs[rtype] = "%d/%d" % (found, len(ids))
        try:
            rg = reader.get_record("rules_graph", "system")
            recs["rules_graph"] = "yes" if rg else "no"
        except Exception as ex:   # noqa: BLE001
            recs["rules_graph"] = "error %s" % ex
        print("   remote records (found/local): %s" % recs)
        outbox, unsynced = len(store.outbox_peek(100000)), len(store.unsynced(100000))
        print("   outbox=%d unsynced=%d degraded=%s" % (outbox, unsynced, rag.degraded() if rag else "?"))
        return res.ok and not (want - got) and auth == "rag"
    finally:
        store.close()


def main(argv):
    if not BASE:
        raise SystemExit("set RAG_DEV_URL to the dev RAG System base URL")
    phases = argv or ["setup", "unit", "base", "outage"]
    results = {}
    setup()
    for ph in phases:
        if ph == "setup":
            continue
        print("\n===== %s" % ph, flush=True)
        try:
            results[ph] = unit() if ph == "unit" else run_all_on() if ph == "all_on" else run_pipeline(ph)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            results[ph] = False
    print("\nRESULTS:", results)
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
