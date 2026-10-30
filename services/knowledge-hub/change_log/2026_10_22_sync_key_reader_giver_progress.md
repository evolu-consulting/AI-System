# 2026-10-22 - a sync key is a reader role, verified by the giver; the giver sees the pull

## A key is a reader role

| Change | What it does | Where |
|---|---|---|
| Members may sync with a key | `/sync/me`, `/sync/connect`, `/sync/pull`, `/sync/jobs*` are open to any KH user; keys, local list, accounts and grants stay maintainer-only. `/home` shows a member Receive and their own jobs only. | `app/auth_rules.json`, `sync.list_jobs`, `sync.own_job`, `static/home.html` |
| The giver verifies the key | New peer route `POST /sync/peer/verify`: the giver matches the WHOLE key to a stored one, never by its name (row found by the secret hash, the whole key rebuilt from it and compared exactly, active; every peer route checks keys this way) and answers with what THAT stored key allows (role `reader`, resolved project list). The receiver lets a member in only on this answer, never on the key string. | `sync.verify`, `sync.verify_key`, `sync.connect`, `sync.pull` |
| Read where key and list match | A member pulls only projects that are ticked and on the giver's verified list; never the orchestrator or another person's personal project. Each pulled project gives the member `project.read` here. | `sync._not_for_reader`, `sync.pull` |
| Grant kept in KH | The person's token cannot grant itself a level at the identity service, so KH keeps the grant (`sync_grants`) and the auth middleware adds `project.read` for it, read only, cached 30 s per instance. Maintainers list and remove grants on New accounts. | `sync.grant_reader`, `sync.reader_projects`, `auth.with_key_reads`, `GET /sync/grants`, `POST /sync/grants/remove` |
| No people from a member's pull | A member's pull applies no member list from the giver. | `sync.pull` |
| Read only, never owner | A project new on the receiver from a member's pull is made in that KH only, not registered at the identity service: the member gets read through the key, no owner level, and no clash with an id the identity service already holds (two KHs on one realm). Keys made before this change work the same way. | `sync.merge_project(register=False)` |

## The giver sees the pull

| Change | What it does | Where |
|---|---|---|
| Receiver reports | The running job posts its state, progress and plan to the giver's `POST /sync/peer/progress` with the same key: at the start, at most every 2 s, and at the end. Best effort, one try, 10 s timeout; a 4xx (older giver) stops further reports for that job. | `sync.Remote.tell`, `sync.report_progress`, `sync.run_rows` |
| Giver keeps and shows it | `sync_given` per job, bound to the key that first reported it; fields and sizes cut on the way in. `GET /sync/given` lists them; Give (keys) shows "Pulls from this KH" with progress bars, polling every 1.5 s while one runs. A running pull silent for 5 minutes is shown as "no news". | `sync.record_given`, `sync.list_given`, `static/home.html` |

Both KHs need this version: an older giver cannot verify (members are refused, maintainers pull as before) and does not show progress; an older receiver does not report.

## Deploy keeps hand-set env vars

| Change | What it does | Where |
|---|---|---|
| Env vars survive a deploy | Applying `manifest.yml` removed `KH_ACTING_ISSUERS` (set by hand with `cf set-env`) on the 2026-10-23 deploy; it was set back by hand before the start. `push.ps1` now reads the app's env vars before the push and puts back, right after `cf push --no-start`, every one the manifest removed (`KH_API_KEY` stays managed by the script). To drop a var for good, `cf unset-env` it before deploying. | `deploy/btp/push.ps1` |
