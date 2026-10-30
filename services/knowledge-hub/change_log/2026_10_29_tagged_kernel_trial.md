# Tagged kernel, helper task tools, usage across sessions: local trial (2026-10-29)

Branch `feat/kh-kernel-tags`, local only: not deployed, no version bump. The two-hook kernel split
(2026_10_29_session_start_split.md) stays the workaround on prod.

## Why

- The kernel is one free-text row, and personalization is another store. Each session the model read both and
  had to work out by itself which rule wins (kernel rule 10). That works on Claude Code; on other CLIs nobody checked.
- Rules were added free-form, so the same idea could sit in common and personal under two wordings.
- The kernel taught every model how to call KH (routes, body shape, scope twice, ts, read-back).
- Rule 7 (REPEATED WORK) counted within one session only. A step done every day in a new session never counted.

## How

- **Tag vocabulary** (`app/kernel/tags.py`, `seeds/kernel_tags.seed.json`): 299 tags in 12 facets
  - The facets are kh, lang, action, object, domain, comm, risk, moment, place, cli, people and system.
  - The action facet follows schema.org Action types, the risk facet the kernel's own risky-action list, and the
    moment facet the CLI hook events.
  - Tags are kept in table `kernel_tag`.
  - The list grows through `POST /kernel/tags/propose` (status proposed); a maintainer makes a tag live with
    `/kernel/tags/approve`.
  - `suggest(text)` is a lexical ranker that uses no model.
- **Kernel rules per tier** (`app/kernel/rules.py`, table `kernel_rule`, `seeds/kernel_rules.seed.json`)
  - Each rule has a tier: common, a project, or a personal project.
  - It also has a slot, 2-12 active tags and a `locked` flag.
  - The prod kernel is split into 13 rules plus a header. Rule 0, the 403 rule and the secrets rule are locked.
- **Contract for adding** (`POST /kernel/rules/check|add`):
  - tags are required and must be active;
  - a personal or project rule is compared with the common ones (tag overlap and word overlap).
    - At a score of 0.35 or more it is refused with `KERNEL-SAME-AS-COMMON` and a list of candidates.
    - `overrides=<slot>` replaces the common rule and copies that rule's tags.
    - `distinct_from` plus a reason keeps the new rule apart from the common one.
  - a locked slot is refused with `KERNEL-LOCKED`.
- **Merged render** (`GET /kernel/render`): common < project < personal per slot, resolved in code.
  - Output is cut at rule boundaries into parts under 9,000 chars, so each part fits the Claude Code hook cap.
  - Personalization rows that are not tagged yet are appended as their own block.
  - Before seeding, the route serves the old one-row kernel and the personalization.
  - `GET /kernel/resolved` shows which tier won each slot.
- **kh-helper**
  - The SessionStart hooks read `/kernel/render?part=1|2|3`. They fall back to the old routes only when KH lacks
    the route, never because a part is empty.
  - New MCP task tools: `kh_step`, `kh_plan`, `kh_save`, `kh_log`, `kh_tags_suggest`, `kh_kernel_rule` and
    `kh_repeats` (`kh_helper/tools.py`).
  - The helper chooses the route, store, session project, ts and topic == subject, and reads each row back.
- **Usage across sessions** (`app/usage.py`, table `usage_daily`)
  - Learn-back recounts yesterday and today from every project's work logs, personal ones included.
  - It keys each log by action/object tag, for example `sign_in/app`, and keeps the count under the author's
    personal id.
  - `/turn/context` lists keys seen on at least 3 of the last 14 days under REPEATED ACROSS DAYS.
  - Routes: `/usage/repeats`, `/usage/mine`, `/usage/learn` (maintainers).

## kh-helper 1.19.0 and prod safety (same day)

- The write check for the task tools has its own hook type, `PreToolUseTools`, seeded by `/kernel/seed`.
  `GET /kernel/pretool` serves it and falls back to `PreToolUse` when it is not seeded.
- Helper 1.19.0 reads `/kernel/pretool`, and `/hooks/raw?hook_type=PreToolUse` on an older KH. Helpers older
  than 1.19.0 keep the old `PreToolUse` text, so no one is told about tools their helper lacks.
- The `usage_daily` columns are `day_utc`, `action_key` and `hits`, because DAY, KEY and COUNT are SQL words
  on HANA.

## Prod fixes after the first deploy (2026-10-30)

- `/usage/learn` returned 500 on HANA: a log sample containing a symbol such as a heart did not fit NVARCHAR(300).
  Samples are now cut to 120 chars, and the session and project lists to 20 entries.
- kh-helper 1.19.1: PostCompact reloaded the whole merged kernel as one hook. On prod that is 9.9k chars plus the
  COMPACTED prefix, over the 10k cap. It now reloads in parts like SessionStart (PostCompact, PostCompactPersonal,
  PostCompactRest), so setup writes 10 hooks.

## Tests

- `tests/test_kernel_tags.py` (32 checks) covers:
  - the seed, suggest, every refusal of the contract, overrides copying tags, the locked slot and propose/approve;
  - the merged render, parts that never cut a rule, and tier rights;
  - usage over 3 days in 3 sessions counted as a repeat.
- `tests/test_kh_helper_tools.py` covers the bodies built by `kh_log` and `kh_save`, the read-back, and the hook
  fallbacks.
- `test_kh_helper_legacy`, `test_kh_helper_clis` and `test_kh_helper_home` now expect 8 helper hooks: there are
  three SessionStart part hooks.
- One codex uninstall check in `test_kh_helper_clis` fails now and then on origin/main as well (`backups_deleted`
  1 vs 2). It is not caused by this branch.
