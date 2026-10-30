"""Central configuration for KnowledgeHub — the single source of truth.

Every tunable comes from an environment variable (loaded once from a ``.env``
next to the app) with a sensible default, so a bare checkout still runs. All
other modules import their settings from here instead of calling ``os.getenv``
themselves — no duplicated definitions, no drift between modules.

Frozen (PyInstaller) note: the working directory of the launched exe may differ
from the exe's own folder, so we load ``.env`` from the app root explicitly
rather than relying on ``load_dotenv()``'s cwd walk.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

# App root = folder holding the exe (frozen) or the KnowledgeHub project dir.
_APP_ROOT = (
    os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
    else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
load_dotenv(os.path.join(_APP_ROOT, ".env"))   # authoritative for the exe
load_dotenv()                                   # dev convenience: cwd/ancestors


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip('"').lower() == "true"


def _env(name: str, default: str) -> str:
    """A variable's value, or ``default`` when it is unset OR blank - so a ``KEY=`` line
    left empty in .env means "use the default" instead of failing to parse."""
    return os.getenv(name, "").strip().strip('"') or default


def _flag(name: str, default: str) -> bool:
    """Like _bool, but a blank value falls back to the default (see _env)."""
    return _env(name, default).lower() == "true"


_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _identifier(name: str, default: str) -> str:
    """A table name or prefix read from the environment, refused unless it is a bare SQL
    identifier. These values are spliced into DDL and queries, so a stray quote or space
    must stop the server at startup instead of reaching the database."""
    value = _env(name, default)
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"{name}={value!r} is not a valid SQL identifier "
                         "(letters, digits and underscore, not starting with a digit)")
    return value


def _anchor(path: str) -> str:
    """Resolve a relative storage path against the app root, never the cwd.

    A frozen exe's working directory is frequently NOT its own folder — launched
    from a tray/Start-menu shortcut or double-click, cwd can be System32 or the
    user profile. A bare './chroma_data' then points at an empty dir next to
    wherever the process happened to start, silently ignoring the real data
    beside the exe (symptom: docs=0 at startup, then chromadb
    "Collection ... does not exist" on the first query). Anchoring relative paths
    to _APP_ROOT makes storage deterministic regardless of cwd. Absolute paths
    from .env are honoured as-is.
    """
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(_APP_ROOT, path))


# ── HTTP server ───────────────────────────────────────────────────────────────
HOST = os.getenv("KH_HOST", "0.0.0.0")
# Cloud Foundry hands the app its port in PORT; KH_PORT still wins when set.
PORT = int(os.getenv("KH_PORT") or os.getenv("PORT") or "8000")


# ── Version (authoritative marker) ───────────────────────────────────────────
# Resolution order: KH_VERSION env → a VERSION file at the app root → default.
# Exposed via GET /version so callers never rely on a hand-maintained knowledge
# node that drifts (the "version says v6.1 but prod is v6.2" bug).
def _resolve_version() -> tuple[str, str]:
    env = os.getenv("KH_VERSION", "").strip()
    if env:
        return env, "env:KH_VERSION"
    vpath = os.path.join(_APP_ROOT, "VERSION")
    try:
        with open(vpath, encoding="utf-8") as f:
            v = f.read().strip()
        if v:
            return v, "file:VERSION"
    except OSError:
        pass
    return "v6.5", "default"


KH_VERSION, KH_VERSION_SOURCE = _resolve_version()

# ── Vision (Florence-2) ──────────────────────────────────────────────────────
# Florence-2 is only needed by /vision/locate-ui, so it is loaded lazily on the
# first vision request rather than blocking startup (~9s). When PRELOAD_VISION is
# true the model is still warmed in a background thread AFTER the server reports
# ready, so the first vision call stays fast without delaying cold start.
PRELOAD_VISION = _bool("KH_PRELOAD_VISION", "true")

# ── Embedding model + vector store (ChromaDB) ────────────────────────────────
EMBEDDING_MODEL = os.getenv("KH_EMBEDDING_MODEL", "bge-small-en-v1.5")

# ── Where the embeddings are computed (app/embeddings/remote.py, app/embed_server.py) ─────────
# local  = the model runs in this process (default, unchanged behaviour)
# remote = a separate embed service computes every vector; no model is loaded here (saves RAM);
#          when the service is down, routes that need a vector answer 503 embedder_unavailable
# auto   = the embed service first; on failure this process loads the model once and carries on,
#          and stays local for KH_EMBED_COOLDOWN_S after KH_EMBED_FAIL_THRESHOLD failures in a row
# There is no default URL: remote/auto without KH_EMBED_URL stops startup.
EMBEDDER = _env("KH_EMBEDDER", "local").lower()
EMBED_URL = _env("KH_EMBED_URL", "").rstrip("/")
EMBED_TOKEN = os.getenv("KH_EMBED_TOKEN", "").strip()          # shared bearer secret; env only, never logged
EMBED_TIMEOUT_S = float(_env("KH_EMBED_TIMEOUT_S", "15"))
EMBED_BATCH_MAX = int(_env("KH_EMBED_BATCH_MAX", "64"))        # texts per request from this process
EMBED_RETRIES = int(_env("KH_EMBED_RETRIES", "2"))             # extra tries on 429 / 5xx / timeout
EMBED_FAIL_THRESHOLD = int(_env("KH_EMBED_FAIL_THRESHOLD", "3"))
EMBED_COOLDOWN_S = float(_env("KH_EMBED_COOLDOWN_S", "60"))
# embed service side
EMBED_BATCH_WINDOW_MS = float(_env("KH_EMBED_BATCH_WINDOW_MS", "5"))
EMBED_MAX_BATCH = int(_env("KH_EMBED_MAX_BATCH", "64"))        # texts encoded together in one forward pass
EMBED_MAX_TEXTS = int(_env("KH_EMBED_MAX_TEXTS", "256"))       # texts per request
# Above anything 512 tokens can cover, so the cut never changes a vector (the model stops at 512 tokens).
EMBED_MAX_CHARS = int(_env("KH_EMBED_MAX_CHARS", "20000"))
EMBED_MAX_BODY = int(_env("KH_EMBED_MAX_BODY", str(8 * 1024 * 1024)))
EMBED_THREADS = int(_env("KH_EMBED_THREADS", "0"))             # torch threads in the service; 0 = torch default
EMBED_ALLOW_NO_TOKEN = _flag("KH_EMBED_ALLOW_NO_TOKEN", "false")

# Where the embedding weights live on disk. The service .exe ships CODE ONLY:
# Seed-Data.ps1 drops the ~470 MB of weights into <deploy>/Slaves/KnowledgeHub/models
# AFTER packaging, and that is NOT where __file__ resolves inside a frozen build
# (there it points at dist/_internal/models, the bundled copy, which the installer
# leaves empty). Resolving from __file__ alone therefore misses the seeded weights
# in a shipped install and silently re-downloads the model on first launch.
#
# So probe candidates in order and let the one that already holds the model win.
# The layouts that exist in practice: dist/KnowledgeHub.exe with models beside the
# service dir (installer output), a flat copy with models next to the exe, and the
# bundled dist/_internal/models. KH_MODEL_DIR overrides the lot.
def _model_roots() -> list[Path]:
    override = os.getenv("KH_MODEL_DIR", "").strip().strip('"')
    if override:
        return [Path(override)]
    bundled = Path(__file__).resolve().parent.parent / "models"
    if not getattr(sys, "frozen", False):
        return [bundled]
    exe_dir = Path(sys.executable).resolve().parent
    roots = []
    # Installer layout only: the exe sits in the PyInstaller output dir, so the
    # seeded weights are one level up, beside it. Guarded on the dir NAME rather
    # than climbing unconditionally — for a flat install like C:/Apps/KH/kh.exe
    # an unguarded parent would point at C:/Apps/models, outside the install root
    # and possibly owned by something else entirely.
    if exe_dir.name == "dist":
        roots.append(exe_dir.parent / "models")
    roots.append(exe_dir / "models")
    roots.append(bundled)
    return roots


MODEL_ROOTS = _model_roots()


def resolve_model_dir(name: str) -> Path:
    """Directory holding *name*'s weights.

    Returns the first candidate root that already contains a COMPLETE save —
    SentenceTransformer.save() writes config_sentence_transformers.json last, so
    its presence rules out a half-written cache. If no candidate has the model,
    the first root is returned: that is where a fresh download gets saved.
    """
    for root in MODEL_ROOTS:
        if (root / name / "config_sentence_transformers.json").exists():
            return root / name
    return MODEL_ROOTS[0] / name

CHROMA_PATH     = _anchor(os.getenv("CHROMA_PATH", "./chroma_data"))
COLLECTION_NAME = os.getenv("KH_COLLECTION", "knowledge_hub_vectors")

# Dedicated collection for standardized/canonical KEYS (entity-resolution index).
# Same embedding model + Chroma client as COLLECTION_NAME, but a SEPARATE namespace
# so a canonicalization lookup ("qua chuoi" → core_id "banana") ranks against other
# keys only, instead of competing with — and losing top-rank to — knowledge chunks.
KEYS_COLLECTION_NAME = os.getenv("KH_KEYS_COLLECTION", "knowledge_hub_keys")

# ── One switch for every store ───────────────────────────────────────────────
# KH has three stores and each has its own backend variable (GRAPH_BACKEND,
# KH_STORE_BACKEND, KH_VECTOR_BACKEND, below). Moving a deployment onto HANA meant
# setting all three and getting none of them wrong. KH_DB_BACKEND names a preset that
# fills all three at once; a store's own variable, when set, still wins, so an existing
# .env or manifest keeps meaning exactly what it meant. Unset = the historical defaults.
# A new preset is a new row in this table, not a change to the code below it.
_DB_PRESETS = {
    "local": {"graph": "kuzu", "store": "sqlite", "vector": "chroma"},
    "hana":  {"graph": "hana", "store": "hana",   "vector": "hana"},
}
DB_BACKEND = _env("KH_DB_BACKEND", "").lower()
if DB_BACKEND and DB_BACKEND not in _DB_PRESETS:
    raise ValueError(f"KH_DB_BACKEND={DB_BACKEND!r} is not one of {sorted(_DB_PRESETS)}")
_DB_PRESET = _DB_PRESETS.get(DB_BACKEND, {})


def _backend(name: str, store: str, default: str) -> str:
    """A store's backend: its own variable, else the KH_DB_BACKEND preset, else default."""
    return (_env(name, "") or _DB_PRESET.get(store) or default).lower()


# ── Graph store ──────────────────────────────────────────────────────────────
# Backend selection: "auto" = probe SAP HANA then fall back to Kùzu (default);
# "kuzu" = skip the HANA probe entirely (saves a ~4s connect timeout when HANA
# isn't running); "hana" = require HANA, no Kùzu fallback.
GRAPH_BACKEND = _backend("GRAPH_BACKEND", "graph", "auto")
KUZU_PATH = _anchor(os.getenv("KUZU_PATH", "./kuzu_data"))

# Per-project graph root (B3). This Kùzu build uses SINGLE-FILE databases, so the
# legacy global DB file (KUZU_PATH = ./kuzu_data) cannot double as a directory of
# per-project subdirs. Each project therefore gets ITS OWN directory here holding a
# graph.kuzu file: kuzu_projects/<project>/graph.kuzu — physical isolation, and
# deleting a project is rmtree of one directory (SA-6).
KUZU_PROJECTS_PATH = _anchor(os.getenv("KH_KUZU_PROJECTS_PATH", "./kuzu_projects"))

# ── Per-project resource bounds (memory scaling for many projects) ────────────
# Physical per-project isolation loads a project's stores LAZILY, but nothing is
# freed once opened. With dozens of projects that grows unbounded. So we (1) cap
# each per-project Kùzu database's buffer pool (the Kùzu DEFAULT reserves ~80% of
# system RAM PER database — unusable once many graphs open), and (2) LRU-evict the
# least-recently-used open project graphs + source vector-collection handles,
# keeping at most N resident.
#
# Defaults sized for LARGE projects (e.g. simplemdg-v1: 322 repos, ~500k entities+
# relations): a ~500k-node Kùzu graph is ~200–400MB on disk, so a 1GB buffer pool
# caches it whole for fast traversal. Worst-case resident cache =
# MAX_OPEN_PROJECT_GRAPHS × buffer_pool + MAX_OPEN_SOURCE_COLLECTIONS × ~HNSW size
# ≈ 4×1GB + 8×~0.1GB ≈ ~5GB — a safe slice of a 32GB machine, and lazy (only hot
# pages are actually resident). Override per-env if you scan bigger or smaller.
# Cache is demand-driven: a project graph/collection is opened only when its data is
# actually accessed (routing/switch alone does NOT open it), and every access marks it
# most-recently-used. So the active working set stays hot and only the least-recently-
# used project is evicted when a new one pushes past the cap. fen works with ~3-4
# projects at a time, so the cap is set a little ABOVE that (6) to leave headroom for
# occasional one-off lookups without evicting an active project (avoids reopen thrash).
KUZU_BUFFER_POOL_BYTES = int(os.getenv("KH_KUZU_BUFFER_POOL_MB", "1024")) * 1024 * 1024
MAX_OPEN_PROJECT_GRAPHS = int(os.getenv("KH_MAX_OPEN_PROJECTS", "6"))
MAX_OPEN_SOURCE_COLLECTIONS = int(os.getenv("KH_MAX_OPEN_COLLECTIONS", "10"))

# ── Hot log window (recency without naming a project) ────────────────────────
# Per-project log isolation means a recency question ("what happened with X?")
# can only be answered after the project is resolved, and a cross-project answer
# means scanning every project's log. The hot window fixes that: EVERY worklog is
# written to ONE shared partition first, tagged with the project that owns it, and
# reads with no project named touch that partition alone.
#
# The window is a set of SLOTS, one per project — NOT a row count. A slot holds all
# of that project's recent entries, so several days of work stay answerable. The
# slot count deliberately matches MAX_OPEN_PROJECT_GRAPHS: a project hot in the
# graph cache is hot in the log window, and both evict least-recently-used, so the
# two windows track each other instead of drifting apart.
#
# Nothing is ever lost. Evicting a slot SPILLS it into that project's own log
# collection (copy, verify, then delete), so kh_log_<project> stays the system of
# record and the hot window is only a cache in front of it.
HOTLOG_ENABLED = os.getenv("KH_HOTLOG", "1").lower() not in ("0", "false", "no")
HOTLOG_SLOTS = int(os.getenv("KH_HOTLOG_SLOTS", str(MAX_OPEN_PROJECT_GRAPHS)))
# Second bound: a project worked for weeks would otherwise grow one slot without
# limit and the window would stop being small. Whichever cap is hit first spills.
HOTLOG_MAX_PER_SLOT = int(os.getenv("KH_HOTLOG_MAX_PER_SLOT", "50"))
HOTLOG_MAX_AGE_DAYS = int(os.getenv("KH_HOTLOG_MAX_AGE_DAYS", "14"))
# The scope that gets the window. Only worklogs; knowledge and findings are not
# recency-shaped and keep writing straight to their own project part.
HOTLOG_SCOPE = os.getenv("KH_HOTLOG_SCOPE", "log")

# ── Messages (fen 2026-09-29, three channels since 2026-10-16, app/messages.py) ──
# direct: to one person's mailbox, kept until that person (or a maintainer) deletes it.
# project: a channel every member reads, @mentions notify; gone after MSG_PROJECT_TTL_HOURS.
# realm: announcements to everyone, kept in MSG_REALM_PROJECT for MSG_REALM_TTL_HOURS.
# The cron archives expired project and realm messages and drops archive rows older than
# MSG_ARCHIVE_DAYS.
MSG_CRON_ENABLED = _flag("KH_MESSAGE_CRON", "true")
MSG_CRON_MINUTES = int(_env("KH_MESSAGE_CRON_MINUTES", "10"))
MSG_ARCHIVE_DAYS = int(_env("KH_MESSAGE_ARCHIVE_DAYS", "100"))
MSG_PROJECT_TTL_HOURS = int(_env("KH_MESSAGE_PROJECT_TTL_HOURS", "24"))
MSG_REALM_TTL_HOURS = int(_env("KH_MESSAGE_REALM_TTL_HOURS", "72"))
MSG_REALM_PROJECT = _env("KH_MESSAGE_REALM_PROJECT", "lesson-learned").strip()
MSG_MAX_CHARS = int(_env("KH_MESSAGE_MAX_CHARS", "4000"))
# A session (actor, app/auth.py ACTORS) is listed by GET /messages/actors until it has not asked for its
# messages for this long; the cron then forgets it.
MSG_ACTOR_TTL_HOURS = int(_env("KH_MESSAGE_ACTOR_TTL_HOURS", "24"))
# A session's project binding (app/session_project.py) is gone this long after it was last used.
SESSION_BINDING_TTL_HOURS = float(_env("KH_SESSION_BINDING_TTL_HOURS", "72"))
# With sign-in off (the local single-user install) this is who sends and reads.
MSG_LOCAL_USER = _env("KH_MESSAGE_LOCAL_USER", "local").lower()

# ── Project bundles (v6.4 isolation model) ───────────────────────────────────
# The unit of isolation is a PROJECT, not a repo or a tool. Every project (the
# orchestrator included) is a uniform BUNDLE that binds together its physical
# parts: vector + graph + knowledge(C4) + log + findings + policy + counter.
# PROJECTS_PATH is the filesystem home for the file-based parts (counter, bundle
# descriptor); vector/knowledge/log/findings/policy live in Chroma collections
# and graph in a per-project Kùzu dir — all bound by the manifest. See app/projects.py.
PROJECTS_PATH = _anchor(os.getenv("KH_PROJECTS_PATH", "./projects"))

# Below this folded length, a KEYWORD-only match is too weak to ROUTE on.
#
# WHY THIS EXISTS (measured 2026-09-07). fen wrote "toi can nang cap hook ..." —
# a request about the Claude hooks. `_fold` strips diacritics, so "nâng cấp"
# becomes "nang cap", and simplemdg-v1's 3-char keyword "cap" matched the second
# SYLLABLE as a standalone word. project_match answered best=simplemdg-v1 with
# ambiguous=false, i.e. confidently wrong, and a caller obeying the kernel would
# have scoped the whole turn — policy, knowledge, log, findings — to the wrong
# project. Vietnamese is written with spaces between SYLLABLES, not words, so any
# short keyword collides with ordinary prose at a high rate.
#
# WHY NOT SIMPLY DROP SHORT KEYWORDS, which was the first proposal: auditing all
# 228 registry terms showed a length floor would delete 18 keywords fen actually
# types — sap, mdg, ui5, ocr, btp, sla, sso, tkg, evo, pii. Length is not the
# defect; ROUTING on a length-3 keyword alone is. So short keywords still MATCH
# and are still reported, they just cannot be the confident `best`: the answer
# becomes "no project", which is a real answer the caller already handles.
PROJECT_MATCH_WEAK_KEYWORD_LEN = int(os.getenv("KH_PROJECT_MATCH_WEAK_KEYWORD_LEN", "4"))

# How long a process trusts its copy of the project visibility table (app/project_access.py).
# Every permission check reads it; a change made on another instance shows here within this time.
PROJECT_ACCESS_CACHE_S = float(os.getenv("KH_PROJECT_ACCESS_CACHE_S", "5"))

# ── Hook rules store (SQLite, plain-text policies keyed by Claude hook type) ──
# Claude Code hooks (SessionStart / UserPromptSubmit / PreToolUse / Stop / ...)
# fetch their FULL rule text from GET /hooks/get?hook_type=<T> at fire time, so
# changing a rule is a single DB write — no settings.json edit, no regex, no
# semantic ranking, no truncation. See app/hooks/.
HOOKS_DB_PATH = _anchor(os.getenv("KH_HOOKS_DB", "./hooks.db"))
# How long a SQLite write waits on a lock held by another process before failing, and
# whether the file runs in WAL mode (lets readers work while a writer holds the lock).
SQLITE_TIMEOUT_S = float(_env("KH_SQLITE_TIMEOUT", "10"))
SQLITE_WAL = _flag("KH_SQLITE_WAL", "true")

# ── Local LLM: REMOVED (v6+) ─────────────────────────────────────────────────
# KH no longer calls any local LLM (Ollama/LLMHub). Claude Code is the sole
# reasoning layer; all LLM-dependent endpoints/config were removed.

# ── Retrieval / chunking ─────────────────────────────────────────────────────
VECTOR_SCORE_THRESHOLD = float(os.getenv("VECTOR_SCORE_THRESHOLD", "0.35"))
ONTOLOGY_HOPS          = int(os.getenv("ONTOLOGY_HOPS", "3"))
CHUNK_WORD_THRESHOLD   = int(os.getenv("CHUNK_WORD_THRESHOLD", "200"))

# ── SAP HANA (optional graph backend) ────────────────────────────────────────
# On SAP BTP Cloud Foundry the credentials arrive through a service binding in
# VCAP_SERVICES instead of HANA_* variables. An explicit HANA_* variable always
# wins; the binding only fills what is unset, so a local .env is never overridden.
def _hana_binding() -> dict:
    """Credentials of the first bound HANA service, or {} off Cloud Foundry."""
    import json
    raw = os.getenv("VCAP_SERVICES", "").strip()
    if not raw:
        return {}
    try:
        services = json.loads(raw)
    except ValueError:
        return {}
    wanted = os.getenv("KH_HANA_SERVICE", "").strip()
    for label, instances in services.items():
        for inst in instances or []:
            tags = inst.get("tags") or []
            if wanted and inst.get("name") != wanted:
                continue
            if label == "hana" or "hana" in tags:
                return inst.get("credentials") or {}
    return {}


_HANA_BOUND = _hana_binding()

HANA_HOST       = os.getenv("HANA_HOST") or _HANA_BOUND.get("host") or "localhost"
HANA_PORT       = int(os.getenv("HANA_PORT") or _HANA_BOUND.get("port") or "39041")
HANA_USER       = os.getenv("HANA_USERNAME") or _HANA_BOUND.get("user") or "SYSTEM"
HANA_PASSWORD   = os.getenv("HANA_PASSWORD") or _HANA_BOUND.get("password") or ""
HANA_SCHEMA     = os.getenv("HANA_SCHEMA") or _HANA_BOUND.get("schema") or "KNOWLEDGE_HUB"
HANA_POOL_SIZE  = int(os.getenv("HANA_POOL_SIZE", "5"))
# A bound HANA Cloud instance only accepts TLS, so a binding turns encryption on.
HANA_ENCRYPT    = _bool("HANA_ENCRYPT", "true" if _HANA_BOUND else "false")
# Check the server certificate on an encrypted connection. Off only for a local HANA
# Express with a self-signed certificate; never off against HANA Cloud.
HANA_SSL_VALIDATE = _flag("HANA_SSL_VALIDATE", "true")
# Milliseconds a connect may take before hdbcli gives up; 0 = the driver's own default.
HANA_CONNECT_TIMEOUT_MS = int(_env("HANA_CONNECT_TIMEOUT_MS", "0"))
# Pool behaviour. HANA_POOL_SIZE connections are kept; up to HANA_MAX_OVERFLOW more may
# be opened under load and are closed again when returned. A connection older than
# HANA_POOL_RECYCLE seconds is closed instead of reused (0 = never), which keeps a
# long-lived process from holding a session the server or a proxy has quietly dropped.
# A caller waits at most the pool timeout for a free connection: the stores pool keeps
# 30 s and the graph pool 10 s, the values each had when they were hardcoded.
HANA_MAX_OVERFLOW       = int(_env("HANA_MAX_OVERFLOW", "0"))
HANA_POOL_RECYCLE_S     = int(_env("HANA_POOL_RECYCLE", "0"))
HANA_POOL_TIMEOUT_S     = float(_env("HANA_POOL_TIMEOUT", "30"))
HANA_GRAPH_POOL_TIMEOUT_S = float(_env("HANA_GRAPH_POOL_TIMEOUT", "10"))
GRAPH_WORKSPACE = os.getenv("HANA_GRAPH_WORKSPACE", "KH_GRAPH_WORKSPACE")

# Table names KH creates for itself, so two deployments can share one schema without
# colliding. Defaults are the names already in use; changing one on a live install
# points KH at an EMPTY table, so migrate first. The project graph prefix is derived
# from the graph prefix (KH_ -> KH_P_<project>_...).
GRAPH_TABLE_PREFIX       = _identifier("KH_GRAPH_TABLE_PREFIX", "KH_")
HANA_VEC_COLLECTIONS_TABLE = _identifier("KH_HANA_VEC_COLLECTIONS_TABLE", "KH_VEC_COLLECTIONS")
HANA_VEC_ROWS_TABLE      = _identifier("KH_HANA_VEC_ROWS_TABLE", "KH_VEC_ROWS")
DOCS_TABLE               = _identifier("KH_DOCS_TABLE", "kh_docs")

# ── Storage backends (local default = the files beside the exe) ─────────────
# KH_STORE_BACKEND picks where KH's OWN relational tables live (hook_rules, the
# policy action table, the project registry): "sqlite" = HOOKS_DB_PATH, "hana" =
# tables in HANA_SCHEMA. KH_VECTOR_BACKEND picks the vector store: "chroma" =
# CHROMA_PATH, "hana" = the HANA Cloud vector engine in HANA_SCHEMA. Both default
# to the local files, so an install that sets neither behaves exactly as before.
# KH_DB_BACKEND (top of this file) fills both when they are unset.
STORE_BACKEND  = _backend("KH_STORE_BACKEND", "store", "sqlite")
VECTOR_BACKEND = _backend("KH_VECTOR_BACKEND", "vector", "chroma")

# ── API key (off unless set) ────────────────────────────────────────────────
# When KH_API_KEY is set, every route except /health requires the key in the
# X-KH-Key header (or "Authorization: Bearer <key>"). A local install leaves it
# unset and stays open on its loopback port, as it always has been.
API_KEY = os.getenv("KH_API_KEY", "").strip()

# ── Sign-in (SSO) and per-project access control ─────────────────────────────
# Set KH_AUTH_ISSUER to the Keycloak realm URL (e.g.
# https://kh-keycloak.cfapps.br10.hana.ondemand.com/realms/knowledge-hub) and every route except
# /health, /version and /auth/help needs a valid access token from that realm, whose 'kh' claim
# decides what the caller may do (app/auth.py, app/auth_rules.json). Unset = sign-in off, as before.
AUTH_ISSUER = os.getenv("KH_AUTH_ISSUER", "").strip()
# The audience KH accepts; Keycloak's 'kh-access' client scope adds it to the token.
AUTH_AUDIENCE = os.getenv("KH_AUTH_AUDIENCE", "kh-api").strip()
# The public Keycloak client the KH helper signs in with (device authorization grant).
AUTH_CLIENT_ID = os.getenv("KH_AUTH_CLIENT_ID", "kh-cli").strip()
# Other sign-in services whose person tokens a technical user may pass in X-KH-Acting-Token (app/auth.py
# TECHNICAL USERS), e.g. an app's own Keycloak realm. A JSON list, each entry
#   {"issuer": "<realm url>", "audience": "<aud>", "technical_users": ["<TU e-mail>", ...],
#    "jwks_uri": "<optional; default <issuer>/protocol/openid-connect/certs>"}
# Only the listed TUs may use that issuer's tokens, and only tokens with email_verified true count.
# Unset = only this KH realm's own tokens. A change needs a restart (cf restart), no rebuild.
ACTING_ISSUERS = os.getenv("KH_ACTING_ISSUERS", "").strip()

# -- Personal projects (sign-in on only) ------------------------------------------------------
# Every signed-in person owns one private project, <PERSONAL_PREFIX><e-mail slug>, holding what they
# told their assistants to remember (scope PERSONAL_SCOPE). Its access follows the e-mail in the
# token, not a grant, so it needs no Keycloak record and no token refresh; see app/personal.py.
# With sign-in off there are no people, and personalization stays the orchestrator's common store.
PERSONAL_PREFIX = os.getenv("KH_PERSONAL_PREFIX", "personal-").strip()
PERSONAL_SCOPE = os.getenv("KH_PERSONAL_SCOPE", "personalization").strip()
# A person's own lessons: how-tos for specific tasks (sign in to an app, log time, deploy X) that only they
# use. They live in scope PERSONAL_LESSON_SCOPE of their personal project (kh_lesson_<id>), because members
# cannot write the shared lessons project. /context/step and the turn context read them next to the shared
# lessons; on overlap the personal lesson wins (Rowan 2026-10-29).
PERSONAL_LESSON_SCOPE = os.getenv("KH_PERSONAL_LESSON_SCOPE", "lesson").strip()

# -- Chunk vectors (app/chunks.py) -------------------------------------------------------------
# The embedder reads 512 tokens (~2,000 characters) of a row and drops the rest. A row longer than
# CHUNK_MIN_CHARS also gets one vector per CHUNK_CHARS window, every CHUNK_STRIDE characters after
# the head, in a sidecar collection, so a query can find what the tail of a long row says.
CHUNK_MIN_CHARS = int(os.getenv("KH_CHUNK_MIN_CHARS", "1800"))
CHUNK_CHARS = int(os.getenv("KH_CHUNK_CHARS", "800"))
CHUNK_STRIDE = int(os.getenv("KH_CHUNK_STRIDE", "700"))
# A snippet (max_chars) of a row found through one of its chunks is the row's head (id, date,
# subject) plus the piece that matched, not the first max_chars characters (roadmap item C, fix 1).
# CLIP_HEAD_CHARS is how much of the head is kept in front of the piece.
CLIP_HEAD_CHARS = int(os.getenv("KH_CLIP_HEAD_CHARS", "160"))

# -- Turn context (app/turn.py) ------------------------------------------------------------------
# GET /turn/context answers, in one call made by the UserPromptSubmit hook, what the model used to
# fetch with 3-5 calls before every piece of work: project, action menu, findings, entity cards and
# the KH lessons near the prompt. These bound its size; a lesson below the floor is left out.
TURN_LESSON_PROJECT = os.getenv("KH_TURN_LESSON_PROJECT", "lesson-learned").strip()
TURN_LESSON_K = int(os.getenv("KH_TURN_LESSON_K", "3"))
TURN_LESSON_FLOOR = float(os.getenv("KH_TURN_LESSON_FLOOR", "0.6"))
# The matched project's distilled items near the prompt, packed by the hook (no model turn). OFF by default:
# the 2026-10-10 tier 2 run (K=3, floor 0.68) lost accuracy 5.5 -> 4.9, all on P2, because items at 0.73-0.74
# were off topic (a 'who asked you to push' lesson made the model skip the deploy dispatch). With bge-small,
# unrelated items reach 0.70-0.74; at 0.75 only on-topic ones remain. Enable with KH_TURN_DISTILLED_K>0 only
# after a bench run at the 0.75 floor.
TURN_DISTILLED_K = int(os.getenv("KH_TURN_DISTILLED_K", "0"))
TURN_DISTILLED_FLOOR = float(os.getenv("KH_TURN_DISTILLED_FLOOR", "0.75"))
TURN_DISTILLED_CHARS = int(os.getenv("KH_TURN_DISTILLED_CHARS", "400"))
TURN_ENTITY_LIMIT = int(os.getenv("KH_TURN_ENTITY_LIMIT", "5"))
TURN_FINDING_LIMIT = int(os.getenv("KH_TURN_FINDING_LIMIT", "5"))
TURN_WHEN_CHARS = int(os.getenv("KH_TURN_WHEN_CHARS", "160"))
TURN_TEXT_CHARS = int(os.getenv("KH_TURN_TEXT_CHARS", "2000"))

# -- Policy authoring guards (app/policy_actions/lint.py, fen 2026-10-04) --------------------------
# Hook text and policies grew by appending until the session-start text passed Claude Code's
# 10,000-char hook limit and the model saw a 2 KB preview. Writes over these budgets answer 422 unless
# the caller sends allow_oversize + a reason. Existing rows are not rewritten; GET /policy/lint lists them.
POLICY_DESC_MAX = int(os.getenv("KH_POLICY_DESC_MAX", "400"))       # the when-to-use line of an action
POLICY_RULE_MAX = int(os.getenv("KH_POLICY_RULE_MAX", "1200"))      # one sub-action
POLICY_PLAN_MAX = int(os.getenv("KH_POLICY_PLAN_MAX", "6000"))      # every rule of one action
POLICY_OVERLAP = float(os.getenv("KH_POLICY_OVERLAP", "0.6"))       # when-line word overlap that warns
POLICY_UNUSED_DAYS = int(os.getenv("KH_POLICY_UNUSED_DAYS", "30"))
# Per hook type, the whole rendered text one hook command prints (Claude Code cuts at 10,000).
HOOK_MAX = {
    "SessionStart": int(os.getenv("KH_HOOK_MAX_SESSIONSTART", "9000")),
    "UserPromptSubmit": int(os.getenv("KH_HOOK_MAX_USERPROMPTSUBMIT", "1500")),
    "PreToolUse": int(os.getenv("KH_HOOK_MAX_PRETOOLUSE", "2000")),
    "Stop": int(os.getenv("KH_HOOK_MAX_STOP", "1500")),
}
MENU_PLACEHOLDER = "{menu}"   # in a hook rule, replaced by the every-project action menu at read time

# -- Step context (app/step.py, roadmap item C) ---------------------------------------------------
# POST /context/step answers ONE step of a piece of work with ONE bounded pack: entity cards named,
# then knowledge, and the worklog only when knowledge has nothing above the floor (or the step asks
# about time). STEP_FLOOR was chosen on the bench's 15 retrieval tasks against prod, 2026-10-03:
# 0.68 halves the rows (276 -> 139) and keeps 19 of the 20 source rows those reads reach.
STEP_BUDGET_CHARS = int(os.getenv("KH_STEP_BUDGET_CHARS", "6000"))     # about 1.5k tokens
STEP_ITEM_CHARS = int(os.getenv("KH_STEP_ITEM_CHARS", "600"))
STEP_K = int(os.getenv("KH_STEP_K", "6"))
STEP_THREAD_LIMIT = int(os.getenv("KH_STEP_THREAD_LIMIT", "5"))   # names / refs / ids per open thread
STEP_FLOOR = float(os.getenv("KH_STEP_FLOOR", "0.68"))
# The worklog is read only when the best knowledge row scores below STEP_KNOW_ENOUGH: rows between the
# floor and this are near the step but rarely answer it (ticketing knowledge sits at 0.70-0.74 for most
# questions while the log rows that answer score 0.77-0.79; bench, 2026-10-03).
STEP_KNOW_ENOUGH = float(os.getenv("KH_STEP_KNOW_ENOUGH", "0.75"))
STEP_ENTITY_LIMIT = int(os.getenv("KH_STEP_ENTITY_LIMIT", "4"))
STEP_RECENT_LIMIT = int(os.getenv("KH_STEP_RECENT_LIMIT", "8"))
# Distilled items read by key (roadmap D slice 2): items per lane when the step names an action or a
# context, and context tags listed in the pack so the caller can name one on its next step.
STEP_KEY_LIMIT = int(os.getenv("KH_STEP_KEY_LIMIT", "6"))
STEP_CONTEXT_LIMIT = int(os.getenv("KH_STEP_CONTEXT_LIMIT", "40"))
# Soft context (2026-10-24): with an action AND a context, the action's items are read by meaning and the context
# only adds this to an item's score (0.05 measured best on 210 steps, kh-investigate vec_eead247c4272); 'off' brings
# back the exact action+context key first.
_bonus = os.getenv("KH_STEP_CONTEXT_BONUS", "0.05").strip().lower()
STEP_CONTEXT_BONUS = None if _bonus in ("off", "none", "") else float(_bonus)
# A step is about TIME when it holds an ISO date or one of these words; it then reads the log by
# recency first. Comma-separated, matched as whole words on the lowercased step.
STEP_TIME_WORDS = tuple(w.strip() for w in os.getenv(
    "KH_STEP_TIME_WORDS",
    "latest,most recent,recent,recently,newest,yesterday,today,this week,last week,since,"
    "what changed,current status,hom qua,hom nay,moi nhat,gan day,tuan nay").split(",") if w.strip())

# -- Distil (app/distill.py, roadmap item D) ------------------------------------------------------
# The weekend run takes worklogs from GET /distill/next, writes small items and returns them with
# POST /distill/submit. Only the projects listed here are served (the consent flag, fen 2026-10-09;
# it moves to Keycloak later). Comma-separated project ids; empty = none.
DISTILL_PROJECTS = tuple(p.strip() for p in os.getenv("KH_DISTILL_PROJECTS", "").split(",") if p.strip())
DISTILL_BATCH = int(os.getenv("KH_DISTILL_BATCH", "20"))            # logs per /distill/next
DISTILL_SCAN_MAX = int(os.getenv("KH_DISTILL_SCAN_MAX", "400"))     # rows examined per call, signal or not
DISTILL_LOG_CHARS = int(os.getenv("KH_DISTILL_LOG_CHARS", "2000"))  # each log as served
DISTILL_NEIGHBOUR_CHARS = int(os.getenv("KH_DISTILL_NEIGHBOUR_CHARS", "6000"))
# A row without a signal word is still served when hash(id) % 100 < this, so a missed word shows up.
DISTILL_SAMPLE_PCT = int(os.getenv("KH_DISTILL_SAMPLE_PCT", "10"))
DISTILL_TITLE_CHARS = int(os.getenv("KH_DISTILL_TITLE_CHARS", "120"))
DISTILL_ITEM_CHARS = int(os.getenv("KH_DISTILL_ITEM_CHARS", "600"))
# bge-small, measured 2026-10-09: a reword 0.97, the same subject with an opposite claim 0.89, two
# unrelated items under one key 0.60-0.65. So merge from 0.95 and contest from 0.80.
DISTILL_SAME = float(os.getenv("KH_DISTILL_SAME", "0.95"))          # cosine: same item reworded
DISTILL_SHARED_PROJECT = os.getenv("KH_DISTILL_SHARED_PROJECT", "lesson-learned").strip()
# Signal words seed the table distill_signal on first start; afterwards the table is the list, and the
# distiller adds words it finds (POST /distill/submit signal_words). Format kind:word,word;kind:...
DISTILL_SIGNAL_SEED = os.getenv(
    "KH_DISTILL_SIGNAL_SEED",
    "decision:decided,decision,approved,chose,agreed,chot,quyet dinh,dong y,duyet;"
    "failure:failed,error,broke,root cause,fixed,workaround,gotcha,loi,hong,nguyen nhan,sua;"
    "newcomer:new,joined,created user,granted,owner,reviewer,cap quyen;"
    "procedure:steps,deploy,rollback,how to,cac buoc,cach lam;"
    "correction:correction,wrong,instead,never,always,sai,khong duoc,luon luon,tu gio")
DISTILL_SIGNAL_MIN_CHARS = int(os.getenv("KH_DISTILL_SIGNAL_MIN_CHARS", "3"))
DISTILL_SIGNAL_MAX_CHARS = int(os.getenv("KH_DISTILL_SIGNAL_MAX_CHARS", "40"))
# The leak gate (fen 2026-10-09, the Pacific/Gina case). ALWAYS refused in any item: e-mails and
# secrets. Refused only in a SHARED item, or in an item of a project NOT in DISTILL_OWN_PROJECTS
# (someone else's logs): hosts and IPs. A project-private item of fen's own projects may keep the
# board, channel and deploy target that make it useful. Person names never go in an item's text
# (they go in its entities key); org and project names are refused only on share.
DISTILL_LEAK_PATTERNS = tuple(p for p in os.getenv(
    "KH_DISTILL_LEAK_PATTERNS",
    r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}"                                   # e-mail
    # assigned secret: a value of 8+ chars holding a digit ('Token: no-check' and 'password: never'
    # were refused on the first prod run, 2026-10-09)
    r"||(?i:\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*(?=\S*\d)\S{8,})"
    r"||\b(?:sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}\b"            # key-shaped strings
    r"||\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"                  # JWT
).split("||") if p)
DISTILL_SHARE_LEAK_PATTERNS = tuple(p for p in os.getenv(
    "KH_DISTILL_SHARE_LEAK_PATTERNS",
    r"\b\d{1,3}(?:\.\d{1,3}){3}\b"                                     # IPv4
    r"||\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|cloud|ondemand\.com|internal|local|vn)\b"  # host
).split("||") if p)
DISTILL_OWN_PROJECTS = tuple(p.strip() for p in os.getenv("KH_DISTILL_OWN_PROJECTS", "").split(",") if p.strip())
# A signal log this close to a live item, with no signal word the item lacks, only adds evidence to
# that item in code and never reaches the distiller (thousands of near-identical logs, one item).
DISTILL_CONFIRM = float(os.getenv("KH_DISTILL_CONFIRM", "0.85"))
# Roadmap E (docs/roadmap-e-to-5-design.md 3.2, slice S5): KH's own month cap on the distil worker's spend.
# /distill/next (and /daily/next) answer 429 'budget' to a worker token once the month's worker.cost_usd
# metrics in kh_people reach it. The worker has its own, lower caps; this is the server's last word.
# KH_DISTILL_WORKER=off|dry|on (default off) is read at call time by app/caps/people.worker_mode().
WORKER_CAP_MONTH_USD = float(os.getenv("KH_WORKER_CAP_MONTH_USD", "60"))
