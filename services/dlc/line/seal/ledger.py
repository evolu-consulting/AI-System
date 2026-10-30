"""Append-only seal ledger with a hash chain (the ratchet).

    L = SealLedger(path=None)                      # path = JSONL file, None = memory only
    sha = L.freeze_gates("B7#1", gates, approver="judge", builder="forge")   # before the build starts
    L.build_started("B7#1")                        # from here the gates are frozen for good
    L.submit("B7#1", evidence=[...])               # built, waiting for the score  -> pending
    L.score("B7#1", score, scorer="assay", level="L1")   # -> sealed | rejected (| awaiting sign-off)
    L.sign("B7#1", by="rowan")                     # L2 only
    L.correct("B7#1", reason, new_subject="B7#2")  # a wrong seal is never revised: a new entry points at it

Rules enforced
  * gates are frozen by someone who is not the builder, before the build starts; after build_started
    they can never be replaced (GateFrozen).
  * a subject moves pending -> sealed | rejected exactly once; nothing rewrites an earlier entry.
  * every entry carries prev = sha256 of the previous entry; verify() re-walks the chain.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from .score import Score, SealVerdict, judge


class LedgerError(Exception):
    pass


class GateFrozen(LedgerError):
    pass


def _h(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def gates_sha(gates: Sequence[Mapping[str, Any]]) -> str:
    return _h(list(gates))


class SealLedger:
    def __init__(self, path: Optional[str] = None, entries: Sequence[Mapping[str, Any]] = (),
                 sink: Optional[Callable[[Dict[str, Any]], None]] = None):
        """path = JSONL file; or entries (replayed in seq order) + sink (called with every new entry,
        e.g. a database row writer). Both forms keep the same hash chain."""
        self.path = path
        self.sink = sink
        self._lock = threading.Lock()
        self._entries: List[Dict[str, Any]] = []
        self._state: Dict[str, Dict[str, Any]] = {}     # subject -> projection
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        self._apply(json.loads(line), replay=True)
        for e in sorted((dict(x) for x in entries), key=lambda x: int(x["seq"])):
            self._apply(e, replay=True)

    # ------------------------------------------------------------------ internals

    def _append(self, kind: str, subject: str, body: Mapping[str, Any]) -> Dict[str, Any]:
        with self._lock:
            prev = self._entries[-1]["hash"] if self._entries else ""
            e = {"seq": len(self._entries) + 1, "kind": kind, "subject": subject, "body": dict(body), "prev": prev}
            e["hash"] = _h({k: e[k] for k in ("seq", "kind", "subject", "body", "prev")})
            self._apply(e)
            if self.path:
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(e, sort_keys=True) + "\n")
            if self.sink is not None:
                self.sink(dict(e))
            return e

    def _apply(self, e: Dict[str, Any], replay: bool = False) -> None:
        self._entries.append(e)
        st = self._state.setdefault(e["subject"], {"state": "new", "gates_sha": "", "builder": "", "approver": ""})
        k, b = e["kind"], e["body"]
        if k == "gates":
            st.update(gates_sha=b["gates_sha"], builder=b["builder"], approver=b["approver"], state="gated")
        elif k == "build_started":
            st["state"] = "building"
        elif k == "submitted":
            st["state"] = "pending"
        elif k == "scored":
            st.update(state=b["state"], verdict=b["verdict"], scorer=b["scorer"])
        elif k == "signed":
            st.update(state="sealed", signed_by=b["by"])
        elif k == "voided":
            st["state"] = "void"
        elif k == "corrected":
            st["corrected_by"] = b["new_subject"]

    def _get(self, subject: str) -> Dict[str, Any]:
        st = self._state.get(subject)
        if not st:
            raise LedgerError("unknown subject %s" % subject)
        return st

    # ------------------------------------------------------------------ API

    def freeze_gates(self, subject: str, gates: Sequence[Mapping[str, Any]], approver: str, builder: str) -> str:
        if not approver or approver == builder:
            raise LedgerError("gates are approved by someone who is not the builder")
        st = self._state.get(subject)
        if st and st["state"] not in ("new", "gated"):
            raise GateFrozen("gates of %s are frozen since the build started" % subject)
        sha = gates_sha(gates)
        self._append("gates", subject, {"gates_sha": sha, "approver": approver, "builder": builder,
                                        "gates": list(gates)})
        return sha

    def build_started(self, subject: str) -> None:
        st = self._get(subject)
        if st["state"] != "gated":
            raise LedgerError("%s: build can only start on frozen gates (state %s)" % (subject, st["state"]))
        self._append("build_started", subject, {})

    def submit(self, subject: str, gates_sha_now: str, evidence: Sequence[Mapping[str, Any]] = ()) -> None:
        st = self._get(subject)
        if st["state"] != "building":
            raise LedgerError("%s: submit from state %s" % (subject, st["state"]))
        if gates_sha_now != st["gates_sha"]:
            raise GateFrozen("%s: gates changed after the build started" % subject)
        self._append("submitted", subject, {"evidence": list(evidence)})

    def score(self, subject: str, score: Score, scorer: str, level: str = "L0") -> SealVerdict:
        st = self._get(subject)
        if st["state"] != "pending":
            raise LedgerError("%s: already %s - a sealed or rejected entry is never revised" % (subject, st["state"]))
        v = judge(score, st["builder"], scorer, level)
        state = "awaiting_signoff" if v.needs_signoff else ("sealed" if v.sealed else "rejected")
        self._append("scored", subject, {"state": state, "scorer": scorer, "verdict": v.to_dict(),
                                         "docked": list(score.docked or [])})
        return v

    def sign(self, subject: str, by: str) -> None:
        st = self._get(subject)
        if st["state"] != "awaiting_signoff":
            raise LedgerError("%s: nothing to sign (state %s)" % (subject, st["state"]))
        if by in (st["builder"], st.get("scorer")):
            raise LedgerError("the sign-off is a person other than the builder and the scorer")
        self._append("signed", subject, {"by": by})

    def void(self, subject: str, reason: str) -> None:
        """An unscored attempt that will never be scored (e.g. tainted by a failed producer)."""
        st = self._get(subject)
        if st["state"] in ("sealed", "rejected", "void"):
            raise LedgerError("%s: already %s" % (subject, st["state"]))
        self._append("voided", subject, {"reason": reason})

    def correct(self, subject: str, reason: str, new_subject: str) -> None:
        """A wrong seal stays in the ledger; the correction is a NEW subject that points back at it."""
        self._get(subject)
        self._append("corrected", subject, {"reason": reason, "new_subject": new_subject})

    def projection(self, subject: str) -> Dict[str, Any]:
        return dict(self._state.get(subject) or {})

    def state(self, subject: str) -> str:
        return self._state.get(subject, {}).get("state", "new")

    def entries(self) -> List[Dict[str, Any]]:
        return [dict(e) for e in self._entries]

    def verify(self) -> bool:
        """Re-walk the chain and the ratchet: hashes link, each subject is decided at most once."""
        prev, decided = "", {}
        for e in self._entries:
            if e["prev"] != prev or e["hash"] != _h({k: e[k] for k in ("seq", "kind", "subject", "body", "prev")}):
                return False
            if e["kind"] in ("scored", "voided"):
                if e["subject"] in decided:
                    return False
                decided[e["subject"]] = e["kind"]
            if e["kind"] == "signed" and decided.get(e["subject"]) != "scored":
                return False
            prev = e["hash"]
        return True
