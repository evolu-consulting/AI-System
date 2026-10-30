# 2026-09-30 - /log/recent with a project names shows every author's rows

## Why

fen synced local project m360 to KH BTP prod as agent-admin (1 knowledge row, 81 worklogs) and
made rowan.hoang@simplemdg.com the sole owner. Signed in as that owner in another session, the
worklogs did not show: `/log/recent?project=m360` answered 0 rows, because the route always
narrowed the hot window to the caller's own rows (`metadata.author`), and 50 of the 81 rows still
sat in the window under agent-admin. `/vector/scroll` with the project already returned all of them.

fen's rule: anyone who may read a project reads its whole log; each row only shows that someone
else wrote it.

## What changed

| Where | Change |
|---|---|
| `app/hotlog.py` | New `recent_where(where, project)`: no project named = the caller's own window (unchanged); project named = no author narrowing. |
| `main.py` `/log/recent` | Uses `recent_where`. The `project.read` check on a named project is unchanged, so nobody reads a project they cannot see. |
| `/log/window` | Unchanged: still the caller's own slots. |
| Spill | Unchanged: a slot is still delivered only where its author holds `project.log`. |

## Checks

- `tests/test_auth.py`: two new checks (no project = own window, project named = every author).
- Keycloak repo `deploy/btp/e2e_multi_user.py`: new 3.8b, a readonly member naming the project sees
  the owner's worklog with `author` = the owner; 3.9 (own list without a project) still holds.
- `tests/test_hotlog.py` was already failing before this change: its fixed 2026-08-29 timestamps are
  now past the 14-day window age, so every row spills on write. Not touched here.
