"""Replays the hooks as they were BEFORE the lazy-policy rollout of 2026-10-04, for the long-session bench.

  python oldhooks.py local SessionStart|Personalization|UserPromptSubmit
  python oldhooks.py prod  SessionStart|UserPromptSubmit      (reads the hook's stdin JSON for the prompt)

Texts come from the backups taken by the rollout scripts. The prod per-prompt hook runs the live kh-helper
(inbox + KH TURN CONTEXT) and swaps in the old prompt-guard; the turn context's ACTIONS block is dropped,
because before the rollout prod's action table held only e2e test rows.
"""
import json, subprocess, sys
from pathlib import Path

R = Path(__file__).resolve().parent.parent / "results"
LOCAL = R / "local_before_lazy_policy_20261004-171427.json"
PROD = R / "prod_before_lazy_policy_20261004-165759.json"
LOCAL_PERS = R / "local_personalization_render_before_lazy_policy.txt"
NEW_GUARD_HEAD = "KH PER-REQUEST CHECK"


def rules(path, event):
    hooks = json.loads(path.read_text(encoding="utf-8"))["hooks"]
    rows = sorted((h for h in hooks if h["hook_type"] == event and h["enabled"]), key=lambda h: h["position"])
    return "\n\n".join(h["content"] for h in rows)


def prod_prompt(stdin_text):
    # The helper's own hook hangs when run outside a Claude Code session, so the turn context is fetched
    # straight from KH prod with the bench account (the helper does the same call, minus the inbox).
    sys.path.insert(0, str(Path(__file__).parent))
    import urllib.parse
    import khbench as kb
    prompt = (json.loads(stdin_text or "{}").get("prompt") or "")[:2000]
    res = kb.call("prod", "GET", "/turn/context?text=" + urllib.parse.quote(prompt))
    status, body = res[0], res[1]
    text = body.get("text", "") if status < 300 and isinstance(body, dict) else ""
    lines, skip = [], False
    for line in text.splitlines():
        if line.startswith("ACTIONS"):
            skip = True
            continue
        if skip and line.startswith("  - "):
            continue
        skip = False
        lines.append(line)
    return rules(PROD, "UserPromptSubmit") + "\n\n" + "\n".join(lines)


def main():
    env, what = sys.argv[1], sys.argv[2]
    sys.stdout.reconfigure(encoding="utf-8")
    stdin_text = sys.stdin.read() if what == "UserPromptSubmit" else ""
    if env == "local":
        if what == "Personalization":
            print(LOCAL_PERS.read_text(encoding="utf-8"))
        else:
            print(rules(LOCAL, what))
    else:
        print(prod_prompt(stdin_text) if what == "UserPromptSubmit" else rules(PROD, what))


if __name__ == "__main__":
    main()
