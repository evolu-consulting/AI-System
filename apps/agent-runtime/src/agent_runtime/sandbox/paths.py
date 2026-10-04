"""WRK-BR-07 · Luật thuần đường dẫn sandbox (plan-runtime §5.1). Stub B0."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DenyReason = Literal["empty", "home", "mnt", "other_job", "outside"]


@dataclass(frozen=True)
class PathDecision:
    allowed: bool
    reason: DenyReason | None = None


def is_path_allowed(raw: str, work_dir: Path, forbidden_roots: tuple[Path, ...]) -> PathDecision:
    raise NotImplementedError
