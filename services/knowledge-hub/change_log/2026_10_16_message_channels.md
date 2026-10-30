# 2026-10-16 - messages in three channels (KH, kh-helper 1.14.0)

| Change | What it does | Where |
|---|---|---|
| Direct messages | `POST /messages/direct {to, content}`: any signed-in person to a known KH user's mailbox. No sent copy; only the receiver and maintainers read or delete it; no edit; never expires. `GET /messages/mailbox` lists it with a read tag. | `app/messages.py` |
| Project channel | `POST /messages {project, content, mentions}`: every member reads it (`GET /messages/channel`), only the mentioned are notified, gone after 24 h. `receiver` still works and becomes a mention. | `app/messages.py` |
| Announcements | `POST /messages/announce {content}`, maintainers only: everyone is notified once, readable in the lesson-learned channel, gone after 72 h. | `app/messages.py` |
| Known users | KH records every person whose token it verifies (`message_people`); a direct message to anyone else is 404. | `app/auth.py` middleware |
| Delete | `DELETE /messages/{id}`: direct by receiver or maintainer, project and realm by sender or maintainer. | `app/auth_rules.json` |
| Migration | Messages step 3; old messages become project messages expiring 24 h after they were sent. `KH_MESSAGE_ALL_TTL_DAYS` replaced by `KH_MESSAGE_PROJECT_TTL_HOURS`, `KH_MESSAGE_REALM_TTL_HOURS`, `KH_MESSAGE_REALM_PROJECT`. | `app/config.py` |
| kh-helper 1.14.0 | `kh_message(content, to | project+mentions | everyone)`; the inbox is asked on every prompt, so direct messages and announcements reach sessions with no project. Needs this KH; deploy KH first. | `tools/kh-helper` |

Tests: `tests/test_messages.py` 52 checks, helper suites green (the 5 `test_kh_helper_home` failures are the machine's, same on main).
