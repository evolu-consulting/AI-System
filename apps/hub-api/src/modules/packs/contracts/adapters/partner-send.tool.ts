// CR-124 · q3 · FLOW4-FR-01/15/17 · tool gói `contracts-partner-send` (stage `real_action` của node «Gửi đối tác xác nhận», tx gói của tenant A,
// danh tính = người bắt đầu run). Tạo lần gửi qua hàm DEFINER `hub.partner_send` (q1) — tự chọn kênh theo MST/email (q3: nền tảng khi đã nối;
// email/thủ công còn lại — token email = q5). Idempotent: đã có lần gửi MỞ cho HĐ ⇒ trả lại lần đó (engine retry không gửi đôi). Số câu SQL cố định
// mỗi lần gửi (≤ 9), không phụ thuộc kích thước HĐ. Sau gửi: bên nhận → `contract.received` (bộ chuyển); trả lời → tín hiệu `partner.*` cho node chờ.
import { PartnerSendConfigSchema, parseSendFields } from "@ai/contracts/modules";
import type {
  PackSystemUow,
  PackToolArgs,
  PackToolCtx,
  PackToolDef,
  PackUow,
} from "../../kit/public";
import type { ESignRepo } from "../application/esign.ports";
import {
  buildPayload,
  type ImportanceHint,
  planChannel,
  prevMailboxOf,
  replyDaysOf,
  toKeyOf,
} from "../domain/partner-send.rules";
import { withBusinessCodes } from "./intake.errors";
import type { PartnerSendRepo } from "./partner-send.repo";

export const PARTNER_TOOL_KEY = "contracts-partner-send";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartnerToolRepos = { partnerSend: PartnerSendRepo; esign: Pick<ESignRepo, "contract"> };
export type PartnerToolDeps = {
  uow: PackUow<PartnerToolRepos> & PackSystemUow<PartnerToolRepos>;
  /** Công ty có bật tính năng `contracts-partner-confirm` (cùng nguồn với cap menu). Vắng ⇒ coi là bật (test dựng tool trực tiếp). */
  featureOn?: (tenantId: string) => Promise<boolean>;
  /** Kênh hộp thư liên công ty bật trên hệ thống (`HUB_PARTNER_MAILBOX=on`). Vắng ⇒ coi là bật. false ⇒ từ chối TRƯỚC KHI ghi bất cứ gì. */
  channelOn?: boolean;
};

const PARAMS: PackToolDef["params"] = [
  { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" },
  {
    name: "importance",
    type: "select",
    required: false,
    options: ["auto", "normal", "important", "critical"],
    description: "Mức quan trọng gợi ý",
  },
  { name: "send_fields", type: "text", required: false, description: "Trường gửi kèm" },
  { name: "reply_days", type: "number", required: false, description: "Hạn trả lời (ngày)" },
  { name: "message", type: "text", required: false, description: "Lời nhắn" },
  { name: "partner_tax_code", type: "text", required: false, description: "MST công ty nhận" },
  { name: "partner_email", type: "text", required: false, description: "Email liên hệ" },
  // CR-126 · cấu hình node (nhóm làm bước chọn người nhận) — tool không dùng, chỉ để args hằng của stage hợp lệ.
  { name: "assignee_group", type: "text", required: false, description: "Nhóm phụ trách" },
];

export function decodePartnerArgs(args: PackToolArgs) {
  const p = PartnerSendConfigSchema.safeParse(args);
  // CR-126 · người nhận chọn ở bước «Chọn đối tác & người nhận»: sai dạng ⇒ lỗi nghiệp vụ riêng (thẻ nói rõ sửa gì), không gửi.
  const bad = new Set(p.success ? [] : p.error.issues.map((i) => String(i.path[0])));
  if (bad.has("partner_email")) throw new Error("PARTNER_EMAIL_INVALID");
  if (bad.has("partner_tax_code")) throw new Error("PARTNER_NOT_IN_COMPANY");
  if (!p.success)
    throw new Error(
      `PARTNER_SEND_CONFIG_INVALID:${p.error.issues.map((i) => i.path.join(".")).join(",")}`,
    );
  const id = String(p.data.contract_id ?? "");
  if (!UUID.test(id)) throw new Error("CONTRACT_ID_INVALID");
  return { cfg: p.data, id };
}

export function partnerSendTool(d: PartnerToolDeps): PackToolDef {
  return {
    pack: "contracts",
    name: PARTNER_TOOL_KEY,
    action: "write",
    description:
      "Gửi hợp đồng cho đối tác xác nhận (nền tảng / email / ghi nhận thủ công — hệ thống tự chọn).",
    side_effect: true,
    params: PARAMS,
    // Lỗi nghiệp vụ (mã máy) ⇒ `PackToolBusinessError`: engine mở quyết định ngay với lý do trên thẻ, không thử lại vô ích.
    run: withBusinessCodes((ctx, args) => run(d, ctx, args)),
  };
}

/** Chặn TRƯỚC khi đụng DB: kênh hệ thống tắt / công ty chưa bật tính năng ⇒ lỗi có mã (không ghi hàng mồ côi, không bỏ qua im lặng). */
async function assertEnabled(d: PartnerToolDeps, tenantId: string): Promise<void> {
  if (d.channelOn === false) throw new Error("PARTNER_CHANNEL_OFF");
  if (d.featureOn && !(await d.featureOn(tenantId))) throw new Error("PARTNER_FEATURE_OFF");
}

type R = PartnerToolRepos;
type Cfg = ReturnType<typeof decodePartnerArgs>["cfg"];

/** Đọc HĐ + chọn kênh (FR-15). Chưa nối ⇒ gửi lời mời nối (B thấy, chấp nhận một lần); lần này đi kênh dự phòng. */
async function planFor(r: R, cfg: Cfg, id: string) {
  const c = await r.partnerSend.contract(id);
  if (!c) throw new Error("CONTRACT_NOT_FOUND");
  if (!c.fileId) throw new Error("PARTNER_NEEDS_FILE");
  const email = cfg.partner_email ?? (await r.esign.contract(id))?.partner?.email?.trim() ?? null;
  const tax = cfg.partner_tax_code ?? c.partnerTax;
  const route = tax ? await r.partnerSend.route(tax) : null;
  if (route && route.link !== "accepted" && route.link !== "blocked")
    await r.partnerSend.requestLink(route.toTenant);
  return { c, plan: planChannel(route, email || null, c.partnerName) };
}

/** Tên công ty gửi cho thư báo (chỉ khi kênh nền tảng có email người nhận); còn lại null. */
async function noticeSender(r: R, plan: ReturnType<typeof planChannel>): Promise<string | null> {
  if (plan.channel !== "platform" || !plan.toEmail) return null;
  return (await r.partnerSend.self())?.name ?? null;
}

const alreadySent = (last: { mailboxId: string; channel: string; round: number }) => ({
  status: "already_sent",
  mailbox_id: last.mailboxId,
  channel: last.channel,
  round: last.round,
});

async function run(d: PartnerToolDeps, ctx: PackToolCtx, args: PackToolArgs) {
  await assertEnabled(d, ctx.tenantId);
  const { cfg, id } = decodePartnerArgs(args);
  // CR-126 · đối tác CHỌN phải là đối tác của CÔNG TY (sổ đối tác cả công ty, không theo quyền xem của người bắt đầu lượt — RLS
  // `partner_roles_visible` ẩn đối tác người đó không thấy); kiểm ở phạm vi hệ thống của chính tenant, SQL lọc `tenant_id` tường minh. Trước mọi ghi.
  const tax = cfg.partner_tax_code;
  if (tax && !(await d.uow.system(ctx.tenantId, (r) => r.partnerSend.isPartner(tax))))
    throw new Error("PARTNER_NOT_IN_COMPANY");
  return d.uow.tenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (r) => {
    const last = await r.partnerSend.latest(id);
    if (last?.status === "open") return alreadySent(last);
    const { c, plan } = await planFor(r, cfg, id);
    const toKey = toKeyOf(plan);
    const prev = prevMailboxOf(last, toKey);
    // CR-126 · kênh nền tảng + có email người nhận ⇒ dòng hộp thư mang `to_email` và bộ gửi hub gửi MỘT thư báo (một dòng = một vòng = một thư);
    // thư cần tên công ty gửi mà hub_rw không đọc được `admin.tenants` ⇒ ghi kèm vào bản chia sẻ (tên pháp lý công khai của chính bên gửi).
    const sender = await noticeSender(r, plan);
    const mailboxId = await r.partnerSend.send({
      toTenant: plan.toTenant,
      toEmail: plan.toEmail,
      channel: plan.channel,
      ref: id,
      payload: {
        ...buildPayload({
          title: c.title,
          message: cfg.message,
          hint: cfg.importance as ImportanceHint | undefined,
          sendFields: parseSendFields(cfg.send_fields),
          fields: c.fields,
        }),
        ...(sender ? { sender_name: sender.slice(0, 200) } : {}),
      },
      fileRef: c.fileId,
      days: replyDaysOf(cfg.reply_days),
      prevId: prev,
    });
    const round = prev && last ? last.round + 1 : 1;
    await r.partnerSend.record({
      contractId: id,
      mailboxId,
      round,
      channel: plan.channel,
      toKey,
      toName: plan.toName,
      runId: ctx.processRunId ?? null,
      by: ctx.userId,
    });
    return {
      status: plan.channel === "platform" && plan.held ? "held" : "sent",
      mailbox_id: mailboxId,
      channel: plan.channel,
      round,
      ...(plan.why ? { why: plan.why } : {}),
    };
  });
}
