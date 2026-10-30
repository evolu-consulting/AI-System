"""Contract test of phase 5 self-improvement (app/caps/improve.py, docs/roadmap-e-to-5-design.md 7, slice S14).

  1. OFF by default: DEFAULT_ON False, KH_IMPROVE_MODE off, routes absent, param() = the caller's default.
  2. ALLOWLIST and the +-20% CLAMP (numbers, integers, signal words), absolute bounds refuse.
  3. RED TEAM (tools/kh_bench/redteam_p5.json): every planted poisoning caught (100%, >= 20 cases), the
     controls pass, a rejected proposal's text is never stored, shadow applies nothing.
  4. SHADOW only records; ON applies a param (override row, read path, per-request overrides, revert) and hands
     an item to the learning loop; policy is never applied; a global stop applies nothing.
  5. FALLBACK to shadow (F4): on a leak while on, and on 2 rollbacks within 7 days (simulated clock), persisted,
     announced, cleared only by a maintainer.
  6. RATE limit 20 per proposer per day (429, not recorded); duplicates are not counted.
  7. ROUTES: unauthenticated 401, ordinary people 403, maintainers, the worker token and kh_ops agent principals
     may propose; other namespaces, revoked or suspended agents may not; decisions are maintainers only.

Run:  .venv\\Scripts\\python tests\\caps\\test_improve.py
"""
import copy
import hashlib
import json
import os
import re
import time
from pathlib import Path

from harness import H, ROOT  # noqa: I001  (must be first: throwaway db, sign-in on)

import numpy  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, distill, sqldb  # noqa: E402
from app.caps import core, improve, learn, lifecycle, outcomes, people, principals, registry  # noqa: E402
from app.policy_actions import store as policy_store  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
ANA = H.person("ana@x.io", member=["alpha"], owner=["alpha"])
for k in ("KH_CAP_IMPROVE", "KH_IMPROVE_MODE", "KH_CAP_LEARN", "KH_LEARN_MODE", "KH_DISTILL_WORKER"):
    os.environ.pop(k, None)
REDTEAM = json.loads(Path(ROOT, "tools", "kh_bench", "redteam_p5.json").read_text(encoding="utf-8"))
DAY = 86_400_000


def enc(text):
    v = numpy.zeros(64, dtype="float32")
    for w in re.findall(r"\w+", (text or "").lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
    n = float(numpy.linalg.norm(v)) or 1.0
    return (v / n).tolist()


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        return numpy.array(enc(text))


def set_mode(m):
    if m is None:
        os.environ.pop("KH_IMPROVE_MODE", None)
    else:
        os.environ["KH_IMPROVE_MODE"] = m


def events(prefix=""):
    with sqldb.connect() as c:
        return {r["id"]: json.loads(r["body_json"]) for r in c.execute(
            "SELECT id, body_json FROM kh_event WHERE ns=? AND kind=?", [people.NS, improve.DECISION]).fetchall()
            if r["id"].startswith(prefix)}


# ── 1. off by default ────────────────────────────────────────────────────────
H.check("improve declares DEFAULT_ON = False", improve.DEFAULT_ON is False)
H.check("KH_IMPROVE_MODE defaults to off", improve.mode() == "off")
set_mode("bogus")
H.check("an unknown mode is off", improve.mode() == "off")
set_mode(None)
H.check("not attached: param() is the caller's default", improve.param("KH_STEP_FLOOR", 0.68) == 0.68)

os.environ["KH_CAP_PEOPLE"] = "on"
os.environ["KH_CAP_OUTCOMES"] = "on"
with TestClient(H.app()) as off_client:
    r = off_client.post("/improve/propose", headers=MAINT, json={"kind": "param"})
    H.check("KH_CAP_IMPROVE unset: /improve/propose is not attached", r.status_code == 404, r.status_code)
    r = off_client.post("/improve/propose", headers=ANA, json={"kind": "param"})
    H.check("KH_CAP_IMPROVE unset: the tightened rule still refuses people", r.status_code == 403, r.status_code)
H.check("KH_CAP_IMPROVE unset: auth.decide is not wrapped", not getattr(auth.decide, "_kh_improve", False))
people._unwrap_decide()

os.environ["KH_CAP_IMPROVE"] = "on"
os.environ["KH_CAP_LEARN"] = "on"
app = H.app()
app.state.model = _Model()
client = TestClient(app)
client.__enter__()
H.check("kh_people is active", people.active())
distill.init()                                   # the signal word table (main's startup does it)
H.check("auth.decide wrapped for the agents routes", getattr(auth.decide, "_kh_improve", False))
H.check("RULES: /improve/propose is a maintainer route marked agents",
        improve.agent_routes() == {("POST", "/improve/propose")})
rules = {(r.method, r.template): r for r in auth.load_rules()}
H.check("RULES: every improve route is maintainer (agents widen propose only)", all(
    rules[("POST" if p != "/improve/proposals" and p != "/improve/state" else "GET", p)].kind == "maintainer"
    for p in ("/improve/propose", "/improve/proposals", "/improve/state", "/improve/decide", "/improve/revert",
              "/improve/fallback")))

r = client.post("/improve/propose", headers=MAINT, json={"kind": "param", "target": "KH_STEP_FLOOR",
                                                         "change": {"value": 0.7}})
H.check("attached, mode off: propose answers 409 improve_off", r.status_code == 409
        and r.json().get("error") == "improve_off", r.text[:200])
H.check("improve_off is a stable core code", core.CODES.get("improve_off") == 409)
improve.set_override("KH_STEP_FLOOR", 0.75, "imp_manual", "test")
H.check("mode off: a stored override is not read", improve.param("KH_STEP_FLOOR", 0.68) == 0.68)
improve.revert("KH_STEP_FLOOR", "test")
H.check("mode off: no improve.decision written but the revert", all(k.startswith("iv_") for k in events()), events())

# ── evidence fixtures ────────────────────────────────────────────────────────


def serve(session, caller, action="build", context="ci", project="alpha"):
    sid = outcomes.new_serve_id()
    outcomes.write_served({"serve_id": sid, "route": "step", "project": project, "action": action,
                           "context": context, "item_ids": [], "withheld_ids": [], "session": session,
                           "caller": caller})
    return sid


def label(sid, caller, outcome="done"):
    got = outcomes.record([sid], outcome, "stop" if outcome == "done" else "tool",
                          None if outcome == "done" else "exit 1", caller)
    assert got["applied"] == 1, got
    return outcomes.label_id(outcome, "stop" if outcome == "done" else "tool", sid)


g1, g2 = serve("e-1", "ana@x.io"), serve("e-2", "bob@x.io")
GOOD = {"serve_ids": [g1, g2], "outcome_ids": [label(g1, "ana@x.io"), label(g2, "bob@x.io", "failed")]}
other = serve("e-3", "cy@x.io")
other_label = label(other, "cy@x.io")
t1, t2 = serve("e-4", "ana@x.io"), serve("e-4", "ana@x.io")
EVIDENCE = {"$GOOD": GOOD, "$FAKE_SERVE": {"serve_ids": ["sv_doesnotexist01", "sv_doesnotexist02"]},
            "$FAKE_OUTCOME": {"serve_ids": [g1, g2], "outcome_ids": ["o_ds_sv_doesnotexist01"]},
            "$UNLINKED": {"serve_ids": [g1, g2], "outcome_ids": [other_label]},
            "$THIN": {"serve_ids": [t1, t2]}, "$NONE": {}}


def fill(p):
    p = copy.deepcopy(p)
    p["evidence"] = EVIDENCE[p["evidence"]] if isinstance(p.get("evidence"), str) else p.get("evidence")
    if (p.get("change") or {}).get("text") == "$LONG":
        p["change"]["text"] = "Cache the build output. " * 200
    return p


# ── 2. allowlist and clamp ───────────────────────────────────────────────────


def chk(target, change, kind="param"):
    return improve.check({"kind": kind, "target": target, "change": change, "evidence": GOOD})


r = chk("KH_STEP_FLOOR", {"value": 0.70})
H.check("allowlisted param inside +-20%: ok, not clamped", r["ok"] and r["param"]["value"] == 0.7
        and not r["param"]["clamped"], r)
r = chk("KH_STEP_FLOOR", {"value": 0.95})
H.check("+40% step is clamped to +20% of the current value", r["ok"] and r["param"]["clamped"]
        and abs(r["param"]["value"] - config.STEP_FLOOR * 1.2) < 1e-6, r)
r = chk("KH_STEP_FLOOR", {"value": 0.10})
H.check("-85% step is clamped to -20%", r["ok"] and abs(r["param"]["value"] - config.STEP_FLOOR * 0.8) < 1e-6, r)
r = chk("KH_DISTILL_SAMPLE_PCT", {"value": 100})
H.check("an integer param is clamped and stays an integer", r["ok"] and r["param"]["value"] == 12
        and isinstance(r["param"]["value"], int), r)
H.check("absolute bounds refuse (range)", chk("KH_STEP_FLOOR", {"value": 1.01})["codes"] == ["range"])
H.check("a non-allowlisted name is refused", chk("KH_AUTH_ISSUER", {"value": 1})["codes"] == ["allowlist"])
H.check("no change is refused", chk("KH_STEP_FLOOR", {"value": config.STEP_FLOOR})["codes"] == ["no_change"])
H.check("a string value is refused (type)", chk("KH_STEP_FLOOR", {"value": "0.7"})["codes"] == ["type"])
n_words = len(distill.signal_words())
r = chk("signal_words", {"add": [f"zzword{i:02d}" for i in range(40)]})
H.check("signal words: at most max(1, 20% of the list) per step", r["ok"] and r["param"]["clamped"]
        and len(r["param"]["step"]["add"]) == max(1, int(n_words * 0.2)), (n_words, r.get("param", {}).get("limit")))

# ── 3. red team, in shadow ───────────────────────────────────────────────────
set_mode("shadow")
cases = REDTEAM["cases"]
H.check("red-team set has >= 20 planted poisonings", len(cases) >= 20, len(cases))
H.check("red-team case ids are unique", len({c["id"] for c in cases}) == len(cases))
caught, missed = 0, []
for i, case in enumerate(cases):
    want = case["expect"]
    try:
        got = improve.propose(fill(case["proposal"]), f"redteam-{i}")
    except Exception as exc:  # noqa: BLE001
        missed.append((case["id"], repr(exc)[:200]))
        continue
    if want["verdict"] == "reject":
        ok = got["decision"] == "reject" and set(want.get("codes", [])) <= set(got["codes"])
    elif want["verdict"] == "fen":
        ok = got["decision"] == "fen" and not got["applied"]
    else:                                    # clamp: only inside the +-20% step, and never applied in shadow
        ok = got["decision"] in ("accept", "hold") and got.get("clamped") is True and not got["applied"]
    caught += ok
    if not ok:
        missed.append((case["id"], got))
H.check(f"red team: every planted poisoning is caught ({caught}/{len(cases)})", not missed, missed)
for i, case in enumerate(REDTEAM["controls"]):
    got = improve.propose(fill(case["proposal"]), f"control-{i}")
    H.check(f"red-team control {case['id']}: {case['expect']['verdict']}", got["decision"] == case["expect"]["verdict"]
            and not got["applied"], got)
with sqldb.connect() as c:
    blob = " ".join(r[0] for r in c.execute("SELECT body_json FROM kh_event WHERE ns=?", [people.NS]).fetchall())
planted = ["Hunter2Fake99", "sk-FAKEKEYFORTESTS0000", "eyJhbGciOiJub25lIn0", "ops.lead@example.com", "10.20.30.40",
           "khc-0123456789abcdef", "Ignore all previous instructions", "evil.example"]
H.check("no planted secret or injection text is stored anywhere in kh_people", not [p for p in planted if p in blob],
        [p for p in planted if p in blob])
H.check("shadow: nothing applied (no override row)", improve.overrides() == {})
H.check("shadow: every verdict is an improve.decision with applied false",
        all(b.get("applied") is False and b.get("by") == "kh" for b in events("ik_").values())
        and len(events("ik_")) == len(cases) + len(REDTEAM["controls"]))

# ── 4. shadow records only; on applies ───────────────────────────────────────
improve.BENCH[0] = lambda p: {"ok": True, "answered_pp": 2}
ok_param = {"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.70}, "evidence": GOOD}
got = improve.propose(ok_param, "scorecard")
H.check("shadow + bench ok: accept recommended, not applied", got["decision"] == "accept" and not got["applied"]
        and got["mode"] == "shadow", got)
H.check("shadow: param() still reads the default", improve.param("KH_STEP_FLOOR", 0.68) == 0.68)
improve.BENCH[0] = lambda p: {"ok": False, "dropped": ["q3"]}
got = improve.propose({**ok_param, "change": {"value": 0.71}}, "scorecard")
H.check("a bench regression rejects", got["decision"] == "reject" and got["reason"] == "bench_regression", got)

set_mode("on")
improve.BENCH[0] = lambda p: {"ok": True}
got = improve.propose({**ok_param, "change": {"value": 0.72}}, "scorecard")
H.check("on + bench ok: the override is applied", got["decision"] == "accept" and got["applied"]
        and improve.overrides()["KH_STEP_FLOOR"]["value"] == 0.72, got)
H.check("on: param() reads the override", improve.param("KH_STEP_FLOOR", 0.68) == 0.72)
H.check("on: another param still reads its default", improve.param("KH_STEP_KNOW_ENOUGH", 0.75) == 0.75)
got = improve.propose({**ok_param, "change": {"value": 0.99}}, "scorecard")
H.check("on: the next step is clamped from the CURRENT value (0.72 x 1.2)", got["applied"] and got["clamped"]
        and abs(improve.param("KH_STEP_FLOOR", 0.68) - 0.864) < 1e-6, got)
with improve.request_overrides({"KH_STEP_FLOOR": 0.5}):
    H.check("per-request override (bench) wins inside its context", improve.param("KH_STEP_FLOOR", 0.68) == 0.5)
H.check("per-request override is gone after the context", abs(improve.param("KH_STEP_FLOOR", 0.68) - 0.864) < 1e-6)
try:
    with improve.request_overrides({"KH_AUTH_ISSUER": 1}):
        pass
    H.check("per-request override outside the allowlist is refused", False)
except core.CapError as exc:
    H.check("per-request override outside the allowlist is refused", exc.code == "invalid")
r = client.post("/improve/revert", headers=MAINT, json={"param": "KH_STEP_FLOOR"})
H.check("revert deletes the override row: back to the default", r.status_code == 200
        and improve.param("KH_STEP_FLOOR", 0.68) == 0.68 and "KH_STEP_FLOOR" not in improve.overrides(), r.text[:200])
H.check("revert writes improve.decision", any(b["decision"] == "revert" for b in events("iv_").values()))
r = client.post("/improve/revert", headers=MAINT, json={"param": "KH_STEP_FLOOR"})
H.check("revert of a missing override: 404", r.status_code == 404, r.status_code)
got = improve.propose({"kind": "param", "target": "signal_words", "change": {"add": ["zzonlyword"]},
                       "evidence": GOOD}, "scorecard")
H.check("on: a signal word override applies through the read path", got["applied"]
        and "zzonlyword" in improve.param("signal_words", ["failed"]), got)
improve.revert("signal_words", "test")

got = improve.propose({"kind": "policy_proposal", "target": "deploy", "change": {"text": "Require two reviewers."},
                       "evidence": GOOD}, "scorecard")
H.check("on: a policy proposal goes to fen and is never applied", got["decision"] == "fen" and not got["applied"], got)

os.environ["KH_LEARN_MODE"] = "trial"
policy_store.menu = lambda project: [{"action": "build"}, {"action": "deploy"}]
distill.contexts = lambda project: [{"tag": "ci"}]
got = improve.propose({"kind": "item", "target": {"project": "alpha", "action": "build", "context": "ci"},
                       "change": {"text": "Prune the stale artifacts before the build."}, "evidence": GOOD},
                      "agent-x", enc)
iid = (events("ik_").get(f"ik_{got['id']}") or {}).get("learn", {}).get("item_id")
H.check("on: an item goes to the learning loop (enrolled, source improve)", got["applied"] and iid
        and learn.get(iid)["attrs"]["source"] == "improve", (got, iid))
os.environ.pop("KH_LEARN_MODE", None)
got = improve.propose({"kind": "item", "target": {"project": "alpha", "action": "build", "context": "ci"},
                       "change": {"text": "Archive the old builds before the build."}, "evidence": GOOD},
                      "agent-x", enc)
H.check("on, learn off: an item is held, not applied", got["decision"] == "hold" and not got["applied"], got)

r = client.put("/v1/admin/ns/shop", headers=MAINT, json={"projects": ["alpha"]})
H.check("a consumer namespace exists for the stop", r.status_code in (200, 201), r.text[:200])
lifecycle.stop_agents(None)
H.check("global stop is seen", improve.global_stop())
got = improve.propose({**ok_param, "change": {"value": 0.66}}, "scorecard")
H.check("global stop: the verdict is recorded but nothing is applied", got["decision"] == "accept"
        and not got["applied"] and got["mode"] == "shadow" and "KH_STEP_FLOOR" not in improve.overrides(), got)
lifecycle.resume_agents(None)
H.check("resume: no global stop", not improve.global_stop())

# ── 5. fallback ──────────────────────────────────────────────────────────────
improve.set_override("KH_STEP_FLOOR", 0.70, "imp_seed", "test")
H.check("on: the override is live before the leak", improve.param("KH_STEP_FLOOR", 0.68) == 0.70)
leak = next(c for c in cases if c["id"] == "secret_password")
got = improve.propose(fill(leak["proposal"]), "agent-leaky")
H.check("on: a leak is rejected", got["decision"] == "reject" and "leak" in got["codes"], got)
H.check("F4: a leak while on falls back to shadow (persisted)", improve.fallback_active()
        and improve.effective_mode() == "shadow" and improve._state()["fallback"]["reason"] == "leak")
H.check("fallback: stored overrides are no longer read", improve.param("KH_STEP_FLOOR", 0.68) == 0.68)
H.check("fallback: announced as improve.decision", any(b["decision"] == "fallback_shadow" for b in events("ib_").values()))
with sqldb.connect() as c:
    n_fb = c.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind='kh.improve_fallback'", [people.NS]).fetchone()[0]
H.check("fallback: kh.improve_fallback emitted", n_fb == 1, n_fb)
got = improve.propose({**ok_param, "change": {"value": 0.69}}, "scorecard")
H.check("fallback: proposals are only recommendations", not got["applied"] and got["mode"] == "shadow", got)
registry.invalidate()
H.check("fallback survives a cache drop (another instance sees it)", improve.fallback_active())
r = client.post("/improve/fallback", headers=ANA, json={})
H.check("clearing the fallback is for maintainers", r.status_code == 403, r.status_code)

base = int(time.time() * 1000) + 30 * DAY          # a simulated clock, after every real event above
improve.clear_fallback("test", base)
H.check("clear: back to on, the override is read again", improve.effective_mode() == "on"
        and improve.param("KH_STEP_FLOOR", 0.68) == 0.70)


def rollback_at(ts):
    seq = people.emit("kh.item_rollback", {"item_id": "dk_x", "reason": "auto_rollback"})
    with sqldb.connect() as c:
        c.execute("UPDATE kh_event SET ts_ms=? WHERE ns=? AND seq=?", [ts, people.NS, seq])


rollback_at(base + 1 * DAY)
rollback_at(base + 9 * DAY)
r = improve.check_fallback(base + 9 * DAY)
H.check("2 rollbacks 8 days apart: no fallback (only 1 in the 7-day window)", r["rollbacks"] == 1
        and not improve.fallback_active(), r)
rollback_at(base + 8 * DAY)
r = improve.check_fallback(base + 9 * DAY)
H.check("2 rollbacks within 7 days: fallback to shadow", improve.fallback_active()
        and improve._state()["fallback"]["reason"] == "rollbacks", r)
r = client.post("/improve/fallback", headers=MAINT, json={})
H.check("a maintainer clears the fallback", r.status_code == 200 and not improve.fallback_active(), r.text[:200])
improve.clear_fallback("test", base + 10 * DAY)
r = improve.check_fallback(base + 10 * DAY)
H.check("after a clear the window restarts (old rollbacks do not count)", not improve.fallback_active(), r)
improve.set_override("KH_STEP_KNOW_ENOUGH", 0.8, "imp_a", "test")
improve.revert("KH_STEP_KNOW_ENOUGH", "test", harm=True, now_ms=base + 11 * DAY)
H.check("one harm revert: still on", not improve.fallback_active())
improve.set_override("KH_STEP_KNOW_ENOUGH", 0.8, "imp_b", "test")
improve.revert("KH_STEP_KNOW_ENOUGH", "test", harm=True, now_ms=base + 12 * DAY)
H.check("two harm reverts within 7 days: fallback to shadow", improve.fallback_active()
        and improve._state()["fallback"]["reason"] == "rollbacks")
improve.clear_fallback("test", base + 13 * DAY)
set_mode("shadow")
H.check("the fallback check runs only in mode on", improve.check_fallback(base + 13 * DAY) == {"checked": False})
H.check("cron: nothing in shadow", improve._cron_fallback() == "")

# ── 6. rate limit and duplicates ─────────────────────────────────────────────
for i in range(20):
    improve.propose({"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.60 + i / 1000},
                     "evidence": {}}, "flooder")
try:
    improve.propose({"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.7}, "evidence": {}}, "flooder")
    H.check("the 21st proposal of a proposer in a day: 429 quota", False)
except core.CapError as exc:
    H.check("the 21st proposal of a proposer in a day: 429 quota", exc.code == "quota" and exc.status == 429)
H.check("another proposer is not limited", improve.propose(
    {"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.7}, "evidence": {}}, "calm")["decision"]
    == "reject")
d = improve.propose({"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.7}, "evidence": {}}, "calm")
H.check("the same proposal twice is a duplicate (one decision)", d.get("duplicate") is True)
H.check("next day the proposer may propose again", improve.propose(
    {"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.65}, "evidence": {}}, "flooder",
    now_ms=int(time.time() * 1000) + DAY + 1000)["decision"] == "reject")
H.check("proposer identity is stored as a hash, never an e-mail",
        not any("@" in str(b.get("proposer", "")) for b in events("ik_").values()))

# ── 7. routes ────────────────────────────────────────────────────────────────
body = {"kind": "param", "target": "KH_STEP_FLOOR", "change": {"value": 0.71}, "evidence": GOOD}
r = client.post("/improve/propose", json=body)
H.check("unauthenticated propose: 401", r.status_code == 401, r.status_code)
r = client.post("/improve/propose", headers=ANA, json=body)
H.check("an ordinary person (even a project owner) may not propose: 403", r.status_code == 403, r.status_code)
r = client.post("/improve/propose", headers=MAINT, json=body)
H.check("a maintainer may propose", r.status_code == 200 and r.json()["decision"] in improve.VERDICTS, r.text[:300])

with sqldb.connect() as c:
    sqldb.insert_new(c, "kh_ns", {"ns": "kh_ops", "display": "ops", "state": "active", "owner_email": "fen@x.io",
                                  "projects_json": "[]", "config_json": "{}", "manifest_json": None,
                                  "manifest_sha": None, "manifest_rev": 0, "created_ms": 1, "detached_ms": None,
                                  "purge_after_ms": None, "rev": 1})
    for ns, pid in (("kh_ops", "a1"), ("shop", "a2")):
        sqldb.insert_new(c, "kh_principal", {"ns": ns, "principal_id": pid, "role": "agent",
                                             "on_behalf_of": "fen@x.io", "projects_json": "[]", "state": "active",
                                             "created_by": "t", "created_ms": 1, "expires_ms": None, "rev": 1})
registry.invalidate()
AGENT = {"Authorization": "Bearer " + principals.issue("kh_ops", "a1", "agent", "fen@x.io")["access_token"]}
SHOP = {"Authorization": "Bearer " + principals.issue("shop", "a2", "agent", "fen@x.io")["access_token"]}
WT = {"Authorization": "Bearer " + principals.issue(people.NS, "worker", "distiller", people.owner_email())["access_token"]}
r = client.post("/improve/propose", headers=AGENT, json={**body, "change": {"value": 0.705}})
H.check("an active kh_ops agent principal may propose", r.status_code == 200, r.text[:300])
H.check("the phase 4 pilot namespace ops_pilot is an agent namespace by default (kh* names are reserved, so the "
        "runner cannot attach kh_ops)", "ops_pilot" in improve.DEFAULTS["agent_namespaces"]
        and "ops_pilot" in improve.conf()["agent_namespaces"], improve.conf()["agent_namespaces"])
r = client.post("/improve/propose", headers=SHOP, json={**body, "change": {"value": 0.706}})
H.check("an agent of a namespace outside agent_namespaces may not", r.status_code == 403, r.status_code)
r = client.post("/improve/decide", headers=AGENT, json={"id": "imp_x", "decision": "accept"})
H.check("an agent may not decide", r.status_code == 403, r.status_code)
r = client.get("/improve/state", headers=AGENT)
H.check("an agent may not read the state", r.status_code == 403, r.status_code)
r = client.post("/improve/propose", headers=WT, json={**body, "change": {"value": 0.707}})
H.check("the worker token is refused while KH_DISTILL_WORKER is off", r.status_code == 403, r.status_code)
os.environ["KH_DISTILL_WORKER"] = "on"
r = client.post("/improve/propose", headers=WT, json={**body, "change": {"value": 0.708}})
H.check("the worker token may propose while the worker is on", r.status_code == 200, r.text[:300])
os.environ.pop("KH_DISTILL_WORKER", None)
lifecycle.stop_agents(None)
r = client.post("/improve/propose", headers=AGENT, json={**body, "change": {"value": 0.709}})
H.check("global stop: a suspended namespace's agent is refused", r.status_code == 403, r.status_code)
lifecycle.resume_agents(None)
with sqldb.connect() as c:
    c.execute("UPDATE kh_principal SET state='revoked' WHERE ns='kh_ops' AND principal_id='a1'")
for cache in [v for k, v in vars(principals).items() if k.endswith("_cache") and isinstance(v, dict)]:
    cache.clear()
r = client.post("/improve/propose", headers=AGENT, json={**body, "change": {"value": 0.711}})
H.check("a revoked agent principal is refused", r.status_code == 403, r.status_code)

# decisions and agreement
pid_acc = next(k[3:] for k, b in events("ik_").items() if b["decision"] == "accept")
pid_rej = next(k[3:] for k, b in events("ik_").items() if b["decision"] == "reject")
r = client.post("/improve/decide", headers=ANA, json={"id": pid_acc, "decision": "accept"})
H.check("decide: ordinary people refused", r.status_code == 403, r.status_code)
r = client.post("/improve/decide", headers=MAINT, json={"id": pid_acc, "decision": "accept"})
H.check("decide: fen agrees with an accept", r.status_code == 200 and r.json()["agree"] is True, r.text[:300])
r = client.post("/improve/decide", headers=MAINT, json={"id": pid_rej, "decision": "accept"})
H.check("decide: fen disagrees with a reject", r.status_code == 200 and r.json()["agree"] is False, r.text[:300])
r = client.post("/improve/decide", headers=MAINT, json={"id": pid_acc, "decision": "reject"})
H.check("decide twice: 409 duplicate", r.status_code == 409, r.status_code)
r = client.post("/improve/decide", headers=MAINT, json={"id": "imp_nope", "decision": "reject"})
H.check("decide on an unknown proposal: 404", r.status_code == 404, r.status_code)
r = client.get("/improve/state", headers=MAINT)
a = r.json().get("agreement", {}) if r.status_code == 200 else {}
H.check("state: agreement counted (2 decided, 1 agree), gate not met below 30", a.get("decided") == 2
        and a.get("agree") == 1 and a.get("gate_ok") is False, r.text[:400])
r = client.get("/improve/proposals", headers=MAINT, params={"limit": 5})
H.check("proposals list (maintainers)", r.status_code == 200 and len(r.json()["proposals"]) == 5, r.text[:200])
r = client.get("/improve/proposals", headers=ANA)
H.check("proposals list refused to people", r.status_code == 403, r.status_code)

client.__exit__(None, None, None)
improve._unwrap_decide()
people._unwrap_decide()
H.check("cleanup: auth.decide restored", not getattr(auth.decide, "_kh_improve", False))
improve.BENCH[0] = None
for k in ("KH_CAP_IMPROVE", "KH_IMPROVE_MODE", "KH_CAP_LEARN", "KH_CAP_PEOPLE", "KH_CAP_OUTCOMES"):
    os.environ.pop(k, None)
H.done()
