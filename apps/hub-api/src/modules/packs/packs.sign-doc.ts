// CR-181 · s8 phần A + s9 · cổng hub cho «Ký trên tài liệu» (gói contracts không import module hub — nối ở đây, như `recordRunFiles`):
//   · `onDocEnabled` = thiết lập chữ ký của công ty (module `signatures`, hub 0155);
//   · `companySigners` = `company_signers` của bước Ký (Q2) trong quy trình CỦA LƯỢT đang mở; HĐ còn Nháp ⇒ quy trình mà bộ chọn của lệnh
//     Gửi duyệt sẽ chọn (`signFlowHooks.plannedStages`, cùng `flowQuery` + `runPlanOf`);
//   · `turn` = lượt ký theo bước đang mở của lượt (BR-D1, luật thuần `signTurnOf`);
//   · s9 gắn `signFlowHooks`: chặn Gửi (BR-T2/C3), kiểm Đạt (BR-D2), bước Ký `ondoc` tự xong (BR-D3/C4, Q8) — `onDocSigned`.
// Perf: cổng lượt ký = 1 câu hub (+1 đọc Group khi có Group); kiểm Đạt = 1 câu thiết lập + 1 câu hub + 1 câu gói; ô Bên A = 1 câu gói. Không theo hàng.

import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { packRecordStepOf } from "../processes/public";
import { signaturesRepo } from "../signatures/public";
import { packAssignees } from "./contracts/adapters/manage.members";
import { signDocsRepo } from "./contracts/adapters/sign-docs.repo";
import { signFieldsRepo } from "./contracts/adapters/sign-fields.repo";
import { ondocCounts } from "./contracts/adapters/sign-flow.engine";
import type { CompanySigner } from "./contracts/application/sign-doc.usecase";
import { signFlowHooks } from "./contracts/application/sign-flow.hooks";
import type { SignHubPort } from "./contracts/application/sign-save.usecase";
import { signPartnerOf } from "./contracts/domain/event-flow-steps.rules";
import { signReadiness } from "./contracts/domain/sign.rules";
import type { SignTurnPort } from "./contracts/domain/sign-turn.port";
import {
  needsOnDoc,
  type OndocSigner,
  ondocADone,
  ondocDone,
  ondocKeys,
  ondocSignersIn,
  ondocStepAt,
  signBlockOf,
  signTurnOf,
} from "./contracts/domain/sign-turn.rules";
import type { PartnerSignPorts } from "./contracts/partner-sign.mount";
import type { SignDocPorts } from "./contracts/sign-doc.mount";
import { createPackUow, type PackAccessView } from "./kit/public";

type Who = { tenantId: string; userId: string };
const PACK = "contracts";
const stepOf = (db: Db, who: Who, contractId: string) =>
  packRecordStepOf(db, {
    tenantId: who.tenantId,
    packKey: PACK,
    recordId: contractId,
    userId: who.userId,
  });

function onDocEnabledOf(db: Db) {
  return (who: Who) =>
    withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      async (tx) => (await signaturesRepo(tx).getSettings()).settings.on_doc_enabled,
    );
}

/** Đọc của gói (scope tenant hệ thống, `tenant_id` tường minh trong câu). */
function packReads(db: Db) {
  const uow = createPackUow(db, PACK, (tx, t) => ({
    tx,
    t,
    docs: signDocsRepo(tx, t),
    fields: signFieldsRepo(tx, t),
  }));
  return {
    /** BR-D3/C4 · ô Bên A của người ký công ty (tệp còn cần ký): tổng + còn mở. Một câu. */
    /** BR-D3/C4 + CR-182 · ô Bên A của `keys` (tổng, còn mở) + ô Bên B (tổng, còn mở). Một câu. */
    ondocCounts: (tenantId: string, contractId: string, keys: readonly string[]) =>
      uow.system(tenantId, (r) => ondocCounts(r.tx, r.t, contractId, keys)),
    /** BR-D2 · tệp cần ký của HĐ + `actor` đã có bản chưa void Lưu trong lượt `runId` chưa. Một câu. */
    signedBy: (tenantId: string, contractId: string, runId: string, actor: string) =>
      uow.system(tenantId, (r) =>
        r.tx.execute<{ file_id: string; signed: boolean }>(sql`
          select d.file_id::text as file_id, exists (select 1 from contracts.sign_versions v
              where v.tenant_id = d.tenant_id and v.contract_id = d.contract_id and v.file_id = d.file_id
                and v.signed_by = ${actor}::uuid and v.run_id = ${runId}::uuid and v.voided_at is null) as signed
          from contracts.sign_docs d
          where d.tenant_id = ${r.t}::uuid and d.needs_sign and d.contract_id = ${contractId}::uuid
          order by d.set_at, d.file_id`),
      ),
    /** BR-C3 · tệp cần ký + chỗ ký của HĐ (2 câu). */
    prep: (tenantId: string, contractId: string) =>
      uow.system(tenantId, async (r) => {
        const [docs, fields] = await Promise.all([
          r.docs.listByContract(contractId),
          r.fields.listByContract(contractId),
        ]);
        return { docs, fields };
      }),
  };
}

/** CR-182 · «Đối tác ký»: bộ đếm bước Ký `ondoc` đang mở + thả bước khi đối tác ký đủ (gắn cho `partnerSignModule`). */
export function partnerSignPorts(db: Db): PartnerSignPorts {
  const reads = packReads(db);
  const NIL = "00000000-0000-0000-0000-000000000000";
  return {
    counts: async (tenantId, contractId) => {
      const s = await stepOf(db, { tenantId, userId: NIL }, contractId);
      if (!s) return null;
      const signers = ondocStepAt(s.stages, s.idx);
      if (!signers || signers.length === 0) return null;
      const c = await reads.ondocCounts(tenantId, contractId, ondocKeys(signers));
      return {
        a_done: ondocADone(c),
        b_total: c.b_total,
        b_open: c.b_open,
        run_id: s.runId,
      };
    },
    complete: async (tenantId, contractId) => {
      await signFlowHooks.completed?.(tenantId, contractId, {
        signed_at: new Date().toISOString(),
      });
    },
  };
}

export type SignFlow = {
  turn: SignTurnPort;
  /** Đường Lưu chữ ký gọi SAU COMMIT: bước Ký `ondoc` đang mở của đúng lượt ⇒ đủ ô Bên A thì thả bước. Không ném. */
  onDocSigned: (ctx: Who, contractId: string, runId: string) => Promise<void>;
};

/** s9 · gắn `signFlowHooks` + trả cổng lượt ký và `onDocSigned`. */
export function signFlowOf(db: Db): SignFlow {
  const reads = packReads(db);
  const onDoc = onDocEnabledOf(db);
  const fireIfDone = async (
    tenantId: string,
    contractId: string,
    signers: readonly OndocSigner[],
    by: string | null,
  ) => {
    if (signers.length === 0 || !signFlowHooks.completed) return;
    const c = await reads.ondocCounts(tenantId, contractId, ondocKeys(signers));
    // CR-182 · Bên A đủ nhưng còn chỗ Bên B ⇒ chưa thả bước: mời đối tác ký (link riêng); đối tác ký đủ mới thả (`partnerSignPorts.complete`).
    if (ondocADone(c) && c.b_open > 0)
      return void (await signFlowHooks.partnerStart?.(tenantId, contractId, by));
    if (!ondocDone(c)) return;
    await signFlowHooks.completed(tenantId, contractId, { signed_at: new Date().toISOString() });
  };
  const safe = (m: string, contractId: string) => (e: unknown) =>
    logger.warn(m, { contract_id: contractId, error: e instanceof Error ? e.name : "unknown" });
  signFlowHooks.beforePass = async (e) => {
    const who = { tenantId: e.tenantId, userId: e.actor };
    if (!(await onDoc(who))) return null;
    // HĐ của lượt = bản ghi gói của run (`pack_record_id`), một câu hub; không có ⇒ không áp.
    const [run] = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string | null }>(sql`select pack_record_id::text as id from hub.process_runs
        where id = ${e.runId}::uuid and tenant_id = ${e.tenantId}::uuid and pack_key = ${PACK}`),
    );
    if (!run?.id) return null;
    const files = await reads.signedBy(e.tenantId, run.id, e.runId, e.actor);
    const missing = files.filter((f) => !f.signed).map((f) => f.file_id);
    // Soát Opus #3: không có tệp cần ký ⇒ không coi là đã ký (luật cũ CR-170; chữ ký vẫn tự gắn theo Q4 nhờ `companyOn`).
    return { companyOn: true, onDoc: files.length > 0 && missing.length === 0, missing };
  };
  signFlowHooks.submitCheck = async (who, contractId, flows) => {
    const stages = flows.flat();
    if (!needsOnDoc(stages) || !(await onDoc(who))) return null;
    const { docs, fields } = await reads.prep(who.tenantId, contractId);
    const signers = ondocSignersIn(stages).map((s) => ({
      side: "A" as const,
      kind: s.kind,
      ref: s.id,
      name: "",
      mine: false,
    }));
    const files = docs.map((d) => ({ file_id: d.file_id, name: "", needs_sign: d.needs_sign }));
    return signBlockOf(signReadiness(files, fields, signers));
  };
  return {
    turn: {
      turnFor: async (ctx, contractId, userId) =>
        signTurnOf(await stepOf(db, { ...ctx, userId }, contractId), userId),
    },
    onDocSigned: async (ctx, contractId, runId) => {
      try {
        const s = await stepOf(db, ctx, contractId);
        if (!s || s.runId !== runId) return;
        await fireIfDone(ctx.tenantId, contractId, ondocStepAt(s.stages, s.idx) ?? [], ctx.userId);
      } catch (e) {
        safe("sign-ondoc-signed-failed", contractId)(e);
      }
    },
  };
}

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

/** Stage của quy trình áp cho HĐ: lượt đang mở ⇒ snapshot của lượt; còn Nháp ⇒ quy trình mà Gửi duyệt sẽ chọn. */
async function flowStagesOf(db: Db, who: Who, contractId: string): Promise<unknown[][]> {
  const s = await stepOf(db, who, contractId);
  if (s) return [s.stages];
  return (await signFlowHooks.plannedStages?.(who, contractId)) ?? [];
}

export function signDocPorts(db: Db, view: PackAccessView, flow?: SignFlow): SignDocPorts {
  const assignees = packAssignees(db, view, "contracts");
  return {
    onDocEnabled: onDocEnabledOf(db),
    hub: signHubPort(db, view),
    ...(flow ? { turn: flow.turn, onDocSigned: flow.onDocSigned } : {}),
    companySigners: async (who, contractId) => {
      const flows = await flowStagesOf(db, who, contractId);
      const signers =
        flows.map((f) => signPartnerOf(f).esign?.signers ?? []).find((s) => s.length > 0) ?? [];
      if (signers.length === 0) return [];
      const groupIds = signers.filter((s) => s.kind === "group").map((s) => s.id);
      const names = new Map((await assignees.list(who)).map((m) => [m.id, m.name]));
      const groups =
        groupIds.length === 0
          ? []
          : await withHubScope(db, { kind: "system" }, (tx) =>
              tx.execute<{ id: string; name: string; mine: boolean }>(sql`
                select g.id::text as id, coalesce(nullif(g.name ->> 'vi', ''), g.name ->> 'en', g.key) as name, exists (select 1 from admin.group_members m
                  where m.group_id = g.id and m.tenant_id = g.tenant_id and m.user_id = ${who.userId}::uuid) as mine
                from admin.groups g
                where g.tenant_id = ${who.tenantId}::uuid and g.id = any(${`{${groupIds.join(",")}}`}::uuid[])`),
            );
      const gBy = new Map(groups.map((g) => [g.id, g]));
      // Thành viên nhóm (tên) để nói đích danh người ký tiếp: một câu theo tập, chỉ khi có nhóm.
      const mem =
        groupIds.length === 0
          ? []
          : await withHubScope(db, { kind: "system" }, (tx) =>
              tx.execute<{ gid: string; uid: string; name: string }>(sql`
                select m.group_id::text as gid, u.id::text as uid, coalesce(nullif(u.display_name, ''), u.username) as name
                from admin.group_members m join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
                where m.tenant_id = ${who.tenantId}::uuid and m.group_id = any(${`{${groupIds.join(",")}}`}::uuid[])
                order by u.display_name, u.username`),
            );
      const memBy = new Map<string, { id: string; name: string }[]>();
      for (const m of mem)
        memBy.set(m.gid, [...(memBy.get(m.gid) ?? []), { id: m.uid, name: m.name }]);
      return signers.flatMap((s): CompanySigner[] => {
        if (s.kind === "user")
          return [{ kind: "user", id: s.id, name: names.get(s.id) ?? "Người ký" }];
        const g = gBy.get(s.id);
        const members = (memBy.get(s.id) ?? []).slice(0, 20);
        return g
          ? [
              {
                kind: "group",
                id: s.id,
                name: g.name,
                mine: g.mine,
                ...(members.length ? { members } : {}),
              },
            ]
          : [];
      });
    },
  };
}
