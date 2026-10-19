// N2-FR-01 · N2-D07 · mẫu khởi chạy run quy trình cho một bản ghi `pkdemo.items` (khuôn cho HD3: hợp đồng ↔ run duyệt).

import {
  type OwnedRunOutcome,
  ownedRunOutcome,
} from "../../kit/application/pack-run-outcome.usecase";
import type { PackRunCaller, PackRunRequest } from "../../kit/application/pack-runs.ports";
import {
  type StartPackRunDeps,
  type StartPackRunResult,
  startPackRun,
} from "../../kit/application/start-pack-run.usecase";
import type { PkdemoRepos } from "./ports";

export type StartItemRun = (
  u: PackRunCaller,
  itemId: string,
  req: PackRunRequest,
) => Promise<StartPackRunResult>;

export function startItemRun(d: StartPackRunDeps<PkdemoRepos>): StartItemRun {
  return (u, itemId, req) =>
    startPackRun(d, u, req, {
      async check(r) {
        const run = await r.items.runOf(itemId);
        if (run === undefined) return "not_found";
        return run === null ? "ok" : "has_run";
      },
      attach: (r, runId) => r.items.attachRun(itemId, runId),
    });
}

/** N2-D08 · security L3: kết quả run mà item đang giữ (id đọc trong tx gói). */
export type ItemRunOutcome = (u: PackRunCaller, itemId: string) => Promise<OwnedRunOutcome>;

export function itemRunOutcome(d: StartPackRunDeps<PkdemoRepos>): ItemRunOutcome {
  return (u, itemId) => ownedRunOutcome(d, u, (r) => r.items.runOf(itemId));
}
