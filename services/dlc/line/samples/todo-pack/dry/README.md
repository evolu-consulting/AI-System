# Dry fixtures of the todo pack

Answers of the fake model (LINE_LLM=fake) for every role of the line, so the dry e2e runs with no
model at all:

- `reader_a/digest.json`, `reader_b/digest.json` - the two independent readings; reader B states
  exit code 2 for an unknown id in F2, so reconcile diverges
- `reader_reread/A1.json`, `B1.json` - targeted re-read of the F2 span; both agree on exit code 1
- `test_author/F1.json` .. `F3.json` - acceptance test files with their trace (criterion + span)
- `planner/plan.json` - U1 storage contract; U2 (F1) and U3 (F2) in parallel; U4 (F3) after U2
- `builder/<unit>/attempt<n>/` - files the builder writes; U3 attempt 1 exits 0 for an unknown id
  (verify fails with TEST_FAIL), attempt 2 is right
- `builder/FX-F3-g1/attempt1/` - the fixer unit used by the LINE_DRY_QAS_RED=F3 variant

Wave 4 fixtures (used when the matching flags are on; the `all_on` e2e variant turns every one on):

- `gaps/gaps.json` - the 7-slot checklist per F-item: covered slots quote the spec; three plain gaps become
  accepted assumptions; one sensitive gap (F2 persistence: a removed task is deleted for good) becomes the
  only question
- `human/answers.json` - the dry person (`LINE_DRY_HUMAN=auto`) answers Q1 "accept"; the answer becomes
  addendum v1.1 and the spec is digested again
- `conflicts/extract.json` - rules of the spec with no contradiction; `conflicts/judge.json` - the verdict
  for pair P1 (used by `conflict_park`)
- `_variants/conflict_park/` - `spec.md` with a planted contradiction (a missing file exits 2 in the
  Interface section, 0 in F1) and its `conflicts/extract.json`; the e2e copies the pack and overlays them
- `reviewer/<unit>.<attempt>.json` - U2 attempt 1 has one blocking finding (and one noise finding the filter
  drops); every other review passes; `builder/U2/attempt2/` is the fixed attempt
- `judge/U2.dispute.1.json` - the judge rules "fix" on the U2 dispute (`review_max_rounds=1`)
- `distiller/<role>.<step>.json` - one lesson per group; `{{prompt:REGEX}}` / `{{prompt*:REGEX}}`
  placeholders take the fingerprint and the event ids from the prompt (see `line/llm/fake.py`)
- `eval_judge/_fallback.json` - approves a lesson on a cold start (no recorded cases yet: the canary decides)
- `<role>/_fallback.json` answers any key of that role that has no file of its own
