"""Load the DLC process flows (New System, Enhancement, Bug Fix) into a Workflow tool.

    python line/tools/import_dlc_flows.py --url <workflow tool base URL> --dir <flows folder>
                                          (or env WORKFLOW_URL / WORKFLOW_FLOWS_DIR)

Reads every `*-dlc-*.json` document in the flows folder (no default; the flow documents belong to the
workflow tool, not to the engine) and
stores it under its NAME: an existing workflow with that name is replaced, otherwise one is created. Ids are
whatever the target tool hands out, so importing into a fresh tool never collides with its own flows.
Standard library only. Exit 0 when every flow was stored.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.request

def call(base: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw) if raw else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("WORKFLOW_URL", ""), help="workflow tool base URL (or env WORKFLOW_URL)")
    ap.add_argument("--dir", default=os.environ.get("WORKFLOW_FLOWS_DIR", ""),
                    help="folder with the *-dlc-*.json flows (or env WORKFLOW_FLOWS_DIR)")
    a = ap.parse_args(argv)
    if not a.url:
        ap.error("set --url or WORKFLOW_URL")
    if not a.dir:
        ap.error("set --dir or WORKFLOW_FLOWS_DIR")
    a.url = a.url.rstrip("/")
    files = sorted(glob.glob(os.path.join(a.dir, "*-dlc-*.json")))
    if not files:
        print("no *-dlc-*.json in %s" % a.dir, file=sys.stderr)
        return 2
    have = {w["name"]: w["id"] for w in (call(a.url, "GET", "/api/workflows") or {}).get("workflows", [])}
    for f in files:
        with open(f, encoding="utf-8") as fh:
            doc = json.load(fh)
        name = doc.get("name") or os.path.basename(f)
        wid = have.get(name) or call(a.url, "POST", "/api/workflows", {"name": name})["id"]
        doc["id"] = wid
        call(a.url, "PUT", "/api/workflows/" + wid, doc)
        print("%-24s -> workflow #%s" % (name, wid))
    return 0


if __name__ == "__main__":
    sys.exit(main())
