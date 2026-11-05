// CR-120 · cr120-contracts-flow · nối khe `contracts.intake`: tool bước (`adapters/intake.tools.ts`) trên `PackUow` của gói + hook
// "ký xong" của use case ký số. Tách khỏi `packs.mount.ts`/`esign.mount.ts` (trần 400 dòng). Không esign (vắng module) ⇒ tool gửi ký ném lỗi
// rõ ràng (stage `tool_failed`), tool đọc/nhắc vẫn chạy.
import { ESignSignerSchema } from "@ai/contracts";
import type { Db, Tx } from "@ai/db";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackRunsBridge } from "../kit/application/pack-runs.ports";
import type { PackToolDef } from "../kit/application/pack-tools.ports";
import { esignRepo } from "./adapters/esign.repo";
import { extractionRepo } from "./adapters/extraction.repo";
import { intakeTools } from "./adapters/intake.tools";
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
  bindCompleted: (fn: (tenantId: string, contractId: string) => Promise<unknown>) => void;
} {
  const uow = createPackUow(db, "contracts", repos);
  return {
    tools: intakeTools({
      uow,
      send: async (tenantId, signer, contractId, signers) => {
        if (!esign) throw new Error("ESIGN_UNAVAILABLE");
        await esign.sendSystem(tenantId, signer, contractId, signers);
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

/** Đăng ký tool bước vào registry tool gói + bắn `esign.completed` (qua cổng engine `packRuns`, gắn lười) khi phong bì ký xong. */
export function mountIntake(
  d: {
    packTools?: { register(t: PackToolDef): void } | undefined;
    packRuns?: PackRunsBridge | undefined;
    esign?: ESignModule | undefined;
  },
  db: Db,
): void {
  const { tools, bindCompleted } = intakeWiring(db, d.esign);
  for (const t of tools) d.packTools?.register(t);
  bindCompleted(async (tenantId, contractId) => {
    await d.packRuns?.port?.signalEvent(
      tenantId,
      { pack: "contracts", record_id: contractId },
      "esign.completed",
    );
  });
}
