// CR-124 · q3 · nối gói Hợp đồng vào hộp thư liên công ty (spec §7): (1) tool `contracts-partner-send` + node «Gửi đối tác xác nhận» (sổ module);
// (2) cổng cho bộ chuyển hub `partners/`: NHẬN = mở tx scope tenant nhận, lấy lô, tạo HĐ nhận `source='partner_inbox'` + `contract.received`
// CÙNG tx; GỬI = đóng lần gửi + `signalEvent('partner.<kết quả>')` cho node chờ (qua cổng engine `packRuns`, gắn lười). Bộ chuyển chỉ chạy khi
// `HUB_PARTNER_MAILBOX=on` (mặc định tắt) — gọi `mountPartnerSend` luôn vô hại (chỉ đăng ký).
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import {
  createPackUow,
  moduleRegistry,
  type PackRunsBridge,
  type PackToolDef,
  type PartnerReplyRow,
  partnerMailboxPort,
} from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { type InboxItem, partnerInboxRepo } from "./adapters/partner-inbox.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { finalImportance, importanceByValue, sharedValueOf } from "./domain/partner-send.rules";
import { partnerSendBinding } from "./nodes/partner-send/binding";

const PACK = "contracts";

/** Lô lấy từ hộp thư ⇒ mục HĐ nhận: mức cuối = max(gợi ý A, luật bên nhận theo giá trị) — bên nhận không tin mức A tự khai (FR-08). */
export function inboxItemsOf(
  rows: Awaited<ReturnType<ReturnType<typeof partnerInboxRepo>["take"]>>,
): InboxItem[] {
  return rows.map((row) => {
    const p = row.payload;
    const shared = ((p.fields as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    const fields: Record<string, { value: unknown }> = {};
    for (const [k, v] of Object.entries(shared)) fields[k] = { value: v };
    const title =
      typeof p.title === "string" && p.title ? p.title : `Hợp đồng từ ${row.senderName}`;
    return {
      contractId: Bun.randomUUIDv7(),
      row,
      importance: finalImportance(p.importance_hint, importanceByValue(sharedValueOf(shared))),
      title,
      fields,
      shared,
      message: typeof p.message === "string" ? p.message : null,
    };
  });
}

/** Tenant NHẬN: 3 câu cố định mỗi lô, một tx scope tenant (system user null). */
export function receiveInbox(db: Db) {
  return (tenantId: string, limit: number): Promise<number> =>
    withPackScope(db, { packKey: PACK, tenantId, userId: null }, async (tx: Tx) => {
      const repo = partnerInboxRepo(tx, tenantId);
      const items = inboxItemsOf(await repo.take(limit));
      const n = await repo.insertBatch(items);
      await repo.emitReceived(items);
      return n;
    });
}

/** Tenant GỬI: nhóm theo tenant, mỗi tenant 1 câu đóng lần gửi; rồi 1 `signalEvent` mỗi trả lời (idempotent, thả stage chờ đúng một lần). */
export function onPartnerReplies(db: Db, packRuns: () => PackRunsBridge | undefined) {
  return async (rows: readonly PartnerReplyRow[]): Promise<void> => {
    const by = new Map<string, PartnerReplyRow[]>();
    for (const r of rows) by.set(r.tenantId, [...(by.get(r.tenantId) ?? []), r]);
    for (const [tenantId, rs] of by) {
      await withPackScope(db, { packKey: PACK, tenantId, userId: null }, (tx: Tx) =>
        partnerSendRepo(tx, tenantId).closeReplies(rs),
      );
      for (const r of rs) {
        if (!r.ref) continue;
        await packRuns()?.port?.signalEvent(
          tenantId,
          { pack: PACK, record_id: r.ref },
          `partner.${r.outcome}`,
        );
      }
    }
  };
}

/** Gọi MỘT lần lúc mount gói (từ `mountIntake`). */
export function mountPartnerSend(
  d: {
    packTools?: { register(t: PackToolDef): void } | undefined;
    packRuns?: PackRunsBridge | undefined;
  },
  db: Db,
): void {
  const uow = createPackUow(db, PACK, (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
  const tool = partnerSendTool({ uow });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(partnerSendBinding());
  partnerMailboxPort.set({
    receive: receiveInbox(db),
    onReplies: onPartnerReplies(db, () => d.packRuns),
  });
}
