"""Project bundles — the uniform unit of isolation (v6.4).

The v6.3 orchestrator isolated by *source_id*, which let one repo split into three
fragments (``X``, ``graphify__X``, ``gitnexus__X``) and left the graph in a single
shared Kùzu file. v6.4 makes the unit a **PROJECT**: one project is a BUNDLE that
binds together every kind of information it owns, each in its own physical namespace:

    vector      Chroma collection  kh_src_<id>      source code, tier T1–T4
    knowledge   Chroma collection  kh_know_<id>     C4 knowledge (L1–L4)
    log         Chroma collection  kh_log_<id>      REQUEST/WORK/BUG worklog
    findings    Chroma collection  kh_find_<id>     accumulated findings (SA-1)
    policy      Chroma collection  kh_policy_<id>   per-project policy (SA-2)
    graph       Kùzu directory     kuzu_data/<id>/  per-project graph (physical, B3)
    counter     JSON file          projects/<id>/counter.json   failing-counter (SA-1)

The tool that produced a fragment (graphify / gitnexus) becomes vector metadata and
a graph edge attribute — it is NEVER part of the id (see :func:`assert_canonical_id`).

The **orchestrator** is itself a project, using the exact same bundle shape, only its
``role`` is ``manage`` instead of ``project``: its vector collection holds route
shortcuts + facts, and its knowledge/policy/findings are the COMMON (cross-project) set.

This module owns the bundle LAYOUT + the manifest that binds a project to its physical
parts + a get-or-create helper. It does not move data or create empty Chroma collections
(those are made lazily on first write, so an unused part never shows up as an orphan).
Later phases build on it: B2 canonical identity, B3 per-project graph, B4 vector model,
B5 policy, B6 routing, B7 feedback.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import unicodedata
import threading
from dataclasses import dataclass, asdict

from fastapi import Query, Request
from datetime import datetime, timezone

from . import config
from . import docstore
from . import projects_store

logger = logging.getLogger(__name__)

# The special manage-role project. Same bundle shape; holds the common set + shortcuts.
ORCHESTRATOR_ID = "orchestrator"

# Tool prefixes that must never appear in a canonical project id — the exact bug
# (one repo → graphify__X / gitnexus__X) that the project model exists to kill.
_TOOL_PREFIXES = ("graphify__", "gitnexus__")

# THE REGISTRY IS A TABLE, NOT A FILE (fen, 2026-09-22). It used to be
# projects_manifest.json here; it now lives in KH's own hooks.db and is reached through
# app/projects_store.py. The path is kept only to name the legacy file in logs and to let
# the store import it once - see projects_store.migrate_from_file.
_MANIFEST_PATH = projects_store.legacy_manifest_path()
_MANIFEST_VERSION = 2
_manifest_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Identity — canonical id validation (foundation reused by B2)
# ---------------------------------------------------------------------------

def normalize_project_id(raw: str) -> str:
    """Trim + lowercase-free passthrough of a project id (ids are case-sensitive kebab).

    We keep the id verbatim (proper-noun-safe) minus surrounding whitespace; the only
    hard rule is enforced by :func:`assert_canonical_id`.
    """
    return (raw or "").strip()


def assert_canonical_id(project_id: str) -> str:
    """Return the id if canonical, else raise ValueError.

    Canonical = non-empty AND carries no tool prefix. ``graphify__ticketing`` is a tool
    fragment, not a project; it must be merged into project ``ticketing`` with the tool
    recorded as metadata instead. Guarding at the identity edge means a fragment can
    never be minted as a project by accident.
    """
    pid = normalize_project_id(project_id)
    if not pid:
        raise ValueError("project id required")
    low = pid.lower()
    for pre in _TOOL_PREFIXES:
        if low.startswith(pre):
            raise ValueError(
                f"'{pid}' carries the tool prefix '{pre}': a tool fragment is not a project. "
                f"Use the bare project id (e.g. '{pid[len(pre):]}') and pass tool='{pre[:-2]}' as metadata."
            )
    return pid


# ---------------------------------------------------------------------------
# Bundle layout — the single source of truth for every part's physical name/path
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProjectBundle:
    """The resolved physical binding of one project's parts. Pure paths/names — no I/O."""
    id: str
    role: str                 # "project" | "manage"
    bundle_dir: str           # filesystem home for file-based parts
    counter_file: str         # SA-1 failing-counter
    descriptor_file: str      # self-describing bundle.json
    graph_dir: str            # per-project Kùzu directory (B3)
    vector_collection: str    # kh_src_<id>     — source code / tier
    knowledge_collection: str # kh_know_<id>    — C4 knowledge
    log_collection: str       # kh_log_<id>     — worklog
    findings_collection: str  # kh_find_<id>    — findings (SA-1)
    policy_collection: str    # kh_policy_<id>  — policy (SA-2)

    def as_paths(self) -> dict:
        """The manifest-facing binding block (what gets persisted under 'paths')."""
        return {
            "bundle": self.bundle_dir,
            "counter": self.counter_file,
            "descriptor": self.descriptor_file,
            "graph": self.graph_dir,
            "vector": self.vector_collection,
            "knowledge": self.knowledge_collection,
            "log": self.log_collection,
            "findings": self.findings_collection,
            "policy": self.policy_collection,
        }


def bundle_of(project_id: str, role: str = "project") -> ProjectBundle:
    """Resolve a project id to its physical layout WITHOUT touching disk or the manifest.

    Deterministic naming is the contract: any module (vector_store, graph adapter,
    policy subsystem) can compute a project's collection/dir names from the id alone.
    """
    pid = assert_canonical_id(project_id)
    bundle_dir = os.path.join(config.PROJECTS_PATH, pid)
    return ProjectBundle(
        id=pid,
        role=role,
        bundle_dir=bundle_dir,
        counter_file=os.path.join(bundle_dir, "counter.json"),
        descriptor_file=os.path.join(bundle_dir, "bundle.json"),
        graph_dir=os.path.join(config.KUZU_PROJECTS_PATH, pid),
        vector_collection=f"kh_src_{pid}",
        knowledge_collection=f"kh_know_{pid}",
        log_collection=f"kh_log_{pid}",
        findings_collection=f"kh_find_{pid}",
        policy_collection=f"kh_policy_{pid}",
    )


# ---------------------------------------------------------------------------
# Manifest (project → physical binding) — atomic load/save
# ---------------------------------------------------------------------------

def _load() -> dict:
    """The registry, in the shape the manifest had.

    THE SHAPE IS PRESERVED ON PURPOSE so that everything above this line - get-or-create,
    the C4 registry sync, delete_project, the /projects route - never learned that the
    storage changed. There is no 'starting empty' fallback any more, and that is the
    point of the move: a file rewritten whole could be lost whole, and answering with an
    empty registry would orphan every project's data while looking healthy.
    """
    return {"version": _MANIFEST_VERSION, "projects": projects_store.load_all()}


def _save(man: dict) -> None:
    """Persist a whole registry dict. Startup/migration only - runtime writes are per row
    (projects_store.upsert_one / delete_one), so a stale copy on another instance cannot delete
    a project created meanwhile (stage F1)."""
    projects_store.save_all((man or {}).get("projects") or {})


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# get-or-create — the one way a project comes into existence
# ---------------------------------------------------------------------------

def get_or_create_project(
    project_id: str,
    *,
    role: str = "project",
    aliases: list[str] | None = None,
    keywords: list[str] | None = None,
    tools: list[str] | None = None,
    descriptor: str = "",
    conflicts_with: list[str] | None = None,
    source: str | None = None,
) -> dict:
    """Idempotently materialise a project bundle + register it in the manifest.

    ``source`` names the system that made the project ("KH" when missing, null or blank; the DLC engine
    sends "AI-SDLC"). A later call that names a source changes it; one that names none keeps it.

    Creates only the filesystem skeleton (bundle dir, per-project graph dir, an empty
    counter, a self-describing bundle.json) — never empty Chroma collections, which are
    made on first write. Re-calling with new aliases/keywords/tools MERGES them in and
    preserves ``created_at``. Returns the manifest entry.
    """
    b = bundle_of(project_id, role=role)

    # Filesystem skeleton (idempotent).
    os.makedirs(b.bundle_dir, exist_ok=True)
    os.makedirs(b.graph_dir, exist_ok=True)
    if not docstore.exists(b.counter_file):
        _write_json(b.counter_file, {"request_total": 0, "issues": {}})

    with _manifest_lock:
        existing = projects_store.get_one(b.id) or {}

        entry = {
            "id": b.id,
            "role": role,
            "aliases": _merge(existing.get("aliases"), aliases),
            "keywords": _merge(existing.get("keywords"), keywords),
            "tools": _merge(existing.get("tools"), tools),
            "descriptor": descriptor or existing.get("descriptor", ""),
            "conflicts_with": _merge(existing.get("conflicts_with"), conflicts_with),
            "paths": b.as_paths(),
            "source": (projects_store.clean_source(source) if source not in (None, "") and str(source).strip()
                       else existing.get("source") or projects_store.DEFAULT_SOURCE),
            "created_at": existing.get("created_at") or _now(),
            "updated_at": _now(),
        }
        projects_store.upsert_one(entry)

    # The bundle is also self-describing on disk, so a project dir explains itself
    # even without the central manifest (survives a manifest loss / manual copy).
    _write_json(b.descriptor_file, {**entry})
    logger.info("projects — get-or-create %s (role=%s) at %s", b.id, role, b.bundle_dir)
    return entry


def ensure_orchestrator() -> dict:
    """Bootstrap the manage-role orchestrator project (called at startup).

    The orchestrator uses the identical bundle shape; its collections hold route
    shortcuts + facts (vector), and the COMMON knowledge/policy/findings shared across
    projects. Routing (B6) reads from it; here we only guarantee it exists.
    """
    return get_or_create_project(
        ORCHESTRATOR_ID,
        role="manage",
        descriptor=(
            "Orchestrator — the manage-role project. Holds route shortcuts + facts, "
            "plus the common (cross-project) knowledge, policy and findings. Default "
            "answer surface when a query names no project."
        ),
    )


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def list_projects() -> dict:
    return _load()["projects"]


def get_project(project_id: str) -> dict | None:
    return _load()["projects"].get(normalize_project_id(project_id))


def project_exists(project_id: str) -> bool:
    return normalize_project_id(project_id) in _load()["projects"]


# ---------------------------------------------------------------------------
# Project identity in the ORCHESTRATOR'S C4 TREE + literal name matching
# ---------------------------------------------------------------------------
# fen's mechanism (2026-08-21), step 1 of every turn: an intent is resolved to a project by
# asking the orchestrator, and what the orchestrator knows about a project is written into its
# C4 tree when the project is initialised. The resolution itself is a LITERAL term match over
# that tree - no embedder, no threshold - because a wrong project would pull the wrong project's
# policy, and that is exactly the failure mode the semantic route was retired for.
#
# One C4 record per project, in kh_know_orchestrator:
#   id        project_registry__<project id>
#   lv        1               (C4 L1 - the project as a system in the orchestrator's context)
#   tree_id   c4_project_registry
#   kind      project-registry
#   terms     folded id + aliases + keywords, pipe-joined (what the matcher reads)
# The record is also a normal knowledge vector, so it stays semantically retrievable for
# ordinary questions; nothing in the routing path reads its embedding.

REGISTRY_TREE = "c4_project_registry"
REGISTRY_KIND = "project-registry"
_REGISTRY_ID = "project_registry__%s"


def _fold(text: str) -> str:
    """Lowercase, strip accents, reduce every non-alphanumeric run to one space.

    fen writes Vietnamese with diacritics and rarely uses the exact id: "tinh hinh con
    ticketing sao roi" must reach project ``ticketing-system``. Folding both sides makes
    'SMDG_V1', 'smdg v1' and 'smdg-v1' the same string, so matching is literal.
    """
    n = unicodedata.normalize("NFD", text or "")
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in n.lower()).split())


def _terms_of(entry: dict) -> list[tuple[str, str]]:
    """(folded term, where it came from) for one project, longest term first."""
    terms = [(entry.get("id", ""), "id")]
    terms += [(a, "alias") for a in (entry.get("aliases") or [])]
    terms += [(k, "keyword") for k in (entry.get("keywords") or [])]
    folded = [(_fold(t), src) for t, src in terms if _fold(t)]
    return sorted(set(folded), key=lambda x: -len(x[0]))


def _registry_text(entry: dict) -> str:
    """The C4 L1 sentence stored for a project - readable, and useful to ordinary queries."""
    parts = ["PROJECT %s (role %s)." % (entry.get("id"), entry.get("role", "project"))]
    if entry.get("descriptor"):
        parts.append(entry["descriptor"])
    if entry.get("aliases"):
        parts.append("Also called: %s." % ", ".join(entry["aliases"]))
    if entry.get("keywords"):
        parts.append("Keywords: %s." % ", ".join(entry["keywords"]))
    if entry.get("conflicts_with"):
        parts.append("Never blend with: %s." % ", ".join(entry["conflicts_with"]))
    return " ".join(parts)


def _registry_collection():
    from . import vector_store as vs
    return vs.get_or_create(bundle_of(ORCHESTRATOR_ID, role="manage").knowledge_collection)


def registry_entries() -> list[dict]:
    """Every project the orchestrator's C4 tree knows about (metadata read - no embedding)."""
    from . import vector_store as vs
    try:
        rows = vs.get_vt({"kind": {"$eq": REGISTRY_KIND}}, collection=_registry_collection())
    except Exception:
        logger.exception("projects — C4 registry read failed")
        return []
    out = []
    for r in rows:
        m = r.get("metadata") or {}
        pid = m.get("project_id") or m.get("subject_key")
        if not pid:
            continue
        out.append({
            "id": pid,
            "role": m.get("role", "project"),
            "aliases": [x for x in (m.get("aliases") or "").split("|") if x],
            "keywords": [x for x in (m.get("keywords") or "").split("|") if x],
            "descriptor": m.get("descriptor", ""),
            "source": "c4",
        })
    return out


def upsert_registry_entry(entry: dict, embedding: list[float]) -> str:
    """Write/refresh one project's C4 L1 record in the orchestrator tree. Idempotent by id."""
    from . import vector_store as vs
    pid = entry["id"]
    rid = _REGISTRY_ID % pid
    text = _registry_text(entry)
    meta = {
        "scope": "knowledge", "project": ORCHESTRATOR_ID, "kind": REGISTRY_KIND,
        "layered": "1", "tree_id": REGISTRY_TREE, "lv": 1, "parent_id": "",
        "subject_key": pid, "project_id": pid, "role": entry.get("role", "project"),
        "aliases": "|".join(entry.get("aliases") or []),
        "keywords": "|".join(entry.get("keywords") or []),
        "terms": "|".join(t for t, _src in _terms_of(entry)),
        "descriptor": entry.get("descriptor", ""),
        "updated_at": _now(),
    }
    vs.upsert_vt(rid, embedding, source_text=text, metadata=meta,
                 collection=_registry_collection())
    logger.info("projects — C4 registry upsert %s (%d terms)", pid, len(meta["terms"].split("|")))
    return rid


def sync_orchestrator_registry(embed_fn) -> dict:
    """Make the C4 registry match the manifest. Idempotent; safe on every startup.

    Only writes a project whose registry record is missing or whose terms/descriptor moved,
    so a normal startup embeds nothing. `embed_fn(text) -> list[float]`.
    """
    have = {e["id"]: e for e in registry_entries()}
    written, skipped = [], []
    for pid, entry in _load()["projects"].items():
        want = {"id": pid, "role": entry.get("role", "project"),
                "aliases": entry.get("aliases") or [], "keywords": entry.get("keywords") or [],
                "descriptor": entry.get("descriptor", ""),
                "conflicts_with": entry.get("conflicts_with") or []}
        cur = have.get(pid)
        if cur and cur["aliases"] == want["aliases"] and cur["keywords"] == want["keywords"] \
                and cur["descriptor"] == want["descriptor"]:
            skipped.append(pid)
            continue
        vec = embed_fn(_registry_text(want))
        upsert_registry_entry(want, list(vec))
        written.append(pid)
    if written:
        logger.info("projects — C4 registry synced: wrote %s, unchanged %d",
                    written, len(skipped))
    return {"written": written, "unchanged": skipped, "total": len(written) + len(skipped)}


def match_projects(text: str) -> list[dict]:
    """Every project whose id / alias / keyword appears in `text`, best match first.

    Source of truth is the orchestrator's C4 registry; the manifest is a fallback for an
    install whose registry has not been synced yet, so routing never depends on the sync
    having run. A term matches on WORD BOUNDARIES in the folded text, so 'code' does not
    match 'codegraph' and a two-word alias must appear as those two words in order. Ranking:
    longest matched term first (more specific wins), then id > alias > keyword, then project
    id for stability. Returns [] when nothing matches - a real answer meaning 'no project',
    after which policy is read from the every-project tier alone.
    """
    entries = registry_entries()
    source = "c4"
    if not entries:
        entries = [{"id": pid, "role": e.get("role", "project"),
                    "aliases": e.get("aliases") or [], "keywords": e.get("keywords") or []}
                   for pid, e in _load()["projects"].items()]
        source = "manifest-fallback"
    # With sign-in on, a project the caller cannot read is never a candidate (D6): matching on
    # its name would leak that it exists.
    from . import auth
    allowed = auth.visible_projects()
    if allowed is not None:
        entries = [e for e in entries if e.get("id") in allowed]
    hay = " %s " % _fold(text)
    rank = {"id": 0, "alias": 1, "keyword": 2}
    out = []
    for entry in entries:
        best = None
        for term, src in _terms_of(entry):
            if (" %s " % term) in hay:
                if best is None or len(term) > len(best[0]) or (
                        len(term) == len(best[0]) and rank[src] < rank[best[1]]):
                    best = (term, src)
        if best:
            # `weak` = matched ONLY by a short keyword, which is not enough to route on.
            # See config.PROJECT_MATCH_WEAK_KEYWORD_LEN for the measurement behind it:
            # 'cap' (a keyword of simplemdg-v1) matched the second syllable of the
            # Vietnamese 'nang cap' and routed a hook request to the wrong project.
            # The hit is still REPORTED - only its right to be `best` is withdrawn.
            weak = (best[1] == "keyword"
                    and len(best[0]) < config.PROJECT_MATCH_WEAK_KEYWORD_LEN)
            out.append({"project": entry["id"], "matched_term": best[0], "matched_on": best[1],
                        "term_length": len(best[0]), "role": entry.get("role", "project"),
                        "weak": weak, "source": source})
    return sorted(out, key=lambda m: (-m["term_length"], rank[m["matched_on"]], m["project"]))


def resolve_project_name(text: str) -> str | None:
    """The single best project id for this text, or None when nothing matches.

    None is returned for an AMBIGUOUS match too - two different projects matched by terms of
    the same length - because silently taking the first would be a guess. Callers that need to
    know the difference read match_projects() and see two hits.
    """
    hits = match_projects(text)
    if not hits:
        return None
    # A WEAK top hit routes nothing. Hits are ordered longest-term first, so if the
    # best one was matched only by a short keyword, every other hit is at least as
    # weak and there is no confident answer to give. Returning None here is the same
    # honest 'no project' the caller already handles, and is strictly better than
    # naming a project a single Vietnamese syllable happened to collide with
    # (measured 2026-09-07 - see config.PROJECT_MATCH_WEAK_KEYWORD_LEN).
    if hits[0].get("weak"):
        return None
    if len(hits) > 1 and hits[1]["term_length"] == hits[0]["term_length"] \
            and hits[1]["matched_on"] == hits[0]["matched_on"]:
        return None
    return hits[0]["project"]


def canonical_or_none(project: str) -> str | None:
    """Turn whatever the caller passed into a real project id, or None.

    Accepts an exact id, or an alias/keyword ('ticketing' -> 'ticketing-system'), so an agent
    can pass fen's own words straight through.
    """
    pid = normalize_project_id(project)
    if not pid:
        return None
    if project_exists(pid):
        return pid
    return resolve_project_name(pid)


def read_counter(project_id: str) -> dict:
    b = bundle_of(project_id)
    from . import feedback   # the counter lives in feedback_issue / kh_counter rows since stage F1
    return feedback._read(b.id)


# ---------------------------------------------------------------------------
# delete-project — atomic-ish teardown of a whole bundle (SA-6, B9)
# ---------------------------------------------------------------------------

def delete_project(project_id: str, *, confirm: bool = False) -> dict:
    """Tear down a project bundle: every collection + graph dir + manifest + hub + dir.

    Physical isolation is what makes this safe & cheap — a project is a set of dedicated
    namespaces, so deleting it is dropping those namespaces, not surgically removing rows
    from shared stores. Requires ``confirm=True`` (a preview is returned otherwise).
    The orchestrator (role=manage) is protected — it is never deletable this way.
    """
    import shutil
    from . import vector_store as vs
    from .graph_db.project_graph import drop_project_graph

    pid = assert_canonical_id(project_id)
    entry = get_project(pid)
    if not entry:
        raise ValueError(f"no project '{pid}'")
    if entry.get("role") == "manage" or pid == ORCHESTRATOR_ID:
        raise ValueError("refusing to delete the orchestrator (manage-role) project")

    b = bundle_of(pid, role=entry.get("role", "project"))
    # Basic parts + ANY custom per-project part (kh_<scope>_<id>) this project grew —
    # an extensible bundle must be fully removable, not just its fixed collections.
    collections = [b.vector_collection, b.knowledge_collection, b.log_collection,
                   b.findings_collection, b.policy_collection]
    try:
        suffix = f"_{pid}"
        for name in vs.existing_collection_names():
            if name.startswith("kh_") and name.endswith(suffix) and name not in collections:
                collections.append(name)
    except Exception:
        logger.exception("delete_project — enumerating custom parts failed for %s", pid)

    if not confirm:
        return {"preview": True, "project": pid, "would_drop_collections": collections,
                "would_drop_graph_dir": b.graph_dir, "would_remove_bundle_dir": b.bundle_dir,
                "hint": "re-call with confirm=true to delete"}

    report: dict = {"project": pid, "collections": {}, "graph": False,
                    "bundle_dir": False, "manifest": False, "hub": False, "shortcut": False}

    for name in collections:
        report["collections"][name] = vs.drop_collection(name)
    report["graph"] = drop_project_graph(pid)

    # orchestrator legacy hub descriptor + src-index breadcrumb + shortcut
    try:
        vs.delete_hub_descriptor(pid)
        vs.delete_vt([f"srcidx__{pid}"])
        report["hub"] = True
    except Exception:
        logger.exception("delete_project — hub cleanup failed for %s", pid)
    try:
        vs.get_or_create("kh_orch_resolve").delete(ids=[f"shortcut__{pid}"])
        report["shortcut"] = True
    except Exception:
        pass

    with _manifest_lock:
        if projects_store.delete_one(pid):
            report["manifest"] = True
    try:
        from . import feedback
        feedback.forget_project(pid)
    except Exception:
        logger.exception("delete_project — feedback counter cleanup failed for %s", pid)
    # legacy orchestrator manifest entry too
    try:
        from . import orchestrator as orch
        with orch._manifest_lock:
            oman = orch._load()
            if oman.get("sources", {}).pop(pid, None) is not None:
                orch._save(oman)
    except Exception:
        pass

    try:
        if docstore.delete_tree(b.bundle_dir):
            report["bundle_dir"] = True
    except Exception:
        logger.exception("delete_project — rmtree bundle dir failed for %s", pid)

    # The two SHARED stores that hold rows of this project (found by the two-person e2e run,
    # 2026-09-26): its worklogs still sitting in the hot log window, and its C4 registry row
    # in orchestrator knowledge. Dropping the project's own collections leaves both behind.
    try:
        hot = vs.hotlog_collection()
        ids = hot.get(where={"project": {"$eq": pid}}).get("ids") or []
        if ids:
            hot.delete(ids=ids)
        report["hot_window_rows"] = len(ids)
    except Exception:
        logger.exception("delete_project — hot window cleanup failed for %s", pid)
    try:
        _registry_collection().delete(ids=[_REGISTRY_ID % pid])
        report["registry"] = True
    except Exception:
        logger.exception("delete_project — registry cleanup failed for %s", pid)
    from . import personal, project_access
    project_access.forget(pid)
    personal._touched.discard(pid)          # a deleted personal project is made again at its owner's next session
    try:
        from .policy_actions import store as policy_store
        report["policy"] = policy_store.delete_project_rows(pid)
    except Exception:
        logger.exception("delete_project - could not drop the policy rows of %s", pid)

    logger.info("delete_project — %s removed: %s", pid, report)
    return report


# ---------------------------------------------------------------------------
# small utils
# ---------------------------------------------------------------------------

def _merge(existing: list | None, incoming: list | None) -> list:
    """Union two string lists preserving order (existing first). None-safe."""
    out: list = list(existing or [])
    for x in (incoming or []):
        if x and x not in out:
            out.append(x)
    return out


def _write_json(path: str, obj: dict) -> None:
    docstore.write_json(path, obj)


def _with_visibility(entry: dict) -> dict:
    """A registry entry as the routes return it: with how public the project is."""
    from . import project_access
    return {**entry, "visibility": project_access.visibility_of(entry.get("id", ""))}


# ---------------------------------------------------------------------------
# Endpoint registration (additive — inspect + get-or-create)
# ---------------------------------------------------------------------------

def attach(app) -> None:
    from fastapi import HTTPException

    TAG = ["Projects"]

    @app.get("/projects", tags=TAG, summary="List project bundles + their physical bindings "
             "(?source=AI-SDLC: only the projects that system made)")
    async def projects_list(source: str | None = None):
        # `store` says WHERE the registry is, which is the question somebody asks right
        # after being told it is no longer a file they can open.
        from . import auth
        everything = list_projects()
        if source is not None and source.strip():
            want = source.strip()
            everything = {pid: e for pid, e in everything.items()
                          if (e.get("source") or projects_store.DEFAULT_SOURCE) == want}
        visible = auth.filter_projects(everything.keys())
        return {"version": _MANIFEST_VERSION,
                "projects": {pid: _with_visibility(everything[pid]) for pid in visible},
                "store": projects_store.stats()}

    @app.post("/projects/registry/sync", tags=TAG,
              summary="Make the orchestrator's C4 project registry match the manifest")
    async def project_registry_sync(request: Request):
        def embed(text: str):
            return request.app.state.model.encode(text, normalize_embeddings=True).tolist()
        return await asyncio.to_thread(sync_orchestrator_registry, embed)

    @app.get("/projects/registry", tags=TAG,
             summary="What the orchestrator's C4 tree knows about each project")
    async def project_registry_list():
        from . import auth
        entries = registry_entries()
        allowed = auth.visible_projects()
        if allowed is not None:
            entries = [e for e in entries if (e.get("project") or e.get("id")) in allowed]
        return {"count": len(entries), "source": "c4" if entries else "empty",
                "projects": entries}

    @app.get("/projects/{project_id}", tags=TAG, summary="One project bundle + live counter")
    async def project_get(project_id: str):
        entry = get_project(project_id)
        if not entry:
            raise HTTPException(404, f"no project '{project_id}'")
        return {**_with_visibility(entry), "counter": read_counter(project_id)}

    @app.put("/projects/{project_id}/visibility", tags=TAG,
             summary="Set how public a project is: private | semi-public | public (its owner or a maintainer)")
    async def project_visibility_set(project_id: str, body: dict):
        """semi-public: everyone holding semi.read reads it; public: public.read reads and public.write
        edits it; the roles are carried by tenant groups. Keycloak records it and decides who may set it
        (whoever manages the project's people); KH keeps a copy for display. See app/project_access.py."""
        from . import auth, project_access
        if get_project(project_id) is None:
            raise HTTPException(404, f"no project '{project_id}'")
        visibility = (body or {}).get("visibility", "")
        caller = auth.current()
        try:
            project_access.check(project_id, visibility)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        try:
            await asyncio.to_thread(auth.set_project_visibility, project_id, visibility)
        except auth.RegistryRefused as exc:
            raise HTTPException(exc.status if exc.status in (400, 403, 404) else 502, exc.detail)
        await asyncio.to_thread(project_access.set_visibility, project_id, visibility, caller.email if caller else "")
        out = {"project": project_id, "visibility": visibility}
        if caller is not None:
            out["token_refresh_needed"] = True       # the new levels reach a token at its next refresh
        return out

    @app.post("/projects", tags=TAG, summary="Get-or-create a project bundle (idempotent)")
    async def project_create(body: dict, request: Request):
        """Create/refresh the bundle AND publish the project into the orchestrator's C4 tree.

        The C4 record is what step 1 of every turn reads to turn fen's words into a project id
        (fen 2026-08-21), so it is written here rather than by a separate call nobody remembers:
        registering a project and being findable by name are the same event.
        """
        from . import auth
        pid = (body.get("project_id") or body.get("id") or "").strip()
        if not pid:
            raise HTTPException(400, "project_id required")
        # optional: which system makes the project; missing, null or blank = "KH"
        raw = body.get("source")
        try:
            source = None if raw is None or (isinstance(raw, str) and not raw.strip()) \
                else projects_store.clean_source(raw)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        is_new = get_project(pid) is None
        from . import personal
        caller = auth.current()
        if personal.is_personal(pid) and caller is not None:
            # Personal projects are made by KH itself on a person's first personalization write, and
            # their access follows the e-mail, so an id in that namespace can never be claimed here.
            raise HTTPException(403, "personal projects are created by KH; store scope=personalization instead")
        if not is_new and not auth.may(pid, "project.write"):
            raise HTTPException(403, "missing permission project.write on this project")
        from . import project_access
        # A new project is private unless its creator (its owner) says otherwise; an existing
        # project changes visibility only through PUT /projects/{id}/visibility.
        visibility = body.get("visibility") if is_new else None
        if visibility is not None:
            try:
                project_access.check(pid, visibility)
            except ValueError as exc:
                raise HTTPException(400, str(exc))
        if is_new:
            # Ownership is claimed at the identity service first, so two people cannot both
            # create the same id; if the local create then fails the claim is withdrawn.
            try:
                await asyncio.to_thread(auth.register_project, pid, visibility or project_access.PRIVATE)
            except auth.RegistryRefused as exc:
                raise HTTPException(exc.status if exc.status in (400, 403, 409) else 502, exc.detail)
        try:
            entry = get_or_create_project(
                pid,
                role=body.get("role", "project"),
                aliases=body.get("aliases"),
                keywords=body.get("keywords"),
                tools=body.get("tools"),
                descriptor=body.get("descriptor", ""),
                conflicts_with=body.get("conflicts_with"),
                source=source,
            )
        except ValueError as exc:
            if is_new:
                try:
                    await asyncio.to_thread(auth.unregister_project, pid)
                except auth.RegistryRefused:
                    logger.exception("projects — could not withdraw the registration of %s", pid)
            raise HTTPException(400, str(exc))
        if visibility and visibility != project_access.PRIVATE:
            # Keycloak recorded it with the registration above; this is KH's copy for display.
            await asyncio.to_thread(project_access.set_visibility, pid, visibility, caller.email if caller else "")
        entry = _with_visibility(entry)
        if is_new and auth.current() is not None:
            # The creator's current token predates the project; the helper fetches a new one.
            entry = {**entry, "token_refresh_needed": True}
        try:
            text = _registry_text(entry)
            emb = await asyncio.to_thread(request.app.state.model.encode, text,
                                          normalize_embeddings=True)
            upsert_registry_entry(entry, emb.tolist())
            entry = {**entry, "c4_registry": "written"}
        except Exception:
            # A bundle that exists but is not yet findable by name is recoverable (the sync at
            # startup, or POST /projects/registry/sync, repairs it) - so never fail creation.
            logger.exception("projects — C4 registry write failed for %s", pid)
            entry = {**entry, "c4_registry": "failed - run POST /projects/registry/sync"}
        return entry

    @app.delete("/projects/{project_id}", tags=TAG,
                summary="Atomically delete a project bundle (collections + graph + manifest + dir). confirm=true required")
    async def project_delete(project_id: str, confirm: bool = False):
        from . import auth
        if not confirm:
            raise HTTPException(400, "confirm=true required")
        # The identity service re-checks project.delete against current grants before anything
        # is removed here, so a token issued before the owner lost the right cannot delete.
        # A personal project is not registered there (app/personal.py): its owner is decided by
        # the e-mail in the token, which the route's permission check has already applied.
        from . import personal
        if not personal.is_personal(project_id):
            try:
                await asyncio.to_thread(auth.unregister_project, project_id)
            except auth.RegistryRefused as exc:
                if exc.status != 404:
                    raise HTTPException(exc.status if exc.status in (400, 403) else 502, exc.detail)
        try:
            return delete_project(project_id, confirm=confirm)
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    logger.info("Projects routes attached (registry=%s)", projects_store.stats())
