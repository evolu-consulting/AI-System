# kh-helper 1.18.3: SessionStart split into kernel and personalization hooks (2026-10-29)

## Why

Claude Code keeps at most 10,000 characters of one hook's output in context; past that it saves the output to a
file and shows the model a 2,000-character preview it is never asked to open. The SessionStart hook printed the
kernel and the person's personalization together (14.1 KB on 2026-10-29), so the personalization, which comes
second, did not reach the model. The cap is per hook (and per JSON field), and no setting raises it.

The same day the kernel (5,764 -> 4,690 chars) and Rowan's personalization rows (8,149 -> 5,949 chars) were
shortened in KH; together they are still over 10k.

## How

- **`hooks.HOOKS`**: `SessionStart` prints only `/hooks/raw?hook_type=SessionStart` (plus the setup, companion and
  update notes); a new entry `SessionStartPersonal` prints `/personalization/render`. Its new `event` field says
  the CLI event it is written under, so setup writes two SessionStart commands
  (`hook SessionStart`, `hook SessionStartPersonal`), each with its own 10k cap.
- **`hooks.cli_event()`** maps an entry to its CLI event; used by `setup_claude` and `hooks_note`.
- **Already installed machines**: `hooks_note` finds no `hook SessionStartPersonal` command under SessionStart and
  marks it out of date in the kernel hook's output, so the assistant runs setup.
- **MCP `kh_context("SessionStart")`** and the MCP server's instructions still return both parts (CLIs without
  hooks have no such cap).
- PostCompact still reloads only the kernel, as before.

## Tests

- `tests/test_kh_helper_legacy.py`: setup writes both SessionStart commands; each hook prints only its part.
- `tests/test_kh_helper_clis.py`, `tests/test_kh_helper_home.py`: setup adds 7 hooks.
