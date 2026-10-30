"""Worker entry point: config, scheduler, one guarded job run, CLI (design section 3.2).

    python -m kh_worker check                                   # print the effective config, no network
    python -m kh_worker once --job distil [--project P] [--backfill]
    python -m kh_worker once --job daily  [--project P]
    python -m kh_worker once --job promote                    # personal rules many people share -> proposals
    python -m kh_worker run                                     # the scheduler loop (CF / Docker)

A job is a module ``kh_worker.jobs.<name>`` with ``run(ctx: RunContext) -> dict`` (slice S10). This module
owns everything around it: the ``worker:<job>`` lease, the month spend read from KH, the budget and its caps,
the metered LLM, ``worker.cost_usd`` metrics for each billed call, and one ``worker.run`` summary event.

Environment (defaults in brackets):
  KH_URL                          KH base URL (required for once/run)
  KH_WORKER_CLIENT_ID / _SECRET   confidential client of kh_people   |  KH_WORKER_TOKEN  dev-only token
  KH_WORKER_ENABLED     [0]       0 = idle: ``run`` sleeps, ``once`` refuses
  KH_WORKER_MODE        [dry]     dry = every submit is ``dry_run: true`` (KH writes nothing) | on
  KH_WORKER_LLM         [anthropic]  anthropic | claude_cli | dry
  KH_WORKER_MODEL       [claude-opus-5-5]   KH_WORKER_EFFORT [medium]   KH_WORKER_MAX_TOKENS [16000]
  KH_WORKER_CAP_RUN_USD [3]  KH_WORKER_CAP_MONTH_USD [60]  KH_WORKER_CAP_BACKFILL_USD [80]
  KH_WORKER_PROJECTS    comma list of projects the jobs visit
  KH_WORKER_TZ          [Asia/Ho_Chi_Minh]   KH_WORKER_PROJECT_TZ  "proj=Area/City,..." per-project override
  KH_WORKER_DISTIL_AT   [sat 03:00]  KH_WORKER_DAILY_AT [02:30]   KH_WORKER_TICK_S [60]
  KH_WORKER_JOBS        [distil,daily]  the jobs the scheduler runs (promote: add it by name)
  KH_WORKER_PROMOTE_AT  [02:00]  the nightly promote run (KH_WORKER_TZ): personal rules -> common-tier proposals
  KH_WORKER_SESSIONS_AT [02:00]   when the nightly sweep of idle session project bindings runs (KH_WORKER_TZ);
                                  off = never. No model call; a dry worker only reports it.
  KH_WORKER_HTTP_TIMEOUT_S [180]  per KH request (a submit of ~10 items has taken over 60 s)

The sidecar (person identity, ``kh_worker.person``; deploy/docker/kh-sidecar.compose.yml):
  KH_WORKER_AUTH        [principal]  principal = kh_people worker token | person = a KH technical user
  KH_WORKER_KC_TOKEN_URL  KH_WORKER_KC_CLIENT_ID  KH_WORKER_KC_CLIENT_SECRET  KH_WORKER_USERNAME  KH_WORKER_PASSWORD
  KH_WORKER_STATE_DIR   [./state]    lease, spend ledger and run log (person identity); keep it on a volume
  KH_WORKER_PROJECTS=*  every project KH serves to the distiller (/distill/patterns; person identity only)
  KH_WORKER_AUTO_APPROVE [0]  1 = after a real submit, approve the items this run wrote (never policy
                         proposals, never a share); 0 = they wait as proposed on /home > Lesson learn
  CLAUDE_CODE_OAUTH_TOKEN  for KH_WORKER_LLM=claude_cli (from ``claude setup-token``)
"""
from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any, Callable, Mapping, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import __version__
from .budget import (DEFAULT_CAP_BACKFILL_USD, DEFAULT_CAP_MONTH_USD, DEFAULT_CAP_RUN_USD, Budget,
                     BudgetExceeded, Spend)
from .khclient import BudgetRefused, KHClient, KHError, LeaseHeld
from .llm import DEFAULT_MAX_TOKENS, DEFAULT_MODEL, LLMError, Metered, make_llm

log = logging.getLogger("kh_worker")

JOBS = ("distil", "daily", "promote")
# promote reads every person's rules at once: it is not per project, so it runs for this one placeholder.
COMMON = "common"
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SECRET_KEYS = ("KH_WORKER_CLIENT_SECRET", "KH_WORKER_TOKEN", "ANTHROPIC_API_KEY", "KH_WORKER_PASSWORD",
               "KH_WORKER_KC_CLIENT_SECRET", "CLAUDE_CODE_OAUTH_TOKEN")
AUTHS = ("principal", "person")
# Zones without daylight saving, usable when the OS has no tz database and tzdata is not installed (Windows).
_FIXED_ZONES = {"UTC": 0, "Etc/UTC": 0, "Asia/Ho_Chi_Minh": 7, "Asia/Saigon": 7, "Asia/Bangkok": 7,
                "Asia/Jakarta": 7, "Asia/Singapore": 8, "Asia/Shanghai": 8, "Asia/Manila": 8,
                "Asia/Tokyo": 9, "Asia/Seoul": 9, "Asia/Kolkata": 5.5}


def zone(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        if name in _FIXED_ZONES:
            return timezone(timedelta(hours=_FIXED_ZONES[name]), name)
        raise ValueError(f"unknown time zone '{name}' (install tzdata)") from None


# ---------------------------------------------------------------------------------------------- config
def _f(env: Mapping[str, str], key: str, default: float) -> float:
    raw = (env.get(key) or "").strip()
    if not raw:
        return default
    v = float(raw)
    if v < 0:
        raise ValueError(f"{key} must be >= 0")
    return v


def load_vcap_secrets(env: dict[str, str]) -> None:
    """On CF, secrets come from a user-provided service; copy its credentials into env (never overwrite)."""
    raw = env.get("VCAP_SERVICES")
    if not raw:
        return
    try:
        services = json.loads(raw)
    except ValueError:
        return
    for inst in services.get("user-provided", []) or []:
        for k, v in (inst.get("credentials") or {}).items():
            if k.startswith(("KH_", "ANTHROPIC_", "CLAUDE_")) and isinstance(v, (str, int, float)):
                env.setdefault(k, str(v))


@dataclass
class Config:
    kh_url: str = ""
    client_id: str = ""
    client_secret: str = ""
    static_token: str = ""
    enabled: bool = False
    mode: str = "dry"
    llm: str = "anthropic"
    model: str = DEFAULT_MODEL
    effort: str = "medium"
    max_tokens: int = DEFAULT_MAX_TOKENS
    cap_run_usd: float = DEFAULT_CAP_RUN_USD
    cap_month_usd: float = DEFAULT_CAP_MONTH_USD
    cap_backfill_usd: float = DEFAULT_CAP_BACKFILL_USD
    projects: list[str] = field(default_factory=list)
    tz: str = "Asia/Ho_Chi_Minh"
    project_tz: dict[str, str] = field(default_factory=dict)
    distil_at: str = "sat 03:00"
    daily_at: str = "02:30"
    promote_at: str = "02:00"
    sessions_at: str = "02:00"
    tick_s: float = 60.0
    jobs: list[str] = field(default_factory=lambda: list(JOBS))
    auth: str = "principal"
    kc_token_url: str = ""
    kc_client_id: str = ""
    kc_client_secret: str = ""
    username: str = ""
    password: str = ""
    state_dir: str = "state"
    auto_approve: bool = False
    http_timeout_s: float = 180.0

    @property
    def dry(self) -> bool:
        return self.mode != "on"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        e = dict(os.environ if env is None else env)
        load_vcap_secrets(e)
        mode = (e.get("KH_WORKER_MODE") or "dry").strip().lower()
        if mode not in ("dry", "on"):
            raise ValueError("KH_WORKER_MODE must be 'dry' or 'on'")
        ptz = {}
        for part in (e.get("KH_WORKER_PROJECT_TZ") or "").split(","):
            if "=" in part:
                p, z = part.split("=", 1)
                ptz[p.strip()] = z.strip()
        cfg = cls(
            kh_url=(e.get("KH_URL") or "").strip(),
            client_id=(e.get("KH_WORKER_CLIENT_ID") or "").strip(),
            client_secret=(e.get("KH_WORKER_CLIENT_SECRET") or "").strip(),
            static_token=(e.get("KH_WORKER_TOKEN") or "").strip(),
            enabled=(e.get("KH_WORKER_ENABLED") or "0").strip().lower() in ("1", "true", "on", "yes"),
            mode=mode,
            llm=(e.get("KH_WORKER_LLM") or "anthropic").strip().lower(),
            model=(e.get("KH_WORKER_MODEL") or DEFAULT_MODEL).strip(),
            effort=(e.get("KH_WORKER_EFFORT") or "medium").strip(),
            max_tokens=int(e.get("KH_WORKER_MAX_TOKENS") or DEFAULT_MAX_TOKENS),
            cap_run_usd=_f(e, "KH_WORKER_CAP_RUN_USD", DEFAULT_CAP_RUN_USD),
            cap_month_usd=_f(e, "KH_WORKER_CAP_MONTH_USD", DEFAULT_CAP_MONTH_USD),
            cap_backfill_usd=_f(e, "KH_WORKER_CAP_BACKFILL_USD", DEFAULT_CAP_BACKFILL_USD),
            projects=[p.strip() for p in (e.get("KH_WORKER_PROJECTS") or "").split(",") if p.strip()],
            tz=(e.get("KH_WORKER_TZ") or "Asia/Ho_Chi_Minh").strip(),
            project_tz=ptz,
            distil_at=(e.get("KH_WORKER_DISTIL_AT") or "sat 03:00").strip(),
            daily_at=(e.get("KH_WORKER_DAILY_AT") or "02:30").strip(),
            promote_at=(e.get("KH_WORKER_PROMOTE_AT") or "02:00").strip(),
            sessions_at=(e.get("KH_WORKER_SESSIONS_AT") or "02:00").strip().lower(),
            tick_s=_f(e, "KH_WORKER_TICK_S", 60.0),
            jobs=[j.strip().lower() for j in (e.get("KH_WORKER_JOBS") or ",".join(JOBS)).split(",") if j.strip()],
            auth=(e.get("KH_WORKER_AUTH") or "principal").strip().lower(),
            kc_token_url=(e.get("KH_WORKER_KC_TOKEN_URL") or "").strip(),
            kc_client_id=(e.get("KH_WORKER_KC_CLIENT_ID") or "").strip(),
            kc_client_secret=(e.get("KH_WORKER_KC_CLIENT_SECRET") or "").strip(),
            username=(e.get("KH_WORKER_USERNAME") or "").strip(),
            password=e.get("KH_WORKER_PASSWORD") or "",
            state_dir=(e.get("KH_WORKER_STATE_DIR") or "state").strip(),
            auto_approve=(e.get("KH_WORKER_AUTO_APPROVE") or "0").strip().lower() in ("1", "true", "on", "yes"),
            http_timeout_s=_f(e, "KH_WORKER_HTTP_TIMEOUT_S", 180.0),
        )
        if cfg.auth not in AUTHS:
            raise ValueError(f"KH_WORKER_AUTH must be one of {', '.join(AUTHS)}")
        bad = [j for j in cfg.jobs if j not in JOBS]
        if bad:
            raise ValueError(f"KH_WORKER_JOBS: unknown job(s) {', '.join(bad)} (known: {', '.join(JOBS)})")
        if cfg.projects == ["*"] and cfg.auth != "person":
            raise ValueError("KH_WORKER_PROJECTS=* needs KH_WORKER_AUTH=person (a worker token cannot list "
                             "projects); name the projects instead")
        if cfg.llm in ("claude_cli", "claude-cli", "cli") and e.get("ANTHROPIC_API_KEY") and \
                e.get("CLAUDE_CODE_OAUTH_TOKEN"):
            log.warning("both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set: the Claude CLI bills the "
                        "API key; unset it to run on the subscription token")
        for z in [cfg.tz, *cfg.project_tz.values()]:
            zone(z)                              # fail at start, not at 03:00 on a Saturday
        parse_slot(cfg.distil_at)
        parse_slot(cfg.daily_at)
        parse_slot(cfg.promote_at)
        if cfg.sessions_at != "off":
            parse_slot(cfg.sessions_at)
        return cfg

    def public(self) -> dict:
        d = dict(self.__dict__)
        d["client_secret"] = "***" if self.client_secret else ""
        d["static_token"] = "***" if self.static_token else ""
        d["kc_client_secret"] = "***" if self.kc_client_secret else ""
        d["password"] = "***" if self.password else ""
        d["anthropic_api_key"] = "set" if os.environ.get("ANTHROPIC_API_KEY") else "unset"
        d["claude_code_oauth_token"] = "set" if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") else "unset"
        return d


def make_client(cfg: Config) -> KHClient:
    """The KH client of ``cfg.auth``: the kh_people worker principal, or a person account (the sidecar)."""
    if cfg.auth == "person":
        from .person import PersonKHClient
        return PersonKHClient(cfg.kh_url, token_url=cfg.kc_token_url, kc_client_id=cfg.kc_client_id,
                              kc_client_secret=cfg.kc_client_secret, username=cfg.username,
                              password=cfg.password, state_dir=cfg.state_dir, dry=cfg.dry,
                              timeout_s=cfg.http_timeout_s)
    return KHClient(cfg.kh_url, client_id=cfg.client_id, client_secret=cfg.client_secret,
                    static_token=cfg.static_token, dry=cfg.dry, timeout_s=cfg.http_timeout_s)


def resolve_projects(cfg: Config, kh: KHClient, projects: Sequence[str]) -> list[str]:
    """``*`` stands for every project KH serves to the distiller, read when a run starts."""
    if list(projects) != ["*"]:
        return list(projects)
    lister = getattr(kh, "consented_projects", None)
    if lister is None:
        raise ValueError("KH_WORKER_PROJECTS=* needs KH_WORKER_AUTH=person")
    return lister()


# ---------------------------------------------------------------------------------------------- scheduler
@dataclass(frozen=True)
class Slot:
    weekday: int | None     # 0 = Monday; None = every day
    hour: int
    minute: int


def parse_slot(text: str) -> Slot:
    """``"sat 03:00"`` or ``"02:30"``."""
    parts = text.lower().split()
    wd = None
    if len(parts) == 2:
        if parts[0][:3] not in WEEKDAYS:
            raise ValueError(f"bad weekday in schedule '{text}'")
        wd = WEEKDAYS.index(parts[0][:3])
        parts = parts[1:]
    if len(parts) != 1 or ":" not in parts[0]:
        raise ValueError(f"bad schedule '{text}' (use 'sat 03:00' or '02:30')")
    hh, mm = (int(x) for x in parts[0].split(":", 1))
    if not (0 <= hh < 24 and 0 <= mm < 60):
        raise ValueError(f"bad time in schedule '{text}'")
    return Slot(wd, hh, mm)


class Scheduler:
    """Decides which projects a job is due for, in each project's own time zone.

    A slot fires once per local day, at or after its time and before local midnight, so a worker that was
    down at 03:00 catches up later that day. ``fired`` is in memory; the lease and KH's cursor make a second
    run after a restart harmless (a distil run picks up where the cursor is; a summary is rebuilt only for
    days with newer logs).
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.slots = {"distil": parse_slot(cfg.distil_at), "daily": parse_slot(cfg.daily_at),
                      "promote": parse_slot(cfg.promote_at)}
        self.fired: dict[tuple[str, str], str] = {}

    def tz_of(self, project: str) -> tzinfo:
        return zone(self.cfg.project_tz.get(project, self.cfg.tz))

    def due(self, job: str, now_utc: datetime, projects: Sequence[str]) -> list[str]:
        slot = self.slots[job]
        out = []
        for p in projects:
            local = now_utc.astimezone(self.tz_of(p))
            if slot.weekday is not None and local.weekday() != slot.weekday:
                continue
            if (local.hour, local.minute) < (slot.hour, slot.minute):
                continue
            if self.fired.get((job, p)) == local.date().isoformat():
                continue
            out.append(p)
        return out

    def mark(self, job: str, now_utc: datetime, projects: Sequence[str]) -> None:
        for p in projects:
            self.fired[(job, p)] = now_utc.astimezone(self.tz_of(p)).date().isoformat()


# ---------------------------------------------------------------------------------------------- one run
class CostNotRecorded(RuntimeError):
    """A billed call's cost could not be written to KH. The run stops (fail closed): an unrecorded spend
    would let the next run under-count the month."""


@dataclass
class RunContext:
    """What a job gets. ``llm`` is metered: every call is checked against the caps before it is sent."""
    cfg: Config
    kh: KHClient
    llm: Metered
    budget: Budget
    job: str
    projects: list[str]
    dry: bool
    backfill: bool
    lease_lost: threading.Event
    max_tokens: int = DEFAULT_MAX_TOKENS
    log: logging.Logger = log

    def should_stop(self) -> bool:
        return self.lease_lost.is_set()


def run_job(cfg: Config, job: str, projects: Sequence[str], *, backfill: bool = False,
            kh: KHClient | None = None, llm: Any = None,
            job_runner: Callable[[RunContext], dict] | None = None) -> dict:
    """Run one job under lease and budget. Returns a summary dict (also sent as a ``worker.run`` event)."""
    if job not in JOBS:
        raise ValueError(f"unknown job '{job}'")
    if backfill and job != "distil":
        raise ValueError("--backfill applies to the distil job only")
    started = time.time()
    if job == "promote":
        projects = [COMMON]
    summary: dict[str, Any] = {"job": job, "projects": list(projects), "mode": cfg.mode, "backfill": backfill,
                               "llm": cfg.llm, "model": cfg.model, "version": __version__}
    if not projects:
        summary["status"] = "no_projects"
        return summary
    kh = kh or make_client(cfg)
    kh.dry = cfg.dry                                   # the client enforces dry_run on every submit
    if list(projects) == ["*"]:
        try:
            projects = resolve_projects(cfg, kh, projects)
        except KHError as exc:
            summary.update(status="error", error=f"project list: {exc}"[:500])
            return summary
        summary["projects"] = list(projects)
        if not projects:
            summary["status"] = "no_projects"
            return summary
    llm = llm or make_llm(cfg.llm, cfg.model, effort=cfg.effort)
    summary["run_id"] = kh.run_id

    lease = kh.lease(f"worker:{job}")
    try:
        lease.__enter__()
    except LeaseHeld as exc:
        summary["status"] = "lease_held"
        summary["holder"] = (exc.body or {}).get("holder") if isinstance(exc.body, dict) else None
        log.info("job %s skipped: lease held by another worker", job)
        return summary
    try:
        kind = "backfill" if backfill else "run"
        try:
            month = kh.month_spend_usd()
        except KHError as exc:
            if getattr(llm, "billed", True):
                summary["status"] = "month_unknown"     # fail closed: no month total, no paid calls
                summary["error"] = str(exc)
                return summary
            month = 0.0

        def on_spend(s: Spend) -> None:
            try:
                kh.record_cost(s.usd, job=job, kind=s.kind, model=s.model)
            except Exception as exc:  # noqa: BLE001
                raise CostNotRecorded(str(exc)) from exc

        budget = Budget(cap_run_usd=cfg.cap_run_usd, cap_month_usd=cfg.cap_month_usd,
                        cap_backfill_usd=cfg.cap_backfill_usd, month_spent_usd=month, kind=kind,
                        on_spend=on_spend)
        ctx = RunContext(cfg=cfg, kh=kh, llm=Metered(llm, budget), budget=budget, job=job,
                         projects=list(projects), dry=cfg.dry, backfill=backfill, lease_lost=lease.lost,
                         max_tokens=cfg.max_tokens)
        runner = job_runner or _load_job(job)
        if runner is None:
            summary["status"] = "not_built"
        else:
            try:
                out = runner(ctx) or {}
                summary["status"] = "lease_lost" if lease.lost.is_set() else out.pop("status", "ok")
                summary["result"] = out
            except BudgetExceeded as exc:
                summary.update(status="budget", cap=exc.cap, error=str(exc))
            except BudgetRefused as exc:
                summary.update(status="kh_budget", error=str(exc))
            except CostNotRecorded as exc:
                summary.update(status="cost_not_recorded", error=str(exc))
            except (LLMError, KHError) as exc:
                summary.update(status="error", error=str(exc)[:500])
        summary["budget"] = budget.summary()
    finally:
        lease.__exit__(None, None, None)
        summary["seconds"] = round(time.time() - started, 1)
        if "status" in summary and summary["status"] not in ("lease_held",):
            try:
                kh.append_event("worker.run", summary, event_id=f"worker.run:{kh.run_id}")
            except Exception as exc:  # noqa: BLE001 - the summary is also printed and logged
                log.warning("worker.run event not written: %s", exc)
    return summary


def _load_job(job: str) -> Callable[[RunContext], dict] | None:
    try:
        mod = importlib.import_module(f"kh_worker.jobs.{job}")
    except ModuleNotFoundError as exc:
        if exc.name and exc.name.startswith("kh_worker.jobs"):
            log.warning("job '%s' is not built yet (kh_worker/jobs/%s.py, slice S10)", job, job)
            return None
        raise
    return getattr(mod, "run")


def sweep_sessions(cfg: Config, kh: KHClient | None = None) -> dict:
    """The nightly sweep of KH session project bindings idle past their TTL (72 h). No model, no budget."""
    if cfg.dry:
        return {"job": "sessions", "status": "dry", "note": "KH_WORKER_MODE=dry: nothing deleted"}
    kh = kh or make_client(cfg)
    try:
        return {"job": "sessions", "status": "ok", **kh.session_sweep()}
    except KHError as exc:
        return {"job": "sessions", "status": "error", "error": str(exc)}


class SessionSweepSlot:
    """Fires once per local day (KH_WORKER_TZ) at or after KH_WORKER_SESSIONS_AT, like a job slot."""

    def __init__(self, cfg: Config):
        self.slot = None if cfg.sessions_at == "off" else parse_slot(cfg.sessions_at)
        self.tz = zone(cfg.tz)
        self.fired = ""

    def due(self, now_utc: datetime) -> bool:
        if self.slot is None:
            return False
        local = now_utc.astimezone(self.tz)
        if self.slot.weekday is not None and local.weekday() != self.slot.weekday:
            return False
        return (local.hour, local.minute) >= (self.slot.hour, self.slot.minute) and \
            self.fired != local.date().isoformat()

    def mark(self, now_utc: datetime) -> None:
        self.fired = now_utc.astimezone(self.tz).date().isoformat()


def serve(cfg: Config, *, stop: threading.Event | None = None,
          now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
    """The scheduler loop: wake every ``tick_s``, run each due job for its due projects."""
    stop = stop or threading.Event()
    sched = Scheduler(cfg)
    sessions = SessionSweepSlot(cfg)
    log.info("kh-worker %s up: mode=%s llm=%s model=%s enabled=%s auth=%s jobs=%s distil_at=%s tz=%s",
             __version__, cfg.mode, cfg.llm, cfg.model, cfg.enabled, cfg.auth, ",".join(cfg.jobs), cfg.distil_at,
             cfg.tz)
    while not stop.is_set():
        if cfg.enabled and sessions.due(now()):
            t = now()
            try:
                log.info("sessions: %s", json.dumps(sweep_sessions(cfg), default=str))
            except Exception:  # noqa: BLE001 - the sweep must not kill the scheduler
                log.exception("session sweep crashed")
            sessions.mark(t)
        if cfg.enabled:
            for job in cfg.jobs:
                t = now()
                due = sched.due(job, t, [COMMON] if job == "promote" else cfg.projects)
                if not due:
                    continue
                try:
                    summary = run_job(cfg, job, due)
                    log.info("job %s: %s", job, json.dumps(summary, default=str)[:2000])
                    if summary.get("status") != "lease_held":
                        sched.mark(job, t, due)
                except Exception:  # noqa: BLE001 - one bad run must not kill the scheduler
                    log.exception("job %s crashed", job)
                    sched.mark(job, t, due)
        stop.wait(cfg.tick_s)


# ---------------------------------------------------------------------------------------------- CLI
def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="kh_worker", description="Knowledge Hub distil and daily worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="print the effective config (secrets masked); no network")
    once = sub.add_parser("once", help="run one job now (under the lease and the caps)")
    once.add_argument("--job", choices=JOBS, required=True)
    once.add_argument("--project", action="append", default=[], help="repeatable; default KH_WORKER_PROJECTS")
    once.add_argument("--backfill", action="store_true", help="one-off backfill under KH_WORKER_CAP_BACKFILL_USD")
    sub.add_parser("sweep-sessions", help="delete idle session project bindings now")
    sub.add_parser("run", help="scheduler loop")
    args = ap.parse_args(argv)

    logging.basicConfig(level=os.environ.get("KH_WORKER_LOG", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = Config.from_env()
    if args.cmd == "check":
        print(json.dumps(cfg.public(), indent=2, default=str))
        return 0
    if args.cmd == "sweep-sessions":
        if not cfg.enabled:
            print("kh-worker is disabled (KH_WORKER_ENABLED=0); nothing ran", file=sys.stderr)
            return 2
        summary = sweep_sessions(cfg)
        print(json.dumps(summary, indent=2, default=str))
        return 0 if summary["status"] in ("ok", "dry") else 1
    if args.cmd == "once":
        if not cfg.enabled:
            print("kh-worker is disabled (KH_WORKER_ENABLED=0); nothing ran", file=sys.stderr)
            return 2
        summary = run_job(cfg, args.job, args.project or cfg.projects, backfill=args.backfill)
        print(json.dumps(summary, indent=2, default=str))
        return 0 if summary.get("status") in ("ok", "no_projects", "lease_held") else 1
    serve(cfg)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
