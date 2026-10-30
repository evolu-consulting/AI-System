# Target stacks

A **stack** is everything the engine needs to know about how ONE target repository is tested:
where acceptance tests live and how they are named, how a test selection or the whole suite runs,
how results are read back per test, which commands a builder may run, the QAS smoke command,
and how a fresh tree is made runnable.

| Stack | Detected when | Test runner | Acceptance test file |
|---|---|---|---|
| `python-unittest` | nothing else matches (also: empty repo, any Python file) | Python unittest | `tests/acceptance/test_f<n>` (Python module) |
| `node-cap` | `package.json` has `@sap/cds` (or `@cap-js/cds-test`, a `cds` section, `.cdsrc.json`) | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.js` |
| `node-ui5-ts` | `ui5.yaml`, or `@ui5/*`, `@openui5/*`, `@sapui5/*` packages | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.ts` |
| `react` | `react` in the dependencies | jest / vitest / mocha / `npm test` | `tests/acceptance/f<n>.test.tsx` |

`python-unittest` is the engine's original behaviour.

## Choosing the stack

`LINE_STACK`: `auto` (default) detects per target repository; any stack
name forces it. 
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
  a linked directory could be deleted together with a worktree.
  Nothing is ever published.
- Timeouts: 900 s for a test selection, 3600 s for a whole suite, 1200 s for an install.

## What changes per stack

| Step | Python | Node stacks |
|---|---|---|
| Acceptance tests | unittest module, `Class.test_method` names | stack test file, `<file>::<title>` names |
| Red-on-empty check | the test run on an empty implementation must fail | the stack runner on an empty implementation (test files + runner config + lockfile only) must fail |
| Verifier, merge queue | the unit's tests, run by the engine | the same, through the stack runner |
| QAS | per-test results, repeated for flaky detection | per-test results (not with the `npm test` fallback) |
| QAS smoke | Python unittest (or `LINE_SMOKE_CMD`) | `npm test` after an install in the color (or `LINE_SMOKE_CMD`) |
| Builder tools | `Read Edit Write Bash(python -m unittest*)` | `Read Edit Write Bash(npm test*) Bash(npm run test*) Bash(npx jest*) Bash(npx vitest*) Bash(npx mocha*) Bash(npx cds*) Bash(node *)` |

Further stacks (ABAP, Java, .NET ...) are added by the vendor; ask for the roadmap.

## Limits

- `dlc selfcheck` covers a Python sample only; Node stacks were verified by the vendor on a sample SAP CAP
  repository (suite green, broken implementation reads as a failing test, nothing passes on an empty
  implementation, the engine's gates hold).
- TypeScript tests rely on the target's own runner config (ts-jest, vitest); the engine only
  syntax-checks `.js` files itself.
- `npm test` fallback gives one pass/fail for the whole run, so QAS cannot tell flaky tests apart.
- Browser / OPA5 / wdi5 UI tests are not run; UI5 and React criteria are tested as unit tests.
