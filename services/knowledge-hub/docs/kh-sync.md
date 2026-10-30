# KH-to-KH sync (`/home`)

Copies projects from one Knowledge Hub to another in code, with no LLM copying items. Module: `app/sync.py`,
page: `app/static/home.html`, tests: `tests/test_sync.py`.

## Why keys

The two KHs usually sign people in with different Keycloaks, so neither can trust the other's tokens. Trust
comes from a **connection key** that the giving side makes and hands over out of band.

## Steps

1. **Giver.** A maintainer opens `https://<giver>/home`, signs in and goes to **Give (keys)**. They set a label,
   how many days the key is valid (1–90), the address the receiver can reach, and optionally which projects
   the key may take. Then they press **Make key** and copy the key, which is shown once. The giver stores only
   its SHA-256 hash and can revoke the key at any time.
2. **Receiver.** A maintainer (or any KH user holding the key, see below) opens `https://<receiver>/home`, signs in, pastes the key under **Receive** and
   presses **Connect**. The two KHs compare the protocol, embedding model, dimension and a probe vector. If any of
   these differs, the receiver refuses with 409 and copies nothing.
3. The receiver ticks projects and, for each one, the parts to copy: knowledge, log, findings, entity, chunk,
   policy, src. It can also set a time range (since/until, inclusive), whether to include undated rows, and
   whether to do a dry run. Then it presses **Start sync**.
4. **Sync jobs** shows each job with a % progress bar and a report per project and part. The job runs on the
   receiving KH and is stored in `sync_jobs`, so you can close the page and come back. If KH stopped while a
   job was running, that job is marked `interrupted` on the next start. **Stop** ends a job after its current
   page.

## What a key lets the receiver see

The giver picks projects, parts, a time window (rows from/until) and whether each project's member list
is shared. Nothing chosen means everything, member lists included. Member lists are read with the
maker's sign-in when the key is made and kept with it. Every peer call enforces the scope; the
receiver's own range is clamped inside the key's window.

## People

On a receiver with sign-in on:

- Someone who already has access to the project keeps it at the receiver's level, because the
  receiver's own users win.
- Someone with an account but no access gets the giver's level.
- A new person gets an account through the identity service (`kh.users.invite`).
- User/password accounts (never SSO) get a temporary initial password. It is set through Keycloak's
  admin API with the maintainer's own token, which needs realm-management `manage-users` in the
  maintainer's token. The password is listed on `/home > New accounts` until it is marked as sent.

A receiver with sign-in off shows the lists but applies nothing. Passwords never travel between KHs.

## Merge rules (update, never replace)

- **Project registry:**
  - a new project is created and registered to the person who pulls it;
  - an existing project gets the giver's aliases, keywords, tools and conflicts merged in;
  - the giver's descriptor is used only when the receiver's own descriptor is empty.
- **Rows, matched by id:**
  - **created:** the row is missing on the receiver;
  - **unchanged:** text and metadata are the same;
  - **kept:** the receiver's `ts` is newer;
  - **updated:** any other case, using the giver's text, metadata and embedding.
- Nothing is ever deleted. A log row still in the receiver's hot window is updated there.
- Personal projects are never offered.

## A key is a reader role (2026-10-22)

A key is the exception to "only maintainers sync". **Any KH user** of the receiver who holds a key may connect and
pull with it, and gets **project.read** on each project they pull.

1. **The giver verifies the key.** Before a member connects or pulls, the receiver posts the key to the giver's
   `POST /sync/peer/verify`. The giver matches the **whole key** to one of its **stored** keys, never by its name:
   it finds the row by the SHA-256 of the secret, rebuilds the whole key from that row (prefix, giver URL, kid) and
   requires it to equal the presented key exactly; the key must be active and not expired. It answers with what that stored key allows: role `reader` and the resolved project list.
   The key string carries no rights; the receiver trusts only this answer.
2. **Read only where both match.** A member may pull a project only when it is ticked **and** on the giver's
   verified list. The orchestrator and another person's personal project stay maintainer-only.
3. **The grant lives in KH.** The person's own token cannot grant them a level at the identity service, so KH keeps
   the grant in `sync_grants` and the auth middleware adds `project.read` for it (`auth.with_key_reads`). It never
   adds write, people or delete rights. A project new on the receiver is made there only and **not** registered
   at the identity service, so the member stays read only on it (no owner level), and it cannot clash with an id
   the identity service already holds when both KHs share it. Keys made before this change work the same way.
4. **A member's pull applies no member list** (that needs the right to manage people here).
5. A member sees only their own jobs on `/home`; maintainers see all, and list or remove the grants under
   **New accounts > Read access from sync keys** (rows already copied stay).

A giver on an older KH cannot verify: a member's connect is refused with 403; a maintainer pulls as before.

## The giver sees the pull (2026-10-22)

While a job runs, the receiver posts its progress to the giver's `POST /sync/peer/progress` with the same key: once
at the start, at most every 2 s after a page, and once at the end. The giver keeps it in `sync_given` (a job stays
bound to the key that first reported it) and shows it on **Give (keys) > Pulls from this KH** with a progress bar,
the key, who pulls and from where. A running pull with no news for 5 minutes is shown as "no news". Reports are best
effort: a failed one never stops the pull, and an older giver that answers 4xx is not asked again.

## Routes

| Side | Route | Access |
|---|---|---|
| both | `GET /home`, `GET /home/config`, `POST /home/login/{start,poll,refresh}` | public (device sign-in proxied to Keycloak, client `KH_AUTH_CLIENT_ID`) |
| both | `GET /sync/me` | any KH user (says whether the caller is a maintainer) |
| giver | `POST/GET /sync/keys`, `DELETE /sync/keys/{kid}`, `GET /sync/local`, `GET /sync/given` | maintainer |
| giver | `GET /sync/peer/hello`, `GET /sync/peer/manifest`, `POST /sync/peer/export`, `POST /sync/peer/verify`, `POST /sync/peer/progress` | the key, in header `X-KH-Sync-Key` |
| receiver | `POST /sync/connect`, `POST /sync/pull` (202), `GET /sync/jobs`, `GET /sync/jobs/{id}`, `POST /sync/jobs/{id}/cancel` | any KH user; a member on a key the giver verifies, own jobs only |
| receiver | `GET /sync/accounts`, `POST /sync/accounts/{email}/sent`, `GET /sync/grants`, `POST /sync/grants/remove` | maintainer |

With sign-in off (`KH_AUTH_ISSUER` empty, development), `/home` opens without signing in and acts as the
local maintainer.
