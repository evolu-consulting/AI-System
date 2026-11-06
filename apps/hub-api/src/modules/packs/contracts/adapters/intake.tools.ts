// CR-120 · cr120-contracts-flow · tool gói của khe `contracts.intake` (stage `tool`, danh tính = người bắt đầu run, tx gói của tenant run):
//   contracts-extract            — AI trích xuất: ĐỌC trạng thái trích của HĐ (hàng đợi trích của gói chạy nền từ lúc tải lên); HĐ không thấy ⇒ lỗi tool.
//   contracts-esign-send         — ký số như một bước (G6): gửi phong bì ký (người ký công ty = người bắt đầu; đối tác theo email liên hệ HĐ).
//                                  `side_effect: true` ⇒ stage `real_action` (người duyệt bước trước cấp phép). Hoàn tất ký → hook gói bắn `esign.completed`.
//   contracts-obligation-remind  — chuông nhắc nghĩa vụ cho người bắt đầu run (idempotent theo HĐ).
// Chỉ chạm HĐ mà người bắt đầu thấy được (RLS `PackUow.tenant`); tenant khác ⇒ không thấy. Không log nội dung HĐ.
import {
  decodeEsignNodeArgs,
  ESIGN_NODE_ORDERS,
  type ESignSignerIn,
  type EsignNodeConfig,
  type EsignNodeSigner,
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

export const INTAKE_TOOL_KEYS = {
  extract: "contracts-extract",
  esignSend: "contracts-esign-send",
  remind: "contracts-obligation-remind",
} as const;

type R = {
  extraction: Pick<ExtractionRepo, "source">;
  esign: Pick<ESignRepo, "contract">;
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
  /** Đối tác ký hợp lệ theo schema người ký đối tác; sai ⇒ null. */
  parsePartner: (name: string, email: string) => { name: string; email: string } | null;
};

const CONTRACT = { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" };
/** E5 · cấu hình node Ký số (tuỳ chọn; trống ⇒ cài đặt ký số chung của app). Giá trị đơn; `company_signers` = `user:<id>,group:<id>`. */
const ESIGN_NODE_PARAM_DEFS: readonly PackToolDef["params"][number][] = [
  { name: "provider", type: "text", required: false, description: "Nhà cung cấp ký số" },
  { name: "company_signers", type: "text", required: false, description: "Người ký phía công ty" },
  { name: "partner_signs", type: "boolean", required: false, description: "Đối tác ký" },
  {
    name: "order",
    type: "select",
    required: false,
    options: ESIGN_NODE_ORDERS,
    description: "Thứ tự ký",
  },
  { name: "due_days", type: "number", required: false, description: "Hạn ký (ngày)" },
  { name: "remind_every_hours", type: "number", required: false, description: "Nhắc mỗi (giờ)" },
];

/** Người ký + thứ tự theo cấu hình node: `partner_signs` false ⇒ chỉ công ty ký; true ⇒ bắt buộc có đối tác; vắng ⇒ có email thì đối tác ký. */
async function planSend(
  d: IntakeToolDeps,
  ctx: PackToolCtx,
  cfg: EsignNodeConfig,
  parsed: { name: string; email: string } | null,
) {
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
  };
  return {
    signers,
    node,
    signer: users?.[0] ?? ctx.userId,
    custom: cfg.provider !== undefined || Object.keys(node).length > 0,
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function contractIdOf(args: PackToolArgs): string {
  const id = String(args.contract_id ?? "");
  if (!UUID.test(id)) throw new Error("CONTRACT_ID_INVALID");
  return id;
}
const who = (ctx: PackToolCtx) => ({ tenantId: ctx.tenantId, userId: ctx.userId });

export function intakeTools(d: IntakeToolDeps): PackToolDef[] {
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
        const cfg = node.config;
        const c = await d.uow.tenant(who(ctx), (r) => r.esign.contract(id));
        if (!c) throw new Error("CONTRACT_NOT_FOUND");
        const email = c.partner?.email?.trim() ?? "";
        const parsed = email
          ? d.parsePartner((c.partner?.name?.trim() || email).slice(0, 200), email)
          : null;
        const p = await planSend(d, ctx, cfg, parsed);
        // E5 · args GHI ĐÈ cài đặt app; không có cấu hình node ⇒ đúng đường cũ (4 tham số).
        if (p.custom) await d.send(ctx.tenantId, p.signer, id, p.signers, cfg.provider, p.node);
        else await d.send(ctx.tenantId, p.signer, id, p.signers);
        return { status: "sent" };
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
        const label = (c.number ?? c.title ?? "").slice(0, 120);
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
