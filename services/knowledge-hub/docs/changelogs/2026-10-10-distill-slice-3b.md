# 2026-10-10 Distil, slice 3 part 2 (roadmap item D): first rekey, ranking inside a key, weekly action

## First rekey of lesson-learned (prod)

All 377 rows keyed through `POST /distill/rekey` (metadata only; text, kind, topic and title kept):
369 lessons get action `troubleshoot problem` and their category as the context tag (13 tags such as
`ci-cd-deploy`, `sap-btp-cloud-foundry`, `auth-security`); 8 guides keyed by hand (`workbeats`,
`kh-tools`, `planning`, `browser-apps`, `ui-design`, `knowledge-hub-tooling`). Run first on the HANA
Express dev container, then on prod: 377 keyed, 0 left. Search by meaning is unchanged (the install
pointer still scores 0.780 for 'how do I install the auto login tool').

## Ranking inside a key (056e1f4)

A key holds up to 55 lessons, and the newest are not the relevant ones. `served()` orders rows inside
the key by a vector query restricted to it (metadata read back by id; still no score floor). The pack's
`contexts` now lists the tags of lesson-learned too. On dev, for 5 troubleshooting steps the first keyed
lesson equals the first by meaning in 4, and the key keeps other categories out.

## Exact key first

Prod check: a CI-deploy step in m360 found the exact lessons in lesson-learned, but m360's action-only
fallback (every m360 item under the action) came first and filled the budget. `exact_first()` now drops
the action-only fallback when another lane matched action + context. Checks: test_distill 88/88.

## Weekly action

Policy action `distill this week` (every project, maintainer only, source_policy
`distill-weekly-2026-10-10`): who, projects (from `/distill/patterns`), batch, resend, review (approve
own items, leave contested and shares to the owner), rekey of new lesson-learned rows, stop on the usage
limit, report. 1,551 chars; lint clean.
