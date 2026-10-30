"""The sidecar identity (kh_worker.person): a KH person account, file-backed lease, spend and run log.

The fake KH of test_jobs serves /distill/*; this file adds Keycloak's token endpoint, /distill/patterns and
/distill/approve in front of it. No network, no paid model.
"""
from __future__ import annotations

import calendar
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from kh_worker.llm import DryLLM  # noqa: E402
from kh_worker.main import Config, Scheduler, parse_slot, run_job  # noqa: E402
from kh_worker.person import EVENTS_FILE, SPEND_FILE, PersonKHClient  # noqa: E402
from test_jobs import FakeKH, Resp, good_items  # noqa: E402

TOKEN_URL = "http://kc.test/realms/knowledge-hub/protocol/openid-connect/token"


class Sidecar:
    """Keycloak + the person-only routes, then FakeKH for everything else."""

    def __init__(self, fake: FakeKH, consented: list[str]):
        self.fake = fake
        self.consented = consented
        self.grants: list[dict] = []
        self.approved: list[dict] = []
        self.auth_headers: list[str] = []
        self.n = 0

    def request(self, method, url, json=None, params=None, headers=None, timeout=None, data=None):
        if url == TOKEN_URL:
            self.grants.append(dict(data))
            self.n += 1
            if data["grant_type"] == "password" and data["password"] != "pw":
                return Resp(401, {"error": "invalid_grant", "error_description": "Invalid user credentials"})
            return Resp(200, {"access_token": f"person-{self.n}", "expires_in": 300,
                              "refresh_token": f"refresh-{self.n}", "refresh_expires_in": 1800})
        self.auth_headers.append((headers or {}).get("Authorization", ""))
        path = "/" + url.split("://", 1)[-1].split("/", 1)[1]
        if path == "/distill/patterns":
            return Resp(200, {"days": params["days"], "projects": [{"project": p, "logs": 1} for p in self.consented]})
        if path == "/distill/approve":
            self.approved.append(json)
            return Resp(200, {"results": [{"id": i, "result": "active", **({"shared": "dk_s_" + i} if i in json.get("share", []) else {})}
                                          for i in json["ids"]]})
        return self.fake.request(method, url, json=json, params=params, headers=headers, timeout=timeout)


def person_cfg(tmp_path, **kw) -> Config:
    base = dict(kh_url="http://kh.test", enabled=True, mode="on", llm="dry", auth="person",
                kc_token_url=TOKEN_URL, kc_client_id="kh-agent-distill", kc_client_secret="s",
                username="kh-distill@example.test", password="pw", state_dir=str(tmp_path / "state"))
    base.update(kw)
    return Config(**base)


def client(cfg: Config, session, clock=time.time) -> PersonKHClient:
    return PersonKHClient(cfg.kh_url, token_url=cfg.kc_token_url, kc_client_id=cfg.kc_client_id,
                          kc_client_secret=cfg.kc_client_secret, username=cfg.username, password=cfg.password,
                          state_dir=cfg.state_dir, dry=cfg.dry, session=session, clock=clock)


# ---------------------------------------------------------------------------------------------- identity
def test_password_grant_then_reuse_then_refresh(tmp_path):
    now = [1000.0]
    side = Sidecar(FakeKH({"p": []}), ["p"])
    kh = client(person_cfg(tmp_path), side, clock=lambda: now[0])
    assert kh.person_token() == "person-1"
    assert side.grants[0]["grant_type"] == "password" and side.grants[0]["client_secret"] == "s"
    now[0] += 100
    assert kh.person_token() == "person-1"            # still fresh: no new grant
    now[0] += 200                                       # inside the 90 s skew: refresh
    assert kh.person_token() == "person-2"
    assert side.grants[1] == {"client_id": "kh-agent-distill", "client_secret": "s",
                              "grant_type": "refresh_token", "refresh_token": "refresh-1"}
    assert kh.worker_token() == kh.ns_token() == "person-2"


def test_bad_password_is_a_clear_error(tmp_path):
    side = Sidecar(FakeKH({"p": []}), ["p"])
    kh = client(person_cfg(tmp_path, password="nope"), side)
    with pytest.raises(Exception) as exc:
        kh.person_token()
    assert "401" in str(exc.value) and "invalid_grant" in str(exc.value)


def test_person_mode_needs_its_settings(tmp_path):
    with pytest.raises(ValueError, match="KH_WORKER_USERNAME"):
        PersonKHClient("http://kh.test", token_url=TOKEN_URL, kc_client_id="c", username="", password="",
                       state_dir=str(tmp_path))


# ---------------------------------------------------------------------------------------------- a run
def test_star_resolves_projects_and_the_books_are_local(tmp_path):
    fake = FakeKH({"a": ["l1", "l2", "l3"], "b": ["l4"]})
    side = Sidecar(fake, ["b", "a"])
    cfg = person_cfg(tmp_path, projects=["*"])
    s = run_job(cfg, "distil", ["*"], kh=client(cfg, side), llm=DryLLM("claude-opus-5-5", responder=good_items))
    assert s["status"] == "ok", s
    assert s["projects"] == ["b", "a"]
    assert len(fake.items) == 4 and fake.cursor == {"a": 3, "b": 1}
    assert all(h.startswith("Bearer person-") for h in side.auth_headers)
    assert not any(c.startswith("POST /v1/kh_people") for c in fake.calls)        # no kh_people needed
    state = tmp_path / "state"
    runs = [json.loads(x) for x in (state / EVENTS_FILE).read_text(encoding="utf-8").splitlines()]
    assert runs[-1]["kind"] == "worker.run" and runs[-1]["body"]["status"] == "ok"
    assert not list(state.glob("lease-*.json"))                                     # released


def test_second_run_reads_only_new_logs(tmp_path):
    fake = FakeKH({"a": ["l1", "l2"]})
    side = Sidecar(fake, ["a"])
    cfg = person_cfg(tmp_path, projects=["a"])
    llm = DryLLM("claude-opus-5-5", responder=good_items)
    run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=llm)
    assert len(fake.items) == 2
    fake.logs["a"] += ["l3"]                             # one new log since the last night
    fake.text["l3"] = "log l3: decided to deploy with the blue-green script"
    s = run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=llm)
    assert s["status"] == "ok"
    assert [i["sources"] for i in fake.items] == [["l1"], ["l2"], ["l3"]]          # l1, l2 not served again


def test_auto_approve_skips_policy_proposals(tmp_path):
    def mixed(system, user, schema):
        out = good_items(system, user, schema)
        first = out["items"][0]
        out["items"].append({**first, "kind": "policy_proposal", "title": "A rule", "action": "review code",
                             "target_action": "review code", "target_sub_action": "check"})
        return out

    fake = FakeKH({"a": ["l1"]})
    side = Sidecar(fake, ["a"])
    cfg = person_cfg(tmp_path, projects=["a"], auto_approve=True)
    s = run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=DryLLM("claude-opus-5-5", responder=mixed))
    assert s["status"] == "ok", s
    assert len(fake.items) == 2
    assert side.approved == [{"project": "a", "ids": ["dk_0"], "share": []}]         # the lesson, not the proposal
    assert s["result"]["projects"]["a"]["approved"] == 1


def test_no_approve_by_default_or_in_dry(tmp_path):
    for kw in ({}, {"auto_approve": True, "mode": "dry"}):
        fake = FakeKH({"a": ["l1"]})
        side = Sidecar(fake, ["a"])
        cfg = person_cfg(tmp_path, projects=["a"], **kw)
        run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=DryLLM("claude-opus-5-5", responder=good_items))
        assert side.approved == []


def test_file_lease_held_by_another_instance(tmp_path):
    fake = FakeKH({"a": ["l1"]})
    side = Sidecar(fake, ["a"])
    cfg = person_cfg(tmp_path, projects=["a"])
    kh = client(cfg, side)
    (kh.state / "lease-worker_distil.json").write_text(
        json.dumps({"holder": "other:1:x", "expires_at": time.time() + 600}), encoding="utf-8")
    s = run_job(cfg, "distil", ["a"], kh=kh, llm=DryLLM("claude-opus-5-5", responder=good_items))
    assert s["status"] == "lease_held" and fake.items == []
    (kh.state / "lease-worker_distil.json").write_text(                              # expired: taken over
        json.dumps({"holder": "other:1:x", "expires_at": time.time() - 1}), encoding="utf-8")
    s = run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=DryLLM("claude-opus-5-5", responder=good_items))
    assert s["status"] == "ok"


def test_month_spend_reads_the_ledger(tmp_path):
    side = Sidecar(FakeKH({"a": []}), ["a"])
    now = calendar.timegm((2026, 10, 24, 2, 0, 0))
    kh = client(person_cfg(tmp_path), side, clock=lambda: now)
    rows = [{"ts": now - 3600, "usd": 1.25, "kind": "run"}, {"ts": now - 7200, "usd": 4.0, "kind": "backfill"},
            {"ts": calendar.timegm((2026, 9, 30, 23, 0, 0)), "usd": 9.0, "kind": "run"}]
    (kh.state / SPEND_FILE).write_text("".join(json.dumps(r) + "\n" for r in rows) + "{torn", encoding="utf-8")
    assert kh.month_spend_usd() == pytest.approx(1.25)
    kh.record_cost(0.5, job="distil", kind="run", model="m")
    assert kh.month_spend_usd() == pytest.approx(1.75)


# ---------------------------------------------------------------------------------------------- config
def env(**kw) -> dict:
    return {"KH_URL": "http://kh.test", **kw}


def test_config_of_the_sidecar():
    cfg = Config.from_env(env(KH_WORKER_AUTH="person", KH_WORKER_PROJECTS="*", KH_WORKER_JOBS="distil",
                              KH_WORKER_DISTIL_AT="02:00", KH_WORKER_PASSWORD="pw", KH_WORKER_AUTO_APPROVE="1",
                              KH_WORKER_KC_CLIENT_SECRET="cs", KH_WORKER_STATE_DIR="/data"))
    assert cfg.auth == "person" and cfg.projects == ["*"] and cfg.jobs == ["distil"] and cfg.auto_approve
    assert parse_slot(cfg.distil_at).weekday is None                                 # every day
    pub = cfg.public()
    assert pub["password"] == "***" and pub["kc_client_secret"] == "***" and "pw" not in json.dumps(pub)


def test_star_needs_the_person_identity_and_jobs_are_checked():
    with pytest.raises(ValueError, match="KH_WORKER_AUTH=person"):
        Config.from_env(env(KH_WORKER_PROJECTS="*"))
    with pytest.raises(ValueError, match="unknown job"):
        Config.from_env(env(KH_WORKER_JOBS="distil,weekly"))
    with pytest.raises(ValueError, match="KH_WORKER_AUTH"):
        Config.from_env(env(KH_WORKER_AUTH="oauth"))


def test_claude_secrets_come_from_a_cf_service():
    vcap = json.dumps({"user-provided": [{"credentials": {"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat-x",
                                                          "KH_WORKER_PASSWORD": "pw", "OTHER": "no"}}]})
    e = env(VCAP_SERVICES=vcap, KH_WORKER_AUTH="person")
    from kh_worker.main import load_vcap_secrets
    load_vcap_secrets(e)
    assert e["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat-x" and e["KH_WORKER_PASSWORD"] == "pw" and "OTHER" not in e


def test_daily_slot_fires_once_per_night():
    cfg = Config(distil_at="02:00", tz="Asia/Ho_Chi_Minh")
    sched = Scheduler(cfg)
    from datetime import datetime, timezone
    before = datetime(2026, 10, 24, 18, 59, tzinfo=timezone.utc)        # 01:59 local
    at = datetime(2026, 10, 24, 19, 0, tzinfo=timezone.utc)             # 02:00 local
    assert sched.due("distil", before, ["*"]) == []
    assert sched.due("distil", at, ["*"]) == ["*"]
    sched.mark("distil", at, ["*"])
    assert sched.due("distil", datetime(2026, 10, 24, 22, 0, tzinfo=timezone.utc), ["*"]) == []
    assert sched.due("distil", datetime(2026, 10, 25, 19, 0, tzinfo=timezone.utc), ["*"]) == ["*"]


def test_a_kh_timeout_is_a_kh_error_and_the_run_reports_it(tmp_path):
    import requests

    class Slow(Sidecar):
        def request(self, method, url, json=None, params=None, headers=None, timeout=None, data=None):
            if url.endswith("/distill/submit"):
                assert timeout == 180.0
                raise requests.exceptions.ReadTimeout("Read timed out. (read timeout=180)")
            return super().request(method, url, json=json, params=params, headers=headers, timeout=timeout,
                                   data=data)

    fake = FakeKH({"a": ["l1"], "b": ["l2"]})
    cfg = person_cfg(tmp_path, projects=["a", "b"])
    kh = PersonKHClient(cfg.kh_url, token_url=cfg.kc_token_url, kc_client_id=cfg.kc_client_id, username=cfg.username,
                        password=cfg.password, state_dir=cfg.state_dir, dry=False, session=Slow(fake, ["a", "b"]),
                        timeout_s=cfg.http_timeout_s)
    s = run_job(cfg, "distil", ["a", "b"], kh=kh, llm=DryLLM("claude-opus-5-5", responder=good_items))
    assert s["status"] == "partial", s                                    # no crash; both projects tried
    for p in ("a", "b"):
        assert s["result"]["projects"][p]["stopped"] == "error"
        assert "ReadTimeout" in s["result"]["projects"][p]["error"]


def test_auto_approve_shares_only_what_the_model_marked_general(tmp_path):
    def marked(system, user, schema):
        out = good_items(system, user, schema)
        it = out["items"][0]
        out["items"] = [{**it, "share": True}, {**it, "title": "Project-only fact", "share": False},
                        {**it, "kind": "policy_proposal", "title": "A rule", "action": "review code", "share": True,
                         "target_action": "review code", "target_sub_action": "check"}]
        return out

    fake = FakeKH({"a": ["l1"]})
    side = Sidecar(fake, ["a"])
    cfg = person_cfg(tmp_path, projects=["a"], auto_approve=True)
    s = run_job(cfg, "distil", ["a"], kh=client(cfg, side), llm=DryLLM("claude-opus-5-5", responder=marked))
    assert s["status"] == "ok", s
    assert all("share" not in it for b in fake.submits for it in b["items"])        # KH gets its own field set
    assert side.approved == [{"project": "a", "ids": ["dk_0", "dk_1"], "share": ["dk_0"]}]   # never the proposal
    assert s["result"]["projects"]["a"]["shared"] == 1
