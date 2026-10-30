"""Tests for the tagged kernel (app/kernel) and usage across sessions (app/usage.py).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kernel_tags.py

What is asserted: the vocabulary seeds and suggests; the add contract refuses untagged, unknown-tag,
same-as-common and locked rules and copies the common tags on overrides; the render merges common,
project and personal in code (personal wins, locked stays); parts never cut a rule; a member cannot
write the common tier or someone else's personal tier; usage counts a step done on three days in three
sessions as a repeat.
"""
import os
import sys
import tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_kernel_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

from fastapi import FastAPI                      # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from app import auth, config, kernel, usage      # noqa: E402
from app.kernel import rules as R, tags as T     # noqa: E402

assert config.HOOKS_DB_PATH == os.path.join(TMP, "hooks.db")

FAILED = []
CHECKS = 0


def check(name, cond, detail=""):
    global CHECKS
    CHECKS += 1
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


app = FastAPI()
kernel.attach(app)
client = TestClient(app)

ME = "personal-rowan-hoang-laidon-com"
OTHER = "personal-jane-doe-example-com"

# ── 1. vocabulary ────────────────────────────────────────────────────────────
r = client.post("/kernel/seed").json()
check("seed loads a few hundred tags", r["tags"]["tags"] >= 250, r["tags"])
check("seed loads the kernel as tagged rules", r["rules"]["rules"] == 14, r["rules"])
from app.hooks import store as hook_store          # noqa: E402
pre = hook_store.get_text("PreToolUseTools")
check("seed points the write check at the task tools", "kh_save(text, kind)" in pre and "never scope" in pre, pre)
check("/kernel/pretool serves the task-tool write check", "kh_save(text, kind)" in client.get("/kernel/pretool").text)
again = client.post("/kernel/seed").json()
check("re-seeding adds nothing", again["tags"]["added"] == 0 and again["rules"]["rules"] == 14, again)
names = [s["tag"] for s in client.get("/kernel/tags/suggest",
                                      params={"text": "Everything sent to KH is English; translate queries"}).json()["tags"]]
check("suggest finds lang_english and kh_input", "lang_english" in names and "kh_input" in names, names)
names = [s["tag"] for s in T.suggest("never ask anyone to type a password or token into the chat")]
check("suggest finds secret", "secret" in names or "risk_secret" in names, names)

# ── 2. the add contract ─────────────────────────────────────────────────────
def add(body):
    return client.post("/kernel/rules/add", json=body)

r = add({"tier": ME, "content": "Reply short.", "tags": []})
check("no tags: refused", r.status_code == 422 and r.json()["error"] == "KERNEL-TAGS", r.text)
r = add({"tier": ME, "content": "Reply short.", "tags": ["reply_lenght", "tone"]})
check("unknown tag: refused with the closest", r.status_code == 422 and "reply_length" in str(r.json().get("closest")), r.text)
r = add({"tier": ME, "content": "Reply short.", "tags": ["always", "any_cli"]})
check("only when/where tags: refused", r.status_code == 422 and r.json()["error"] == "KERNEL-TAGS-WHAT", r.text)

mine = {"tier": ME, "title": "Chat with Rowan",
        "content": "Replies decision-first: 1-2 lines, then at most 6 one-line bullets; no preamble, no recap, "
                   "short and plain.",
        "tags": ["reply_length", "reply_format", "decision_first", "no_recap", "before_reply"]}
r = add(mine)
cands = [c["slot"] for c in r.json().get("candidates", [])]
check("same idea as a common rule: refused with the candidate", r.status_code == 409
      and r.json()["error"] == "KERNEL-SAME-AS-COMMON" and "kh_reply_language" in cands, r.text)
r = client.post("/kernel/rules/check", json={**mine, "overrides": "kh_reply_language"})
check("check is a dry run", r.status_code == 200 and r.json()["ok"] and not R.rules(ME), r.text)
r = add({**mine, "overrides": "kh_reply_language"})
common_tags = next(x["tags"] for x in R.rules(R.COMMON) if x["slot"] == "kh_reply_language")
check("overrides: stored in the common slot with the common tags",
      r.status_code == 200 and r.json()["slot"] == "kh_reply_language" and r.json()["tags"] == common_tags, r.text)

r = add({"tier": ME, "content": "KH may take Vietnamese text from me.", "tags": ["kh_input", "lang_vietnamese"],
         "overrides": "kh_english"})
check("a locked common rule cannot be overridden", r.status_code == 409 and r.json()["error"] == "KERNEL-LOCKED", r.text)

zip_rule = {"tier": ME, "title": "Archive with 7-Zip", "content": "Packages for upload are .7z made by 7-Zip -mx=7, never .zip.",
            "tags": ["archive", "archive_obj", "upload", "package"]}
r = add(zip_rule)
check("a new idea is added in its own slot", r.status_code == 200 and r.json()["slot"].startswith("sl_"), r.text)

r = add({**mine, "content": "Answer in at most two lines.", "distinct_from": ["kh_reply_language"]})
check("distinct_from needs a reason", r.status_code == 422 and r.json()["error"] == "KERNEL-REASON", r.text)

# ── 3. tags grow through propose / approve ──────────────────────────────────
r = client.post("/kernel/tags/propose", json={"tag": "seven_zip", "facet": "object", "description": "7-Zip archives",
                                              "aliases": ["7-zip", "7z"]})
check("propose a tag", r.status_code == 200 and r.json()["status"] == "proposed", r.text)
r = add({**zip_rule, "tags": ["seven_zip", "upload"]})
check("a proposed tag cannot be used yet", r.status_code == 422 and r.json()["error"] == "KERNEL-TAGS-UNKNOWN", r.text)
client.post("/kernel/tags/approve", json={"tag": "seven_zip"})
T._CACHE["rows"] = None
r = client.post("/kernel/rules/check", json={**zip_rule, "tags": ["seven_zip", "upload", "archive"]})
check("after approve it can (dry run)", r.status_code == 200, r.text)

# ── 4. merged render ────────────────────────────────────────────────────────
proj = {"tier": "kh-investigate", "title": "Trial on local only",
        "content": "In this project every create or design request is a local trial until Rowan confirms.",
        "tags": ["simulate", "design", "plan"]}
check("a project rule is added", add(proj).status_code == 200)
text = client.get("/kernel/render", params={"personal": ME, "project": "kh-investigate", "legacy": "false"}).text
check("render keeps the locked rule 0", "(0) [HIGHEST PRIORITY] KH is English-only" in text)
check("render replaces the common reply rule by the personal one",
      "(3) LANGUAGE: rule (0); replies short and plain." not in text and "Replies decision-first" in text, text[:300])
check("render lists the new personal and project rules", "7-Zip -mx=7" in text and "local trial" in text)
plain = client.get("/kernel/render", params={"legacy": "false"}).text
check("without a person the common text stays", "(3) LANGUAGE: rule (0); replies short and plain." in plain
      and "7-Zip" not in plain)
res = client.get("/kernel/resolved", params={"personal": ME}).json()["slots"]
win = {e["slot"]: e["kind"] for e in res}
check("resolved: reply slot won by personal, rule 0 by common",
      win.get("kh_reply_language") == "personal" and win.get("kh_english") == "common", win)

whole = client.get("/kernel/render", params={"personal": ME, "legacy": "false"})
n = int(client.get("/kernel/render", params={"personal": ME, "legacy": "false", "part": 1,
                                             "max_chars": 1500}).headers["X-KH-Kernel-Parts"])
chunks = [client.get("/kernel/render", params={"personal": ME, "legacy": "false", "part": i,
                                               "max_chars": 1500}).text for i in range(1, n + 1)]
check("parts: several, none over the cap", n > 1 and all(len(c) <= 1500 for c in chunks), [len(c) for c in chunks])
check("parts: together they are the whole kernel", "\n\n".join(chunks) == whole.text)

# ── 4a. a personal rule is edited in place by its slot ──────────────────────
zip_row = next(x for x in R.rules(ME) if x["title"] == "Archive with 7-Zip")
r = add({**zip_rule, "slot": zip_row["slot"], "content": "Packages for upload are .7z made by 7-Zip -mx=9, never .zip."})
mine_now = [x for x in R.rules(ME) if x["title"] == "Archive with 7-Zip"]
check("edit by slot: same id, new text, no second copy", r.status_code == 200 and r.json()["result"] == "updated"
      and len(mine_now) == 1 and mine_now[0]["id"] == zip_row["id"] and "-mx=9" in mine_now[0]["content"], r.text)
r = add({**zip_rule, "slot": "sl_nosuchslot"})
check("edit of a slot the tier lacks: refused", r.status_code == 404 and r.json()["error"] == "KERNEL-NO-SLOT", r.text)
r = add({**mine, "slot": "kh_reply_language", "content": mine["content"] + " Keep ids exact."})
over = [x for x in R.rules(ME) if x["slot"] == "kh_reply_language"]
check("edit of an override keeps it an override", r.status_code == 200 and len(over) == 1
      and over[0]["overrides"] == "kh_reply_language" and "Keep ids exact" in over[0]["content"], r.text)
r = add({**zip_rule, "slot": zip_row["slot"], "overrides": "kh_reply_language"})
check("an own-slot rule cannot turn into an override", r.status_code == 422 and r.json()["error"] == "KERNEL-OVERRIDES",
      r.text)

# ── 4b. tool guards ride on the rule ────────────────────────────────────────
r = add({**zip_rule, "guard": {"tool": ""}})
check("guard without a tool: refused", r.status_code == 422 and r.json()["error"] == "KERNEL-GUARD", r.text)
r = add({**zip_rule, "guard": {"tool": "Artifact", "decision": "block"}})
check("guard with an unknown decision: refused", r.status_code == 422 and r.json()["error"] == "KERNEL-GUARD", r.text)
report = {"tier": ME, "title": "Reports", "content": "A report is a local standalone .html; never publish an Artifact "
          "unless that request asks for one.", "tags": ["report", "report_doc", "artifact_page", "local_folder"],
          "guard": {"tool": "Artifact", "when": {"action": ["", "publish"], "asset": ["", False]}}}
r = add(report)
check("a rule with a guard is stored, its when normalised", r.status_code == 200 and r.json()["guard"] ==
      {"tool": "Artifact", "decision": "ask", "when": {"action": ["", "publish"], "asset": ["", "false"]}}, r.text)
check("the guard reads back from the table", next(x for x in R.rules(ME) if x["title"] == "Reports")["guard"]["tool"]
      == "Artifact")
add({"tier": R.COMMON, "slot": "guard_open", "title": "Ask before sending mail", "content": "Ask before any send.",
     "tags": ["send", "message_text"], "guard": {"tool": "SendMail"}, "distinct_from": ["kh_secrets"], "reason": "test"})
add({"tier": R.COMMON, "slot": "guard_locked", "title": "Never push to prod", "locked": True,
     "content": "Never deploy to production from a session.", "tags": ["deploy", "risk_production"],
     "guard": {"tool": "Deploy", "decision": "deny"}, "distinct_from": ["kh_work_mode"], "reason": "test"})
add({**proj, "title": "Project deploy guard", "content": "Ask before deploying this project.",
     "tags": ["deploy", "ask"], "guard": {"tool": "Artifact", "decision": "deny"}, "distinct_from": ["guard_locked", "kh_work_mode"],
     "reason": "test"})
member = auth.Principal(email="rowan.hoang@laidon.com", role="member",
                        projects={"kh-investigate": frozenset({"project.read"})})
kernel._who = lambda: member
g = kernel.guards_for("Artifact")
check("guards: the person's own guard, nothing for an unbound session's project",
      [(x["tier"], x["decision"]) for x in g] == [(ME, "ask")], g)
g = kernel.guards_for("Artifact", "kh-investigate")
check("guards: a project they read adds its guard", sorted(x["decision"] for x in g) == ["ask", "deny"], g)
check("guards: none for a tool without one", kernel.guards_for("Bash") == [])
check("guards: a common guard reaches every person", len(kernel.guards_for("SendMail")) == 1)
r = add({"tier": "personal", "title": "Mail", "content": "Send mail freely.", "tags": ["send", "message_text"],
         "overrides": "guard_open"})
check("guards: overriding the common rule drops its guard", r.status_code == 200 and kernel.guards_for("SendMail") == [],
      r.text)
r = add({"tier": "personal", "content": "Deploy when I say.", "tags": ["deploy", "risk_production"],
         "overrides": "guard_locked"})
check("guards: a locked common guard cannot be overridden and stays",
      r.status_code == 409 and [x["decision"] for x in kernel.guards_for("Deploy")] == ["deny"], r.text)
from app import personalization                    # noqa: E402
legacy = [{"id": "vec_legacy", "text": "old row", "decision": "ask", "when": {}}]
personalization.guards_for = lambda tool: legacy if tool == "Artifact" else []
both = personalization.all_guards("Artifact")
check("/personalization/guards: kernel guards first, then legacy rows",
      [x["id"] for x in both][-1] == "vec_legacy" and len(both) == 2, both)
kernel._who = lambda: None

# ── 5. who may write which tier ─────────────────────────────────────────────
member = auth.Principal(email="rowan.hoang@laidon.com", role="member",
                        projects={"kh-investigate": frozenset({"project.read"})})
kernel._who = lambda: member
r = add({**zip_rule, "tier": R.COMMON, "slot": "zip"})
check("a member cannot write the common tier", r.status_code == 403, r.text)
r = add({**zip_rule, "tier": OTHER})
check("nor someone else's personal tier", r.status_code == 403, r.text)
r = add({**proj, "title": "x"})
check("nor a project they only read", r.status_code == 403, r.text)
r = add({**zip_rule, "tier": "personal", "content": "Packages are .7z, -mx=7."})
check("'personal' means their own", r.status_code == 200 and r.json()["tier"] == ME, r.text)
kernel._who = lambda: None

# ── 6. usage across sessions ────────────────────────────────────────────────
class FakeVS:
    """Three days, one person, a new session each day, signing in to the same web app."""
    LOGS = [("l1", "2026-10-26T08:00:00Z", "s-a", "Signed in to the Workbeats web app with get_session and logged 1h."),
            ("l2", "2026-10-27T08:10:00Z", "s-b", "Signed in to the Workbeats web app again to log time."),
            ("l3", "2026-10-28T08:05:00Z", "s-c", "Signed in to the Workbeats web app with get_session."),
            ("l4", "2026-10-28T09:00:00Z", "s-c", "Deployed the KH service to BTP with push.ps1.")]

    @staticmethod
    def field_values_vt(field, where=None, collection=None):
        return [(i, ts) for i, ts, _, _ in FakeVS.LOGS]

    @staticmethod
    def get_ids_vt(ids, where=None, collection=None):
        return [{"vector_id": i, "source_text": t, "metadata": {"author": "rowan.hoang@laidon.com", "actor": a, "ts": ts}}
                for i, ts, a, t in FakeVS.LOGS if i in ids]


from app import vector_store as vs                # noqa: E402
vs.field_values_vt, vs.get_ids_vt = FakeVS.field_values_vt, FakeVS.get_ids_vt
lanes = lambda pid: [("coll", None)]               # noqa: E731
check("key of a sign-in log", usage.key_of(FakeVS.LOGS[0][3]) == "sign_in/app", usage.key_of(FakeVS.LOGS[0][3]))
today = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
usage.learn_recent(3, ["kh-investigate"], lanes, today=today)
usage.learn_recent(3, ["kh-investigate"], lanes, today=today)        # a rerun counts nothing twice
reps = usage.repeats(ME, today=today)
check("a step on 3 days in 3 sessions is a repeat",
      reps and reps[0]["key"] == "sign_in/app" and reps[0]["days"] == 3 and reps[0]["total"] == 3, reps)
check("a one-day step is not", all(k["key"] != "deploy/service" for k in reps), reps)
check("words in every log ('tested', 'checked') are not counted",
      usage.key_of("Tested the fix and checked the file, then read the notes.") is None)
usage.caller = lambda: ME
usage.repeats = (lambda real: lambda person, *a, **k: real(person, today=today))(usage.repeats)
check("turn context: a message about the repeated step gets the line",
      len(usage.turn_lines("Sign in to the Workbeats web app again")) == 1)
check("turn context: the same step asked in Vietnamese too",
      len(usage.turn_lines("đăng nhập Workbeats web app giúp tôi")) == 1)
check("turn context: an unrelated message gets none", usage.turn_lines("Review the kernel tags branch") == [])

print("\n%d checks, %d failed" % (CHECKS, len(FAILED)))
sys.exit(1 if FAILED else 0)
