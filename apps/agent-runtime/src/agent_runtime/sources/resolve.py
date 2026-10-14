"""P-b · PF-S2 · Resolve một nguồn git/local theo `config` (job `source.resolve` — check/start):
clone/fetch → SHA/realpath → dựng snapshot cache → pin + files + bytes. library ở `runtimes.resolve`
(cần HTTP job-token). Không DB/HTTP. `caps="autofix"` (P-c1 PC-R04) ⇒ trần + khoá cache riêng.
"""

from __future__ import annotations

import uuid

from agent_runtime.sources import git_driver, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.git_driver import GitAuth
from agent_runtime.sources.local_driver import resolve_root

Pin = dict[str, object]


def resolve_git(  # noqa: PLR0913
    cfg: SourceConfig,
    tenant: str,
    url: str,
    branch: str,
    allowlist: list[str],
    caps: snapshot.Caps = "source",
    source_id: str = "",
    has_credential: bool = False,
    auth: GitAuth | None = None,
) -> tuple[Pin, int, int]:
    """PC2-R11/R12: nguồn có khoá ⇒ `auth` (lấy qua kênh nội bộ ở host) + mirror riêng theo
    `source_id`; snapshot cache vẫn theo `tenant` (cách ly repo riêng giữa tenant)."""
    git_driver.validate_branch(branch)  # fail-fast (SS-04) trước khi clone
    mirror = git_driver.ensure_mirror_fresh(cfg, url, source_id, has_credential, auth)
    sha = git_driver.resolve_sha(cfg, mirror, branch)
    final = snapshot.git_dir(cfg, tenant, url, sha, allowlist, caps)
    ceiling = snapshot.ceiling_for(cfg, caps)
    snapshot.ensure(
        cfg, final, lambda tmp: snapshot.build_git(cfg, tmp, mirror, sha, allowlist, ceiling)
    )
    files, size = snapshot.count_snapshot(final)
    return {"kind": "git_remote", "url": url, "sha": sha}, files, size


def resolve_local(  # noqa: PLR0913
    cfg: SourceConfig,
    tenant: str,
    path: str,
    allowlist: list[str],
    caps: snapshot.Caps = "source",
) -> tuple[Pin, int, int]:
    # PB-R05: snapshot_id sinh TRƯỚC và là khoá cache ⇒ nội dung ghim = lúc resolve (AC-H36).
    root = resolve_root(cfg, path)
    snapshot_id = str(uuid.uuid4())
    final = snapshot.local_dir(cfg, tenant, root, allowlist, snapshot_id, caps)
    ceiling = snapshot.ceiling_for(cfg, caps)
    snapshot.ensure(
        cfg, final, lambda tmp: snapshot.build_local(cfg, tmp, root, allowlist, ceiling)
    )
    files, size = snapshot.count_snapshot(final)
    return {"kind": "local_path", "path": path, "snapshot_id": snapshot_id}, files, size
