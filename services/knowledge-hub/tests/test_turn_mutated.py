"""Test app/hooks/turn.py against the REAL transcript and synthetic cases.

The module is stdlib-only on purpose, so it runs straight from the source tree
without a rebuild and without a running server.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.hooks import turn  # noqa: E402

# A real Claude Code transcript lives on one machine only: name it with KH_TEST_TRANSCRIPT to run part 1.
T = os.getenv("KH_TEST_TRANSCRIPT", "")

print('=== 1. the live transcript, current turn ===')
if T and os.path.exists(T):
    res = turn.turn_mutated(T)
    print('mutated   : %s' % res['mutated'])
    print('reason    : %s' % res['reason'])
    print('tool_count: %s' % res['tool_count'])
    print('how       : %s' % res['how'])
    for e in res['evidence'][:6]:
        print('   %-12s %-32s %s' % (e['tool'], e['why'], e['detail'][:70]))
else:
    print('skipped: set KH_TEST_TRANSCRIPT to a transcript .jsonl')

print('\n=== 2. shell classifier on real commands from this session ===')
CASES = [
    # (command, should_mutate)
    ('curl -s -m 10 "http://127.0.0.1:9000/health"', False),
    ('curl -s -m 20 -X POST "http://127.0.0.1:9000/vector/scroll" -d \'{"scope":"log"}\'', True),
    ('curl -s -m 20 -X POST "http://127.0.0.1:9000/vector/add" -d \'{}\'', True),
    ('python "C:/tmp/log5.py"', True),
    ('python -c "import json;print(1)"', False),
    ('ls -la "C:/RWTemp/"', False),
    ('cat "C:/RWTemp/x.json"', False),
    ('grep -n "harness" file.md', False),
    ('git -C /repo status --short', False),
    ('git -C /repo commit -m "x"', True),
    ('cat > "C:/RWTemp/out.html" << EOF', True),
    ('wc -l file.jsonl', False),
    ("pwsh -NoProfile -Command \"& 'C:/Programs/ClaudeKH/tools/kh.ps1' health\"", True),
    ('sed -n "1,40p" file.py', False),
    ('sed -i "s/a/b/" file.py', True),
    ('find "C:/Workspaces" -maxdepth 3 -type d', False),
    ('rm -f /tmp/x', True),
    ('echo hello', False),
    ('head -5 file.txt', False),
    ('docker compose up -d', True),
]
fails = 0
for cmd, want in CASES:
    why = turn.classify_shell(cmd)
    got = why is not None
    ok = got == want
    fails += (not ok)
    print('%s  want=%-5s got=%-5s %-22s | %s'
          % ('PASS' if ok else 'FAIL', want, got, (why or '-')[:22], cmd[:62]))

print('\n=== 3. fail-safe behaviour ===')
for path, label in ((r'C:/does/not/exist.jsonl', 'missing transcript'), ('', 'empty path')):
    r = turn.turn_mutated(path)
    ok = r['mutated'] is True
    fails += (not ok)
    print('%s  %-20s mutated=%s  reason=%s'
          % ('PASS' if ok else 'FAIL', label, r['mutated'], r['reason'][:60]))

print('\n=== 4. tool-name classification ===')
overlap = turn.MUTATING_TOOLS & turn.READONLY_TOOLS
print('%s  no tool is in both sets (overlap=%s)' % ('PASS' if not overlap else 'FAIL', overlap or '{}'))
fails += bool(overlap)

print('\n%s' % ('ALL PASS' if not fails else '%d FAILURE(S)' % fails))
raise SystemExit(1 if fails else 0)
