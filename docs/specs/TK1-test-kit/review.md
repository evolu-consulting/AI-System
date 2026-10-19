---
id: TK1-test-kit
reviewer: Claude Opus 5.5 (single reviewer, fast lane)
scope: 8198576a, 40eabcfa
verdict: APPROVED
---

# Review TK1 test-kit

**Verdict: APPROVED.** 0 Blocker, 0 Major, 3 Minor, 1 Info.

## 1. Negative check of `defineRlsSuite` (most important)

Done outside committed code: a throwaway test in the scratchpad imported the real `defineRlsSuite` and the same `contracts` + `pkdemo` declarations as `rls-packs.int.test.ts`. After `cloneDb` it broke one policy on a throwaway clone DB (`ai_system_tk1rv_test`, with its template and trash DBs), then ran the suite. All throwaway DBs were dropped afterwards.

| Mutation (clone only) | Result |
|---|---|
| none (baseline) | 46 pass, 0 fail |
| `contracts.contracts`: `NO FORCE ROW LEVEL SECURITY` | 1 fail: "ENABLE + FORCE ... trên mọi bảng khai" |
| `contracts.contracts`: policy `USING (true)` | 2 fail: cross-read and existence probe |
| `pkdemo.items`: policy `USING (true)` | 3 fail: cross-read, cross-write, existence probe |
| `contracts.contract_items`: policy `WITH CHECK (true)` | 2 fail: cross-write (INSERT 42501 expected) and existence probe |

Conclusion: the suite goes red for all 4 breakages, and each breakage is caught by the case designed for it (structure, read, write, probe). It is not vacuous.

## 2. `set_config` path

- `db.ts` sets role and tenant with one parameterised statement (`set_config(t.k, t.v, true)` over `unnest`). No literal `set_config('role', ...)` exists in the kit, so the N1 m-01 "literal only in `*-scope.ts`" rule is not weakened. App code (`withPackScope`, `withHubScope`) is untouched.
- The kit is a leaf: `@ai/test-kit` is a root devDependency only. No `apps/*` or `packages/*` `package.json` declares it, and with the isolated linker app code cannot resolve it. The depcruise rule `test-kit-no-apps` (kit -> `apps/`) is present and correct.

## 3. Builders

`tenants`, `users`, `contracts` are 1 `INSERT ... SELECT generate_series` each. `groups`, `members` are 1 statement. `enablePack` is 3 statements. `builders.int.test.ts` asserts 1 statement for 5 and 500 users and 3 for `enablePack` over 4 tenants. I ran it: 4 pass. The count is flat in row count.

## 4. `bootStack`

Closers are pushed in open order and run in reverse. The `catch` calls `close()` before rethrow, so a failing fixture, `createApp` or `Bun.serve` still closes what was opened. `close()` is idempotent (`closed ??=`). Individual closer errors are swallowed (see M-3).

## 5. Migrated N1/N3/HD1 `_support`

- Diff of the 3 files reads as pure helper extraction: `inPack`, `inHub`, `pgCode`, `percentile`, `literalize`, `seqScansIn` are re-exported with the same signatures. No `*.int.test.ts` changed, so no assertion changed.
- I reran `test:int:par` per suite. Before (from `tasks.md`) -> now: N1 101 -> 101, N2 27 -> 27, N3 46 -> 46, HD1 158 -> 158, HD2 18 -> 18.
- N3 had one run with 2 ordering failures ("mới nhất trước", `api.int.test.ts` lines 36 and 58) and then passed 3 runs in a row. See I-1.
- `tests/.lock`: exactly 3 rows changed (`HD1/_support/hd1.ts`, `N1/_support/n1.ts`, `N3/_support/n3.ts`). `bun run test:lock:verify` prints `test:lock OK (980 file)`.

## 6. Root dependency and `bun.lock`

`package.json` gains one line (`"@ai/test-kit": "workspace:*"`). `bun.lock` gains the root devDependency line, the `packages/test-kit` workspace block and its `workspace:` entry. No third-party version moved. This is minimal.

## Other gates I ran

`kit.test.ts` 11 pass. `tsc --noEmit` in `packages/test-kit` is clean. `builders.int.test.ts` 4 pass.

## Findings

| ID | Sev | Finding | Suggestion |
|---|---|---|---|
| M-1 | Minor | The RLS suite has no "move" case: `UPDATE ... SET tenant_id = <other>` on the caller's own row (WITH CHECK on UPDATE). The `WITH CHECK (true)` mutation was caught only through INSERT. A policy with a correct INSERT check but a loose UPDATE check would pass. | Add a case: B updates its own row to `tenant_id = A`, expect 42501 or 0 rows, and the row still belongs to B. |
| M-2 | Minor | Nothing prevents production code (`apps/*/src` non-test) from importing `@ai/test-kit`, whose `set_config` is parameterised. Today it is blocked only because no app declares the dependency. | Add a depcruise rule from `apps/**` and `packages/*` (except `test-kit`, tests and `_support`) to `packages/test-kit`. |
| M-3 | Minor | `bootStack.close()` swallows closer errors with `.catch(() => undefined)`. A leaked resource (for example the app `stop` failing) is invisible, against the TECH-DEBT #208 goal. | `console.warn` the error, or collect and rethrow after all closers ran. |
| I-1 | Info | One N3 `api.int.test.ts` ordering flake (2 tests) on the first run, not reproduced in 3 reruns. The helpers it uses are unchanged in behaviour and the failure is in product ordering under load. Not attributable to TK1, but worth watching in the wave gate. | Track; no action for TK1. |

No Blocker or Major, so the slice can close. Note: T6 (slice gate) in `tasks.md` is still unchecked.
