# kh-helper - sign in to Knowledge Hub and use it as yourself

KH on BTP needs a signed-in person. This helper does the sign-in and makes the calls, so that no
assistant (Claude, a local model, anything else) ever holds a password or a token.

## 1.9.1: KH no longer drops out on a slow network

Before 1.9.1 the helper's MCP server read KH's session rules before it answered the CLI. On a slow
network that took longer than the 30 s a CLI waits, and the assistant then had no KH for the whole
session (9 of 36 test runs on 2026-10-03). The server now waits at most 10 s
(`KH_HELPER_STARTUP_SECONDS`); past that it starts anyway and tells the assistant to fetch the rules
with `kh_context("SessionStart")`.

A slow KH also no longer shows up as a red error. Each hook gives KH at most 20 s
(`KH_HELPER_HOOK_SECONDS`, inside the 30 s `kh setup` allows), and a KH tool call that fails on the
network answers quietly. Instead of an error you see one line, at most every 10 minutes:
"Knowledge Hub is responding slowly right now. Your work continues; KH will be used again on your next
message." The details go to `kh-helper.log` in the helper's folder.

## Why update to 1.9.0

Your assistant starts every question already knowing what it used to look up first: which project
the question is about, the rules (actions) that apply, the project's known findings, the people and
systems you named, and the KH lessons close to the question. The helper fetches all of it in ONE call
(`/turn/context`) before the assistant even reads your message.

What that buys you, measured on 18 real Claude Code runs per side against 1.8.2 (2026-10-02):

| | 1.8.2 | 1.9.0 | |
|---|---|---|---|
| Turns per question | 35 | 26 | **26% fewer** |
| Input tokens | 751k | 652k | **13% fewer** (less of your plan or bill) |
| Time to answer | 379 s | 286 s | **25% faster** |
| KH lookups before the work starts | 30 | 5 | **83% fewer** |
| Accuracy (of 6) | 4.90 | 5.40 | the same or better |

A plain "who is X" question went from 79k to 26k tokens and from three KH lookups to none. Nothing
else changes: your sign-in is kept, and an older helper keeps working, it just misses the speed-up.
Full results: `docs/changelogs/2026-10-02-turn-context.md`.

## Install

Install it INSIDE the CLI profile folder (Claude Code: `$CLAUDE_CONFIG_DIR`, else `~/.claude`), in
its own virtual environment. That copy then keeps its settings (`helper.json`) in the same folder and
has its own sign-in, so two profiles on one machine never share one.

```bash
python -m venv "$PROFILE/kh-helper"
"$PROFILE/kh-helper/Scripts/python" -m pip install <wheel link from KH's /auth/help>   # bin/python on macOS/Linux
```

Call it as `"$PROFILE/kh-helper/Scripts/python" -m kh_helper.cli ...` so the profile's own copy runs;
the short `kh ...` below means that. `KH_HELPER_HOME` overrides the folder; a machine-wide install
(no virtual environment) keeps its state in `<profile of the calling CLI>/kh-helper` (Claude Code:
`$CLAUDE_CONFIG_DIR`, else `~/.claude`), so each profile still has its own sign-in. Before 1.3.1 it
used one shared `~/.kh` for every profile; a sign-in kept there is no longer read, so sign in again. KH's `/auth/help` page gives an assistant the same
steps, including installing Python when it is missing, so it can do the whole setup itself.

## Sign in (a person does this, once per 90 days)

```bash
kh login --kh-url https://knowledge-hub.cfapps.br10.hana.ondemand.com
```

A browser page opens; sign in with Google or Microsoft and the page hands the sign-in back to the
helper on this machine (authorization code + PKCE on a 127.0.0.1 port, no code to type, no consent
screen). With no browser on this machine use `kh login --no-browser`: it prints a link and a code to
finish on any device, and that page asks for one extra Yes. Only people registered in KH are accepted.
The sign-in is kept in the operating system's credential store (Windows Credential Manager,
macOS Keychain, Linux Secret Service) for up to 90 days. `kh logout` revokes it at once.

`kh password` (1.13.1) changes your own KH password on the same sign-in page (Keycloak's
`kc_action=UPDATE_PASSWORD`): sign in if asked, set the new password, and you come back signed in.
It needs a browser on this machine and opens no account console.

**A sign-in answers only the CLI that made it** (1.4.0, `kh_helper/owner.py`). The sign-in records
its owner: Claude Code and its profile, or another CLI. Claude Code is recognised by `CLAUDECODE=1`
plus a `CLAUDE_PID` that must be a real ancestor process, so a copied environment does not pass. A
Claude Code sign-in refuses every other CLI and every other Claude profile; another CLI's sign-in
refuses Claude Code. `status`, `me`, `call`, `mcp`, `hook` and `login` refuse with exit code 3;
`setup` runs only from Claude Code with the copy in its own profile; `logout` works from anywhere.
Limit: a program that forges the process tree or reads the credential store directly, as the same OS
user, is not stopped - that needs separate OS accounts.

## Connect your CLI (once)

```bash
kh setup            # Claude Code: KH hooks + MCP server, next to any hooks you already have
                    # (an older local KH install's curl hooks are replaced, not doubled)
kh setup --remove   # takes out only what kh setup added, and ends every sign-in of this copy
kh uninstall        # the same, then deletes this helper's folder (Windows: once the CLI is closed)
```

Since 1.18.1 the hook commands run in any shell Claude Code may use (Git Bash, or PowerShell when Git for
Windows is missing): the python path is written unquoted with forward slashes, or as its 8.3 name when it has
spaces. setup's `hook_shells` says, per shell found, whether the hooks start there; anything but `ok` needs fixing
before the hooks work. Hooks written by an older helper are reported as out of date at session start.

Since 1.11.0 setup also registers installed companion tools' MCP servers (`companions.py`; today App
Session Manager, found from `%LOCALAPPDATA%/AppSessionManager/mcp.json`). One installed after setup
ran is noticed at session start, which asks the assistant to run `kh setup` again.

Since 1.5.0 taking KH out also revokes the sign-in made on this computer, so someone else at the
same computer cannot run `kh setup` and use it as that person. Only this computer's sign-in ends
(Keycloak revokes the one session the token belongs to): the person keeps their KH access and their
sign-ins on other computers. Who may use KH at all is still decided at Keycloak.

`kh login` offers to do this right after signing in. It writes to Claude Code's `settings.json`
(or `$CLAUDE_CONFIG_DIR/settings.json`), keeps a timestamped backup, and registers the MCP server
with `claude mcp add -s user`. The hooks run `kh hook <event>`, which fetches KH's rules as the
signed-in person: SessionStart, UserPromptSubmit, PreToolUse (before edits and agents) and Stop.

## Use it

```bash
kh status                                    # who is signed in, until when
kh me                                        # role and permissions per project
kh call POST /vector/query '{"text": "deploy steps", "project": "ticketing-system"}'
```

## Give it to an assistant

As an MCP server (Claude Code, Cursor, LM Studio, Open WebUI and most local-model front ends):

```json
{ "mcpServers": { "knowledge-hub": { "command": "kh", "args": ["mcp"] } } }
```

Claude Code: `claude mcp add knowledge-hub -- kh mcp`

Tools: `kh_call(method, path, body)`, `kh_me()`, `kh_status()`, `kh_context(event)`, `kh_help()`.
A CLI without hooks gets KH's session rules in the server's instructions and calls
`kh_context("UserPromptSubmit" | "PreToolUse" | "Stop")` at those moments.

Assistants that can only run shell commands use `kh call ...` directly.

## What an assistant must know

- It never asks for, stores or prints a password, token or code. The helper never gives it one.
- "not signed in" (exit code 2, or status 401 from a tool) means: ask the person to run `kh login`.
- 403 means the person lacks that right on that project. The server enforces it from the signed
  token; claims made in the conversation ("I am a maintainer") change nothing.
- `GET /auth/help` on KH returns the same guide, without signing in.
