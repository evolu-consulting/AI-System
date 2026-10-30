# 2026-09-25 - SSO sign-in and per-project access control

fen's pending enhancement of 2026-09-24 ("SSO sign-in with roles and per-scope access control"),
built together with a Keycloak fork on SAP HANA. With `KH_AUTH_ISSUER` unset nothing changes.

## What changed

- **`app/auth.py` (new).** Pure ASGI middleware: verifies the Keycloak access token (signature via
  the realm's JWKS, issuer, audience `kh-api`, expiry), turns its `kh` claim into a `Principal`, and
  checks the permission each route needs against the project the request touches. 401 without or
  with a bad token, 403 without the permission. The caller and its token are kept in context vars
  for the length of the request only.
- **`app/auth_rules.json` (new).** One row per route: kind (public, authenticated, project, kh,
  maintainer), permission, where the project id comes from, default project. Deny by default: a
  route missing here is maintainer-only.
- **Fan-out narrowed.** `vector_store.scope_collections_all`, `hotlog.read_lane`, the project list,
  the registry list, `project_match`, `/orchestrator/resolve` and `/policy/actions/projects` only
  show projects the caller may read. `_read_lanes` and `/log/recent` refuse a named project the
  caller cannot read.
- **Hot log window per person.** Hot rows carry `author`; `hotlog.slots/enforce` work per author;
  spilling checks the author's `project.log` and drops rows for a project they lost; `/log/recent`
  and `/log/window` show the caller's own window.
- **Projects registered at Keycloak.** `POST /projects` for a new id registers it with the caller as
  owner first (relaying the caller's own token) and withdraws the registration if the local create
  fails; an existing id needs `project.write`. `DELETE /projects/{id}` asks Keycloak first, which
  re-checks `project.delete`.
- **Routes:** `GET /auth/help`, `GET /auth/config` (public), `GET /auth/me`.
- **Config:** `KH_AUTH_ISSUER`, `KH_AUTH_AUDIENCE` (`kh-api`), `KH_AUTH_CLIENT_ID` (`kh-cli`). The
  shared `KH_API_KEY` gate only applies when sign-in is off.
- **`deploy/btp/push.ps1 -AuthIssuer <url>`** deploys with sign-in on and removes the API key.
- **`tools/kh-helper` (new).** `kh login|logout|status|me|call|mcp`: device-flow sign-in, refresh
  token in the OS credential store, calls for assistants without exposing tokens.
- **Helper download, no sign-in.** `deploy/btp/push.ps1` builds the kh-helper wheel into `downloads/`;
  `GET /auth/download/<wheel>` serves only that file, and `/auth/help` and `/auth/config` carry the
  `pip install <url>` link built from the forwarded host.
- **Hooks through the helper (kh-helper 1.1.0).** `kh hook <event>` replaces the old
  `curl http://127.0.0.1:9000/hooks/raw?...` hooks (same outputs: SessionStart text, PreToolUse
  additionalContext JSON, Stop exit 2 unless stop_hook_active), signed in as the person. `kh setup`
  adds them to Claude Code's settings.json beside existing hooks (backup, idempotent, `--remove`)
  and registers the MCP server with `claude mcp add -s user`; `kh login` offers it. For CLIs
  without hooks the MCP server carries the SessionStart rules in its instructions and offers
  `kh_context(event)`.
- **Dependency:** `PyJWT[crypto]==2.10.1` (MIT; cryptography Apache-2.0/BSD).
- **Fix, unrelated to sign-in:** `app/graph_db/__init__.py` imported `HANA_HOST`/`HANA_PORT` from
  `hana_adapter`, which stopped defining them in the 2026-09-24 change; KH would not start with
  `GRAPH_BACKEND=hana`. They now come from `app.config`.

## Checks

- `tests/test_auth.py`: 34 checks, 0 failed (help page and download included).
- Existing suites unchanged against the baseline taken before the change: test_db_config 39/39,
  test_layers 16/16, test_policy_actions 55/55, test_project_match_weak 7/7, test_project_registry
  27/27, test_turn_mutated all pass, test_vector_delete 31/31. test_hotlog failed the same two
  checks before and after (pre-existing).
- Live, BTP br10: Keycloak e2e 21/21 (three runs); Keycloak + KH (`kh-sso`) e2e 29/29 including the
  helper's refresh, call, 403 pass-through and revoke.

## Later the same day: the helper lives in the CLI profile (kh-helper 1.2.0)

fen wanted the helper installed in the folder of the profile that uses KH, and a blank Claude able
to do the whole setup itself, installing Python when it is missing.

- **Home.** `KH_HELPER_HOME` if set; else, for a helper in its own virtual environment, that folder
  (the documented install is `<profile>/kh-helper`); else the old `~/.kh`. `helper.json` lives there
  and `kh status` reports it as `home`.
- **One sign-in per home.** The credential-store entry is `<kh_url> <home>`; the old `~/.kh` keeps
  the old entry name `<kh_url>`, so an existing machine-wide sign-in still works.
- **`/auth/help` rewritten for an assistant to follow:** step 0 checks for Python 3.10+ and installs
  it without an administrator (winget user scope on Windows, brew, apt); then venv inside the profile,
  pip install from KH, login run in the background with the person finishing the browser page,
  setup, restart the CLI, status/me to check. The login link is flushed at once so a background run
  shows it.
- **Checks:** `tests/test_kh_helper_home.py` 11/11 (new); `tests/test_auth.py` 36/36 (two new
  help-page checks).
- **The guide is data, not code (fen's call).** The `/auth/help` text moved out of `app/auth.py` into
  one orchestrator knowledge row (id `kh-guide-auth-help`, metadata `doc=auth-help`). Its default is
  `seeds/auth_help.seed.txt`; every start (so every deploy) seeds the row when it is missing and never
  overwrites an edited one. Maintainers replace it with `PUT /auth/help {"text": ...}`, no redeploy.
  `{source}`, `{kh_url}` and `{issuer}` are filled per request by plain replacement, so other braces
  in an edited text are safe. The row is read by id (the HANA adapter would filter metadata in Python
  over the whole collection). Seeding runs only where sign-in is on.
- **kh-helper 1.2.1:** `kh login` run by an assistant in the background crashed after a successful
  sign-in (EOFError on the "set up now?" question, exit 1); it now skips the question.
- **Checks:** `tests/test_auth.py` 45/45 (seed, no-overwrite, maintainer-only edit, filled values);
  other suites unchanged (db_config 39/39, layers 16/16, policy_actions 55/55, project_match_weak 7/7,
  project_registry 27/27, vector_delete 31/31). Live on kh-sso: an empty profile installed 1.2.0 from
  the help page, signed in with Google, `setup` wrote hooks pointing into the profile, `claude mcp list`
  showed knowledge-hub connected, and the machine-wide sign-in and fen's own profile were untouched.

## 2026-09-26: sign-in without a code or a consent screen (kh-helper 1.3.0)

Testing showed people finish the Google page and stop: the device grant then waits on a second page,
"allow Knowledge Hub helper", and their sign-in never completes. Keycloak always shows that page for
the device grant (AuthenticationManager, following RFC 8628 section 5.4); no setting removes it.

- **`kh login` now uses authorization code + PKCE on a loopback port**, the way `gh` and `gcloud` sign
  in: the browser page hands the sign-in back to the helper at `http://127.0.0.1:<free port>/callback`,
  the `state` is checked and the code is exchanged with the PKCE verifier. One page, no code, no consent.
- **`--no-browser` keeps the device grant** for machines without a browser (one extra Yes there).
- **Keycloak client `kh-cli`** (`configure_realm.py`, Keycloak repo): standard flow on, PKCE S256
  required, redirect `http://127.0.0.1/callback` (Keycloak ignores the port of a 127.0.0.1 redirect),
  consent off, device grant still on.
- **Guide:** the sign-in sentence no longer mentions clicking Yes; step 2 explains `--no-browser`.
- **Checks:** `tests/test_kh_helper_home.py` 17/17 (5 new: loopback redirect with PKCE S256, verifier
  matches the challenge, refresh token stored, forged `state` refused). Live on kh-sso: signed in as the
  member test account with one Google page.

## 2026-09-26: two-person end-to-end run, and three name leaks closed

`deploy/btp/e2e_multi_user.py` (Keycloak repo) runs the story with two password test people A and B
against the live deployments: A creates a project and writes in it; B asks without and with naming it;
A adds B readonly, editable, owner, then removes B; B makes a project of their own; both delete.

First run 47/50. Nothing of A's text leaked, but project NAMES did:
- **Unscoped knowledge reads** (`/vector/scroll`, `/vector/query`, `/vector/topics`) listed every
  project's registry row: the orchestrator keeps one row per project (id, aliases, keywords) in its
  knowledge, which every member may read. `auth.row_visible()` now hides a registry row (by `kind` or
  by its `project_registry__` id) unless the caller may read that project; `topics_vt` takes a `keep`
  predicate so hidden rows are not counted either.
- **`/log/window`** still listed a project B had been removed from (B's own rows there); its slots are
  now limited to projects the caller may read, like `/log/recent`.

Second run 50/50. By design, a token issued before a grant is removed keeps working until it expires
(at most 5 minutes). `tests/test_auth.py` 51/51 (6 new).

## 2026-09-26: deleting a project also clears it from the shared stores

`delete_project` dropped the project's own collections but left two things in stores every project
shares: its worklogs still sitting in the hot log window, and its C4 registry row in orchestrator
knowledge. Found by the two-person e2e run (a maintainer still saw worklogs of deleted test projects);
both are now deleted with the project. e2e checks 8.6/8.7; 67/67 on dev. Leftover rows of earlier
test projects (`zz-*`) were removed from dev and production.

