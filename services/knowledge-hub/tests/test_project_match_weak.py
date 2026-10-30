"""Weak project matches (item 5): a short keyword is reported but never routes.

WHAT IS UNDER TEST
  app.projects.resolve_project_name on a fixed registry. 'cap' (a 3-letter keyword) matched the second syllable
  of the Vietnamese 'nang cap' and routed a hook request to the wrong project; a hit matched only by a keyword
  shorter than PROJECT_MATCH_WEAK_KEYWORD_LEN is now `weak` and resolves to no project. Exact ids and long
  keywords still route. The known gap is asserted as-is: an ordinary English word used as a keyword
  ('community', 'contract') clears the length floor and still routes, because genericness, not length, is
  the discriminator.

  This replaces the 2026-09-07 probe that replayed the logic against a running KH on 127.0.0.1:9000; it now
  needs no server and tests the code itself.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_project_match_weak.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.pop("KH_AUTH_ISSUER", None)

from app import config, projects  # noqa: E402

REGISTRY = [
    {"id": "simplemdg-v1", "role": "project", "aliases": [], "keywords": ["cap", "sap"]},
    {"id": "kh-investigate", "role": "project", "aliases": [], "keywords": []},
    {"id": "knowledge-hub", "role": "project", "aliases": ["kh"], "keywords": ["vector"]},
    {"id": "evo-buzz", "role": "project", "aliases": [], "keywords": ["community"]},
    {"id": "contract-management", "role": "project", "aliases": [], "keywords": ["contract"]},
]
projects.registry_entries = lambda: REGISTRY

CASES = [
    ("toi can nang cap hook mot cach chi tiet hon de ho tro Claude thong minh hon", None,
     "a short keyword ('cap') inside another word's syllable does not route"),
    ("sap", None, "a bare 3-letter keyword alone does not route"),
    ("chuyen project: kh-investigate", "kh-investigate", "an exact id still wins"),
    ("hien tai co xoa hay update de len vector cu duoc khong", "knowledge-hub", "a long keyword still routes"),
    ("cai a the nao roi", None, "no project named"),
    ("tao agent Senior Dev trong community Simplemdgv2", "evo-buzz", "GAP: generic keyword 'community' routes"),
    ("the sap mapping engine contract", "contract-management", "GAP: generic keyword 'contract' routes"),
]

FAILURES = []
check_len = config.PROJECT_MATCH_WEAK_KEYWORD_LEN
print(f"weak keyword length floor: {check_len}")
for text, want, why in CASES:
    got = projects.resolve_project_name(text)
    ok = got == want
    print(("ok   " if ok else "FAIL ") + f"{why}  (want={want} got={got})")
    if not ok:
        FAILURES.append(why)

hits = projects.match_projects("sap")
ok = len(hits) == 1 and hits[0]["project"] == "simplemdg-v1" and hits[0]["weak"] is True
print(("ok   " if ok else "FAIL ") + f"a weak hit is still reported, marked weak  ({hits})")
if not ok:
    FAILURES.append("weak hit reported")

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
