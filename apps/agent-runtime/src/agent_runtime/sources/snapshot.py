"""P-b · PF-S2 · PB-R07/R16 · D9 · Dựng + cache snapshot chỉ-đọc (lọc PB-R07, trần, nguyên tử, LRU).

Khoá cache = tenant + nguồn + SHA/version + hash(allowlist). Dựng ở thư mục tạm (tên `.bld-*`,
KHÔNG chứa `tmp` — LM-05) rồi `chmod` chỉ-đọc + `os.replace` nguyên tử. LRU theo `atime`, KHÔNG xoá
snapshot của run đang mở (sidecar `.refs`). Không DB/HTTP.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tarfile
import tempfile
from collections.abc import Callable
from contextlib import suppress
from hashlib import sha256
from pathlib import Path
from uuid import UUID

from agent_runtime.log import get_logger
from agent_runtime.sources import git_driver, local_driver
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.filter import Ceiling, TooLarge, compile_allowlist, is_secret
from agent_runtime.sources.filter import allowed as _allowed

_FILE_MODE = 0o444
_DIR_MODE = 0o555


def allow_hash(allowlist: tuple[str, ...] | list[str]) -> str:
    joined = "\n".join(sorted(allowlist))
    return sha256(joined.encode()).hexdigest()[:16]


def _url_key(url: str) -> str:
    return sha256(url.encode()).hexdigest()[:16]


def git_dir(cfg: SourceConfig, tenant: str, url: str, sha: str, allowlist: list[str]) -> Path:  # noqa: PLR0913
    return cfg.snapshots_dir / "git" / tenant / _url_key(url) / sha / allow_hash(allowlist)


def local_dir(  # noqa: PLR0913
    cfg: SourceConfig, tenant: str, realpath: Path, allowlist: list[str], snapshot_id: str
) -> Path:
    # PB-R05/HUB-BR-27 (AC-H36): khoá theo `pin.snapshot_id` (sinh lúc resolve) ⇒ mọi job cùng pin
    # (stage sau / "làm lại") mount ĐÚNG nội dung lúc ghim; resolve MỚI = snapshot_id mới = nội dung
    # mới. Mất cache ⇒ `ensure` dựng lại từ realpath (PB-R16). Gộp vào đoạn cuối: độ sâu lá = 4.
    key = sha256(str(realpath).encode()).hexdigest()[:16]
    sid = str(UUID(str(snapshot_id)))  # chuẩn hoá + chặn ký tự đường dẫn lạ
    return cfg.snapshots_dir / "local" / tenant / key / f"{allow_hash(allowlist)}-{sid}"


def library_dir(  # noqa: PLR0913
    cfg: SourceConfig, tenant: str, document_id: str, version: str, allowlist: list[str]
) -> Path:
    return cfg.snapshots_dir / "library" / tenant / document_id / version / allow_hash(allowlist)


# ── dựng ────────────────────────────────────────────────────────────────────────────────────────
def _new_tmp(cfg: SourceConfig) -> Path:
    cfg.snapshots_dir.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=".bld-", dir=str(cfg.snapshots_dir)))


def _write_file(dest_root: Path, rel: str, data: bytes) -> None:
    out = dest_root / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    os.chmod(out, _FILE_MODE)


def build_git(  # noqa: PLR0913
    cfg: SourceConfig, dest: Path, mirror: Path, sha: str, allowlist: list[str]
) -> tuple[int, int]:
    patterns = compile_allowlist(allowlist)
    ceiling = Ceiling()
    proc = git_driver.archive_proc(cfg, mirror, sha)
    assert proc.stdout is not None
    completed = False
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for member in tf:
                if not member.isfile():
                    continue  # bỏ thư mục, symlink, gitlink (git archive không phát submodule)
                rel = member.name
                if is_secret(rel) or not _allowed(rel, patterns):
                    continue
                ceiling.add(member.size)
                f = tf.extractfile(member)
                _write_file(dest, rel, f.read() if f is not None else b"")
        completed = True
    except TooLarge as err:
        completed = False
        raise SourceError("SOURCE_TOO_LARGE", str(err)) from err
    finally:
        proc.stdout.close()  # dừng sớm ⇒ git nhận SIGPIPE
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    if completed and proc.returncode not in (0, None):
        raise SourceError("SOURCE_UNRESOLVABLE", "git archive thất bại")
    return ceiling.files, ceiling.bytes


def build_local(cfg: SourceConfig, dest: Path, root: Path, allowlist: list[str]) -> tuple[int, int]:
    # B3: `walk_files` cắt nhánh + áp allowlist/secret NGAY lúc duyệt ⇒ không quét cả cây repo lớn.
    ceiling = Ceiling()
    try:
        for rel, full, size in local_driver.walk_files(root, allowlist):
            ceiling.add(size)
            _write_file(dest, rel, full.read_bytes())
    except TooLarge as err:
        raise SourceError("SOURCE_TOO_LARGE", str(err)) from err
    return ceiling.files, ceiling.bytes


def build_single(cfg: SourceConfig, dest: Path, name: str, data: bytes) -> tuple[int, int]:
    """library: 1 tài liệu/nguồn — tên đã chuẩn hoá."""
    ceiling = Ceiling()
    try:
        ceiling.add(len(data))
    except TooLarge as err:
        raise SourceError("SOURCE_TOO_LARGE", str(err)) from err
    _write_file(dest, name, data)
    return ceiling.files, ceiling.bytes


# ── chốt chỉ-đọc + nguyên tử ──────────────────────────────────────────────────────────────────
def finalize_ro(root: Path, *, lock_root: bool = True) -> None:
    """chmod toàn cây về chỉ-đọc (lá trước, `topdown=False`). `lock_root=False` GIỮ thư mục gốc
    còn ghi được: đổi tên một thư mục sang thư mục cha khác (`os.replace` ở `commit`) cần quyền ghi
    trên CHÍNH thư mục bị di chuyển (cập nhật `..`), nên khi KHÔNG phải root phải rename trước rồi
    mới `os.chmod(root, _DIR_MODE)` (xem `ensure`). B2: tránh EACCES âm thầm khi non-root."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for name in filenames:
            with suppress(OSError):
                os.chmod(Path(dirpath, name), _FILE_MODE)
        for name in dirnames:
            with suppress(OSError):
                os.chmod(Path(dirpath, name), _DIR_MODE)
    if lock_root:
        with suppress(OSError):
            os.chmod(root, _DIR_MODE)


def commit(tmp: Path, final: Path) -> Path:
    """Đổi tên nguyên tử; thua đua (final đã có) ⇒ bỏ tmp, dùng final. Lỗi THẬT (không phải đua)
    ⇒ dọn tmp + ném `SourceError` — KHÔNG nuốt lặng (B2): để run ra `source_unresolvable` rõ ràng,
    không để `mount` ném `FileNotFoundError` mơ hồ vì `final` không bao giờ xuất hiện."""
    final.parent.mkdir(parents=True, exist_ok=True)
    if final.exists():
        rmtree_ro(tmp)
        return final
    try:
        os.replace(tmp, final)
    except OSError as err:
        if final.exists():  # thua đua xuất hiện giữa chừng ⇒ dùng final
            rmtree_ro(tmp)
            return final
        rmtree_ro(tmp)
        # Minor #5: chi tiết (errno, đường dẫn cache) chỉ log Runtime; thông điệp gửi Hub chung.
        get_logger().warning("source.snapshot_commit_failed", error=str(err))
        raise SourceError("SOURCE_UNRESOLVABLE", "không lưu được snapshot nguồn") from err
    return final


def rmtree_ro(path: Path) -> None:
    """Mở quyền ghi toàn cây (cây chỉ-đọc) rồi `rmtree` — không dùng `onerror` (deprecated 3.12)."""
    for dirpath, _, filenames in os.walk(path):
        with suppress(OSError):
            os.chmod(dirpath, 0o700)
        for name in filenames:
            with suppress(OSError):
                os.chmod(Path(dirpath, name), 0o700)
    shutil.rmtree(path, ignore_errors=True)


# ── mount vào work/<job>/sources/<key> ───────────────────────────────────────────────────────────
def mount(snapshot_dir: Path, dest: Path) -> None:
    """Chép cây snapshot (chỉ-đọc) vào `dest`, rồi `chmod` chỉ-đọc lại."""
    if dest.exists():
        rmtree_ro(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _copy_tree(snapshot_dir, dest)
    finalize_ro(dest)


def _copy_tree(src: Path, dst: Path) -> None:
    dst.mkdir(mode=0o755, parents=True, exist_ok=True)
    for entry in os.scandir(src):
        s, d = Path(entry.path), dst / entry.name
        if entry.is_dir(follow_symlinks=False):
            _copy_tree(s, d)
        elif entry.is_file(follow_symlinks=False):
            shutil.copyfile(s, d)
            os.chmod(d, 0o644)


# ── refs (bảo vệ LRU run đang mở) + LRU ───────────────────────────────────────────────────────────
def add_ref(snapshot_dir: Path, run_id: str) -> None:
    """Ghi sidecar `<dir>.refs` (ngoài cây chỉ-đọc) — run dùng snapshot này."""
    if not run_id:
        return
    refs = snapshot_dir.with_name(snapshot_dir.name + ".refs")
    with suppress(OSError):
        existing: set[str] = set(refs.read_text().split()) if refs.exists() else set()
        existing.add(run_id)
        refs.write_text("\n".join(sorted(existing)))


def refs_of(snapshot_dir: Path) -> list[str]:
    refs = snapshot_dir.with_name(snapshot_dir.name + ".refs")
    try:
        return [r for r in refs.read_text().split() if r]
    except OSError:
        return []


def leaf_snapshots(cfg: SourceConfig) -> list[Path]:
    """Mọi thư mục snapshot lá (chứa `allow_hash`), bỏ sidecar/temp."""
    out: list[Path] = []
    root = cfg.snapshots_dir
    if not root.exists():
        return out
    for dirpath, dirnames, _ in os.walk(root):
        p = Path(dirpath)
        if p.name.startswith(".bld-") or p.name.endswith(".refs"):
            dirnames[:] = []
            continue
        # Lá = thư mục không có thư mục con snapshot (độ sâu cố định theo kind).
        if _is_leaf(p, root):
            out.append(p)
    return out


def _is_leaf(p: Path, root: Path) -> bool:
    rel = p.relative_to(root).parts
    # git: git/<tenant>/<url>/<sha>/<allow> = 5; local: local/<tenant>/<key>/<allow> = 4;
    # library: library/<tenant>/<doc>/<ver>/<allow> = 5.
    kind = rel[0] if rel else ""
    depth = {"git": 5, "local": 4, "library": 5}.get(kind)
    return depth is not None and len(rel) == depth


def dir_size(path: Path) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for name in filenames:
            with suppress(OSError):
                total += os.lstat(Path(dirpath, name)).st_size
    return total


def all_ref_run_ids(cfg: SourceConfig) -> set[str]:
    out: set[str] = set()
    for s in leaf_snapshots(cfg):
        out.update(refs_of(s))
    return out


def enforce_lru(cfg: SourceConfig, active_run_ids: set[str]) -> None:
    """Xoá snapshot cũ nhất (atime) tới khi dưới trần; GIỮ snapshot của run còn mở (`.refs`)."""
    snaps = leaf_snapshots(cfg)
    total = sum(dir_size(s) for s in snaps)
    if total <= cfg.cache_max_bytes:
        return

    def protected(s: Path) -> bool:
        return any(r in active_run_ids for r in refs_of(s))

    candidates = sorted((s for s in snaps if not protected(s)), key=_atime)
    for s in candidates:
        if total <= cfg.cache_max_bytes:
            break
        size = dir_size(s)
        rmtree_ro(s)
        with suppress(OSError):
            s.with_name(s.name + ".refs").unlink()
        total -= size


def _atime(path: Path) -> float:
    try:
        return path.stat().st_atime
    except OSError:
        return 0.0


def count_snapshot(path: Path) -> tuple[int, int]:
    """(số file, tổng byte) của snapshot đã dựng — khớp files/bytes của check (SN-08)."""
    files = 0
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for name in filenames:
            with suppress(OSError):
                total += os.lstat(Path(dirpath, name)).st_size
                files += 1
    return files, total


def ensure(cfg: SourceConfig, final: Path, build: Callable[[Path], object]) -> Path:
    """Trả snapshot `final` (cache hit) hoặc dựng ở tạm → chỉ-đọc → đổi tên nguyên tử.
    `build(tmp)` ném `SourceError` (TOO_LARGE/UNRESOLVABLE) ⇒ bỏ tạm, không để lại rác."""
    if final.exists():
        return final
    tmp = _new_tmp(cfg)
    try:
        build(tmp)
        finalize_ro(tmp, lock_root=False)  # lá + thư mục con chỉ-đọc; GỐC còn ghi để rename
    except BaseException:
        if tmp.exists():
            rmtree_ro(tmp)
        raise
    result = commit(tmp, final)
    with suppress(OSError):
        os.chmod(result, _DIR_MODE)  # B2: chốt GỐC chỉ-đọc SAU rename nguyên tử (non-root ok)
    return result
