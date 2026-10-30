# KH: tool guards ride on tagged kernel rules (2026-10-30)

## Why

Tagging a person's legacy personalization rows into `kernel_rule` left one row behind: REPORTS carries the
Artifact tool guard (`guard_tool` metadata on the personalization row), and `/personalization/guards` read guards
only from active personalization rows. Retiring the row would switch the guard off; keeping it rendered the rule
twice (once tagged, once under PERSONALIZATION NOT YET TAGGED). A guard is part of the rule, so it now lives on
the rule and resolves with it.

## How

- **`kernel_rule.guard`** (new column, added in place by `R.init()`; NVARCHAR(2000) on HANA): JSON
  `{tool, decision, when}`. Empty = no guard.
- **`R.validate_guard()`**: `tool` required (at most 120 chars), `decision` is `ask` (default) or `deny`, `when` is
  `{tool input field: [values]}` with values as strings (`false` for a boolean, `""` for a missing field).
  A bad guard is refused with 422 `KERNEL-GUARD`. `/kernel/rules/check|add` take `guard` in the body.
- **`R.guards(tool, project, personal_tier)`**: the guards of the rules that won their slot in `resolve()`, so a
  guard has the same tiers as its text: common < project < personal, a personal `overrides` drops the common
  rule's guard with its text, and a locked common guard cannot be replaced.
- **`kernel.guards_for(tool, project)`**: the caller's personal tier, plus the project named or else the project
  the session (X-KH-Actor) is bound to, if the caller may read it.
- **`GET /personalization/guards?tool=[&project=]`**: kernel guards first, then the legacy personalization guards
  that are still active. The route and its answer are unchanged, so every kh-helper version keeps working.

## Data

Rowan's REPORTS rule (`kr_b176ad07578b`) gets the Artifact guard of `vec_b67bec4df5ac`
(`ask`, when action in ["", "publish"] and asset in ["", "false"]); that legacy row is then retired like the other
ten, and the NOT YET TAGGED block disappears from his kernel.

## Tests

- `tests/test_kernel_tags.py` section 4b: a bad guard is refused; a guard is stored and read back with `when`
  normalised; personal, project and common guards resolve; an override drops the common guard; a locked common
  guard stays; the route lists kernel guards before legacy rows.
- `tests/test_kh_helper_guards.py`, `test_auth.py`, `test_personal.py`, `test_promote.py`, `test_policy_*`,
  `test_kh_helper_tools.py`, `test_kh_helper_legacy.py`, `test_sync.py` pass unchanged.
