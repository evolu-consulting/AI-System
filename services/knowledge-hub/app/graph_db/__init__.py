"""
Graph database factory — priority-based backend selection.

Selection order:
  1. SAP HANA    — probe TCP connection; use if reachable
  2. Kùzu        — embedded local fallback; init if HANA unavailable
  3. Neither     — log ERROR and raise; app cannot start without a graph DB

The selected backend is exposed as the module-level `graph_db` singleton,
consumed by extractor.py and retriever.py.
"""

import logging

from ..config import GRAPH_BACKEND
from .base import GraphDB

_logger = logging.getLogger(__name__)


def _create() -> GraphDB:

    # ── Step 1 & 2: Try SAP HANA (unless GRAPH_BACKEND forces Kùzu) ───────
    if GRAPH_BACKEND != "kuzu":
        _logger.info("[GraphDB] Probing SAP HANA ...")
        try:
            from .hana_adapter import HanaAdapter
            from ..config import HANA_HOST, HANA_PORT
            adapter = HanaAdapter()
            adapter.probe()
            _logger.info("[GraphDB] Backend: SAP HANA @ %s:%s", HANA_HOST, HANA_PORT)
            return adapter
        except ImportError:
            _logger.warning(
                "[GraphDB] hdbcli not installed — HANA unavailable, trying Kùzu next"
            )
        except Exception as exc:
            _logger.warning(
                "[GraphDB] SAP HANA probe failed (%s) — trying Kùzu next", exc
            )
        if GRAPH_BACKEND == "hana":
            raise RuntimeError("GRAPH_BACKEND=hana but SAP HANA is unavailable.")

    # ── Step 3: Kùzu — DELEGATE to the orchestrator PROJECT graph ────────
    # v6.4: there is NO separate flat kuzu_data file. The default/legacy graph IS
    # the orchestrator project's own graph (kuzu_projects/orchestrator/). Returning
    # None here signals _LazyGraphDB to route every call to get_project_graph(
    # ORCHESTRATOR_ID) — one graph, pinned resident, no stray DB outside kuzu_projects.
    _logger.info("[GraphDB] Backend: Kùzu via orchestrator project graph (default project)")
    return None


class _LazyGraphDB:
    """Defers backend selection (HANA probe / Kùzu init) until first use, so
    importing this package is instant and the service — and its tray icon —
    starts fast.

    Backend resolution runs once: HANA if reachable (a concrete adapter, cached),
    otherwise the default is the ORCHESTRATOR PROJECT graph. In the project case we
    do NOT cache an adapter — every access re-fetches get_project_graph(ORCHESTRATOR_ID)
    so it stays correct across LRU state (orchestrator is pinned, so this is a warm
    dict hit). This is what removes the separate flat kuzu_data file."""

    _resolved = False
    _hana: GraphDB | None = None      # concrete HANA adapter, or None => use project graph

    def _ensure(self) -> GraphDB:
        if not _LazyGraphDB._resolved:
            _LazyGraphDB._hana = _create()   # HanaAdapter or None
            _LazyGraphDB._resolved = True
        if _LazyGraphDB._hana is not None:
            return _LazyGraphDB._hana
        from .project_graph import get_project_graph
        from ..projects import ORCHESTRATOR_ID
        return get_project_graph(ORCHESTRATOR_ID)

    def __getattr__(self, name):
        return getattr(self._ensure(), name)


graph_db = _LazyGraphDB()
