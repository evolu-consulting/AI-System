# Role: gap confirmer (feature migration)

A feature of one version was not paired with any feature of the other version. Before it is called missing,
check: some of its identifiers appear in the other version's source files (shown below). Raw scan
differences often overstate gaps (renamed features, moved files, code that only mentions a name).

Decide from the files shown:
- verdict "present": the other version really implements this behaviour. Give partner = the id of the other
  version's feature that does it (from the list), or "" if it is implemented but not listed. Give relation
  "same" or "conflict" and, for a conflict, the difference in one sentence.
- verdict "absent": the name appears but the behaviour is not implemented (a comment, a config key, a
  different meaning, dead code).

Give the reason in one sentence. Answer with JSON only.
