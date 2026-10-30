"""Tests for fen's policy-retrieval mechanism (2026-08-21).

    step 1  intent -> which project?   GET /orchestrator/project_match   (literal, over the
            orchestrator's C4 tree, which project init writes into)
    step 2  no project  -> policy read from 'every project'
            a project  -> policy read from (that project OR 'every project'), per sub-action

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_project_registry.py

Everything here runs against a THROWAWAY chroma dir + hooks.db, so it never touches the live
install. No embedder is loaded: the registry write takes a fake 384-dim vector, because the
routing path deliberately reads metadata only.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_c4reg_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

from fastapi import FastAPI                      # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402
from app import projects as kh_projects          # noqa: E402
from app import orchestrator as kh_orchestrator  # noqa: E402
from app import policy_actions                   # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir, got %s" % config.CHROMA_PATH

FAILED = []
CHECKS = 0


def check(name, cond, detail=""):
    global CHECKS
    CHECKS += 1
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name,
                         ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


FAKE_VEC = [0.0] * 384


class _Model:
    """Stand-in embedder: the registry write needs a vector, the read never looks at it."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        import numpy
        return numpy.zeros(384, dtype="float32")


app = FastAPI()
app.state.model = _Model()
kh_projects.attach(app)
kh_orchestrator.attach(app)
policy_actions.attach(app)
client = TestClient(app)

# ---- step 1: project init publishes into the orchestrator's C4 tree -------------
r = client.post("/projects", json={
    "id": "ticketing-system", "role": "project",
    "aliases": ["ticketing system", "con ticketing"],
    "keywords": ["ticketing", "ticket", "jira"],
    "descriptor": "Ticketing - the support ticket workflow app."})
check("project create returns ok", r.status_code == 200, r.text[:200])
check("project create writes the C4 record", r.json().get("c4_registry") == "written", r.json())

client.post("/projects", json={
    "id": "simplemdg-v1", "role": "project", "aliases": ["SMDG V1", "SimpleMDG V1"],
    "keywords": ["mdg", "cap", "ui5"], "descriptor": "SimpleMDG V1 monorepo."})

reg = client.get("/projects/registry").json()
check("registry lists both projects plus the orchestrator",
      {"ticketing-system", "simplemdg-v1"} <= {p["id"] for p in reg["projects"]}, reg)
tick = [p for p in reg["projects"] if p["id"] == "ticketing-system"][0]
check("registry keeps the aliases", "con ticketing" in tick["aliases"], tick)
check("registry keeps the keywords", "jira" in tick["keywords"], tick)
check("registry reports its source is the C4 tree", reg["source"] == "c4", reg["source"])

# ---- step 1: resolving fen's own words -----------------------------------------
def match(text):
    return client.get("/orchestrator/project_match", params={"text": text}).json()


m = match("tinh hinh con ticketing sao roi")
check("fen's phrasing resolves (unaccented)", m["best"] == "ticketing-system", m)
check("the match says which term hit",
      m["matches"][0]["matched_term"] == "con ticketing", m["matches"][:1])
check("the match says it came from the C4 tree", m["matches"][0]["source"] == "c4")
check("fen's phrasing resolves (with diacritics)",
      match("tình hình con ticketing sao rồi")["best"] == "ticketing-system")
check("a bare keyword resolves", match("fix cai ticket nay")["best"] == "ticketing-system")
check("underscores and case fold together",
      match("scan SMDG_V1 into KH")["best"] == "simplemdg-v1")
check("an exact id resolves", match("simplemdg-v1")["best"] == "simplemdg-v1")

none = match("deploy the app to production")
check("no project is a real answer", none["best"] is None and none["count"] == 0, none)
check("no project means the every-project tier",
      none["policy_project"] == "every project", none)
check("no substring bleed", match("the ticketingsystem thing")["best"] is None)
check("longer alias beats shorter keyword",
      match("con ticketing")["matches"][0]["matched_on"] == "alias")

# Two projects matching equally well must NOT be silently picked.
client.post("/projects", json={"id": "ticket-archive", "role": "project",
                              "keywords": ["ticket"], "descriptor": "Archive of old tickets."})
amb = match("xem lai cai ticket nay")
check("an ambiguous match refuses to guess", amb["best"] is None and amb["ambiguous"] is True,
      amb["matches"])
check("ambiguous still reports both candidates",
      {h["project"] for h in amb["matches"]} == {"ticketing-system", "ticket-archive"}, amb)

# ---- step 2: policy read scoped by the answer from step 1 ----------------------
SEED = os.path.join(ROOT, "seeds", "policy_action_table.seed.json")
import json                                                  # noqa: E402
with open(SEED, encoding="utf-8") as f:
    client.post("/policy/actions/bulk", json=json.load(f))

client.post("/policy/rule/set", json={
    "action": "scan code", "sub_action": "read files", "project": "con ticketing",
    "seq": 3, "clauses": "9", "content": "TICKETING ONLY: scan app/ and worker/ separately."})

common = client.get("/policy/plan", params={"action": "scan code"}).json()
check("no project -> every-project rules only",
      all(r["project"] == "every project" for r in common["rules"]), common["rules"][:2])

scoped = client.get("/policy/plan", params={"action": "scan code",
                                            "project": "ticketing-system"}).json()
check("with a project -> its rule wins for that step",
      [r for r in scoped["rules"] if r["sub_action"] == "read files"][0]["content"]
      .startswith("TICKETING ONLY"))
check("with a project -> every other step still comes from common",
      sum(1 for r in scoped["rules"] if r["project"] == "every project") == 9,
      [(r["sub_action"], r["project"]) for r in scoped["rules"]])
check("a project's rule does not leak to another project",
      "TICKETING ONLY" not in json.dumps(client.get(
          "/policy/plan", params={"action": "scan code",
                                  "project": "simplemdg-v1"}).json()))
check("fen's words work as the project parameter too",
      [r for r in client.get("/policy/plan", params={"action": "scan code",
                                                     "project": "con ticketing"}).json()["rules"]
       if r["sub_action"] == "read files"][0]["content"].startswith("TICKETING ONLY"))
check("the reply echoes what was requested and what it resolved to",
      client.get("/policy/plan", params={"action": "scan code", "project": "jira"}).json()
      ["project"] == "ticketing-system")

# ---- sync keeps the tree in step with the manifest ----------------------------
second = client.post("/projects/registry/sync").json()
check("a second sync writes nothing", second["written"] == [], second)
client.post("/projects", json={"id": "ticketing-system", "aliases": ["con tickets"]})
after = match("con tickets bi loi")
check("a new alias is findable immediately", after["best"] == "ticketing-system", after)

print("\n%s  (%d checks, %d failed)"
      % ("ALL PASS" if not FAILED else "FAILURES: " + ", ".join(FAILED), CHECKS, len(FAILED)))
sys.exit(1 if FAILED else 0)
