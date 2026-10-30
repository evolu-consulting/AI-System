"""Tests for slice S4: tools/kh_bench/scripts/errkind.py and replay.py (design section 8).

WHAT IS UNDER TEST
  1. LABEL PRECISION. errkind labels a hand-labelled sample of worklog texts (written for this test, in
     the style of real KH worklogs, English and folded Vietnamese, including the traps: 'no errors',
     '0 failed', hypothetical failures, 'always/never' plans). Outcome precision per label must be
     >= 0.85, the gate of 5.9; error-class precision is measured and held to the same bar.
  2. STABLE KINDS. The same error told in other words gets one class kind; the per-line kind strips
     digits, paths, ids and hex.
  3. REPLAY. A fixture history (NDJSON, no network) with known repeats, sessions and items: baseline per
     month, the G7 target, preventable share, days to 30 per arm, the evidence rule and the pipeline checks.
     The KH source path is driven with a fake /vector/scroll caller, so nothing touches prod or dev.

Run from the repo root:
    .venv\\Scripts\\python -m pytest tests\\test_replay.py -q      (or run this file directly)
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "kh_bench", "scripts"))

import errkind  # noqa: E402
import replay  # noqa: E402

# ── 1. the labelled sample: (text, gold outcome, gold error class or None) ───────────────────────

SAMPLE = [
    # done, including traps that mention failure words without a failure
    ("Added the /daily/next route and its tests; all 42 tests passed, 0 failed.", "done", None),
    ("Refactored the retriever ranking. No errors in the full suite.", "done", None),
    ("Deployed kh-sso to dev; smoke test green, without any error.", "done", None),
    ("Wrote the error handling for the outbox so a retry is idempotent.", "done", None),
    ("Documented how to rotate the Keycloak client secret.", "done", None),
    ("Plan: always run the tier-1 bench before a flag flip, never on prod.", "done", None),
    ("Added a timeout parameter to the worker client; default 30 s.", "done", None),
    ("Reviewed the distil design with fen; agreed on the cap numbers.", "done", None),
    ("Merged the stage F branch after the review.", "done", None),
    ("Cap quyen cho Gina tren du an ticketing; khong co loi.", "done", None),
    ("Seeded the docker dev with 3 projects, rows copied 4120.", "done", None),
    ("Set up the cron so that if it fails it retries next hour.", "done", None),
    ("Wrote tests to prevent regressions in the turn context.", "done", None),
    ("Updated the changelog and the README for stage F.", "done", None),
    ("Measured p95 of /context/step: 180 ms flag off, 186 ms flag on.", "done", None),
    ("Added the leak set with 52 planted strings across 30 logs.", "done", None),
    ("Cleaned old chunk sidecars, error count: 0.", "done", None),
    ("Renamed the bench projects per khbench.RENAMES.", "done", None),
    ("Built the worker image and pushed it to the registry.", "done", None),
    ("Checked the hot log window eviction; spill copies before delete.", "done", None),
    # failed, by class
    ("cf push kh-sso failed: staging failed, out of memory during buildpack.", "failed", "resource"),
    ("POST /vector/add returned 401 Unauthorized, token expired mid-copy.", "failed", "auth"),
    ("Login failed against Keycloak: invalid_grant after the refresh.", "failed", "auth"),
    ("GET /projects answered 403 Forbidden for the bench account.", "failed", "permission"),
    ("Traceback (most recent call last):\n  File \"app/step.py\", line 88\nKeyError: 'context'", "failed", "code"),
    ("The turn hook crashed with AttributeError: 'NoneType' object has no attribute 'get'.", "failed", "code"),
    ("ModuleNotFoundError: No module named 'hdbcli' in the worker container.", "failed", "dependency"),
    ("pip install failed: version conflict between numpy and chromadb.", "failed", "dependency"),
    ("Request to HANA Cloud timed out after 60 s.", "failed", "network"),
    ("Connection refused on 127.0.0.1:9101, the dev container was down.", "failed", "network"),
    ("HANA error: unique constraint violated on DISTILL_CURSOR.", "failed", "database"),
    ("sqlite3.OperationalError: no such table: kh_item", "failed", "database"),
    ("UnicodeDecodeError: 'charmap' codec can't decode byte 0x9d in the Vietnamese log.", "failed", "encoding"),
    ("git push rejected: non-fast-forward on kh-stage-f.", "failed", "git"),
    ("Merge conflict in app/distill.py while rebasing on main.", "failed", "git"),
    ("tests/test_hotlog.py failed: AssertionError expected 5 rows got 4.", "failed", "test"),
    ("3 tests failed in test_policy_actions after the rename.", "failed", "test"),
    ("Anthropic API answered 429 rate limit exceeded during the backfill.", "failed", "rate_limit"),
    ("Docker build failed at the requirements layer.", "failed", "dependency"),
    ("KH_DISTILL_WORKER env var not set, the worker refused to start.", "failed", "config"),
    ("FileNotFoundError: no such file tasks_p1.json.", "failed", "not_found"),
    ("GET /v1/kh_ops/records answered 404 not found.", "failed", "not_found"),
    ("JSONDecodeError while parsing the distil batch: malformed output.", "failed", "data"),
    ("Deploy of kh-worker failed: the container crashed on start.", "failed", "build_deploy"),
    ("Loi ket noi HANA: connection reset by peer.", "failed", "network"),
    ("The embedding job broke with RuntimeError: CUDA unavailable.", "failed", "code"),
    ("Request to the dev KH gave 502 Bad Gateway twice.", "failed", "network"),
    ("ValueError: invalid literal for int() in the budget parser.", "failed", "code"),
    # corrected
    ("fen corrected me: the cap is per month, not per run; changed the default.", "corrected", None),
    ("User pointed out the summary used the wrong project; redid it for ticketing.", "corrected", None),
    ("My mistake: I had edited the prod manifest; reverted at the user's request.", "corrected", None),
    ("Correction: the bench must use tasks.json after RENAMES, not the raw names.", "corrected", None),
    ("I was wrong about the lease epoch; the reviewer asked me to redo the fencing.", "corrected", None),
    ("Anh noi sai roi, em da lam sai cho cau hinh, sua lai theo y anh.", "corrected", None),
    ("The owner did not want the hook changed globally; moved it to the project.", "corrected", None),
    ("Misunderstood the ask: it was the daily summary, not the weekly; redone.", "corrected", None),
]


def test_sample_is_big_enough():
    assert len(SAMPLE) >= 50
    assert {g for _, g, _ in SAMPLE} == set(errkind.OUTCOMES)


def test_outcome_label_precision():
    m = errkind.measure([(errkind.outcome(t), g) for t, g, _ in SAMPLE])
    bad = [(t, errkind.outcome(t), g) for t, g, _ in SAMPLE if errkind.outcome(t) != g]
    for lab, v in m["per_label"].items():
        assert v["precision"] >= 0.85, (lab, v, bad)
        assert v["recall"] >= 0.85, (lab, v, bad)
    assert m["accuracy"] >= 0.85, bad


def test_error_class_precision():
    pairs = [(errkind.classify_error(t)[0], c) for t, g, c in SAMPLE if g == "failed"]
    m = errkind.measure(pairs)
    bad = [(t, errkind.classify_error(t)[0], c) for t, g, c in SAMPLE if g == "failed"
           and errkind.classify_error(t)[0] != c]
    assert m["accuracy"] >= 0.85, bad
    assert "other" not in m["per_label"] or m["per_label"]["other"]["predicted"] == 0, bad


def test_done_steps_have_no_kind():
    for t, g, _ in SAMPLE:
        if g == "done":
            assert errkind.classify(t)["kind"] == "", t


# ── 2. stable kinds ──────────────────────────────────────────────────────────

def test_same_error_other_words_one_kind():
    groups = [
        ["POST /vector/add returned 401 Unauthorized.", "Got HTTP 401 unauthorized from /vector/scroll again.",
         "401 Unauthorized when the copy ran past the token lifetime."],
        ["KeyError: 'context'", "KeyError: 'project' raised in the turn hook",
         "Traceback (most recent call last):\n  File \"x.py\", line 3\nKeyError: 'k'"],
        ["Request to HANA Cloud timed out after 60 s.", "HANA timeout again, 120 s this time.",
         "the HANA query timed out"],
    ]
    for g in groups:
        kinds = {errkind.classify(t, "p", "worklog", "deploy")["kind"] for t in g}
        assert len(kinds) == 1, (g, [errkind.classify_error(t) for t in g])
    a = errkind.classify(groups[0][0], "p", "worklog", "deploy")["kind"]
    b = errkind.classify(groups[1][0], "p", "worklog", "deploy")["kind"]
    assert a != b
    # the kind is per key: another context is another kind
    assert errkind.classify(groups[0][0], "p", "worklog", "auth")["kind"] != a


def test_line_kind_strips_what_varies():
    a = errkind.error_kind("p", "a", "c", r"FileNotFoundError: C:\Users\x\run\4411.json missing 0x7ffe12ab")
    b = errkind.error_kind("p", "a", "c", r"FileNotFoundError: D:\tmp\other\9.json missing 0x0000aa99")
    assert a == b and len(a) == 12
    assert errkind.normalise("user bob@corp.com id 3f2b1c4d-1111-2222-3333-444455556666 at https://x.y/z") == \
        "user <email> id <id> at <url>"


def test_deterministic():
    for t, _, _ in SAMPLE:
        assert errkind.classify(t, "p") == errkind.classify(t, "p")


# ── 3. replay on a fixture history ───────────────────────────────────────────

UNTIL = datetime(2026, 10, 1, tzinfo=timezone.utc)


def _iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def fixture_rows():
    """120 days before UNTIL. Project 'kh', topic 'deploy': one log per day by alice, and every 10th day
    the same 401 in other words (a repeat after the first one). Topic 'docs': a log every 3rd day by bob,
    all done. One distilled item on (kh, deploy) appears at day 60. Plus noise rows replay must skip."""
    rows, start = [], UNTIL - timedelta(days=120)
    for d in range(120):
        ts = start + timedelta(days=d, hours=9)
        if d % 10 == 0:
            text = [f"cf push failed: 401 Unauthorized from the UAA (try {d}).",
                    f"Deploy step got HTTP 401 unauthorized, attempt {d}."][d % 20 == 0]
        else:
            text = f"Deployed build {d} to dev, smoke tests passed, 0 failed."
        rows.append({"vector_id": f"log-a-{d}", "source_text": text,
                     "metadata": {"scope": "log", "project": "kh", "topic": "deploy", "author": "alice",
                                  "ts": _iso(ts)}})
        if d % 3 == 0:
            rows.append({"id": f"log-b-{d}", "text": f"Updated the docs page {d}.", "scope": "log",
                         "project": "kh", "topic": "docs", "author": "bob", "ts": _iso(ts + timedelta(hours=2))})
    # bob hits the same 401 on deploy once, in his own session: independent evidence for the kind
    rows.append({"id": "log-b-401", "text": "cf push failed with 401 Unauthorized.", "scope": "log",
                 "project": "kh", "topic": "deploy", "author": "bob",
                 "ts": _iso(start + timedelta(days=95, hours=15))})
    rows.append({"id": "dk_1", "text": "Refresh the cf login before a push.",
                 "metadata": {"scope": "knowledge", "project": "kh", "dkey": "k1", "kind": "lesson",
                              "action": "worklog", "context": "deploy", "status": "active",
                              "first_seen": _iso(start + timedelta(days=60))}})
    rows.append({"id": "chunk-1", "text": "part", "metadata": {"scope": "log", "project": "kh",
                                                                "chunk_of": "log-a-1", "ts": _iso(start)}})
    rows.append({"id": "nots", "text": "no time", "metadata": {"scope": "log", "project": "kh"}})
    return rows


def _report(rows=None, audit=None):
    return replay.run(rows or fixture_rows(), "fixture", replay.parse_ts(_iso(UNTIL)), audit)


def test_reconstruct_and_input_checks():
    r = _report()
    i = r["input"]
    assert i["chunk_rows_skipped"] == 1 and i["log_rows_without_ts"] == 1 and i["items"] == 1
    assert i["steps"] == 120 + 40 + 1
    assert r["labels"]["outcomes"] == {"done": 108 + 40, "failed": 13}


def test_baseline_months_and_g7_target():
    b = _report()["baseline"]
    # window = last 90 days = fixture days 30..119; failures on days 30,40,...,110 (9) + bob's day 95: all repeats
    assert b["eligible_steps"] == 90 + 30 + 1
    assert b["repeats"] == 10
    assert b["rate_per_100"] == round(100 * 10 / 121, 2)
    assert b["g7_target_rate_per_100"] == round(b["rate_per_100"] / 2, 2)
    assert [m["repeats"] for m in b["months"]] == [3, 3, 4]
    assert [m["eligible_steps"] for m in b["months"]] == [40, 40, 41]
    top = b["per_key"][0]
    assert top["key"] == "kh/worklog/deploy" and top["repeats"] == 10
    assert list(b["per_error_class"]) == ["auth"]


def test_stability_preventable_power():
    r = _report()
    st = r["stability"]
    assert st["class_kinds"] == 1 and st["singleton_share_class_kind"] == 0.0 and st["pass"]
    assert st["line_kinds"] >= 2       # three wordings, so the per-line kind splits them
    pv = r["preventable"]
    # all-history repeats: days 10..110 by alice (11) + bob's; the item exists from day 60: days 60..110 + bob
    assert pv["repeats"] == 12 and pv["with_item_same_key"] == 7
    p = r["power"]
    dep = next(k for k in p["per_key"] if k["key"] == "kh/worklog/deploy")
    # 91 sessions in 90 days (alice daily + bob once) -> 60 sessions in ceil(60 / (91/90)) = 60 days
    assert dep["sessions"] == 91 and dep["days_to_30_per_arm"] == 60 and not dep["reachable"]
    docs = next(k for k in p["per_key"] if k["key"] == "kh/worklog/docs")
    assert docs["days_to_30_per_arm"] == 180
    assert set(p["left_out_of_g7"]) == {"kh/worklog/deploy", "kh/worklog/docs"}
    assert p["all_sessions"] == 121 and p["days_to_30_per_arm_any_key"] == 45   # ceil(60 / (121/90))


def test_candidates_and_pipeline():
    r = _report()
    c = r["lesson_candidates"]
    assert c["total"] == 1 and c["evidence_ok"] == 1
    assert c["top"][0]["error_cls"] == "auth" and c["top"][0]["sessions"] == 13
    pl = r["pipeline"]
    failed = [x for x in pl["checks"] if not x["ok"]]
    assert failed == [{"check": "log rows with a ts", "ok": False, "detail": 1}], failed
    assert "S11" in pl["not_run_here"][0]
    assert "randomized" in r["cannot_prove"]


def test_single_author_has_no_independent_evidence():
    rows = [x for x in fixture_rows() if x.get("id") != "log-b-401"]
    assert _report(rows)["lesson_candidates"]["evidence_ok"] == 0


def test_audit_precision_gate():
    rows = fixture_rows()
    steps, _, _ = replay.steps_from([replay.norm_row(x) for x in rows])
    audit = {s["id"]: {"outcome": s["outcome"], "error_cls": s["error_cls"] or "none"} for s in steps[:100]}
    a = _report(rows, audit)["labels"]["audit"]
    assert a["outcome"]["n"] == 100 and a["gate"]["pass"]
    # 20 wrong audits out of 100: below 0.85
    for k in list(audit)[:20]:
        audit[k] = {"outcome": "corrected"}
    assert not _report(rows, audit)["labels"]["audit"]["gate"]["pass"]


def test_report_does_not_leak():
    rows = fixture_rows()
    rows.append({"id": "leak", "text": "Login failed for bob@corp.example from 10.1.2.3 with 401 Unauthorized.",
                 "scope": "log", "project": "kh", "topic": "deploy", "author": "x",
                 "ts": _iso(UNTIL - timedelta(days=1))})
    r = _report(rows)
    txt = json.dumps(r)
    assert "bob@corp.example" not in txt and "10.1.2.3" not in txt
    assert next(x for x in r["pipeline"]["checks"] if x["check"].startswith("report holds"))["ok"]


def test_fetch_pages_with_scroll_only():
    rows = fixture_rows()
    calls = []

    def fake(method, path, body):
        calls.append((method, path, body["scope"], body["offset"]))
        assert (method, path) == ("POST", "/vector/scroll")
        hits = []
        for x in rows:
            n = replay.norm_row(x)
            if n["scope"] == body["scope"] and n["project"] == body["project"]:
                hits.append({"vector_id": n["id"], "source_text": n["text"],
                             "metadata": {k: v for k, v in n["meta"].items() if k not in ("scope", "project")}})
        return {"hits": hits[body["offset"]:body["offset"] + body["limit"]]}
    got = replay.fetch(fake, ["kh"])
    assert {c[2] for c in calls} == {"log", "knowledge"}
    assert len(got) == len(rows)
    assert replay.run(got, "fake")["input"]["steps"] == 161


def test_cli_on_ndjson():
    tmp = tempfile.mkdtemp(prefix="kh_replay_")
    src, out = os.path.join(tmp, "dump.ndjson"), os.path.join(tmp, "report.json")
    with open(src, "w", encoding="utf-8") as f:
        for x in fixture_rows():
            f.write(json.dumps(x) + "\n")
    audit = os.path.join(tmp, "audit.ndjson")
    with open(audit, "w", encoding="utf-8") as f:
        f.write(json.dumps({"id": "log-a-10", "outcome": "failed", "error_cls": "auth"}) + "\n")
        f.write(json.dumps({"id": "log-a-11", "outcome": "done"}) + "\n")
    r = replay.main(["--ndjson", src, "--until", "2026-10-01", "--out", out, "--audit", audit])
    assert json.load(open(out, encoding="utf-8"))["baseline"]["repeats"] == r["baseline"]["repeats"] == 10
    assert r["labels"]["audit"]["outcome"]["accuracy"] == 1.0
    assert not r["labels"]["audit"]["gate"]["pass"]       # 2 audited steps are far from the 100 the gate needs
    assert r["source"] == "ndjson:dump.ndjson"



def test_dev_source_with_token_never_imports_the_prod_session(monkeypatch):
    """--kh-url with KH_TOKEN reads the dev KH only: kh-helper's session (the prod sign-in) is never built."""
    monkeypatch.setenv("KH_TOKEN", "khdev.test-token")
    monkeypatch.setitem(sys.modules, "kh_helper.session", None)    # any import of it now raises ImportError
    seen = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"hits": []}

    import requests
    monkeypatch.setattr(requests, "request", lambda m, url, json=None, timeout=None, headers=None:
                        seen.update(url=url, auth=headers["Authorization"]) or _Resp())
    call = replay._kh_call("http://127.0.0.1:9102")
    assert call("POST", "/vector/scroll", {"scope": "log"}) == {"hits": []}
    assert seen == {"url": "http://127.0.0.1:9102/vector/scroll", "auth": "Bearer khdev.test-token"}


def test_a_local_dev_url_in_the_source_label_is_not_a_leak(monkeypatch, tmp_path):
    """--kh-url http://127.0.0.1:9102 puts an IP into report['source']; the leak check must not fire on it
    (dev check 2026-10-11: the pipeline failed only on its own source label)."""
    rows = [{"id": f"log-{i}", "text": "Deployed the build; all tests passed.", "project": "p",
             "ts": f"2026-09-{i + 1:02d}T10:00:00Z", "topic": "deploy"} for i in range(5)]
    monkeypatch.setattr(replay, "_kh_call", lambda url: (lambda m, path, body: {"hits": [] if body.get("offset")
                                                                                 else [{"vector_id": r["id"],
                                                                                        "source_text": r["text"],
                                                                                        "metadata": {**r, "scope": "log"}}
                                                                                       for r in rows]}))
    out = tmp_path / "r.json"
    r = replay.main(["--kh-url", "http://127.0.0.1:9102", "--projects", "p", "--out", str(out)])
    assert "127.0.0.1" in r["source"]
    assert next(x for x in r["pipeline"]["checks"] if x["check"].startswith("report holds"))["ok"]

if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
