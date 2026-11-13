// CR-120 · cr120-contracts-flow · nối khe `contracts.intake`: tool bước (`adapters/intake.tools.ts`) trên `PackUow` của gói + hook
// "ký xong" của use case ký số. Tách khỏi `packs.mount.ts`/`esign.mount.ts` (trần 400 dòng). Không esign (vắng module) ⇒ tool gửi ký ném lỗi
// rõ ràng (stage `tool_failed`), tool đọc/nhắc vẫn chạy.

import { ESignSignerSchema } from "@ai/contracts/pack-contracts";
import type { Db, Tx } from "@ai/db";
import type { Redis } from "ioredis";
import type { PackAccessView, PackRunsBridge, PackToolDef, SlotSpec } from "../kit/public";
import { createPackUow, moduleRegistry, slotRegistry } from "../kit/public";
import type { WithConfig } from "../packs.tenant-config";
import { esignRepo } from "./adapters/esign.repo";
import { extractionRepo } from "./adapters/extraction.repo";
import { INTAKE_TOOL_KEYS, intakeTools } from "./adapters/intake.tools";
import { type AttachmentBytes, mountCreateFromStep } from "./create-from-step.mount";
import { contractCodeLabel } from "./domain/contract-name";
import type { CompletedHook, ESignModule } from "./esign.mount";
import { esignBindingBase } from "./nodes/esign/binding";
import { mountPartnerSend } from "./partner-mailbox.mount";
import { mountRecordPayment } from "./record-payment.mount";

const repos = (tx: Tx, t: string) => ({
  extraction: extractionRepo(tx, t),
  esign: esignRepo(tx, t),
});

export function intakeWiring(
  db: Db,
  esign: ESignModule | undefined,
  packRuns?: PackRunsBridge | undefined,
): {
  tools: PackToolDef[];
  bindCompleted: (fn: CompletedHook) => void;
} {
  const uow = createPackUow(db, "contracts", repos);
  return {
    tools: intakeTools({
      uow,
      // cr125-contract-from-step · Ký số chỉ ký HĐ là bản ghi của chính lượt (có cầu engine ⇒ bắt buộc)
      ...(packRuns
        ? {
            recordOfRun: async (t: string, r: string) =>
              (await packRuns.port?.recordOf?.(t, r, "contracts")) ?? null,
          }
        : {}),
      send: async (tenantId, signer, contractId, signers, provider, node) => {
        if (!esign) throw new Error("ESIGN_UNAVAILABLE");
        await esign.sendSystem(tenantId, signer, contractId, signers, provider, node);
        // CR-122 · bước Ký số của flow: chuông "Mời ký số" cho MỌI người ký công ty (đường cũ esign-flow đã có; flow mới thiếu ⇒
        // giám đốc không biết tới lượt ký). Lỗi chuông không làm hỏng gửi ký.
        const users = node?.companyUsers ?? [signer];
        // CR-125 · x12 · chuông + dữ liệu thẻ/ảnh trang đầu (dựng NGOÀI tx; ảnh dựng một lần mỗi phiên bản HĐ).
        await (async () => {
          const label = await uow.system(tenantId, async (r) =>
            contractCodeLabel(await r.esign.contract(contractId)),
          );
          const notices = await Promise.all(
            users.map((u) => esign.invite(tenantId, contractId, u, label)),
          );
          await uow.system(tenantId, (r) => r.notify.enqueue(notices));
        })().catch(() => undefined);
      },
      nodeSigners: async (tenantId, entries) => {
        if (!esign) throw new Error("ESIGN_UNAVAILABLE");
        return esign.resolveNodeSigners(tenantId, entries); // E5 · kiểm thuộc công ty
      },
      parsePartner: (name, email) => {
        const p = ESignSignerSchema.safeParse({ role: "partner", name, email });
        return p.success && p.data.role === "partner"
          ? { name: p.data.name, email: p.data.email }
          : null;
      },
    }),
    bindCompleted: (fn) => esign?.bindCompleted(fn),
  };
}

/** cr120-handson-fixes · khe `contracts.intake` (luôn bật, def mặc định hub 0093) phải có trong registry để GET/PUT routing không 422
 *  `SLOT_UNKNOWN`. Def của khe là quy trình thường (stages), không có `slot_body` ⇒ validate/compile rỗng. */
export const intakeSlotSpec: SlotSpec = {
  key: "contracts.intake",
  label: "Sổ Hợp Tác · Tiếp nhận hợp đồng",
  packKey: "contracts",
  requiredInputs: ["contract_id"],
  systemTools: [],
  validate: () => [],
  compile: (b) => (Array.isArray(b) ? b : []),
  groupKeys: () => [],
};

/** Đăng ký tool bước vào registry tool gói + bắn `esign.completed` (qua cổng engine `packRuns`, gắn lười) khi phong bì ký xong. */
export function mountIntake(
  d: {
    packTools?: { register(t: PackToolDef): void } | undefined;
    packRuns?: PackRunsBridge | undefined;
    esign?: ESignModule | undefined;
    packs?: { filebox?: { url: string; token: string } } | undefined; // q5 · PDF cho thư email
    view?: PackAccessView | undefined; // q7 · cổng tính năng cho tool gửi đối tác
    partnerMailbox?: boolean | undefined; // q7 · kênh hộp thư (HUB_PARTNER_MAILBOX)
    redis?: Redis | undefined; // cr125-contract-from-step · hạn mức tải lên/ngày của use case tải lên
    config?: WithConfig["config"] | undefined; // múi giờ công ty
    attachmentBytes?: AttachmentBytes | undefined; // đọc tệp đính kèm hub (bước Soạn thảo), tiêm ở packs.mount.ts
  },
  db: Db,
): void {
  slotRegistry.register(intakeSlotSpec);
  const { tools, bindCompleted } = intakeWiring(db, d.esign, d.packRuns);
  for (const t of tools) d.packTools?.register(t);
  // CR-125 · m2 · sổ module: tool bước + node Ký số (gửi ký = `contracts-esign-send`; cổng cấu hình nối ở m4)
  for (const t of tools) moduleRegistry.bindTool(t);
  moduleRegistry.bindNode(esignBindingBase); // CR-125 · m4 · nodes/esign/binding.ts
  mountCreateFromStep(d, db); // cr125-contract-from-step · node «Tạo hợp đồng từ hồ sơ»
  mountRecordPayment(d, db); // CR-140 · node «Ghi thanh toán vào HĐ»
  mountPartnerSend(d, db); // CR-124 · q3 · node «Gửi đối tác xác nhận» + cổng hộp thư liên công ty (bộ chuyển tắt mặc định)
  // CR-122 E3 · bắn đúng khoá theo trạng thái cuối (đã ký / từ chối / huỷ). Webhook + vòng đồng bộ trùng ⇒ `signalEvent` chỉ thả
  // stage đang chờ một lần (khoá run; lần sau stage đã xong ⇒ không còn chờ khoá đó).
  bindCompleted(async (tenantId, contractId, event, data) => {
    // CR-125 m9 · `data` (mã phong bì, thời điểm ký, người ký) ⇒ đầu ra bước chờ của node Ký số, cùng tx thả bước.
    await d.packRuns?.port?.signalEvent(
      tenantId,
      { pack: "contracts", record_id: contractId },
      event,
      data,
    );
  });
}
