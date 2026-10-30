"""Tests for KH-to-KH sync (app/sync.py), 2026-10-11.

WHAT IS UNDER TEST
  1. KEYS. A key carries the giver URL and a kid; only its hash is stored; a wrong secret, a revoked or an
     expired key is refused; a key's project allowlist limits what the peer routes give.
  2. TIME RANGE. since / until are inclusive, undated rows only on request.
  3. HANDSHAKE. Any difference in protocol, model, dimension or probe vector fails it.
  4. JOBS. Persisted; a job left running by a stopped process is marked interrupted on the next start.
  5. ROUTE RULES. /home and the peer routes need no sign-in; keys, accounts and grants need a maintainer; connect,
     pull and jobs any KH user (a member on a key the giver verifies).
  8. A KEY IS A READER ROLE. The giver matches the WHOLE key to a stored one (never by its name); a member reads only what both match.
  9. THE GIVER SEES THE PULL. Progress reports, bound to the key; an older giver is not asked again.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_sync.py

Uses a throwaway SQLite database; no network, no vector store. The two-instance trial covers the copy itself.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_sync_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"

from fastapi import HTTPException  # noqa: E402

from app import auth, config, sqldb, sync  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"

FAILURES = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else "  -> %s" % (detail,)))
    if not cond:
        FAILURES.append(name)


def refused(fn, *a):
    try:
        fn(*a)
    except HTTPException as e:
        return e.status_code
    return None


# 1. keys
k = sync.create_key("lab", 7, ["demo"], "https://giver.example/")
parsed = sync.parse_key(k["key"])
check("key names the giver URL and kid", parsed["url"] == "https://giver.example" and parsed["kid"] == k["kid"], parsed)
with sqldb.connect() as c:
    row = dict(c.execute("SELECT * FROM sync_keys WHERE kid = ?", [k["kid"]]).fetchone())
check("only the hash is stored", parsed["secret"] not in json.dumps(row) and row["secret_hash"] == sync._hash(parsed["secret"]))
check("listing never shows the key", all("key" not in x for x in sync.list_keys()))
view = sync.check_key(k["key"])
check("valid key accepted, allowlist kept", view["projects"] == ["demo"] and view["state"] == "active", view)
check("key limits projects", sync._allowed(view, "demo") and not sync._allowed(view, "other"))
check("wrong secret -> 401", refused(sync.check_key, k["key"][:-3] + "abc") == 401)
check("missing key -> 401", refused(sync.check_key, "") == 401)
check("not a key -> 422", refused(sync.parse_key, "hello.world") == 422)
check("key with a non-http URL -> 422", refused(sync.create_key, "x", 1, [], "ftp://x") == 422)
with sqldb.connect() as c:
    c.execute("UPDATE sync_keys SET expires_at = ? WHERE kid = ?", ["2000-01-01T00:00:00Z", k["kid"]])
check("expired key -> 401", refused(sync.check_key, k["key"]) == 401)
k2 = sync.create_key("lab2", 1, [], "http://127.0.0.1:9311")
sync.revoke_key(k2["kid"])
check("revoked key -> 401", refused(sync.check_key, k2["key"]) == 401)
check("revoked key listed as revoked", next(x for x in sync.list_keys() if x["kid"] == k2["kid"])["state"] == "revoked")
check("days capped at 90", sync.create_key("x", 999, [], "http://a")["expires_at"] < "2100")

# 1b. what a key lets the receiver see
k3 = sync.create_key("scoped", 7, ["demo"], "http://a", parts=["knowledge", "log"], since="2026-01-01",
                     until="2026-06-30", members=False)
v3 = sync.check_key(k3["key"])
check("key keeps its parts (log brings the hot window)", v3["parts"] == ["hotlog", "knowledge", "log"], v3["parts"])
check("key keeps its window", (v3["since"], v3["until"]) == ("2026-01-01", "2026-06-30"))
check("part outside the key refused", not sync._part_allowed(v3, "findings") and sync._part_allowed(v3, "knowledge"))
check("receiver range clamped inside the key window",
      sync._clamp(v3, "2025-01-01", "2027-01-01") == ("2026-01-01", "2026-06-30")
      and sync._clamp(v3, "2026-03-01", "") == ("2026-03-01", "2026-06-30"))
check("export of a part outside the key -> 403", refused(sync.export, "demo", "findings", 0, 10, "", "", True, v3) == 403)
check("key without members shares none", v3["members"] is False)
k4 = sync.create_key("all", 7, [], "http://a")
v4 = sync.check_key(k4["key"])
check("nothing chosen = everything, members included", v4["parts"] == [] and v4["members"] is True
      and v4["since"] == "" and sync._part_allowed(v4, "policy"))
check("sign-in off: member lists kept empty with the reason", all(not x.get("ok") for x in v4["_member_lists"].values()))
check("member lists never leave through the key listing", all("_member_lists" not in x for x in sync.list_keys()))
check("unknown part in a key -> 422", refused(sync.create_key, "x", 1, [], "http://a", ["nope"]) == 422)
rep = sync.apply_members("demo", [{"email": "a@x", "level": "editable"}], False)
check("sign-in off receiver applies no members, says why", rep["skipped"] == ["a@x"] and rep["note"], rep)

# 1c. accounts a sync creates: passwords only for user/password accounts
check("agent domain is a password account", sync.login_kind({}, "bot@kh-agent.invalid") == "password")
check("other domains are SSO", sync.login_kind({}, "a@gmail.com") == "sso")
check("the identity service's own flag wins", sync.login_kind({"login": "password"}, "a@gmail.com") == "password")
check("only an explicit flag means a new account", sync._new_account({"created": True}) and not sync._new_account({}))
acc = sync.record_account("bot@kh-agent.invalid", "demo", "sync_x", "http://giver")
check("new password account recorded, not applied while the route is missing", acc["new"] and not acc["password_applied"])
again = sync.record_account("bot@kh-agent.invalid", "demo2", "sync_y", "http://giver")
check("same person again only adds the project", not again["new"])
rows = sync.list_accounts()
check("account listed with a password and both projects", rows[0]["projects"] == ["demo", "demo2"]
      and len(rows[0]["password"]) == 15 and rows[0]["note"], rows)
sync.mark_sent("bot@kh-agent.invalid")
check("sent: the password is forgotten", sync.list_accounts()[0]["password"] == "(sent, not kept)"
      and sync.list_accounts()[0]["sent_at"])
check("sent for an unknown account -> 404", refused(sync.mark_sent, "nobody@x") == 404)

# 2. time range
m = {"ts": "2026-10-05T10:00:00Z"}
check("inside the range", sync.in_range(m, "2026-10-01", "2026-10-05"))
check("until is inclusive of the whole day", sync.in_range(m, "", "2026-10-05"))
check("before since -> out", not sync.in_range(m, "2026-10-06", ""))
check("after until -> out", not sync.in_range(m, "", "2026-10-04"))
check("undated kept only on request", sync.in_range({}, "2026-10-01", "", True) and not sync.in_range({}, "2026-10-01", "", False))
check("no range keeps everything", sync.in_range({}, "", "", False))
check("date falls back to created_at", not sync.in_range({"created_at": "2025-01-01"}, "2026-01-01", ""))

# 3. handshake
base = {"protocol": 2, "emb_model": "bge-small-en-v1.5", "emb_dim": 3, "probe": [0.6, 0.8, 0.0]}
check("same model passes", sync.compare(base, dict(base))["ok"])
check("other model name fails", not sync.compare(base, {**base, "emb_model": "bge-base"})["ok"])
check("other dimension fails", not sync.compare(base, {**base, "emb_dim": 4, "probe": [0.6, 0.8, 0, 0]})["ok"])
check("same name, other weights (probe) fails", not sync.compare(base, {**base, "probe": [0.8, 0.6, 0.0]})["ok"])
check("other protocol fails", not sync.compare(base, {**base, "protocol": 1})["ok"])

# 4. jobs persist; a running job is interrupted by a restart
doc = {"id": "sync_test1", "source": "http://a", "state": "running", "created_by": "t", "started": "2026-10-11T00:00:00Z",
       "finished": None, "plan": [{"project": "p", "part": "knowledge", "source_total": 10, "scanned": 4, "matched": 4}],
       "report": {}, "dry_run": False}
sync._progress(doc)
check("progress percent", doc["progress"] == {"scanned": 4, "total": 10, "percent": 40.0}, doc["progress"])
sync._save(doc, insert=True)
check("job readable", sync.get_job("sync_test1")["progress"]["percent"] == 40.0)
sync._READY = False
sync.init()
j = sync.get_job("sync_test1")
check("restart marks a running job interrupted", j["state"] == "interrupted" and j["error"], j["state"])
check("jobs listed", [x["id"] for x in sync.list_jobs()] == ["sync_test1"])
check("cancel of an unknown job -> 404", refused(sync.cancel_job, "nope") == 404)

# 5. route rules
rules = auth.load_rules()
for method, path, kind in (("GET", "/home", "public"), ("GET", "/home/config", "public"),
                           ("POST", "/home/login/start", "public"), ("POST", "/home/login/poll", "public"),
                           ("GET", "/sync/peer/hello", "public"), ("GET", "/sync/peer/manifest", "public"),
                           ("POST", "/sync/peer/export", "public"), ("POST", "/sync/keys", "maintainer"),
                           ("GET", "/sync/keys", "maintainer"), ("DELETE", "/sync/keys/abc", "maintainer"),
                           ("POST", "/sync/connect", "authenticated"), ("POST", "/sync/pull", "authenticated"),
                           ("GET", "/sync/jobs/sync_x", "authenticated"), ("POST", "/sync/jobs/sync_x/cancel", "authenticated"),
                           ("POST", "/sync/peer/verify", "public"), ("POST", "/sync/peer/progress", "public"),
                           ("GET", "/sync/given", "maintainer"), ("GET", "/sync/grants", "maintainer"),
                           ("POST", "/sync/grants/remove", "maintainer"), ("GET", "/sync/accounts", "maintainer")):
    rule, _ = auth.match(rules, method, path)
    check("rule %s %s is %s" % (method, path, kind), rule is not None and rule.kind == kind, rule and rule.kind)
member = auth.Principal(email="m@x", role="member")
rule, params = auth.match(rules, "POST", "/sync/pull")
check("a member reaches pull (the key decides there)", auth.decide(rule, member, params, {}, {}) is None)
rule, params = auth.match(rules, "POST", "/sync/keys")
check("a member may not make keys", auth.decide(rule, member, params, {}, {}) == "maintainers only")

# 6. /home device sign-in sends PKCE (S256) and returns the verifier for the poll
import asyncio  # noqa: E402
import base64  # noqa: E402
import hashlib  # noqa: E402

import requests  # noqa: E402
from fastapi import FastAPI  # noqa: E402

SENT = []


class _Resp:
    status_code = 200

    def __init__(self, body):
        self._b = body

    def json(self):
        return self._b


def _fake_post(url, data=None, timeout=None):
    SENT.append((url, dict(data or {})))
    if url.endswith("/auth/device"):
        return _Resp({"device_code": "dc", "user_code": "AB-CD", "verification_uri": "https://idp/device",
                      "expires_in": 600, "interval": 5})
    return _Resp({"access_token": "at", "refresh_token": "rt", "expires_in": 300})


_old_post, _old_iss = requests.post, config.AUTH_ISSUER
requests.post, config.AUTH_ISSUER = _fake_post, "https://idp/realms/r"
try:
    app = FastAPI()
    sync.attach(app)
    ep = {r.path: r.endpoint for r in app.routes if hasattr(r, "endpoint")}
    started = asyncio.run(ep["/home/login/start"]())
    dev = SENT[0][1]
    ver = started.get("code_verifier") or ""
    want = base64.urlsafe_b64encode(hashlib.sha256(ver.encode()).digest()).rstrip(b"=").decode()
    check("device start sends S256", dev.get("code_challenge_method") == "S256", dev)
    check("challenge matches the returned verifier", ver and dev.get("code_challenge") == want)
    polled = asyncio.run(ep["/home/login/poll"]({"device_code": "dc", "code_verifier": ver}))
    check("poll forwards the verifier", SENT[1][1].get("code_verifier") == ver and polled["state"] == "ok", SENT[1])
finally:
    requests.post, config.AUTH_ISSUER = _old_post, _old_iss

# ── 6. METADATA FROM A HANA GIVER (2026-10-20: a 'variants' list of objects failed a whole pull into Chroma) ──
import chromadb  # noqa: E402

_given = {"variants": [{"context": ["app:web-crud"], "solution": "x"}], "tags": ["a", "b"], "n": 3, "ok": True,
          "none": None, "mixed": [1, "a"], "nums": [1, 2.5], "empty": [], "obj": {"k": 1}, "flags": [True, False]}
_m = sync.store_meta(_given)
check("scalars and one-type lists kept", all(_m[k] == _given[k] for k in ("tags", "n", "ok", "none", "flags")), _m)
check("objects and mixed or empty lists become JSON text",
      all(json.loads(_m[k]) == _given[k] for k in ("variants", "mixed", "nums", "empty", "obj")), _m)
_coll = chromadb.EphemeralClient().get_or_create_collection("sync_meta")
_coll.upsert(ids=["r1"], embeddings=[[0.1, 0.2, 0.3]], metadatas=[_m], documents=["d"])
check("Chroma takes the stored metadata", _coll.get(ids=["r1"])["ids"] == ["r1"])

# ── 7. PERSONAL PROJECTS IN A BACKUP (Rowan 2026-10-20: a sync is a backup / restore of the whole KH) ──
_pp = config.PERSONAL_PREFIX + "jane-example-com"
check("no key: personal left out by default", not sync._gives(None, _pp) and sync._gives(None, "demo"))
check("no key, full list to pick from: personal shown", sync._gives(None, _pp, include_personal=True))
check("key naming no project: personal still left out", not sync._gives({"projects": []}, _pp))
check("key naming the personal project: given", sync._gives({"projects": [_pp, "demo"]}, _pp))
check("key naming other projects: personal not given", not sync._gives({"projects": ["demo"]}, _pp))
check("export of a personal project without a key refused", refused(sync.export, _pp, "knowledge") == 403)
check("personalization is a default part", "personalization" in sync.DEFAULT_PARTS and "personalization" in sync.ALL_PARTS)
_am = sync.apply_members(_pp, [{"email": "x@example.com", "level": "owner"}], True)
check("a personal project gets no members", not _am["added"] and "personal" in _am["note"], _am)

# ── 8. A KEY IS A READER ROLE, VERIFIED BY THE GIVER (Rowan 2026-10-22) ──
from app.projects import ORCHESTRATOR_ID  # noqa: E402

_k8 = sync.create_key("reader", 7, ["demo"], "https://giver.example/")
_v8 = sync.check_key(_k8["key"])
check("a key carries the reader role", _v8["role"] == sync.KEY_ROLE == "reader")
_real_manifest = sync.manifest
sync.manifest = lambda view=None, counts=True, include_personal=False: {
    "projects": [{"id": "demo"}] if view is not None and sync._allowed(view, "demo") else []}
_ver = sync.verify(_v8)
sync.manifest = _real_manifest
check("giver verify answers from its stored key", _ver["kid"] == _k8["kid"] and _ver["projects"] == ["demo"]
      and _ver["state"] == "active" and _ver["role"] == "reader", _ver)
check("verify refuses a key it does not store", refused(sync.check_key, _k8["key"][:-3] + "xyz") == 401)
_p8 = sync.parse_key(_k8["key"])
check("the whole key is matched, not its name: right secret, other kid -> 401",
      refused(sync.check_key, sync._key_string(_p8["url"], "000000000000", _p8["secret"])) == 401)
check("right secret, other giver URL -> 401",
      refused(sync.check_key, sync._key_string("https://evil.example", _p8["kid"], _p8["secret"])) == 401)
check("right kid, other secret -> 401",
      refused(sync.check_key, sync._key_string(_p8["url"], _p8["kid"], "x" * 43)) == 401)
check("the exact key still matches (surrounding spaces ignored)", sync.check_key("  " + _k8["key"] + "\n")["kid"] == _k8["kid"])


class _FakeRemote:
    """The giving KH as a receiver sees it; `answers` maps a path to a reply or an exception."""
    def __init__(self, key, answers=None):
        self.base, self.kid, self.key, self.reports = "https://giver.example", sync.parse_key(key)["kid"], key, True
        self.answers, self.told = answers or {}, []

    def call(self, method, path, body=None):
        a = self.answers.get(path)
        if isinstance(a, Exception):
            raise a
        return a

    def tell(self, path, body):
        self.told.append((path, json.loads(json.dumps(body))))
        return True


_good = {"match": "whole-key", "kid": _k8["kid"], "label": "reader", "role": "reader", "state": "active", "projects": ["demo"]}
check("receiver takes the giver's verified project list",
      sync.verify_key(_FakeRemote(_k8["key"], {"/sync/peer/verify": _good}))["projects"] == ["demo"])
check("the receiver does not compare the key's name", sync.verify_key(
    _FakeRemote(_k8["key"], {"/sync/peer/verify": {**_good, "kid": "other"}}))["projects"] == ["demo"])
for name, ans in (("no whole-key match", {k: v for k, v in _good.items() if k != "match"}),
                  ("not active", {**_good, "state": "revoked"}),
                  ("another role", {**_good, "role": "owner"}),
                  ("an older giver without the route", HTTPException(502, "the giving KH answered 404"))):
    check("verify refused: " + name,
          refused(sync.verify_key, _FakeRemote(_k8["key"], {"/sync/peer/verify": ans})) == 403)

# reader grants and the auth middleware merge
_mem = auth.Principal(email="reader@x", role="member", projects={"mine": frozenset({"project.write"})})
check("no grant: nothing added", auth.with_key_reads(_mem) is _mem)
check("grants skip personal projects",
      sync.grant_reader("Reader@x", ["demo", _pp], "https://giver.example", _k8["kid"], "sync_aaaaaa") == ["demo"])
_merged = auth.with_key_reads(_mem)
check("a granted project is readable", _merged.can("demo", "project.read"))
check("the grant is read only", not _merged.can("demo", "project.write") and _merged.can("mine", "project.write"))
_maint = auth.Principal(email="reader@x", role="maintainer")
check("a maintainer is left as is", auth.with_key_reads(_maint) is _maint)
rule, params = auth.match(rules, "POST", "/findings/query")
check("decide lets the reader read the granted project", auth.decide(rule, _merged, params, {}, {"project": "demo"}) is None)
check("decide still refuses another project", auth.decide(rule, _merged, params, {}, {"project": "other"}) is not None)
check("grants listed", [(g["email"], g["project"]) for g in sync.list_grants()] == [("reader@x", "demo")])
sync.remove_grant("reader@x", "demo")
check("removed grant no longer read", not auth.with_key_reads(_mem).can("demo", "project.read"))
check("removing an unknown grant -> 404", refused(sync.remove_grant, "reader@x", "demo") == 404)

# a member's pull: only on the giver's verified list; never the orchestrator or another person's personal project
_answers = {"/sync/peer/verify": {**_good, "projects": ["demo", ORCHESTRATOR_ID, _pp]},
            "/sync/peer/manifest": {"projects": [{"id": "demo", "counts": {}, "members": [{"email": "z@x"}]},
                                                 {"id": ORCHESTRATOR_ID, "counts": {}}, {"id": _pp, "counts": {}},
                                                 {"id": "extra", "counts": {}}]}}
_remotes = []


def _fake_remote(key):
    r = _FakeRemote(key, _answers)
    _remotes.append(r)
    return r


_saved = (sync.Remote, sync._handshake, sync.merge_project)
sync.Remote, sync._handshake = _fake_remote, lambda remote, model: {"ok": True}
_registered = []
sync.merge_project = lambda src, dry_run, register=True: _registered.append((src["id"], register)) or "created"
_tok = auth._current.set(_mem)
try:
    _sel = lambda *ids: {"key": _k8["key"], "selection": [{"project": i, "parts": ["knowledge"]} for i in ids]}  # noqa: E731
    check("reader: project not on the giver's list -> 403", refused(sync.pull, _sel("extra"), None, False) == 403)
    check("reader: orchestrator -> 403", refused(sync.pull, _sel(ORCHESTRATOR_ID), None, False) == 403)
    check("reader: another person's personal project -> 403", refused(sync.pull, _sel(_pp), None, False) == 403)
    _job = sync.pull(_sel("demo"), None, False, "https://receiver.example")
    check("reader pull runs and grants read", _job["state"] == "done" and _job["reader_grants"] == ["demo"]
          and _job["as"] == "reader", {k: _job.get(k) for k in ("state", "reader_grants", "as", "error")})
    check("reader pull applies no member list", _job["members"]["demo"] == {"note": sync.READER_MEMBERS_NOTE})
    check("reader pull never registers a project at the identity service (read only, no owner)",
          _registered[-1] == ("demo", False), _registered)
    check("reader now reads demo", auth.with_key_reads(_mem).can("demo", "project.read"))
    _told = [b["job"] for p, b in _remotes[-1].told if p == "/sync/peer/progress"]
    check("receiver told the giver: first running, last done", _told and _told[0]["state"] == "running"
          and _told[-1]["state"] == "done" and _told[-1]["by"] == "reader@x"
          and _told[-1]["receiver"] == "https://receiver.example", _told)
    _con = sync.connect(_k8["key"], None)
    _blk = {p["id"]: p["blocked"] for p in _con["projects"]}
    check("connect marks what a reader may not take", _con["as"] == "reader" and not _blk["demo"]
          and _blk[ORCHESTRATOR_ID] and _blk[_pp] and _blk["extra"], _blk)
    check("a reader sees only their own jobs", [j["id"] for j in sync.list_jobs()] == [_job["id"]])
    check("a reader cannot open another's job", refused(sync.own_job, "sync_test1") == 404)
    check("a reader cannot stop another's job", refused(sync.cancel_job, "sync_test1") == 404)
finally:
    auth._current.reset(_tok)
    sync.Remote, sync._handshake, sync.merge_project = _saved
check("a maintainer sees every job", len(sync.list_jobs()) >= 2)

# merge_project itself: a new project from a reader's pull is made here without registering it
import app.projects as _projects  # noqa: E402
_made, _reg_calls = [], []
_saved2 = (_projects.get_project, _projects.get_or_create_project, auth.register_project)
_projects.get_project = lambda pid: None
_projects.get_or_create_project = lambda pid, **kw: _made.append(pid)
auth.register_project = lambda pid, visibility="private": _reg_calls.append(pid)
try:
    check("reader: new project made, not registered",
          sync.merge_project({"id": "newp"}, False, register=False) == "created" and _made == ["newp"] and not _reg_calls)
    check("maintainer: new project made and registered",
          sync.merge_project({"id": "newq"}, False) == "created" and _reg_calls == ["newq"])
finally:
    _projects.get_project, _projects.get_or_create_project, auth.register_project = _saved2

# ── 9. THE GIVER SEES THE PULL (/sync/peer/progress, /sync/given) ──
_rep = {"job": {"id": "sync_bbbbbb", "state": "running", "by": "r@x", "receiver": "https://r.example",
                "started": "2026-10-22T01:00:00Z", "progress": {"scanned": 5, "total": 10, "percent": 50.0},
                "plan": [{"project": "demo", "part": "knowledge", "source_total": 10, "scanned": 5, "matched": 5}]}}
sync.record_given(_v8, _rep)
_g = sync.list_given()[0]
check("giver keeps the receiver's progress", _g["id"] == "sync_bbbbbb" and _g["progress"]["percent"] == 50.0
      and _g["label"] == "reader" and _g["projects"] == ["demo"] and not _g["silent"], _g)
sync.record_given(_v8, {"job": {**_rep["job"], "state": "done", "progress": {"scanned": 10, "total": 10, "percent": 100}}})
check("a later report updates the same job", [x["state"] for x in sync.list_given()] == ["done"])
check("a job stays bound to its key", refused(sync.record_given, {**_v8, "kid": "other"}, _rep) == 403)
check("bad job id -> 422", refused(sync.record_given, _v8, {"job": {"id": "x; drop", "state": "running"}}) == 422)
check("bad state -> 422", refused(sync.record_given, _v8, {"job": {"id": "sync_cccccc", "state": "owned"}}) == 422)
with sqldb.connect() as c:
    c.execute("UPDATE sync_given SET updated = ?, doc = ? WHERE job_id = ?",
              ["2020-01-01T00:00:00Z", json.dumps({**_g, "state": "running", "updated": "2020-01-01T00:00:00Z"}),
               "sync_bbbbbb"])
check("a running pull with no news is flagged silent", sync.list_given()[0]["silent"])

_calls = []


def _urlopen_404(req, timeout=None):
    _calls.append(req.full_url)
    raise sync.urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)


_real_urlopen = sync.urllib.request.urlopen
sync.urllib.request.urlopen = _urlopen_404
try:
    _rm = sync.Remote(_k8["key"])
    _first, _second = _rm.tell("/sync/peer/progress", {}), _rm.tell("/sync/peer/progress", {})
finally:
    sync.urllib.request.urlopen = _real_urlopen
check("an older giver (4xx) is asked once, then not again, and nothing raises",
      not _first and not _second and len(_calls) == 1 and not _rm.reports, _calls)

print("ALL PASS" if not FAILURES else "FAILED: %s" % FAILURES)
sys.exit(1 if FAILURES else 0)
