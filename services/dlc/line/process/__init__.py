"""Processes as data (docs/dlc/process.md): definitions, artifacts, checks and the living spec. The gated flow
(line.gates) runs whatever definition applies to a run; the engine keeps only the mechanisms (rails)."""

from .definition import Resolved, catalog, frozen, merge, select, validate

__all__ = ["Resolved", "select", "validate", "merge", "frozen", "catalog"]
