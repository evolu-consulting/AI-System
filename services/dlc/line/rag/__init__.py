"""RAG System port of the SDLC line.

  make_rag(config, store)   factory (rag.port): local, or http wrapped in the resilient layer
  HttpRagAdapter            the RAG System's /v1 HTTP API (rag.http_adapter)
  LocalRagAdapter           pure local implementation over the Store (rag.local_adapter)
  ResilientRag              per-capability degraded mode + Store outbox replay (rag.resilient)
  manifest.build(config)    the line's own namespace manifest (rag.manifest)
"""

from .port import make_rag  # noqa: F401
