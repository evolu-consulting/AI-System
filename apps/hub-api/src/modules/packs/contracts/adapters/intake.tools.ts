// CR-120 · cr120-contracts-flow · tool gói của khe `contracts.intake` (stage `tool`, danh tính = người bắt đầu run, tx gói của tenant run):
//   contracts-extract            — AI trích xuất: ĐỌC trạng thái trích của HĐ (hàng đợi trích của gói chạy nền từ lúc tải lên); HĐ không thấy ⇒ lỗi tool.
//   contracts-esign-send         — ký số như một bước (G6): gửi phong bì ký (người ký công ty = người bắt đầu; đối tác theo email liên hệ HĐ).
//                                  `side_effect: true` ⇒ stage `real_action` (người duyệt bước trước cấp phép). Hoàn tất ký → hook gói bắn `esign.completed`.
//   contracts-obligation-remind  — chuông nhắc nghĩa vụ cho người bắt đầu run (idempotent theo HĐ).
// Chỉ chạm HĐ mà người bắt đầu thấy được (RLS `PackUow.tenant`); tenant khác ⇒ không thấy. Không log nội dung HĐ.
import {
  decodeEsignNodeArgs,
  ESIGN_NODE_ONDOC,
  ESIGN_NODE_ORDERS,
  ESIGN_NODE_UPLOAD,
  type ESignSignerIn,
  type EsignNodeConfig,
  type EsignNodeSigner,
  esignConfigIssues,
  esignDueHours,
} from "@ai/contracts/pack-contracts";
import type {
  NotifyTxRepos,
  PackToolArgs,
  PackToolCtx,
  PackToolDef,
  PackUow,
} from "../../kit/public";
import type { ESignRepo } from "../application/esign.ports";
import type { SendNodeOpts } from "../application/esign.usecase";
import type { ExtractionRepo } from "../application/extraction.ports";
import { contractCodeLabel } from "../domain/contract-name";
import { withBusinessCodes } from "./intake.errors";

export const INTAKE_TOOL_KEYS = {
  extract: "contracts-extract",
  esignSend: "contracts-esign-send",
  remind: "contracts-obligation-remind",
} as const;

type R = {
  extraction: Pick<ExtractionRepo, "source">;
  esign: Pick<ESignRepo, "contract" | "lockForSign" | "latest" | "openSignWait">;
} & NotifyTxRepos;
export type IntakeToolDeps = {
  uow: PackUow<R>;
  /** Gửi ký ở scope hệ thống của tenant (`ESignUsecase.sendSystem`); lỗi ⇒ ném (stage `tool_failed`). */
  send: (
    tenantId: string,
    signer: string,
    contractId: string,
    signers: ESignSignerIn[],
    provider?: string,
    node?: SendNodeOpts,
  ) => Promise<void>;
  /** CR-122 · E5 · mục người ký công ty của node (user/Group) ⇒ danh sách user (đã kiểm thuộc công ty); lỗi ⇒ ném. Vắng ⇒ node không dùng được `company_signers`. */
  nodeSigners?: (tenantId: string, entries: readonly EsignNodeSigner[]) => Promise<string[]>;
  /** CR-181 · công ty bật «ký trên tài liệu»? Vắng ⇒ không kiểm. */
  onDocEnabled?: (tenantId: string) => Promise<boolean>;
  /** Bản ghi hợp đồng đã gắn vào lượt chạy `runId` (cầu engine); cho phép Ký số chỉ ký đúng HĐ của lượt. */
  recordOfRun?: (tenantId: string, runId: string) => Promise<string | null>;
  /** Đối tác ký hợp lệ theo schema người ký đối tác; sai ⇒ null. */
  parsePartner: (name: string, email: string) => { name: string; email: string } | null;
};

const CONTRACT = { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" };
/** E5 · cấu hình node Ký số (tuỳ chọn; trống ⇒ cài đặt ký số chung của app). Giá trị đơn; `company_signers` = `user:<id>,group:<id>`. */
const ESIGN_NODE_PARAM_DEFS: readonly PackToolDef["params"][number][] = [
  {
    name: "provider",
    type: "text",
    required: false,
    description: "Ký qua: khoá nhà cung cấp ký số hoặc «upload» (tải lên bản đã ký)",
  },
  { name: "company_signers", type: "text", required: false, description: "Người ký phía công ty" },
  { name: "signer_role", type: "text", required: false, description: "Vai người ký phía công ty" },
  { name: "need_digital", type: "boolean", required: false, description: "Cần chữ ký số" },
  { name: "partner_signs", type: "boolean", required: false, description: "Đối tác ký" },
  {
    name: "order",
    type: "select",
    required: false,
    options: ESIGN_NODE_ORDERS,
    description: "Thứ tự ký",
  },
  { name: "due_days", type: "number", required: false, description: "Hạn ký (ngày)" },
  { name: "due_hours", type: "number", required: false, description: "Hạn ký (giờ)" },
  { name: "remind_every_hours", type: "number", required: false, description: "Nhắc mỗi (giờ)" },
];

/**
 * CR-182 · R3/R4 · công tắc lùi `on_doc_enabled` của công ty. Bước Ký có `signer_role`:
 *   · người ký (`company_signers`) do giải vai điền; THIẾU (vai chưa giao) ⇒ `ESIGN_NODE_NO_SIGNER` (không lùi về người bắt đầu lượt) — cả hai chế độ;
 *   · công ty BẬT ⇒ «Ký qua» = ký trên tài liệu, BỎ `provider` cũ (kể cả khi trống / DocuSign);
 *   · công ty TẮT (hoặc không có cổng `onDocEnabled`) ⇒ chạy như cũ: `provider` bắt buộc, người ký như `company_signers`.
 * Bước không có `signer_role`: giữ nguyên cấu hình.
 */
async function effectiveCfg(
  d: IntakeToolDeps,
  ctx: PackToolCtx,
  cfg: EsignNodeConfig,
): Promise<EsignNodeConfig> {
  if (!cfg.signer_role) return cfg;
  if (!cfg.company_signers?.length) throw new Error("ESIGN_NODE_NO_SIGNER");
  const on = d.onDocEnabled ? await d.onDocEnabled(ctx.tenantId) : false;
  if (on) return { ...cfg, provider: ESIGN_NODE_ONDOC };
  // TẮT mà bước kiểu mới (không còn «Ký qua» cũ) ⇒ không ai ký được: báo rõ cần bật ký trên tài liệu (không gửi với provider rỗng).
  if (!cfg.provider) throw new Error("ONDOC_NOT_ENABLED");
  return cfg;
}

/** Người ký + thứ tự theo cấu hình node: `partner_signs` false ⇒ chỉ công ty ký; true ⇒ bắt buộc có đối tác; vắng ⇒ có email thì đối tác ký. */
async function planSend(
  d: IntakeToolDeps,
  ctx: PackToolCtx,
  cfg: EsignNodeConfig,
  parsed: { name: string; email: string } | null,
) {
  // CR-146b · chưa chọn «Ký qua» / người ký ⇒ lỗi nghiệp vụ rõ (không dừng im lặng, không lùi về mặc định cấp công ty)
  const bad = esignConfigIssues(cfg);
  if (bad.some((i) => i.field === "provider"))
    throw new Error("ESIGN_NODE_CONFIG_INVALID:provider");
  if (bad.length > 0) throw new Error("ESIGN_NODE_NO_SIGNER");
  const partner = cfg.partner_signs === false ? null : parsed;
  if (cfg.partner_signs === true && !partner) throw new Error("NO_PARTNER_EMAIL");
  const users = cfg.company_signers
    ? await companyUsers(d, ctx.tenantId, cfg.company_signers)
    : undefined;
  const company: ESignSignerIn[] = (users ?? [ctx.userId]).map(() => ({ role: "company" }));
  const signers: ESignSignerIn[] = partner
    ? [...company, { role: "partner", ...partner }]
    : company;
  const node: SendNodeOpts = {
    ...(users ? { companyUsers: users } : {}),
    ...(cfg.order ? { order: cfg.order } : {}),
    ...(esignDueHours(cfg) !== null ? { dueH: esignDueHours(cfg) as number } : {}),
    ...(cfg.remind_every_hours !== undefined ? { remindEveryH: cfg.remind_every_hours } : {}),
  };
  return {
    signers,
    node,
    signer: users?.[0] ?? ctx.userId,
    provider: cfg.provider as string,
  };
}

async function companyUsers(
  d: IntakeToolDeps,
  tenantId: string,
  entries: readonly EsignNodeSigner[],
): Promise<string[]> {
  if (!d.nodeSigners) throw new Error("ESIGN_NODE_SIGNERS_UNAVAILABLE");
  const users = await d.nodeSigners(tenantId, entries);
  if (users.length === 0) throw new Error("ESIGN_NODE_NO_SIGNER");
  return users;
}
/** CR-181 · công ty TẮT ký trên tài liệu mà bước vẫn chọn «Ký qua» = ondoc ⇒ lỗi nghiệp vụ rõ (thẻ HĐ báo vì sao dừng), không treo câm. */
async function assertOndocAllowed(d: IntakeToolDeps, tenantId: string, provider: string) {
  if (ondocStart(provider) && d.onDocEnabled && !(await d.onDocEnabled(tenantId)))
    throw new Error("ONDOC_NOT_ENABLED");
}
/** CR-146b · «Ký qua» = tải lên bản đã ký ⇒ không tạo phong bì, bước chờ người được giao tải lên (`esign.completed` do route tải lên bắn).
 *  Ký qua nhà cung cấp mà công ty đã tắt / không còn nhà cung cấp đó ⇒ `ESIGN_DISABLED` (lỗi nghiệp vụ rõ, không tự chuyển sang tải lên). */
async function sendIfProvider(
  d: IntakeToolDeps,
  ctx: PackToolCtx,
  id: string,
  p: Awaited<ReturnType<typeof planSend>>,
): Promise<boolean> {
  if (p.provider === ESIGN_NODE_UPLOAD) return true;
  await d.send(ctx.tenantId, p.signer, id, p.signers, p.provider, p.node);
  return false;
}
/** CR-181 · Q1 · «Ký qua» = ký trên tài liệu ⇒ không phong bì; «đã ký đủ từ bước duyệt» (Q8) do engine hỏi lúc mở bước chờ (`signWaitReady`). */
function ondocStart(provider: string): boolean {
  return provider === ESIGN_NODE_ONDOC;
}
/** `recordOfRun` có (máy chủ thật) ⇒ bắt buộc có lượt và HĐ là bản ghi của lượt, nếu không `ESIGN_CONTRACT_NOT_IN_RUN`. Vắng (test dựng tool trực tiếp) ⇒ false. */
async function ownsContract(d: IntakeToolDeps, ctx: PackToolCtx, id: string): Promise<boolean> {
  if (!d.recordOfRun) return false;
  const rec = ctx.processRunId ? await d.recordOfRun(ctx.tenantId, ctx.processRunId) : null;
  if (rec?.toLowerCase() !== id.toLowerCase()) throw new Error("ESIGN_CONTRACT_NOT_IN_RUN");
  return true;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contractIdOf(args: PackToolArgs): string {
  const id = String(args.contract_id ?? "");
  if (!UUID.test(id)) throw new Error("CONTRACT_ID_INVALID");
  return id;
}
const who = (ctx: PackToolCtx) => ({ tenantId: ctx.tenantId, userId: ctx.userId });

export function intakeTools(d: IntakeToolDeps): PackToolDef[] {
  return rawIntakeTools(d).map((t) => ({ ...t, run: withBusinessCodes(t.run) }));
}

function rawIntakeTools(d: IntakeToolDeps): PackToolDef[] {
  const base = { pack: "contracts", action: "write" as const, params: [CONTRACT] };
  return [
    {
      ...base,
      name: INTAKE_TOOL_KEYS.extract,
      description: "Đọc trạng thái AI trích xuất của hợp đồng (trích chạy nền từ lúc tải lên).",
      side_effect: false,
      async run(ctx, args) {
        const id = contractIdOf(args);
        const src = await d.uow.tenant(who(ctx), (r) => r.extraction.source(id));
        if (!src) throw new Error("CONTRACT_NOT_FOUND");
        return { status: src.status };
      },
    },
    {
      ...base,
      name: INTAKE_TOOL_KEYS.esignSend,
      params: [CONTRACT, ...ESIGN_NODE_PARAM_DEFS],
      description:
        "Gửi hợp đồng đi ký số (người ký công ty = người bắt đầu; đối tác theo email liên hệ).",
      side_effect: true,
      async run(ctx, args) {
        const id = contractIdOf(args);
        const node = decodeEsignNodeArgs(args);
        if (!node.ok) throw new Error(`ESIGN_NODE_CONFIG_INVALID:${node.issues.join(",")}`);
        const cfg = await effectiveCfg(d, ctx, node.config);
        // CR-122 · flow mới: HĐ chỉ xác nhận ở "Kết thúc · Đã duyệt" (sau Ký số) ⇒ khoá ở đây để ký đúng bản đã duyệt.
        // cr125-contract-from-step · chỉ ký HĐ là bản ghi của CHÍNH lượt này (lượt theo sự kiện HĐ hoặc HĐ do «Tạo hợp đồng từ hồ sơ» gắn).
        const viaRun = await ownsContract(d, ctx, id);
        const c = await d.uow.tenant(who(ctx), async (r) => {
          await r.esign.lockForSign(id, ctx.userId, viaRun);
          return r.esign.contract(id);
        });
        if (!c) throw new Error("CONTRACT_NOT_FOUND");
        const email = c.partner?.email?.trim() ?? "";
        const parsed = email
          ? d.parsePartner((c.partner?.name?.trim() || email).slice(0, 200), email)
          : null;
        const p = await planSend(d, ctx, cfg, parsed);
        await assertOndocAllowed(d, ctx.tenantId, p.provider);
        // CR-141 · «Ký hợp đồng» = ký số HOẶC tải lên bản đã ký: ghi người được giao tải (trước khi gửi ký, để ký số xong sớm không bị tính nhầm là còn chờ).
        const assigned = p.node.companyUsers ?? [p.signer];
        await d.uow.tenant(who(ctx), (r) => r.esign.openSignWait(id, assigned, ctx.userId));
        // CR-181 · Q1 · ký trên tài liệu: không phong bì; bước chờ xong khi đủ ô Bên A (engine/Lưu chữ ký báo).
        if (ondocStart(p.provider)) return { status: "awaiting_ondoc" };
        if (await sendIfProvider(d, ctx, id, p)) return { status: "awaiting_upload" };
        // CR-125 m9 · mã phong bì vừa tạo (đầu ra `envelope_id` của stage gửi; stage chờ cũng ghi khi phong bì xong).
        const e = await d.uow.tenant(who(ctx), (r) => r.esign.latest(id));
        return e ? { status: "sent", envelope_id: e.envelopeId } : { status: "sent" };
      },
    },
    {
      ...base,
      name: INTAKE_TOOL_KEYS.remind,
      description: "Nhắc người phụ trách: sắp đến hạn nghĩa vụ của hợp đồng.",
      side_effect: false,
      async run(ctx, args) {
        const id = contractIdOf(args);
        const c = await d.uow.tenant(who(ctx), (r) => r.esign.contract(id));
        if (!c) throw new Error("CONTRACT_NOT_FOUND");
        const label = contractCodeLabel(c);
        const n = await d.uow.tenant(who(ctx), (r) =>
          r.notify.enqueue([
            {
              user_id: ctx.userId,
              kind: "contract.obligation",
              title: `Sắp đến hạn nghĩa vụ HĐ ${label}`.slice(0, 200),
              link: `/contracts/c/${id}`,
              dedup_key: `intake-remind:${id}`,
            },
          ]),
        );
        return { status: n > 0 ? "notified" : "already" };
      },
    },
  ];
}
