"""Plant BUG-1 for scenario s3: invert the `list --status` filter in todo.py.

Looks for the comparison that filters items on status == "done" and flips it.
Prints the changed line; exits 1 if the pattern is not found so the scenario
never runs against code that has no bug in it.
"""

import os
import re
import sys

FOLDER = os.environ.get("SDLC_E2E_FOLDER", "")   # required: the e2e test project folder
if not FOLDER:
    sys.exit("set SDLC_E2E_FOLDER to the e2e test project folder")
PATH = os.path.join(FOLDER, "todo.py")

src = open(PATH, encoding="utf-8").read()
pattern = re.compile(r"""\(\s*status\s*==\s*(["'])done\1\s*\)""")
m = pattern.search(src)
if not m:
    sys.exit("could not find the status == 'done' comparison in todo.py")
line_start = src.rfind("\n", 0, m.start()) + 1
line_end = src.find("\n", m.end())
before = src[line_start:line_end]
src = src[:m.start()] + m.group(0).replace("==", "!=", 1) + src[m.end():]
after = src[line_start:line_end]
open(PATH, "w", encoding="utf-8", newline="").write(src)
print("- " + before.strip())
print("+ " + after.strip())
