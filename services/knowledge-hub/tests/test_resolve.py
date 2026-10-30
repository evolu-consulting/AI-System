"""Tests for POST /orchestrator/resolve (2026-09-30).

WHAT IS UNDER TEST
  1. NO SEMANTIC POLICY ROUTING. Routing policy comes from the exact table; resolve no longer
     lets a similarity-matched policy switch the project (retired 2026-08-21) unless the caller
     asks for it with semantic_policy=true.
  2. AN UNREADABLE COLLECTION IS SKIPPED, not a 500. Chroma raises "Nothing found on disk" for a
     collection whose rows were all deleted; the local KH answered 500 on every resolve for it.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_resolve.py

Throwaway chroma dir, sign-in off, stubbed embedder.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_resolve_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ.pop("KH_AUTH_ISSUER", None)

from fastapi.testclient import TestClient        # noqa: E402

from app import config, policy                   # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main                                      # noqa: E402

FAILED = []


def check(name, cond, detail=""):
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        import numpy
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


main.app.state.model = _Model()
client = TestClient(main.app)

# A common policy that names a project: with the retired semantic route it would win and switch.
calls = []
real_match = policy.match_policies


def fake_match(emb, project_id=None, **kw):
    calls.append(project_id)
    return {"fired": [{"scope": "common", "project": "alpha", "score": 0.9}],
            "winner": {"scope": "common", "project": "alpha", "score": 0.9}}


policy.match_policies = fake_match
r = client.post("/orchestrator/resolve", json={"query": "store all information from a tools folder as a work log"})
check("resolve answers 200", r.status_code == 200, r.text[:200])
check("a similarity-matched policy no longer switches the project",
      r.json().get("decision") != "policy" and not calls, (r.json().get("decision"), calls))
r = client.post("/orchestrator/resolve", json={"query": "same", "semantic_policy": True})
check("semantic_policy=true keeps the old behaviour for callers that ask",
      r.json().get("decision") == "policy" and r.json().get("switch_to") == "alpha", r.json().get("decision"))
policy.match_policies = real_match


class _Broken:
    name = "kh_policy_orchestrator"

    def count(self):
        return 3

    def query(self, **kw):
        raise RuntimeError("Error creating hnsw segment reader: Nothing found on disk")


real_get = policy.vs.get_or_create
policy.vs.get_or_create = lambda name: _Broken()
r = client.post("/orchestrator/resolve", json={"query": "anything", "semantic_policy": True})
check("an unreadable policy pool is skipped, not a 500", r.status_code == 200, (r.status_code, r.text[:200]))
policy.vs.get_or_create = real_get

print(f"\n{'ALL PASS' if not FAILED else 'FAILED'}  ({len(FAILED)} failed)")
sys.exit(1 if FAILED else 0)
