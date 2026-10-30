import asyncio
import hashlib
import io
import logging
import os
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager

# `KnowledgeHub.exe --tray`: the status tray for a KH that runs as a service. It must not load the server's
# modules (they open the stores the service holds) nor write the service's logs, so it branches off here.
if __name__ == "__main__" and "--tray" in sys.argv[1:]:
    from app import status_tray
    raise SystemExit(status_tray.main(sys.argv[1:]))

import requests.exceptions
import uvicorn
from PIL import Image, ImageDraw

# Import config FIRST — it loads .env into the environment, so preflight (which
# reads KH_PORT at import) and everything below see the same values.
from app import config
import preflight

# ---------------------------------------------------------------------------
# Paths, ports, headless-safe streams and logging
# ---------------------------------------------------------------------------
# When launched with pythonw.exe (system-tray mode, no console) sys.stdout /
# sys.stderr are None. uvicorn calls sys.stdout.isatty() and transformers writes
# tqdm bars to sys.stderr — both would crash. Redirect the missing streams to a
# file so the app runs headless and stays debuggable.
# Frozen: exe is at Slaves/KnowledgeHub/KnowledgeHub.exe; writable state next to it.
# Script: __file__ is next to main.py in the source tree.
HERE = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
        else os.path.dirname(os.path.abspath(__file__)))
# Bundled assets (icon) come from the extraction dir when frozen.
_BUNDLE = (sys._MEIPASS if getattr(sys, "frozen", False) else HERE)
ICON_PATH = os.path.join(_BUNDLE, "assets", "kh.ico")
LOG_DIR = os.path.join(HERE, "logs")
LOG_PATH = os.path.join(LOG_DIR, "app.log")
os.makedirs(LOG_DIR, exist_ok=True)

_HEADLESS = sys.stdout is None or sys.stderr is None
if _HEADLESS:
    _stream = open(os.path.join(LOG_DIR, "app.out.log"), "a", buffering=1,
                   encoding="utf-8", errors="replace")
    sys.stdout = _stream
    sys.stderr = _stream

_handlers: list[logging.Handler] = [logging.FileHandler(LOG_PATH, encoding="utf-8")]
if not _HEADLESS:
    _handlers.append(logging.StreamHandler(sys.stderr))
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s - %(message)s",
    datefmt="%H:%M:%S",
    handlers=_handlers,
)

HOST = config.HOST
PORT = config.PORT
DOCS_URL = f"http://localhost:{PORT}/docs"
HEALTH_URL = f"http://localhost:{PORT}/health"

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from typing import TYPE_CHECKING
if TYPE_CHECKING:                       # only a type hint in route bodies — the
    from sentence_transformers import SentenceTransformer  # 4.5s import stays lazy

from app.chunker import MODEL_NAME, load_model, semantic_chunk
from app.extractor import embed_entities
from app import layers as kh_layers
from app.graph_db import graph_db
from app.retriever import clip_hit as _clip, fetch_graph, query_quick_knowledge
from app.schemas import (
    AskRequest,
    AskResponse,
    BoundingBox,
    CenterCoordinates,
    ChunkRequest,
    ChunkResponse,
    DeleteKnowledgeRequest,
    DeleteKnowledgeResponse,
    EdgeAttr,
    EdgeData,
    EntityAttr,
    GraphDirectAddRequest,
    GraphDirectAddResponse,
    GraphDirectQueryRequest,
    GraphDirectQueryResponse,
    KnowledgeRequest,
    KnowledgeResponse,
    KeyAddRequest,
    KeyAddResponse,
    KeyQueryRequest,
    KeyQueryResponse,
    KeyHit,
    KeyDeleteRequest,
    KeyDeleteResponse,
    LocateUIResponse,
    NodeData,
    OrphanCleanupResponse,
    QueryRequest,
    QueryResponse,
    QuickQueryHit,
    QuickQueryRequest,
    QuickQueryResponse,
    VectorAddRequest,
    VectorAddResponse,
    VectorDeleteRequest,
    VectorDeleteResponse,
    LayerAddRequest,
    LayerAddResponse,
    LayerRecordOut,
    LayerQueryRequest,
    LayerQueryResponse,
    LayerHit,
    LayerGatherRequest,
    LayerGatherResponse,
    ScrollRequest,
    ScrollResponse,
    ScrollHit,
    TopicsResponse,
    TopicCount,
    BackfillMetadataRequest,
    BackfillMetadataResponse,
    BackfillChange,
    LogBackfillAuthorRequest,
    LogBackfillAuthorResponse,
    LogBackfillProject,
    VersionResponse,
)
from app.vision import FLORENCE_MODEL_ID, load_florence, locate_ui_element
from app.vector_store import (
    delete_vt, get_vt, get_ids_vt, query_vt, upsert_vt,
    upsert_key, query_keys, get_key, delete_keys,
    scroll_vt, topics_vt, backfill_topic_vt, fill_missing_field_vt, field_values_vt,
    existing_collection_names, part_collection_name,
    scope_collection, scope_collections_all, hotlog_collection, own_project,
    every_collection,
)
from app import hotlog
from app import orchestrator as kh_orchestrator
from app.graph_db.project_graph import get_project_graph

logger = logging.getLogger(__name__)


def _project_graph_or_default(project: str | None):
    """Per-project graph when a project is named, else the default (orchestrator) graph."""
    return get_project_graph(project) if project else graph_db

# ---------------------------------------------------------------------------
# OpenAPI tag metadata
# ---------------------------------------------------------------------------

_OPENAPI_TAGS = [
    {
        "name": "Vector · Fast",
        "description": (
            "Pure embedding operations — no graph DB. Lowest latency. "
            "Store and retrieve simple facts/notes by semantic meaning."
        ),
    },
    {
        "name": "Graph · Direct",
        "description": (
            "Graph operations with **pre-built** entities/edges. "
            "Insert or query structured knowledge (entities/edges) directly by core_id."
        ),
    },
    {
        "name": "Vision",
        "description": "Florence-2 CAPTION_TO_PHRASE_GROUNDING — locate UI elements in screenshots. No LLM required.",
    },
    {
        "name": "Management",
        "description": "Delete stored knowledge by ID and run garbage-collection sweeps. No LLM required.",
    },
    {
        "name": "Utility",
        "description": "Liveness check and semantic text chunking.",
    },
]


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    t0 = time.perf_counter()
    logger.info("━━━ KnowledgeHub starting up ━━━")

    logger.info("[1/3] Loading embedding model: %s ...", MODEL_NAME)
    t1 = time.perf_counter()
    app.state.model = load_model()
    logger.info("[1/3] Embedding model ready (%.1fs)", time.perf_counter() - t1)

    # Florence-2 (~9s) is deferred: it is only needed by /vision/locate-ui, so
    # loading it here would dominate cold start. It is loaded lazily on the first
    # vision request (see _ensure_florence) and optionally warmed in the
    # background below so that first call stays fast.
    app.state.florence_processor = None
    app.state.florence_model = None
    app.state.florence_lock = threading.Lock()

    logger.info("[2/3] Bootstrapping ChromaDB ...")
    from app.vector_store import CHROMA_PATH, COLLECTION_NAME, _collection
    logger.info("[2/3] ChromaDB ready — path=%s, collection=%s, docs=%d",
                CHROMA_PATH, COLLECTION_NAME, _collection.count())

    # Project bundles (v6.4): guarantee the manage-role orchestrator project exists so
    # routing/knowledge/policy always have a home. It is also the DEFAULT graph now, so
    # it must exist BEFORE the graph bootstrap below. Cheap, idempotent, filesystem-only.
    from app import projects as kh_projects
    kh_projects.ensure_orchestrator()

    logger.info("[3/3] Bootstrapping graph database schema/tables ...")
    t4 = time.perf_counter()
    graph_db.bootstrap()   # Kùzu path -> orchestrator project graph (kuzu_projects/orchestrator)
    logger.info("[3/3] Graph DB ready (%.1fs)", time.perf_counter() - t4)

    # Every KH cron starts on every instance but each run first takes a KH lease ('_kh', 'cron.<name>')
    # through sqldb.run_under_lease, so with N instances a sweep runs on one at a time (stage F1).
    # Feedback cron (SA-1): dumb sequential sweep marking findings over threshold.
    # Uses KH's own embedder (0 tokens, no LLM). Disable with KH_FEEDBACK_CRON=false.
    if config._bool("KH_FEEDBACK_CRON", "true"):
        from app import feedback as kh_feedback
        kh_feedback.start_cron(app.state.model)

    # Message stack cron (app/messages.py): archives read / expired messages and drops archive
    # rows past retention, every KH_MESSAGE_CRON_MINUTES. Disable with KH_MESSAGE_CRON=false.
    if config.MSG_CRON_ENABLED:
        from app import messages as kh_messages
        kh_messages.start_cron()

    # Stage F capability crons (app/caps: idempotency purge, owner-grant refresh), each under a _kh lease.
    from app import caps as kh_caps_crons
    kh_caps_crons.start_crons()

    # Project identity in the orchestrator's C4 tree (fen 2026-08-21): step 1 of every turn
    # resolves an intent to a project by literal match over that tree, so it must not drift from
    # the manifest. Idempotent and embed-free unless a project's names actually changed.
    try:
        kh_projects.sync_orchestrator_registry(
            lambda text: app.state.model.encode(text, normalize_embeddings=True).tolist())
    except Exception:
        logger.exception("startup — C4 project registry sync failed (POST /projects/registry/sync to retry)")

    # Seeded data (fen 2026-09-25): texts KH serves are rows, and each start seeds a missing one from
    # seeds/ without touching an edited one - the deploy's migration step.
    try:
        if kh_auth.enabled():
            logger.info("startup - auth help guide: %s", kh_auth.seed_guide(
                lambda text: app.state.model.encode(text, normalize_embeddings=True).tolist()))
    except Exception:
        logger.exception("startup - seeding the auth help guide failed (the seed file is served instead)")

    logger.info("━━━ KnowledgeHub is READY — startup took %.1fs ━━━", time.perf_counter() - t0)

    # Warm Florence-2 in the background so the first vision call is fast, without
    # blocking readiness. Skipped when KH_PRELOAD_VISION=false.
    if config.PRELOAD_VISION:
        threading.Thread(
            target=_warm_florence, args=(app,), name="florence-warmup", daemon=True
        ).start()

    yield

    logger.info("━━━ KnowledgeHub shutting down ━━━")
    del app.state.model
    app.state.florence_processor = None
    app.state.florence_model = None


# ---------------------------------------------------------------------------
# Lazy Florence-2 loading (shared by the vision endpoint and background warm-up)
# ---------------------------------------------------------------------------

def _ensure_florence(app: FastAPI):
    """Return (processor, model), loading Florence-2 on first use. Thread-safe.

    Blocking — call via ``asyncio.to_thread`` from request handlers so the event
    loop is never stalled by the load.
    """
    if app.state.florence_model is None:
        with app.state.florence_lock:
            if app.state.florence_model is None:  # re-check under lock
                logger.info("Loading Florence-2 vision model on demand: %s ...", FLORENCE_MODEL_ID)
                t = time.perf_counter()
                proc, mdl = load_florence()
                app.state.florence_processor = proc
                app.state.florence_model = mdl
                logger.info("Florence-2 ready (%.1fs)", time.perf_counter() - t)
    return app.state.florence_processor, app.state.florence_model


def _warm_florence(app: FastAPI) -> None:
    """Preload Florence-2 in a background thread after startup (best-effort)."""
    try:
        _ensure_florence(app)
    except Exception:
        logger.exception("Florence-2 background warm-up failed — will retry on first vision request")


app = FastAPI(
    title="Knowledge Hub API",
    description=(
        "Property-Graph + vector RAG service backed by Kùzu (or SAP HANA) + ChromaDB. "
        "v6+: Claude Code is the sole reasoning layer — KH calls NO local LLM.\n\n"
        "**Tier guide — pick the right endpoint:**\n\n"
        "| Tier | Use for |\n"
        "|------|---------|\n"
        "| **Vector · Fast** | Simple facts, quick notes, similarity search, enumeration |\n"
        "| **Graph · Direct** | Insert/query pre-built entities and edges by core_id |\n"
        "| **Taxonomy · v6** | Governed tree: facet-descent retrieve + gated store |"
    ),
    version=config.KH_VERSION,
    lifespan=lifespan,
    openapi_tags=_OPENAPI_TAGS,
)

# API key gate (off unless KH_API_KEY is set). A local install keeps its open loopback
# port; a deployment reachable from the internet sets the key and every route except
# /health (the platform's liveness probe) then needs it.
# Sign-in with per-project permissions (app/auth.py) replaces the shared key when it is configured.
from app import auth as kh_auth
kh_auth.install(app)

if config.API_KEY and not kh_auth.enabled():
    import hmac

    from fastapi.responses import JSONResponse

    _OPEN_PATHS = {"/health"}

    @app.middleware("http")
    async def _require_api_key(request, call_next):
        if request.url.path in _OPEN_PATHS:
            return await call_next(request)
        supplied = request.headers.get("x-kh-key", "")
        if not supplied:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                supplied = auth[7:].strip()
        if not supplied or not hmac.compare_digest(supplied, config.API_KEY):
            return JSONResponse({"detail": "missing or invalid API key"}, status_code=401)
        return await call_next(request)

# Orchestrator: hub/satellite routing over physically isolated per-source
# collections (additive — see app/orchestrator.py). No effect on existing routes.
kh_orchestrator.attach(app)

# Project bundles (v6.4): the uniform unit of isolation — one project binds vector +
# graph + knowledge + log + findings + policy + counter, orchestrator included
# (additive — see app/projects.py). Foundation for B2–B7. No effect on existing routes.
from app import projects as kh_projects
kh_projects.attach(app)

# Policy subsystem (v6.4, SA-2): per-project + orchestrator-common policy in their OWN
# physically-separate vector collections, matched by intent similarity with precedence
# + audit — so an absolute policy can never be crowded out of top-k (additive — see
# app/policy.py). Runs in parallel with hooks.db (deterministic kernel/hook rules).
from app import policy as kh_policy
kh_policy.attach(app)

# Policy ACTION TABLE (v6.5, fen 2026-08-21): the DETERMINISTIC policy tier. Rules live as
# policy_actions + policy_rules rows in KH's own hooks.db, keyed by (action, sub_action), so
# routing is a SELECT instead of a cosine guess — no threshold to tune, no cross-family bleed,
# and it works in any language because the agent picks an English label rather than having its
# sentence embedded (bge-small-en-v1.5 is English-only). Runs in PARALLEL with the vector tier
# above: table first, /policy/match kept as the fallback for unclear requests (additive — see
# app/policy_actions/).
from app import policy_actions as kh_policy_actions
kh_policy_actions.attach(app)

# Policy-first routing (v6.4, B6): decide route-vs-answer through ONE mechanism —
# policy first, then resolve in the orchestrator's knowledge (route-shortcut vs fact);
# no cosine project-guess. Switching returns a project's physical binding (additive —
# see app/routing.py).
from app import routing as kh_routing
kh_routing.attach(app)

# Feedback loop (v6.4, SA-1): per-project failing-counter + a DUMB cron that marks
# findings for issues recurring in >50% of requests + a findings collection Claude
# reads at consult to learn/fix/mint policy (additive — see app/feedback.py).
from app import feedback as kh_feedback
kh_feedback.attach(app)

# Message stack (fen 2026-09-29): per-project messages between people and their assistants;
# the KH helper delivers a caller's unread ones on every prompt (see app/messages.py).
from app import messages as kh_messages
kh_messages.attach(app)

# Artifacts (fen 2026-10-19): files KH hands out, the kh-helper wheel first, uploaded as data so a helper
# release is no KH redeploy; the store (hana, http on a VPS, s3) is switched with an API call (app/artifacts.py).
from app import artifacts as kh_artifacts
kh_artifacts.attach(app)

# Design gallery (fen 2026-10-25): the designs the public Designer site lists, with demo HTML and thumbnail as
# base64, read without sign-in; a new style is one PUT here besides its rows in project designer (app/gallery.py).
from app import gallery as kh_gallery
kh_gallery.attach(app)

# Taxonomy REMOVED in v6.4 (design 04): routing reaches a project via
# /orchestrator/resolve (policy-first), never by facet-descent. The whole taxonomy
# subsystem (app/taxonomy/) has been deleted; no /taxonomy/* endpoints exist.

# Revisions / changelog: supersede-with-history for corrected facts (additive — see
# app/revisions/). Keeps old values retrievable + labelled so a later session can ask
# "what did I call it before?". Reuses the same vector substrate; no effect on existing routes.
from app import revisions as kh_revisions
kh_revisions.attach(app)

# Hook rules: plain-text Claude Code hook policies in SQLite, served by hook type
# (additive — see app/hooks/). Claude hooks fetch their FULL governing text from
# GET /hooks/get?hook_type=<T> at fire time — deterministic, no regex/semantic,
# no truncation. Changing a rule is a DB write, not a settings.json edit.
from app import hooks as kh_hooks
kh_hooks.attach(app)

# Personalization render: preformatted UTF-8 personalization text for the SessionStart
# hook to inject via curl (additive — see app/personalization.py). Moves the inline
# PowerShell personalization loader out of settings.json and preserves diacritics.
from app import personalization as kh_personalization
from app import personal as kh_personal
from app.projects import ORCHESTRATOR_ID
from app import chunks as kh_chunks
kh_personalization.attach(app)
# Entity cards: the distilled who/what/relations layer over the worklogs (app/entities.py).
from app import entities as kh_entities
kh_entities.attach(app)
# Turn context: the per-prompt hook's one call - project, actions, findings, entities, lessons (app/turn.py).
from app import turn as kh_turn
kh_turn.attach(app)
# Step context: one bounded pack per step - entities, knowledge, then the log (app/step.py, roadmap C).
# /log/recent is defined further down, so it is looked up when a step runs, not now.
from app import step as kh_step
kh_step.attach(app, recent=lambda **kw: log_recent(**kw))
# Distil (roadmap D): weekend batches of signal logs out, small keyed items back (app/distill.py).
from app import distill as kh_distill
kh_distill.attach(app, log_lanes=lambda pid: _read_lanes(hotlog.config.HOTLOG_SCOPE, pid, None))
# Promote (kernel rule 10): nightly proposals to lift rules many people set for themselves into the common tier.
from app import promote as kh_promote
kh_promote.attach(app)
# Tagged kernel (fen 2026-10-29): rules per tier with tags from one vocabulary, merged in code (app/kernel).
from app import kernel as kh_kernel
kh_kernel.attach(app)
# Usage per person per day across sessions, counted by learn-back from the work logs (app/usage.py).
from app import usage as kh_usage
kh_usage.attach(app, log_lanes=lambda pid: _read_lanes(hotlog.config.HOTLOG_SCOPE, pid, None))

# KH-to-KH sync: a maintainer pulls another KH's projects in code after an embedding handshake (app/sync.py).
from app import sync as kh_sync
kh_sync.attach(app)
# /home beyond sync (2026-10-13): Knowledge (projects, parts, rows, people) and Lesson learn tabs, and the
# learn-back runner that distils worklogs and findings into lessons where a model is at hand.
from app import home as kh_home
from app import learnback as kh_learnback
kh_home.attach(app)
kh_learnback.attach(app)

# Code-graph import: materialise a graphify/gitnexus code-graph OUTPUT into KH's own
# substrate (per-source collection + prefixed Kùzu graph) so it is queryable natively
# instead of re-parsing a JSON file on every read (additive — see app/codegraph/).
# This is the INGEST step that replaces the old "copy graph.json into the KH folder".
from app import codegraph as kh_codegraph
kh_codegraph.attach(app)

# Stage F capabilities (app/caps, docs/multi-agent-instance-design.md): consumer namespaces, coordination,
# event store and service principals under /v1. Modules register themselves in app/caps/__init__.py.
from app import caps as kh_caps
kh_caps.attach_all(app)

# Session project binding (fen 2026-10-24): a session's worklogs follow its bound project (app/session_project.py).
from app import session_project as kh_session_project
kh_session_project.attach(app)

# Download sources (fen 2026-10-24): /auth/download takes each module from a DB row, local file or https link.
from app import downloads as kh_downloads
kh_downloads.attach(app)

# KH's own events (fen 2026-10-24): EventStore + buffer + kh-events sidecar; off unless KH_EVENTS=on.
from app.eventing import emit as kh_events
kh_events.attach(app)


from app.embeddings.remote import EmbedderUnavailable as _EmbedderUnavailable  # noqa: E402


@app.exception_handler(_EmbedderUnavailable)
async def _embedder_unavailable(request: Request, exc: _EmbedderUnavailable):
    """KH_EMBEDDER=remote and the embed service cannot answer: a clear 503, never a 500."""
    from fastapi.responses import JSONResponse
    logger.error("embedder unavailable on %s: %s", request.url.path, exc)
    return JSONResponse({"error": "embedder_unavailable", "detail": str(exc)}, status_code=503,
                        headers={"Retry-After": "5"})


@app.exception_handler(RequestValidationError)
async def _log_422(request: Request, exc: RequestValidationError):
    logger.error(
        "422 Unprocessable Entity  path=%s  errors=%s  body=%s",
        request.url.path, exc.errors(), exc.body,
    )
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(ValidationError)
async def _log_pydantic(request: Request, exc: ValidationError):
    logger.error("Pydantic ValidationError on %s: %s", request.url.path, exc.errors())
    raise HTTPException(
        status_code=500,
        detail=f"Response model error: {exc.error_count()} validation error(s)",
    )


# ===========================================================================
# VECTOR · FAST  (No LLM)
# ===========================================================================

@app.post(
    "/vector/add",
    response_model=VectorAddResponse,
    tags=["Vector · Fast"],
    summary="Store text as a vector — auto-embed, no LLM",
)
async def vector_add(body: VectorAddRequest, request: Request) -> VectorAddResponse:
    """
    Encode text and persist it to ChromaDB in a single call — no LLM:

    1. Encode `text` with the active embedding model (bge-small-en-v1.5 by default,
       English-only; L2-normalised, 384-dim).
    2. Upsert the resulting vector + content into ChromaDB.

    The entry is tagged `knowledge_type="quick"` by default, so it is retrievable via
    `/vector/query`. Override the default tag via `metadata`.

    **ID**: `body.id` if provided; otherwise `vec_<sha256(text)[:12]>` — idempotent, same text → same ID.
    """
    # The top-level `project` is the same field /vector/query and /vector/delete take. Callers
    # wrote it here too and it was dropped silently, so the write fell to the orchestrator and
    # came back 403 "missing permission project.log" (2026-10-12). auth_rules.json reads it too,
    # after metadata.project and metadata.source_id, skipping blanks; the row must land in the
    # project that check cleared, so a blank metadata.project is overwritten, not kept.
    top = (body.project or "").strip()
    if top:
        for key in ("project", "source_id"):
            named = body.metadata.get(key)
            if isinstance(named, str) and named.strip():
                if named.strip() != top:
                    raise HTTPException(status_code=422, detail=(
                        f"project '{top}' and metadata.{key} '{named.strip()}' disagree; give one"))
                break
        body.metadata["project"] = top

    model: SentenceTransformer = request.app.state.model
    try:
        embedding = await asyncio.to_thread(model.encode, body.text, normalize_embeddings=True)
    except Exception as exc:
        logger.exception("/vector/add — embedding failed")
        raise HTTPException(status_code=500, detail=f"Embedding error: {exc}") from exc

    vector = embedding.tolist()
    vector_id = body.id or f"vec_{hashlib.sha256(body.text.encode()).hexdigest()[:12]}"
    metadata = {"knowledge_type": "quick", "scope": body.scope, **body.metadata}

    # B4 physical isolation: log/knowledge/findings land in the OWNING project's own
    # collection (kh_log_/kh_know_/kh_find_<project>); personalization + kh-meta go to
    # the orchestrator's common knowledge. Unrecognised scopes keep the shared store.
    project = metadata.get("project") or metadata.get("source_id")
    # Personalization naming no project is the caller's own personal project (app/personal.py),
    # created on this first write. Sign-in off: unchanged, the orchestrator's common store.
    project = kh_personal.write_target(body.scope, project)
    if kh_auth.current() is not None and body.scope in kh_personal.NO_LOG_IN \
            and (project or ORCHESTRATOR_ID) == ORCHESTRATOR_ID:
        # The orchestrator is the system registry: nobody's worklog or finding lives there (fen 2026-10-13).
        raise HTTPException(status_code=409, detail=(
            "the orchestrator keeps no worklogs or findings; name the project the work belongs to, or name none "
            "and it goes to your personal project " + kh_auth.current().personal_project))
    if kh_personal.is_personal(project):
        metadata["project"] = project
        principal_now = kh_auth.current()
        if principal_now is not None:          # the permission check has already cleared this project
            owner = principal_now.email if project == principal_now.personal_project else None
            await asyncio.to_thread(kh_personal.ensure, project, owner)
    # Worklogs land in the HOT WINDOW first (one shared partition, tagged with the
    # owning project) so a recency question can be answered without naming a project;
    # KH spills them into kh_log_<project> later. Every other scope writes straight
    # to its own project part, unchanged. See app/hotlog.py.
    principal = kh_auth.current()
    if principal is not None:
        metadata[hotlog.AUTHOR_KEY] = principal.email      # who wrote it; the caller cannot choose
    # Which session of that account wrote it (X-KH-Actor, app/auth.py ACTORS): a label, never a right.
    actor = kh_auth.current_actor()
    if actor:
        metadata[kh_auth.ACTOR_KEY] = actor
    else:
        metadata.pop(kh_auth.ACTOR_KEY, None)
    if hotlog.is_windowed_scope(body.scope):
        # The real person a technical user logged this for, from its token and header only
        # (app/auth.py TECHNICAL USERS); a body value is never trusted.
        acting = principal.acting_user if principal is not None else None
        if acting:
            metadata[kh_auth.ACTING_KEY] = acting
        else:
            metadata.pop(kh_auth.ACTING_KEY, None)
    if body.scope == config.HOTLOG_SCOPE:
        from app.eventing.emit import emit as kh_emit
        kh_emit("kh.worklog.stored", {"project": project, "project_from": metadata.get("project_from") or "body"},
                project=project or "")
    if hotlog.is_hot(body.scope):
        metadata[hotlog.OWNER_KEY] = own_project(project)   # never leave a row untagged
        coll = hotlog_collection()
    else:
        coll = scope_collection(body.scope, project)

    try:
        await asyncio.to_thread(upsert_vt, vector_id, vector, body.text, metadata, coll)
    except Exception as exc:
        logger.exception("/vector/add — upsert failed")
        raise HTTPException(status_code=500, detail=f"Vector store error: {exc}") from exc

    logger.info("/vector/add — stored id=%s dim=%d coll=%s", vector_id, len(vector),
                getattr(coll, "name", "shared"))

    # The embedder reads the first 512 tokens only; a long row also gets chunk vectors in its
    # project's sidecar so its tail is searchable (app/chunks.py). Best-effort: the row is stored.
    if body.scope:
        owner = metadata.get(hotlog.OWNER_KEY) if hotlog.is_hot(body.scope) else None
        owner = owner or (project if kh_personal.is_personal(project) else own_project(project))
        try:
            n = await asyncio.to_thread(
                kh_chunks.write, vector_id, body.text, metadata, owner,
                lambda parts: [v.tolist() for v in model.encode(parts, normalize_embeddings=True)])
            if n:
                logger.info("/vector/add — %d chunk vectors for %s in %s", n, vector_id, owner)
        except Exception:
            logger.exception("/vector/add — chunk vectors failed for %s (row kept)", vector_id)

    if hotlog.is_windowed_scope(body.scope):
        # Runs even when the window is switched OFF, because that is what drains the
        # rows still in it. Spilling is best-effort: the row is already stored, and a
        # failed spill only means the window is briefly over its cap, never a lost log.
        try:
            if principal is None:
                report = await asyncio.to_thread(hotlog.enforce)
            else:
                # The caller's own window, delivering only where they may still log.
                report = await asyncio.to_thread(
                    hotlog.enforce, principal.email,
                    lambda pid: principal.can(pid, "project.log"))
            if report.get("spilled"):
                logger.info("/vector/add — hot window spilled %s", report["spilled"])
        except Exception:
            logger.exception("/vector/add — hot window enforcement failed (row kept)")

    return VectorAddResponse(vector_id=vector_id, dimension=len(vector))


@app.post(
    "/vector/query",
    response_model=QuickQueryResponse,
    tags=["Vector · Fast"],
    summary="Semantic similarity search over stored vectors — no LLM",
)
async def vector_query(body: QuickQueryRequest, request: Request) -> QuickQueryResponse:
    """
    Ultra-fast semantic search — no LLM, no graph DB:

    1. Encode the query text with the active embedding model (bge-small-en-v1.5 by
       default, English-only: query in English; other languages score far lower).
    2. Cosine-similarity search in ChromaDB (quick-knowledge entries only).
    3. Return top-K hits sorted by descending similarity score.

    Long text (> 200 words) is auto-chunked; results are merged by best score per entry.
    """
    model: SentenceTransformer = request.app.state.model
    hits = await query_quick_knowledge(body.text, body.k, model, scope=body.scope,
                                       where=body.where, project=body.project)
    hits = [h for h in hits if kh_auth.row_visible(h.get("metadata"), h.get("vector_id"))]
    if body.min_score is not None:
        hits = [h for h in hits if h["score"] >= body.min_score]
    return QuickQueryResponse(hits=[QuickQueryHit(**_clip(h, body.max_chars, body.text)) for h in hits])


def _scroll_ids(lanes: list, body) -> dict:
    """/vector/scroll ids=[...]: the exact rows, from whichever lane of this read holds them."""
    merged: dict[str, dict] = {}
    for coll, where in lanes:
        for h in get_ids_vt(body.ids, where, collection=coll):
            if kh_auth.row_visible(h.get("metadata"), h.get("vector_id")):
                merged.setdefault(h["vector_id"], h)
    rows = [_clip(merged[i], body.max_chars) for i in body.ids if i in merged]
    return {"matched": len(rows), "count": len(rows), "offset": 0, "limit": body.limit, "hits": rows}


def _sort_by_ts(rows: list[dict], order: str | None, since: str | None) -> list[dict]:
    """Keep rows at or after ``since`` and sort them by metadata.ts, on the server."""
    if since:
        cutoff = hotlog.parse_ts(since)
        rows = [h for h in rows if hotlog.row_ts(h.get("metadata")) >= cutoff]
    if order:
        rows = sorted(rows, key=lambda h: hotlog.row_ts(h.get("metadata")), reverse=(order == "newest"))
    return rows


# ===========================================================================
# VECTOR · ENUMERATION  (deterministic list/scroll/topics — no k cap, No LLM)
# ===========================================================================
# /vector/query is a top-k similarity search capped at k — it can neither list a
# partition completely nor count distinct topics. These endpoints close that gap so
# callers stop bumping k to "find everything": scroll pages through EVERY matching
# row, topics gives the exact distinct-topic registry (+ a metadata-hygiene signal),
# and backfill repairs the "topic in text but not in metadata" bug that breaks
# `where` partition routing.

def _scope_where(scope: str | None, where: dict | None) -> dict | None:
    """Combine a scope namespace with an optional metadata filter (ChromaDB $and)."""
    clauses: list[dict] = []
    if scope:
        clauses.append({"scope": {"$eq": scope}})
    if where:
        clauses.append(where)
    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


# Per-project isolation (B4 + extensible bundle): every scope except the common set
# and the unscoped case is a per-project part. A read targets one project's collection,
# or aggregates across all projects + the shared legacy store.
_COMMON_SCOPES = ("personalization", "kh-meta", "self-info")


def _read_collections(scope: str | None, project: str | None) -> list:
    """The collection handles to read for a (scope, project) enumeration.

    A ``None`` entry means the shared legacy collection; we include it so rows not yet
    migrated are still visible. Any named scope (basic OR custom per-project part) routes
    to that project's own collection when a project is given, else fans out over all.
    """
    if not scope:
        return [None]                                      # unscoped -> shared only
    project = kh_personal.target(scope, project)
    if kh_personal.is_personal(project):
        return [scope_collection(scope, project)]          # one person's own personalization
    if scope in _COMMON_SCOPES:
        return [scope_collection(scope, None), None]       # orchestrator common + shared
    if project:
        return [scope_collection(scope, project)]          # one project's part
    return scope_collections_all(scope) + [None]           # every project's part + shared


def _read_lanes(scope: str | None, project: str | None,
                where: dict | None) -> list[tuple[object, dict | None]]:
    """(collection, where) pairs a read must cover for a (scope, project).

    One lane per physical collection, plus the hot log window when the scope uses it.
    Each lane carries its OWN filter, because the window is shared: a project-scoped
    read narrows the window lane to that project while leaving the project's own
    collection unfiltered, so nothing leaks and nothing is hidden.
    """
    if project and not kh_auth.may(project, "project.read"):
        raise HTTPException(status_code=403, detail="missing permission project.read on this project")
    base = _scope_where(scope, where)
    lanes: list[tuple[object, dict | None]] = [
        (coll, base) for coll in _read_collections(scope, project)
    ]
    lane = hotlog.read_lane(scope, project, base)
    if lane is not None:
        lanes.append(lane)
    return lanes


@app.post(
    "/vector/scroll",
    response_model=ScrollResponse,
    tags=["Vector · Fast"],
    summary="Paginate through ALL rows in a partition — deterministic, no k cap",
)
async def vector_scroll(body: ScrollRequest) -> ScrollResponse:
    """Page through a partition. ``order``/``since`` sort and filter by metadata.ts on the
    server, so "the newest N" costs N rows of context instead of the whole partition;
    ``ids`` fetches exact rows; ``max_chars`` returns snippets."""
    lanes = _read_lanes(body.scope, body.project, body.where)
    by_ts = bool(body.order or body.since)

    def _run() -> dict:
        if body.ids:
            return _scroll_ids(lanes, body)
        merged: dict[str, dict] = {}
        matched = 0
        # Fetch offset+limit per lane, NOT limit: the page is sliced AFTER the lanes
        # are merged, so fetching only `limit` rows would make every offset beyond the
        # first page come back empty while rows still existed. A ts sort needs every
        # matching row, so it reads the lanes whole - on the server, not in the caller.
        need = body.offset + body.limit
        for coll, where in lanes:
            r = scroll_vt(where, 1_000_000 if by_ts else need, 0, collection=coll)
            matched += r["matched"]                     # TRUE total from the store
            for h in r["hits"]:
                if not kh_auth.row_visible(h.get("metadata"), h.get("vector_id")):
                    matched -= 1                        # a hidden row is not counted either
                    continue
                merged.setdefault(h["vector_id"], h)   # dedupe across collections
        rows = list(merged.values())
        if by_ts:
            rows = _sort_by_ts(rows, body.order, body.since)
            matched = len(rows)
        page = [_clip(h, body.max_chars) for h in rows[body.offset: body.offset + body.limit]]
        # `matched` is the number of rows MATCHING the filter, independent of `limit`;
        # `count` is how many came back in this page. Callers page until count < limit.
        return {"matched": matched, "count": len(page), "offset": body.offset,
                "limit": body.limit, "hits": page}

    res = await asyncio.to_thread(_run)
    return ScrollResponse(
        matched=res["matched"], count=res["count"], offset=res["offset"],
        limit=res["limit"], hits=[ScrollHit(**h) for h in res["hits"]],
    )


# DELETE too: callers reach for the HTTP verb first, and a DELETE that matched no auth rule
# answered "route not open to members" to people who own the rows (2026-10-15).
@app.api_route(
    "/vector/delete",
    methods=["POST", "DELETE"],
    response_model=VectorDeleteResponse,
    tags=["Vector · Fast"],
    summary="Remove stored rows by exact ID — the only way a row leaves",
)
async def vector_delete(body: VectorDeleteRequest) -> VectorDeleteResponse:
    """Delete vector rows by ID, reporting which collection each one was in.

    WHY THIS EXISTS (fen, 2026-09-22). Until now /vector/* could only add: the finding
    `kh-no-vector-delete-or-update` (2026-08-27) recorded that a stored row could never
    be removed or corrected, only superseded by a second row that says the first is
    wrong. Both then load forever, the wrong one competing with its own correction —
    worst in scope=personalization, which is injected into every session. The store
    layer has had `delete_vt` all along; what was missing was a door to it.

    BY EXACT ID, NEVER BY FILTER. A wrong `where` empties a partition in one
    unrecoverable call; a wrong id removes one row somebody already had to look up.
    Callers find ids with /vector/query or /vector/scroll.

    WHICH COLLECTIONS ARE SEARCHED. With `scope` (and optionally `project`) it is the
    same lanes a read of that scope would cover. WITHOUT `scope` it sweeps every
    collection, because an id does not say where it lives and the rows most needing
    removal are the ones that landed somewhere unexpected: pass `scope` only in
    `metadata` on /vector/add and the row goes to the DEFAULT scope's collection while
    its metadata claims another, so every scoped read misses it. Sweeping is safe
    because the match is by exact id — a collection that does not hold it is untouched.

    `dry_run: true` answers WHERE each id lives and deletes nothing, which is the
    sane first call. Deleting an absent id is not an error: absent ids come back under
    `not_found` so a caller can tell "already gone" from "gone now".
    """
    if body.scope:
        lanes = [(getattr(coll, "name", "shared"), coll)
                 for coll, _where in _read_lanes(body.scope, body.project, None)]
    else:
        lanes = every_collection()

    def _run() -> dict:
        found: dict[str, str] = {}
        deleted: list[str] = []
        want = list(dict.fromkeys(body.ids))        # dedupe, keep the caller's order
        for name, coll in lanes:
            remaining = [i for i in want if i not in found]
            if not remaining:
                break                              # every id located; stop sweeping
            try:
                here = coll.get(ids=remaining).get("ids", [])
            except Exception:
                logger.exception("/vector/delete — get failed on %s", name)
                continue
            if not here:
                continue
            for i in here:
                found[i] = name
            if not body.dry_run:
                # delete_vt re-checks existence in this collection, so a row removed
                # by somebody else between the get and here is a no-op, not an error.
                deleted += delete_vt(here, coll)
        return {"found": found, "deleted": deleted,
                "not_found": [i for i in want if i not in found]}

    res = await asyncio.to_thread(_run)
    if res["deleted"] and not body.dry_run:
        await asyncio.to_thread(kh_chunks.delete_for, list(res["deleted"]))   # their chunk vectors too
    logger.info("/vector/delete — %s %d/%d id(s) over %d collection(s)",
                "located" if body.dry_run else "deleted",
                len(res["deleted"]) or len(res["found"]), len(body.ids), len(lanes))
    return VectorDeleteResponse(
        deleted=res["deleted"], found=res["found"], not_found=res["not_found"],
        searched=len(lanes), dry_run=body.dry_run,
    )


@app.post(
    "/vector/rechunk",
    tags=["Vector · Fast"],
    summary="Build chunk vectors for long rows stored before chunking existed (maintainers)",
)
async def vector_rechunk(body: dict, request: Request) -> dict:
    """Body {scope, project?, dry_run?: true}. Walks the rows of that read and (re)writes the chunk
    vectors of every row longer than KH_CHUNK_MIN_CHARS. A dry run only counts. Idempotent."""
    scope = (body.get("scope") or "").strip()
    if not scope:
        raise HTTPException(400, "scope is required")
    project = (body.get("project") or "").strip() or None
    dry = body.get("dry_run", True) is not False
    model: SentenceTransformer = request.app.state.model
    lanes = _read_lanes(scope, project, None)

    def _run() -> dict:
        rows: dict[str, dict] = {}
        for coll, where in lanes:
            for h in scroll_vt(where, 1_000_000, 0, collection=coll)["hits"]:
                rows.setdefault(h["vector_id"], h)
        long_rows = [h for h in rows.values() if kh_chunks.windows(h["source_text"])]
        written = 0
        if not dry:
            encode = lambda parts: [v.tolist() for v in model.encode(parts, normalize_embeddings=True)]
            for h in long_rows:
                meta = h.get("metadata") or {}
                owner = meta.get(hotlog.OWNER_KEY) or project or own_project(None)
                written += kh_chunks.write(h["vector_id"], h["source_text"], meta, owner, encode)
        return {"rows": len(rows), "long_rows": len(long_rows), "chunks_written": written, "dry_run": dry}

    return await asyncio.to_thread(_run)


@app.get(
    "/log/recent",
    response_model=ScrollResponse,
    tags=["Vector · Fast"],
    summary="Recent worklogs across every project — newest first, no project needed",
)
async def log_recent(limit: int = 50, project: str | None = None,
                     since: str | None = None, topic: str | None = None,
                     max_chars: int | None = None, until: str | None = None) -> ScrollResponse:
    """Answer "what happened with X lately?" newest first, sorted on the server.

    NO PROJECT NAMED: reads the hot log window alone - one small partition holding the recent
    work of every active project - so a recency question needs no project. Every row reports
    the project that owns it. With sign-in on, only the caller's own rows come back.

    PROJECT NAMED (2026-09-30): reads that project's WHOLE log - the window and every row
    already spilled into kh_log_<project> - so "the latest entry" is right however old the
    project is, and costs ``limit`` rows of context instead of the whole partition. Anyone
    holding project.read gets every author's rows; ``metadata.author`` says who wrote each.

    ``topic`` narrows to one subject; ``since`` (ISO-8601 or epoch seconds) keeps entries at
    or after that moment and ``until`` entries before it, so one day is one call; ``max_chars``
    returns snippets (full text: /vector/scroll ids=[...]).
    """
    if project and not kh_auth.may(project, "project.read"):
        raise HTTPException(status_code=403, detail="missing permission project.read on this project")
    extra = {"topic": {"$eq": topic}} if topic else None
    scope = hotlog.config.HOTLOG_SCOPE
    if project:
        lanes = _read_lanes(scope, project, extra)
    else:
        lane = hotlog.read_lane(scope, None, _scope_where(scope, extra))
        if lane is None:      # only when the scope itself is not windowed
            return ScrollResponse(matched=0, count=0, offset=0, limit=limit, hits=[])
        lanes = [(lane[0], hotlog.recent_where(lane[1], None))]   # own window only

    def _run() -> dict:
        # Sort on (id, ts) alone, then read the text of the page only (2026-10-03): reading every
        # row's text to keep `limit` of them cost about 5 s on a project log of a few hundred rows.
        merged: dict[str, tuple[int, dict]] = {}
        for n, (coll, where) in enumerate(lanes):
            # Rows another real person's agent logged (app/auth.py TECHNICAL USERS) leave before the
            # page is cut, so a page is never short; one more metadata-only read, and only when limited.
            hidden = set() if kh_auth.acting_key() is None else {
                vid for vid, who in field_values_vt(kh_auth.ACTING_KEY, where, collection=coll)
                if not kh_auth.acting_visible({kh_auth.ACTING_KEY: who})}
            for vid, ts in field_values_vt("ts", where, collection=coll):
                if vid not in hidden:
                    merged.setdefault(vid, (n, {"vector_id": vid, "metadata": {"ts": ts}}))  # a spilled row may sit in both
        rows = _sort_by_ts([stub for _, stub in merged.values()], "newest", since)
        if until:
            upper = hotlog.parse_ts(until)
            rows = [h for h in rows if hotlog.row_ts(h.get("metadata")) < upper]
        keep = [h["vector_id"] for h in rows[:limit]]
        full: dict[str, dict] = {}
        for n, (coll, where) in enumerate(lanes):
            ids = [vid for vid in keep if merged[vid][0] == n]
            if ids:
                full.update({h["vector_id"]: h for h in get_ids_vt(ids, where, collection=coll)})
        page = [_clip(full[vid], max_chars) for vid in keep
                if vid in full and kh_auth.row_visible(full[vid].get("metadata"), vid)]
        return {"matched": len(rows), "count": len(page), "offset": 0,
                "limit": limit, "hits": page}

    res = await asyncio.to_thread(_run)
    return ScrollResponse(
        matched=res["matched"], count=res["count"], offset=res["offset"],
        limit=res["limit"], hits=[ScrollHit(**h) for h in res["hits"]],
    )


@app.get(
    "/log/window",
    tags=["Vector · Fast"],
    summary="What the hot log window currently holds, slot by slot",
)
async def log_window() -> dict:
    """Introspect the window: which projects hold a slot, how deep, how recent.

    Exists so the window can be VERIFIED rather than trusted — the caps are silent by
    design, and a slot that spilled leaves no trace in the reply of /vector/add.
    """
    principal = kh_auth.current()

    def _run() -> dict:
        current = hotlog.slots(principal.email if principal else None)
        # Own rows in a project the person has since been removed from stay out of sight too.
        allowed = kh_auth.visible_projects()
        if allowed is not None:
            current = {p: v for p, v in current.items() if p in allowed}
        return {
            "enabled": hotlog.config.HOTLOG_ENABLED,
            "scope": hotlog.config.HOTLOG_SCOPE,
            "collection": hotlog.vs.HOTLOG_COLLECTION,
            "caps": {
                "slots": hotlog.config.HOTLOG_SLOTS,
                "max_per_slot": hotlog.config.HOTLOG_MAX_PER_SLOT,
                "max_age_days": hotlog.config.HOTLOG_MAX_AGE_DAYS,
            },
            "slots_used": len(current),
            "slots": sorted(
                ({"project": p, "entries": v["count"], "newest_ts": v["newest"]}
                 for p, v in current.items()),
                key=lambda r: -r["newest_ts"],
            ),
        }
    return await asyncio.to_thread(_run)


@app.get(
    "/log/by",
    response_model=ScrollResponse,
    tags=["Vector · Fast"],
    summary="One person's worklogs across every project, in a time window (maintainers)",
)
async def log_by(author: str, since: str | None = None, until: str | None = None,
                 project: str | None = None, limit: int = 500) -> ScrollResponse:
    """Answer "what did Hugh do on Friday?" for a maintainer.

    /log/recent only ever shows the caller's own window, so it cannot answer a question about
    somebody else. This reads every worklog lane - each project's own log AND the hot window -
    for rows whose ``metadata.author`` is ``author`` (the e-mail the server stamped from the
    writer's token), keeps ``since <= ts < until`` and sorts newest first. Both bounds take
    ISO-8601 with an offset (``2026-09-25T00:00:00+07:00``) or epoch seconds, so a day in the
    asker's time zone is one call. ``project`` narrows to one project. Rows stored before
    sign-in carry no author until POST /log/backfill-author names one.
    """
    who = author.strip().lower()
    lanes = _read_lanes(hotlog.config.HOTLOG_SCOPE, project, {hotlog.AUTHOR_KEY: {"$eq": who}})
    lower = hotlog.parse_ts(since) if since else None
    upper = hotlog.parse_ts(until) if until else None

    def _run() -> dict:
        merged: dict[str, dict] = {}
        for coll, where in lanes:
            for h in scroll_vt(where, 100000, 0, collection=coll)["hits"]:
                merged.setdefault(h["vector_id"], h)          # a spilled row may sit in both
        rows = list(merged.values())
        if lower is not None:
            rows = [h for h in rows if hotlog.row_ts(h.get("metadata")) >= lower]
        if upper is not None:
            rows = [h for h in rows if hotlog.row_ts(h.get("metadata")) < upper]
        rows.sort(key=lambda h: hotlog.row_ts(h.get("metadata")), reverse=True)
        page = rows[:limit]
        return {"matched": len(rows), "count": len(page), "offset": 0, "limit": limit, "hits": page}

    res = await asyncio.to_thread(_run)
    return ScrollResponse(
        matched=res["matched"], count=res["count"], offset=res["offset"],
        limit=res["limit"], hits=[ScrollHit(**h) for h in res["hits"]],
    )


@app.post(
    "/log/backfill-author",
    response_model=LogBackfillAuthorResponse,
    tags=["Management"],
    summary="Name the writer of worklogs stored before sign-in (dry-run by default)",
)
async def log_backfill_author(body: LogBackfillAuthorRequest) -> LogBackfillAuthorResponse:
    """Stamp ``metadata.author`` on the worklogs of the named projects that carry none.

    Worklogs written before sign-in (and rows copied over from the old store) have no author,
    so /log/by cannot find them. Only rows WITHOUT an author are touched: a row the server
    stamped at store time keeps its writer. Worklogs only - ``author`` on a knowledge-layer row
    means something else (app/layers.py). Projects must be named; there is no blanket form.
    """
    who = body.author.strip().lower()
    scope = hotlog.config.HOTLOG_SCOPE
    base = _scope_where(scope, None)

    def _run() -> list[dict]:
        live = existing_collection_names()
        report = []
        for pid in dict.fromkeys(p.strip() for p in body.projects if p.strip()):
            lanes = []
            name = part_collection_name(scope, pid)
            if name in live:
                lanes.append((scope_collection(scope, pid), base))
            lane = hotlog.read_lane(scope, pid, base)
            if lane is not None:
                lanes.append(lane)
            scanned = missing = 0
            for coll, where in lanes:
                r = fill_missing_field_vt(where, hotlog.AUTHOR_KEY, who, body.apply, collection=coll)
                scanned += r["scanned"]
                missing += r["missing"]
            report.append({"project": pid, "scanned": scanned, "missing": missing})
        return report

    report = await asyncio.to_thread(_run)
    return LogBackfillAuthorResponse(
        author=who, applied=body.apply, missing=sum(r["missing"] for r in report),
        projects=[LogBackfillProject(**r) for r in report],
    )


@app.get(
    "/vector/topics",
    response_model=TopicsResponse,
    tags=["Vector · Fast"],
    summary="Exact distinct values + counts for a metadata field (topic registry)",
)
async def vector_topics(field: str = "topic", scope: str | None = None,
                        project: str | None = None) -> TopicsResponse:
    lanes = _read_lanes(scope, project, None)

    def _run() -> dict:
        counts: dict[str, int] = {}
        total = 0
        missing = 0
        for coll, where in lanes:
            r = topics_vt(field, where, collection=coll, keep=kh_auth.row_visible)
            total += r["total_scanned"]
            missing += r["missing_field"]
            for t in r["topics"]:
                counts[t["value"]] = counts.get(t["value"], 0) + t["count"]
        items = sorted(({"value": k, "count": v} for k, v in counts.items()),
                       key=lambda x: (-x["count"], x["value"]))
        return {"field": field, "distinct": len(items), "total_scanned": total,
                "missing_field": missing, "topics": items}

    res = await asyncio.to_thread(_run)
    return TopicsResponse(
        field=res["field"], distinct=res["distinct"], total_scanned=res["total_scanned"],
        missing_field=res["missing_field"],
        topics=[TopicCount(**t) for t in res["topics"]],
    )


@app.post(
    "/vector/backfill-metadata",
    response_model=BackfillMetadataResponse,
    tags=["Management"],
    summary="Repair topic-in-text-but-not-metadata (dry-run by default)",
)
async def vector_backfill_metadata(body: BackfillMetadataRequest) -> BackfillMetadataResponse:
    where = _scope_where(body.scope, body.where)
    res = await asyncio.to_thread(backfill_topic_vt, where, body.field, body.apply)
    return BackfillMetadataResponse(
        scanned=res["scanned"], mismatched=res["mismatched"], applied=res["applied"],
        changes=[BackfillChange(vector_id=c["vector_id"], **{"from": c["from"], "to": c["to"]})
                 for c in res["changes"]],
    )


# ===========================================================================
# KEYS · CANONICAL  (entity-resolution index — separate collection, No LLM)
# ===========================================================================
# Dedicated namespace for standardized keys so a canonicalization lookup
# ("qua chuoi" → "banana") is ranked ONLY against other keys, not against
# knowledge chunks. Same embedding model as /vector/* — different collection.

def _parse_aliases(source_text: str) -> list[str]:
    """Split a pipe-joined alias phrase back into a clean surface-form list."""
    return [a.strip() for a in (source_text or "").split("|") if a.strip()]


@app.post(
    "/keys/add",
    response_model=KeyAddResponse,
    tags=["Keys · Canonical"],
    summary="Store/merge a canonical key + aliases — auto-embed, no LLM",
)
async def keys_add(body: KeyAddRequest, request: Request) -> KeyAddResponse:
    """
    Upsert a canonical key into the dedicated keys collection:

    1. Merge the given `aliases` with any already stored for `key` (learn-back),
       unless `merge=false` (then replace).
    2. Embed the pipe-joined surface forms (key + aliases) with the SAME model as
       /vector/add, so any alias/spelling/language resolves back to the key.
    3. Upsert into the keys collection keyed by `key` (idempotent).
    """
    model: SentenceTransformer = request.app.state.model
    key = body.key.strip()
    from app.vector_store import keys_collection
    kcoll = keys_collection(getattr(body, "project", None))   # per-project keys store

    aliases: list[str] = []
    if body.merge:
        existing = await asyncio.to_thread(get_key, key, kcoll)
        if existing:
            aliases.extend(_parse_aliases(existing.get("source_text", "")))
    aliases.extend(body.aliases)

    # Dedup case-insensitively, preserve order, keep the key itself as a surface form.
    seen: dict[str, bool] = {}
    ordered: list[str] = []
    for surface in [key, *aliases]:
        surface = surface.strip()
        if surface and surface.lower() not in seen:
            seen[surface.lower()] = True
            ordered.append(surface)
    source_text = " | ".join(ordered)

    try:
        embedding = await asyncio.to_thread(model.encode, source_text, normalize_embeddings=True)
    except Exception as exc:
        logger.exception("/keys/add — embedding failed")
        raise HTTPException(status_code=500, detail=f"Embedding error: {exc}") from exc

    vector = embedding.tolist()
    meta = {"canonical_key": key, "aliases": source_text, **body.metadata}
    try:
        await asyncio.to_thread(upsert_key, key, vector, source_text, meta, kcoll)
    except Exception as exc:
        logger.exception("/keys/add — upsert failed")
        raise HTTPException(status_code=500, detail=f"Keys store error: {exc}") from exc

    logger.info("/keys/add — stored key=%s aliases=%d dim=%d", key, len(ordered) - 1, len(vector))
    return KeyAddResponse(
        key=key,
        aliases=[a for a in ordered if a.lower() != key.lower()],
        dimension=len(vector),
    )


@app.post(
    "/keys/query",
    response_model=KeyQueryResponse,
    tags=["Keys · Canonical"],
    summary="Resolve a fuzzy mention to canonical keys — no LLM",
)
async def keys_query(body: KeyQueryRequest, request: Request) -> KeyQueryResponse:
    """
    Canonicalize a fuzzy mention: embed `text` and match it ONLY against the keys
    collection. Because knowledge chunks live in a different collection, the right
    canonical key ranks reliably at the top instead of being crowded out.
    """
    model: SentenceTransformer = request.app.state.model
    from app.vector_store import keys_collection
    kcoll = keys_collection(getattr(body, "project", None))
    try:
        embedding = await asyncio.to_thread(model.encode, body.text, normalize_embeddings=True)
    except Exception as exc:
        logger.exception("/keys/query — embedding failed")
        raise HTTPException(status_code=500, detail=f"Embedding error: {exc}") from exc

    raw = await asyncio.to_thread(query_keys, embedding.tolist(), body.k, kcoll)
    hits = [
        KeyHit(
            key=h["key"],
            score=h["score"],
            aliases=_parse_aliases(h.get("source_text", "")),
            source_text=h.get("source_text", ""),
        )
        for h in raw
    ]
    return KeyQueryResponse(hits=hits)


@app.post(
    "/keys/delete",
    response_model=KeyDeleteResponse,
    tags=["Keys · Canonical"],
    summary="Delete canonical keys from the keys collection",
)
async def keys_delete(body: KeyDeleteRequest, request: Request) -> KeyDeleteResponse:
    from app.vector_store import keys_collection
    kcoll = keys_collection(getattr(body, "project", None))
    deleted = await asyncio.to_thread(delete_keys, body.keys, kcoll)
    not_found = [k for k in body.keys if k not in deleted]
    logger.info("/keys/delete — deleted %d/%d keys", len(deleted), len(body.keys))
    return KeyDeleteResponse(requested=len(body.keys), deleted=deleted, not_found=not_found)


@app.post(
    "/vector/chunk",
    response_model=list[ChunkResponse],
    tags=["Vector · Fast"],
    summary="Split text into semantic chunks and return embeddings — no LLM, no storage",
)
async def vector_chunk(body: ChunkRequest, request: Request) -> list[ChunkResponse]:
    """
    Semantic chunking utility — no LLM, no storage:

    Splits text into coherent segments using similarity-based boundary detection
    (cutoff = mean − c·σ of adjacent-sentence cosine similarity).
    Returns one 384-dim L2-normalised embedding per chunk — same vector space as
    everything else in KnowledgeHub, so chunks can be passed straight to `/graph/add`
    or stored individually via `/vector/add`.

    `c` controls boundary sensitivity (default 1.0; lower value → more chunks).
    """
    model: SentenceTransformer = request.app.state.model
    try:
        chunks = semantic_chunk(body.text, model, c=body.c)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return [ChunkResponse(**chunk) for chunk in chunks]


# ===========================================================================
# GRAPH · DIRECT  (No LLM)
# ===========================================================================

@app.post(
    "/graph/add",
    response_model=GraphDirectAddResponse,
    tags=["Graph · Direct"],
    summary="Insert pre-built entities and edges into the graph — no LLM",
)
async def graph_direct_add(body: GraphDirectAddRequest, request: Request) -> GraphDirectAddResponse:
    """
    Direct graph ingestion — no LLM extraction step:

    1. Embed each entity's `source_text` with the active embedding model (bge-small-en-v1.5
       by default).
    2. Upsert entity vectors into ChromaDB (keyed by `core_id`).
    3. Upsert entity nodes and edges into the graph DB (Kùzu / SAP HANA).

    Use when you already have structured entities/edges (e.g. produced by an external
    extraction pipeline) and want to insert
    them without re-running the LLM.

    - Duplicate entities (same `core_id`) are **overwritten**.
    - Duplicate edges (same src/relation/tgt) are **silently skipped**.
    """
    model: SentenceTransformer = request.app.state.model
    entities = [e.model_dump() for e in body.entities]
    edges = [e.model_dump() for e in body.edges]

    try:
        entity_vectors = await asyncio.to_thread(embed_entities, entities, model)
    except Exception as exc:
        logger.exception("/graph/add — embedding failed")
        raise HTTPException(status_code=500, detail=f"Embedding error: {exc}") from exc

    entity_map = {e["core_id"]: e for e in entities}

    def _persist() -> None:
        for core_id, vector in entity_vectors:
            e = entity_map[core_id]
            upsert_vt(
                core_id,
                vector,
                source_text=e.get("source_text", ""),
                metadata={"type": e.get("type", "")},
            )
        graph_db.upsert_nodes(entities)
        graph_db.upsert_edges(edges)

    try:
        await asyncio.to_thread(_persist)
    except Exception as exc:
        logger.exception("/graph/add — persistence failed")
        raise HTTPException(status_code=500, detail=f"Graph DB error: {exc}") from exc

    logger.info(
        "/graph/add — entities=%d edges=%d vectors=%d",
        len(entities), len(edges), len(entity_vectors),
    )
    return GraphDirectAddResponse(
        entities_inserted=len(entities),
        edges_inserted=len(edges),
        vectors_generated=len(entity_vectors),
    )


@app.post(
    "/graph/query",
    response_model=GraphDirectQueryResponse,
    tags=["Graph · Direct"],
    summary="Fetch graph nodes and edges by core_id list — no LLM",
)
async def graph_direct_query(body: GraphDirectQueryRequest) -> GraphDirectQueryResponse:
    """
    Direct graph lookup by `core_id` — no LLM extraction:

    1. Start from the supplied `core_ids`.
    2. Ontology expansion: follow hierarchy edges (IS_PART_OF, BELONGS_TO, SUBCLASS_OF)
       in reverse up to `ONTOLOGY_HOPS` levels to discover sub-concepts.
    3. 1-hop edge fetch over the full expanded set.
    4. Return all matched nodes and edges.

    **Typical flow:**
    - Run `/vector/query` to find semantically similar entries → take the `vector_id`s
    - Pass those ids here to get the full subgraph with ontology expansion.
    """
    nodes, edges = await fetch_graph(body.core_ids)
    return GraphDirectQueryResponse(
        nodes=[NodeData(**n) for n in nodes],
        edges=[EdgeData(**e) for e in edges],
    )


# ===========================================================================
# SEMANTIC LAYERS  (C4 zoom — additive over the vector store)
# ===========================================================================

def _build_layer_store(model, project: str | None = None) -> "kh_layers.LayerStore":
    """Wire the pure layer logic to a PROJECT's own knowledge collection (C4 per project).

    The C4 tree is part of a project's independent bundle, so layer records live in
    kh_know_<project> (default: orchestrator common) — not the shared collection.
    """
    coll = scope_collection("knowledge", project)   # kh_know_<project> or orchestrator
    def encode(text: str) -> list:
        return model.encode(text, normalize_embeddings=True).tolist()
    def _up(core_id, vector, source_text="", metadata=None):
        # C4 records are knowledge — tag scope so they never mix with other record classes
        meta = {"scope": "knowledge", **(metadata or {})}
        upsert_vt(core_id, vector, source_text, meta, collection=coll)
    def _q(vector, n_results=10, where=None):
        return query_vt(vector, n_results, where, collection=coll)
    def _g(where, limit=None):
        return get_vt(where, limit, collection=coll)
    return kh_layers.LayerStore(encode=encode, upsert=_up, query=_q, get=_g)


def _hit_from_row(row: dict) -> LayerHit:
    md = row.get("metadata", {}) or {}
    return LayerHit(
        vector_id=row.get("core_id", ""),
        score=float(row.get("score", 0.0)),
        text=row.get("source_text", ""),
        lv=int(md.get(kh_layers.K_LEVEL, 1) or 1),
        tree_id=str(md.get(kh_layers.K_TREE, "")),
        parent_id=str(md.get(kh_layers.K_PARENT, "")),
        subject_key=str(md.get(kh_layers.K_SUBJECT, "")),
    )


@app.post(
    "/layers/add",
    response_model=LayerAddResponse,
    tags=["Layers · C4"],
    summary="Store knowledge as C4 zoom levels (single lv1; decompose client-side for multi-level)",
)
async def layers_add(body: LayerAddRequest, request: Request) -> LayerAddResponse:
    """
    Additive semantic-layer ingestion (kh_semantic_layers.md):

    - Text is stored as a single lv1 verdict (v6+: no local LLM; Claude decomposes client-side).
    - Short text, `auto_layer=false`, or `kind=policy` → stored as a single lv1 verdict
      (policy lv1 is NEVER auto-summarised — fen authors it, §6).
    - If the subject already has a tree, new lv1 attaches under it (§4.5-1, T096).

    Every record is tagged `{tree_id, lv, parent_id, epoch, kind, subject_key, author}`.
    
    """
    model: SentenceTransformer = request.app.state.model
    store = _build_layer_store(model, getattr(body, "project", None))

    # v6+: NO local LLM. C4 decomposition is Claude's job — a caller that wants levels
    # decomposes client-side and posts each level explicitly. The server always stores
    # the given text as a single lv1 verdict.
    do_layer = False

    if not do_layer:
        subject_key = body.subject_key or kh_layers.slug(body.text, prefix="subj")
        tree_id = kh_layers.slug(body.text)
        records = [kh_layers.LayerRecord(id=f"{tree_id}_lv1", lv=1, text=body.text.strip())]

    # T096: attach a NEW single/root under an existing subject tree if one exists.
    attached_to = ""
    try:
        existing = await asyncio.to_thread(store.find_subject_tree, subject_key)
        if existing and existing != tree_id:
            attached_to = existing
    except Exception as exc:  # noqa: BLE001
        logger.debug("/layers/add — subject lookup skipped (%s)", exc)

    try:
        await asyncio.to_thread(
            store.add_layers, records,
            tree_id=tree_id, subject_key=subject_key, epoch=body.epoch,
            kind=body.kind, author=body.author, ts=body.ts, parent_tree=attached_to,
        )
    except Exception as exc:
        logger.exception("/layers/add — persistence failed")
        raise HTTPException(status_code=500, detail=f"Vector store error: {exc}") from exc

    logger.info("/layers/add — tree=%s levels=%d layered=%s attached=%s",
                tree_id, len(records), do_layer, attached_to or "-")
    return LayerAddResponse(
        tree_id=tree_id, subject_key=subject_key, kind=body.kind,
        layered=len(records) > 1, attached_to=attached_to,
        records=[LayerRecordOut(id=r.id, lv=r.lv, text=r.text, parent_id=r.parent_id) for r in records],
    )


@app.post(
    "/layers/query",
    response_model=LayerQueryResponse,
    tags=["Layers · C4"],
    summary="Depth-aware retrieval — return layers up to max_level (lv1 verdicts first) — no LLM",
)
async def layers_query(body: LayerQueryRequest, request: Request) -> LayerQueryResponse:
    """
    Depth-aware read (§4, T092/T095): similarity search restricted to layer records
    with ``lv <= max_level``. Start with ``max_level=1`` (cheap radar of verdicts),
    then drill a specific tree by passing ``tree_id`` and a higher ``max_level``.
    """
    model: SentenceTransformer = request.app.state.model
    store = _build_layer_store(model, getattr(body, "project", None))
    try:
        rows = await asyncio.to_thread(
            store.query_depth, body.text,
            max_level=body.max_level, k=body.k, tree_id=body.tree_id, kind=body.kind,
        )
    except Exception as exc:
        logger.warning("/layers/query failed: %s", exc)
        rows = []
    return LayerQueryResponse(hits=[_hit_from_row(r) for r in rows])


@app.post(
    "/layers/gather",
    response_model=LayerGatherResponse,
    tags=["Layers · C4"],
    summary="Exhaustive-gather every fact for a subject (uncapped by k) + reconcile — no LLM",
)
async def layers_gather(body: LayerGatherRequest, request: Request) -> LayerGatherResponse:
    """
    Exhaustive gather (§4.5, T097/T098): fetch EVERY layer record attached to
    ``subject_key`` deterministically (not top-k), then — when ``reconcile=true`` —
    collapse conflicting facts via the trust ladder (user > agent, then verified_count,
    then recency) so a stale value loses to the fresh/authoritative one.
    """
    model: SentenceTransformer = request.app.state.model
    store = _build_layer_store(model, getattr(body, "project", None))
    try:
        rows = await asyncio.to_thread(
            store.gather_subject, body.subject_key,
            reconcile_set=body.reconcile, max_level=body.max_level,
        )
    except Exception as exc:
        logger.warning("/layers/gather failed: %s", exc)
        rows = []
    return LayerGatherResponse(
        subject_key=body.subject_key, count=len(rows),
        hits=[_hit_from_row(r) for r in rows],
    )


# ===========================================================================
# VISION
# ===========================================================================

@app.post(
    "/vision/locate-ui",
    response_model=LocateUIResponse,
    tags=["Vision"],
    summary="Locate a UI element in a screenshot using Florence-2",
)
async def vision_locate_ui(
    image: UploadFile = File(..., description="Screenshot to search (PNG/JPG/WebP)"),
    query: str = Form(..., description='Natural-language description of the UI element, e.g. "Login button"'),
    request: Request = None,
) -> LocateUIResponse:
    """
    Florence-2 CAPTION_TO_PHRASE_GROUNDING:

    1. Accept a screenshot (`multipart/form-data`) and a text description.
    2. Run Florence-2 to locate the described UI element within the image.
    3. Return bounding box (pixel coords) and center point.

    Coordinates are in **actual image pixels**. Returns **404** if the element is not found.
    No LLM (qwen) is involved — only the local Florence-2 vision model.
    """
    raw = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot decode image: {exc}")

    try:
        processor, model = await asyncio.to_thread(_ensure_florence, request.app)
    except Exception as exc:
        logger.exception("Florence-2 load failed")
        raise HTTPException(status_code=503, detail=f"Vision model unavailable: {exc}")
    try:
        result = await asyncio.to_thread(locate_ui_element, pil_image, query, processor, model)
    except Exception as exc:
        logger.exception("Florence-2 inference error")
        raise HTTPException(status_code=500, detail=f"Vision model error: {exc}")

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No UI element matching '{query}' found in the image",
        )
    return LocateUIResponse(
        query=query,
        center_coordinates=CenterCoordinates(**result["center_coordinates"]),
        bounding_box=BoundingBox(**result["bounding_box"]),
    )


# ===========================================================================
# MANAGEMENT
# ===========================================================================

def _delete_hot_rows(ids: list[str], project: str) -> list[str]:
    """Delete hot-window log rows of `project` by id; rows of another project are left alone."""
    from app import vector_store as _vs
    hot = _vs.hotlog_collection()
    mine = [h["vector_id"] for h in _vs.get_ids_vt(ids, collection=hot)
            if (h.get("metadata") or {}).get("project") == project]
    return _vs.delete_vt(mine, hot) if mine else []


@app.delete(
    "/knowledge",
    response_model=DeleteKnowledgeResponse,
    tags=["Management"],
    summary="Delete stored knowledge by ID — vector and/or graph",
)
async def knowledge_delete(body: DeleteKnowledgeRequest) -> DeleteKnowledgeResponse:
    """
    Remove stored knowledge by ID.

    `scope`:
    - `all` (default) — delete from **both** ChromaDB and graph (node + every attached edge)
    - `vector` — ChromaDB only
    - `graph` — graph DB only (node + its edges)

    Idempotent: missing IDs are reported in `not_found`, never errored.
    Set `purge_orphan_documents=true` to also GC any source documents left without nodes.
    """
    deleted_vectors: list[str] = []
    graph_result = {"nodes_deleted": 0, "edges_deleted": 0}
    project = getattr(body, "project", None)
    g = _project_graph_or_default(project)                       # per-project graph when scoped
    vcoll = scope_collection(getattr(body, "data_scope", "knowledge"), project)  # per-project part

    if body.scope in ("all", "vector"):
        try:
            deleted_vectors = await asyncio.to_thread(delete_vt, body.ids, vcoll)
            # A log row still in the hot window sits in the shared hot collection until it spills into
            # kh_log_<project>; delete it there too, but only a row of this project (2026-10-30: fresh noise
            # logs answered not_found and could not be removed).
            left = [i for i in body.ids if i not in set(deleted_vectors)]
            if left and project and hotlog.is_windowed_scope(getattr(body, "data_scope", "knowledge")):
                deleted_vectors += await asyncio.to_thread(_delete_hot_rows, left, project)
        except Exception as exc:
            logger.exception("DELETE /knowledge — vector delete failed")
            raise HTTPException(status_code=500, detail=f"Vector store error: {exc}") from exc

    if body.scope in ("all", "graph"):
        try:
            graph_result = await asyncio.to_thread(g.delete_nodes, body.ids)
        except Exception as exc:
            logger.exception("DELETE /knowledge — graph delete failed")
            raise HTTPException(status_code=500, detail=f"Graph DB error: {exc}") from exc

    documents_deleted = 0
    if body.purge_orphan_documents:
        try:
            documents_deleted = await asyncio.to_thread(g.delete_orphan_documents)
        except Exception as exc:
            logger.exception("DELETE /knowledge — orphan sweep failed")
            raise HTTPException(status_code=500, detail=f"Graph DB error: {exc}") from exc

    not_found = (
        [i for i in body.ids if i not in set(deleted_vectors)]
        if body.scope in ("all", "vector") else []
    )
    logger.info(
        "DELETE /knowledge — scope=%s vectors=%d nodes=%d edges=%d docs=%d",
        body.scope, len(deleted_vectors),
        graph_result["nodes_deleted"], graph_result["edges_deleted"], documents_deleted,
    )
    return DeleteKnowledgeResponse(
        requested=len(body.ids),
        scope=body.scope,
        vectors_deleted=len(deleted_vectors),
        graph_nodes_deleted=graph_result["nodes_deleted"],
        graph_edges_deleted=graph_result["edges_deleted"],
        documents_deleted=documents_deleted,
        not_found=not_found,
    )


@app.delete(
    "/knowledge/orphans",
    response_model=OrphanCleanupResponse,
    tags=["Management"],
    summary="GC — delete orphaned source documents with no remaining nodes",
)
async def knowledge_orphans_delete() -> OrphanCleanupResponse:
    """
    Garbage-collect source documents whose every graph node has been removed.

    A `KH_DOCUMENTS` row is an orphan when no `KH_GRAPH_NODES` row references its id.
    Such orphans accumulate after deleting graph nodes; this sweep reclaims them.
    Idempotent — returns 0 when no orphans remain. No LLM required.
    """
    try:
        removed = await asyncio.to_thread(graph_db.delete_orphan_documents)
    except Exception as exc:
        logger.exception("DELETE /knowledge/orphans — sweep failed")
        raise HTTPException(status_code=500, detail=f"Graph DB error: {exc}") from exc
    logger.info("DELETE /knowledge/orphans — removed %d document(s)", removed)
    return OrphanCleanupResponse(documents_deleted=removed)


# ===========================================================================
# UTILITY
# ===========================================================================

@app.get("/health", tags=["Utility"], summary="Liveness check")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.get(
    "/version",
    response_model=VersionResponse,
    tags=["Utility"],
    summary="Authoritative KnowledgeHub version (env → VERSION file → default)",
)
async def version() -> VersionResponse:
    return VersionResponse(
        version=config.KH_VERSION, source=config.KH_VERSION_SOURCE, model=MODEL_NAME,
    )


# ===========================================================================
# SYSTEM-TRAY LAUNCHER
# ===========================================================================
# `python main.py` starts the server in a background thread and shows a tray
# icon (double-click -> Swagger, right-click -> menu with Exit). With pythonw.exe
# no console appears. The heavy models load during server startup, so the tray
# gates "open Swagger" on readiness and auto-opens once the server answers.

_ready = threading.Event()
_autoopen_lock = threading.Lock()
_autoopen_running = False

# pystray's Win32 backend fires the default menu item TWICE on a double-click
# (once for WM_LBUTTONUP of the first click, once for WM_LBUTTONDBLCLK), which
# would open two Swagger tabs. Collapse activations within this window into one.
_ACTIVATE_DEBOUNCE_S = 1.5
_last_activate = 0.0
_activate_lock = threading.Lock()


def _load_icon_image() -> Image.Image:
    """Prefer the bundled assets/kh.ico; fall back to a drawn 'KH' badge."""
    try:
        if os.path.exists(ICON_PATH):
            # Convert to a plain RGBA image so pystray does not re-query the
            # multi-size .ico (which emits "Image was not the expected size").
            return Image.open(ICON_PATH).convert("RGBA")
    except Exception:
        logger.warning("Could not load %s — using generated icon.", ICON_PATH)
    return _make_icon_image()


def _make_icon_image() -> Image.Image:
    """Render a simple 'KH' badge as the tray icon (no external asset needed)."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([2, 2, size - 2, size - 2], radius=14, fill=(37, 99, 235, 255))
    text = "KH"
    try:
        bbox = draw.textbbox((0, 0), text)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]),
                  text, fill=(255, 255, 255, 255))
    except Exception:
        pass
    return img


def _server_ready(timeout: float = 1.5) -> bool:
    """True once /health answers ok. Latches so later checks are instant."""
    if _ready.is_set():
        return True
    if preflight.is_healthy(timeout=timeout):
        _ready.set()
        return True
    return False


def _start_autoopen(icon) -> None:
    """Poll until the server is ready, then open Swagger automatically. One at a time."""
    global _autoopen_running
    with _autoopen_lock:
        if _autoopen_running:
            return
        _autoopen_running = True

    def _wait() -> None:
        global _autoopen_running
        try:
            for _ in range(180):  # ~180s ceiling
                if _server_ready(timeout=1.0):
                    logger.info("Server ready — auto-opening Swagger: %s", DOCS_URL)
                    webbrowser.open(DOCS_URL)
                    return
                time.sleep(1)
            logger.warning("Server still not ready after ~180s; giving up auto-open.")
        finally:
            with _autoopen_lock:
                _autoopen_running = False

    threading.Thread(target=_wait, name="autoopen", daemon=True).start()


def _open_swagger(icon=None, item=None) -> None:
    # Debounce the double-fire so a double-click opens exactly one tab.
    global _last_activate
    with _activate_lock:
        now = time.monotonic()
        if now - _last_activate < _ACTIVATE_DEBOUNCE_S:
            return
        _last_activate = now

    if _server_ready():
        logger.info("Opening Swagger UI: %s", DOCS_URL)
        webbrowser.open(DOCS_URL)
        return
    logger.info("Swagger requested but server not ready yet — will auto-open when ready.")
    if icon is not None:
        try:
            icon.notify(
                "Dang nap model, chua san sang.\nSe tu mo Swagger ngay khi xong.",
                "KnowledgeHub dang khoi dong",
            )
        except Exception:
            pass
    _start_autoopen(icon)


def _open_health(icon=None, item=None) -> None:
    webbrowser.open(HEALTH_URL)


def _quit(icon, server) -> None:
    logger.info("Shutting down KnowledgeHub tray ...")
    if server is not None:
        server.should_exit = True
    icon.stop()


def run_tray() -> int:
    """Start the server (background thread) + system-tray icon."""
    # Reuse the launch preflight so we never fight the single-writer Kuzu lock:
    # attach if a healthy instance is already up, else kill any stale instance.
    server = None
    if preflight.is_healthy():
        logger.info("KnowledgeHub already healthy on %s — tray attaches, no new server.", DOCS_URL)
    else:
        stale = preflight.find_kh_processes()
        if stale:
            logger.info("Killing %d stale KnowledgeHub process(es) to release Kuzu lock.", len(stale))
            preflight.kill_processes(stale)
        if preflight.port_listening():
            logger.error("Port %d is held by a foreign process — aborting.", PORT)
            return 2

        # Pass the app OBJECT (not "main:app") so uvicorn does not re-import this
        # module — running `python main.py` would otherwise execute it twice.
        config = uvicorn.Config(app, host=HOST, port=PORT, reload=False)
        server = uvicorn.Server(config)
        # uvicorn skips signal-handler installation off the main thread, so this is safe.
        threading.Thread(target=server.run, name="uvicorn", daemon=True).start()
        logger.info("KnowledgeHub server starting on http://localhost:%d ...", PORT)

    def _serve_headless() -> int:
        """No tray: keep the server in the foreground until it stops, which is what a service wrapper expects."""
        if server is not None:
            try:
                while not server.should_exit:
                    time.sleep(0.5)
            except KeyboardInterrupt:
                server.should_exit = True
        return 0

    # A tray only where there is a desktop to show it: not on a cloud host, not in a Windows service (session 0),
    # not with KH_NO_TRAY=1. See app/desktop.py.
    from app.desktop import tray_supported
    tray_ok, why = tray_supported()
    if not tray_ok:
        logger.info("No tray icon: %s - server runs headless.", why)
        return _serve_headless()
    import pystray
    from pystray import Menu, MenuItem

    menu = Menu(
        MenuItem("Mở Swagger (/docs)", _open_swagger, default=True),
        MenuItem("Mở Health", _open_health),
        Menu.SEPARATOR,
        MenuItem("Thoát", lambda icon, item: _quit(icon, server)),
    )
    starting = server is not None
    icon = pystray.Icon(
        "KnowledgeHub",
        icon=_load_icon_image(),
        title=("KnowledgeHub - dang khoi dong (nap model)..." if starting
               else f"KnowledgeHub - {DOCS_URL}"),
        menu=menu,
    )

    def _setup(icon) -> None:
        """Runs once the tray loop is live: watch for readiness, then notify."""
        icon.visible = True
        if not starting:
            _ready.set()
            return

        def _monitor() -> None:
            for _ in range(300):  # ~600s ceiling
                if _server_ready(timeout=1.0):
                    icon.title = f"KnowledgeHub - san sang ({DOCS_URL})"
                    try:
                        icon.notify("San sang! Double-click de mo Swagger.", "KnowledgeHub")
                    except Exception:
                        pass
                    return
                time.sleep(2)

        threading.Thread(target=_monitor, name="ready-monitor", daemon=True).start()

    logger.info("Tray icon ready. Double-click to open Swagger.")
    try:
        icon.run(setup=_setup)  # blocks the main thread until _quit() stops it
    except Exception:
        # The desktop check passed but the tray still failed (no shell, broken backend): keep serving.
        logger.exception("Tray icon failed - server keeps running headless.")
        return _serve_headless()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run_tray())
    except SystemExit:
        raise
    except BaseException:
        logger.exception("KnowledgeHub launcher crashed")
        raise
