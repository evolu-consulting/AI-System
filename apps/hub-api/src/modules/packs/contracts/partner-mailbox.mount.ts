// CR-124 · q3 · nối gói Hợp đồng vào hộp thư liên công ty (spec §7): (1) tool `contracts-partner-send` + node «Gửi đối tác xác nhận» (sổ module);
// (2) cổng cho bộ chuyển hub `partners/`: NHẬN = mở tx scope tenant nhận, lấy lô, tạo HĐ nhận `source='partner_inbox'` + `contract.received`
// CÙNG tx; GỬI = đóng lần gửi + `signalEvent('partner.<kết quả>')` cho node chờ (qua cổng engine `packRuns`, gắn lười). Bộ chuyển chỉ chạy khi
// `HUB_PARTNER_MAILBOX=on` (mặc định tắt) — gọi `mountPartnerSend` luôn vô hại (chỉ đăng ký).

import { CONTRACTS_PARTNER_CONFIRM_FEATURE as PARTNER_FEATURE } from "@ai/contracts/tenants";
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { logger } from "../../../lib/logger";
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
import { contractStateRepo } from "./adapters/contract-state.repo";
import { esignRepo } from "./adapters/esign.repo";
import { type InboxItem, partnerInboxRepo } from "./adapters/partner-inbox.repo";
import { partnerPrefill } from "./adapters/partner-prefill";
import { type PartnerSendRepo, partnerSendRepo } from "./adapters/partner-send.repo";
import { type PartnerToolDeps, partnerSendTool } from "./adapters/partner-send.tool";
import { signSessionRepo } from "./adapters/sign-session.repo";
import { FLOW_STARTING } from "./application/contract-flow.ports";
import type { ESignFiles } from "./application/esign.ports";
import { buildPartnerNoticeMail } from "./domain/partner-notice-mail.rules";
import { finalImportance, importanceByValue, sharedValueOf } from "./domain/partner-send.rules";
import { signSessionPlan } from "./domain/sign-session.rules";
import { PARTNER_SEND_KEY, partnerSendBinding } from "./nodes/partner-send/binding";
import { signTogetherAcceptBinding } from "./nodes/sign-together-accept/binding";

const PACK = "contracts";

/** Lô lấy từ hộp thư ⇒ mục HĐ nhận: mức cuối = max(gợi ý A, luật bên nhận theo giá trị) — bên nhận không tin mức A tự khai (FR-08). */
export function inboxItemsOf(
  rows: Awaited<ReturnType<ReturnType<typeof partnerInboxRepo>["take"]>>,
  thresholds?: { important: number; critical: number },
): InboxItem[] {
  return rows.map((row): InboxItem => {
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

/** CR-127 · P1 · lần gửi kèm đề xuất ký cùng lúc ⇒ gắn HĐ nhận vào phiên ký chung (MỘT câu, chỉ khi lô có đề xuất). */
async function linkSignSessions(
  tx: Tx,
  tenantId: string,
  items: readonly InboxItem[],
  hasSignerGroup: boolean,
) {
  const st = items.filter((i) => i.row.payload.sign_together);
  if (st.length === 0) return;
  const repo = signSessionRepo(tx, tenantId);
  await repo.linkReceived(st.map((i) => ({ mailboxId: i.row.id, contractId: i.contractId })));
  // BR-61 · chưa có nhóm «Người ký HĐ» ⇒ không ai chọn người ký được ⇒ tự «Xử lý bình thường» (MỘT câu cho cả lô).
  if (!hasSignerGroup) await repo.fallbackByMailbox(st.map((i) => i.row.id));
}

/** Tenant NHẬN: 3 câu cố định mỗi lô, một tx scope tenant (system user null). */
export function receiveInbox(db: Db) {
  return (tenantId: string, limit: number): Promise<number> =>
    withPackScope(db, { packKey: PACK, tenantId, userId: null }, async (tx: Tx) => {
      const repo = partnerInboxRepo(tx, tenantId);
      const s = await repo.settings(); // q4 · ngưỡng mức + người phụ trách theo công ty nhận
      const taken = inboxItemsOf(await repo.take(limit), {
        important: s.importantMin,
        critical: s.criticalMin,
      });
      if (taken.length === 0) return 0;
      // CR-127 K8 · Q10: bản sửa (lần gửi nối vòng đã Trả lại) ⇒ cùng HĐ nhận cũ.
      const items = await repo.linkRevisions(taken);
      // Chỉ tạo lượt duyệt khi flow nhận ĐÃ SẴN SÀNG (cờ bật + có flow gán); chưa có người gây sự kiện ⇒ lượt kẹt với lý do rõ, không phát sự kiện.
      const { armed, actor } = await receiveStateOf(db, tenantId, s.ownerId);
      // CR-127 K8 · #9b: không có quy trình nhận ⇒ chờ người phụ trách HĐ nhận quyết; người phụ trách = người đã đặt còn hiệu lực, không thì
      // quản trị công ty (cùng luật chọn `actor`) — ghi vào `owner_user_id` của HĐ nhận để "Việc của tôi" + quyền quyết đọc MỘT cột.
      const n = await repo.insertBatch(
        items,
        actor ?? s.ownerId,
        armed ? (actor ? FLOW_STARTING : RECEIVE_NO_OWNER) : null,
        !armed,
      );
      const hasGroup = s.signerGroupId !== null;
      if (!armed || actor) await repo.emitReceived(items, actor, hasGroup);
      await linkSignSessions(tx, tenantId, items, hasGroup);
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

type SignSessionRow = Parameters<NonNullable<PartnerMailboxPort["onSignSessions"]>>[0][number];
type SessionSignal = {
  contractId: string;
  signal: string | null;
  data: Record<string, string | number>;
  /** CR-127 · P2b · phiên kết thúc không ký (huỷ / từ chối / quá hạn đã chọn) ⇒ huỷ phong bì còn mở của HĐ. */
  ended: boolean;
};
/** CR-127 · P2b · huỷ phong bì còn mở của HĐ (gói ký số; ngoài tx, gọi mạng nhà cung cấp). */
export type SessionEnvelopeEnd = (tenantId: string, contractId: string) => Promise<boolean>;

/** Kế hoạch một bên ⇒ việc sau tx (tín hiệu và/hoặc huỷ phong bì); không có gì ⇒ null. */
function sessionSignalOf(
  contractId: string,
  p: ReturnType<typeof signSessionPlan>,
): SessionSignal | null {
  const ended = p.ev !== null && p.ev !== "sign_session_done";
  return p.signal || ended ? { contractId, signal: p.signal, data: { ...p.data }, ended } : null;
}

/** Một tenant: tra HĐ gắn các phiên (1 câu) → chuyển từng HĐ qua cổng (CAS; đã chuyển ⇒ bỏ qua) — CÙNG tx scope tenant đó. */
async function applySessionSide(
  db: Db,
  tenantId: string,
  rows: readonly SignSessionRow[],
): Promise<SessionSignal[]> {
  return withPackScope(db, { packKey: PACK, tenantId, userId: null }, async (tx: Tx) => {
    const byId = new Map(rows.map((r) => [r.sessionId, r]));
    const refs = await signSessionRepo(tx, tenantId).refsFor([...byId.keys()]);
    const st = contractStateRepo(tx, tenantId);
    const out: SessionSignal[] = [];
    for (const ref of refs) {
      const r = byId.get(ref.session_id);
      if (!r) continue;
      const p = signSessionPlan(r.status, r.expireChoice);
      if (p.ev) {
        const tail = r.expireChoice ? `:${r.expireChoice}` : "";
        const reason = `sign_session:${r.status}${tail}`;
        await st.applyTransition({ contractId: ref.contract_id, ev: p.ev, actorId: null, reason });
      }
      const side = sessionSignalOf(ref.contract_id, p);
      if (side) out.push(side);
    }
    return out;
  });
}

/**
 * CR-127 · P1 · spec §3 #12–#14c · báo phiên ký chung về TỪNG bên còn cờ chưa báo: HĐ hai bên cùng kết quả (tất cả-hoặc-không) + tín hiệu
 * `sign.session.*` cho node chờ (P2 nối `signals`). Ném ⇒ bộ chuyển không bật cờ, lượt sau chạy lại (cổng CAS ⇒ idempotent).
 */
export function onSignSessions(
  db: Db,
  packRuns: () => PackRunsBridge | undefined,
  endEnvelope?: () => SessionEnvelopeEnd | undefined,
) {
  return async (rows: readonly SignSessionRow[]): Promise<void> => {
    const by = new Map<string, SignSessionRow[]>();
    const add = (t: string, r: SignSessionRow) => by.set(t, [...(by.get(t) ?? []), r]);
    for (const r of rows) {
      if (r.notifyFrom) add(r.fromTenant, r);
      if (r.notifyTo) add(r.toTenant, r);
    }
    for (const [tenantId, rs] of by)
      for (const s of await applySessionSide(db, tenantId, rs))
        await deliverSessionSide(tenantId, s, packRuns(), endEnvelope?.());
  };
}

/** Sau tx một bên: huỷ phong bì TRƯỚC tín hiệu (node Ký số chờ không còn phong bì mở); lỗi huỷ ⇒ cảnh báo, sync thử lại (VOID_PENDING). */
async function deliverSessionSide(
  tenantId: string,
  s: SessionSignal,
  runs: PackRunsBridge | undefined,
  end: SessionEnvelopeEnd | undefined,
): Promise<void> {
  if (s.ended && end)
    await end(tenantId, s.contractId).catch((e: unknown) =>
      logger.warn("sign-session-void-failed", {
        contract_id: s.contractId,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
  if (s.signal)
    await runs?.port?.signalEvent(
      tenantId,
      { pack: PACK, record_id: s.contractId },
      s.signal,
      s.data,
    );
}

const PDF_MAX_BYTES = 25 * 1024 * 1024;

/**
 * CR-127 · P2 · SHA-256 văn bản PDF của HĐ (phiên ký chung khoá "cùng một bản"). Đọc tệp HĐ trong tx tenant (RLS), FileBox ngoài tx; org phải = org
 * của tenant; mime PDF + `%PDF-` + ≤ 25 MB — khác ⇒ null (người gửi tạo phiên thất bại ⇒ gửi thường).
 */
export function fileShaOf(
  uow: PackSystemUow<{ partnerSend: PartnerSendRepo }>,
  files: ESignFiles | null,
): NonNullable<PartnerToolDeps["fileSha"]> {
  return async (tenantId, contractId) => {
    if (!files) return null;
    const ref = await uow.system(tenantId, async (r) => {
      const c = await r.partnerSend.contract(contractId);
      return c?.fileId ? r.partnerSend.file(c.fileId) : null;
    });
    if (!ref || ref.org !== orgForTenant(tenantId)) return null;
    if (ref.mime && !/^application\/pdf\b/i.test(ref.mime)) return null;
    const bytes = await files(ref.org).getContent(ref.fileId);
    if (!bytes || bytes.length === 0 || bytes.length > PDF_MAX_BYTES) return null;
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return null;
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  };
}

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
    /** CR-127 · P2b · gói ký số: huỷ phong bì khi phiên ký chung kết thúc không ký. */
    esign?: { endSession: SessionEnvelopeEnd } | undefined;
  },
  db: Db,
  filesOverride?: ESignFiles | null,
): void {
  const uow = createPackUow(db, PACK, (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
    signSession: signSessionRepo(tx, t), // CR-127 · P2 · đề nghị ký cùng lúc cùng tx gửi
  }));
  const view = d.view;
  const fb = filesOverride === undefined ? packFilebox(d.packs) : null;
  const files = filesOverride !== undefined ? filesOverride : fb ? fileboxClients(fb) : null;
  const pdfUow = createPackUow(db, PACK, (tx: Tx, t: string) => ({
    partnerSend: partnerSendRepo(tx, t),
  }));
  const tool = partnerSendTool({
    uow,
    channelOn: d.partnerMailbox === true,
    fileSha: fileShaOf(pdfUow, files),
    ...(view ? { featureOn: (t: string) => tenantFeatureOn(view, PARTNER_FEATURE, t) } : {}),
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(partnerSendBinding());
  moduleRegistry.bindNode(signTogetherAcceptBinding()); // CR-127 · P2 · «Đồng ý ký cùng lúc»
  formPrefillRegistry.register(PARTNER_SEND_KEY, partnerPrefill(uow)); // CR-126 · bước «Chọn đối tác & người nhận»
  partnerMailboxPort.set({
    receive: receiveInbox(db),
    onReplies: onPartnerReplies(db, () => d.packRuns),
    onSignSessions: onSignSessions(
      db,
      () => d.packRuns,
      () => d.esign?.endSession,
    ), // CR-127 · P1/P2b · phiên ký chung
    pdf: pdfOf(pdfUow, files), // q5 · thư/trang xem email
    notice: buildPartnerNoticeMail, // CR-126 · thư báo vào app cho người nhận đã chọn (kênh nền tảng)
  });
}
