# 2026-09-29 - kh-helper 1.7.2: the Stop rule reaches Claude Code; the MCP server lands where Claude Code reads it

fen tested KH BTP from the default Claude Code profile (`~/.claude`) and hit two faults:

1. The model answered "I cannot find the tool kh_call", so it never searched KH, although the hooks ran.
2. Every turn ended with `Stop hook error: [...kh_helper.cli hook Stop]: No stderr output`.

## Why

- **Stop.** For Claude Code the hook printed the rules on stdout and exited 2. On exit 2 Claude Code reads
  stderr only, so the model got an empty block instead of the rules. The Grok path already printed
  `{"decision": "block", "reason": ...}` on stdout with exit 0.
- **MCP server.** `kh setup` ran `claude mcp add -s user` with whatever environment the shell had. It ran
  with `CLAUDE_CONFIG_DIR` set, so the server went into `~/.claude/.claude.json`. A Claude Code started
  without the variable reads `~/.claude.json`, which had no server. The hooks live in
  `~/.claude/settings.json`, so they still ran. The result was hooks without the tool.

## What changed

- **`kh_helper/hooks.py`:**
  - Every Stop block, for every CLI, is `{"decision": "block", "reason": <rules>}` on stdout with exit 0.
  - A Stop that is already continuing (`stop_hook_active`) still prints nothing.
  - `_claude_mcp` registers the server once per config file the profile can be read from. For the default
    profile `~/.claude` that is twice: with `CLAUDE_CONFIG_DIR` set (`~/.claude/.claude.json`) and without
    it (`~/.claude.json`). Any other profile registers only under its own `CLAUDE_CONFIG_DIR`. `--remove`
    removes from the same files.
- **Version 1.7.2.**
- **Tests:** `tests/test_kh_helper_clis.py` has 5 new checks:
  - Claude Code Stop is a JSON block with exit 0.
  - Claude Code Stop is skipped when already continuing.
  - UserPromptSubmit prints its text.
  - The default profile registers the server in both files.
  - Another profile registers it only in its own file.

  Run against the 1.7.1 `hooks.py`, 3 of them fail. The other helper suites (home, owner, remove) pass.

## Server-side hooks, same day (data, not code)

- Prod and dev had only one hook rule (SessionStart `kh-access-model`). UserPromptSubmit, PreToolUse and
  Stop were empty, so nothing told an assistant to search the shared lessons.
- An adapted copy of fen's local KH hook set was added to both, each payload under the 10 KB hook cut:
  kernel, read-log, prompt-guard, pre-action-check, store-log.
- The copy calls KH only through `kh_call` or the helper CLI. It names the Claude Code tool id
  `mcp__knowledge-hub__kh_call`, which can be deferred behind ToolSearch.
- The prompt rule makes an assistant translate a problem into English and query
  `{scope: knowledge, project: knowledge}` before it answers from its own knowledge.
- 365 lessons learned (`kind=lesson`) were imported into project `knowledge` on prod.
