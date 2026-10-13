// HUB-FR-77 · HUB-FR-78 · HUB-BR-17 · spec H4b2 §3 C · plan D2, §3.5 · Quyền agent (Studio, chỉ platform_admin — role chặn
// ở `app.h4a.ts`). Đọc: một transaction REPEATABLE READ read only (scope `system`) ⇒ ma trận và `hub_config_version`
// cùng một ảnh. Ghi: gọi NGUYÊN `AgentSettingsService.putEntitlement` (khoá config → ghi/khôi phục `revoked_at` → bump →
// audit → NOTIFY; lỗi giữ nguyên mã) rồi đếm grant của ô sau commit (`affected_grants`, chỉ để hiển thị).
import {
  ENTITLEMENT_GRANTS_MAX,
  ENTITLEMENT_MATRIX_MAX,
  type EntitlementCellDetail,
  type EntitlementMatrix,
  type EntitlementWriteResult,
} from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import type { AgentSettingsService } from "../../agent-settings/agent-settings.service";
import { readHubVersion } from "../studio-read.repo";
import { toCellDetail, toMatrix } from "./entitlements.map";
import {
  countCellGrants,
  readActiveEntitlements,
  readAgent,
  readCellEntitlement,
  readCellGrants,
  readGrantCounts,
  readMatrixAgents,
  readMatrixTenants,
  readTenant,
} from "./entitlements.repo";

export type EntitlementsDeps = {
  db: Db;
  settings: Pick<AgentSettingsService, "putEntitlement">;
};

export class EntitlementsService {
  constructor(private readonly d: EntitlementsDeps) {}

  #read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  matrix(): Promise<EntitlementMatrix> {
    return this.#read(async (tx) =>
      toMatrix(
        {
          agents: await readMatrixAgents(tx, ENTITLEMENT_MATRIX_MAX),
          tenants: await readMatrixTenants(tx, ENTITLEMENT_MATRIX_MAX),
          ents: await readActiveEntitlements(tx, ENTITLEMENT_MATRIX_MAX),
          grantCounts: await readGrantCounts(tx, ENTITLEMENT_MATRIX_MAX),
          version: await readHubVersion(tx),
        },
        ENTITLEMENT_MATRIX_MAX,
      ),
    );
  }

  /** Agent hoặc tenant vắng ⇒ 404. */
  cell(agentId: string, tenantId: string): Promise<EntitlementCellDetail> {
    return this.#read(async (tx) => {
      const agent = await readAgent(tx, agentId);
      const tenant = await readTenant(tx, tenantId);
      if (!agent || !tenant) throw appError("NOT_FOUND");
      return toCellDetail(
        {
          agent,
          tenant,
          ent: await readCellEntitlement(tx, agentId, tenantId),
          grants: await readCellGrants(tx, agentId, tenantId, ENTITLEMENT_GRANTS_MAX),
        },
        ENTITLEMENT_GRANTS_MAX,
      );
    });
  }

  /** PUT ⇒ cấp (idempotent), DELETE ⇒ thu hồi. Lỗi của `putEntitlement` (404/400/409) đi thẳng ra. */
  async set(
    actor: AuthUser,
    agentId: string,
    tenantId: string,
    entitled: boolean,
  ): Promise<EntitlementWriteResult> {
    const { hub_config_version } = await this.d.settings.putEntitlement(
      actor,
      tenantId,
      agentId,
      entitled,
    );
    const affected = await this.#read((tx) => countCellGrants(tx, agentId, tenantId));
    return { hub_config_version, affected_grants: affected };
  }
}
