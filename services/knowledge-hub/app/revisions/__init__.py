"""Revisions / changelog (additive, plug-in) — ARCHITECTURE-neutral.

Keeps a retrievable HISTORY of corrected facts so a later session can ask "what did
I call it BEFORE?" and get the superseded value, labelled. Never overwrites: a
correction APPENDS a new revision and marks the prior one superseded (kept, not
deleted). Reuses the v5 vector substrate; touches nothing existing.
"""
from .api import attach

__all__ = ["attach"]
