// CR-121 · cr121-c3a-overview-api · hiện thực cổng `OverviewSource`: SÁU câu SQL (overview.repo) trong MỘT tx scope system + đọc
// `host.json`. Giữ nguyên thứ tự/số câu của bản cũ (Luật 4c); đo `pingMs` quanh câu Q5.
import { OpsHostStatusSchema } from "@ai/contracts/hub-admin";
import type { Db } from "@ai/db";
import type { OverviewSource } from "../application/overview.ports";
import { readStatusFile, systemRead } from "./checks/check-kit";
import {
  companiesAgg,
  difyAgg,
  flowCoverageLatest,
  infraAgg,
  quotaAgg,
  runsAgg,
} from "./overview.repo";

export function overviewSource(d: { db: Db; statusDir?: string }): OverviewSource {
  return {
    read: (win, stuckBefore, month, quotaPct) =>
      systemRead(d.db, async (tx) => {
        const runs = await runsAgg(tx, win, stuckBefore);
        const dify = await difyAgg(tx, win);
        const quota = await quotaAgg(tx, win, month, quotaPct);
        const cos = await companiesAgg(tx, win);
        const t0 = performance.now();
        const infra = await infraAgg(tx, win.now);
        const pingMs = Math.round(performance.now() - t0);
        const cov = await flowCoverageLatest(tx);
        return { runs, dify, quota, cos, infra, pingMs, cov };
      }),
    hostStatus: () => readStatusFile(d, "host.json", OpsHostStatusSchema),
  };
}
