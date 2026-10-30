"""Line settings. FROZEN field names after wave 0.

Precedence (later wins):
  1. defaults in this file
  2. line/config/line.json            (tracked; keys = Config field names)
  3. the local RAG wire config         (optional; only rag_* keys, "rag_extra", generic wire keys)
     path: env LINE_RAG_LOCAL, default %USERPROFILE%/.line/rag.local.json (~/.line on POSIX).
     It lives OUTSIDE line/ on purpose: it names one deployment's wire details and must never be
     committed with the line.
  4. LINE_* environment variables     (see ENV_MAP)

LINE_RAG_CLIENT_ID / LINE_RAG_CLIENT_SECRET are read from the environment only;
the files may not set them (a secret in a file is ignored).

Usage:  from line.config import load_config;  cfg = load_config()
"""

from __future__ import annotations

import dataclasses
import json
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional

from . import codes
from .codes import LineError

LINE_DIR = os.path.dirname(os.path.abspath(__file__))
SDLC_DIR = os.path.dirname(LINE_DIR)
CONFIG_DIR = os.path.join(LINE_DIR, "config")
LINE_JSON = os.path.join(CONFIG_DIR, "line.json")
RAG_LOCAL_ENV = "LINE_RAG_LOCAL"


def default_rag_local_json(env: Optional[Mapping[str, str]] = None) -> str:
    """Path of the local RAG wire config: $LINE_RAG_LOCAL, else ~/.line/rag.local.json."""
    env = os.environ if env is None else env
    p = env.get(RAG_LOCAL_ENV, "")
    return p if p else os.path.join(os.path.expanduser("~"), ".line", "rag.local.json")


#: sentinel: resolve the path with default_rag_local_json() at load time
RAG_LOCAL_JSON = "<default>"

LLM_MODES = ("fake", "cli", "api")
RAG_MODES = ("off", "http")

#: default role -> model: the roles that read, size and plan run on cheaper models; writing tests and code stays
#: on `model` (the NotesApp bench: builders were 17-55% of a run's cost, the reading roles most of the rest)
ROLE_MODELS: Dict[str, str] = {
    "change_sizer": "claude-sonnet-5-5",        # the level of every request: a fast mid-size model
    "solo_reviewer": "claude-sonnet-5-5",
    "spec_curator": "claude-sonnet-5-5",
    "spec_analyst": "claude-sonnet-5-5",
    "reader_a": "claude-sonnet-5-5",
    "reader_b": "claude-sonnet-5-5",
    "reader_reread": "claude-sonnet-5-5",
    "fgraph": "claude-sonnet-5-5",
    "planner": "claude-sonnet-5-5",
    "domain_agent": "claude-sonnet-5-5",        # the gated flow's implement plan (line.gates); the build stays on `model`
    "explainer": "claude-haiku-5-5",
    "supervisor": "claude-sonnet-5-5",
    # after the run: summaries of what happened, never code (run 2 of the bench: retro on Opus and distiller on
    # Fable were $1.86 of a request one Claude Code session did for $2.69)
    "retro": "claude-sonnet-5-5",
    "distiller": "claude-haiku-5-5",
}


@dataclass
class Config:
    # storage / server
    db: str = os.path.join(LINE_DIR, "line.db")
    host: str = "127.0.0.1"
    port: int = 8796
    workroot: str = os.path.join(tempfile.gettempdir(), "sdlc-line")
    agent_version: str = "line-0.1"

    # model access
    llm: str = "fake"                      # fake | cli | api
    model: str = "claude-opus-5-5"
    model_alt: str = "claude-fable-5-1"    # retry ladder "switch model" rung
    max_usd_call: float = 1.5
    max_usd_run: float = 5.0
    pricing: str = os.path.join(SDLC_DIR, "pricing.json")
    builder_max_turns: int = 40
    spec_analyst: str = "auto"             # auto (on with a real model) | 1 | 0: an agent reads links + knowledge first
    spec_analyst_max_turns: int = 30
    # overhead (docs/dlc/pipeline.md, "Lanes"): a small agent sizes the change, the run takes the lane it needs
    lanes: str = "auto"                    # auto (on with a real model) | 1 | 0 (every run takes the full lane)
    sizer_max_turns: int = 12
    sizer_max_usd: float = 0.5
    max_level: int = 4                     # cap on the levels the sizer and retries pick (a person's level is not capped)
    # a BLOCKED unit is settled before the ladder (line.build.arbiter): claims granted or waited for, a locked test
    # ruled on and repaired when wrong
    arbiter: str = "auto"                  # auto (on with a real model) | 1 | 0
    arbiter_max: int = 3                   # locked-test rulings per run
    # simple first (line.solo): one strong agent reads, builds and tests the whole request in one session, the
    # line's own gates check it (full suite, clean QAS export); a request that fails there is retried on the
    # multi-agent lanes. A person's lane choice (trivial / small / full) skips it.
    solo: str = "auto"                     # auto (on with a real model) | 1 | 0
    solo_max_turns: int = 120
    solo_max_usd: float = 4.0              # per solo call
    solo_fix_rounds: int = 2               # gate failures sent back to the agent before the run escalates
    sizer_persona: str = "agent-sizer"     # the change sizer's own project in the store (its rules and cases)
    retro_personas: str = ""              # personas this instance's retro looks after (names or globs, comma); "" = all
    solo_lead: str = "auto"              # auto: levels 3-4 go to one lead agent with subagents; 0: the team lanes
    solo_review: str = "auto"            # auto (level 2) | 1 (levels 1 and 2) | 0: the reviewer of a green solo change
    # the gated Enhancement / Bug Fix flow (line.gates, design docs/flow-enhance_bugfix.html): Spec Agent, a person
    # signs the spec off, Domain + QC agents plan in parallel, a person approves both plans, build / deploy / test
    # rounds, findings, a person's final review whose solutions go back to the retro
    gates: str = "auto"                    # auto (Enhancement and Bug Fix runs on the solo lane) | 1 | 0
    gate_rounds: int = 3                   # implement -> deploy -> test rounds before the run stops for a person
    gate_plan_usd: float = 1.5             # per Spec / Domain / QC agent call
    gate_plan_turns: int = 60
    # line.process: a folder of process definitions (<id>.json) and prompts (prompts/<name>.md) that override the
    # seed for every project; a project's own .dlc/process and .dlc/prompts on its main branch override this
    process_dir: str = ""
    # the shared spec-design library (line.specdesign): problem -> solution per context, recalled before a request
    # is analysed and grown after it is green
    spec_design: str = "auto"              # auto (on with a real model and a store or kh_helper) | 1 | 0
    spec_design_project: str = "lesson-learned"   # traits live with the lessons (kind spec-trait)
    kh_helper: str = ""                    # the engine's OWN RAG System helper python (<profile>/kh-helper/Scripts/python,
                                           # signed in once for the engine), when it has no store of its own
    #: role -> model for the roles that read and plan; a role not listed (builder, test author, fixer, merger,
    #: reviewer) runs on `model`. The retry ladder's alternate model and the agent directory still win.
    role_models: Dict[str, str] = field(default_factory=lambda: dict(ROLE_MODELS))
    llm_cache: str = "auto"                # auto (on with a real model) | 1 | 0: the same reading prompt is not paid twice
    llm_cache_days: int = 30
    agent_cmd_timeout_s: int = 300         # one shell command of an agent; a dev server or watcher cannot hold a call
    # supervisor (line.supervisor): a failed run is settled by an agent first, a person only for high impact
    supervisor: str = "auto"               # auto (on with a real model) | 1 | 0
    supervise_max_retries: int = 2         # supervised re-runs of one request before a person decides
    supervise_max_usd: float = 3.0         # what those re-runs may spend together before a person decides
    # acceptance tests run where they will run (line.understand.test_here) before they are locked
    tests_here: str = "auto"               # auto (on with a real model) | 1 | 0
    tests_here_max_usd: float = 1.5        # the one agent round that fixes tests broken for the machine
    # code graph (line.codegraph): Graphify indexes the target repository locally (AST, no model) for the agents
    codegraph: str = "auto"                # auto (on when graphify is installed) | 1 | 0
    graphify: str = ""                     # graphify executable; "" = DLC_HOME/tools/graphify, then PATH
    codegraph_dir: str = ""                # where the indexes live; "" = <workroot>/codegraph (never in the repository)
    codegraph_timeout_s: int = 300
    merger: str = "auto"                  # auto (on with a real model) | 1 | 0: an agent resolves merge conflicts
    merger_max_turns: int = 40
    merger_max_usd: float = 2.0            # per merger call
    merger_max_calls: int = 2              # merger calls per unit before the unit goes back to its builder
    dry_pack: str = ""                     # fake LLM: samples/<pack> dir (fixtures under dry/)

    # RAG System
    rag: str = "off"                       # off | http
    rag_url: str = ""                      # required when rag=http (env or the local RAG wire config)
    rag_ns: str = "sdlc_line"             # namespace ids: lower case, digits, "_" (no "-")
    rag_client_id: str = ""                # env only
    rag_client_secret: str = ""            # env only
    rag_timeout_s: float = 15.0
    rag_retrieve_max_chars: int = 6000
    rag_extra: Dict[str, Any] = field(default_factory=dict)   # wire details from the local RAG wire config

    # leases / watchdog
    lease_ttl_s: int = 300
    heartbeat_s: int = 60
    watchdog_s: int = 15
    cancel_join_s: float = 30.0            # cancel / run end: bounded join of the builder threads
    auto_resume: bool = False              # server start: resume every non-final run (opt-in)

    # build loop
    retry_n: int = 3                       # retry ladder: N attempts with evidence -> switch model -> escalate
    unit_max_files: int = 8
    reread_max: int = 2
    fixer_generations: int = 2
    max_parallel_units: int = 3
    stack: str = "auto"                    # target stack: auto | python-unittest | node-cap | node-ui5-ts | react
    migrate_parallel: int = 3              # feature migration: repositories scanned at once (estate)
    migrate_max_usd: float = 50.0          # feature migration: budget of the whole migration (its own calls)
    migrate_max_usd_repo: float = 3.0      # feature migration: budget of one repository's scan

    # ship
    deploy_windows: List[str] = field(default_factory=list)   # [] on dev = deploy when queue drains; else "HH:MM-HH:MM"
    qas_repeats: int = 3

    # budget
    budget_warn_ratio: float = 0.8

    # ---- wave 4 (every feature off by default)
    # reconciler (line.reconciler) and RAG-backed state (line.rag_state)
    reconcile: bool = False                # server thread + one pass before a resumed drive
    reconcile_s: int = 300
    reconcile_dry_run: bool = False
    reconcile_unsynced_s: int = 600
    rag_leases: bool = False               # leases from the RAG System for runs admitted with RAG authority
    rag_records: bool = False              # mirror run / unit / digest / test / graph rows as RAG records

    # understand plus (line.understand_plus): gaps, assumptions, one human round, addendum, conflicts
    uplus_enabled: bool = False
    uplus_gaps: bool = True
    uplus_conflicts: bool = True
    uplus_park_scope: str = "run"          # run | f_item
    uplus_spec_supersede: bool = True
    uplus_unscanned_asks: bool = False
    uplus_graph: str = "system"
    uplus_graph_mirror: bool = True
    uplus_max_hops: int = 3
    uplus_pack_major: int = 1
    human_max_open: int = 3
    human_due_workdays: int = 2
    human_remind_workdays: int = 1
    dry_human: str = ""                    # "" | auto (dry runs answer their own questions from fixtures)
    human_mode: str = "ask"                # ask: park and wait for a person | decide: the model decides and records it
    human_decide_model: str = ""           # model for human_mode=decide (empty: judge_model)
    # feature graph (line.fgraph): dependency-ordered build; off by default
    fgraph_enabled: bool = False
    # seal (line.seal, docs/dlc/seal-and-scan.md): ledger, per-file claims, async scoring, merge only
    # finalised seals, speculation on pending work; all off by default
    seal_enabled: bool = False
    seal_depth: int = 2                    # longest chain of unsealed producers a unit may build on
    seal_governor_fail: float = 0.2        # recent seal failure rate above which new speculation stops
    seal_l2_paths: List[str] = field(default_factory=list)   # claim globs whose change needs a person's sign-off
    scan_cache: str = ""                   # migration scans: "" off | "1" per migration | <dir> shared cache

    # review (line.review): clean-context reviewer, drift ladder, judge
    review_enabled: bool = False
    review_model: str = ""
    review_block_severity: str = "major"
    review_max_findings: int = 10
    review_max_rounds: int = 2
    review_max_diff_chars: int = 40000
    drift_enabled: bool = False
    drift_threshold: int = 2
    judge_enabled: bool = False
    judge_model: str = "claude-opus-5-5"
    judge_max_decisions: int = 3
    judge_history: int = 8
    decision_log: str = ""

    # learning loop (line.learn), agent directory (line.agents_dir), observability (line.observe)
    learn_enabled: bool = False
    learn_path: str = ""
    learn_stack: str = "python"
    learn_serve_max_chars: int = 1500
    learn_canary_ratio: float = 0.2
    learn_holdback_ratio: float = 0.1
    learn_min_sample: int = 30
    learn_harm_min_sample: int = 10
    learn_max_sample: int = 120
    learn_margin: float = 0.05
    learn_ttl_days: int = 90
    learn_distiller_model: str = ""
    learn_judge_model: str = ""
    learn_eval_path: str = ""
    learn_holdout_max: int = 8
    agents_enabled: bool = False
    agents_canary_ratio: float = 0.05
    agents_shadow_min: int = 5
    agents_shadow_agree: float = 0.8
    agents_margin: float = 0.05
    slo_min_sample: int = 10
    slo_window: int = 50
    slo_min_success: float = 0.7
    slo_max_escalation: float = 0.2
    slo_max_usd_per_unit: float = 0.0
    slo_max_latency_p95_s: float = 0.0
    obs_enabled: bool = False

    # deployment profile + operations (server)
    profile: str = ""                      # "" | agents (no person answers: human_mode decide, agent cap 10, auto resume)
    max_active_agents: int = 0             # model calls in flight across every run of this server; 0 = no cap
    auth_issuer: str = ""                  # OIDC realm URL (Keycloak); empty = no authentication
    auth_audience: str = "dlc-api"         # the token's aud (or azp) must contain this
    auth_role_user: str = "dlc-user"       # role needed for every protected route
    auth_role_admin: str = "dlc-admin"     # role needed for cancel and app stop
    auth_board_client: str = "dlc-fe"      # public OIDC client the board signs in with (Authorization Code + PKCE)
    auth_jwks_ttl_s: int = 600             # realm signing keys cache

    # processes configured in Dify (line.difyproc): the flow decides, the line executes
    process_source: str = "line"           # line: the built-in order | dify: one Dify workflow app per process
    dify_url: str = ""                     # Dify base URL (its service API is <dify_url>/v1)
    dify_flows: str = ""                   # JSON {process id: app key}; "*" = any other process
    dify_timeout_s: int = 300              # one stretch of a process run (until it pauses or ends)
    dify_max_request: int = 8000           # characters of spec.md sent to the process as its request
    auth_leeway_s: int = 60                # clock skew allowed on exp / nbf
    public_host: str = ""                  # host name / IP in the URL of a started app; empty = this host's IP
    app_ports: str = "18000-18099"         # port range for started apps ("a-b" or "a,b,c")
    app_start_timeout_s: int = 60          # wait this long for a started app to answer its health check

    def public(self) -> Dict[str, Any]:
        """As a dict with secrets masked (for logs, /api/health)."""
        d = dataclasses.asdict(self)
        if d.get("rag_client_secret"):
            d["rag_client_secret"] = "***"
        return d


#: env var -> Config field
ENV_MAP: Dict[str, str] = {
    "LINE_DB": "db",
    "LINE_HOST": "host",
    "LINE_PORT": "port",
    "LINE_WORKROOT": "workroot",
    "LINE_AGENT_VERSION": "agent_version",
    "LINE_LLM": "llm",
    "LINE_MODEL": "model",
    "LINE_MODEL_ALT": "model_alt",
    "LINE_MAX_USD_CALL": "max_usd_call",
    "LINE_MAX_USD_RUN": "max_usd_run",
    "LINE_PRICING": "pricing",
    "LINE_BUILDER_MAX_TURNS": "builder_max_turns",
    "LINE_SPEC_ANALYST": "spec_analyst",
    "LINE_SPEC_ANALYST_MAX_TURNS": "spec_analyst_max_turns",
    "LINE_LANES": "lanes",
    "LINE_SIZER_MAX_TURNS": "sizer_max_turns",
    "LINE_SIZER_MAX_USD": "sizer_max_usd",
    "LINE_MAX_LEVEL": "max_level",
    "LINE_ARBITER": "arbiter",
    "LINE_ARBITER_MAX": "arbiter_max",
    "LINE_SOLO": "solo",
    "LINE_SOLO_MAX_TURNS": "solo_max_turns",
    "LINE_SOLO_LEAD": "solo_lead",
    "LINE_GATES": "gates",
    "LINE_GATE_ROUNDS": "gate_rounds",
    "LINE_GATE_PLAN_USD": "gate_plan_usd",
    "LINE_GATE_PLAN_TURNS": "gate_plan_turns",
    "LINE_PROCESS_DIR": "process_dir",
    "LINE_SIZER_PERSONA": "sizer_persona",
    "LINE_RETRO_PERSONAS": "retro_personas",
    "LINE_SOLO_MAX_USD": "solo_max_usd",
    "LINE_SOLO_FIX_ROUNDS": "solo_fix_rounds",
    "LINE_SOLO_REVIEW": "solo_review",
    "LINE_SPEC_DESIGN": "spec_design",
    "LINE_SPEC_DESIGN_PROJECT": "spec_design_project",
    "LINE_RAG_HELPER": "kh_helper",
    "LINE_ROLE_MODELS": "role_models",
    "LINE_LLM_CACHE": "llm_cache",
    "LINE_LLM_CACHE_DAYS": "llm_cache_days",
    "LINE_AGENT_CMD_TIMEOUT_S": "agent_cmd_timeout_s",
    "LINE_SUPERVISOR": "supervisor",
    "LINE_SUPERVISE_MAX_RETRIES": "supervise_max_retries",
    "LINE_SUPERVISE_MAX_USD": "supervise_max_usd",
    "LINE_TESTS_HERE": "tests_here",
    "LINE_TESTS_HERE_MAX_USD": "tests_here_max_usd",
    "LINE_CODEGRAPH": "codegraph",
    "LINE_GRAPHIFY": "graphify",
    "LINE_CODEGRAPH_DIR": "codegraph_dir",
    "LINE_CODEGRAPH_TIMEOUT_S": "codegraph_timeout_s",
    "LINE_MERGER": "merger",
    "LINE_MERGER_MAX_TURNS": "merger_max_turns",
    "LINE_MERGER_MAX_USD": "merger_max_usd",
    "LINE_MERGER_MAX_CALLS": "merger_max_calls",
    "LINE_DRY_PACK": "dry_pack",
    "LINE_RAG": "rag",
    "LINE_RAG_URL": "rag_url",
    "LINE_RAG_NS": "rag_ns",
    "LINE_RAG_CLIENT_ID": "rag_client_id",
    "LINE_RAG_CLIENT_SECRET": "rag_client_secret",
    "LINE_RAG_TIMEOUT_S": "rag_timeout_s",
    "LINE_RAG_RETRIEVE_MAX_CHARS": "rag_retrieve_max_chars",
    "LINE_LEASE_TTL_S": "lease_ttl_s",
    "LINE_HEARTBEAT_S": "heartbeat_s",
    "LINE_WATCHDOG_S": "watchdog_s",
    "LINE_CANCEL_JOIN_S": "cancel_join_s",
    "LINE_AUTO_RESUME": "auto_resume",
    "LINE_RETRY_N": "retry_n",
    "LINE_UNIT_MAX_FILES": "unit_max_files",
    "LINE_REREAD_MAX": "reread_max",
    "LINE_FIXER_GENERATIONS": "fixer_generations",
    "LINE_MAX_PARALLEL_UNITS": "max_parallel_units",
    "LINE_STACK": "stack",
    "LINE_MIGRATE_PARALLEL": "migrate_parallel",
    "LINE_MIGRATE_MAX_USD": "migrate_max_usd",
    "LINE_MIGRATE_MAX_USD_REPO": "migrate_max_usd_repo",
    "LINE_DEPLOY_WINDOWS": "deploy_windows",     # JSON list or comma-separated
    "LINE_QAS_REPEATS": "qas_repeats",
    "LINE_BUDGET_WARN_RATIO": "budget_warn_ratio",
    # wave 4
    "LINE_RECONCILE": "reconcile",
    "LINE_RECONCILE_S": "reconcile_s",
    "LINE_RECONCILE_DRY_RUN": "reconcile_dry_run",
    "LINE_RECONCILE_UNSYNCED_S": "reconcile_unsynced_s",
    "LINE_RAG_LEASES": "rag_leases",
    "LINE_RAG_RECORDS": "rag_records",
    "LINE_UPLUS": "uplus_enabled",
    "LINE_UPLUS_GAPS": "uplus_gaps",
    "LINE_UPLUS_CONFLICTS": "uplus_conflicts",
    "LINE_UPLUS_PARK_SCOPE": "uplus_park_scope",
    "LINE_UPLUS_SPEC_SUPERSEDE": "uplus_spec_supersede",
    "LINE_UPLUS_UNSCANNED_ASKS": "uplus_unscanned_asks",
    "LINE_UPLUS_GRAPH": "uplus_graph",
    "LINE_UPLUS_GRAPH_MIRROR": "uplus_graph_mirror",
    "LINE_UPLUS_MAX_HOPS": "uplus_max_hops",
    "LINE_UPLUS_PACK_MAJOR": "uplus_pack_major",
    "LINE_HUMAN_MAX_OPEN": "human_max_open",
    "LINE_HUMAN_DUE_WORKDAYS": "human_due_workdays",
    "LINE_HUMAN_REMIND_WORKDAYS": "human_remind_workdays",
    "LINE_DRY_HUMAN": "dry_human",
    "LINE_HUMAN_MODE": "human_mode",
    "LINE_HUMAN_DECIDE_MODEL": "human_decide_model",
    "LINE_FGRAPH": "fgraph_enabled",
    "LINE_SEAL": "seal_enabled",
    "LINE_SEAL_DEPTH": "seal_depth",
    "LINE_SEAL_GOVERNOR_FAIL": "seal_governor_fail",
    "LINE_SEAL_L2_PATHS": "seal_l2_paths",
    "LINE_SCAN_CACHE": "scan_cache",
    "LINE_REVIEW": "review_enabled",
    "LINE_REVIEW_MODEL": "review_model",
    "LINE_REVIEW_BLOCK": "review_block_severity",
    "LINE_REVIEW_MAX_FINDINGS": "review_max_findings",
    "LINE_REVIEW_MAX_ROUNDS": "review_max_rounds",
    "LINE_REVIEW_MAX_DIFF_CHARS": "review_max_diff_chars",
    "LINE_DRIFT": "drift_enabled",
    "LINE_DRIFT_THRESHOLD": "drift_threshold",
    "LINE_JUDGE": "judge_enabled",
    "LINE_JUDGE_MODEL": "judge_model",
    "LINE_JUDGE_MAX_DECISIONS": "judge_max_decisions",
    "LINE_JUDGE_HISTORY": "judge_history",
    "LINE_DECISION_LOG": "decision_log",
    "LINE_LEARN": "learn_enabled",
    "LINE_LEARN_ENABLED": "learn_enabled",
    "LINE_LEARN_PATH": "learn_path",
    "LINE_LEARN_STACK": "learn_stack",
    "LINE_LEARN_SERVE_MAX_CHARS": "learn_serve_max_chars",
    "LINE_LEARN_CANARY_RATIO": "learn_canary_ratio",
    "LINE_LEARN_HOLDBACK_RATIO": "learn_holdback_ratio",
    "LINE_LEARN_MIN_SAMPLE": "learn_min_sample",
    "LINE_LEARN_HARM_MIN_SAMPLE": "learn_harm_min_sample",
    "LINE_LEARN_MAX_SAMPLE": "learn_max_sample",
    "LINE_LEARN_MARGIN": "learn_margin",
    "LINE_LEARN_TTL_DAYS": "learn_ttl_days",
    "LINE_LEARN_DISTILLER_MODEL": "learn_distiller_model",
    "LINE_LEARN_JUDGE_MODEL": "learn_judge_model",
    "LINE_LEARN_EVAL_PATH": "learn_eval_path",
    "LINE_LEARN_HOLDOUT_MAX": "learn_holdout_max",
    "LINE_AGENTS": "agents_enabled",
    "LINE_AGENTS_ENABLED": "agents_enabled",
    "LINE_AGENTS_CANARY_RATIO": "agents_canary_ratio",
    "LINE_AGENTS_SHADOW_MIN": "agents_shadow_min",
    "LINE_AGENTS_SHADOW_AGREE": "agents_shadow_agree",
    "LINE_AGENTS_MARGIN": "agents_margin",
    "LINE_SLO_MIN_SAMPLE": "slo_min_sample",
    "LINE_SLO_WINDOW": "slo_window",
    "LINE_SLO_MIN_SUCCESS": "slo_min_success",
    "LINE_SLO_MAX_ESCALATION": "slo_max_escalation",
    "LINE_SLO_MAX_USD_PER_UNIT": "slo_max_usd_per_unit",
    "LINE_SLO_MAX_LATENCY_P95_S": "slo_max_latency_p95_s",
    "LINE_OBS": "obs_enabled",
    "LINE_OBS_ENABLED": "obs_enabled",
    "LINE_PROFILE": "profile",
    "LINE_MAX_ACTIVE_AGENTS": "max_active_agents",
    "LINE_AUTH_ISSUER": "auth_issuer",
    "LINE_AUTH_AUDIENCE": "auth_audience",
    "LINE_AUTH_ROLE_USER": "auth_role_user",
    "LINE_AUTH_ROLE_ADMIN": "auth_role_admin",
    "LINE_AUTH_BOARD_CLIENT": "auth_board_client",
    "LINE_AUTH_JWKS_TTL_S": "auth_jwks_ttl_s",
    "LINE_PROCESS_SOURCE": "process_source",
    "LINE_DIFY_URL": "dify_url",
    "LINE_DIFY_FLOWS": "dify_flows",
    "LINE_DIFY_TIMEOUT_S": "dify_timeout_s",
    "LINE_DIFY_MAX_REQUEST": "dify_max_request",
    "LINE_AUTH_LEEWAY_S": "auth_leeway_s",
    "LINE_PUBLIC_HOST": "public_host",
    "LINE_APP_PORTS": "app_ports",
    "LINE_APP_START_TIMEOUT_S": "app_start_timeout_s",
}

#: deployment profiles: defaults applied after line.json and before LINE_* env vars (env still wins)
PROFILES: Dict[str, Dict[str, Any]] = {
    "agents": {"human_mode": "decide", "max_active_agents": 10, "auto_resume": True, "max_parallel_units": 3},
}

#: wave 4 master switches (all off by default; the all_on e2e variant turns every one on)
W4_FLAGS = ("reconcile", "uplus_enabled", "review_enabled", "drift_enabled", "judge_enabled", "learn_enabled",
            "agents_enabled", "obs_enabled")

ENV_ONLY = frozenset({"rag_client_id", "rag_client_secret", "dify_flows"})


def _coerce(name: str, value: Any, kind: Any) -> Any:
    try:
        if kind in (int, "int"):
            return int(value)
        if kind in (float, "float"):
            return float(value)
        if kind in (str, "str"):
            return str(value)
        if kind in (bool, "bool"):
            if isinstance(value, bool):
                return value
            s = str(value).strip().lower()
            if s in ("1", "true", "yes", "on"):
                return True
            if s in ("0", "false", "no", "off", ""):
                return False
            raise ValueError(value)
        if name in ("deploy_windows", "seal_l2_paths"):
            if isinstance(value, list):
                return [str(x) for x in value]
            s = str(value).strip()
            if s.startswith("["):
                return [str(x) for x in json.loads(s)]
            return [x.strip() for x in s.split(",") if x.strip()]
        if name == "rag_extra":
            if isinstance(value, dict):
                return dict(value)
            return dict(json.loads(value))
        if name == "role_models":       # JSON object, or "role=model,role=model"; an empty model drops the role
            if isinstance(value, dict):
                pairs = value.items()
            else:
                s = str(value).strip()
                pairs = json.loads(s).items() if s.startswith("{") else \
                    [p.split("=", 1) for p in s.split(",") if "=" in p]
            return {str(k).strip(): str(v).strip() for k, v in pairs if str(k).strip() and str(v).strip()}
    except (TypeError, ValueError) as e:
        raise LineError(codes.CONFIG_INVALID, "bad value for %s: %r" % (name, value), {"field": name}) from e
    return value


def _types() -> Dict[str, Any]:
    out = {}
    for f in dataclasses.fields(Config):
        t = f.type if isinstance(f.type, str) else getattr(f.type, "__name__", str(f.type))
        out[f.name] = t
    return out


def _read_json(path: str) -> Dict[str, Any]:
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        raise LineError(codes.CONFIG_INVALID, "cannot read %s: %s" % (path, e), {"path": path}) from e
    if not isinstance(data, dict):
        raise LineError(codes.CONFIG_INVALID, "%s is not a JSON object" % path, {"path": path})
    return {k: v for k, v in data.items() if not k.startswith("_")}


def load_config(env: Optional[Mapping[str, str]] = None, line_json: Optional[str] = LINE_JSON,
                rag_local_json: Optional[str] = RAG_LOCAL_JSON, **overrides: Any) -> Config:
    """Build a Config. Pass env={} and line_json=None, rag_local_json=None for pure defaults (tests).
    overrides (field=value) win over everything."""
    env = os.environ if env is None else env
    if rag_local_json == RAG_LOCAL_JSON:
        rag_local_json = default_rag_local_json(env)
    types = _types()
    cfg = Config()
    fields = set(types)

    def apply(name: str, value: Any) -> None:
        if name not in fields:
            raise LineError(codes.CONFIG_INVALID, "unknown config key: %s" % name, {"field": name})
        setattr(cfg, name, _coerce(name, value, types[name]))

    for k, v in _read_json(line_json).items():
        if k not in ENV_ONLY:
            apply(k, v)
    for k, v in _read_json(rag_local_json).items():
        if k in ENV_ONLY:
            continue
        if k == "rag_extra" or k.startswith("rag_"):
            apply(k, v)
        else:  # generic wire keys go to rag_extra
            cfg.rag_extra[k] = v
    profile = str(overrides.get("profile") or env.get("LINE_PROFILE") or cfg.profile or "").strip()
    if profile:
        if profile not in PROFILES:
            raise LineError(codes.CONFIG_INVALID, "LINE_PROFILE must be one of %s" % (tuple(PROFILES),),
                            {"field": "profile"})
        for k, v in PROFILES[profile].items():
            apply(k, v)
    for var, name in ENV_MAP.items():
        if var in env and env[var] != "":
            apply(name, env[var])
    for k, v in overrides.items():
        apply(k, v)

    if cfg.llm not in LLM_MODES:
        raise LineError(codes.CONFIG_INVALID, "LINE_LLM must be one of %s" % (LLM_MODES,), {"field": "llm"})
    if cfg.rag not in RAG_MODES:
        raise LineError(codes.CONFIG_INVALID, "LINE_RAG must be one of %s" % (RAG_MODES,), {"field": "rag"})
    from . import stacks                                    # local: stacks never import config
    if cfg.stack not in stacks.names():
        raise LineError(codes.CONFIG_INVALID, "LINE_STACK must be one of %s" % (tuple(stacks.names()),),
                        {"field": "stack"})
    if cfg.rag == "http" and not cfg.rag_url:
        raise LineError(codes.CONFIG_INVALID, "LINE_RAG=http needs LINE_RAG_URL (or rag_url in the local RAG wire config)",
                        {"field": "rag_url"})
    return cfg
