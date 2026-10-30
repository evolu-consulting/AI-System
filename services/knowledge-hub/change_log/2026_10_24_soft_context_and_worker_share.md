# Soft context for keyed items; the distil worker shares general items (2026-10-24)

## Why

An offline run on 3,095 live prod rows and 210 agent steps (kh-investigate `vec_eead247c4272`, files in
`E:/STTTemp/kh-tags-exp`) measured the keyed tier of `/context/step` and `/turn/context`:

| serving | hit@1 | hit@5 | MRR@10 |
|---|---|---|---|
| exact action+context, context guessed by the model (today) | 0.490 | 0.667 | 0.596 |
| meaning only | 0.843 | 0.962 | 0.891 |
| **action, context as a +0.05 lift (this change), guessed context** | **0.886** | **0.990** | **0.927** |
| same, right context | 0.929 | 0.995 | 0.959 |

The model picked the right context 41% of the time, and a wrong exact key served six items of the wrong context
before anything else. Keyword tags (write-time tags, query keywords as tags) were tried in two rounds and dropped.

## How

- `app/distill.served`: with an action, a context, a step text and a model, the action's live items are read by
  meaning and an item of the named context gets `KH_STEP_CONTEXT_BONUS` (default 0.05) on its score. The answer's
  key is `SOFT_KEY` ("action, context lifts") when a served item has the context, else `action`. `exact_first`
  never drops a lane for a soft key (measured: dropping cost hit@1 0.886 -> 0.762). Without a text or model, and
  with `KH_STEP_CONTEXT_BONUS=off`, the exact key comes first as before. `_live_by_meaning` now keeps each row's
  score. HANA and Chroma return the same cosine (distance = 1 - similarity), checked live on HANA express for the
  relational store; HANA express has no vector engine.
- kh-worker: the model marks `share: true` on an item that reads the same in any project (prompt rule, same as
  the policy step 'distill this week / review'); with `KH_WORKER_AUTO_APPROVE=1` those ids go in `share` of
  `/distill/approve`. A policy proposal is never shared or approved by the worker. The `share` field is stripped
  from the submit body.

## Tests

`tests/test_distill.py` (soft key labels, the other lane's action items kept, bonus off keeps the old exact key and
exact_first), all 54 KH test files pass; worker 86 passed (`test_person`: shares only the marked items).
