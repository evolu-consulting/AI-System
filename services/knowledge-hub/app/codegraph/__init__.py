"""Code-graph import (additive) — ingest a code-graph in the FIXED KH contract.
Tool-native parsing lives in tools/adapters/ (plug-in/out); KH stays tool-agnostic."""
from .api import attach

__all__ = ["attach"]
