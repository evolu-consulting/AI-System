"""Customer-facing docs must not send a customer to KH's source code.

docs/integration/ is handed to customers (and to their coding agents). It may describe routes, fields and
config keys, never how to clone the repository, run KH from source, or where code lives.

Run: python tests/test_customer_docs.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUSTOMER_DOCS = os.path.join(ROOT, "docs", "integration")

FORBIDDEN = [
    (re.compile(r"git\s+clone", re.I), "git clone"),
    (re.compile(r"RWorkspace"), "repository name"),
    (re.compile(r"Slaves/"), "repository path"),
    (re.compile(r"python\s+-m\s"), "running from source"),
    (re.compile(r"\b(?:app|tools|tests|deploy)/[\w./-]*\.py\b"), "source file path"),
    (re.compile(r"\b[\w-]+\.py\b"), "Python source file"),
]


def scan() -> list:
    problems = []
    for name in sorted(os.listdir(CUSTOMER_DOCS)):
        if not name.endswith(".md"):
            continue
        with open(os.path.join(CUSTOMER_DOCS, name), encoding="utf-8") as fh:
            for no, line in enumerate(fh, 1):
                for rx, what in FORBIDDEN:
                    if rx.search(line):
                        problems.append(f"{name}:{no}: {what}: {line.strip()[:120]}")
    return problems


def main() -> int:
    problems = scan()
    for p in problems:
        print("FAIL", p)
    print("ALL PASS" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
