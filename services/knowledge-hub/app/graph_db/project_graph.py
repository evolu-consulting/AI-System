"""Per-project physical graph isolation (B3).

v6.3 kept every project's nodes/edges in ONE Kùzu database and separated them only
by a ``<source_id>__`` prefix + a ``startswith`` filter at read time. That is
isolation-by-trust: a single bad filter leaks one project's edges into another's
blast-radius. v6.4 isolates by STRUCTURE — each project gets its OWN Kùzu database
directory ``kuzu_data/<project>/``, so a traversal physically cannot reach another
project's nodes and deleting a project is ``rmtree`` of one directory (SA-6).

This module is the registry: :func:`get_project_graph` returns a cached
``KuzuAdapter`` bound to the project's own directory, bootstrapped on first open.
The global ``graph_db`` singleton stays for the legacy flat ``/graph`` endpoints; new
project work goes through here.

Note: physical isolation makes the ``<project>__`` core_id prefix redundant for
correctness, but callers may still pass prefixed ids — a prefix inside a per-project
DB is harmless, so we do not force a migration of the id scheme here.
"""
from __future__ import annotations

import logging
import os
import shutil
import threading
from collections import OrderedDict

from .. import config
from ..projects import assert_canonical_id, ORCHESTRATOR_ID
from .base import GraphDB

_logger = logging.getLogger(__name__)

# LRU-ordered so the least-recently-used open DB is evicted first (memory bound).
_graphs: "OrderedDict[str, GraphDB]" = OrderedDict()
_lock = threading.RLock()

# The orchestrator is the DEFAULT project (holds generic knowledge + cross-project
# links, and is the substrate the legacy graph endpoints now use). It must never be
# evicted — it is always resident so the default graph is always available.
_PINNED = {ORCHESTRATOR_ID}


_DB_FILE = "graph.kuzu"


def _on_hana() -> bool:
    """Cloud deployments keep project graphs as prefixed tables in the HANA schema.

    A container disk does not survive a restart, so with GRAPH_BACKEND=hana a project
    graph is a HanaAdapter bound to that project's own table prefix instead of a Kùzu
    directory. Isolation stays physical: different tables, not a filter.
    """
    return config.GRAPH_BACKEND == "hana"


def _hana_graph(pid: str) -> GraphDB:
    from .hana_adapter import HanaAdapter, DEFAULT_PREFIX, project_prefix
    # The orchestrator IS the default graph, so it shares the global KH_ tables with
    # the legacy graph_db singleton - one graph, not two copies of it.
    return HanaAdapter(DEFAULT_PREFIX if pid == ORCHESTRATOR_ID else project_prefix(pid))


def project_graph_dir(project_id: str) -> str:
    """The physical directory that holds a project's graph DB (no I/O)."""
    return os.path.join(config.KUZU_PROJECTS_PATH, assert_canonical_id(project_id))


def project_graph_file(project_id: str) -> str:
    """The single-file Kùzu database path inside the project's dir (no I/O)."""
    return os.path.join(project_graph_dir(project_id), _DB_FILE)


def _evict_project_graphs_locked() -> None:
    """Close least-recently-used open graphs so at most MAX_OPEN_PROJECT_GRAPHS stay
    resident. Bounds total buffer-pool memory regardless of how many projects exist.
    Caller must hold ``_lock``."""
    cap = getattr(config, "MAX_OPEN_PROJECT_GRAPHS", 8)
    while len(_graphs) > cap:
        # pick the oldest NON-pinned graph as the eviction victim
        victim = next((pid for pid in _graphs if pid not in _PINNED), None)
        if victim is None:
            break                                   # only pinned graphs remain
        old_adapter = _graphs.pop(victim)
        try:
            old_adapter.close()
        except Exception:
            _logger.exception("project graph evict — close failed: %s", victim)
        _logger.info("project graph evicted (LRU): %s", victim)


def get_project_graph(project_id: str) -> GraphDB:
    """Get-or-open the Kùzu database for ONE project (cached, LRU-bounded, bootstrapped).

    Physical isolation: the returned adapter can only ever see this project's own
    nodes/edges — a different project id opens a different database file, in its own
    directory (so deleting a project is rmtree of that one directory). At most
    ``config.MAX_OPEN_PROJECT_GRAPHS`` databases stay open; the LRU is closed to cap
    total buffer-pool memory when many projects are touched in one process.
    """
    pid = assert_canonical_id(project_id)
    with _lock:
        g = _graphs.get(pid)
        if g is not None:
            _graphs.move_to_end(pid)      # mark most-recently-used
            return g
        if _on_hana():
            gdir = "hana"
            adapter = _hana_graph(pid)
        else:
            from .kuzu_adapter import KuzuAdapter
            gdir = os.path.join(config.KUZU_PROJECTS_PATH, pid)
            os.makedirs(gdir, exist_ok=True)
            adapter = KuzuAdapter(path=os.path.join(gdir, _DB_FILE),
                                  buffer_pool_size=getattr(config, "KUZU_BUFFER_POOL_BYTES", 0))
        adapter.bootstrap()
        _graphs[pid] = adapter
        _graphs.move_to_end(pid)
        _evict_project_graphs_locked()
        _logger.info("project graph opened: %s -> %s", pid, gdir)
        return adapter


def close_project_graph(project_id: str) -> None:
    """Drop the cached adapter/handle for a project (frees the Kùzu lock).

    Must run before deleting the directory so Windows can remove the files.
    """
    pid = assert_canonical_id(project_id)
    with _lock:
        adapter = _graphs.pop(pid, None)
    if adapter is not None:
        # Release the Database + its buffer pool (and the dir lock, so Windows can
        # rmtree on delete-project). close() is best-effort across Kùzu versions.
        try:
            adapter.close()
        except Exception:
            try:
                adapter._db = None  # type: ignore[attr-defined]
            except Exception:
                pass
        _logger.info("project graph closed: %s", pid)


def drop_project_graph(project_id: str) -> bool:
    """Physically delete a project's graph directory (B9 delete-project)."""
    pid = assert_canonical_id(project_id)
    close_project_graph(pid)
    if _on_hana():
        if pid == ORCHESTRATOR_ID:
            return False                      # never drop the shared default graph
        try:
            return _hana_graph(pid).drop()
        except Exception:
            _logger.exception("failed to drop HANA project graph: %s", pid)
            return False
    path = os.path.join(config.KUZU_PROJECTS_PATH, pid)
    if not os.path.isdir(path):
        return False
    try:
        shutil.rmtree(path)
        _logger.info("project graph dir removed: %s", path)
        return True
    except Exception:
        _logger.exception("failed to remove project graph dir: %s", path)
        return False
