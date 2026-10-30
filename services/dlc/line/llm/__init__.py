"""Model access for the line (slice S3): one LlmPort, three backends, one cost wrapper.

    from line.llm import make_llm
    llm = make_llm(cfg, store)          # LINE_LLM = fake | cli | api
    res = llm.complete("reader", prompt, schema, key="A", run=run_id)
    res = llm.agentic("builder", worktree, prompt, cfg.builder_max_turns, 1.0, key="U3#2", run=run_id)

Layout
  port.py   make_llm(config, store) -> CappedLlm wrapping the backend; load_prompt()
  caps.py   CappedLlm: pre-call estimate + caps (LINE_MAX_USD_CALL / LINE_MAX_USD_RUN),
            post-call ledger (store records "llm_call"), schema-lite validation + one repair
  fake.py   deterministic backend reading samples/<pack>/dry/ fixtures
  cli.py    `claude -p` backend (stream-json, usage and cost from the CLI)
  api.py    Messages API backend over urllib (complete() only)

Fixture keys (fake backend)
  complete(role, ..., key=K)   -> dry/<role>/<K>.json       (K "" -> "default")
                                  repair retry -> dry/<role>/<K>.repair.json if present
  agentic(role, ..., key=K)    K = "<unit>.<n>" | "<unit>#<n>" | "<unit>/attempt<n>" | "<unit>"
                                -> tree dry/<role>/<unit>/attempt<n>/ copied into workdir;
                                   _outcome.txt / _outcome.json in that dir (not copied) gives
                                   the outcome, default SUBMIT.
"""

from .port import make_llm, load_prompt  # noqa: F401
from .caps import CappedLlm, Pricing, validate, parse_json  # noqa: F401
