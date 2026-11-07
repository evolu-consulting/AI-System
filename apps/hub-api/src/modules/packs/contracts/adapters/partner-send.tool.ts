// CR-124 · q3 · FLOW4-FR-01/15/17 · tool gói `contracts-partner-send` (stage `real_action` của node «Gửi đối tác xác nhận», tx gói của tenant A,
// danh tính = người bắt đầu run). Tạo lần gửi qua hàm DEFINER `hub.partner_send` (q1) — tự chọn kênh theo MST/email (q3: nền tảng khi đã nối;
// email/thủ công còn lại — token email = q5). Idempotent: đã có lần gửi MỞ cho HĐ ⇒ trả lại lần đó (engine retry không gửi đôi). Số câu SQL cố định
// mỗi lần gửi (≤ 9), không phụ thuộc kích thước HĐ. Sau gửi: bên nhận → `contract.received` (bộ chuyển); trả lời → tín hiệu `partner.*` cho node chờ.
import { PartnerSendConfigSchema, parseSendFields } from "@ai/contracts/modules";
import type { PackToolArgs, PackToolCtx, PackToolDef, PackUow } from "../../kit/public";
import type { ESignRepo } from "../application/esign.ports";
import {
  buildPayload,
  type ImportanceHint,
  planChannel,
  prevMailboxOf,
  replyDaysOf,
  toKeyOf,
} from "../domain/partner-send.rules";
import type { PartnerSendRepo } from "./partner-send.repo";

export const PARTNER_TOOL_KEY = "contracts-partner-send";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartnerToolRepos = { partnerSend: PartnerSendRepo; esign: Pick<ESignRepo, "contract"> };
export type PartnerToolDeps = { uow: PackUow<PartnerToolRepos> };

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
];

export function decodePartnerArgs(args: PackToolArgs) {
  const p = PartnerSendConfigSchema.safeParse(args);
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
    run: (ctx, args) => run(d, ctx, args),
  };
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

async function run(d: PartnerToolDeps, ctx: PackToolCtx, args: PackToolArgs) {
  const { cfg, id } = decodePartnerArgs(args);
  return d.uow.tenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (r) => {
    const last = await r.partnerSend.latest(id);
    if (last?.status === "open")
      return {
        status: "already_sent",
        mailbox_id: last.mailboxId,
        channel: last.channel,
        round: last.round,
      };
    const { c, plan } = await planFor(r, cfg, id);
    const toKey = toKeyOf(plan);
    const prev = prevMailboxOf(last, toKey);
    const mailboxId = await r.partnerSend.send({
      toTenant: plan.toTenant,
      toEmail: plan.toEmail,
      channel: plan.channel,
      ref: id,
      payload: buildPayload({
        title: c.title,
        message: cfg.message,
        hint: cfg.importance as ImportanceHint | undefined,
        sendFields: parseSendFields(cfg.send_fields),
        fields: c.fields,
      }),
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
      status: "sent",
      mailbox_id: mailboxId,
      channel: plan.channel,
      round,
      ...(plan.why ? { why: plan.why } : {}),
    };
  });
}
