# 2026-10-06 - Messages reach the session on their own project (kh-helper 1.10.0)

| Release | What changed | Where it runs |
|---|---|---|
| kh-helper 1.10.0 | The prompt hook asks for messages of the project the session works on, not of every project. | helper only; KH server unchanged |

## What was wrong

Feedback from prod: user A sends user B a message in project A. B has two Claude Code sessions open on
one machine, session 1 on project A, session 2 on project B. Session 2 prompted first and showed the
message; session 1 never did.

Cause: the UserPromptSubmit hook called `POST /messages/inbox` with an empty body, which returns every
unread message in every project the caller may read and marks them read. Reading is delivery, so the
first session of the person to prompt took them all, whatever project it was on.

## What changed

- The hook asks `/turn/context` first and takes its project match for the prompt. It then calls
  `/messages/inbox` with `{project}`. The server already supported that body; it is unchanged.
- A prompt that names no project ("go on") keeps the project the same session last named. The helper
  remembers it per CLI session id in `<helper home>/session-projects.json` (newest 200 sessions,
  30 days).
- A session with no project yet asks for nothing. Its messages wait on the stack for a session on
  their project.
- `kh_context("UserPromptSubmit", project)` takes the project for CLIs without hooks. Without one it
  delivers nothing.
- `kh message inbox` by hand still reads every project.

## Limits

- The project comes from the literal project match of `/turn/context`. A session whose prompts never
  name the project literally (the model maps it by meaning) has none, and gets no messages until a
  prompt names it.
- Helpers older than 1.10.0 still call the inbox for every project. Each person must update.

## Checks

`tests/test_kh_helper_clis.py`: 6 new checks (only the prompt's project is asked; another project's
session gets nothing; a session keeps its project across prompts; each session keeps its own; no
project asks for nothing; no session id uses only the prompt). Before 26 ok, after 32 ok. The other
helper and message suites: same counts before and after (turn 26, messages 23, turn-read 11, quiet 14,
startup 7).

## Prod rollout (2026-10-06)

- Deployed `kh-btp-hana` at `5ecb571` to `knowledge-hub` (`push.ps1 -HanaService kh-hana-v2 -AuthIssuer ...`).
  `/auth/config` names `kh_helper-1.10.0`; the served wheel holds the new hook. `/health` ok, `/projects`
  without a token 401. Server code unchanged, so no data backup was needed; rollback = redeploy `7ad7d89`.
- e2e multi-user on prod: 73/73.
- Live check on prod with the served wheel and test accounts (two throw-away projects, deleted after):
  A sends B a message in alpha; B's session on beta shows nothing; B's session on alpha shows it; a
  second prompt does not show it again. 7/7.
- Each person updates with the update-only path in `/auth/help` (kh-helper 1.10.0).
