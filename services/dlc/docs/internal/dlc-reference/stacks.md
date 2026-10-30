> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `stacks.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Target stacks

A **stack** is everything the engine needs to know about how ONE target repository is tested:
where acceptance tests live and how they are named, how a test selection or the whole suite runs,
how results are read back per test, which commands a builder may run, the QAS smoke command,
and how a fresh tree is made runnable. Code: `line/stacks/`.

| Stack | Detected when | Test runner | Acceptance test file |
|---|---|---|---|
| `python-unittest` | nothing else matches (also: empty repo, any `.py`) | `python -m unittest` | `tests/acceptance/test_f<n>.py` |
| `node-cap` | `package.json` has `@sap/cds` (or `@cap-js/cds-test`, a `cds` section, `.cdsrc.json`) | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.js` |
| `node-ui5-ts` | `ui5.yaml`, or `@ui5/*`, `@openui5/*`, `@sapui5/*` packages | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.ts` |
| `react` | `react` in the dependencies | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.tsx` |

`python-unittest` is the engine's original behaviour, unchanged: every call site keeps its own
Python code path for it.

## Choosing the stack

`LINE_STACK` (or `stack` in `line.json`): `auto` (default) detects per target repository; any stack
name forces it. Precedence: explicit argument > configured value > env `LINE_STACK` > detection.
An unknown name fails fast with `CONFIG_INVALID`.

A **New System** starts from an empty repository, which detects as `python-unittest`. To build a new
Node system, set `LINE_STACK=node-cap` (or another Node stack) for that run.

## Node runner rules

- Runner from `package.json`: `jest` > `vitest` > `mocha` (dependency or `scripts.test`); `cds test`
  counts as jest; otherwise `npm test` (exit code only, no per-test results).
- The runner is started as `node <its bin>` from the tree's own `node_modules` (no npx, no shell),
  with a JSON report written to a temp file. Results are read per test.
- Test identity: `<repo-relative file>::<describe titles> <test title>`, joined by one space, e.g.
  `tests/acceptance/f2.test.js::F2 books F2.C1 rejects an empty title`. A file that fails to load
  reports as `<file>::<suite>`.
- Failure classes: assertion-shaped failures are `FAIL` / `AssertionError` (red test); a missing module
  is `ModuleNotFoundError`, a parse error `SyntaxError` (both count as a build failure, as in Python).
- Dependencies: a worktree, the empty-implementation scratch dir and a QAS color get a REAL
  `node_modules` through `npm ci --prefer-offline --no-audit --no-fund` (`npm install ...` without a
  lockfile), served from the npm cache after the first install. Install scripts run (native test
  dependencies such as the SQLite driver need them). Nothing is ever linked from another checkout:
  the engine deletes trees with `rmtree`, and a directory junction would delete the real dependencies.
  Nothing is ever published.
- Timeouts: 900 s for a test selection, 3600 s for a whole suite, 1200 s for an install.

## Where the engine asks the stack

| Place | Python (unchanged) | Other stacks |
|---|---|---|
| Test author (`understand/test_author.py`) | unittest module, `Class.test_method` names | stack target file, `<file>::<title>` names, stack hint appended to the prompt |
| Test check (`understand/test_check.py`) | `ast` methods, `compile`, `python -m unittest <name>` on an empty implementation | `defined_tests`, `node --check` for `.js`, the stack runner on an empty implementation (test files + runner config + lockfile only) |
| Verifier (`build/verifier.py`) | `python -m unittest <names>` | `stack.run` (same result shape) |
| Merge queue (`ship/merge_queue.py`) | `python -m unittest <names>` | `stack.run` |
| QAS runner (`ship/qas_runner.py`) | in-process unittest collector | `stack.run_cases` (per-test results) |
| QAS smoke (`ship/deploy.py`) | `python -m unittest` (or `LINE_SMOKE_CMD`) | `npm test` after an install in the color (or `LINE_SMOKE_CMD`) |
| Builder prompt (`build/builder.py`) | `python -m unittest <names>` | `npx jest <files>` / `npm test` |
| Builder tools (`llm/cli.py`) | `Read Edit Write Bash(python -m unittest*)` | `Read Edit Write Bash(npm test*) Bash(npm run test*) Bash(npx jest*) Bash(npx vitest*) Bash(npx mocha*) Bash(npx cds*) Bash(node *)` |

## Adding a stack

1. Subclass `line.stacks.base.Stack` (or `NodeStack` for another Node flavour) and implement:
   `detect(repo) -> score`, `target_file`, `path_ok`, `defined_tests`, `name_ok`, `name_example`,
   `compile_error` (optional), `prepare`, `test_cmd`, `run`, `smoke_argv`, `stage_empty_extra`,
   `allowed_tools`, `test_author_hint`. `run` returns
   `{"rc", "ran", "failures", "output", "timeout", "results"}` where a failure row is
   `{"test", "kind": FAIL|ERROR, "error_type", "first_line", "message", "fingerprint"}` and
   `results` is `{test id: passed}`. `run_cases` and `run_one` come from the base class.
2. Register it in `STACKS` (`line/stacks/__init__.py`); more specific stacks first.
3. Add unit tests (detection, names, a parsed report fixture) to `line/tests/test_stacks.py`.

## Checks

```
python -m unittest line.tests.test_stacks                    # offline: detection, names, parsing, dispatch
set LINE_NODE_LIVE=1 && python -m unittest line.tests.test_stacks.LiveCapMiniTests
```

The live test needs node + npm on PATH and network for the first install. It copies
`line/samples/cap-mini` (one CAP service, one jest acceptance file), then checks that the suite is
green, that a broken implementation reads `fail` (not `error`), that no test passes on an empty
implementation, and that the engine's test check and verifier gate the repo.

## Limits

- No dry end-to-end variant for a Node target yet (the dry fixtures and the fake model are Python
  shaped); the live tests above cover the stack layer and the engine gates on a real CAP repo.
- TypeScript tests rely on the target's own runner config (ts-jest, vitest); the engine only
  syntax-checks `.js` files itself.
- `npm test` fallback gives one pass/fail for the whole run, so QAS cannot tell flaky tests apart.
- Browser / OPA5 / wdi5 UI tests are not run; UI5 and React criteria are tested as unit tests.
