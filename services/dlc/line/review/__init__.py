"""Review slice (design blocks 13 and 14).

  reviewer.py  clean-context reviewer + code noise filter; blocking findings send the unit back
               (Gate code REVIEW_BLOCK); persistent blocks go to the judge
  drift.py     drift signals computed by code + ladder note -> nudge -> reviewer -> judge -> stop
  judge.py     strong-model judge against the frozen spec (no human in this loop), decision log,
               later-run grading, accuracy, rollback + fixer evidence

Hooks (all no-op by default; flags review_enabled / drift_enabled / judge_enabled):
  ctx = Ctx.from_pipeline(pipeline)
  drift.on_attempt(ctx, unit_id, attempt, gate, builder_outcome=, usd=)   after verify()
  reviewer.on_verified(ctx, unit_id, attempt)                            after a passed verify, before commit
  judge.on_qas_report(ctx, report)  (+ attach_fixer_evidence)            after the QAS runner, before Fixer
  judge.on_run_end(ctx, final_state)                                     when the run ends
New kinds / codes / entity / config keys the integrator registers: _common.NEW_EVENT_KINDS,
_common.NEW_GATE_CODES, _common.E_DECISION, _common.DEFAULTS (env names in _common.ENV_NAMES).
"""

from ._common import (  # noqa: F401
    DEFAULTS, DRIFT_REDIRECT, DRIFT_STOP, E_DECISION, ENV_NAMES, NEW_EVENT_KINDS, NEW_GATE_CODES, REVIEW_BLOCK, Ctx,
)
