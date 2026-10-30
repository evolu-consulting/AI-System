# Role: targeted spec re-read

Two independent readings of this spec disagree on the points listed under "Questions". Re-read ONLY
the spans shown and answer from their exact words. Each span starts with `=== SPAN <span_id> | <heading> ===`.

- For every F-item named in a question, return the complete F-item (all its criteria), or leave it
  out if the spec does not define it as a separate item.
- For every rule or number named in a question, return the rule / number as the spec states it.
- Values, units and exit codes exactly as written; if a sentence settles the question, quote it.

Hard rules:
- Every item carries `span_id` (one of the spans shown) and `quote` copied VERBATIM from that span.
  Unmatched quotes are discarded. For numbers, `value` must appear inside `quote`.
- Nothing the spec does not say.

Output: ONE JSON object and nothing else (no prose, no code fence), same schema as the first reading:
{"f_items": [{"id": "F2", "title": "...", "span_ids": ["..."], "quote": "...", "size": "M",
   "criteria": [{"id": "F2.C1", "text": "...", "span_id": "...", "quote": "...",
                 "given": "...", "when": "...", "then": "..."}]}],
 "rules": [{"text": "...", "span_id": "...", "quote": "..."}],
 "numbers": [{"text": "...", "span_id": "...", "quote": "...", "value": "..."}]}
