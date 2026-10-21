// gap-a1 · nối nhóm "quản lý trên trang chi tiết HĐ" (lớp 4): lịch sử, giao người phụ trách, hoa hồng %, tóm tắt AI.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { EXTRACT_MODEL } from "./adapters/ai-transport";
import { packAssignees } from "./adapters/manage.members";
import { manageRepo } from "./adapters/manage.repo";
import { manageRoutes } from "./adapters/manage.routes";
import { assignOwner, editCommission, getHistory, summarize } from "./application/manage.usecase";

const KEY = "contracts";

export function manageModule(
  db: Db,
  view: PackAccessView,
  d: { ai: AiClient; quota?: (tenantId: string) => Promise<void> },
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, KEY, manageRepo));
  const members = packAssignees(db, view, KEY);
  return manageRoutes(view, {
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
}
