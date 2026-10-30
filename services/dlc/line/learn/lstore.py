"""LearnStore: a small JSON document store for the learning loop and the agent directory.

The line's Store has a closed list of entities (contracts.ENTITIES, frozen), so lessons, canary
arms, outcomes, judge history and agent versions live here instead: one JSON file
({collection: {id: doc}}), written atomically (temp file + os.replace) under a lock. path "" keeps
everything in memory (tests, or no workroot).

    ls = LearnStore(path)
    ls.put("lesson", "L1", {...});  ls.get("lesson", "L1");  ls.query("lesson", status="active")
"""

from __future__ import annotations

import copy
import json
import os
import threading
from typing import Any, Dict, List, Mapping, Optional

from . import setting

COLLECTIONS = ("lesson", "arm", "outcome", "judge", "agent", "agent_pin", "agent_sample", "shadow")


def default_path(cfg: Any) -> str:
    p = setting(cfg, "learn_path")
    if p:
        return p
    root = getattr(cfg, "workroot", "") if cfg is not None else ""
    return os.path.join(root, "learn", "learn.json") if root else ""


class LearnStore:
    def __init__(self, path: str = ""):
        self.path = path
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._order = 0
        if path and os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    self._data = {k: dict(v) for k, v in data.items() if isinstance(v, dict)}
            except (OSError, ValueError):
                self._data = {}
            self._order = max([int(d.get("_order", 0)) for c in self._data.values() for d in c.values()] + [0])

    @classmethod
    def for_config(cls, cfg: Any) -> "LearnStore":
        return cls(default_path(cfg))

    def _flush(self) -> None:
        if not self.path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self._data, fh, sort_keys=True)
        os.replace(tmp, self.path)

    def put(self, coll: str, id: str, doc: Mapping[str, Any]) -> Dict[str, Any]:
        with self._lock:
            c = self._data.setdefault(coll, {})
            cur = c.get(id)
            row = json.loads(json.dumps(dict(doc)))
            row["id"] = id
            if cur is not None:
                row["_order"] = cur.get("_order", 0)
            else:
                self._order += 1
                row["_order"] = self._order
            c[id] = row
            self._flush()
            return copy.deepcopy(row)

    def update(self, coll: str, id: str, **fields: Any) -> Optional[Dict[str, Any]]:
        with self._lock:
            cur = self.get(coll, id)
            if cur is None:
                return None
            cur.update(fields)
            return self.put(coll, id, cur)

    def get(self, coll: str, id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._data.get(coll, {}).get(id)
            return copy.deepcopy(row) if row is not None else None

    def delete(self, coll: str, id: str) -> None:
        with self._lock:
            if self._data.get(coll, {}).pop(id, None) is not None:
                self._flush()

    def query(self, coll: str, **eq: Any) -> List[Dict[str, Any]]:
        with self._lock:
            rows = [r for r in self._data.get(coll, {}).values() if all(r.get(k) == v for k, v in eq.items())]
            rows.sort(key=lambda r: r.get("_order", 0))
            return copy.deepcopy(rows)
