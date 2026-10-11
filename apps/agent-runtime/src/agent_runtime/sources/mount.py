"""P-b · PF-S2 · PB-R10/R15/R16 · Mount nguồn (theo PIN) vào `work/<job_id>/sources/<key>/` chỉ-đọc
cho job `agent.cli`. git/local: dựng lại từ pin nếu cache mất (từ SHA/realpath); library: CHỈ từ
cache (snapshot `agent.cli` không có token — C15), mất ⇒ UNRESOLVABLE. Không DB/HTTP.
"""

from __future__ import annotations

from pathlib import Path

from agent_runtime.contracts.hub import Source
from agent_runtime.sources import git_driver, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.local_driver import resolve_root

SOURCES_SUBDIR = "sources"


def mount_all(  # noqa: PLR0913
    cfg: SourceConfig, work: Path, tenant: str, run_id: str, sources: list[Source]
) -> None:
    """Dựng/lấy snapshot từng nguồn rồi chép vào `work/sources/<key>`; lỗi ⇒ `SourceError`."""
    base = work / SOURCES_SUBDIR
    if base.exists():
        snapshot.rmtree_ro(base)
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    for src in sources:
        snap = _snapshot_for(cfg, tenant, src)
        snapshot.add_ref(snap, run_id)
        snapshot.mount(snap, base / src.key)


def _allowlist(src: Source) -> list[str]:
    return [a.root for a in src.allowlist]


def _snapshot_for(cfg: SourceConfig, tenant: str, src: Source) -> Path:
    allow = _allowlist(src)
    pin = src.pin
    if pin.kind == "git_remote":
        url, sha = pin.url, pin.sha
        mirror = git_driver.ensure_sha(cfg, url, sha)
        final = snapshot.git_dir(cfg, tenant, url, sha, allow)
        return snapshot.ensure(
            cfg, final, lambda tmp: snapshot.build_git(cfg, tmp, mirror, sha, allow)
        )
    if pin.kind == "local_path":
        root = resolve_root(cfg, pin.path)
        final = snapshot.local_dir(cfg, tenant, root, allow)
        return snapshot.ensure(cfg, final, lambda tmp: snapshot.build_local(cfg, tmp, root, allow))
    # library: chỉ dùng cache (resolve đã dựng qua token)
    final = snapshot.library_dir(cfg, tenant, str(pin.document_id), str(pin.version), allow)
    if not final.exists():
        raise SourceError("SOURCE_UNRESOLVABLE", "snapshot library không có trong cache")
    return final
