"""Seal ledger, unsealed-resource rules and incremental rescans. See docs/dlc/seal-and-scan.md.

Wired into the engine through line.seal.wire (LINE_SEAL=1; off by default) and line.migrate.scancache
(LINE_SCAN_CACHE). Standard library only.
"""

from .ledger import GateFrozen, LedgerError, SealLedger
from .resources import Claim, DepthExceeded, ResourceTable, StaleClaim
from .score import LEVELS, Score, SealVerdict, judge, level_for

__all__ = ["SealLedger", "LedgerError", "GateFrozen", "ResourceTable", "Claim", "StaleClaim", "DepthExceeded",
           "Score", "SealVerdict", "judge", "level_for", "LEVELS"]
