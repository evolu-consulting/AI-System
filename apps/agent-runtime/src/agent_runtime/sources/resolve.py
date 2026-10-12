"""P-b · PF-S2 · Resolve một nguồn git/local theo `config` (job `source.resolve` — check/start):
clone/fetch → SHA/realpath → dựng snapshot cache → pin + files + bytes. library ở `runtimes.resolve`
(cần HTTP job-token). Không DB/HTTP.
"""

from __future__ import annotations

import uuid

from agent_runtime.sources import git_driver, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.local_driver import resolve_root

Pin = dict[str, object]


def resolve_git(  # noqa: PLR0913
    cfg: SourceConfig, tenant: str, url: str, branch: str, allowlist: list[str]
) -> tuple[Pin, int, int]:
    git_driver.validate_branch(branch)  # fail-fast (SS-04) trước khi clone
    mirror = git_driver.ensure_mirror_fresh(cfg, url)
    sha = git_driver.resolve_sha(cfg, mirror, branch)
    final = snapshot.git_dir(cfg, tenant, url, sha, allowlist)
    snapshot.ensure(cfg, final, lambda tmp: snapshot.build_git(cfg, tmp, mirror, sha, allowlist))
    files, size = snapshot.count_snapshot(final)
    return {"kind": "git_remote", "url": url, "sha": sha}, files, size


def resolve_local(
    cfg: SourceConfig, tenant: str, path: str, allowlist: list[str]
) -> tuple[Pin, int, int]:
    # PB-R05: snapshot_id sinh TRƯỚC và là khoá cache ⇒ nội dung ghim = lúc resolve (AC-H36).
    root = resolve_root(cfg, path)
    snapshot_id = str(uuid.uuid4())
    final = snapshot.local_dir(cfg, tenant, root, allowlist, snapshot_id)
    snapshot.ensure(cfg, final, lambda tmp: snapshot.build_local(cfg, tmp, root, allowlist))
    files, size = snapshot.count_snapshot(final)
    return {"kind": "local_path", "path": path, "snapshot_id": snapshot_id}, files, size
