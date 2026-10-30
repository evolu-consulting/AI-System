# 2026-09-30 - Personal projects: each person's personalization is their own

## Why

fen: every user gets one personal project that keeps that user's own habits. The orchestrator routes
per user, `knowledge` is the common project everyone reads, and the personal project holds what a
person told their assistant. Before this, personalization was ONE common store in the orchestrator,
injected into every session of every person. That is why it was not migrated to production on
2026-09-26 (prod held 0 rows).

## What changed

| Where | Change |
|---|---|
| `app/personal.py` (new) | `personal_id(email)` -> `personal-<slug>`; `target(scope, project)` sends a personalization call naming no project to the caller's own; `ensure()` creates the bundle on the first write. |
| `app/config.py` | `KH_PERSONAL_PREFIX` (default `personal-`), `KH_PERSONAL_SCOPE` (default `personalization`). |
| `app/auth.py` | `Principal.personal_project`; `can()` grants the owner everything on it; `visible_projects()` includes it; `decide()` checks a personalization request naming no project against the caller's own personal project. |
| `app/vector_store.py` | `scope_collection`: personalization of a personal project -> `kh_personalization_<id>`. |
| `main.py`, `app/retriever.py` | Reads and writes of scope=personalization go to that personal collection; the first write creates the project. |
| `app/projects.py` | `POST /projects` refuses ids in the personal namespace when sign-in is on. |
| `app/auth_rules.json` | `GET /personalization/render` is `authenticated`: it reads only the caller's own rows. |

Sign-in off (local 9000) is unchanged: `target()` returns the project as given, and personalization
stays the orchestrator's common store.

## Decisions

- **Access by e-mail, not by grant.** A grant lives in the token, so a project created mid-session
  would be unreadable until the token refreshed. It would also need a Keycloak record, and the one
  realm is shared by dev and prod, so a record made on dev would block prod. Deriving the id and the
  access from the verified e-mail avoids all three.
- **Maintainers keep access** (they hold `all_projects`), so a migration can write into a named
  personal project.

## Checks

- `tests/test_personal.py` (new): 20 checks, all pass.
- `tests/test_auth.py`: the visible set now includes the caller's personal project (2 expectations updated).
- Unchanged and passing: `test_log_by_author` 29, `test_vector_delete` 31, `test_project_registry` 27,
  `test_policy_actions` 55, `test_messages`.
- Keycloak repo `deploy/btp/e2e_multi_user.py` 3.9b-3.9e: A stores a preference with no project; A's
  render shows it; B's render and scroll do not.

## Follow-up, same day: deleting a personal project

`DELETE /projects/{id}` asked the identity service to unregister the project first. A personal
project was never registered there, so the owner could not delete it (and the e2e left
`personal-kh-test-a-example-invalid` behind on prod). `app/projects.py` now skips that step for
the personal namespace; the route's own permission check (owner by e-mail, or a maintainer) still
applies. `tests/test_personal.py`: another member is refused (403), the owner deletes (200) and the
bundle is gone. Keycloak e2e 3.9f deletes A's personal project after its checks.
