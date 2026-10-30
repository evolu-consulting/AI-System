# Personal lessons, and specific tasks as lessons instead of policy actions (2026-10-29)

## Why

Every specific task (sign in to an app, upgrade App Session Manager, scan or review code, distill) was a policy
action, so the action menu and kernel grew with each new tool, and a member could not keep a how-to of their own
anywhere the assistant would find it (members cannot write `lesson-learned`). The kernel now routes general KH
work to actions and finds the guide for a specific task with `/context/step`, which reads the shared lessons and,
new here, the caller's own lessons.

## How

- **`config.PERSONAL_LESSON_SCOPE`** (`KH_PERSONAL_LESSON_SCOPE`, default `lesson`): a person's own lessons live in
  that scope of their personal project (`kh_lesson_<personal id>`).
- **`personal.OWN_SCOPES`** includes it, so a lesson written with no project lands in the writer's personal project.
- **`/context/step`**: new tier `personal-lesson`, read from the caller's personal project and packed before every
  shared row (the personal lesson wins on overlap).
- **Turn context**: new block `YOUR OWN LESSONS`, above `KH LESSONS`; its ids count as served.
- KH data, not code: kernel rules (2), (4), (6), (10) and the prompt guard rewritten; actions `sign in to web app`,
  `upgrade app session manager`, `scan code`, `review code` and `distill this week` became lessons in
  `lesson-learned`; `troubleshoot problem` and `create or update policy` updated. Draft and A/B:
  `C:\RWTemp\KH-kernel-lesson-rewrite-2026-10-29.txt`.

## Tests

- `tests/test_personal.py`: a lesson naming no project lands in the personal project; the owner's step packs it as
  `personal-lesson` and their turn context lists it; another member sees neither.
- A/B on a local KH (10 Vietnamese prompts x 3 runs, old kernel vs rewrite): guide found 28/30 vs 30/30 (the two
  misses: `troubleshoot problem` answered from lessons without loading its plan), input tokens +23% on average,
  +35% median.
