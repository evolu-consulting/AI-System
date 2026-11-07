// CR-120 · cr120-contracts-flow · nối khe `contracts.intake`: tool bước (`adapters/intake.tools.ts`) trên `PackUow` của gói + hook
// "ký xong" của use case ký số. Tách khỏi `packs.mount.ts`/`esign.mount.ts` (trần 400 dòng). Không esign (vắng module) ⇒ tool gửi ký ném lỗi
// rõ ràng (stage `tool_failed`), tool đọc/nhắc vẫn chạy.

import { ESignSignerSchema } from "@ai/contracts/pack-contracts";
import type { Db, Tx } from "@ai/db";
import type { PackRunsBridge, PackToolDef, SlotSpec } from "../kit/public";
import { createPackUow, slotRegistry } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { extractionRepo } from "./adapters/extraction.repo";
import { intakeTools } from "./adapters/intake.tools";
import { contractLabelOf, signInviteBell } from "./application/esign-flow.usecase";
import type { ESignEvent } from "./domain/esign-event.rules";
import type { ESignModule } from "./esign.mount";

const repos = (tx: Tx, t: string) => ({
  extraction: extractionRepo(tx, t),
  esign: esignRepo(tx, t),
});

export function intakeWiring(
  db: Db,
  esign: ESignModule | undefined,
): {
  tools: PackToolDef[];
  bindCompleted: (
    fn: (tenantId: string, contractId: string, event: ESignEvent) => Promise<unknown>,
  ) => void;
} {
  const uow = createPackUow(db, "contracts", repos);
  return {
    tools: intakeTools({
      uow,
      send: async (tenantId, signer, contractId, signers, provider, node) => {
        if (!esign) throw new Error("ESIGN_UNAVAILABLE");
        await esign.sendSystem(tenantId, signer, contractId, signers, provider, node);
        // CR-122 · bước Ký số của flow: chuông "Mời ký số" cho MỌI người ký công ty (đường cũ esign-flow đã có; flow mới thiếu ⇒
        // giám đốc không biết tới lượt ký). Lỗi chuông không làm hỏng gửi ký.
        const users = node?.companyUsers ?? [signer];
        await uow
          .system(tenantId, async (r) => {
            const label = contractLabelOf(await r.esign.contract(contractId));
            await r.notify.enqueue(users.map((u) => signInviteBell(u, contractId, label)));
          })
          .catch(() => undefined);
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
  },
  db: Db,
): void {
  slotRegistry.register(intakeSlotSpec);
  const { tools, bindCompleted } = intakeWiring(db, d.esign);
  for (const t of tools) d.packTools?.register(t);
  // CR-122 E3 · bắn đúng khoá theo trạng thái cuối (đã ký / từ chối / huỷ). Webhook + vòng đồng bộ trùng ⇒ `signalEvent` chỉ thả
  // stage đang chờ một lần (khoá run; lần sau stage đã xong ⇒ không còn chờ khoá đó).
  bindCompleted(async (tenantId, contractId, event) => {
    await d.packRuns?.port?.signalEvent(
      tenantId,
      { pack: "contracts", record_id: contractId },
      event,
    );
  });
}
