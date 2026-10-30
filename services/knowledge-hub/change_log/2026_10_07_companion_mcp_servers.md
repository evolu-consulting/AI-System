# 2026-10-07 - Setup registers companion MCP servers: App Session Manager (kh-helper 1.11.0)

| Release | What changed | Where it runs |
|---|---|---|
| kh-helper 1.11.0 | `kh setup` also registers installed companion MCP servers; SessionStart asks for setup again when one was installed later. | helper only; KH server unchanged |

## What was wrong

A KH prod session (Claude Code profile `~/.claude_julian`) met the Workbeats sign-in page and asked the
person to type their password. The local sign-in tool (now App Session Manager) had an MCP server, but
it was registered by hand in one profile only (`~/.claude_rowan`). No installer registered it, so every
other profile, and every new KH install, lacked the tool.

## What changed

- New `kh_helper/companions.py`: a catalogue of companion tools, each with a discovery file at a fixed
  place. App Session Manager's tray writes `%LOCALAPPDATA%/AppSessionManager/mcp.json`
  (`{name, command, args}`) on every start. A file whose command or script is gone is ignored.
- `kh setup` registers each companion found, in the same CLI and the same way as knowledge-hub:
  Claude Code with `claude mcp add -s user` (both config files for the default profile), Grok and Codex
  in `config.toml`, Gemini in `settings.json`. The result has a `companions` key.
- Upgrade path: the documented update (pip install, then `kh setup`) picks it up with no extra step.
- Installed after setup: the SessionStart hook checks, locally and without a CLI call, whether an
  installed companion is missing from this CLI's config, and adds one line asking the assistant to run
  `kh setup` again and to tell the person to restart.
- `kh setup --remove` takes out every known companion name too.
- A new companion is a new `CATALOG` row.

## App Session Manager side (tools/auto_login, source in Stools)

Renamed from Auto Login: tray, config page and MCP server `app-session-manager`, tools `list_apps` and
`get_session(app)`; the old names still answer. The MCP instructions still say plainly that it signs in
with accounts their owners stored, with env, owner and consent per entry. `install.ps1` renames the
startup entry and removes the old one.

## Checks

- New `tests/test_kh_helper_companions.py`: 14 ok (discovery, stale file, Codex and Gemini write and
  remove, nothing installed writes nothing, Claude Code add and remove commands, SessionStart note).
- Other helper suites: same as before (clis, legacy, owner, quiet, remove, startup, turn all pass;
  `test_kh_helper_home.py` fails before and after with WrongOwner when run from inside a Claude Code
  profile). Existing suites now stub `_claude_companions` so they never touch the real MCP list.
- Live: real `claude` CLI on a throwaway profile: note shown, `_claude_companions` registered the
  server, `claude mcp list` showed it Connected, note gone, remove left nothing.
- App Session Manager: 14 -> 16 tests ok; live stdio: serverInfo app-session-manager, tools
  list_apps + get_session, list_apps returned the 12 entries.

## Prod rollout (2026-10-07)

- Deployed `kh-btp-hana` at `e4b95fe` to `knowledge-hub` (`push.ps1 -HanaService kh-hana-v2 -AuthIssuer ...`).
  `/auth/config` and `/auth/help` name `kh_helper-1.11.0`; `/health` 200, `/projects` without a token 401.
  Server code unchanged, so no data backup; rollback = redeploy `5ecb571`.
- e2e multi-user on prod: 73/73.
- Prod kernel (SessionStart rule 'kernel', every user): new rule (6) SIGN-IN PAGES - use
  app-session-manager get_session(app) when the CLI has it, once per app per task; otherwise the person
  signs in in their own browser; never ask for a password, token or code in the chat. 3956 -> 4613 chars.
  Previous text kept as a local backup.
- `~/.claude_julian` (fen's KH prod profile): helper upgraded to 1.11.0 from the served wheel; its
  app-session-manager MCP server is Connected and the SessionStart note is silent.
