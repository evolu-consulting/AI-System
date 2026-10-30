"""Hook-rules store + API (additive plug-in).

A tiny SQLite DB of plain-text Claude Code hook policies keyed by hook type.
Claude hooks GET the full text for their type at fire time — no regex, no
truncation, no embeddings. Editing a rule = one DB write. See api.py / store.py.
"""
from .api import attach

__all__ = ["attach"]
