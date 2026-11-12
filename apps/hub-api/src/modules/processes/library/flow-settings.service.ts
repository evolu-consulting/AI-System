// CR-122 · P7 · cờ "dùng quy trình mới" theo công ty (`hub.tenant_flow_settings.flow_triggers`). platform_admin + quản trị công ty đó (CR-123 FR-09; kiểm ở đây);
// mỗi lần ĐỔI giá trị ghi audit (ai · lúc nào · cũ → mới) qua `withConfigWrite`; đặt lại đúng giá trị cũ ⇒ không ghi.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import { claimError } from "../core/errors";
import { CLAIM_HOURS, claimHoursOk } from "../domain/tasks/claim.rules";
import { flowTriggersOn, setFlowTriggers } from "../triggers/flags";
import { libError } from "./library-draft";
import { withConfigWrite } from "./routing.service";

export type FlowSettings = {
  flow_triggers: boolean;
  has_active_flow: boolean;
  claim_release_h: number;
};

/** CR-127 · E2 · giờ tự trả việc đã nhận (chưa có hàng ⇒ mặc định 24). */
async function claimHours(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.execute<{ h: number }>(
    sql`select claim_release_h as h from hub.tenant_flow_settings where tenant_id = ${tenantId}::uuid`,
  );
  return Number(r[0]?.h ?? CLAIM_HOURS.default);
}

async function hasActiveFlow(tx: Tx, tenantId: string): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(
    sql`select exists (select 1 from hub.company_flows where tenant_id = ${tenantId}::uuid and enabled) as ok`,
  );
  return r[0]?.ok === true;
}

export class FlowSettingsService {
  constructor(private readonly db: Db) {}

  /** CR-123 · FLOW3-FR-09: platform_admin (mọi công ty) hoặc tenant_admin CỦA CHÍNH công ty đó; người dùng khác 403. */
  #guard(u: AuthUser, tenantId: string): void {
    if (u.role === "platform_admin") return;
    if (u.role === "tenant_admin" && u.tenantId === tenantId) return;
    throw appError("FORBIDDEN");
  }

  async get(u: AuthUser, tenantId: string): Promise<FlowSettings> {
    this.#guard(u, tenantId);
    return withHubScope(this.db, { kind: "system" }, async (tx) => ({
      flow_triggers: await flowTriggersOn(tx, tenantId),
      has_active_flow: await hasActiveFlow(tx, tenantId),
      claim_release_h: await claimHours(tx, tenantId),
    }));
  }

  /** CR-127 · E2 · `PUT … {claim_release_h}` (1..168, ngoài ⇒ 422 `CLAIM_HOURS_RANGE`); đổi giá trị ⇒ ghi audit (cũ → mới). */
  async putClaimHours(u: AuthUser, tenantId: string, h: number): Promise<void> {
    this.#guard(u, tenantId);
    if (!claimHoursOk(h)) throw claimError("CLAIM_HOURS_RANGE");
    await withConfigWrite({ db: this.db, audit: dbHubAudit }, u, async (tx) => {
      const before = await claimHours(tx, tenantId);
      if (before === h) return { result: null, audit: null };
      await tx.execute(sql`insert into hub.tenant_flow_settings (tenant_id, claim_release_h) values (${tenantId}::uuid, ${h})
        on conflict (tenant_id) do update set claim_release_h = excluded.claim_release_h, updated_at = now()`);
      return {
        result: null,
        audit: {
          tenantId,
          action: "update",
          entity: "process_def",
          entityId: null,
          entityName: "claim_release_h",
          before: { claim_release_h: before },
          after: { claim_release_h: h },
          summary: { setting: "claim_release_h" },
        },
      };
    });
  }

  async put(u: AuthUser, tenantId: string, on: boolean): Promise<FlowSettings> {
    this.#guard(u, tenantId);
    await withConfigWrite({ db: this.db, audit: dbHubAudit }, u, async (tx) => {
      const before = await flowTriggersOn(tx, tenantId);
      if (before === on) return { result: null, audit: null };
      // CR-123 FR-09: quản trị công ty không tự gán quy trình ⇒ không cho bật khi chưa có quy trình nào đang áp dụng
      if (on && !(await hasActiveFlow(tx, tenantId))) throw libError("FLOW_NONE_ASSIGNED");
      await setFlowTriggers(tx, tenantId, on);
      return {
        result: null,
        audit: {
          tenantId,
          action: "update",
          entity: "process_def",
          entityId: null,
          entityName: "flow_triggers",
          before: { flow_triggers: before },
          after: { flow_triggers: on },
          summary: { setting: "flow_triggers" },
        },
      };
    });
    return this.get(u, tenantId);
  }
}
