"""Fill a local Docker dev KH (deploy/docker/Dockerfile) with the prod data the bench reads.

Stands in for copy_prod_to_dev.py since the BTP dev app kh-sso was removed (2026-10-10, org out of memory).
That script copies HANA Cloud to HANA Cloud with embeddings; a Docker dev keeps its vectors in Chroma (HANA
Express has no REAL_VECTOR), so this one goes through the API and the dev server re-embeds every row.

Reads prod as the person signed in to kh-helper (a maintainer: it must read every bench project) and writes
dev with the same token: both KH instances trust the one Keycloak realm. Projects are created inside the
container (docker exec), never through POST /projects, which would register them at Keycloak.

What is copied: the projects named in tasks.json (after khbench.RENAMES) plus the shared project - their
knowledge, log and entity rows (chunk sidecars are rebuilt by dev) - and prod's policy actions and rules and
hook rules, so both sides route the same way. Dev's own hooks are then changed by the feature under test.

  python seed_docker_dev.py [--dev-url http://127.0.0.1:9101] [--container kh-dev-hana] [--no-hooks]

Run it with the kh-helper Python (it holds the prod sign-in) after starting the container with
KH_AUTH_ISSUER set, so the bench account sees the same permissions on both sides.
"""
import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import requests
from kh_helper.session import Session

sys.path.insert(0, str(Path(__file__).resolve().parent))
import khbench  # noqa: E402  (tasks with the project renames applied)

SKIP_META = {"emb_model", "emb_ver", "emb_dim", "source_text", "author"}
SCOPES = ("knowledge", "log", "entity")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev-url", default="http://127.0.0.1:9101")
    ap.add_argument("--container", default="kh-dev-hana")
    ap.add_argument("--no-hooks", action="store_true", help="keep dev's hook rules as they are")
    ap.add_argument("--registry-only", action="store_true",
                    help="only copy the project registry (descriptors, aliases, keywords, visibility)")
    ap.add_argument("--projects", help="comma list: copy only these projects' rows (resume a cut run); "
                                       "policy and hooks are skipped then")
    a = ap.parse_args()

    prod = Session()

    def retried(fn):
        """Keycloak or BTP sometimes stalls for a minute (a token refresh timed out mid-copy, 2026-10-10)."""
        for attempt in range(5):
            try:
                return fn()
            except (requests.RequestException, OSError) as e:
                if attempt == 4:
                    raise
                print(f"  network: {type(e).__name__}, retry {attempt + 1}", flush=True)
                time.sleep(10 * (attempt + 1))

    def p(method, path, body=None, params=None):
        st, out = retried(lambda: prod.call(method, path, body, params))
        if st != 200:
            sys.exit(f"prod {method} {path}: {st} {str(out)[:300]}")
        return out

    def d(method, path, body=None):
        # a fresh token per call: kh-helper refreshes it, and a full copy outlives one access token
        r = retried(lambda: requests.request(method, a.dev_url + path, json=body, timeout=180,
                                             headers={"Authorization": "Bearer " + prod._access_token()}))
        if r.status_code != 200:
            sys.exit(f"dev {method} {path}: {r.status_code} {r.text[:300]}")
        return r.json()

    registry = p("GET", "/projects")["projects"]
    known = set(registry)
    wanted = sorted({t["project"] for t in khbench.TASKS["tasks"] if t.get("project")} | {khbench.SHARED})
    missing = [x for x in wanted if x not in known]
    projects = [x for x in wanted if x in known]
    if a.projects:
        projects = [x for x in a.projects.split(",") if x in known]
    print("projects", projects, "not on prod:", missing)
    # Every prod project with its descriptor, aliases and keywords: the turn context's project match reads
    # them, and a dev without them matched no project for 'ticketing-system' prompts (bench, 2026-10-10).
    keep = ("role", "aliases", "keywords", "tools", "descriptor", "conflicts_with")
    entries = {pid: {k: e.get(k) for k in keep if e.get(k)} for pid, e in registry.items()}
    code = ("import json\nfrom app import projects\n"
            f"for pid, kw in json.loads({json.dumps(entries)!r}).items():\n"
            "    projects.get_or_create_project(pid, **kw)\n")
    subprocess.run(["docker", "exec", a.container, "python", "-c", code], check=True)
    for pid, e in registry.items():
        if e.get("visibility") and e["visibility"] != "private":
            d("PUT", f"/projects/{pid}/visibility", {"visibility": e["visibility"]})
    d("POST", "/projects/registry/sync")
    print("registry", len(entries), "projects")
    if a.registry_only:
        return

    # policy: every-project actions and each project's own, with their rules
    n_act = n_rule = 0
    for proj in ([] if a.projects else [None] + projects):
        menu = p("GET", "/policy/actions", params={"project": proj} if proj else None)
        for act in menu.get("actions", []):
            own = act.get("project") if act.get("project") not in (None, "every project") else None
            if (own or None) != proj:
                continue
            d("POST", "/policy/action/set", {"action": act["action"], "description": act.get("description") or act["action"],
                                             "project": own, "source_policy": act.get("source_policy") or "",
                                             "allow_oversize": True, "reason": "dev copy of prod"})
            n_act += 1
            plan = p("GET", "/policy/plan", params={"action": act["action"], **({"project": own} if own else {})})
            for rule in plan.get("rules", []):
                if (rule.get("project") if rule.get("project") != "every project" else None) != own:
                    continue
                d("POST", "/policy/rule/set", {"action": act["action"], "sub_action": rule["sub_action"],
                                               "content": rule["content"], "seq": rule.get("seq", 0),
                                               "clauses": rule.get("clauses") or "", "project": own,
                                               "allow_oversize": True, "reason": "dev copy of prod"})
                n_rule += 1
    print("policy actions", n_act, "rules", n_rule)

    if not (a.no_hooks or a.projects):
        hooks = p("GET", "/hooks/list")["rules"]
        for h in hooks:
            d("POST", "/hooks/set", {"hook_type": h["hook_type"], "name": h["name"], "content": h["content"],
                                     "enabled": bool(h.get("enabled", 1)), "position": h.get("position", 0),
                                     "allow_oversize": True, "reason": "dev copy of prod"})
        print("hook rules", len(hooks))

    counts = Counter()
    for proj in projects:
        for scope in SCOPES:
            hits, offset = [], 0
            while True:                       # /vector/scroll answers at most 5,000 rows per call
                page = p("POST", "/vector/scroll", {"scope": scope, "project": proj, "limit": 5000,
                                                    "offset": offset})["hits"]
                hits += page
                offset += len(page)
                if len(page) < 5000:
                    break
            have, off = set(), 0                # rows dev already has (a resumed run skips them)
            while True:
                page = d("POST", "/vector/scroll", {"scope": scope, "project": proj, "limit": 5000, "offset": off,
                                                    "max_chars": 50})["hits"]
                have |= {x["vector_id"] for x in page}
                off += len(page)
                if len(page) < 5000:
                    break
            for h in hits:
                if h["vector_id"] in have:
                    counts[(proj, scope)] += 1
                    continue
                meta = {k: v for k, v in (h.get("metadata") or {}).items() if k not in SKIP_META}
                if meta.get("chunk_of"):
                    continue
                meta.update(scope=scope, project=proj)
                d("POST", "/vector/add", {"id": h["vector_id"], "text": h["source_text"], "scope": scope,
                                          "project": proj, "metadata": meta})
                counts[(proj, scope)] += 1
            print(proj, scope, counts[(proj, scope)], flush=True)
    print("rows copied", sum(counts.values()))


if __name__ == "__main__":
    main()
