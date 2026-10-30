# add() returns the wrong result

## F1 add adds
Repro: `from calc import add; add(2, 3)` returns -1. Expected: 5. Actual: -1.
Fix `add` in `calc.py` and add a regression test.
