// HUB-FR-116 · HUB-FR-117 · AC-H34 · C5 · HUB-BR-25 · PF4 · `GET /process-runs/:id/usage` (plan §5, §6, plan-contract §2).
// Quyền trước, dữ liệu sau: (1) scope `user` ⇒ `hub.process_run_viewer` trả 'full'/'task'/NULL (§5 + U5); NULL ⇒ 404 (không
// lộ tồn tại, kể cả tenant khác). (2) scope `system` ⇒ đọc usage (run_steps RLS chủ run). `task` ⇒ `detail=summary` (chỉ
// tổng, không chi tiết lần gọi). Lộ usage của tenant/người khác = hard stop ⇒ chặn ngay ở bước (1).

import { UuidSchema } from "@ai/contracts";
import type { ProcessRunUsage } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { loadStageMetas, loadUsageRows } from "./usage.repo";
import { buildUsage } from "./usage.rules";

type Access = "full" | "task" | null;

export class UsageService {
  readonly #d: ProcessDeps;
  constructor(d: ProcessDeps) {
    this.#d = d;
  }

  /** platform_admin chọn tenant qua `?tenant_id`; vai khác luôn tenant của mình (`?tenant_id` bỏ qua ⇒ 404 nếu run tenant khác). */
  #tenantOf(user: AuthUser, queryTenantId: string | undefined): string {
    if (user.role === "platform_admin" && queryTenantId) {
      if (!UuidSchema.safeParse(queryTenantId).success) throw appError("NOT_FOUND");
      return queryTenantId;
    }
    return user.tenantId;
  }

  #viewer(tenantId: string, userId: string, runId: string): Promise<Access> {
    return withHubScope(this.#d.db, { kind: "user", tenantId, userId }, async (tx) => {
      const [row] = await tx.execute<{ viewer: Access }>(
        sql`select hub.process_run_viewer(${runId}::uuid) as viewer`,
      );
      return row?.viewer ?? null;
    });
  }

  async get(
    user: AuthUser,
    runId: string,
    queryTenantId: string | undefined,
  ): Promise<ProcessRunUsage> {
    const tenantId = this.#tenantOf(user, queryTenantId);
    const access = await this.#viewer(tenantId, user.userId, runId);
    if (!access) throw appError("NOT_FOUND");
    const detail = access === "full" ? "full" : "summary";
    const { rows, stages } = await withHubScope(this.#d.db, { kind: "system" }, async (tx) => ({
      rows: await loadUsageRows(tx, tenantId, runId),
      stages: await loadStageMetas(tx, tenantId, runId),
    }));
    return buildUsage(rows, stages, detail, runId);
  }
}
