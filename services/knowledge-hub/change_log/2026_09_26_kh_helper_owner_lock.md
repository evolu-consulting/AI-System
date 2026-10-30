# 2026-09-26 - kh-helper 1.4.0: a sign-in answers only the CLI and profile that made it

fen tested a Grok CLI against `/auth/help`. It resolved PROFILE to `~/.claude` (the only folder the guide
named), found the live Claude Code sign-in in `~/.claude/kh-helper` and used it (`status`, `me`,
`claude mcp list`) without anybody signing in. The guide was fixed the same day (per-CLI profile folders,
"one profile, one sign-in"), but a guide is advice; this release makes the helper refuse.

## What changed

- **`kh_helper/owner.py` (new):** who owns a HOME and whether the caller is that owner.
  - Caller: Claude Code only when `CLAUDECODE=1` AND `CLAUDE_PID` is an ancestor of this process
    (Windows: Toolhelp32 snapshot; elsewhere `ps`). Verified inside real Claude Code hooks (run through
    bash) and MCP servers. Everything else is "other".
  - Owner: recorded in `helper.json` at sign-in; a HOME from before 1.4.0 counts as Claude Code's when
    its folder is named `.claude*`, holds Claude Code's own files, or is the calling Claude profile.
  - A Claude Code HOME refuses other CLIs and other Claude profiles; another CLI's HOME refuses Claude Code.
- **`kh_helper/session.py`:** the check sits in `_access_token()` (the one door every use of the sign-in
  goes through), in `status()` and before `login()`; `_store()` records the owner.
- **`kh_helper/cli.py`:** exit code 3 with "Refused: ..."; `mcp` checks before starting the server;
  `setup` (and the login prompt's setup) runs only from Claude Code with the copy in its own profile,
  because it writes Claude Code's settings. `logout` is allowed from anywhere: it only takes access away.
- **`kh_helper/mcp_server.py`:** a refused call answers status 403.
- **Version 1.4.0.** README section "A sign-in answers only the CLI that made it".
- **Tests:** `tests/test_kh_helper_owner.py`, 23 checks (rules, real child processes with a real and a
  forged `CLAUDE_PID`, the CLI end to end). `tests/test_kh_helper_home.py` now fixes the caller per case
  so it passes from any CLI or terminal.

## Effect

A helper copied into or found in another CLI's profile no longer works there. Limit, stated in the code:
a program that forges the process tree or reads the credential store directly as the same OS user is
not stopped; that needs separate OS accounts. Known false refusal: a helper started through a Git-Bash
wrapper that detaches (for example msys `timeout`) loses the Windows parent chain and is refused.
