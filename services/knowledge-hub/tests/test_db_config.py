"""Tests for the database settings read from the environment (app/config.py, app/hana_conn.py).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_db_config.py

Config is read once at import, so every scenario that changes a variable runs in a FRESH
interpreter (``_in_child``) with a clean environment: the result can never leak between
cases or depend on the .env of the machine running the tests. The pool tests run in this
process against a fake driver, so nothing here needs a HANA instance.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_dbconfig_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")

FAILED: list[str] = []
PASSED = 0

#: Every variable this file exercises. Cleared in each child so the host's .env and
#: shell cannot decide the outcome - load_dotenv never overrides a variable that is set,
#: so each one is set to "" rather than removed.
_OWNED = (
    "KH_DB_BACKEND", "GRAPH_BACKEND", "KH_STORE_BACKEND", "KH_VECTOR_BACKEND",
    "KH_SQLITE_TIMEOUT", "KH_SQLITE_WAL", "HANA_SSL_VALIDATE", "HANA_CONNECT_TIMEOUT_MS",
    "HANA_MAX_OVERFLOW", "HANA_POOL_RECYCLE", "HANA_POOL_TIMEOUT", "HANA_GRAPH_POOL_TIMEOUT",
    "HANA_ENCRYPT", "KH_GRAPH_TABLE_PREFIX", "KH_HANA_VEC_COLLECTIONS_TABLE",
    "KH_HANA_VEC_ROWS_TABLE", "KH_DOCS_TABLE", "VCAP_SERVICES",
)

_PROBE = r"""
import json
from app import config
print(json.dumps({
    "graph": config.GRAPH_BACKEND, "store": config.STORE_BACKEND,
    "vector": config.VECTOR_BACKEND, "sqlite_timeout": config.SQLITE_TIMEOUT_S,
    "sqlite_wal": config.SQLITE_WAL, "overflow": config.HANA_MAX_OVERFLOW,
    "recycle": config.HANA_POOL_RECYCLE_S, "pool_timeout": config.HANA_POOL_TIMEOUT_S,
    "graph_pool_timeout": config.HANA_GRAPH_POOL_TIMEOUT_S,
    "prefix": config.GRAPH_TABLE_PREFIX, "colls": config.HANA_VEC_COLLECTIONS_TABLE,
    "rows": config.HANA_VEC_ROWS_TABLE, "docs": config.DOCS_TABLE,
}))
"""


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASSED
    if cond:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL {name} {detail}")


def _in_child(code: str, **env) -> subprocess.CompletedProcess:
    child = dict(os.environ)
    for name in _OWNED:
        child[name] = ""
    # HANA_ENCRYPT is an older flag where blank reads as false; pin it explicitly.
    child["HANA_ENCRYPT"] = "false"
    child.update(env)
    child["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=child,
                          capture_output=True, text=True, timeout=120)


def _settings(**env) -> dict:
    run = _in_child(_PROBE, **env)
    if run.returncode != 0:
        return {"error": run.stderr.strip().splitlines()[-1] if run.stderr else "no output"}
    return json.loads(run.stdout.strip().splitlines()[-1])


def _refused(**env) -> str:
    """The error text when config refuses to load, or "" when it loaded."""
    run = _in_child("from app import config", **env)
    return "" if run.returncode == 0 else (run.stderr.strip().splitlines() or ["?"])[-1]


# --------------------------------------------------------------------------- one switch

def test_one_switch():
    d = _settings()
    check("unset: historical defaults",
          (d.get("graph"), d.get("store"), d.get("vector")) == ("auto", "sqlite", "chroma"), d)
    d = _settings(KH_DB_BACKEND="hana")
    check("KH_DB_BACKEND=hana moves all three",
          (d.get("graph"), d.get("store"), d.get("vector")) == ("hana", "hana", "hana"), d)
    d = _settings(KH_DB_BACKEND="local")
    check("KH_DB_BACKEND=local is the files, without the HANA probe",
          (d.get("graph"), d.get("store"), d.get("vector")) == ("kuzu", "sqlite", "chroma"), d)
    d = _settings(KH_DB_BACKEND="HANA")
    check("the preset name ignores case", d.get("store") == "hana", d)
    d = _settings(KH_DB_BACKEND="hana", KH_STORE_BACKEND="sqlite")
    check("a store's own variable still wins over the preset",
          (d.get("graph"), d.get("store"), d.get("vector")) == ("hana", "sqlite", "hana"), d)
    d = _settings(GRAPH_BACKEND="kuzu")
    check("the old variables alone behave as before", d.get("graph") == "kuzu"
          and d.get("store") == "sqlite", d)
    err = _refused(KH_DB_BACKEND="postgres")
    check("an unknown preset stops startup and names the choices",
          "KH_DB_BACKEND" in err and "hana" in err and "local" in err, err)


# --------------------------------------------------------------------------- knobs

def test_knobs_default_to_the_old_hardcoded_values():
    d = _settings()
    check("sqlite timeout default 10 s", d.get("sqlite_timeout") == 10.0, d)
    check("sqlite WAL default on", d.get("sqlite_wal") is True, d)
    check("stores pool timeout default 30 s", d.get("pool_timeout") == 30.0, d)
    check("graph pool timeout default 10 s", d.get("graph_pool_timeout") == 10.0, d)
    check("no overflow, no recycle by default", d.get("overflow") == 0 and d.get("recycle") == 0, d)
    check("table names default to the ones in use",
          (d.get("prefix"), d.get("colls"), d.get("rows"), d.get("docs"))
          == ("KH_", "KH_VEC_COLLECTIONS", "KH_VEC_ROWS", "kh_docs"), d)


def test_knobs_follow_the_environment():
    d = _settings(KH_SQLITE_TIMEOUT="2.5", KH_SQLITE_WAL="false", HANA_MAX_OVERFLOW="4",
                  HANA_POOL_RECYCLE="3600", HANA_POOL_TIMEOUT="7", HANA_GRAPH_POOL_TIMEOUT="3",
                  KH_GRAPH_TABLE_PREFIX="DEV_", KH_HANA_VEC_COLLECTIONS_TABLE="DEV_VEC_C",
                  KH_HANA_VEC_ROWS_TABLE="DEV_VEC_R", KH_DOCS_TABLE="dev_docs")
    check("sqlite timeout", d.get("sqlite_timeout") == 2.5, d)
    check("sqlite WAL off", d.get("sqlite_wal") is False, d)
    check("overflow and recycle", d.get("overflow") == 4 and d.get("recycle") == 3600, d)
    check("both pool timeouts", d.get("pool_timeout") == 7.0 and d.get("graph_pool_timeout") == 3.0, d)
    check("table names", (d.get("prefix"), d.get("colls"), d.get("rows"), d.get("docs"))
          == ("DEV_", "DEV_VEC_C", "DEV_VEC_R", "dev_docs"), d)


def test_table_names_are_refused_unless_identifiers():
    for bad in ('KH"; DROP TABLE x; --', "has space", "1STARTS_WITH_DIGIT", "dash-name"):
        err = _refused(KH_DOCS_TABLE=bad)
        check(f"refused: {bad!r}", "KH_DOCS_TABLE" in err and "identifier" in err, err)
    check("accepted: a plain identifier", _refused(KH_DOCS_TABLE="Team_Docs_2") == "")


def test_graph_prefix_reaches_project_tables():
    run = _in_child("from app.graph_db.hana_adapter import project_prefix, DEFAULT_PREFIX;"
                    "print(DEFAULT_PREFIX, project_prefix('simplemdg-2.0'))",
                    KH_GRAPH_TABLE_PREFIX="DEV_")
    out = run.stdout.split()
    check("global graph prefix", out[:1] == ["DEV_"], run.stdout + run.stderr)
    check("project graph prefix derives from it",
          len(out) > 1 and out[1].startswith("DEV_P_SIMPLEMDG_2_0_"), run.stdout + run.stderr)


def test_sqlite_connect_obeys_wal():
    code = ("from app import sqldb;c=sqldb.connect();"
            "print(c.execute('PRAGMA journal_mode').fetchone()[0])")
    on = _in_child(code, KH_HOOKS_DB=os.path.join(TMP, "wal_on.db"))
    off = _in_child(code, KH_HOOKS_DB=os.path.join(TMP, "wal_off.db"), KH_SQLITE_WAL="false")
    check("WAL on by default", on.stdout.strip() == "wal", on.stdout + on.stderr)
    check("KH_SQLITE_WAL=false leaves the default journal", off.stdout.strip() == "delete",
          off.stdout + off.stderr)


def test_connect_kwargs():
    code = "import json;from app import hana_conn;print(json.dumps(hana_conn.connect_kwargs()))"
    plain = json.loads(_in_child(code).stdout.strip())
    check("unencrypted: no certificate argument", "sslValidateCertificate" not in plain, plain)
    check("no connect timeout unless set", "connectTimeout" not in plain, plain)
    tls = json.loads(_in_child(code, HANA_ENCRYPT="true", HANA_SSL_VALIDATE="false",
                               HANA_CONNECT_TIMEOUT_MS="4000").stdout.strip())
    check("encrypted: certificate check follows HANA_SSL_VALIDATE",
          tls.get("encrypt") is True and tls.get("sslValidateCertificate") is False, tls)
    check("connect timeout passed through", tls.get("connectTimeout") == 4000, tls)


# --------------------------------------------------------------------------- the pool

class _FakeCursor:
    def __init__(self, log):
        self._log = log

    def execute(self, sql, *a):
        self._log.append(sql)

    def close(self):
        pass


class _FakeConn:
    def __init__(self, log):
        self.log = log
        self.closed = False

    def cursor(self):
        return _FakeCursor(self.log)

    def isconnected(self):
        return not self.closed

    def close(self):
        self.closed = True

    def commit(self):
        pass

    def rollback(self):
        pass


def test_pool_overflow_recycle_and_schema():
    from app import hana_conn
    made: list[_FakeConn] = []

    def factory():
        conn = _FakeConn([])
        made.append(conn)
        return conn

    p = hana_conn._Pool(size=1, timeout=0.2, overflow=1, connect=factory)
    a, b = p.acquire(), p.acquire()
    check("overflow: size 1 + 1 overflow gives two connections", a is not b and len(made) == 2)
    start = time.monotonic()
    try:
        p.acquire()
        check("overflow: a third waits and times out", False)
    except TimeoutError:
        check("overflow: a third waits and times out", time.monotonic() - start >= 0.15)
    p.release(a)
    p.release(b)
    check("overflow: the extra one is closed on return", sum(c.closed for c in made) == 1)
    check("schema: SET SCHEMA on a new connection", any("SET SCHEMA" in s for s in made[0].log))

    made.clear()
    r = hana_conn._Pool(size=1, timeout=0.2, recycle=0.05, connect=factory)
    first = r.acquire()
    r.release(first)
    check("recycle: reused while young", r.acquire() is first)
    r.release(first)
    time.sleep(0.1)
    second = r.acquire()
    check("recycle: replaced once older than the limit", second is not first and first.closed)

    made.clear()
    g = hana_conn._Pool(size=1, set_schema=False, connect=factory)
    g.release(g.acquire())
    check("schema: the graph pool does not SET SCHEMA", made and not made[0].log, made[0].log)

    with g.connection() as conn:
        check("connection(): hands out a pooled connection", conn is made[0])


if __name__ == "__main__":
    for fn in (test_one_switch, test_knobs_default_to_the_old_hardcoded_values,
               test_knobs_follow_the_environment, test_table_names_are_refused_unless_identifiers,
               test_graph_prefix_reaches_project_tables, test_sqlite_connect_obeys_wal,
               test_connect_kwargs, test_pool_overflow_recycle_and_schema):
        print(fn.__name__)
        fn()
    total = PASSED + len(FAILED)
    print(f"\n{total} checks, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
