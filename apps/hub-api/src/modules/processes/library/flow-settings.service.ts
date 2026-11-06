// CR-122 · P7 · cờ "dùng quy trình mới" theo công ty (`hub.tenant_flow_settings.flow_triggers`). Chỉ platform_admin (kiểm ở đây);
// mỗi lần ĐỔI giá trị ghi audit (ai · lúc nào · cũ → mới) qua `withConfigWrite`; đặt lại đúng giá trị cũ ⇒ không ghi.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { dbHubAudit } from "../../../lib/hub-audit";
import { flowTriggersOn, setFlowTriggers } from "../triggers/flags";
import { withConfigWrite } from "./routing.service";

export type FlowSettings = { flow_triggers: boolean };

export class FlowSettingsService {
  constructor(private readonly db: Db) {}

  #guard(u: AuthUser): void {
    if (u.role !== "platform_admin") throw appError("FORBIDDEN");
  }

  async get(u: AuthUser, tenantId: string): Promise<FlowSettings> {
    this.#guard(u);
    return withHubScope(this.db, { kind: "system" }, async (tx) => ({
      flow_triggers: await flowTriggersOn(tx, tenantId),
    }));
  }

  async put(u: AuthUser, tenantId: string, on: boolean): Promise<FlowSettings> {
    this.#guard(u);
    await withConfigWrite({ db: this.db, audit: dbHubAudit }, u, async (tx) => {
      const before = await flowTriggersOn(tx, tenantId);
      if (before === on) return { result: null, audit: null };
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
    return { flow_triggers: on };
  }
}
