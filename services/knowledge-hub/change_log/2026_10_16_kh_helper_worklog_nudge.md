# 2026-10-16 - work-log nudge inside the turn (kh-helper 1.13.2)

| Change | What it does | Where |
|---|---|---|
| PostToolUse nudge | After the turn's first change (Write, Edit, Bash, PowerShell, Agent, Artifact, any MCP write) the helper adds one context line: store the work log before the turn ends. The model logs inside the turn, so the Stop check finds the log and prints nothing. Users stop seeing `Stop hook error: KH: if this turn changed something...` on normal turns. | kh-helper 1.13.2 `hooks.nudge` |
| Once per turn | UserPromptSubmit opens the turn; the first change or a log write closes it. Reads, KH lookups, subagent tools and other CLIs get no line. Local only, no KH call. | `~/.claude/kh-helper/nudge/<session>.json` |
| Stop stays as backstop | Turns with no change tool (a long discussion, new information from the person) and a model that ignored the nudge still get the Stop block. | unchanged |
| Setup check | `hooks_note` now also reports an event the installed hooks lack, so a 1.13.1 machine is told to rerun `kh setup` and restart. | `hooks.hooks_note` |

Users must install 1.13.2, run `kh setup` (adds the PostToolUse hook) and restart Claude Code.
