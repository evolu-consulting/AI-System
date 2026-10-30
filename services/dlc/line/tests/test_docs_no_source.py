"""Customer-facing DLC docs (docs/dlc/) must not send a customer to the source code.

They describe the delivered `dlc` application, its settings, HTTP API and behaviour; never how to clone the
repository, run the engine from source, or where code lives. Developer material lives in docs/internal/.
Allowed: `dlc ...` commands and target-side commands such as `python -m unittest` (how a Python TARGET's
tests run).
"""

from __future__ import annotations

import os
import re
import unittest

SDLC = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CUSTOMER_DOCS = os.path.join(SDLC, "docs", "dlc")

FORBIDDEN = [
    (re.compile(r"git\s+clone", re.I), "git clone"),
    (re.compile(r"repo-url", re.I), "repository URL placeholder"),
    (re.compile(r"RWorkspace"), "repository name"),
    (re.compile(r"Slaves/"), "repository path"),
    (re.compile(r"python\s+-m\s+(?!unittest\b)"), "running a module from source"),
    (re.compile(r"(?<![\w.-])line/(?!<)"), "engine source path"),
    (re.compile(r"\b[\w-]+\.py\b"), "Python source file"),
    (re.compile(r"\bdlc_flow\.ps1\b"), "source-tree helper script"),
]


def scan():
    problems = []
    for name in sorted(os.listdir(CUSTOMER_DOCS)):
        if not name.endswith(".md"):
            continue
        with open(os.path.join(CUSTOMER_DOCS, name), encoding="utf-8") as fh:
            for no, line in enumerate(fh, 1):
                for rx, what in FORBIDDEN:
                    if rx.search(line):
                        problems.append("%s:%d: %s: %s" % (name, no, what, line.strip()[:120]))
    return problems


class CustomerDocsTest(unittest.TestCase):
    def test_no_source_references(self):
        problems = scan()
        self.assertEqual(problems, [], "\n" + "\n".join(problems))

    def test_frontend_guide_present_and_indexed(self):
        self.assertTrue(os.path.isfile(os.path.join(CUSTOMER_DOCS, "FRONTEND-INTEGRATION.md")))
        with open(os.path.join(CUSTOMER_DOCS, "README.md"), encoding="utf-8") as fh:
            self.assertIn("FRONTEND-INTEGRATION.md", fh.read())


if __name__ == "__main__":
    unittest.main()
