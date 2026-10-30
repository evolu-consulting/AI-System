# Sign-in and per-project access

KH on BTP needs a signed-in person, and what that person may do is decided per project. This is
the enhancement "SSO sign-in with roles and per-scope access control" (decisions D1-D13 of
2026-09-24, refined with fen on 2026-09-25). A local install without `KH_AUTH_ISSUER` is unchanged.

## The pieces

| Piece | Where | Job |
|---|---|---|
| Keycloak (fork with SAP HANA) | `kh-keycloak` app, the Keycloak repo | Signs people in through Google or Microsoft Entra; keeps roles and per-project grants; issues tokens |
| KH | this repo, `app/auth.py`, `app/auth_rules.json` | Checks every request against the token; holds no permission data and no credential to it |
| kh-helper | `tools/kh-helper` | Installed inside each CLI profile folder (`<profile>/kh-helper`, its own virtual environment): `kh login`, keeps that profile's sign-in in the OS credential store and its settings in the same folder, calls KH for assistants (CLI and MCP). Since 1.4.0 a sign-in answers only the CLI and profile that made it (see below) |

## Who may do what

- **KH-wide role** (Keycloak realm role): `maintainer` - everything, everywhere; `member` - only
  projects they created or were added to, and may create projects.
- **Per project, per person**: `owner` (content, people, delete), `editable` (content only),
  `readonly` (read, no worklogs). The creator of a project is its owner.
- **orchestrator** is a system project: every member reads it, only maintainers change it. A
  request that names no project touches the orchestrator.
- **Kinds of account** (since 2026-09-28, by Keycloak group): `system-admin` (maintainer in KH and
  admin of Keycloak), `tenant-admin` of `/tenants/<company>` (manages that company's people in the
  admin console; owner level on every project created by someone of the company), `kh-users` (KH
  only; no admin console, no account console). The live list, with each kind's rights, is
  `GET /realms/knowledge-hub/kh/catalog` (`kh catalog`).
- **Default levels**: a project may give one level to every user; `lesson-learned` (shared lessons and guides)
  is `readonly` for all, and its owners and editors change it.
- The rules are data: roles, levels and permissions are rows in Keycloak's `KH_AUTH_*` tables,
  and the permission each KH route needs is a row in `app/auth_rules.json`. A route missing
  from that file is refused to everyone but a maintainer.

## Project visibility: the project's own side (2026-10-09)

The token's levels are unchanged. Each project also has a visibility, kept by KH, that overrides
them for that project:

| Visibility | Who reads | Who changes content, logs, deletes |
|---|---|---|
| `private` (default) | as the token says | as the token says |
| `semi-public` | every signed-in person | only its owner and maintainers; an `editable` grant reads only |
| `public` | every signed-in person | every signed-in person |

- A new project is `private` unless `POST /projects` carries `"visibility"`. The owner or a
  maintainer changes it at any time with `PUT /projects/{id}/visibility {"visibility": "..."}`.
  Nobody else may, not even on a public project. Personal projects and the orchestrator are
  always private.
- Semi-public and public projects show up for everyone in `GET /projects`, `project_match` and
  every fan-out read; each entry of `GET /projects` carries its `visibility`.
- Stored in table `project_access` (hooks.db / HANA); a project without a row is private. Every
  check reads it through a cache of `KH_PROJECT_ACCESS_CACHE_S` seconds (default 5); an unreadable
  table counts as all private.
- Limit: people and deletion are re-checked by Keycloak against its own grants, so on a `public`
  project a member without the owner level still cannot add people or delete the project.
- Code: `app/project_access.py`, `Principal.can` / `visible_projects` in `app/auth.py`. Checks:
  `tests/test_project_access.py`.

## What a request goes through

1. No `Authorization: Bearer` header -> **401** with `"help": "/auth/help"`.
2. Signature, issuer, audience (`kh-api`) and expiry are checked against Keycloak's published
   keys -> **401** when any fails.
3. No `kh` claim (not registered, no KH role, or disabled) -> **403**.
4. The route's rule names the permission and where the project comes from (body, query, path).
   The permission must be in `kh.all_projects` or in `kh.projects[<that project>]` -> else **403**.
   What the caller writes about itself in the body counts for nothing.
5. Reads that name no project, project lists, `project_match` and `resolve` are narrowed to the
   projects the caller may read, so an invisible project leaks neither rows nor its name.

## Tokens and how long they last

- Access token: **5 minutes**, carries the `kh` claim, sent to KH.
- Offline refresh token: **up to 90 days**, kept by kh-helper in the OS credential store, sent
  only to Keycloak. `kh logout` revokes it. Disabling a person or removing a grant takes effect
  at the next refresh, within 5 minutes.
- Assistants never see either token. `GET /auth/help` (no sign-in) explains this to them.

## Projects and people

- `POST /projects` for a NEW id first registers it at Keycloak with the caller as owner, then
  creates it in KH; if the KH side fails, the registration is withdrawn. For an EXISTING id the
  caller needs `project.write` on it. The answer carries `token_refresh_needed`, and the helper
  fetches a new token so the next call already sees the project.
- `DELETE /projects/{id}?confirm=true` asks Keycloak first; Keycloak re-checks `project.delete`
  against current grants, so a token issued before the owner lost the right cannot delete.
- Adding, changing and removing people is done at Keycloak: by owners, tenant admins and
  maintainers through `PUT|DELETE /realms/knowledge-hub/kh/projects/{id}/members/{email}` with their
  own token (kh-helper `kh members`, MCP `kh_members`), and by maintainers in the admin console
  (Projects page). KH has no route that touches people.
- Adding an e-mail that has no account creates it (since 2026-09-28): in `kh-users`, in the tenant
  whose domain matches, otherwise in the inviter's tenant, with `kh.invited_by`. A person who exists
  but is disabled or has no KH role is refused, never revived.
- Seeing who is on a project (since 2026-09-29): anyone with `project.read` reads name, e-mail and
  level of every active person through `GET /realms/knowledge-hub/kh/projects/{id}/people` (kh-helper
  `kh members people`, MCP `kh_members(project, "people")`). Nothing about who granted what is shown;
  the full list (`.../members`) still needs `project.members.manage`. A member needs it to reach a
  colleague, e.g. to leave them a KH message (docs/message-stack.md).

## One sign-in per CLI

A sign-in belongs to the CLI profile where the person made it, and to no other program on the machine.

- **The guide** (`/auth/help`) names each CLI's own folder (Claude Code `$CLAUDE_CONFIG_DIR` or
  `~/.claude`, Grok `~/.grok`, Codex `$CODEX_HOME` or `~/.codex`, Gemini `~/.gemini`, otherwise ask),
  forbids reading or reusing another CLI's profile, helper or sign-in (and the old shared `~/.kh`),
  keeps `kh setup` to Claude Code (it writes Claude Code's settings) and tells other CLIs to register
  the MCP server `"<KH>" -m kh_helper.cli --kh-url <url> mcp` in their own configuration.
- **The helper enforces it** (`kh_helper/owner.py`, 1.4.0). The owner is recorded in `helper.json` at
  sign-in. Claude Code is recognised by `CLAUDECODE=1` plus a `CLAUDE_PID` that must be a real ancestor
  of the helper process, so a copied environment does not pass. A Claude Code sign-in refuses every
  other CLI and every other Claude profile; another CLI's sign-in refuses Claude Code. `status`, `me`,
  `call`, `mcp`, `hook` and `login` answer `Refused: ...` with exit code 3; `setup` runs only from
  Claude Code with the copy in its own profile; `logout` works from anywhere, since it only takes
  access away.
- **Limit.** A program running as the same OS user that forges the process tree or reads the
  credential store directly is not stopped; that needs a separate OS account per CLI. A helper started
  through a Git-Bash wrapper that detaches (msys `timeout`) loses the Windows parent chain and is refused.
- **Checks:** `tests/test_kh_helper_owner.py` (23), `tests/test_kh_helper_home.py`.

## The hot log window, per person

With sign-in on, every hot row carries its author, and the window's slots are counted per person:
each person's recent worklogs, read back by them alone through `/log/window` and through
`/log/recent` when no project is named. `/log/recent?project=<id>` returns every author's rows on
that project to anyone holding `project.read` there, each marked with its `metadata.author`.
A slot is delivered into a project's log only if its author still holds `project.log` there;
otherwise the rows are dropped. Reads of one project's log still include that project's hot rows
from everyone, for callers who may read the project.

## Personal projects: what each person told their assistant

Three kinds of project now carry three jobs:

| Project | Job | Who reads it |
|---|---|---|
| `orchestrator` | routes each person's request to the projects they may read | everyone (routing only) |
| `lesson-learned` | lessons and guides common to everybody (renamed from `knowledge` 2026-10-05) | everyone |
| `personal-<e-mail slug>` | the preferences and standing instructions one person gave their assistants | that person (and maintainers) |

- The id comes from the e-mail in the token: `rowan.hoang@simplemdg.com` -> `personal-rowan-hoang-simplemdg-com`.
- A `scope=personalization` write, scroll or query that names no project goes to the caller's own
  personal project. KH creates it on the first write.
- `GET /personalization/render`, the SessionStart text, shows only the caller's own rows.
- Access follows the e-mail, not a grant: the owner holds every permission on it, nobody else holds any
  unless their token has `all_projects` (maintainers). So there is no Keycloak record and no token refresh.
- `POST /projects` refuses any id starting with `personal-`, so nobody can claim someone else's.
- A maintainer may write into a named personal project (a migration).
- Sign-in off (the local install): unchanged, personalization stays the orchestrator's common store.
- Settings: `KH_PERSONAL_PREFIX` (default `personal-`), `KH_PERSONAL_SCOPE` (default `personalization`).
- Checks: `tests/test_personal.py`; e2e 3.9b-3.9e.

## Whose worklog is this

Every row written with sign-in on carries `metadata.author`, the e-mail from the writer's token.
The server sets it on every `/vector/add`; a value in the request body is overwritten, so nobody can
log under someone else's name. It stays on the row when the row spills into the project's log.

Maintainers read one person's work with `GET /log/by`:

| Param | Meaning |
|---|---|
| `author` | the person's e-mail (required, case-insensitive) |
| `since`, `until` | window `since <= ts < until`; ISO-8601 with an offset or epoch seconds |
| `project` | narrow to one project |
| `limit` | page size (default 500); `matched` is the true total |

"What did Hugh do on Friday", in Vietnam time:
`GET /log/by?author=logan59102@gmail.com&since=2026-09-25T00:00:00%2B07:00&until=2026-09-26T00:00:00%2B07:00`
(the `+` must be sent as `%2B`). It reads every project's log and the hot window, newest first.

Rows stored before sign-in, or copied from an older store, have no author and are invisible to
`/log/by` until a maintainer names one with `POST /log/backfill-author`
`{"author": "...", "projects": ["..."], "apply": false}`. It is a dry run unless `apply` is true,
works on the named projects only, and only on rows that have no author yet.

Both routes are maintainer-only. `/log/recent` without a project stays the caller's own window,
for everyone; with a project named it lists the whole project's recent log.

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `KH_AUTH_ISSUER` | unset (off) | Keycloak realm URL, e.g. `https://kh-keycloak.cfapps.br10.hana.ondemand.com/realms/knowledge-hub` |
| `KH_AUTH_AUDIENCE` | `kh-api` | Audience a token must carry |
| `KH_AUTH_CLIENT_ID` | `kh-cli` | Public client the helper signs in with, returned by `GET /auth/config` |
| `KH_PROJECT_ACCESS_CACHE_S` | `5` | How long a process trusts its copy of the project visibility table |

With `KH_AUTH_ISSUER` set, `KH_API_KEY` is ignored. Deploy: `deploy/btp/push.ps1 -AuthIssuer <url>`.

## Routes added

- `GET /auth/help` - public, plain-text sign-in guide for people and assistants.
- `GET /auth/config` - public, where to sign in (issuer, client id, audience).
- `GET /auth/me` - what the caller's token allows.
- `PUT /projects/{id}/visibility` - private | semi-public | public, by the owner or a maintainer.
- `POST /messages`, `POST /messages/inbox`, `POST /messages/sweep` - the message stack (docs/message-stack.md).
- Keycloak: `GET /realms/knowledge-hub/kh/projects/{id}/people` - who is on a project, for its members.

## Checks

- `tests/test_auth.py` - the gate, the rule table covering every route, fan-out narrowing.
- `deploy/btp/e2e_keycloak.py` (Keycloak repo) and `e2e_kh.py` - live, with real tokens.

## The /auth/help guide

The text an assistant follows to connect is data: one orchestrator knowledge row (`kh-guide-auth-help`).
The default lives in `seeds/auth_help.seed.txt` and is seeded at start-up when the row is missing; an
edited row is never overwritten. Change it without a redeploy:

    kh call PUT /auth/help '{"text": "<the whole new guide>"}'      (maintainers only)

`{source}` (the helper download link), `{kh_url}` and `{issuer}` are filled in when the page is served.


## Policy: members change only their own projects

A member edits, adds or deletes policy only inside a project where they hold `project.write`. The
common tier (`every project`, which is what a write without `project` means) and the orchestrator
need write access on the orchestrator, which members never have, so those writes answer 403; hooks
are maintainer-only. When a project rule and a common rule exist for the same (action, sub_action),
`/policy/plan?project=<id>` serves the project's rule; every step the project did not override comes
from the common tier. Proven by `deploy/btp/e2e_multi_user.py` phase 9 (Keycloak repo).


## History: from an open KH to per-person sign-in

What KH's access control was at each step, oldest first. Details per step are in `change_log/`.

| Date | Commit | What changed | Change log |
|---|---|---|---|
| until 2026-09-22 | - | Local install only: one person, one machine, `127.0.0.1:9000`, no sign-in at all. Anyone who could reach the port could read and write everything. | - |
| 2026-09-23 | `4f33f0d` | Every store on SAP HANA and a cloud copy on BTP (`knowledge-hub`, schema `kh-hana`). Protected by ONE shared key, `KH_API_KEY` (`X-KH-Key` or `Bearer`), for every route except `/health`: whoever held the key was everyone. | `2026_09_23_hana_backends_and_btp_deploy.md` |
| 2026-09-24 | `bbab09f` | Every database setting from the environment, one switch for all stores. No access change. | `2026_09_24_db_settings_from_env.md` |
| 2026-09-25/26 | `4aecc26` | **SSO and per-project access.** Keycloak fork on HANA (`kh-keycloak`, realm `knowledge-hub`) signs people in with Google or Microsoft; roles `maintainer`/`member`; per-project levels `owner`/`editable`/`readonly`; every KH route checked against the token by `app/auth.py` and `app/auth_rules.json`; `KH_API_KEY` ignored once `KH_AUTH_ISSUER` is set. `/auth/help` guide kept as data. Hot window counted per person, `metadata.author` stamped by the server. | `2026_09_25_sso_sign_in_and_project_access.md` |
| 2026-09-26 | `1b12c61` | kh-helper installed per CLI profile; any CLI connects through the MCP server. | - |
| 2026-09-26 | `e1e49ff` | kh-helper 1.3.0: sign-in with one browser page (authorization code + PKCE on a loopback port); the device grant only as the no-browser fallback, because Keycloak always adds a consent screen to it. | - |
| 2026-09-26 | `3faa13f` | Unscoped reads no longer show other people's project names. | - |
| 2026-09-26 | `70e5267` | Members change policy only in their own projects; a project rule wins over the common rule. | - |
| 2026-09-26 | `f59c35f` | Deleting a project also clears its rows from the shared stores (hot window, registry). | - |
| 2026-09-26 | - | **Production switched to sign-in.** `knowledge-hub` now runs the multi-user KH on a new schema `kh-hana-v2`; the old `kh-hana` stays untouched as rollback; the shared API key answers 401. Hugh's six projects and their rows migrated with him as owner. Dev is `kh-sso`; both share the one Keycloak realm. Orchestrator data, common policy, hooks and personalization were NOT migrated: in a multi-user KH they would apply to every user. | - |
| 2026-09-26 | - | Hugh moved from `hugh.le@laidon.com` to Google sign-in `logan59102@gmail.com` (Entra dropped): new account, grants on all six projects moved, his hot-window rows re-authored. Grants are keyed by e-mail and the realm forbids editing usernames, so an e-mail change means a new account. | - |
| 2026-09-26 | `dcfc4b8`, `482b77c` | Guide: each CLI uses only its own profile and sign-in; what "Refused" means. Prompted by a Grok CLI that used Claude Code's live sign-in in `~/.claude` without logging in. | - |
| 2026-09-26 | `762967f` | kh-helper 1.3.1 (a machine-wide install keeps its state in the calling profile, never the shared `~/.kh`) and 1.4.0 (a sign-in answers only the CLI and profile that made it). | `2026_09_26_kh_helper_home_per_profile.md`, `2026_09_26_kh_helper_owner_lock.md` |
| 2026-09-26 | `5016cf1` | Maintainers read one person's worklogs: `GET /log/by`, `POST /log/backfill-author`. | `2026_09_26_worklogs_by_author.md` |
| 2026-09-28 | `4254d02` | `/auth/help` in plain words: one line per step, nothing hidden (an assistant had read "do the steps quietly" as "hide things from the person"). | `2026_09_28_kh_helper_remove_ends_sign_in.md` |
| 2026-09-28 | `4254d02` | kh-helper 1.5.0: `setup --remove` and the new `kh uninstall` revoke every sign-in of that copy and delete the helper and its backups, so a borrowed computer is left clean and its owner cannot run `setup` to come back in as the person. Only that computer's sign-in ends; the person keeps their access elsewhere. | `2026_09_28_kh_helper_remove_ends_sign_in.md` |
| 2026-09-28 | `4254d02` | kh-helper 1.6.0: `kh setup` connects Claude Code, Grok, Codex or Gemini, whichever profile holds the copy. | `2026_09_28_kh_helper_remove_ends_sign_in.md` |
| 2026-09-28 | - | Keycloak: KH users lose the Account Console (they sign in to KH and nothing else). | `2026_09_28_kh_helper_remove_ends_sign_in.md` |
| 2026-09-28 | Keycloak `42956801d8`, `8ec9b1e47b`; KH `4254d02` | **Tenants and three kinds of account.** `system-admin` (everything, Keycloak and KH), `tenant-admin` (admin console for their own company only; owner level on the projects created in it), `kh-users` (KH only). One tenant per company (`/tenants/<company>`). Adding an e-mail with no account to a project creates the account (kh-helper 1.7.0 `kh members add`). `GET /realms/knowledge-hub/kh/catalog` serves the access model live (`kh catalog`). Project `knowledge` is read by every user by default. HANA fork fix for fine-grained admin permissions. | `2026_09_28_tenants_and_account_kinds.md` |
| 2026-09-28 | Keycloak (this commit); KH kh-helper 1.7.1 | **Who may bring in a new person, as data.** Only holders of `kh.users.invite` (system-admin, tenant-admin) create an account when adding an unknown e-mail to a project; a plain owner adds existing people and gets 403 `account_required` with the tenant admins to ask. A tenant admin creates people only inside their own tenant. `tenant-admin` is now a KH role (realm role carried by `/tenants/<t>/tenant-admins`); every role has a `project_scope` (`all` or `tenant`), so what each role may do is rows in `catalog.json`, no code. Hugh (`logan59102@gmail.com`) made laidon tenant-admin. The Account Console is back, read-only (`view-profile` only), because "Client disabled" made members think sign-in had failed. | `2026_09_28_tenants_and_account_kinds.md` |
| 2026-09-28 | - (data) | Project `knowledge` holds the Workbeats log-work guide (process, API, helper), with hours logged as actually spent. | `2026_09_28_tenants_and_account_kinds.md` |
| 2026-09-28 | - (data) | **A common SessionStart hook** (`kh-access-model`, prod and dev) so an assistant on a fresh machine knows the access model from its first turn: read `kh_catalog` live, shared knowledge is in `knowledge`, add people with `kh_members` (default readonly), 403 is final, `kh_help` for connecting and uninstalling. Every user reads it; CLIs without hooks get it through the MCP server's instructions. Change it with `POST /hooks/set` (maintainers). | `2026_09_28_tenants_and_account_kinds.md` |
| 2026-09-29 | KH kh-helper 1.7.2 | **The Stop rule reaches Claude Code and `kh_call` exists in every start mode.** Stop blocks are stdout JSON with exit 0 (exit 2 made Claude Code read only stderr: "No stderr output"). `kh setup` registers the MCP server in `~/.claude.json` as well when the profile is the default `~/.claude`. Also, as data: prod and dev got the full hook set (kernel, read-log, prompt-guard, pre-action-check, store-log) and 365 lessons in project `knowledge`. | `2026_09_29_kh_helper_stop_json_and_mcp_config.md` |
| 2026-09-29 | KH `8ee2159`; kh-helper 1.8.0 | **Message stack.** Per-project messages between people and their assistants: sender from the token, delivery marks read and wraps each message in an information-only notice, the helper shows unread ones first on every prompt and adds nothing when there are none. A cron archives read messages, and `all` messages after 7 days; the archive is kept 100 days. Any member may send, readonly included. | `2026_09_29_message_stack.md` |
| 2026-09-29 | KH `b263299` (data) | `/auth/help` gets an ALREADY CONNECTED? UPDATE ONLY path, so updating the helper does not ask for a new sign-in. | `2026_09_29_message_stack.md` |
| 2026-09-29 | Keycloak `359519a7ee`; KH `8a0722c`, kh-helper 1.8.1 | **Members see each other.** `kh/projects/{id}/people` for anyone with `project.read`; `kh members people`; the guide and the SessionStart kernel explain "send this to <name>". | `2026_09_29_message_stack.md` |
| 2026-09-29 | KH `fa27cbd`, kh-helper 1.8.2 | The MCP server starts under Claude Code (a direct parent claude.exe counts, since an MCP server has no usable `CLAUDE_PID`). The Stop check is skipped on turns that only read, and the prod Stop rule is one line. | `2026_09_29_message_stack.md` |
| 2026-09-30 | - | `/log/recent?project=<id>` lists every author's worklogs on that project to anyone who may read it; personal projects: each person's personalization is private to them. | `2026_09_30_log_recent_project_all_authors.md`, `2026_09_30_personal_projects.md` |
