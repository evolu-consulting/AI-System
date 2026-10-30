# Session project binding: worklogs follow the session, not each prompt's keywords (2026-10-24)

## Why

The project of a worklog was matched on every prompt by keyword: 'tool' went to kh-tools, 'message' to
ai-communication, 'design' to designer. One day of DLC design work landed in four projects and none in
ai-sdlc, so another machine of the same account could not find it (measured 2026-10-24, about 25% recall).

## How (Rowan's design)

- **The key.** Each session has one project, kept with the account's personal project. The key is the session
  id (`X-KH-Actor`, change log 2026_10_24_session_actors). Table `kh_session_binding` (owner = personal
  project of the signed-in account, actor, project, source, bound_at, last_seen) is relational data, not a
  vector row, because last_seen moves on every call.
- **Bind.** The first prompt of an unbound session binds the project it names by id or alias (`detected`). A
  keyword alone never binds; the turn context then tells the assistant to bind by meaning.
- **Use.** A worklog write (`POST /vector/add`, scope log) carrying the session id is stored in the bound
  project, whatever the body names. The auth middleware rewrites the body before the permission check. When
  the caller may no longer log to the bound project, the body decides as before. Non-log writes are untouched.
- **Turn context.** It names the bound project ("BOUND TO THIS SESSION") instead of a per-prompt match. When a
  prompt names another project, the context mentions it and says to switch only if the person asks.
- **Switch.** `PUT /session/project {project}`, called by the assistant only when the person asks to work on
  another project (`asked`; needs project.log there). `GET` reads the binding, `DELETE` unbinds.
- **Keep.** Every call with the session id refreshes last_seen (at most every 10 minutes). A binding idle for
  more than `KH_SESSION_BINDING_TTL_HOURS` (72) reads as absent at once. A call never revives an expired one.
- **Sweep.** `POST /session/sweep` (maintainers and the worker token) deletes idle bindings. The distill
  sidecar runs it every night at `KH_WORKER_SESSIONS_AT` (02:00, `KH_WORKER_TZ`). It needs no model; a dry
  worker only reports it. `python -m kh_worker sweep-sessions` runs it by hand.

## Needs

kh-helper 1.18.0 (it sends the session id). Older helpers send none, and their worklogs are matched as before.

## Code

- `app/session_project.py` (new), `app/auth.py` (middleware hook; ActorMiddleware now runs first),
  `app/turn.py`, `main.py`, `app/config.py`, `app/auth_rules.json`.
- `worker/kh_worker/main.py` (`SessionSweepSlot`, `sweep_sessions`, `sweep-sessions`), `khclient.py`.
- Tests: `tests/test_session_project.py` (new, 29), `worker/tests/test_sessions.py` (new, 4).
