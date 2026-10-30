"""Sidecars: satellite tools the engine runs next to the delivery line, configured in Admin > Sidecars.

  autologin   DLC Autologin (line.sidecar.autologin): accounts of the web apps the agents may sign in to
  knowledge   the run's RAG System project, always on (line.agent_tools search_knowledge)

GET /api/admin/sidecars  -> {"sidecars": [{"id", "name", "description", "enabled", "builtin", "count"}]}
"""

from __future__ import annotations

from typing import Any, Dict, List


def listing() -> List[Dict[str, Any]]:
    from . import autologin
    entries = autologin.public_entries()
    return [
        {"id": "knowledge", "name": "Project knowledge", "builtin": True, "enabled": True, "count": None,
         "description": "Agents search the run's RAG System project (decisions, fixes, lessons, worklog) "
                        "with the search_knowledge tool."},
        {"id": "autologin", "name": "Autologin", "builtin": False,
         "enabled": any(e["enabled"] for e in entries), "count": len(entries),
         "description": "Accounts of the web apps the agents may sign in to (dev, deploy, test), each with its "
                        "environment. Agents get a signed-in session, never the password."},
    ]


__all__ = ["listing"]
