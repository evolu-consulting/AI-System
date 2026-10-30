"""Tests for the turn context (app/turn.py, roadmap item B), 2026-10-02.

WHAT IS UNDER TEST
  1. ONE CALL ANSWERS THE PRE-WORK READS. GET /turn/context names the project the prompt matches, the
     action menu for it, its findings, the entity cards named and the KH lessons above the floor, and
     renders them as one block that tells the model not to fetch them again.
  2. ACCESS. A project the caller cannot read is never the match, and its findings and entity cards
     never appear; a caller without the lessons project gets no lessons.
  3. FALLBACKS. No match, a tie and a weak-only match are reported as such, not guessed.
  4. THE HELPER. kh-helper's UserPromptSubmit appends the block for the prompt in the hook's stdin, and
     says nothing extra when the prompt is missing or KH answers an error (an older KH without the route).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_turn_context.py

Throwaway chroma dir + hooks.db, a locally generated RSA key and a stubbed embedder.
"""
import json
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools", "kh-helper"))

TMP = tempfile.mkdtemp(prefix="kh_turn_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, feedback, projects  # noqa: E402
from app.policy_actions import store as policy_store  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402
from kh_helper import hooks  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Every text embeds to the same unit vector, so every stored row scores 1.0 against every query."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
FULL = ["project.read", "project.write", "project.log"]


def token(email, grants):
    now = int(time.time())
    kh = {"role": "member", "permissions": [], "all_projects": [], "projects": grants}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


projects.get_or_create_project("ticketing-system", aliases=["con ticketing"], keywords=["ticketing"],
                               descriptor="Ticketing")
projects.get_or_create_project("secret-deal", aliases=["project falcon"], keywords=["falcon"], descriptor="Hidden")
projects.get_or_create_project("lesson-learned", descriptor="Shared lessons")
projects.get_or_create_project("twin-a", aliases=["shared name"])
projects.get_or_create_project("twin-b", aliases=["shared name"])
policy_store.set_action("implement", "Build something into code that already exists. Pick this for features.")
policy_store.set_action("ship fix", "Ship a Ticketing fix to QAS then prod. Long text after the first sentence.",
                        project="ticketing-system")
feedback.mark_finding("ticketing-system", {"issue_id": "qas-first", "desc": "Always deploy to QAS before prod.",
                                           "count": 4}, [1.0] + [0.0] * 383)
feedback.mark_finding("secret-deal", {"issue_id": "falcon-note", "desc": "Falcon pricing is confidential.",
                                      "count": 4}, [1.0] + [0.0] * 383)

ANA = token("ana@example.invalid", {"ticketing-system": FULL, "lesson-learned": FULL,
                                    "secret-deal": FULL, "twin-a": FULL, "twin-b": FULL})
BEN = token("ben@example.invalid", {"ticketing-system": ["project.read"]})
main.app.state.model = _Model()
client = TestClient(main.app)

r = client.post("/entities", json={"project": "ticketing-system", "name": "Hugh Le", "type": "person",
                                   "role": "product owner"}, headers=ANA)
check("setup: an entity card", r.status_code == 200, r.text[:200])
client.post("/entities", json={"project": "secret-deal", "name": "Hugh Le", "type": "person",
                               "role": "falcon negotiator"}, headers=ANA)
r = client.post("/vector/add", json={"text": "LESSON LEARNED [CI/CD]: deploy to QAS first. Then prod.",
                                     "scope": "knowledge", "metadata": {"project": "lesson-learned"}}, headers=ANA)
check("setup: a lesson row", r.status_code == 200, r.text[:200])


def ctx(text, who=ANA):
    resp = client.get("/turn/context", params={"text": text}, headers=who)
    return resp.status_code, (resp.json() if resp.status_code == 200 else resp.text)


# ── 1. one call answers the pre-work reads ────────────────────────────────
s, c = ctx("con ticketing: ask Hugh Le how to deploy the CS-301 fix")
check("route answers 200", s == 200, c)
check("project is matched by alias", c["project"]["best"] == "ticketing-system" and not c["project"]["ambiguous"],
      c["project"])
labels = {a["action"]: a for a in c["actions"]}
check("actions: the common one and the project's own", set(labels) == {"implement", "ship fix"}, list(labels))
check("an action's 'when' is its first sentence", labels["ship fix"]["when"] == "Ship a Ticketing fix to QAS then prod.",
      labels["ship fix"]["when"])
check("findings of the matched project", c["findings"] == ["Always deploy to QAS before prod."], c["findings"])
check("entities only from the matched project", len(c["entities"]) == 1 and "product owner" in c["entities"][0],
      c["entities"])
check("lessons above the floor, with id and title", len(c["lessons"]) == 1
      and c["lessons"][0]["title"].startswith("LESSON LEARNED [CI/CD]: deploy to QAS first."), c["lessons"])
text = c["text"]
check("the block tells the model what not to call again", "do NOT call those again" in text
      and "/orchestrator/project_match" in text and "/policy/actions" in text, text[:300])
check("the block names the plan call with the project", "/policy/plan?action=<label>&project=ticketing-system" in text,
      text)
check("the block stays small", len(text) < 2500, len(text))

# ── 2. access ──────────────────────────────────────────────────────────────
s, c = ctx("project falcon pricing with Hugh Le", who=BEN)
check("an unreadable project is never the match", c["project"]["best"] is None
      and all(m["project"] != "secret-deal" for m in c["project"]["matches"]), c["project"])
check("its findings never appear", c["findings"] == [] and "confidential" not in c["text"], c["text"])
check("its entity cards never appear", all("falcon" not in e for e in c["entities"]), c["entities"])
check("no lessons without read access to the lessons project", c["lessons"] == [], c["lessons"])
s, _ = ctx("anything", who={})
check("sign-in is required", s == 401, s)

# ── 3. fallbacks ───────────────────────────────────────────────────────────
s, c = ctx("hello there, how are you")
check("no match is reported as none", c["project"]["best"] is None and not c["project"]["ambiguous"]
      and "none matched literally" in c["text"], c["project"])
check("with no project, only the common actions", [a["action"] for a in c["actions"]] == ["implement"], c["actions"])
s, c = ctx("the shared name thing")
check("a tie is ambiguous, not guessed", c["project"]["best"] is None and c["project"]["ambiguous"]
      and "AMBIGUOUS" in c["text"], c["project"])

# ── 4. the helper ──────────────────────────────────────────────────────────


class _Session:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def call(self, method, path, body=None, params=None):
        self.calls.append((method, path, params))
        return self.answers.get(path, (404, "not found"))


sess = _Session({"/turn/context": (200, {"text": "KH TURN CONTEXT - test block"})})
out = hooks.turn_text(sess, json.dumps({"prompt": "con ticketing: deploy"}))
check("helper returns the block for the stdin prompt", out == "KH TURN CONTEXT - test block", out)
check("helper passes the prompt as the text parameter", sess.calls == [("GET", "/turn/context",
                                                                        {"text": "con ticketing: deploy"})], sess.calls)
check("helper: no prompt, no call", hooks.turn_text(_Session({}), "{}") == "")
check("helper: an older KH (404) adds nothing", hooks.turn_text(_Session({}), json.dumps({"prompt": "x"})) == "")
check("helper: unreadable stdin adds nothing", hooks.turn_text(_Session({}), "not json") == "")
check("UserPromptSubmit asks for the turn context", hooks.HOOKS["UserPromptSubmit"].get("turn") is True)

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
