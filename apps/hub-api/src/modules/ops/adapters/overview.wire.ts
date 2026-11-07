// CR-121 · nối service Tổng quan với nguồn SQL/file (adapter): route và test dựng service qua đây, application không biết Db.
import type { Db } from "@ai/db";
import { appError } from "../../../lib/errors";
import { makeOverviewService, type OverviewService } from "../application/overview.service";
import { overviewSource } from "./overview.source";

export type OverviewWireDeps = { db: Db; statusDir?: string; now?: () => Date };

export function makeOverviewServiceFor(d: OverviewWireDeps): OverviewService {
  return makeOverviewService({
    source: overviewSource(d),
    forbidden: () => appError("FORBIDDEN"),
    ...(d.now ? { now: d.now } : {}),
  });
}
