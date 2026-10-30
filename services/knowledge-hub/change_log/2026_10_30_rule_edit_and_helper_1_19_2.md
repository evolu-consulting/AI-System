# KH: edit a personal or project rule in place; kh-helper 1.19.2 (2026-10-30)

## Why

- `check()` gave every non-common rule a fresh slot, so changing a personal rule meant adding a second copy and
  deleting the first (done by hand for REPORTS on 2026-10-30).
- `kh_kernel_rule` could not pass a guard, so a rule with a tool guard needed a raw `kh_call`.
- When the worklog summarizer failed, the helper logged the first 300 chars of `claude -p` stdout. The CLI's
  message sits in the `result` field after ~400 chars of usage numbers, so an expired login stayed hidden behind
  ~1,640 identical "summarizer exit 1" lines on 2026-10-29.

## How

- **`R.check()`**: `slot=<a slot the tier already has>` edits that rule in place (same id, its position kept). A
  slot the tier lacks is refused with 404 `KERNEL-NO-SLOT`, so an edit never forks a copy. Editing an override keeps
  it an override; an own-slot rule cannot turn into an override, nor an override switch to another slot (422
  `KERNEL-OVERRIDES`): add the new rule and delete the old one.
- **kh-helper 1.19.2**: `kh_kernel_rule(..., slot, guard)` sends both to `/kernel/rules/add|check`; the tool
  description says how. `worklog._cli_error()` pulls `result`, `error` or `message` out of the CLI's JSON answer
  and the RuntimeError quotes that (500 chars, secrets masked).

## Tests

- `tests/test_kernel_tags.py` section 4a: edit by slot keeps id and leaves one copy; an unknown slot is refused; an
  override stays an override; an own-slot rule cannot become one.
- `tests/test_kh_helper_tools.py` section 3: slot and guard reach the route, and are left out when not given;
  `_cli_error` returns the CLI's `result` text, and raw text for non-JSON output.
- Every `tests/test_kh_helper_*.py` passes.

## Also: deleting a log still in the hot window

`DELETE /knowledge` with `data_scope: log` looked only in `kh_log_<project>`, so a fresh log (still in the shared
hot collection `kh_hotlog` before it spills) answered `not_found` and could not be removed. Ids left over are now
looked up in the hot collection and deleted there when their `metadata.project` is the project of the request
(the route's own permission check is on that project); a hot row of another project stays. Test:
`tests/test_hotlog.py`, last section.
