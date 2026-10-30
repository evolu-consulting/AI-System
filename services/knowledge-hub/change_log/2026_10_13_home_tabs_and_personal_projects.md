# 2026-10-13 - /home tabs, every person works through a personal project, kh-helper 1.13.0

| Release | What changed | Where it runs |
|---|---|---|
| KH server (v6.5) | /home: Knowledge and Lesson learn tabs, Sync gathered under one tab; learn back (off unless `KH_LEARNBACK_LLM`). Every person has `personal-<email>` from session start, in the registry for them only; an unnamed log, finding or personalization lands there; the orchestrator refuses worklogs and findings (409). A deleted project drops its policy; a policy tier that owns rows is never alias-matched. | prod `knowledge-hub` (deploy of the night of 2026-10-13) |
| kh-helper 1.13.0 | The Stop check also runs on a turn with no tool use when the answers reach 800 chars or the person's own words reach 120 (new information), so a solution discussion or a 'noted' after new information gets its worklog. | served at /auth/download after the deploy |
| KH config (data, not code) | Kernel rules (1) and (4), the Stop hook, the store-worklog when-line, 8 common rules, one line of the sign-in guide. | applied by `apply_update.py` |

## Why

- The orchestrator had become the maintainers' own workspace: every member could read its worklogs.
- A member's log was lost three ways: no project resolved (orchestrator 403), a guessed project of someone
  else (403), and a discussion with no tool use that never reached the Stop check.

## How it works now

- **Orchestrator** = the shared directory: project registry (each person sees what they may read), shared routes,
  the sign-in guide, common rules. It keeps nobody's log or finding.
- **personal-<email>** = each person's own workspace, maintainers included. Created at session start
  (`/personalization/render`) and by kh_me (`/auth/me`, which now returns `personal_project`); recreated if deleted;
  `POST /home/personal/ensure {emails}` backfills (maintainers).
- **Writes**: log, findings or personalization naming no project go to the writer's personal project (server side).
  A write into a project the person may not write stays 403; the store-worklog policy then stores it in the personal
  project with `intended_project`.
- **When to log** (policy gate): a change, a solution discussed or decided, or new information from the person
  (fact, constraint, correction, requirement), even with no tool and no project. Nothing only for small talk or a
  plain lookup.

## Tests

KH suite green (test_auth and test_vector_add_project updated for the new behaviour; new cases in test_personal,
test_kh_helper_turn). Docker stack, rehearsing the night's scripts on a copy of prod's config: apply_update ALL PASS,
verify ALL PASS, e2e_multi_user 73/73, e2e_shared_projects 64/64, home 27/27, personal-project checks, Petrus's case
10/10.
