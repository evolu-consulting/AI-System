"""ADR-0023 (CR-088) · lớp 1 `domain/` và lớp 2 `application/` của agent_runtime chỉ dùng stdlib (trừ I/O).

import-linter không diễn đạt được "chỉ stdlib", nên script này đọc AST mọi file `.py` nằm trong một thư mục
`domain/` hoặc `application/` dưới `src/agent_runtime/` và báo lỗi khi:
- import module ngoài stdlib (`sys.stdlib_module_names`);
- import module stdlib làm I/O (danh sách FORBIDDEN_STDLIB);
- `domain/` import `application/` hoặc bất kỳ phần nào của agent_runtime ngoài `domain/`;
- `application/` import agent_runtime ngoài `domain/`, `application/`.
Chưa có thư mục nào thì thoát 0. Chạy: python scripts/check_layers.py (từ apps/agent-runtime).
"""

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src" / "agent_runtime"
FORBIDDEN_STDLIB = {
    "os",
    "subprocess",
    "socket",
    "asyncio",
    "shutil",
    "tempfile",
    "multiprocessing",
    "threading",
    "signal",
    "sqlite3",
    "urllib",
    "http",
    "ftplib",
    "smtplib",
    "ssl",
    "select",
    "selectors",
    "io",
    "logging",
    "pathlib",
}


def layer_of(path: Path) -> str | None:
    parts = path.relative_to(ROOT).parts
    if "domain" in parts:
        return "domain"
    if "application" in parts:
        return "application"
    return None


def allowed_internal(layer: str, module: str) -> bool:
    parts = module.split(".")
    if layer == "domain":
        return "domain" in parts
    return "domain" in parts or "application" in parts


def imported_modules(tree: ast.AST) -> list[tuple[int, str, int]]:
    out: list[tuple[int, str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.extend((node.lineno, a.name, 0) for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            out.append((node.lineno, node.module or "", node.level))
    return out


def check_file(path: Path, layer: str) -> list[str]:
    errors: list[str] = []
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for line, module, level in imported_modules(tree):
        where = f"{path.relative_to(ROOT.parent.parent)}:{line}"
        if level > 0:
            continue  # import tương đối trong cùng gói lớp; gói lớp chỉ nằm trong domain/ hoặc application/
        top = module.split(".")[0]
        if top == "__future__" or top == "typing":
            continue
        if top == "agent_runtime":
            if not allowed_internal(layer, module):
                errors.append(f"{where}: {layer}/ không được import '{module}'")
            continue
        if top not in sys.stdlib_module_names:
            errors.append(f"{where}: {layer}/ chỉ dùng stdlib, không được import '{module}'")
        elif top in FORBIDDEN_STDLIB:
            errors.append(f"{where}: {layer}/ không làm I/O, không được import '{module}' (đi qua port)")
    return errors


def main() -> int:
    errors: list[str] = []
    for path in sorted(ROOT.rglob("*.py")):
        if path.name.startswith("test_") or path.name.endswith("_test.py"):
            continue
        layer = layer_of(path)
        if layer:
            errors.extend(check_file(path, layer))
    for e in errors:
        print(e)
    print(f"check_layers: {'lỗi ' + str(len(errors)) if errors else 'OK'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
