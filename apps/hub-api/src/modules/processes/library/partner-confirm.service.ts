// CR-125 · UX-S7 (H7) · phần HUB của danh sách điều kiện "Đối tác xác nhận hợp đồng": kênh hộp thư, flow nhận/gửi, nhóm duyệt của flow nhận.
// Tái dùng đúng nguồn có sẵn: `listCompanyFlows` (flow công ty) + `readinessOf` (nhóm mẫu thiếu — cùng luật Gán/Sao chép) — không đường thứ hai.
// Hồ sơ công ty / entitlement do admin-api đọc (Hub không có đường đọc hồ sơ — PII); admin-api gộp bằng `partnerChecklist`. Ba câu SQL cố định.
import type { PartnerHubPart } from "@ai/contracts/modules";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { PackToolCatalog } from "../../packs/kit/public";
import * as r from "./company-flows.repo";
import { companyAccess } from "./library-company.service";
import { readinessOf } from "./template-readiness";

export const RECEIVE_EVENT = "contract.received";
const PARTNER_NODE = "contracts.partner-send";

export class PartnerConfirmService {
  constructor(
    private readonly db: Db,
    /** Đọc theo từng lần gọi (cờ do mount đặt; test đổi được). */
    private readonly channelOn: () => boolean,
    private readonly packTools?: PackToolCatalog,
  ) {}

  /** Platform_admin hoặc quản trị CHÍNH công ty (`companyAccess`); member 403. Chỉ đọc. */
  readiness(u: AuthUser, tid: string): Promise<PartnerHubPart> {
    companyAccess(u, tid);
    return withHubScope(this.db, { kind: "system" as const }, async (tx) => {
      const [rows, send] = await Promise.all([
        r.listCompanyFlows(tx, tid),
        tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.company_flows cf
          join hub.process_defs d on d.id = cf.flow_id and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
          where cf.tenant_id = ${tid}::uuid and cf.enabled and d.deleted_at is null
            and d.stages @> ${JSON.stringify([{ node: PARTNER_NODE }])}::jsonb`),
      ]);
      // CR-138b: không còn mẫu Thư viện (CR-127, hub 0138) ⇒ nhóm xác nhận đọc từ quy trình NHẬN của chính công ty.
      const recv = rows.find(
        (x) => x.enabled && x.trigger_event === RECEIVE_EVENT && !x.has_condition,
      );
      const groups = recv ? await this.#groups(tx, tid, recv.flow_id) : [];
      return {
        channel: this.channelOn(),
        receive_flow: recv !== undefined,
        send_flow: (send[0]?.n ?? 0) > 0,
        groups,
      };
    });
  }

  /** Nhóm duyệt mà quy trình nhận của công ty trỏ tới: thiếu (chưa có nhóm) hoặc có nhưng chưa ai là thành viên. */
  async #groups(
    tx: Parameters<typeof readinessOf>[0],
    tid: string,
    flowId: string,
  ): Promise<PartnerHubPart["groups"]> {
    const [def] = await tx.execute<{
      stages: unknown[];
    }>(sql`select rel.stages from hub.process_defs d
      join hub.process_def_releases rel on rel.def_id = d.id and rel.rel_version = d.published_version
      where d.id = ${flowId}::uuid`);
    if (!def) return [];
    const rd = await readinessOf(tx, tid, def.stages, this.packTools);
    const mapped = Object.entries(rd.groupMap); // [mã mẫu, mã nhóm thật]
    const counts = mapped.length
      ? await tx.execute<{ key: string; n: number }>(sql`select g.key, count(gm.user_id)::int as n
          from admin.groups g left join admin.group_members gm on gm.group_id = g.id and gm.tenant_id = g.tenant_id
          where g.tenant_id = ${tid}::uuid
            and g.key in (select jsonb_array_elements_text(${JSON.stringify(mapped.map((m) => m[1]))}::jsonb))
          group by g.key`)
      : [];
    const n = new Map(counts.map((c) => [c.key, c.n]));
    return [
      ...mapped.map(([tpl, real]) => ({ key: tpl, exists: true, members: n.get(real) ?? 0 })),
      ...rd.missing.groups.map((key) => ({ key, exists: false, members: 0 })),
    ];
  }
}
