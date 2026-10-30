"""Step 10: the parity report (Markdown) - what a person reads before sign-off."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence

from .matrix import counts, markdown


def build(m: Mapping[str, Any], rows: Sequence[Mapping[str, Any]], features: Mapping[str, Mapping[str, Any]],
          conflicts: Sequence[Mapping[str, Any]], blast: Mapping[str, Any], unproven: Sequence[Mapping[str, Any]],
          baseline: Mapping[str, Any], verify: Mapping[str, Any], child: Mapping[str, Any], *,
          effort: Mapping[str, Any] = None, surface: Mapping[str, Any] = None,
          repos: Mapping[str, Sequence[Mapping[str, Any]]] = None) -> str:
    effort, surface, repos = effort or {}, surface or {}, repos or {}
    c = counts(rows)
    L: List[str] = ["# Feature migration %s" % m["id"], "",
                    "| | |", "|---|---|",
                    "| v1 | %s |" % m.get("v1_label", m.get("v1")),
                    "| v1 base (custom detection) | %s |" % (m.get("v1_base") or "not given"),
                    "| v2 (target) | %s |" % m.get("v2"),
                    "| mode | %s |" % m.get("mode"),
                    "| state | %s%s |" % (m.get("state"), (" (%s)" % m["code"]) if m.get("code") else ""),
                    "| build run | %s |" % (m.get("run") or "-"),
                    "| cost | %s |" % _cost(m.get("budget") or {}),
                    "| rollback point | v2 main at %s |" % ((child.get("detail") or {}).get("base_sha") or
                                                          m.get("v2_head") or "-"),
                    "", "## Summary", "",
                    "- v1 only (ported): %d, of which custom: %d" % (c["v1_only"], sum(
                        1 for r in rows if r["class"] == "v1_only" and r.get("custom"))),
                    "- v2 only (protected): %d" % c["v2_only"],
                    "- both, same (checked alive): %d" % c["both_same"],
                    "- both, conflicting (decided): %d" % c["both_conflict"],
                    "- one-sided findings re-checked by the confirmation pass: %d" % c["confirmed"],
                    "- unproven (no verified evidence, not migrated): %d" % len(unproven), "",
                    "## Parity matrix", "", markdown(rows, features)]
    if any(repos.get(side) for side in ("v1", "v2")):
        L += ["## Repositories scanned", "",
              "Each repository was scanned on its own; the results were merged into the matrix above.", "",
              "| Side | Repository | Ref | Commit | Stack | Features | Cost USD | Status |",
              "|---|---|---|---|---|---|---|---|"]
        for side in ("v1", "v2"):
            for r in repos.get(side) or []:
                st = r.get("status", "")
                if r.get("cached"):
                    st += " (cached)"
                if r.get("error"):
                    st += ": " + str(r["error"]).splitlines()[0][:120]
                L.append("| %s | %s | %s | %s | %s | %d | %.2f | %s |" % (
                    side, r.get("repo", ""), r.get("ref") or "-", (r.get("sha") or "-")[:12],
                    ", ".join(r.get("stacks") or []) or "-", int(r.get("features") or 0),
                    float(r.get("usd") or 0.0), st))
        failed = [r["repo"] for side in ("v1", "v2") for r in repos.get(side) or [] if r.get("status") != "ok"]
        if failed:
            L += ["", "Not scanned (failed): %s. Their features are missing from this report." % ", ".join(failed)]
        L.append("")
    if effort.get("areas"):
        L += ["## Feature areas and effort hints", "",
              "| Area | Port | Protect | Conflicts | Entities | Services | Screens | Handlers | v2 tests guarding | High blast |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for a in effort["areas"]:
            L.append("| %s | %d | %d | %d | %d | %d | %d | %d | %d | %d |" % (
                a["area"], a["port"], a["protect"], a["conflicts"], a["entities"], a["services"], a["screens"],
                a["handlers"], a["tests"], a["high_blast"]))
        L.append("")
    if surface:
        L += ["## Surface comparison (by code, before any model)", ""]
        for kind, v in surface.items():
            L.append("- %s: both %d, renamed %d, v1 only %d, v2 only %d%s" % (
                kind, len(v["both"]), len(v["renamed"]), len(v["v1_only"]), len(v["v2_only"]),
                ("; renamed: " + ", ".join("%s = %s" % (a, b) for a, b in v["renamed"][:10])) if v["renamed"] else ""))
            for n, note in list((v.get("notes") or {}).items())[:20]:
                L.append("  - %s: %s" % (n, note))
        L.append("")
    decisions = [x for x in conflicts if x.get("kind") == "decision"]
    conflicts = [x for x in conflicts if x.get("kind", "conflict") == "conflict"]
    L += ["## Open decisions asked up front", ""]
    if not decisions:
        L.append("None.")
    for x in decisions:
        L.append("- **%s** %s -> **%s** by %s" % (x["id"], x.get("question"), x.get("choice") or "open", x.get("who") or "-"))
    L += ["", "## Conflicts and decisions", ""]
    if not conflicts:
        L.append("None.")
    for x in conflicts:
        L.append("- **%s %s**: choice **%s** by %s. v1: %s v2: %s%s" % (
            x["id"], x["name"], x.get("choice") or "open", x.get("who") or "-",
            (x.get("v1_behaviour") or "").rstrip(".") + ".", (x.get("v2_behaviour") or "").rstrip(".") + ".",
            (" Backup: `%s`" % x["backup"]) if x.get("backup") else ""))
    L += ["", "## Blast radius", ""]
    for r in blast.get("at_risk") or []:
        L.append("- %s %s at risk: %s; tests %s" % (r["row"], r["name"], r["reason"], ", ".join(r["tests"]) or "-"))
    if not blast.get("at_risk"):
        L.append("No protected feature shares data, interfaces or modules with the changes.")
    for g in blast.get("gates") or []:
        L.append("- gate %s (%s) applies to: %s" % (g["name"], g.get("behaviour", ""), ", ".join(g["applies_to"])))
    for m in blast.get("merges") or []:
        L.append("- HIGH: %s merges into live v2 data: %s" % (m["feature"], ", ".join(m["entities"])))
    L += ["", "## Regression guard", "",
          "- baseline: %s test(s), %s passing" % (len(baseline.get("tests") or {}), baseline.get("passed", 0)),
          "- after: %s test(s), %s passing" % (len(verify.get("tests") or {}), verify.get("passed", 0)) if verify
          else "- after: not run",
          "- regressions: %s" % (", ".join(verify.get("regressions") or []) or "none") if verify else ""]
    if unproven:
        L += ["", "## Unproven (for a person)", ""]
        L += ["- %s %s: %s" % (f["id"], f["name"], f.get("behaviour", "")) for f in unproven]
    L += ["", "## Not covered by this run", "",
          "Data and schema migration, configuration, roles, interfaces with partner systems, jobs, print forms,",
          "languages and performance baselines are not automated; see docs/dlc/feature-migration.md section 7.", ""]
    return "\n".join(L)


def _cost(b: Mapping[str, Any]) -> str:
    if not b:
        return "-"
    lim = b.get("limit") or 0
    s = "$%.2f of $%.2f (migration)" % (float(b.get("spent") or 0), float(lim)) if lim else         "$%.2f (migration, no cap)" % float(b.get("spent") or 0)
    if b.get("build_spent") or b.get("build_limit"):
        s += " + $%.2f of $%.2f (build run)" % (float(b.get("build_spent") or 0), float(b.get("build_limit") or 0))
    if b.get("limit_repo"):
        s += "; per repository scan cap $%.2f" % float(b["limit_repo"])
    return s


__all__ = ["build"]
