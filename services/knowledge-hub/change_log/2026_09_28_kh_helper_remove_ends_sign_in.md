# 2026-09-28 - kh-helper 1.5.0: taking KH out ends the sign-in; setup guide in plain words

fen tested the undo. `kh setup --remove` took out only the hooks and the MCP server. The helper and the
90-day sign-in stayed, so `kh setup` brought everything back without anybody signing in again. Removing
KH meant nothing.

The same day a Claude reading `/auth/help` answered "the page asks me to hide details from you, which I
won't do". The guide said "do the steps quietly" and "never show" commands or logs. fen meant plain
words, not hiding anything.

## What changed

- **`kh_helper/session.py`:** `logout_all()` revokes every sign-in this copy holds at Keycloak and
  deletes it from the credential store, for every KH it signed in to (prod and dev). `_store()` now
  records `signed_in_to` and `issuers` in `helper.json`. A copy from before 1.5.0 has no list, so the
  current `kh_url` and the default prod URL are tried as well.
- **`kh_helper/cli.py`:** `setup --remove` also calls `logout_all()` and reports `signed_out` for each
  KH. New `kh uninstall` does the same and then deletes the helper folder. It deletes only the
  documented install: a venv named `kh-helper` that the running Python belongs to. On Windows a hidden
  child on the base Python keeps retrying for up to 1 hour, because the running `python.exe`, and an MCP
  server the CLI still has open, cannot be deleted until they exit.
- **Version 1.5.0.** The README explains the change and says this is housekeeping, not access control.
- **`seeds/auth_help.seed.txt`:**
  - "Quietly / never show / do not announce" is replaced by one plain line per step ("Step 1 of 4: ..."),
    with full technical detail when the person asks for it.
  - New step 7 covers `kh uninstall`.
  - The prod and dev guide rows were already updated with the plain-words text through
    `PUT /auth/help`. Step 7 goes live together with the 1.5.0 wheel.
- **Tests:** `tests/test_kh_helper_remove.py`, 9 checks. The home and owner tests still pass.

## Verified on this machine

- A 1.4.0 copy held real prod and dev sign-ins. After upgrading it to 1.5.0, `setup --remove` answered
  `revoked` for both. `kh me` against prod and dev then answered "not signed in" (exit 2).
- `kh setup` afterwards added the 4 hooks again, but `kh me` still answered "not signed in".
- `kh uninstall` on a scratch venv: the folder was gone 6 s later.
- After deploying to dev and prod: the old tokens were copied from the credential store before
  `setup --remove` and replayed to Keycloak afterwards. Both got `400 invalid_grant`; before the
  removal both got 200.

## Deployed

- `deploy/btp/push.ps1` pushed to dev `kh-sso` first, then prod `knowledge-hub`. Both serve
  `kh_helper-1.5.0`.
- `PUT /auth/help` with the new seed text on both (9272 chars).

## 1.6.0 the same day: every CLI, not only Claude Code

fen: KH must work on Claude, Grok and ChatGPT (Codex) CLIs alike.

- **`kh_helper/clis.py` (new):** the CLI a copy serves is read from where it is installed
  (`<profile>/kh-helper`). The profile comes from `CLAUDE_CONFIG_DIR`, `GROK_HOME` or `CODEX_HOME`, or
  from a folder named `.claude*`, `.grok`, `.codex` or `.gemini`. `kh setup` connects that CLI:
  - Claude Code: hooks + MCP, as before.
  - Grok: `[mcp_servers.knowledge-hub]` in `config.toml`, plus `hooks/knowledge-hub.json` with
    PreToolUse and Stop only. Grok ignores what SessionStart and UserPromptSubmit print.
  - Codex: `[mcp_servers.knowledge-hub]` in `config.toml`.
  - Gemini: `mcpServers.knowledge-hub` in `settings.json`.
  - Only KH's own entry is touched, and `--remove` takes out exactly that entry.
- **`kh hook EVENT --cli grok`:** Stop answers `{"decision":"block","reason":...}` on stdout. It skips
  Grok's session-end Stop (`reason != end_turn`) and a Stop that is already continuing
  (`stopHookActive`).
- **Refusals:**
  - Claude Code never sets up another CLI's copy.
  - Another CLI never sets up Claude Code's copy.
  - A copy outside every known profile is refused, with a pointer to /auth/help.
- **Backups:** backups are now `<file>.kh-bak-<time>` for every CLI, and `kh uninstall` deletes them.
  On a borrowed computer they would still name KH.
- **Tests:** `tests/test_kh_helper_clis.py`, 19 checks. The older helper tests still pass.
- **Real Grok 1.0.41 on this machine:**
  - `kh setup` from `~/.grok/kh-helper`, then `grok mcp doctor`: command found, server started,
    handshake OK, 5 tools.
  - `kh uninstall`: helper folder and hooks file gone, `grok mcp list` empty, `config.toml` content
    back to before.
  - This run left 2 `config.toml.bak-*` files, which led to the backup cleanup above.

## Keycloak, same day: people who use KH cannot use Keycloak

fen: Keycloak administrators and KH users must be two different kinds of account.

**Audit, through a temporary master admin client created by a CF task and deleted afterwards:**

- **master realm (Keycloak admins):**
  - `rowan.hoang@laidon.com`: `admin` role and a password. This is the only administrator.
  - `nghiephoang2905@gmail.com` and `rowan.hoang@simplemdg.com` also exist here, with no role, no
    password and no identity provider, so they could not sign in. Both are now disabled.
  - master has no identity providers.
- **knowledge-hub realm (KH users):**
  - Nobody holds any `realm-management` role, so no KH user can open the admin console.
  - Every user got `account:manage-account` and `account:view-profile` through the default roles.
    That meant any KH user could sign in to Keycloak's Account Console and edit their own profile.
  - Those two roles are now removed from `default-roles-knowledge-hub`, and client
    `account-console` is disabled.
- **Verified:**
  - A KH user still signs in and `GET /auth/me` answers on prod.
  - An Account Console sign-in now answers `400 Client disabled`.
- **Kept for re-runs:** `configure_realm.py` (Keycloak repo) now applies the same thing in
  `ensure_no_account_console`.

**Incident during the audit:**

- The first temporary-admin task ran with an EMPTY secret. The secret generator failed under
  PowerShell ConstrainedLanguage and the command did not stop.
- For about 3 minutes, `kh-tmp-admin` in master accepted `client_credentials` with an empty secret.
- It was found by testing exactly that, deleted at once, and re-checked (401).
- Admin events are off, so nobody can prove whether it was used in that window.
- The task was redone with a secret generated in Python and checked to be 48 characters before the
  task ran.

## The use case (fen)

A person signs in on a borrowed computer A, then gives it back. They uninstall so that A's owner
cannot run setup and read KH as them. Then they sign in on computer B as usual. Uninstall must clean
A without taking away the person's access.

- **Only A's sign-in ends.** In Keycloak's `TokenRevocationEndpoint.revokeClientSession()` (local
  source, C:\Workspaces\Keycloak), revoking an offline token removes the client from the ONE offline
  session named by the token's `sid`, plus that session's online half. Sessions from other computers
  have their own `sid` and keep working. The account and its grants are untouched.
- **The browser SSO on A ends too.** Before the revoke, a dev `kh login` on this machine finished at
  once through the live Keycloak browser session. After `setup --remove` a new login waited at the
  sign-in page (20 s, then stopped).
- **Left on A, outside the helper:**
  - The company Google or Microsoft session in the browser.
  - Claude Code's own chat history, which holds what KH returned during the chats.
  - The guide tells the assistant to mention both in plain words.
- **Not access control.** Who may use KH is still decided at Keycloak by disabling or removing the
  person.
