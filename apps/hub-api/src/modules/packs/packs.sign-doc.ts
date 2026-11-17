// CR-181 · s8 phần A · cổng hub cho «Ký trên tài liệu» (gói contracts không import module hub — nối ở đây, như `recordRunFiles`):
//   · `onDocEnabled` = thiết lập chữ ký của công ty (module `signatures`, hub 0155);
//   · `companySigners` = `company_signers` của bước Ký trong quy trình `contract.submitted` đang bật (Q2). Chưa có lượt: lấy quy trình
//     Bật đầu tiên (theo `position`) có bước Ký; lát s9 sẽ chọn đúng quy trình của lượt khi HĐ đã gửi duyệt.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { eventFlowsOf } from "../processes/public";
import { signaturesRepo } from "../signatures/public";
import { packAssignees } from "./contracts/adapters/manage.members";
import type { CompanySigner } from "./contracts/application/sign-doc.usecase";
import type { SignHubPort } from "./contracts/application/sign-save.usecase";
import { signPartnerOf } from "./contracts/domain/event-flow-steps.rules";
import type { SignDocPorts } from "./contracts/sign-doc.mount";
import type { PackAccessView } from "./kit/public";

const FLOW_EVENT = "contract.submitted";

/** Cổng hub của Lưu chữ ký (BR-K3): chữ ký đang dùng của ĐÚNG người gọi (`hub.signature_for_stamp`), thiết lập, họ tên + chức vụ (CR-147), audit `document_signed`. */
export function signHubPort(db: Db, view: PackAccessView): SignHubPort {
  const assignees = packAssignees(db, view, "contracts");
  return {
    prepare: (who) =>
      withHubScope(db, { kind: "user", tenantId: who.tenantId, userId: who.userId }, async (tx) => {
        const repo = signaturesRepo(tx);
        const { settings: s } = await repo.getSettings();
        const [p] = await tx.execute<{ name: string | null; title: string | null }>(sql`
          select u.display_name as name, (select pp.job_title from hub.people_profiles pp
            where pp.tenant_id = u.tenant_id and pp.user_id = u.id) as title
          from admin.users u where u.id = ${who.userId}::uuid and u.tenant_id = ${who.tenantId}::uuid`);
        const main = await repo.signatureForStamp(who.tenantId, who.userId, "main");
        const initials = await repo.signatureForStamp(who.tenantId, who.userId, "initials");
        return {
          settings: { ink: s.ink, caption: s.caption, initials: s.initials },
          name: p?.name ?? "",
          title: p?.title ?? null,
          main: main ? { id: main.id, png: main.png } : null,
          initials: initials ? { id: initials.id, png: initials.png } : null,
        };
      }),
    audit: (who, e) =>
      withHubScope(db, { kind: "user", tenantId: who.tenantId, userId: who.userId }, async (tx) => {
        await tx.execute(sql`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name, summary)
          values (${who.tenantId}::uuid, ${who.userId}::uuid, 'member', 'document_signed', 'signature', ${e.versionId}::uuid,
            ${e.fileName.slice(0, 200)}, ${JSON.stringify(e.summary)}::jsonb)`);
      }).catch((err: unknown) => {
        logger.warn("sign-audit-failed", { versionId: e.versionId, message: String(err) });
      }),
    userNames: async (who, ids) => {
      const want = new Set(ids);
      return new Map(
        (await assignees.list(who)).filter((m) => want.has(m.id)).map((m) => [m.id, m.name]),
      );
    },
  };
}

export function signDocPorts(db: Db, view: PackAccessView): SignDocPorts {
  const assignees = packAssignees(db, view, "contracts");
  return {
    hub: signHubPort(db, view),
    onDocEnabled: (who) =>
      withHubScope(
        db,
        { kind: "user", tenantId: who.tenantId, userId: who.userId },
        async (tx) => (await signaturesRepo(tx).getSettings()).settings.on_doc_enabled,
      ),
    companySigners: async (who) => {
      const flows = await eventFlowsOf(db, who.tenantId, FLOW_EVENT);
      const signers =
        flows.map((f) => signPartnerOf(f.stages).esign?.signers ?? []).find((s) => s.length > 0) ??
        [];
      if (signers.length === 0) return [];
      const groupIds = signers.filter((s) => s.kind === "group").map((s) => s.id);
      const names = new Map((await assignees.list(who)).map((m) => [m.id, m.name]));
      const groups =
        groupIds.length === 0
          ? []
          : await withHubScope(db, { kind: "system" }, (tx) =>
              tx.execute<{ id: string; name: string; mine: boolean }>(sql`
                select g.id::text as id, g.name, exists (select 1 from admin.group_members m
                  where m.group_id = g.id and m.tenant_id = g.tenant_id and m.user_id = ${who.userId}::uuid) as mine
                from admin.groups g
                where g.tenant_id = ${who.tenantId}::uuid and g.id = any(${`{${groupIds.join(",")}}`}::uuid[])`),
            );
      const gBy = new Map(groups.map((g) => [g.id, g]));
      return signers.flatMap((s): CompanySigner[] => {
        if (s.kind === "user")
          return [{ kind: "user", id: s.id, name: names.get(s.id) ?? "Người ký" }];
        const g = gBy.get(s.id);
        return g ? [{ kind: "group", id: s.id, name: g.name, mine: g.mine }] : [];
      });
    },
  };
}
