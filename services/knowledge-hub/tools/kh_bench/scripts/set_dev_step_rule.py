"""Roadmap item C, part 2: the step-wise hook rule on DEV only (2026-10-03).

Backs up dev's UserPromptSubmit rules to results/dev_hooks_before_C.json (once), then
  - rewrites the disabled 'step-wise' rule (from the 2026-09-30 trial) to use POST /context/step, enables it;
  - points the 'THE WORK ITSELF' line of 'prompt-guard' at that rule.
Prod is never touched. `python set_dev_step_rule.py restore` puts the backup back.
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import khbench as kb  # noqa: E402

BACKUP = kb.RESULTS / "dev_hooks_before_C.json"

STEP_WISE = (
    "STEP-WISE KH (the work itself). One KH call per step: POST /context/step "
    "{\"text\":\"<the step's intent in English, plus the minimum context>\",\"project\":\"<id>\"}. "
    "It returns one bounded pack: entity cards (named or described), then knowledge, then the worklog only when "
    "knowledge is not close enough; a date or 'latest' in the step reads the log by time. Each item names its "
    "tier and id.\n"
    "Use it INSTEAD of separate /vector/query, /entities/match and /log/recent calls. A question that is one step "
    "is one call. Split only when the work has genuinely separate steps, and make the calls of independent steps "
    "in the same turn.\n"
    "Read a whole row (POST /vector/scroll {\"ids\":[...]}) only for an item you use that is cut (truncated). "
    "Do not query again what a pack already answered."
)
OLD_WORK = "- THE WORK ITSELF: query the resolved project's own knowledge or worklog only for what the task needs " \
           "(POST /vector/query, GET /log/recent for time questions)."
NEW_WORK = "- THE WORK ITSELF: follow the STEP-WISE KH rule below (POST /context/step, one call per step)."


def rules():
    s, b, *_ = kb.call("dev", "GET", "/hooks/list?hook_type=UserPromptSubmit", who="agent-admin")
    assert s == 200, (s, b)
    return {r["name"]: r for r in b["rules"]}


def put(rule, content, enabled):
    s, b, *_ = kb.call("dev", "POST", "/hooks/set", {"hook_type": "UserPromptSubmit", "name": rule["name"],
                                                    "content": content, "enabled": enabled,
                                                    "position": rule["position"]}, who="agent-admin")
    assert s == 200, (s, b)


def main():
    current = rules()
    if sys.argv[1:] == ["restore"]:
        for r in json.loads(BACKUP.read_text(encoding="utf-8")):
            put(r, r["content"], bool(r["enabled"]))
    else:
        if not BACKUP.exists():
            BACKUP.write_text(json.dumps(list(current.values()), indent=1, ensure_ascii=False), encoding="utf-8")
        guard = current["prompt-guard"]
        assert OLD_WORK in guard["content"] or NEW_WORK in guard["content"], "prompt-guard text changed; check by hand"
        put(guard, guard["content"].replace(OLD_WORK, NEW_WORK), True)
        put(current["step-wise"], STEP_WISE, True)
    after = rules()     # read back, never trust the write's answer
    for name in ("prompt-guard", "step-wise"):
        print(name, "enabled" if after[name]["enabled"] else "disabled", len(after[name]["content"]), "chars")
    print("work line:", "NEW" if NEW_WORK in after["prompt-guard"]["content"] else "OLD")


if __name__ == "__main__":
    main()
