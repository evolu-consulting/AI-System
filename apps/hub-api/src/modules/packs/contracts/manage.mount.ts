// gap-a1 · nối nhóm "quản lý trên trang chi tiết HĐ" (lớp 4): lịch sử, giao người phụ trách, hoa hồng %, tóm tắt AI.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import type { PackAccessView, PackGuardVars } from "../kit/public";
import { createPackUow, packTenantOnly } from "../kit/public";
import { EXTRACT_MODEL } from "./adapters/ai-transport";
import { packAssignees } from "./adapters/manage.members";
import { manageRepo } from "./adapters/manage.repo";
import { manageRoutes } from "./adapters/manage.routes";
import { changesRepo, versionDiffRepo, versionsRoutes } from "./adapters/versions.routes";
import { changesSinceLastOf } from "./application/changes-since-last.usecase";
import { assignOwner, editCommission, getHistory, summarize } from "./application/manage.usecase";
import { versionDiff } from "./application/version-diff.usecase";

const KEY = "contracts";

export function manageModule(
  db: Db,
  view: PackAccessView,
  d: { ai: AiClient; quota?: (tenantId: string) => Promise<void> },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, KEY, manageRepo));
  const members = packAssignees(db, view, KEY);
  const diffUow = packTenantOnly(createPackUow(db, KEY, versionDiffRepo));
  const changesUow = packTenantOnly(createPackUow(db, KEY, changesRepo));
  const r = manageRoutes(view, {
    history: getHistory({ uow }),
    assignees: members.list,
    assign: assignOwner({ uow, assignable: members.assignable }),
    commission: editCommission({ uow }),
    summarize: summarize({
      uow,
      ai: d.ai,
      model:
        process.env.CONTRACTS_SUMMARY_MODEL || process.env.CONTRACTS_EXTRACT_MODEL || EXTRACT_MODEL,
    }),
    ...(d.quota ? { quota: d.quota } : {}),
  });
  // CR-097 K2 · UC-04 so sánh hai phiên bản · CR-127 K5 · BR-36a "Đã đổi so với lần trước".
  r.route(
    "/",
    versionsRoutes(view, versionDiff({ uow: diffUow }), changesSinceLastOf({ uow: changesUow })),
  );
  return r;
}
