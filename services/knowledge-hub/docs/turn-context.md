# Turn context

`GET /turn/context?text=<the person's prompt>` answers, in one call, what the model used to fetch
with three to five calls before every piece of work. The `UserPromptSubmit` hook of kh-helper
(1.9.0 and later) makes the call and injects the answer, so the model starts the turn with it.

Roadmap item B (`docs/roadmap-2026-2028.html`). Built 2026-10-02.

## What it returns

| Part | Same as | Bound |
|---|---|---|
| `project` | `GET /orchestrator/project_match` (best, ambiguous, weak_only, up to 4 matches) | - |
| `actions` | `GET /policy/actions?project=<best>`: label, project, first sentence of the description | `KH_TURN_WHEN_CHARS` (160) |
| `findings` | `GET /findings/list?project=<best>` | `KH_TURN_FINDING_LIMIT` (5) |
| `entities` | `GET /entities/match?text=...&project=<best>` (all readable projects when none matched) | `KH_TURN_ENTITY_LIMIT` (5) |
| `lessons` | `POST /vector/query` on project `lesson-learned`, scope knowledge, with the raw prompt: id, score, title | `KH_TURN_LESSON_K` (3), floor `KH_TURN_LESSON_FLOOR` (0.6) |
| `text` | the block the hook injects; it lists the parts and tells the model not to fetch them again | - |

The prompt is cut to `KH_TURN_TEXT_CHARS` (2,000) before matching.

## Access

Signed-in callers only (`kind: authenticated` in `app/auth_rules.json`). Every part is filtered by
what the caller may read: a project the caller cannot read is never the match, and its findings
and entity cards never appear. Lessons appear only for callers who may read the lessons project.
The project tie rule is the one of `projects.resolve_project_name`, applied after that filter.

## Failure

A part that raises is left out and logged; the rest still answers. The helper adds nothing when
the prompt is missing, the call fails or KH answers an error, such as a KH without this route
(404), so the model falls back to the calls the rule text names.

## The rule text that goes with it

The hook's own rule (`/hooks/set`, `UserPromptSubmit`, name `prompt-guard`) has to say that the
block replaces those calls, and keep the old calls as the fallback for when no block is there.
Without that change the model keeps making the calls and nothing is saved.
