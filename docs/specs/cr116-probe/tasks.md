---
id: cr116-probe
lÃ¡t: cr116-probe
cr: CR-116
lÃ n: nhanh
migration: khÃ´ng
phá»¥ thuá»™c:
---
## Plan (ngáº¯n)
CÃ´ng cá»¥ Ä‘o, khÃ´ng Ä‘á»•i hÃ nh vi sáº£n pháº©m: ghi Má»˜T láº§n baseline (evotest `-Exclusive`), Ä‘áº·t probe á»Ÿ Ä‘iá»ƒm nÃ³ng, má»i thay Ä‘á»•i / phÆ°Æ¡ng Ã¡n A/B
cháº¡y láº¡i Ä‘Ãºng ká»‹ch báº£n vÃ  so vá»›i baseline Ä‘Ã£ lÆ°u (`perf/baseline/<ká»‹ch báº£n>.json`) thay vÃ¬ Ä‘o rá»i ráº¡c.
- Probe (táº¯t máº·c Ä‘á»‹nh, báº­t `PERF_PROBE=1`): TS `packages/db/src/probe.ts` (export `@ai/db/probe`; tap SQL gáº¯n vÃ o `createDb`), Python
  `agent_runtime/probe.py` (`ProbeConnection` gáº¯n vÃ o `create_pool`). DÃ²ng kv `t= e=probe.<tÃªn> ms= cpu= rss= sql= rt=`.
- Runner `bun run perf:probe|perf:baseline|perf:compare` (`tools/scripts/src/perf-probe*.ts`) gá»i `run-tests.ps1 -Step perf|py -Exclusive -Probe`.
- Ká»‹ch báº£n: `timer.fire` (PD-P01) Â· `remind` (PD-P13) Â· `expire` (PD-P14) Â· `chat.first-delta` (PF3, LLM giáº£) Â· `contracts.read` (HD-NFR-01)
  á»Ÿ `tests/perf-probe/`; `claim.n` á»Ÿ `apps/agent-runtime/tests/perf_probe/`. Fixture dÃ¹ng láº¡i cá»§a cÃ¡c perf test gá»‘c.

## LÃ m
- [x] Probe TS + tap SQL + unit (táº¯t â‡’ khÃ´ng ghi, micro-bench overhead).
- [x] Probe Python + unit; Ä‘iá»ƒm Ä‘o: `timer.fire`, `expire.runs`, `remind.once`, `contracts.list|detail`, `claim.one`.
- [x] Runner + luáº­t thuáº§n (gom p50/p95/mean, spread, so sÃ¡nh, báº£ng â‰¤ 15 dÃ²ng) + unit.
- [x] Glue evotest: `-Probe`, `-Exclusive` cho `-Step py`, `EVO_PROBE` â†’ `PERF_PROBE`/`PERF_PROBE_OPTS`.
- [x] Docs `docs/WORKFLOW.md` "Äo perf: baseline + probe + compare".
- [ ] Baseline ban Ä‘áº§u (xem "Viá»‡c cÃ²n láº¡i").

## KhÃ´ng lÃ m / Cháº¡m
KhÃ´ng Ä‘á»•i hÃ nh vi prod: cÃ¡c Ä‘iá»ƒm Ä‘o chá»‰ bá»c lá»i gá»i hiá»‡n cÃ³ (`probe(name, fn)` = `fn()` khi táº¯t). Cháº¡m: `packages/db/src/client.ts`
(thÃªm `debug` chá»‰ khi báº­t), `sweeps.ts`, `reminder.ts`, `list-contracts.usecase.ts`, `get-contract.usecase.ts`, `jobs_sql.py`, `pool.py`,
`deploy/evotest/*`. KhÃ´ng Ä‘á»•i test khoÃ¡ (`tests/acceptance`).

## Test tá»‘i thiá»ƒu
Unit: `packages/db/src/probe.test.ts`, `tools/scripts/src/perf-probe.rules.test.ts`, `apps/agent-runtime/src/agent_runtime/test_probe.py`.
Ká»‹ch báº£n lÃ  perf test (cháº¡y báº±ng runner, ngoÃ i `test:int`/`test:perf` vÃ¬ `describe.skipIf(!PERF_PROBE)`).

## Quyáº¿t Ä‘á»‹nh trong lÃºc lÃ m
- `rt` (round trip) = sá»‘ Ä‘á»£t cÃ¢u gá»­i theo tá»«ng káº¿t ná»‘i trong cÃ¹ng má»™t lÆ°á»£t event-loop (postgres.js khÃ´ng cÃ³ hook "xong cÃ¢u"); cÃ¢u pipeline
  cÃ¹ng káº¿t ná»‘i cÃ¹ng tick tÃ­nh 1. Python: má»—i lá»i gá»i asyncpg = 1 (khÃ´ng pipeline).
- cpu/rss/sql/rt lÃ  sá»‘ toÃ n tiáº¿n trÃ¬nh trong khoáº£ng probe â‡’ ká»‹ch báº£n cháº¡y tuáº§n tá»±.
- Noise guard: cáº§n â‰¥ 3 lÆ°á»£t má»—i bÃªn; Î” p50 > 10% chá»‰ Ä‘á» khi vÆ°á»£t spread (max-min cá»§a p50 theo lÆ°á»£t / trung vá»‹) cá»§a hai bÃªn; sá»‘ cÃ¢u SQL tÄƒng
  > 10% luÃ´n Ä‘á» (táº¥t Ä‘á»‹nh).
- Má»i ká»‹ch báº£n `perf` gá»™p má»™t lÆ°á»£t evotest (má»™t khoÃ¡ `-Exclusive`); `py` má»™t lÆ°á»£t riÃªng.

## Delta (so vá»›i docs/current)
Tráº¡ng thÃ¡i gá»™p: chÆ°a gá»™p

KhÃ´ng thay Ä‘á»•i hÃ nh vi (lÃ½ do: cÃ´ng cá»¥ Ä‘o â€” probe táº¯t máº·c Ä‘á»‹nh, báº­t báº±ng PERF_PROBE=1 chá»‰ ghi dÃ²ng log, khÃ´ng Ä‘á»•i káº¿t quáº£ nghiá»‡p vá»¥)

## Viá»‡c cÃ²n láº¡i
- Baseline láº§n Ä‘áº§u ghi báº±ng `bun run perf:baseline --scenario all` (xem commit `perf/baseline/*.json`).
- CR-116 A/B: phÆ°Æ¡ng Ã¡n = cÃ¹ng ká»‹ch báº£n, `bun run perf:compare --scenario <tÃªn>`.
