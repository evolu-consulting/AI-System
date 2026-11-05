// CR-120 · cr120-contracts-flow · tool gói của khe `contracts.intake` (stage `tool`, danh tính = người bắt đầu run, tx gói của tenant run):
//   contracts-extract            — AI trích xuất: ĐỌC trạng thái trích của HĐ (hàng đợi trích của gói chạy nền từ lúc tải lên); HĐ không thấy ⇒ lỗi tool.
//   contracts-esign-send         — ký số như một bước (G6): gửi phong bì ký (người ký công ty = người bắt đầu; đối tác theo email liên hệ HĐ).
//                                  `side_effect: true` ⇒ stage `real_action` (người duyệt bước trước cấp phép). Hoàn tất ký → hook gói bắn `esign.completed`.
//   contracts-obligation-remind  — chuông nhắc nghĩa vụ cho người bắt đầu run (idempotent theo HĐ).
// Chỉ chạm HĐ mà người bắt đầu thấy được (RLS `PackUow.tenant`); tenant khác ⇒ không thấy. Không log nội dung HĐ.
import type { ESignSignerIn } from "@ai/contracts";
import type { NotifyTxRepos } from "../../kit/application/notify";
import type {
  PackToolArgs,
  PackToolCtx,
  PackToolDef,
} from "../../kit/application/pack-tools.ports";
import type { PackUow } from "../../kit/application/ports";
import type { ESignRepo } from "../application/esign.ports";
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
  ) => Promise<void>;
  /** Đối tác ký hợp lệ theo schema người ký đối tác; sai ⇒ null. */
  parsePartner: (name: string, email: string) => { name: string; email: string } | null;
};

const CONTRACT = { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" };
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
      description:
        "Gửi hợp đồng đi ký số (người ký công ty = người bắt đầu; đối tác theo email liên hệ).",
      side_effect: true,
      async run(ctx, args) {
        const id = contractIdOf(args);
        const c = await d.uow.tenant(who(ctx), (r) => r.esign.contract(id));
        if (!c) throw new Error("CONTRACT_NOT_FOUND");
        const email = c.partner?.email?.trim() ?? "";
        const partner = email
          ? d.parsePartner((c.partner?.name?.trim() || email).slice(0, 200), email)
          : null;
        const signers: ESignSignerIn[] = partner
          ? [{ role: "company" }, { role: "partner", ...partner }]
          : [{ role: "company" }];
        await d.send(ctx.tenantId, ctx.userId, id, signers);
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
