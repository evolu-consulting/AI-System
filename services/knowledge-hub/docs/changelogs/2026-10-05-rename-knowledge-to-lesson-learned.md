# 2026-10-05 - Shared project `knowledge` renamed to `lesson-learned`

fen asked for the rename: the project holds lessons distilled from work logs and knowledge people
contribute, so its name now says so. KH has no rename route, so the project was recreated and
the old one deleted.

| Part | Change |
|---|---|
| Data (prod `knowledge-hub`, dev `kh-sso`) | 372 rows (367 `kind=lesson`, 5 `kind=guide`) copied into `lesson-learned` with the same vector ids, text and metadata, read back 372/372. The server stamps `author` on write, so 5 rows now show `agent-admin` as author instead of their original writer. |
| Project registry | Created on prod through `POST /projects`. Dev answered 409 (the Keycloak registry is shared), so its `PROJECTS` row was inserted from the prod entry and refreshed with `POST /projects`. Old aliases kept, plus `knowledge`, `lesson learned`, `bai hoc`. |
| Access (Keycloak `KH_AUTH_*`) | Grants copied with their original granter and time (owner nghiephoang2905, editable logan59102 and vndiary), `CREATED_BY` kept, `DEFAULT_LEVEL readonly`. Effective access compared row by row: 60 = 60. `catalog.json` `default_levels` renamed (Keycloak repo). |
| Hooks and policy (prod and dev) | Kernel line 4 and five rules (`save knowledge` where/shared, `search knowledge` where, `troubleshoot problem` lessons first/english query) now name `lesson-learned`. |
| `/auth/help` guide (data) | Line "Every KH user reads..." updated with `PUT /auth/help`; `seeds/auth_help.seed.txt` matches. |
| Code | `KH_TURN_LESSON_PROJECT` default is `lesson-learned` (`app/config.py`); tests `test_context_step`, `test_turn_context` use the new id; docs `sign-in-and-access.md`, `turn-context.md`. |
| Old project | `DELETE /projects/knowledge?confirm=true` on prod and dev after the new one was verified. |

Backups: `C:/RWTemp/kh-rename-knowledge-backup-2026-10-05` (rows, registry entries, grants, hooks,
policy rules, guide text, all as they were before the change).

Earlier changelogs keep the old name: they record what was true then.
