"""Understand stage of the line: plan blocks 5 (ingest), 6 (readers A/B, quote check,
reconcile, targeted re-read) and 9 (acceptance test author + test check).

    pv = ingest(pack_dir, store, rag, run=run)                 # spec.frozen
    digest = understand(pv, llm, run=run, store=store)         # [reconcile.diverged ...] digest.done
    tests = author_tests(digest, llm, repo, run=run, store=store, pack=pv)
    gate = check_tests(repo, tests, digest=digest, run=run, store=store, spec_hash=pv.version)  # tests.approved

Failures cross the boundary as LineError(SPEC_MISSING_FILE | READ_DIVERGED | TEST_UNTRACED)
or as a failed Gate (TEST_UNTRACED | TEST_GREEN_ON_EMPTY). Emitting `escalated` and moving
the run state is the pipeline's job.
"""

from .ingest import ingest, load_pack, normalize, split_spans
from .readers import check_quotes, read_digest, reread
from .reconcile import reconcile, resolve, understand
from .test_author import author_tests
from .test_check import check_tests, locked_tampered

__all__ = ["ingest", "load_pack", "normalize", "split_spans", "read_digest", "reread", "check_quotes",
           "reconcile", "resolve", "understand", "author_tests", "check_tests", "locked_tampered"]
