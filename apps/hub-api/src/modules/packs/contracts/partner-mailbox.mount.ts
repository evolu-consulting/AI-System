// CR-124 · q3 · nối gói Hợp đồng vào hộp thư liên công ty (spec §7): (1) tool `contracts-partner-send` + node «Gửi đối tác xác nhận» (sổ module);
// (2) cổng cho bộ chuyển hub `partners/`: NHẬN = mở tx scope tenant nhận, lấy lô, tạo HĐ nhận `source='partner_inbox'` + `contract.received`
// CÙNG tx; GỬI = đóng lần gửi + `signalEvent('partner.<kết quả>')` cho node chờ (qua cổng engine `packRuns`, gắn lười). Bộ chuyển chỉ chạy khi
// `HUB_PARTNER_MAILBOX=on` (mặc định tắt) — gọi `mountPartnerSend` luôn vô hại (chỉ đăng ký).
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import {
  createPackUow,
  flowReceiveState,
  formPrefillRegistry,
  moduleRegistry,
  orgForTenant,
  type PackAccessView,
  type PackRunsBridge,
  type PackSystemUow,
  type PackToolDef,
  type PartnerMailboxPort,
  type PartnerReplyRow,
  partnerMailboxPort,
  tenantFeatureOn,
} from "../kit/public";
import { fileboxClients, packFilebox } from "../packs.filebox";
import { esignRepo } from "./adapters/esign.repo";
import { type InboxItem, partnerInboxRepo } from "./adapters/partner-inbox.repo";
import { partnerPrefill } from "./adapters/partner-prefill";
import { type PartnerSendRepo, partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { FLOW_STARTING } from "./application/contract-flow.ports";
import type { ESignFiles } from "./application/esign.ports";
import { buildPartnerNoticeMail } from "./domain/partner-notice-mail.rules";
import { finalImportance, importanceByValue, sharedValueOf } from "./domain/partner-send.rules";
import { PARTNER_FEATURE } from "./nav.mount";
import { PARTNER_SEND_KEY, partnerSendBinding } from "./nodes/partner-send/binding";

const PACK = "contracts";

/** Lô lấy từ hộp thư ⇒ mục HĐ nhận: mức cuối = max(gợi ý A, luật bên nhận theo giá trị) — bên nhận không tin mức A tự khai (FR-08). */
export function inboxItemsOf(
  rows: Awaited<ReturnType<ReturnType<typeof partnerInboxRepo>["take"]>>,
  thresholds?: { important: number; critical: number },
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
      approvalId: Bun.randomUUIDv7(),
      row,
      importance: finalImportance(
        p.importance_hint,
        importanceByValue(sharedValueOf(shared), thresholds),
      ),
      title,
      fields,
      shared,
      message: typeof p.message === "string" ? p.message : null,
    };
  });
}

/** Lý do thẻ HĐ nhận khi công ty nhận chưa có người phụ trách để chạy flow nhận (web dịch sang câu nghiệp vụ). */
export const RECEIVE_NO_OWNER = "RECEIVE_NO_OWNER";

/**
 * MỘT câu hub cho lô HĐ nhận: (1) `armed` = cờ flow theo sự kiện của công ty BẬT và có flow nhận (`contract.received`) đang bật gán cho công ty;
 * (2) người "gây" sự kiện = người phụ trách đã đặt nếu còn là thành viên nội bộ, hoạt động, không bị khoá; không thì quản trị công ty
 * (`tenant_admin`) hoạt động, không bị khoá, sớm nhất; không có ⇒ null (KHÔNG lùi về thành viên bất kỳ).
 */
export async function receiveStateOf(
  db: Db,
  tenantId: string,
  ownerId: string | null,
): Promise<{ armed: boolean; actor: string | null }> {
  return flowReceiveState(db, { tenantId, ownerId, event: "contract.received" });
}

/** Tenant NHẬN: 3 câu cố định mỗi lô, một tx scope tenant (system user null). */
export function receiveInbox(db: Db) {
  return (tenantId: string, limit: number): Promise<number> =>
    withPackScope(db, { packKey: PACK, tenantId, userId: null }, async (tx: Tx) => {
      const repo = partnerInboxRepo(tx, tenantId);
      const s = await repo.settings(); // q4 · ngưỡng mức + người phụ trách theo công ty nhận
      const items = inboxItemsOf(await repo.take(limit), {
        important: s.importantMin,
        critical: s.criticalMin,
      });
      if (items.length === 0) return 0;
      // Chỉ tạo lượt duyệt khi flow nhận ĐÃ SẴN SÀNG (cờ bật + có flow gán); chưa có người gây sự kiện ⇒ lượt kẹt với lý do rõ, không phát sự kiện.
      const { armed, actor } = await receiveStateOf(db, tenantId, s.ownerId);
      const n = await repo.insertBatch(
        items,
        s.ownerId,
        armed ? (actor ? FLOW_STARTING : RECEIVE_NO_OWNER) : null,
      );
      if (!armed || actor) await repo.emitReceived(items, actor);
      return n;
    });
}

/** CR-125 m9 · đầu ra node «Gửi đối tác xác nhận» kèm tín hiệu trả lời: lần gửi + lý do đối tác nêu (vắng/rỗng ⇒ không có khoá). */
export function partnerReplyData(r: Pick<PartnerReplyRow, "round" | "reason">) {
  const out: Record<string, string | number> = { round: r.round };
  const why = r.reason?.trim() ?? "";
  if (why) out.partner_reason = why;
  return out;
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
          partnerReplyData(r),
        );
      }
    }
  };
}

const PDF_MAX_BYTES = 25 * 1024 * 1024;

/**
 * CR-124 · q5 · PDF của HĐ gửi cho thư/trang xem của bên nhận chưa dùng nền tảng. Đọc trong tx tenant GỬI (RLS) đúng MỘT tệp theo `file_ref`;
 * org phải = org của tenant; FileBox ngoài tx; mime PDF + chữ ký `%PDF-` + ≤ 25 MB. Khác ⇒ null (không lộ lý do).
 */
export function pdfOf(
  uow: PackSystemUow<{ partnerSend: PartnerSendRepo }>,
  files: ESignFiles | null,
): NonNullable<PartnerMailboxPort["pdf"]> {
  return async (tenantId, fileRef) => {
    if (!files) return null;
    const ref = await uow.system(tenantId, (r) => r.partnerSend.file(fileRef));
    if (!ref || ref.org !== orgForTenant(tenantId)) return null;
    if (ref.mime && !/^application\/pdf\b/i.test(ref.mime)) return null;
    const bytes = await files(ref.org).getContent(ref.fileId);
    if (!bytes || bytes.length === 0 || bytes.length > PDF_MAX_BYTES) return null;
    const magic = new TextDecoder().decode(bytes.subarray(0, 5));
    return magic === "%PDF-" ? { bytes, name: ref.name ?? "hop-dong.pdf" } : null;
  };
}

/** Gọi MỘT lần lúc mount gói (từ `mountIntake`). */
export function mountPartnerSend(
  d: {
    packTools?: { register(t: PackToolDef): void } | undefined;
    packRuns?: PackRunsBridge | undefined;
    packs?: { filebox?: { url: string; token: string } } | undefined;
    /** q7 · cổng quyền gói (cùng nguồn tính năng với cap menu); vắng ⇒ tool không kiểm tính năng (chỉ test). */
    view?: PackAccessView | undefined;
    /** q7 · `HUB_PARTNER_MAILBOX=on`; vắng/false ⇒ tool TỪ CHỐI gửi (không ghi hàng mồ côi). */
    partnerMailbox?: boolean | undefined;
  },
  db: Db,
  filesOverride?: ESignFiles | null,
): void {
  const uow = createPackUow(db, PACK, (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));
  const view = d.view;
  const tool = partnerSendTool({
    uow,
    channelOn: d.partnerMailbox === true,
    ...(view ? { featureOn: (t: string) => tenantFeatureOn(view, PARTNER_FEATURE, t) } : {}),
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(partnerSendBinding());
  formPrefillRegistry.register(PARTNER_SEND_KEY, partnerPrefill(uow)); // CR-126 · bước «Chọn đối tác & người nhận»
  const fb = filesOverride === undefined ? packFilebox(d.packs) : null;
  const files = filesOverride !== undefined ? filesOverride : fb ? fileboxClients(fb) : null;
  const pdfUow = createPackUow(db, PACK, (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
  }));
  partnerMailboxPort.set({
    receive: receiveInbox(db),
    onReplies: onPartnerReplies(db, () => d.packRuns),
    pdf: pdfOf(pdfUow, files), // q5 · thư/trang xem email
    notice: buildPartnerNoticeMail, // CR-126 · thư báo vào app cho người nhận đã chọn (kênh nền tảng)
  });
}
