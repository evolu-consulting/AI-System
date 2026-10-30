"""Factory for the line's RagPort.

    rag = make_rag(cfg, store)

  cfg.rag == "off" (LINE_RAG=off, the default)  -> LocalRagAdapter over the Store
  cfg.rag == "http"                             -> ResilientRag(HttpRagAdapter(cfg), store, local)

Both results also offer admit_run(run) -> lease authority, lease_authority(run), lease_port(run)
(LocalRagAdapter: always local), sync_events(limit), degraded() and probe().
"""

from __future__ import annotations

from typing import Any

from .. import codes
from ..codes import LineError
from .http_adapter import HttpRagAdapter
from .local_adapter import LocalRagAdapter
from .resilient import ResilientRag


def make_rag(config: Any, store: Any, *, leases: Any = None, remote: Any = None,
             probe_interval_s: float = 30.0, apply_manifest: bool = False) -> Any:
    """Build the RagPort for config. remote overrides the HTTP adapter (tests).
    apply_manifest=True PUTs the line's manifest once (errors are left to degraded mode)."""
    mode = getattr(config, "rag", "off") or "off"
    local = LocalRagAdapter(store, leases=leases)
    if mode == "off":
        return local
    if mode != "http":
        raise LineError(codes.CONFIG_INVALID, "LINE_RAG must be off or http", {"field": "rag", "value": mode})
    if remote is None:
        remote = HttpRagAdapter.from_config(config)
        if apply_manifest:
            try:
                remote.apply_manifest()
            except LineError as e:
                if e.code not in (codes.RAG_DEGRADED,):
                    raise
    return ResilientRag(remote, store, local, probe_interval_s=probe_interval_s,
                        agent_version=getattr(config, "agent_version", ""))


__all__ = ["make_rag", "HttpRagAdapter", "LocalRagAdapter", "ResilientRag"]
