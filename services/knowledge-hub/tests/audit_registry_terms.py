"""Measure BEFORE changing: which registry terms would a minimum length drop?

The fix for item 5 is a minimum length on keyword-sourced terms. Choosing that
number by taste is how a fix becomes a new bug, so this dumps every term the
matcher can currently fire on, folded exactly the way the matcher folds it,
grouped by length and by source.
"""
import json
import urllib.request

B = 'http://127.0.0.1:9000'

reg = json.loads(urllib.request.urlopen(B + '/projects/registry', timeout=60).read().decode())
entries = reg.get('entries') or reg.get('projects') or reg
if isinstance(entries, dict):
    entries = list(entries.values())

import unicodedata


def fold(text):
    n = unicodedata.normalize('NFD', text or '')
    n = ''.join(ch for ch in n if not unicodedata.combining(ch))
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in n.lower()).split())


rows = []
for e in entries:
    pid = e.get('id')
    for t in [e.get('id', '')]:
        rows.append((pid, fold(t), 'id'))
    for t in (e.get('aliases') or []):
        rows.append((pid, fold(t), 'alias'))
    for t in (e.get('keywords') or []):
        rows.append((pid, fold(t), 'keyword'))

rows = [r for r in rows if r[1]]
print('projects: %d   terms: %d' % (len(entries), len(rows)))

print('\n=== SHORT TERMS (<= 5 chars) - the collision risk ===')
for pid, t, src in sorted(rows, key=lambda r: (len(r[1]), r[0])):
    if len(t) <= 5:
        print('  len=%d  %-9s %-22s %s' % (len(t), src, repr(t), pid))

from collections import Counter
print('\n=== keyword length histogram ===')
h = Counter(len(t) for pid, t, src in rows if src == 'keyword')
for L in sorted(h):
    print('  len %-3d -> %d keyword(s)' % (L, h[L]))

for thresh in (3, 4, 5):
    dropped = [(pid, t) for pid, t, src in rows if src == 'keyword' and len(t) < thresh]
    print('\nMIN_KEYWORD_LEN=%d would drop %d keyword(s): %s'
          % (thresh, len(dropped), dropped if len(dropped) <= 12 else dropped[:12]))
