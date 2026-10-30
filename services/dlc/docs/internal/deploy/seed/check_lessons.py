"""Leftover check for the customer lesson seed (INTERNAL tool, stdlib only).

    python check_lessons.py [lessons-customer.json]

Scans every row (text and metadata) for internal identifiers that must not reach a customer KH:
person names and e-mails, customer and company names, internal hosts and URLs, machine paths,
KH row ids, repository/org names, internal tools, secret-looking strings. Exit 0 = clean, 1 = hits found.
"""
import json
import os
import re
import sys

BS = "\\"
PATTERNS = {
    "email": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "person": r"\b(Rowan|Hugh|Phuc|Calvin|Lucas|Frank|Nghiep|Truong|fen)\b",
    "customer": r"\b(Vicor|Pacific|SimpleMDG|SMDG|Laidon|laidon|simplemdg|ZeusADM|Buma)\b",
    "internal-project": r"(EvoBuzz|Solace|Workbeats|WorkBeats|WORKBEATS|App Session Manager|AutoLogin|M360|RITA\b|RWNote)",
    "internal-host": r"(cfapps\.|hana\.ondemand|communities\.simplemdg|solacebuzz|kh-keycloak|teams\.microsoft)",
    "win-path": "[A-Za-z]:" + re.escape(BS) + r"[\w.$-]+",
    "drive-path": r"\b[A-Za-z]:/[\w.$-]+",
    "user-path": r"/Users/[\w.-]+|\.claude_[a-z]+|claude_rowan",
    "kh-id": r"\b(vec|mig|dk|ent)_[0-9a-zA-Z_]{6,}",
    "repo": r"(RWorkspace|NghiepHoang|phuctruong|ClaudeKH)",
    "secret": r"(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{12,}|eyJ[A-Za-z0-9_-]{20,})",
}


def scan(rows):
    hits = []
    for r in rows:
        blob = r.get("text", "") + " " + json.dumps(r.get("metadata", {}), ensure_ascii=False)
        for name, pat in PATTERNS.items():
            for m in re.finditer(pat, blob):
                hits.append((r.get("id"), name, m.group(0)))
    return hits


def main(argv):
    path = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                      "lessons-customer.json")
    doc = json.load(open(path, encoding="utf-8"))
    rows = doc["rows"] if isinstance(doc, dict) else doc
    hits = scan(rows)
    for rid, name, val in hits:
        print("HIT %-16s %-18s %s" % (name, rid, val))
    print("rows=%d hits=%d -> %s" % (len(rows), len(hits), "FAIL" if hits else "CLEAN"))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
