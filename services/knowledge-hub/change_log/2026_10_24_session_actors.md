# Sessions as actors: one account, several CLI sessions (2026-10-24)

## Why

A person often runs several Claude CLI sessions on one KH sign-in, as an agent's real people share one
technical user. KH could not tell the sessions apart: a log did not say which session wrote it, and a message
to oneself went to whichever session asked first, often the one that sent it.

## How

Pattern: XMPP resource binding (RFC 6120). The account is the bare address, each session a resource of it
(`user@domain/resource`); a message to the full address reaches one connection.

- **The id.** Each call names its session in `X-KH-Actor` (letters, digits, `_.:-`, at most 128). It is a
  label inside one account, never a right: no access decision reads it, and a session may claim any id of its
  own account. It works with sign-in off too (`ActorMiddleware`).
- **Write.** `/vector/add` stamps `metadata.actor` from the header only; a body value is dropped. It sits
  beside `acting_user` (technical users), which still decides who may read a worklog.
- **Read.** Unchanged: every session reads everything of its account.
- **Messages.**
  - A message records `sender_actor`; a direct message may name `to_actor`.
  - `to_actor` alone (no `to`) is another session of the own account. Naming the own session is 400.
  - A message for one session reaches only that session.
  - A message never comes back to the session that sent it: a note to the own account, or a mention of
    oneself in a project channel, goes to another session of the account.
  - A message for no session goes, as before, to whichever session asks first.
  - The mailbox lists every message to every session, with `sender_actor` and `to_actor`. Reading it marks
    only what is for the reading session, so it never swallows another session's message.
- **Finding a session.** Each `POST /messages/inbox` records the asking session with its project and
  `label` (the helper sends the working folder). `GET /messages/actors` lists the account's sessions seen
  within `KH_MESSAGE_ACTOR_TTL_HOURS` (24), `me` marking the caller. The message cron forgets older ones.

## kh-helper 1.18.0

- Every call sends `X-KH-Actor`. The id comes from, in order:
  - the hook's own input, or the turn a worklog job logs (never the worker's own);
  - `KH_ACTOR`;
  - the latest id a hook saw for the same CLI process (`CLAUDE_PID`, file `session-actors.json`), because
    `/clear` and `/resume` change the id while the MCP server keeps its first environment;
  - `CLAUDE_CODE_SESSION_ID`.
- `kh_message(content, to_actor=id)`. The MCP instructions point to `GET /messages/actors`.

## Code

- `app/auth.py`: `ACTOR_HEADER`, `ACTOR_KEY`, `actor_of`, `current_actor`, `ActorMiddleware`.
- `main.py`: the write stamp in `/vector/add`.
- `app/messages.py`: migration 4 (`sender_actor`, `to_actor`, table `message_actors`), `_reaches`,
  `note_actor`, `actors`, `GET /messages/actors`. `app/auth_rules.json`, `app/config.py`.
- `tools/kh-helper/kh_helper/session.py`, `hooks.py`, `worklog.py`, `mcp_server.py`.
- Tests: `tests/test_messages.py` (+19), `tests/test_acting_user.py` (+10), `tests/test_kh_helper_actor.py` (new, 16).

## Fan-out (later on 2026-10-24, Rowan)

- **A message to the account reaches every session.** A message naming no session notifies every running
  session of the account, once each. Before, the first session to ask took it from the others.
  - The receipt is per session: reader `<e-mail>#<actor>`. A caller naming no session keeps the plain e-mail.
  - A session is not flooded with the past. A message older than the session's first inbox call
    (`message_actors.first_seen`, migration 5) is not handed to it again when another reader of the account
    already had it.
- **`to_actor` is a filter, not ownership.**
  - It narrows only who is notified; the message still belongs to the account.
  - Every session reads the whole mailbox. Each message carries `sender_actor`, `to_actor` and `read_by`.
  - Reading the mailbox marks only the reading session.
  - The MCP instructions tell the assistant to read `GET /messages/mailbox` when the person asks for all
    messages.
- Tests: `tests/test_messages.py` (+9 fan-out and filter checks).
