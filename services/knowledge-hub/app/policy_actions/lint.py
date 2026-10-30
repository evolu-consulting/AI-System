"""Policy authoring guards (fen, 2026-10-04).

Hook text and policies used to grow by appending: every correction became a new row, nothing had a size
budget, and the session-start text passed Claude Code's 10,000-char hook limit, so the model saw a 2 KB
preview of it. These checks run on every write and as a report:

  * size budgets   - action description, one rule, one whole plan, and each hook type's rendered text
                     (config.POLICY_*, config.HOOK_MAX). Over budget answers 422 unless the caller sends
                     ``allow_oversize: true`` with a ``reason``.
  * overlap        - an action whose when-line shares most of its words with another action's: a warning,
                     because two near-identical labels make the model's pick a coin toss.
  * unused         - (report only) actions nobody fetched with /policy/plan for POLICY_UNUSED_DAYS.

The menu placeholder: a hook rule may hold ``{menu}``; reads replace it with the every-project action menu
(one line per action), so adding an action never again needs a hand edit of the hook text.
"""
from __future__ import annotations

import re
import time
from typing import Any

from app import config
from app.policy_actions import store

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"a", "an", "the", "or", "and", "of", "to", "in", "on", "for", "a", "is", "it", "any", "with", "as", "by",
         "be", "this", "that", "from", "into", "not", "no", "e", "g", "eg"}


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if w not in _STOP and len(w) > 1}


def overlap(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _short(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    for stop in (". ", "\n"):
        cut = text.find(stop)
        if 0 < cut < limit:
            return text[:cut + 1].strip()
    return text if len(text) <= limit else text[:limit - 3].rstrip() + "..."


def menu_lines(project: str | None = None) -> str:
    """One line per action - what ``{menu}`` in a hook rule becomes."""
    return "\n".join(f"- '{a['action']}': {_short(a['description'], config.TURN_WHEN_CHARS)}"
                     for a in store.menu(project))


def render(text: str) -> str:
    if config.MENU_PLACEHOLDER in (text or ""):
        return text.replace(config.MENU_PLACEHOLDER, menu_lines())
    return text


# ------------------------------------------------------------------------------------------- write checks

def check_action(action: str, description: str, project: str | None = None) -> dict[str, list[str]]:
    errors, warnings = [], []
    if len(description) > config.POLICY_DESC_MAX:
        errors.append(f"description is {len(description)} chars, budget {config.POLICY_DESC_MAX}: keep it to "
                      "the when-to-use line; the steps belong in rules")
    for other in store.menu(project):
        if other["action"] == action:
            continue
        o = overlap(description, other["description"])
        if o >= config.POLICY_OVERLAP:
            warnings.append(f"when-line overlaps '{other['action']}' ({o:.2f}): update that action instead, "
                            "or make the two lines clearly different")
    return {"errors": errors, "warnings": warnings}


def check_rule(action: str, sub_action: str, content: str, project: str | None = None) -> dict[str, list[str]]:
    errors = []
    if len(content) > config.POLICY_RULE_MAX:
        errors.append(f"rule is {len(content)} chars, budget {config.POLICY_RULE_MAX}: one imperative step, "
                      "no history or rationale (that goes in the work log)")
    current = store.plan(action, project)
    before = sum(len(r["content"]) for r in current)
    total = len(content) + sum(len(r["content"]) for r in current if r["sub_action"] != sub_action)
    # A legacy plan already over budget may still be edited, as long as the edit does not grow it.
    if total > config.POLICY_PLAN_MAX and total > before:
        errors.append(f"plan of '{action}' would be {total} chars, budget {config.POLICY_PLAN_MAX}: split the "
                      "action or shorten its steps")
    return {"errors": errors, "warnings": []}


def check_hook(hook_type: str, name: str, content: str, rules: list[dict[str, Any]]) -> dict[str, list[str]]:
    """``rules``: the enabled rules of this hook type as stored now."""
    limit = config.HOOK_MAX.get(hook_type)
    if not limit:
        return {"errors": [], "warnings": []}
    before = len("\n\n".join(render(r["content"]) for r in rules))
    parts = [render(r["content"]) for r in rules if r["name"] != name] + [render(content)]
    total = len("\n\n".join(parts))
    if total > limit and total > before:   # a hook already over budget may be edited down
        return {"errors": [f"{hook_type} would print {total} chars, budget {limit} (Claude Code shows the model "
                           "only a 2 KB preview past 10,000): move task rules into action policies"],
                "warnings": []}
    return {"errors": [], "warnings": []}


def gate(result: dict[str, list[str]], body: dict) -> dict[str, list[str]] | None:
    """None = go ahead. A dict = the 422 detail. allow_oversize + a reason turns errors into warnings."""
    if not result["errors"]:
        return None
    if body.get("allow_oversize") and (body.get("reason") or "").strip():
        result["warnings"] = result["errors"] + result["warnings"]
        result["errors"] = []
        return None
    return {"error": "POLICY-LINT", **result,
            "hint": "fix the text, or resend with allow_oversize: true and a reason"}


# ------------------------------------------------------------------------------------------------ report

def report(hook_rules: list[dict[str, Any]]) -> dict[str, Any]:
    actions, rules = store.all_rows()
    out: dict[str, Any] = {"limits": {"description": config.POLICY_DESC_MAX, "rule": config.POLICY_RULE_MAX,
                                      "plan": config.POLICY_PLAN_MAX, "hooks": config.HOOK_MAX}}
    out["oversize_descriptions"] = [{"project": a["project"], "action": a["action"], "chars": len(a["description"])}
                                    for a in actions if len(a["description"]) > config.POLICY_DESC_MAX]
    out["oversize_rules"] = [{"project": r["project"], "action": r["action"], "sub_action": r["sub_action"],
                              "chars": len(r["content"])} for r in rules if len(r["content"]) > config.POLICY_RULE_MAX]
    plans: dict[tuple[str, str], int] = {}
    for r in rules:
        plans[(r["project"], r["action"])] = plans.get((r["project"], r["action"]), 0) + len(r["content"])
    out["oversize_plans"] = [{"project": p, "action": a, "chars": n} for (p, a), n in plans.items()
                             if n > config.POLICY_PLAN_MAX]
    hooks: dict[str, int] = {}
    for h in hook_rules:
        if h.get("enabled"):
            hooks.setdefault(h["hook_type"], 0)
            hooks[h["hook_type"]] += len(render(h["content"])) + 2
    out["hooks"] = {t: {"chars": n, "budget": config.HOOK_MAX.get(t), "over": n > config.HOOK_MAX.get(t, 10 ** 9)}
                    for t, n in hooks.items()}
    out["overlaps"] = []
    for i, a in enumerate(actions):
        for b in actions[i + 1:]:
            if a["project"] == b["project"]:
                o = overlap(a["description"], b["description"])
                if o >= config.POLICY_OVERLAP:
                    out["overlaps"].append({"project": a["project"], "a": a["action"], "b": b["action"],
                                            "overlap": round(o, 2)})
    use = store.usage()
    cutoff = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - config.POLICY_UNUSED_DAYS * 86400))
    out["unused"] = []
    for a in actions:
        u = [v for (p, act), v in use.items() if act == a["action"]]
        last = max((v["last_fetch"] for v in u), default="")
        if (a.get("updated_at") or "") < cutoff and last < cutoff:
            out["unused"].append({"project": a["project"], "action": a["action"], "last_fetch": last or None,
                                  "fetches": sum(v["fetches"] for v in u)})
    out["ok"] = not (out["oversize_descriptions"] or out["oversize_rules"] or out["oversize_plans"]
                     or any(h["over"] for h in out["hooks"].values()))
    return out
