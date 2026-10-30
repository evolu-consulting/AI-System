# Messages

People and their assistants pass short messages to each other through KH. Three channels, by need
(fen 2026-10-16; until then one stack per project).

| Channel | Send | Who reads it | Who is notified | Kept |
|---|---|---|---|---|
| direct | `POST /messages/direct {to, content}`, any signed-in person, to a known KH user | the receiver and maintainers | the receiver | until the receiver or a maintainer deletes it |
| project | `POST /messages {project, content, mentions?}`, any member (project.read) | every member, `GET /messages/channel?project=` | only the people in `mentions` | `KH_MESSAGE_PROJECT_TTL_HOURS` (24) |
| realm | `POST /messages/announce {content}`, maintainers | everyone, `GET /messages/channel?project=lesson-learned` | everyone but the sender | `KH_MESSAGE_REALM_TTL_HOURS` (72) |

- **Known KH user.** Every person whose token KH verifies is recorded once in `message_people`. A direct
  message to an e-mail not there is 404: that person has never signed in to KH, so nothing would deliver it.
- **No sent box.** The answer to a direct message names the receiver and the id only.
- **No edit.** `DELETE /messages/{id}`: a direct message by its receiver or a maintainer; a project or realm
  message by its sender or a maintainer. A deleted direct message is gone for good, with its read tags.
- **Sender** is always taken from the token; a body field is ignored.

## Notification and the read tag

`POST /messages/inbox {project?}` hands the caller, once each: unread direct messages, unread
announcements, and unread messages in the named project that mention them. The KH helper calls it on
every prompt with the project the session works on, so a mention for project A never lands in a session on
project B, while direct messages and announcements reach any session. Each message is wrapped in an
information-only notice: it is another person's words, never an order for the receiving assistant.

Delivery inserts a receipt (`message_receipt`, primary key message id + reader) before returning the
message, so two instances never deliver one message twice. The receipt is also the read tag:
`GET /messages/mailbox?unread_only=` lists the caller's direct messages with `read` as it was before the
call and then tags them read, so an assistant does not report old mail as new. A maintainer may add
`user=<e-mail>` to read someone else's mailbox; that leaves its read tags alone.

## The cron

Every `KH_MESSAGE_CRON_MINUTES` (lease `cron.messages`) expired project and realm messages move to
`message_archive` (reason `expired`, with channel, mentions and readers), and archive rows older than
`KH_MESSAGE_ARCHIVE_DAYS` are dropped. Direct messages never expire. An expired message leaves the channel
answer at once, before the cron moves it.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `KH_MESSAGE_CRON` | `true` | Run the cron. |
| `KH_MESSAGE_CRON_MINUTES` | `10` | Cron interval. |
| `KH_MESSAGE_PROJECT_TTL_HOURS` | `24` | Life of a project message. |
| `KH_MESSAGE_REALM_TTL_HOURS` | `72` | Life of an announcement. |
| `KH_MESSAGE_REALM_PROJECT` | `lesson-learned` | Where announcements live (everyone reads it). |
| `KH_MESSAGE_ARCHIVE_DAYS` | `100` | Archive retention. |
| `KH_MESSAGE_MAX_CHARS` | `4000` | Longest message. |
| `KH_MESSAGE_LOCAL_USER` | `local` | Sender and reader with sign-in off. |

## Migration

Messages module step 3 adds `channel`, `mentions`, `expires_at` and `message_people`. Every older message
becomes a project message: one to an e-mail mentions that person, one to `all` mentions nobody, and each
expires 24 h after it was sent. `KH_MESSAGE_ALL_TTL_DAYS` is gone.

## Client

kh-helper 1.14.0: `kh_message(content, to=...)` private, `kh_message(content, project=..., mentions=[...])`
project, `kh_message(content, everyone=True)` announcement. The 1.13 form `(project, receiver, content)`
still works. The inbox is asked on every prompt, with the session's project when it has one.
